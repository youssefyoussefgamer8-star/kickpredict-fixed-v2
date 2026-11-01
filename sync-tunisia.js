'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { teamRatings, matchLambdas, buildMatchMarketsPoints } = require('./pricingEngine');

// 365Scores Competition ID for Tunisian Ligue Professionnelle 1: 554
const COMPETITION_ID = Number(process.env.TUNISIA_365SCORES_COMPETITION_ID || 554);
const BASE_URL = 'https://webws.365scores.com/web/games';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * Returns Cloudinary CDN URL for 365Scores competitor team crest.
 */
function get365ScoresCrest(competitorId) {
  if (!competitorId) return null;
  return `https://imagecache.365scores.com/image/upload/f_png,w_80,h_80,c_limit,q_auto:best/competitors/${competitorId}`;
}

/**
 * Fetches games directly from 365Scores public web API (Arabic langId=27).
 * Types: 'current' (live & upcoming) or 'results' (recently finished)
 */
async function fetch365ScoresGames(
  endpointType = 'current',
  { fetcher = fetch, langId = 27, competitionId = COMPETITION_ID } = {}
) {
  const url = `${BASE_URL}/${endpointType}/?appTypeId=5&langId=${langId}&timezoneName=Africa/Tunis&competitions=${competitionId}`;
  const res = await fetcher(url, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': 'application/json, text/plain, */*'
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!res.ok) {
    throw new Error(`365Scores HTTP ${res.status} (${res.statusText}) on ${endpointType}`);
  }

  const data = await res.json();
  return Array.isArray(data?.games) ? data.games : [];
}

/**
 * Maps 365Scores game status and text to KickPredict internal status:
 *   - SCHEDULED
 *   - IN_PLAY
 *   - PAUSED
 *   - FINISHED
 *   - POSTPONED
 *   - CANCELLED
 */
function map365ScoresStatus(game) {
  if (!game) return 'SCHEDULED';

  const group = Number(game.statusGroup ?? game.code);
  const statusText = String(game.statusText || game.description || '').toLowerCase();
  const shortText = String(game.shortStatusText || '').toLowerCase();
  const type = String(game.type || '').toLowerCase();

  // Check for postponed / cancelled textual keywords (Arabic & English)
  if (
    statusText.includes('تأجلت') ||
    statusText.includes('تأجيل') ||
    statusText.includes('postponed') ||
    shortText.includes('تأجلت') ||
    shortText.includes('postp') ||
    type === 'postponed' ||
    group === 60
  ) {
    return 'POSTPONED';
  }

  if (
    statusText.includes('ألغيت') ||
    statusText.includes('إلغاء') ||
    statusText.includes('cancelled') ||
    statusText.includes('canceled') ||
    shortText.includes('ألغيت') ||
    type === 'canceled' ||
    type === 'cancelled' ||
    group === 70
  ) {
    return 'CANCELLED';
  }

  // Check for halftime / paused
  if (
    group === 1 ||
    group === 7 ||
    statusText.includes('استراحة') ||
    statusText.includes('halftime') ||
    shortText.includes('ht') ||
    shortText.includes('استراحة')
  ) {
    return 'PAUSED';
  }

  // 365Scores statusGroup mapping
  switch (group) {
    case 1: // Halftime / Break ("استراحة")
      return 'PAUSED';
    case 2: // Not started ("لم تبدأ")
      return 'SCHEDULED';
    case 3: // In play / Live ("شوط 1", "شوط 2")
      return 'IN_PLAY';
    case 4: // Finished ("انتهت")
      return 'FINISHED';
    case 5: // Suspended / Cancelled / Postponed
      return 'POSTPONED';
    default:
      if (type === 'finished' || group === 100 || statusText.includes('انتهت') || statusText.includes('ended')) {
        return 'FINISHED';
      }
      if (type === 'inprogress' || statusText.includes('شوط') || statusText.includes('live')) {
        return 'IN_PLAY';
      }
      return 'SCHEDULED';
  }
}

/**
 * Extracts scores and half-time scores from 365Scores game objects.
 * Supports both full game objects and direct (homeScore, awayScore, status) parameters.
 */
function parse365ScoresScore(gameOrHomeScore, awayScoreOrStatus, statusParam) {
  if (gameOrHomeScore === null || gameOrHomeScore === undefined) {
    return { home: null, away: null, homeHt: null, awayHt: null };
  }

  // Check if input is a 365Scores game object
  if (typeof gameOrHomeScore === 'object' && ('homeCompetitor' in gameOrHomeScore || 'statusGroup' in gameOrHomeScore)) {
    const game = gameOrHomeScore;
    const status = awayScoreOrStatus || map365ScoresStatus(game);
    const isLiveOrFinished = status === 'IN_PLAY' || status === 'PAUSED' || status === 'FINISHED';

    let homeScore = null;
    let awayScore = null;

    const rawHome = game.homeCompetitor?.score;
    const rawAway = game.awayCompetitor?.score;

    if (isLiveOrFinished) {
      if (typeof rawHome === 'number' && rawHome >= 0) {
        homeScore = rawHome;
      }
      if (typeof rawAway === 'number' && rawAway >= 0) {
        awayScore = rawAway;
      }
    }

    let homeHt = null;
    let awayHt = null;
    if (Array.isArray(game.stages)) {
      const htStage = game.stages.find(
        (s) => s.id === 7 || s.name === 'First Half' || s.name === 'شوط 1' || s.stageNum === 1
      );
      if (htStage) {
        if (typeof htStage.homeCompetitorScore === 'number' && htStage.homeCompetitorScore >= 0) {
          homeHt = htStage.homeCompetitorScore;
        }
        if (typeof htStage.awayCompetitorScore === 'number' && htStage.awayCompetitorScore >= 0) {
          awayHt = htStage.awayCompetitorScore;
        }
      }
    }

    return { home: homeScore, away: awayScore, homeHt, awayHt };
  }

  // Handle direct (homeScore, awayScore, status) or SofaScore-like score object signatures
  const homeArg = gameOrHomeScore;
  const awayArg = awayScoreOrStatus;
  const status = statusParam;
  const isLiveOrFinished = status === 'IN_PLAY' || status === 'PAUSED' || status === 'FINISHED';

  const extractVal = (arg) => {
    if (typeof arg === 'number') return arg >= 0 ? arg : null;
    if (arg && typeof arg === 'object') {
      const val = arg.current ?? arg.display ?? arg.normaltime;
      return typeof val === 'number' && val >= 0 ? val : null;
    }
    return null;
  };

  const extractPeriod1 = (arg) => {
    if (arg && typeof arg === 'object' && typeof arg.period1 === 'number' && arg.period1 >= 0) {
      return arg.period1;
    }
    return null;
  };

  const home = isLiveOrFinished ? extractVal(homeArg) : null;
  const away = isLiveOrFinished ? extractVal(awayArg) : null;
  const homeHt = isLiveOrFinished ? extractPeriod1(homeArg) : null;
  const awayHt = isLiveOrFinished ? extractPeriod1(awayArg) : null;

  return { home, away, homeHt, awayHt };
}

/**
 * Extracts round and matchday information from a 365Scores game.
 */
function roundInfoFrom365Scores(game) {
  const roundNum = Number(game?.roundNum ?? game?.roundInfo?.round);
  if (Number.isInteger(roundNum) && roundNum > 0) {
    const roundPrefix = (game?.roundName && String(game.roundName).trim()) || 'الجولة';
    return {
      matchday: roundNum,
      key: `MD:${roundNum}`,
      label: `${roundPrefix} ${roundNum}`.trim()
    };
  }

  const roundName = game?.roundName || game?.roundInfo?.name;
  if (roundName && typeof roundName === 'string') {
    return {
      matchday: null,
      key: roundName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
      label: roundName.trim()
    };
  }

  const stageNum = Number(game?.stageNum) || 1;
  return {
    matchday: null,
    key: `STAGE_${stageNum}`,
    label: 'الجولة'
  };
}

/**
 * Full fixture schedule & Poisson ratings sync from 365Scores:
 * 1. Queries both 'current' and 'results' endpoints for Competition 554 in Arabic.
 * 2. Deduplicates matches by unique game id.
 * 3. Builds Poisson probability ratings from finished matches.
 * 4. Upserts matches into PostgreSQL matches table with native Arabic team names.
 */
async function syncTunisianLeague(pool, { fetcher = fetch } = {}) {
  console.log(`[Tunisia 365Scores] Fetching fixtures & results for Competition ID ${COMPETITION_ID}...`);

  try {
    const [currentRes, resultsRes] = await Promise.allSettled([
      fetch365ScoresGames('current', { fetcher }),
      fetch365ScoresGames('results', { fetcher })
    ]);

    const currentGames = currentRes.status === 'fulfilled' ? currentRes.value : [];
    const resultsGames = resultsRes.status === 'fulfilled' ? resultsRes.value : [];

    if (currentRes.status === 'rejected') {
      console.warn('[Tunisia 365Scores] Current games fetch warning:', currentRes.reason?.message);
    }
    if (resultsRes.status === 'rejected') {
      console.warn('[Tunisia 365Scores] Results games fetch warning:', resultsRes.reason?.message);
    }

    const gamesMap = new Map();
    for (const g of resultsGames) {
      if (g && g.id) gamesMap.set(g.id, g);
    }
    for (const g of currentGames) {
      if (g && g.id) gamesMap.set(g.id, g);
    }

    const allGames = Array.from(gamesMap.values());
    console.log(
      `[Tunisia 365Scores] Extracted ${resultsGames.length} finished/past games and ${currentGames.length} current/upcoming games (${allGames.length} unique).`
    );

    if (allGames.length === 0) {
      console.warn('[Tunisia 365Scores] No games returned from 365Scores API. Preserving existing database records.');
      return;
    }

    // Build model ratings from finished games
    const finishedForModel = allGames
      .filter((g) => {
        const st = map365ScoresStatus(g);
        return (
          st === 'FINISHED' &&
          typeof g.homeCompetitor?.score === 'number' &&
          g.homeCompetitor.score >= 0 &&
          typeof g.awayCompetitor?.score === 'number' &&
          g.awayCompetitor.score >= 0 &&
          g.homeCompetitor?.id &&
          g.awayCompetitor?.id
        );
      })
      .map((g) => ({
        homeId: Number(g.homeCompetitor.id),
        awayId: Number(g.awayCompetitor.id),
        homeGoals: Number(g.homeCompetitor.score),
        awayGoals: Number(g.awayCompetitor.score)
      }));

    if (pool && finishedForModel.length < 4) {
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
        // Fallback to internal model defaults if query fails
      }
    }

    const model = teamRatings(finishedForModel);
    console.log(`[Tunisia 365Scores] Calculated Poisson ratings from ${finishedForModel.length} finished fixtures.`);

    let updatedCount = 0;
    for (const g of allGames) {
      const extId = Number(g.id);
      const homeTeam = g.homeCompetitor;
      const awayTeam = g.awayCompetitor;

      if (!Number.isSafeInteger(extId) || !homeTeam?.name || !awayTeam?.name || !g.startTime) {
        continue;
      }

      const round = roundInfoFrom365Scores(g);
      const status = map365ScoresStatus(g);
      const scores = parse365ScoresScore(g, status);
      const { lambdaHome, lambdaAway } = matchLambdas(Number(homeTeam.id), Number(awayTeam.id), model);
      const markets = buildMatchMarketsPoints(lambdaHome, lambdaAway);
      const kickoff = new Date(g.startTime).toISOString();

      const homeCrest = get365ScoresCrest(homeTeam.id);
      const awayCrest = get365ScoresCrest(awayTeam.id);

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
          homeTeam.name || homeTeam.symbolicName,
          homeCrest,
          awayTeam.name || awayTeam.symbolicName,
          awayCrest,
          kickoff,
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
    console.log(`[Tunisia 365Scores] Processed ${updatedCount} fixtures from 365Scores into PostgreSQL.`);
  } catch (err) {
    console.error('[Tunisia 365Scores] Schedule sync error:', err.message);
  }
}

let smartPollRunning = false;

/**
 * Smart Polling for Tunisian League live matches:
 * Runs every 2 minutes, BUT checks the database first:
 * - Only queries 365Scores if there is an active match (IN_PLAY, PAUSED)
 *   OR a match scheduled within the active window (kickoff - 10m to kickoff + 135m).
 * - If no active matches exist, 0 HTTP requests are made.
 * - When active matches exist, sends EXACTLY ONE aggregated batch query to 365Scores 'current'
 *   updating all concurrent fixtures simultaneously.
 */
async function smartPollTunisia(
  pool,
  { settleFinishedMatches, reconcileScoreCorrections, fetcher = fetch } = {}
) {
  if (smartPollRunning) return;
  smartPollRunning = true;

  try {
    // 1. Check database for active or upcoming Tunisian matches
    const { rows: activeMatches } = await pool.query(
      `SELECT id, external_id, home_team, away_team, utc_date, status, home_score, away_score,
              home_ht, away_ht, points_calculated
       FROM matches
       WHERE competition_code IN ('TUN', 'TU1')
         AND (
           status IN ('IN_PLAY', 'PAUSED')
           OR (
             status IN ('TIMED', 'SCHEDULED')
             AND utc_date <= NOW() + INTERVAL '10 minutes'
             AND utc_date >= NOW() - INTERVAL '135 minutes'
           )
         )
       ORDER BY utc_date ASC`
    );

    // If no matches are live or kicking off, stop immediately without making any HTTP calls!
    if (activeMatches.length === 0) {
      return;
    }

    console.log(
      `[Tunisia 365Scores Smart Polling] Detected ${activeMatches.length} active/upcoming matches. Executing single aggregated batch query...`
    );

    const currentGames = await fetch365ScoresGames('current', { fetcher });

    if (!currentGames.length) {
      console.log('[Tunisia 365Scores Smart Polling] 0 games returned from current endpoint.');
      return;
    }

    // Index all games by external_id (as string & number for robust matching)
    const gamesMap = new Map();
    for (const g of currentGames) {
      if (g && g.id !== undefined && g.id !== null) {
        gamesMap.set(String(g.id), g);
        gamesMap.set(Number(g.id), g);
      }
    }

    const updatedMatchRows = [];

    // Process all active matches in memory from the single batch response
    for (const match of activeMatches) {
      try {
        const g = gamesMap.get(String(match.external_id)) || gamesMap.get(Number(match.external_id));
        if (!g) continue;

        const newStatus = map365ScoresStatus(g);
        const scores = parse365ScoresScore(g, newStatus);

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
        console.error(`[Tunisia 365Scores Smart Polling] Failed updating match ${match.external_id}:`, err.message);
      }
    }

    if (updatedMatchRows.length > 0) {
      console.log(`[Tunisia 365Scores Smart Polling] Updated ${updatedMatchRows.length} Tunisian matches in batch.`);
      if (typeof reconcileScoreCorrections === 'function') {
        await reconcileScoreCorrections(updatedMatchRows);
      }
      if (typeof settleFinishedMatches === 'function') {
        await settleFinishedMatches();
      }
    }
  } catch (err) {
    console.error('[Tunisia 365Scores Smart Polling] Batch polling error:', err.message);
  } finally {
    smartPollRunning = false;
  }
}

/**
 * Purges legacy or obsolete Tunisian matches from PostgreSQL.
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
      console.log(`[Tunisia 365Scores] Purged ${res.rowCount} legacy Tunisian matches and ${boostRes.rowCount} boosts from PostgreSQL.`);
    }
    return { deletedMatches: res.rowCount, deletedBoosts: boostRes.rowCount };
  } catch (err) {
    console.warn('[Tunisia 365Scores] Purge query warning:', err.message);
    return { deletedMatches: 0, deletedBoosts: 0 };
  }
}

/**
 * Initializes Tunisia background synchronization via 365Scores:
 * 1. Purges legacy records and runs full schedule sync on boot.
 * 2. Schedules daily full sync at 06:00 UTC.
 * 3. Schedules smart polling every 2 minutes.
 */
function initTunisiaSync({ pool, cron, settleFinishedMatches, reconcileScoreCorrections }) {
  console.log(
    `[Tunisia 365Scores] Initialized provider for Competition ID ${COMPETITION_ID} (Public 365Scores API, Arabic langId=27, zero API keys required).`
  );

  // 1. Initial schedule sync on startup
  (async () => {
    try {
      await purgeLegacyTunisiaMatches(pool);
      await syncTunisianLeague(pool);
    } catch (err) {
      console.error('[Tunisia 365Scores] Initial startup sync error:', err.message);
    }
  })();

  // 2. Daily schedule sync at 06:00 UTC
  cron.schedule('0 6 * * *', () => {
    console.log('[Tunisia 365Scores] Running scheduled daily fixture refresh...');
    syncTunisianLeague(pool).catch((err) => {
      console.error('[Tunisia 365Scores] Daily refresh error:', err.message);
    });
  });

  // 3. Smart polling every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    smartPollTunisia(pool, { settleFinishedMatches, reconcileScoreCorrections }).catch((err) => {
      console.error('[Tunisia 365Scores Smart Polling] Scheduled cycle error:', err.message);
    });
  });

  console.log('[Tunisia 365Scores] Smart polling scheduled (every 2m with conditional database gate).');
}

module.exports = {
  syncTunisianLeague,
  smartPollTunisia,
  initTunisiaSync,
  purgeLegacyTunisiaMatches,
  fetch365ScoresGames,
  map365ScoresStatus,
  parse365ScoresScore,
  roundInfoFrom365Scores,
  get365ScoresCrest,
  COMPETITION_ID,
  BASE_URL,
  // Aliases for backwards compatibility
  mapSofaScoreStatus: map365ScoresStatus,
  parseSofaScoreScore: parse365ScoresScore,
  roundInfoFromSofaScore: roundInfoFrom365Scores
};

// Standalone execution support: node sync-tunisia.js
if (require.main === module) {
  const cliPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  syncTunisianLeague(cliPool)
    .catch((error) => {
      console.error('[Tunisia 365Scores] Failed:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await cliPool.end();
    });
}
