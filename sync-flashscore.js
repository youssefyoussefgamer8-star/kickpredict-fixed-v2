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
 * Dictionary mapping Latin team names to canonical Arabic team names for Tunisian league.
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
 * Formats a raw team name into Arabic if Tunisian, otherwise returns cleaned name.
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
 * Identifies which KickPredict competition code matches the tournament.
 * Supports: PL, PD, BL1, SA, FL1, CL, TUN
 */
function identifyCompetition(tournament) {
  const name = String(tournament.name || '').toLowerCase();
  const country = String(tournament.country || '').toLowerCase();
  const url = String(tournament.url || '').toLowerCase();

  // Premier League (England)
  if (
    url === '/football/england/premier-league/' ||
    (country === 'england' && (name === 'england: premier league' || name.startsWith('england: premier league -')) &&
     !name.includes('cup') && !name.includes('u18') && !name.includes('u21') && !name.includes('2'))
  ) {
    return 'PL';
  }

  // LaLiga (Spain)
  if (
    url === '/football/spain/laliga/' ||
    (country === 'spain' && (name.includes('laliga') || name.includes('la liga')) && !name.includes('laliga2') && !name.includes('2'))
  ) {
    return 'PD';
  }

  // Bundesliga (Germany)
  if (
    url === '/football/germany/bundesliga/' ||
    (country === 'germany' && name.includes('bundesliga') && !name.includes('women') && !name.includes('2.') && !name.includes('u19'))
  ) {
    return 'BL1';
  }

  // Serie A (Italy)
  if (
    url === '/football/italy/serie-a/' ||
    (country === 'italy' && name.includes('serie a') && !name.includes('women') && !name.includes('serie b') && !name.includes('primavera'))
  ) {
    return 'SA';
  }

  // Ligue 1 (France)
  if (
    url === '/football/france/ligue-1/' ||
    (country === 'france' && name.includes('ligue 1') && !name.includes('women') && !name.includes('ligue 2'))
  ) {
    return 'FL1';
  }

  // Champions League (Europe)
  if (
    url.includes('/champions-league/') ||
    (name.includes('champions league') && (country === 'europe' || url.includes('/europe/')) && !name.includes('women') && !name.includes('caf') && !name.includes('afc') && !name.includes('concacaf'))
  ) {
    return 'CL';
  }

  // Tunisian Ligue Professionnelle 1
  if (
    url.includes('/tunisia/ligue-professionnelle-1/') ||
    (country === 'tunisia' && (name.includes('ligue professionnelle 1') || name.includes('ligue 1'))) ||
    tournament.tournamentId === 'lfv2BGo7'
  ) {
    return 'TUN';
  }

  return null;
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
      stage: 'REGULAR_SEASON',
      matchday: num,
      key: `MD:${num}`,
      label: `Matchday ${num}`
    };
  }

  return {
    stage: 'REGULAR_SEASON',
    matchday: null,
    key: 'REGULAR_SEASON',
    label: roundStr || 'Matchday'
  };
}

/**
 * Parses Flashscore live match statistics (e.g. Possession, Shots, Fouls, xG).
 */
function parseFlashscoreStats(rawText) {
  if (!rawText) return [];
  const items = [];
  const parts = rawText.split('~SD÷').slice(1);
  for (const p of parts) {
    const fields = {};
    for (const item of p.split('¬')) {
      const idx = item.indexOf('÷');
      if (idx !== -1) fields[item.slice(0, idx)] = item.slice(idx + 1);
    }
    if (fields.SG) {
      items.push({
        name: fields.SG,
        home: fields.SH || '0',
        away: fields.SI || '0'
      });
    }
  }
  return items;
}

/**
 * Parses Flashscore match incidents (goals, cards, substitutions).
 */
function parseFlashscoreIncidents(rawText) {
  if (!rawText) return [];
  const incidents = [];
  const parts = rawText.split('~III÷').slice(1);
  for (const p of parts) {
    const fields = {};
    for (const item of p.split('¬')) {
      const idx = item.indexOf('÷');
      if (idx !== -1) fields[item.slice(0, idx)] = item.slice(idx + 1);
    }
    if (fields.IB || fields.IF) {
      incidents.push({
        minute: fields.IB || '',
        player: fields.IF || '',
        type: fields.IK || 'Incident',
        team: fields.IA === '1' ? 'home' : (fields.IA === '2' ? 'away' : 'neutral'),
        detail: fields.IL || ''
      });
    }
  }
  return incidents;
}

/**
 * Parses Flashscore match lineups.
 */
function parseFlashscoreLineups(rawText) {
  if (!rawText) return null;
  const formationMatches = [...rawText.matchAll(/LD÷([^¬]+)/g)].map((m) => m[1]);
  const playerMatches = [...rawText.matchAll(/LI÷([^¬]+)/g)].map((m) => m[1]);

  return {
    formationHome: formationMatches[0] || null,
    formationAway: formationMatches[1] || null,
    startingHome: playerMatches.slice(0, 11),
    startingAway: playerMatches.slice(11, 22)
  };
}

/**
 * Fetches in-depth live match details (stats, incidents, lineups) for a specific match.
 */
async function fetchMatchLiveDetails(matchRawId, { fetcher = fetch } = {}) {
  if (!matchRawId) return { stats: [], incidents: [], lineups: null };
  const [stText, suiText, liText] = await Promise.allSettled([
    fetchFlashscoreFeed(`df_st_1_${matchRawId}`, { fetcher }),
    fetchFlashscoreFeed(`df_sui_1_${matchRawId}`, { fetcher }),
    fetchFlashscoreFeed(`df_li_1_${matchRawId}`, { fetcher })
  ]);

  return {
    stats: stText.status === 'fulfilled' ? parseFlashscoreStats(stText.value) : [],
    incidents: suiText.status === 'fulfilled' ? parseFlashscoreIncidents(suiText.value) : [],
    lineups: liText.status === 'fulfilled' ? parseFlashscoreLineups(liText.value) : null
  };
}

// In-memory kick-off cache for scheduled fixtures
let scheduledFixturesCache = [];

/**
 * On-Boot Fetch & Midnight Cron Job:
 * 1. Called immediately when server starts (On-Boot).
 * 2. Called every midnight at 00:00 (Africa/Tunis time).
 * 3. Fetches 4-day window (today + 3 days) for all competitions (PL, PD, BL1, SA, FL1, CL, TUN).
 * 4. Calculates Poisson probability points and saves fixtures in PostgreSQL.
 * 5. Makes NO further network calls until next midnight or until live match window.
 */
async function syncFlashscoreSchedule(pool, { fetcher = fetch, daysCount = 4 } = {}) {
  console.log(`[Flashscore Universal Sync] Fetching 4-day fixtures schedule (today + 3 days) for all competitions...`);

  try {
    const allMatchesMap = new Map();

    // Fetch daily feeds for 4 consecutive days (0, 1, 2, 3)
    for (let dayOffset = 0; dayOffset < daysCount; dayOffset++) {
      try {
        const feedText = await fetchFlashscoreFeed(`f_1_${dayOffset}_2_en_1`, { fetcher });
        const tournaments = parseFlashscoreFeed(feedText);

        for (const t of tournaments) {
          const compCode = identifyCompetition(t);
          if (!compCode) continue;

          for (const m of t.matches) {
            if (m.id && !allMatchesMap.has(m.id)) {
              allMatchesMap.set(m.id, { ...m, competitionCode: compCode, tournamentName: t.name });
            }
          }
        }
      } catch (err) {
        console.warn(`[Flashscore Universal Sync] Failed fetching day offset +${dayOffset}:`, err.message);
      }
    }

    const matchesList = Array.from(allMatchesMap.values());
    console.log(`[Flashscore Universal Sync] Discovered ${matchesList.length} fixtures across ${daysCount} days.`);

    // Build Poisson expected ratings from finished matches per competition
    const finishedByComp = {};
    if (pool) {
      try {
        const { rows: dbFinished } = await pool.query(
          `SELECT home_score, away_score, external_id, competition_code
           FROM matches
           WHERE status = 'FINISHED'
             AND home_score IS NOT NULL
             AND away_score IS NOT NULL`
        );
        for (const row of dbFinished) {
          const c = row.competition_code || 'PL';
          if (!finishedByComp[c]) finishedByComp[c] = [];
          finishedByComp[c].push({
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

    const modelsByComp = {};
    for (const [c, finished] of Object.entries(finishedByComp)) {
      modelsByComp[c] = teamRatings(finished);
    }

    let updatedCount = 0;
    const newCache = [];

    for (const m of matchesList) {
      const extId = flashscoreIdToBigInt(m.id);
      if (!Number.isSafeInteger(extId) || !m.AE || !m.AF || !m.AD) {
        continue;
      }

      const kickoffSec = parseInt(m.AD, 10);
      const kickoffIso = new Date(kickoffSec * 1000).toISOString();
      const compCode = m.competitionCode;
      const isTunisia = compCode === 'TUN';

      const homeTeam = isTunisia ? formatTunisianTeam(m.AE) : m.AE.trim();
      const awayTeam = isTunisia ? formatTunisianTeam(m.AF) : m.AF.trim();
      const homeCrest = getFlashscoreCrest(m.OA);
      const awayCrest = getFlashscoreCrest(m.OB);
      const status = mapFlashscoreStatus(m);
      const scores = parseFlashscoreScore(m, status);
      const round = roundInfoFromFlashscore(m);

      const compModel = modelsByComp[compCode] || teamRatings([]);
      const homeIdNum = m.PX ? flashscoreIdToBigInt(m.PX) : extId;
      const awayIdNum = m.PY ? flashscoreIdToBigInt(m.PY) : extId + 1;
      const { lambdaHome, lambdaAway } = matchLambdas(homeIdNum, awayIdNum, compModel);
      const markets = buildMatchMarketsPoints(lambdaHome, lambdaAway);

      newCache.push({
        id: extId,
        rawId: m.id,
        kickoff: kickoffIso,
        competitionCode: compCode,
        status,
        homeTeam,
        awayTeam
      });

      if (pool) {
        await pool.query(
          `INSERT INTO matches (
             external_id, flashscore_id, competition_code, stage, matchday, round_key, round_label,
             home_team, home_crest, away_team, away_crest, utc_date, status,
             home_score, away_score, home_ht, away_ht, home_lambda, away_lambda,
             markets_points, updated_at
           ) VALUES (
             $1, $2, $3, 'REGULAR_SEASON', $4, $5, $6,
             $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18, $19::jsonb, NOW()
           )
           ON CONFLICT (external_id) DO UPDATE SET
             flashscore_id = COALESCE(EXCLUDED.flashscore_id, matches.flashscore_id),
             competition_code = EXCLUDED.competition_code,
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
            m.id,
            compCode,
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
      `[Flashscore Universal Sync] Sync complete: stored ${updatedCount} fixtures in PostgreSQL. Idling until live match window.`
    );
    return matchesList;
  } catch (err) {
    console.error('[Flashscore Universal Sync] Schedule sync error:', err.message);
    return [];
  }
}

let livePollingRunning = false;

/**
 * Smart Live Polling (every 2 minutes):
 * STRICT Gate Condition:
 * 1. Checks local database for any match currently in progress.
 * 2. If NO matches are live:
 *    Silently skips with ZERO network requests.
 * 3. If a match is live:
 *    Fetches live scores, incidents, and stats for that match only, updates database,
 *    and triggers auto-reconciliation and settlement.
 */
async function smartLivePolling(
  pool,
  { settleFinishedMatches, reconcileScoreCorrections, fetcher = fetch } = {}
) {
  if (livePollingRunning) return;
  livePollingRunning = true;

  try {
    // 1. Local Database Gate Condition:
    const { rows: activeMatches } = await pool.query(
      `SELECT id, external_id, flashscore_id, competition_code, home_team, away_team, utc_date, status, home_score, away_score,
              home_ht, away_ht, points_calculated
       FROM matches
       WHERE status IN ('IN_PLAY', 'PAUSED')
          OR (
            status IN ('TIMED', 'SCHEDULED')
            AND utc_date <= NOW()
            AND utc_date >= NOW() - INTERVAL '135 minutes'
          )
       ORDER BY utc_date ASC`
    );

    // If NO matches are live, skip completely with ZERO external network requests!
    if (activeMatches.length === 0) {
      return;
    }

    console.log(
      `[Flashscore Live Polling] Detected ${activeMatches.length} active/live matches in progress. Querying live feed...`
    );

    // 2. Fetch Day 0 feed (all updates for today's active matches)
    const feedText = await fetchFlashscoreFeed('f_1_0_2_en_1', { fetcher });
    const tournaments = parseFlashscoreFeed(feedText);

    // Index all matches from today's feed
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

    for (const match of activeMatches) {
      try {
        const bigIntId = Number(match.external_id);
        const m = feedMatchesMap.get(bigIntId) || feedMatchesMap.get(match.flashscore_id);
        if (!m) continue;

        const newStatus = mapFlashscoreStatus(m);
        const scores = parseFlashscoreScore(m, newStatus);

        const statusChanged = match.status !== newStatus;
        const scoreChanged =
          (scores.home !== null && scores.home !== match.home_score) ||
          (scores.away !== null && scores.away !== match.away_score);

        // Fetch detailed stats, incidents, and lineups specifically for this active match
        const details = await fetchMatchLiveDetails(m.id, { fetcher });

        if (statusChanged || scoreChanged || details.stats.length > 0 || details.incidents.length > 0) {
          await pool.query(
            `UPDATE matches
             SET status = $1,
                 home_score = COALESCE($2, home_score),
                 away_score = COALESCE($3, away_score),
                 home_ht = COALESCE($4, home_ht),
                 away_ht = COALESCE($5, away_ht),
                 match_stats = COALESCE($6::jsonb, match_stats),
                 match_incidents = COALESCE($7::jsonb, match_incidents),
                 match_lineups = COALESCE($8::jsonb, match_lineups),
                 updated_at = NOW()
             WHERE id = $9`,
            [
              newStatus,
              scores.home,
              scores.away,
              scores.homeHt,
              scores.awayHt,
              details.stats.length > 0 ? JSON.stringify(details.stats) : null,
              details.incidents.length > 0 ? JSON.stringify(details.incidents) : null,
              details.lineups ? JSON.stringify(details.lineups) : null,
              match.id
            ]
          );

          if (statusChanged || scoreChanged) {
            updatedMatchRows.push({
              external_id: match.external_id,
              competition_code: match.competition_code,
              home_score: scores.home,
              away_score: scores.away,
              home_ht: scores.homeHt,
              away_ht: scores.awayHt,
              status: newStatus
            });
          }
        }
      } catch (err) {
        console.error(`[Flashscore Live Polling] Failed updating match ${match.external_id}:`, err.message);
      }
    }

    if (updatedMatchRows.length > 0) {
      console.log(`[Flashscore Live Polling] Updated ${updatedMatchRows.length} matches with live data.`);
      if (typeof reconcileScoreCorrections === 'function') {
        await reconcileScoreCorrections(updatedMatchRows);
      }
      if (typeof settleFinishedMatches === 'function') {
        await settleFinishedMatches();
      }
    }
  } catch (err) {
    console.error('[Flashscore Live Polling] Error:', err.message);
  } finally {
    livePollingRunning = false;
  }
}

/**
 * Ensures required database columns exist for Flashscore sync.
 */
async function ensureFlashscoreColumns(pool) {
  try {
    await pool.query(`
      ALTER TABLE matches
        ADD COLUMN IF NOT EXISTS flashscore_id VARCHAR(32),
        ADD COLUMN IF NOT EXISTS match_stats JSONB,
        ADD COLUMN IF NOT EXISTS match_incidents JSONB,
        ADD COLUMN IF NOT EXISTS match_lineups JSONB;

      CREATE INDEX IF NOT EXISTS idx_matches_flashscore_id ON matches(flashscore_id);
    `);
  } catch (err) {
    console.warn('[Flashscore] Column verification notice:', err.message);
  }
}

/**
 * Initializes the unified Universal Flashscore Sync provider for ALL competitions:
 * 1. Immediate On-Boot Fetch of 4-day fixtures schedule.
 * 2. Midnight Cron Job (00:00 Africa/Tunis time) daily.
 * 3. Smart Live Polling every 2 minutes with local database gate.
 */
function initFlashscoreSync({ pool, cron, settleFinishedMatches, reconcileScoreCorrections }) {
  console.log('[Flashscore] Initialized Universal provider for all competitions (On-Boot + Midnight Cron + Smart 2m Polling).');

  // 1. Immediate On-Boot Fetch (Server Start)
  (async () => {
    try {
      await ensureFlashscoreColumns(pool);
      await syncFlashscoreSchedule(pool);
    } catch (err) {
      console.error('[Flashscore] On-Boot fetch error:', err.message);
    }
  })();

  // 2. Midnight Cron Job at 00:00 Africa/Tunis time
  cron.schedule(
    '0 0 * * *',
    () => {
      console.log('[Flashscore] Midnight Cron Job triggered: refreshing 4-day fixtures schedule for all leagues...');
      syncFlashscoreSchedule(pool).catch((err) => {
        console.error('[Flashscore] Midnight Cron error:', err.message);
      });
    },
    { timezone: 'Africa/Tunis' }
  );

  // 3. Smart Live Polling every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    smartLivePolling(pool, { settleFinishedMatches, reconcileScoreCorrections }).catch((err) => {
      console.error('[Flashscore Live Polling] Scheduled cycle error:', err.message);
    });
  });

  console.log('[Flashscore] Active: Midnight Cron (00:00 Africa/Tunis) & Smart Polling (2m gate).');
}

module.exports = {
  initFlashscoreSync,
  syncFlashscoreSchedule,
  smartLivePolling,
  fetchFlashscoreFeed,
  parseFlashscoreFeed,
  parseFlashscoreStats,
  parseFlashscoreIncidents,
  parseFlashscoreLineups,
  fetchMatchLiveDetails,
  flashscoreIdToBigInt,
  bigIntToFlashscoreId,
  identifyCompetition,
  mapFlashscoreStatus,
  parseFlashscoreScore,
  roundInfoFromFlashscore,
  getFlashscoreCrest,
  formatTunisianTeam,
  ensureFlashscoreColumns,
  // Aliases for backward compatibility
  syncTunisianLeague: syncFlashscoreSchedule,
  smartPollTunisia: smartLivePolling,
  initTunisiaSync: initFlashscoreSync
};
