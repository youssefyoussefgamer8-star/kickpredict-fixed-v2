'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { teamRatings, matchLambdas, buildMatchMarketsPoints } = require('./pricingEngine');

const API_KEY = (process.env.API_FOOTBALL_KEY || '').trim();
const LEAGUE_ID = Number(process.env.TUNISIA_LEAGUE_ID || 202);
const now = new Date();
const CURRENT_SEASON = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const SEASON = Number(process.env.TUNISIA_SEASON || CURRENT_SEASON);

function isApiKeyConfigured() {
  return Boolean(process.env.API_FOOTBALL_KEY && process.env.API_FOOTBALL_KEY.trim());
}

function mapStatus(short) {
  if (['FT', 'AET', 'PEN'].includes(short)) return 'FINISHED';
  if (['1H', '2H', 'ET', 'P', 'LIVE'].includes(short)) return 'IN_PLAY';
  if (short === 'HT') return 'PAUSED';
  if (['PST', 'ABD', 'INT'].includes(short)) return 'POSTPONED';
  if (['CANC', 'WO'].includes(short)) return 'CANCELLED';
  return 'SCHEDULED';
}

function matchdayFromRound(round) {
  const text = String(round || '');
  const found = /(?:regular\s+season\s*[-:]?\s*)?(\d+)/i.exec(text);
  return found ? Number(found[1]) : null;
}

/**
 * Full fixture schedule & Poisson ratings sync from API-Football.
 * Typically runs once on boot and once daily (at 06:00 UTC).
 */
async function syncTunisianLeague(pool) {
  const apiKey = (process.env.API_FOOTBALL_KEY || '').trim();
  if (!apiKey) {
    console.warn('[Tunisia Sync] API_FOOTBALL_KEY is not configured in .env. Skipping full Tunisia sync.');
    return;
  }
  if (!Number.isInteger(SEASON) || SEASON < 2000) {
    console.error('[Tunisia Sync] TUNISIA_SEASON must be a valid season year.');
    return;
  }

  const url = new URL('https://v3.football.api-sports.io/fixtures');
  url.searchParams.set('league', String(LEAGUE_ID));
  url.searchParams.set('season', String(SEASON));
  console.log(`[Tunisia Sync] Loading league ${LEAGUE_ID}, season ${SEASON}...`);

  const response = await fetch(url, {
    headers: { 'x-apisports-key': apiKey },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    console.error(`[Tunisia Sync] API-Football returned HTTP ${response.status}.`);
    return;
  }

  const payload = await response.json();
  const apiErrors = payload.errors;
  const hasErrors = Array.isArray(apiErrors)
    ? apiErrors.length > 0
    : apiErrors && typeof apiErrors === 'object' && Object.keys(apiErrors).length > 0;
  if (hasErrors) {
    console.error(`[Tunisia Sync] API-Football error: ${JSON.stringify(apiErrors)}`);
    return;
  }

  const fixtures = Array.isArray(payload.response) ? payload.response : [];
  if (!fixtures.length) {
    console.warn('[Tunisia Sync] No fixtures returned. No database rows were changed.');
    return;
  }

  const teamKey = (team) => (team && team.id != null ? String(team.id) : String(team?.name || ''));
  const finishedForModel = fixtures
    .filter((f) => ['FT', 'AET', 'PEN'].includes(f.fixture?.status?.short))
    .map((f) => ({
      homeId: teamKey(f.teams?.home),
      awayId: teamKey(f.teams?.away),
      homeGoals: f.score?.fulltime?.home,
      awayGoals: f.score?.fulltime?.away
    }))
    .filter((m) => m.homeId && m.awayId && Number.isInteger(m.homeGoals) && Number.isInteger(m.awayGoals));
  const model = teamRatings(finishedForModel);
  console.log(`[Tunisia Sync] Building team ratings from ${finishedForModel.length} finished fixtures.`);

  let updatedCount = 0;
  for (const fixture of fixtures) {
    const id = Number(fixture.fixture?.id);
    const homeTeam = fixture.teams?.home;
    const awayTeam = fixture.teams?.away;
    const kickoff = fixture.fixture?.date;
    if (!Number.isSafeInteger(id) || !homeTeam?.name || !awayTeam?.name || !kickoff) continue;

    const roundLabel = String(fixture.league?.round || 'Regular Season');
    const matchday = matchdayFromRound(roundLabel);
    const roundKey = matchday ? `MD:${matchday}` : roundLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 64);
    const status = mapStatus(fixture.fixture?.status?.short);
    const fullTime = fixture.score?.fulltime;
    const homeScore = status === 'FINISHED' ? (fullTime?.home ?? null) : null;
    const awayScore = status === 'FINISHED' ? (fullTime?.away ?? null) : null;
    const homeHt = fixture.score?.halftime?.home ?? null;
    const awayHt = fixture.score?.halftime?.away ?? null;
    const { lambdaHome: homeLambda, lambdaAway: awayLambda } = matchLambdas(
      teamKey(homeTeam),
      teamKey(awayTeam),
      model
    );
    const markets = buildMatchMarketsPoints(homeLambda, awayLambda);

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
        id,
        matchday,
        roundKey,
        roundLabel,
        homeTeam.shortName || homeTeam.name,
        homeTeam.logo || null,
        awayTeam.shortName || awayTeam.name,
        awayTeam.logo || null,
        kickoff,
        status,
        homeScore,
        awayScore,
        homeHt,
        awayHt,
        homeLambda,
        awayLambda,
        JSON.stringify(markets)
      ]
    );
    updatedCount++;
  }
  console.log(`[Tunisia Sync] Processed ${updatedCount} fixtures from API-Football. No rows bulk-deleted.`);
}

let smartPollRunning = false;

/**
 * Smart Polling for Tunisian League live matches:
 * Runs every 2 minutes, BUT checks the database first:
 * - Only queries API-Football if there is a match in play (IN_PLAY, PAUSED)
 *   OR a scheduled match within the kickoff window (kickoff - 10m to kickoff + 135m).
 * - If no active matches exist, 0 API calls are made, completely conserving the 100/day free quota.
 */
async function smartPollTunisia(pool, { settleFinishedMatches, reconcileScoreCorrections } = {}) {
  const apiKey = (process.env.API_FOOTBALL_KEY || '').trim();
  if (!apiKey) return;
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

    // If no matches are live or kicking off, stop immediately without making an HTTP request!
    if (activeMatches.length === 0) {
      // 0 API requests consumed
      return;
    }

    console.log(`[Tunisia Smart Polling] Detected ${activeMatches.length} active/upcoming matches. Fetching live status...`);

    const fixtureIds = activeMatches
      .map((m) => m.external_id)
      .filter((id) => Number.isSafeInteger(Number(id)))
      .slice(0, 20); // API-Football allows up to 20 IDs per call

    if (fixtureIds.length === 0) return;

    const url = new URL('https://v3.football.api-sports.io/fixtures');
    url.searchParams.set('ids', fixtureIds.join('-'));

    const response = await fetch(url, {
      headers: { 'x-apisports-key': apiKey },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      console.error(`[Tunisia Smart Polling] API-Football returned HTTP ${response.status}.`);
      return;
    }

    const payload = await response.json();
    const fixtures = Array.isArray(payload.response) ? payload.response : [];
    const updatedMatchRows = [];

    for (const fixture of fixtures) {
      const extId = Number(fixture.fixture?.id);
      const dbMatch = activeMatches.find((r) => Number(r.external_id) === extId);
      if (!dbMatch) continue;

      const newStatus = mapStatus(fixture.fixture?.status?.short);
      const fullTime = fixture.score?.fulltime;
      const goals = fixture.goals;

      // Extract current live scores
      const homeScore =
        newStatus === 'FINISHED' || newStatus === 'IN_PLAY' || newStatus === 'PAUSED'
          ? (fullTime?.home ?? goals?.home ?? null)
          : null;
      const awayScore =
        newStatus === 'FINISHED' || newStatus === 'IN_PLAY' || newStatus === 'PAUSED'
          ? (fullTime?.away ?? goals?.away ?? null)
          : null;
      const homeHt = fixture.score?.halftime?.home ?? null;
      const awayHt = fixture.score?.halftime?.away ?? null;

      const statusChanged = dbMatch.status !== newStatus;
      const scoreChanged =
        (homeScore !== null && homeScore !== dbMatch.home_score) ||
        (awayScore !== null && awayScore !== dbMatch.away_score);

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
          [newStatus, homeScore, awayScore, homeHt, awayHt, dbMatch.id]
        );

        updatedMatchRows.push({
          external_id: dbMatch.external_id,
          competition_code: 'TUN',
          home_score: homeScore,
          away_score: awayScore,
          home_ht: homeHt,
          away_ht: awayHt,
          status: newStatus
        });
      }
    }

    if (updatedMatchRows.length > 0) {
      console.log(`[Tunisia Smart Polling] Updated ${updatedMatchRows.length} Tunisian matches.`);
      if (typeof reconcileScoreCorrections === 'function') {
        await reconcileScoreCorrections(updatedMatchRows);
      }
      if (typeof settleFinishedMatches === 'function') {
        await settleFinishedMatches();
      }
    }
  } catch (err) {
    console.error('[Tunisia Smart Polling] Error:', err.message);
  } finally {
    smartPollRunning = false;
  }
}

/**
 * Initializes Tunisia background synchronization:
 * 1. Runs full schedule sync on boot if API key is present.
 * 2. Schedules daily full sync at 06:00 UTC.
 * 3. Schedules smart polling every 2 minutes.
 */
function initTunisiaSync({ pool, cron, settleFinishedMatches, reconcileScoreCorrections }) {
  if (!isApiKeyConfigured()) {
    console.log('[Tunisia Sync] API_FOOTBALL_KEY not set. Smart polling paused until key is added to .env.');
    return;
  }

  console.log(`[Tunisia Sync] API-Football provider initialized for League ${LEAGUE_ID}, Season ${SEASON}.`);

  // 1. Initial schedule sync on startup
  syncTunisianLeague(pool).catch((err) => {
    console.error('[Tunisia Sync] Initial startup sync error:', err.message);
  });

  // 2. Daily schedule sync at 06:00 UTC
  cron.schedule('0 6 * * *', () => {
    console.log('[Tunisia Sync] Running scheduled daily fixture refresh...');
    syncTunisianLeague(pool).catch((err) => {
      console.error('[Tunisia Sync] Daily refresh error:', err.message);
    });
  });

  // 3. Smart polling every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    smartPollTunisia(pool, { settleFinishedMatches, reconcileScoreCorrections }).catch((err) => {
      console.error('[Tunisia Smart Polling] Scheduled cycle error:', err.message);
    });
  });

  console.log('[Tunisia Sync] Smart polling scheduled (every 2m with conditional database gate).');
}

module.exports = {
  syncTunisianLeague,
  smartPollTunisia,
  initTunisiaSync,
  isApiKeyConfigured,
  LEAGUE_ID,
  SEASON
};

// Standalone execution support: node sync-tunisia.js
if (require.main === module) {
  const cliPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  syncTunisianLeague(cliPool)
    .catch((error) => {
      console.error('[Tunisia Sync] Failed:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await cliPool.end();
    });
}
