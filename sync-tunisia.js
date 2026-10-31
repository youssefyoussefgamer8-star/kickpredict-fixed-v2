'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { teamRatings, matchLambdas, buildMatchMarketsPoints } = require('./pricingEngine');

// SofaScore Unique Tournament ID for Tunisian Ligue Professionnelle 1: 984
const TOURNAMENT_ID = Number(process.env.SOFASCORE_TOURNAMENT_ID || 984);
const BASE_URL = (process.env.SOFASCORE_BASE_URL || 'https://api.sofascore.com/api/v1').replace(/\/+$/, '');

// Pool of modern desktop & mobile User-Agents to randomize request signatures
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getSofaHeaders() {
  return {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.sofascore.com/',
    'Origin': 'https://www.sofascore.com',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Cache-Control': 'max-age=0'
  };
}

let proxyDispatcher = null;
const proxyUrl = process.env.SOFA_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  try {
    const { ProxyAgent } = require('undici');
    proxyDispatcher = new ProxyAgent(proxyUrl);
    console.log(`[Tunisia SofaScore] Proxy configured: ${proxyUrl.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@')}`);
  } catch (err) {
    console.warn('[Tunisia SofaScore] Failed to initialize ProxyAgent:', err.message);
  }
}

async function sofaFetch(path) {
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const options = {
    headers: getSofaHeaders(),
    signal: AbortSignal.timeout(25000)
  };
  if (proxyDispatcher) {
    options.dispatcher = proxyDispatcher;
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`SofaScore HTTP ${res.status} (${res.statusText}) on ${url}`);
  }
  return res.json();
}

/**
 * Maps SofaScore status structure to KickPredict internal status:
 * IN_PLAY, PAUSED, FINISHED, SCHEDULED, POSTPONED, CANCELLED
 */
function mapSofaScoreStatus(status) {
  if (!status) return 'SCHEDULED';
  const type = String(status.type || '').toLowerCase();
  const desc = String(status.description || '').toLowerCase();
  const code = Number(status.code);

  // Finished states (Ended, AET, AP, etc.)
  if (type === 'finished' || code === 100 || code === 110 || code === 120 || desc.includes('ended')) {
    return 'FINISHED';
  }
  // Halftime / Paused states
  if (desc === 'halftime' || code === 7 || desc.includes('pause') || desc.includes('ht')) {
    return 'PAUSED';
  }
  // Ongoing live match states (1st half, 2nd half, extra time, penalties)
  if (
    type === 'inprogress' ||
    code === 6 ||
    code === 31 ||
    code === 41 ||
    code === 50 ||
    desc.includes('half') ||
    desc.includes('extra')
  ) {
    return 'IN_PLAY';
  }
  // Postponed
  if (type === 'postponed' || code === 60 || desc.includes('postponed')) {
    return 'POSTPONED';
  }
  // Cancelled / Abandoned
  if (
    type === 'canceled' ||
    type === 'cancelled' ||
    type === 'abandoned' ||
    code === 70 ||
    desc.includes('cancel') ||
    desc.includes('abandon')
  ) {
    return 'CANCELLED';
  }
  // Not started / Scheduled
  if (type === 'notstarted' || code === 0) {
    return 'SCHEDULED';
  }
  return 'SCHEDULED';
}

/**
 * Extracts scores and half-time scores from SofaScore event objects
 */
function parseSofaScoreScore(homeScoreObj, awayScoreObj, status) {
  const isFinishedOrLive = status === 'FINISHED' || status === 'IN_PLAY' || status === 'PAUSED';
  if (!isFinishedOrLive) {
    return { home: null, away: null, homeHt: null, awayHt: null };
  }

  const home = homeScoreObj?.current ?? homeScoreObj?.display ?? homeScoreObj?.normaltime ?? null;
  const away = awayScoreObj?.current ?? awayScoreObj?.display ?? awayScoreObj?.normaltime ?? null;

  const homeHt = homeScoreObj?.period1 ?? null;
  const awayHt = awayScoreObj?.period1 ?? null;

  return {
    home: home !== null && !isNaN(Number(home)) ? Number(home) : null,
    away: away !== null && !isNaN(Number(away)) ? Number(away) : null,
    homeHt: homeHt !== null && !isNaN(Number(homeHt)) ? Number(homeHt) : null,
    awayHt: awayHt !== null && !isNaN(Number(awayHt)) ? Number(awayHt) : null
  };
}

/**
 * Extracts round information from a SofaScore event
 */
function roundInfoFromSofaScore(event) {
  const round = event.roundInfo?.round;
  if (Number.isInteger(round) && round > 0) {
    return { stage: 'REGULAR_SEASON', matchday: round, key: `MD:${round}`, label: `Matchday ${round}` };
  }
  const name = String(event.roundInfo?.name || 'Regular Season').trim();
  const cleanKey = name.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase() || 'MD_1';
  return { stage: 'REGULAR_SEASON', matchday: null, key: cleanKey, label: name };
}

/**
 * Full fixture schedule & Poisson ratings sync from SofaScore:
 * 1. Fetches tournament seasons.
 * 2. Fetches recent finished fixtures (events/last/0) and upcoming fixtures (events/next/0).
 * 3. Builds Poisson expected-goals ratings.
 * 4. Inserts/updates matches table with 'TUN' competition code.
 */
async function syncTunisianLeague(pool) {
  try {
    console.log(`[Tunisia SofaScore] Querying tournament ${TOURNAMENT_ID} seasons...`);
    const seasonsData = await sofaFetch(`/unique-tournament/${TOURNAMENT_ID}/seasons`);
    const seasons = Array.isArray(seasonsData?.seasons) ? seasonsData.seasons : [];
    if (!seasons.length) {
      console.warn('[Tunisia SofaScore] No seasons returned for tournament 984.');
      return;
    }

    // Default to the first (current/active) season, or match TUNISIA_SEASON year if set
    let selectedSeason = seasons[0];
    if (process.env.TUNISIA_SEASON) {
      const targetYear = String(process.env.TUNISIA_SEASON).trim();
      const matched = seasons.find((s) => String(s.year || s.name || '').includes(targetYear));
      if (matched) selectedSeason = matched;
    }
    const seasonId = selectedSeason.id;
    console.log(`[Tunisia SofaScore] Using Season ${selectedSeason.name || selectedSeason.year} (ID: ${seasonId}).`);

    // Fetch both recent finished events and upcoming scheduled events
    const [lastRes, nextRes] = await Promise.allSettled([
      sofaFetch(`/unique-tournament/${TOURNAMENT_ID}/season/${seasonId}/events/last/0`),
      sofaFetch(`/unique-tournament/${TOURNAMENT_ID}/season/${seasonId}/events/next/0`)
    ]);

    const finishedEvents = lastRes.status === 'fulfilled' && Array.isArray(lastRes.value?.events) ? lastRes.value.events : [];
    const upcomingEvents = nextRes.status === 'fulfilled' && Array.isArray(nextRes.value?.events) ? nextRes.value.events : [];

    // Deduplicate events by event.id
    const eventsMap = new Map();
    for (const ev of [...finishedEvents, ...upcomingEvents]) {
      if (ev && ev.id) eventsMap.set(ev.id, ev);
    }
    const allEvents = Array.from(eventsMap.values());

    if (!allEvents.length) {
      console.warn('[Tunisia SofaScore] No events returned. Preserving existing database records.');
      return;
    }

    // Build Poisson expected goals model from finished matches
    const finishedForModel = [];
    for (const ev of allEvents) {
      const st = mapSofaScoreStatus(ev.status);
      if (st !== 'FINISHED') continue;
      const scores = parseSofaScoreScore(ev.homeScore, ev.awayScore, st);
      if (scores.home === null || scores.away === null) continue;
      finishedForModel.push({
        homeId: Number(ev.homeTeam?.id),
        awayId: Number(ev.awayTeam?.id),
        homeGoals: scores.home,
        awayGoals: scores.away
      });
    }
    const model = teamRatings(finishedForModel);
    console.log(`[Tunisia SofaScore] Calculated team ratings from ${finishedForModel.length} finished fixtures.`);

    let updatedCount = 0;
    for (const ev of allEvents) {
      const extId = Number(ev.id);
      const homeTeam = ev.homeTeam;
      const awayTeam = ev.awayTeam;
      if (!Number.isSafeInteger(extId) || !homeTeam?.name || !awayTeam?.name || !ev.startTimestamp) continue;

      const round = roundInfoFromSofaScore(ev);
      const status = mapSofaScoreStatus(ev.status);
      const scores = parseSofaScoreScore(ev.homeScore, ev.awayScore, status);
      const { lambdaHome, lambdaAway } = matchLambdas(Number(homeTeam.id), Number(awayTeam.id), model);
      const markets = buildMatchMarketsPoints(lambdaHome, lambdaAway);
      const kickoff = new Date(ev.startTimestamp * 1000).toISOString();

      const homeCrest = homeTeam.id ? `https://img.sofascore.com/api/v1/team/${homeTeam.id}/image` : null;
      const awayCrest = awayTeam.id ? `https://img.sofascore.com/api/v1/team/${awayTeam.id}/image` : null;

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
          homeTeam.name || homeTeam.shortName,
          homeCrest,
          awayTeam.name || awayTeam.shortName,
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
    console.log(`[Tunisia SofaScore] Processed ${updatedCount} fixtures from SofaScore.`);
  } catch (err) {
    console.error('[Tunisia SofaScore] Schedule sync error:', err.message);
  }
}

let smartPollRunning = false;

/**
 * Smart Polling for Tunisian League live matches via SofaScore:
 * Runs every 2 minutes, BUT checks the database first:
 * - Only queries SofaScore if there is an active match (IN_PLAY, PAUSED)
 *   OR a match scheduled within the active window (kickoff - 10m to kickoff + 135m).
 * - If no active matches exist, 0 HTTP requests are made.
 */
async function smartPollTunisia(pool, { settleFinishedMatches, reconcileScoreCorrections } = {}) {
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

    console.log(`[Tunisia SofaScore Smart Polling] Detected ${activeMatches.length} active/upcoming matches.`);
    const updatedMatchRows = [];

    for (const match of activeMatches) {
      try {
        const eventData = await sofaFetch(`/event/${match.external_id}`);
        const ev = eventData?.event;
        if (!ev) continue;

        const newStatus = mapSofaScoreStatus(ev.status);
        const scores = parseSofaScoreScore(ev.homeScore, ev.awayScore, newStatus);

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
        console.error(`[Tunisia SofaScore Smart Polling] Failed for event ${match.external_id}:`, err.message);
      }
    }

    if (updatedMatchRows.length > 0) {
      console.log(`[Tunisia SofaScore Smart Polling] Updated ${updatedMatchRows.length} Tunisian matches.`);
      if (typeof reconcileScoreCorrections === 'function') {
        await reconcileScoreCorrections(updatedMatchRows);
      }
      if (typeof settleFinishedMatches === 'function') {
        await settleFinishedMatches();
      }
    }
  } catch (err) {
    console.error('[Tunisia SofaScore Smart Polling] Error:', err.message);
  } finally {
    smartPollRunning = false;
  }
}

/**
 * Initializes Tunisia background synchronization via SofaScore:
 * 1. Runs full schedule sync on boot in background.
 * 2. Schedules daily full sync at 06:00 UTC.
 * 3. Schedules smart polling every 2 minutes.
 */
function initTunisiaSync({ pool, cron, settleFinishedMatches, reconcileScoreCorrections }) {
  console.log(`[Tunisia SofaScore] Initialized provider for Tournament ID ${TOURNAMENT_ID} (Ligue Professionnelle 1).`);

  // 1. Initial schedule sync on startup
  syncTunisianLeague(pool).catch((err) => {
    console.error('[Tunisia SofaScore] Initial startup sync error:', err.message);
  });

  // 2. Daily schedule sync at 06:00 UTC
  cron.schedule('0 6 * * *', () => {
    console.log('[Tunisia SofaScore] Running scheduled daily fixture refresh...');
    syncTunisianLeague(pool).catch((err) => {
      console.error('[Tunisia SofaScore] Daily refresh error:', err.message);
    });
  });

  // 3. Smart polling every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    smartPollTunisia(pool, { settleFinishedMatches, reconcileScoreCorrections }).catch((err) => {
      console.error('[Tunisia SofaScore Smart Polling] Scheduled cycle error:', err.message);
    });
  });

  console.log('[Tunisia SofaScore] Smart polling scheduled (every 2m with conditional database gate).');
}

module.exports = {
  syncTunisianLeague,
  smartPollTunisia,
  initTunisiaSync,
  mapSofaScoreStatus,
  parseSofaScoreScore,
  roundInfoFromSofaScore,
  TOURNAMENT_ID
};

// Standalone execution support: node sync-tunisia.js
if (require.main === module) {
  const cliPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  syncTunisianLeague(cliPool)
    .catch((error) => {
      console.error('[Tunisia SofaScore] Failed:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await cliPool.end();
    });
}
