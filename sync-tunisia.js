'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { teamRatings, matchLambdas, buildMatchMarketsPoints } = require('./pricingEngine');

// Flashscore Raw Feed Endpoints & Config
const FLASHSCORE_BASE_URL = 'https://local-global.flashscore.ninja/2/x/feed';
const FLASHSCORE_FALLBACK_URL = 'https://46.flashscore.ninja/2/x/feed';
const FLASHSCORE_IMAGE_BASE = 'https://static.flashscore.com/res/image/data';

// Mobile Dalvik headers to bypass Cloudflare protection and emulate native mobile app
const FLASHSCORE_HEADERS = {
  'x-fsign': 'SW9D1eZo',
  'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 14; SM-S928B Build/UP1A.231005.007)',
  'Accept': '*/*',
  'Accept-Language': 'ar,en-US;q=0.9',
  'Connection': 'keep-alive'
};

const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Reversibly converts an alphanumeric Flashscore Match ID (e.g. '4SrepIgn')
 * into a 64-bit safe integer for PostgreSQL BIGINT external_id storage.
 */
function flashscoreIdToBigInt(id) {
  if (typeof id === 'number') return id;
  if (!id || typeof id !== 'string') return 0;
  if (/^\d+$/.test(id)) return Number(id);

  let res = 0n;
  for (let i = 0; i < id.length; i++) {
    const idx = BASE62_ALPHABET.indexOf(id[i]);
    if (idx !== -1) {
      res = res * 62n + BigInt(idx);
    }
  }
  return Number(res);
}

/**
 * Reverts a BIGINT external_id back to its original Flashscore alphanumeric string.
 */
function bigIntToFlashscoreId(num) {
  let n = BigInt(num);
  if (n <= 0n) return '';
  let str = '';
  while (n > 0n) {
    const rem = Number(n % 62n);
    str = BASE62_ALPHABET[rem] + str;
    n = n / 62n;
  }
  return str;
}

/**
 * Maps Flashscore team logos to public CDN URLs.
 */
function getFlashscoreCrest(logoFilename) {
  if (!logoFilename || typeof logoFilename !== 'string' || !logoFilename.trim()) {
    return null;
  }
  const clean = logoFilename.trim();
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    return clean;
  }
  return `${FLASHSCORE_IMAGE_BASE}/${clean}`;
}

/**
 * Dictionary mapping Latin team names to canonical Arabic team names.
 */
const TUNISIA_TEAMS_AR = {
  'stade tunisien': 'الملعب التونسي',
  'club africain': 'النادي الإفريقي',
  'esperance tunis': 'الترجي الرياضي',
  'esperance de tunis': 'الترجي الرياضي',
  'esperance': 'الترجي الرياضي',
  'etoile sahel': 'النجم الساحلي',
  'etoile du sahel': 'النجم الساحلي',
  'cs sfaxien': 'النادي الصفاقسي',
  'sfaxien': 'النادي الصفاقسي',
  'us monastir': 'الاتحاد المنستيري',
  'monastir': 'الاتحاد المنستيري',
  'es zarzis': 'الترجي الجرجيسي',
  'zarzis': 'الترجي الجرجيسي',
  'olympique beja': 'الأولمبي الباجي',
  'beja': 'الأولمبي الباجي',
  'ca bizertin': 'النادي البنزرتي',
  'bizertin': 'النادي البنزرتي',
  'us ben guerdane': 'اتحاد بن قردان',
  'ben guerdane': 'اتحاد بن قردان',
  'as soliman': 'مستقبل سليمان',
  'soliman': 'مستقبل سليمان',
  'egs gafsa': 'قوافل قفصة',
  'gafsa': 'قوافل قفصة',
  'js omrane': 'شبيبة العمران',
  'omrane': 'شبيبة العمران',
  'es metlaoui': 'نجم المتلوي',
  'metlaoui': 'نجم المتلوي',
  'us tataouine': 'اتحاد تطاوين',
  'tataouine': 'اتحاد تطاوين',
  'as gabes': 'مستقبل قابس',
  'gabes': 'مستقبل قابس',
  'cs hammam-lif': 'نادي حمام الأنف',
  'hammam-lif': 'نادي حمام الأنف'
};

/**
 * Formats a raw team name into Arabic.
 */
function formatTunisianTeam(rawName) {
  if (!rawName) return 'فريق تونسي';
  const clean = rawName.trim();
  if (/[\u0600-\u06FF]/.test(clean)) return clean;
  const lower = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  for (const [latin, arabic] of Object.entries(TUNISIA_TEAMS_AR)) {
    if (lower === latin || lower.includes(latin)) {
      return arabic;
    }
  }
  return clean;
}

/**
 * Fetches raw feed from Flashscore mobile endpoints with fallback.
 */
async function fetchFlashscoreFeed(feedPath, { fetcher = fetch } = {}) {
  const cleanPath = String(feedPath).replace(/^\/+/, '');
  const urls = [
    `${FLASHSCORE_BASE_URL}/${cleanPath}`,
    `${FLASHSCORE_FALLBACK_URL}/${cleanPath}`
  ];

  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetcher(url, {
        headers: FLASHSCORE_HEADERS,
        signal: AbortSignal.timeout(15000)
      });
      if (res.ok) {
        return await res.text();
      }
      lastError = new Error(`Flashscore HTTP ${res.status} (${res.statusText}) on ${url}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`Flashscore fetch failed for ${feedPath}`);
}

/**
 * Parses Flashscore raw delimited feed into structured tournament and match objects.
 */
function parseFlashscoreFeed(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const tournaments = [];
  const tournamentBlocks = rawText.split('~ZA÷').slice(1);

  for (const block of tournamentBlocks) {
    const matchBlocks = block.split('~AA÷');
    const headerPart = matchBlocks[0];
    const headerFields = {};
    for (const item of headerPart.split('¬')) {
      const idx = item.indexOf('÷');
      if (idx !== -1) {
        headerFields[item.slice(0, idx)] = item.slice(idx + 1);
      }
    }
    const tournamentName = headerPart.split('¬')[0] || '';

    const matches = [];
    for (let i = 1; i < matchBlocks.length; i++) {
      const mBlock = matchBlocks[i];
      const mFields = {};
      const pairs = mBlock.split('¬');
      mFields.id = pairs[0].split('÷')[0];
      for (const item of pairs) {
        const idx = item.indexOf('÷');
        if (idx !== -1) {
          mFields[item.slice(0, idx)] = item.slice(idx + 1);
        }
      }
      matches.push(mFields);
    }

    tournaments.push({
      name: tournamentName,
      country: headerFields.ZY || '',
      tournamentId: headerFields.ZEE || '',
      seasonId: headerFields.ZC || '',
      url: headerFields.ZL || '',
      logo: headerFields.OAJ || '',
      matches
    });
  }
  return tournaments;
}

/**
 * Determines whether a tournament belongs to Tunisian Ligue 1.
 */
function isTunisianLigue1(t) {
  const name = String(t.name || '').toLowerCase();
  const country = String(t.country || '').toLowerCase();
  const url = String(t.url || '').toLowerCase();

  const isTunisia = country.includes('tunisia') || name.includes('tunisia') || name.includes('تونس') || url.includes('/tunisia/');
  if (!isTunisia) return false;

  const isL1 =
    name.includes('ligue professionnelle 1') ||
    name.includes('ligue 1') ||
    name.includes('الرابطة الأولى') ||
    name.includes('الرابطة المحترفة الأولى') ||
    url.includes('ligue-professionnelle-1') ||
    t.tournamentId === 'lfv2BGo7';

  return isL1;
}

/**
 * Maps Flashscore status codes (AB / AC) to internal KickPredict match status.
 */
function mapFlashscoreStatus(match) {
  if (!match) return 'SCHEDULED';

  const ab = String(match.AB ?? '').trim();
  const ac = String(match.AC ?? '').trim();

  // Cancelled checks
  if (ac === '12' || ac === '13' || ac === '30' || match.type === 'canceled') {
    return 'CANCELLED';
  }

  // Postponed checks
  if (ab === '4' || ac === '11' || ac === '10' || match.type === 'postponed') {
    return 'POSTPONED';
  }

  // Halftime / Paused checks
  if (ac === '17' || ac === '18' || ac === '19' || match.code === 7 || match.type === 'paused') {
    return 'PAUSED';
  }

  // Primary status
  switch (ab) {
    case '1':
      return 'SCHEDULED';
    case '2':
      return ac === '17' ? 'PAUSED' : 'IN_PLAY';
    case '3':
      return 'FINISHED';
    case '4':
      return 'POSTPONED';
    default:
      if (ac === '3' || match.code === 100 || match.type === 'finished') return 'FINISHED';
      if (ac === '1' || ac === '2' || match.type === 'inprogress') return 'IN_PLAY';
      return 'SCHEDULED';
  }
}

/**
 * Extracts scores and half-time scores from a Flashscore match.
 */
function parseFlashscoreScore(matchOrHome, awayOrStatus, statusParam) {
  if (matchOrHome === null || matchOrHome === undefined) {
    return { home: null, away: null, homeHt: null, awayHt: null };
  }

  // Flashscore match object
  if (typeof matchOrHome === 'object' && ('id' in matchOrHome || 'AB' in matchOrHome || 'AE' in matchOrHome)) {
    const m = matchOrHome;
    const status = awayOrStatus || mapFlashscoreStatus(m);
    const isLiveOrFinished = status === 'IN_PLAY' || status === 'PAUSED' || status === 'FINISHED';

    let home = null;
    let away = null;
    let homeHt = null;
    let awayHt = null;

    if (isLiveOrFinished) {
      if (m.AG !== undefined && m.AG !== null && m.AG !== '') {
        const parsed = parseInt(m.AG, 10);
        if (!isNaN(parsed) && parsed >= 0) home = parsed;
      }
      if (m.AH !== undefined && m.AH !== null && m.AH !== '') {
        const parsed = parseInt(m.AH, 10);
        if (!isNaN(parsed) && parsed >= 0) away = parsed;
      }
      if (m.BA !== undefined && m.BA !== null && m.BA !== '') {
        const parsed = parseInt(m.BA, 10);
        if (!isNaN(parsed) && parsed >= 0) homeHt = parsed;
      }
      if (m.BB !== undefined && m.BB !== null && m.BB !== '') {
        const parsed = parseInt(m.BB, 10);
        if (!isNaN(parsed) && parsed >= 0) awayHt = parsed;
      }
    }
    return { home, away, homeHt, awayHt };
  }

  // Numeric direct parameters: (homeScore, awayScore, status)
  const homeArg = matchOrHome;
  const awayArg = awayOrStatus;
  const status = statusParam;
  const isLiveOrFinished = status === 'IN_PLAY' || status === 'PAUSED' || status === 'FINISHED';

  const extractNum = (val) => {
    if (typeof val === 'number') return val >= 0 ? val : null;
    if (typeof val === 'string' && val.trim() !== '') {
      const p = parseInt(val, 10);
      return !isNaN(p) && p >= 0 ? p : null;
    }
    if (val && typeof val === 'object') {
      const p = val.current ?? val.display ?? val.score;
      return typeof p === 'number' && p >= 0 ? p : null;
    }
    return null;
  };

  const extractPeriod1 = (val) => {
    if (val && typeof val === 'object' && typeof val.period1 === 'number' && val.period1 >= 0) {
      return val.period1;
    }
    return null;
  };

  return {
    home: isLiveOrFinished ? extractNum(homeArg) : null,
    away: isLiveOrFinished ? extractNum(awayArg) : null,
    homeHt: isLiveOrFinished ? extractPeriod1(homeArg) : null,
    awayHt: isLiveOrFinished ? extractPeriod1(awayArg) : null
  };
}

/**
 * Extracts round and matchday information from a Flashscore match.
 */
function roundInfoFromFlashscore(match) {
  const roundStr = String(match?.ER || match?.roundName || '').trim();
  const matchNum = roundStr.match(/\d+/);
  if (matchNum) {
    const num = parseInt(matchNum[0], 10);
    return {
      matchday: num,
      key: `MD:${num}`,
      label: `الجولة ${num}`
    };
  }

  return {
    matchday: null,
    key: 'REGULAR_SEASON',
    label: roundStr || 'الجولة'
  };
}

// In-memory kick-off cache for scheduled fixtures
let scheduledFixturesCache = [];

/**
 * Midnight Cron Job & Full Schedule Sync:
 * Runs once a day at 00:00 (Africa/Tunis).
 * Fetches the 4-day window (today + 3 days ahead: day 0, 1, 2, 3) from Flashscore raw feeds.
 * Stores kick-off times and Poisson probabilities in database and memory.
 * Makes ZERO subsequent requests to Flashscore until the next midnight or until live match window.
 */
async function syncTunisianLeague(pool, { fetcher = fetch, daysCount = 4 } = {}) {
  console.log(`[Tunisia Flashscore] Running midnight fixture refresh for ${daysCount} days (today + 3 days)...`);

  try {
    const allMatchesMap = new Map();

    // Fetch daily feeds for 4 consecutive days (0, 1, 2, 3)
    for (let dayOffset = 0; dayOffset < daysCount; dayOffset++) {
      try {
        const feedText = await fetchFlashscoreFeed(`f_1_${dayOffset}_2_ar_1`, { fetcher });
        const tournaments = parseFlashscoreFeed(feedText);
        const l1Tournaments = tournaments.filter(isTunisianLigue1);

        for (const t of l1Tournaments) {
          for (const m of t.matches) {
            if (m.id && !allMatchesMap.has(m.id)) {
              allMatchesMap.set(m.id, { ...m, tournamentName: t.name });
            }
          }
        }
      } catch (err) {
        console.warn(`[Tunisia Flashscore] Failed fetching day offset +${dayOffset}:`, err.message);
      }
    }

    const matchesList = Array.from(allMatchesMap.values());
    console.log(`[Tunisia Flashscore] Discovered ${matchesList.length} Tunisian Ligue 1 fixtures across ${daysCount} days.`);

    // Build Poisson expected ratings from finished matches
    const finishedForModel = [];
    if (pool) {
      try {
        const { rows: dbFinished } = await pool.query(
          `SELECT home_score, away_score, external_id
           FROM matches
           WHERE competition_code IN ('TUN', 'TU1')
             AND status = 'FINISHED'
             AND home_score IS NOT NULL
             AND away_score IS NOT NULL`
        );
        for (const row of dbFinished) {
          finishedForModel.push({
            homeId: Number(row.external_id) || 1,
            awayId: (Number(row.external_id) || 1) + 1,
            homeGoals: row.home_score,
            awayGoals: row.away_score
          });
        }
      } catch (err) {
        // fallback
      }
    }

    const model = teamRatings(finishedForModel);
    let updatedCount = 0;
    const newCache = [];

    for (const m of matchesList) {
      const extId = flashscoreIdToBigInt(m.id);
      if (!Number.isSafeInteger(extId) || !m.AE || !m.AF || !m.AD) {
        continue;
      }

      const kickoffSec = parseInt(m.AD, 10);
      const kickoffIso = new Date(kickoffSec * 1000).toISOString();
      const homeTeam = formatTunisianTeam(m.AE);
      const awayTeam = formatTunisianTeam(m.AF);
      const homeCrest = getFlashscoreCrest(m.OA);
      const awayCrest = getFlashscoreCrest(m.OB);
      const status = mapFlashscoreStatus(m);
      const scores = parseFlashscoreScore(m, status);
      const round = roundInfoFromFlashscore(m);

      const homeIdNum = m.PX ? flashscoreIdToBigInt(m.PX) : extId;
      const awayIdNum = m.PY ? flashscoreIdToBigInt(m.PY) : extId + 1;
      const { lambdaHome, lambdaAway } = matchLambdas(homeIdNum, awayIdNum, model);
      const markets = buildMatchMarketsPoints(lambdaHome, lambdaAway);

      newCache.push({
        id: extId,
        rawId: m.id,
        kickoff: kickoffIso,
        status,
        homeTeam,
        awayTeam
      });

      if (pool) {
        await pool.query(
          `INSERT INTO matches (
             external_id, competition_code, stage, matchday, round_key, round_label,
             home_team, home_crest, away_team, away_crest, utc_date, status,
             home_score, away_score, home_ht, away_ht, home_lambda, away_lambda,
             markets_points, updated_at
           ) VALUES (
             $1, 'TUN', 'REGULAR_SEASON', $2, $3, $4,
             $5, $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15, $16, $17::jsonb, NOW()
           )
           ON CONFLICT (external_id) DO UPDATE SET
             competition_code = 'TUN',
             stage = EXCLUDED.stage,
             matchday = EXCLUDED.matchday,
             round_key = EXCLUDED.round_key,
             round_label = EXCLUDED.round_label,
             home_team = EXCLUDED.home_team,
             home_crest = COALESCE(EXCLUDED.home_crest, matches.home_crest),
             away_team = EXCLUDED.away_team,
             away_crest = COALESCE(EXCLUDED.away_crest, matches.away_crest),
             utc_date = CASE WHEN matches.points_calculated THEN matches.utc_date ELSE EXCLUDED.utc_date END,
             status = CASE
               WHEN matches.points_calculated AND matches.utc_date < NOW() - INTERVAL '48 hours' THEN matches.status
               WHEN matches.points_calculated AND (EXCLUDED.status != 'FINISHED' OR EXCLUDED.home_score IS NULL OR EXCLUDED.away_score IS NULL) THEN matches.status
               ELSE EXCLUDED.status
             END,
             home_score = CASE
               WHEN matches.points_calculated AND matches.utc_date < NOW() - INTERVAL '48 hours' THEN matches.home_score
               WHEN matches.points_calculated AND (EXCLUDED.status != 'FINISHED' OR EXCLUDED.home_score IS NULL OR EXCLUDED.away_score IS NULL) THEN matches.home_score
               ELSE EXCLUDED.home_score
             END,
             away_score = CASE
               WHEN matches.points_calculated AND matches.utc_date < NOW() - INTERVAL '48 hours' THEN matches.away_score
               WHEN matches.points_calculated AND (EXCLUDED.status != 'FINISHED' OR EXCLUDED.home_score IS NULL OR EXCLUDED.away_score IS NULL) THEN matches.away_score
               ELSE EXCLUDED.away_score
             END,
             home_ht = CASE WHEN matches.points_calculated THEN matches.home_ht ELSE EXCLUDED.home_ht END,
             away_ht = CASE WHEN matches.points_calculated THEN matches.away_ht ELSE EXCLUDED.away_ht END,
             home_lambda = CASE WHEN EXCLUDED.status IN ('TIMED', 'SCHEDULED') THEN EXCLUDED.home_lambda ELSE matches.home_lambda END,
             away_lambda = CASE WHEN EXCLUDED.status IN ('TIMED', 'SCHEDULED') THEN EXCLUDED.away_lambda ELSE matches.away_lambda END,
             markets_points = CASE
               WHEN matches.points_calculated THEN matches.markets_points
               WHEN EXCLUDED.status IN ('TIMED', 'SCHEDULED') AND matches.odds_source = 'bookmaker' THEN matches.markets_points
               WHEN EXCLUDED.status IN ('TIMED', 'SCHEDULED') THEN EXCLUDED.markets_points
               ELSE COALESCE(matches.markets_points, EXCLUDED.markets_points)
             END,
             updated_at = NOW()`,
          [
            extId,
            round.matchday,
            round.key,
            round.label,
            homeTeam,
            homeCrest,
            awayTeam,
            awayCrest,
            kickoffIso,
            status,
            scores.home,
            scores.away,
            scores.homeHt,
            scores.awayHt,
            lambdaHome,
            lambdaAway,
            JSON.stringify(markets)
          ]
        );
        updatedCount++;
      }
    }

    scheduledFixturesCache = newCache;
    console.log(
      `[Tunisia Flashscore] Midnight sync completed: saved ${updatedCount} fixtures in database & memory. No further network calls needed until live windows.`
    );
    return matchesList;
  } catch (err) {
    console.error('[Tunisia Flashscore] Midnight sync error:', err.message);
    return [];
  }
}

let smartPollRunning = false;

/**
 * Just-in-Time Live Polling:
 * Runs every 2 minutes with a STRICT Gate Condition:
 * 1. Checks if any scheduled match is currently live (NOW >= kickoff and not finished yet).
 * 2. If NO live match is playing: outputs 'Idling: No live matches' and makes 0 HTTP requests.
 * 3. If a live match is in progress: fetches Flashscore Day 0 raw feed to update live scores and events.
 */
async function smartPollTunisia(
  pool,
  { settleFinishedMatches, reconcileScoreCorrections, fetcher = fetch } = {}
) {
  if (smartPollRunning) return;
  smartPollRunning = true;

  try {
    // 1. Strict Gate Condition: Are there any scheduled matches currently playing?
    const { rows: activeMatches } = await pool.query(
      `SELECT id, external_id, home_team, away_team, utc_date, status, home_score, away_score,
              home_ht, away_ht, points_calculated
       FROM matches
       WHERE competition_code IN ('TUN', 'TU1')
         AND (
           status IN ('IN_PLAY', 'PAUSED')
           OR (
             status IN ('TIMED', 'SCHEDULED')
             AND utc_date <= NOW()
             AND utc_date >= NOW() - INTERVAL '135 minutes'
           )
         )
       ORDER BY utc_date ASC`
    );

    // Gate check: If no matches are live, IDLE immediately with 0 network calls!
    if (activeMatches.length === 0) {
      console.log('[Tunisia Flashscore Smart Polling] Idling: No live matches');
      return;
    }

    console.log(
      `[Tunisia Flashscore Smart Polling] Detected ${activeMatches.length} live/active matches in progress. Querying Flashscore live feed...`
    );

    // 2. Fetch live updates from Flashscore Day 0 raw feed
    const feedText = await fetchFlashscoreFeed('f_1_0_2_ar_1', { fetcher });
    const tournaments = parseFlashscoreFeed(feedText);

    // Index all matches from today's feed by BIGINT and raw string ID
    const feedMatchesMap = new Map();
    for (const t of tournaments) {
      for (const m of t.matches) {
        if (m.id) {
          const bigIntId = flashscoreIdToBigInt(m.id);
          feedMatchesMap.set(bigIntId, m);
          feedMatchesMap.set(m.id, m);
        }
      }
    }

    const updatedMatchRows = [];

    // Process all active matches in memory from the single response
    for (const match of activeMatches) {
      try {
        const bigIntId = Number(match.external_id);
        const m = feedMatchesMap.get(bigIntId) || feedMatchesMap.get(match.external_id);
        if (!m) continue;

        const newStatus = mapFlashscoreStatus(m);
        const scores = parseFlashscoreScore(m, newStatus);

        const statusChanged = match.status !== newStatus;
        const scoreChanged =
          (scores.home !== null && scores.home !== match.home_score) ||
          (scores.away !== null && scores.away !== match.away_score);

        if (statusChanged || scoreChanged) {
          await pool.query(
            `UPDATE matches
             SET status = $1,
                 home_score = COALESCE($2, home_score),
                 away_score = COALESCE($3, away_score),
                 home_ht = COALESCE($4, home_ht),
                 away_ht = COALESCE($5, away_ht),
                 updated_at = NOW()
             WHERE id = $6`,
            [newStatus, scores.home, scores.away, scores.homeHt, scores.awayHt, match.id]
          );

          updatedMatchRows.push({
            external_id: match.external_id,
            competition_code: 'TUN',
            home_score: scores.home,
            away_score: scores.away,
            home_ht: scores.homeHt,
            away_ht: scores.awayHt,
            status: newStatus
          });
        }
      } catch (err) {
        console.error(`[Tunisia Flashscore Smart Polling] Failed updating match ${match.external_id}:`, err.message);
      }
    }

    if (updatedMatchRows.length > 0) {
      console.log(`[Tunisia Flashscore Smart Polling] Updated ${updatedMatchRows.length} Tunisian matches in batch.`);
      if (typeof reconcileScoreCorrections === 'function') {
        await reconcileScoreCorrections(updatedMatchRows);
      }
      if (typeof settleFinishedMatches === 'function') {
        await settleFinishedMatches();
      }
    }
  } catch (err) {
    console.error('[Tunisia Flashscore Smart Polling] Batch polling error:', err.message);
  } finally {
    smartPollRunning = false;
  }
}

/**
 * Purges legacy Tunisian matches from PostgreSQL.
 */
async function purgeLegacyTunisiaMatches(pool) {
  try {
    const res = await pool.query(`
      DELETE FROM matches
      WHERE competition_code IN ('TUN', 'TU1', '984')
         OR competition_code ILIKE '%TUN%';
    `);
    const boostRes = await pool.query(`
      DELETE FROM user_round_boosts
      WHERE competition_code IN ('TUN', 'TU1', '984')
         OR competition_code ILIKE '%TUN%';
    `);
    if (res.rowCount > 0 || boostRes.rowCount > 0) {
      console.log(`[Tunisia Flashscore] Purged ${res.rowCount} legacy Tunisian matches and ${boostRes.rowCount} boosts from PostgreSQL.`);
    }
    return { deletedMatches: res.rowCount, deletedBoosts: boostRes.rowCount };
  } catch (err) {
    console.warn('[Tunisia Flashscore] Purge query warning:', err.message);
    return { deletedMatches: 0, deletedBoosts: 0 };
  }
}

/**
 * Initializes Tunisia background synchronization via Flashscore:
 * 1. Runs full 4-day fixture schedule sync on boot.
 * 2. Schedules Midnight Cron Job at 00:00 (Africa/Tunis time).
 * 3. Schedules Just-in-Time smart polling every 2 minutes with strict gate condition.
 */
function initTunisiaSync({ pool, cron, settleFinishedMatches, reconcileScoreCorrections }) {
  console.log(
    `[Tunisia Flashscore] Initialized Flashscore Raw Feed provider (Midnight 4-day schedule + Just-In-Time 2m live polling).`
  );

  // 1. Initial 4-day schedule sync on startup
  (async () => {
    try {
      await syncTunisianLeague(pool);
    } catch (err) {
      console.error('[Tunisia Flashscore] Startup sync error:', err.message);
    }
  })();

  // 2. Midnight Cron Job at 00:00 Africa/Tunis time
  cron.schedule(
    '0 0 * * *',
    () => {
      console.log('[Tunisia Flashscore] Midnight cron triggered: refreshing 4-day fixtures schedule...');
      syncTunisianLeague(pool).catch((err) => {
        console.error('[Tunisia Flashscore] Midnight refresh error:', err.message);
      });
    },
    { timezone: 'Africa/Tunis' }
  );

  // 3. Just-In-Time Smart Polling every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    smartPollTunisia(pool, { settleFinishedMatches, reconcileScoreCorrections }).catch((err) => {
      console.error('[Tunisia Flashscore Smart Polling] Scheduled cycle error:', err.message);
    });
  });

  console.log('[Tunisia Flashscore] Midnight cron (00:00 Africa/Tunis) & Just-in-Time 2m polling active.');
}

module.exports = {
  syncTunisianLeague,
  smartPollTunisia,
  initTunisiaSync,
  purgeLegacyTunisiaMatches,
  fetchFlashscoreFeed,
  parseFlashscoreFeed,
  flashscoreIdToBigInt,
  bigIntToFlashscoreId,
  mapFlashscoreStatus,
  parseFlashscoreScore,
  roundInfoFromFlashscore,
  getFlashscoreCrest,
  formatTunisianTeam,
  isTunisianLigue1,
  FLASHSCORE_BASE_URL,
  FLASHSCORE_FALLBACK_URL,
  // Backwards compatibility aliases
  map365ScoresStatus: mapFlashscoreStatus,
  parse365ScoresScore: parseFlashscoreScore,
  roundInfoFrom365Scores: roundInfoFromFlashscore,
  mapSofaScoreStatus: mapFlashscoreStatus,
  parseSofaScoreScore: parseFlashscoreScore,
  roundInfoFromSofaScore: roundInfoFromFlashscore
};

// Standalone execution support: node sync-tunisia.js
if (require.main === module) {
  const cliPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  syncTunisianLeague(cliPool)
    .catch((error) => {
      console.error('[Tunisia Flashscore] Failed:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await cliPool.end();
    });
}
