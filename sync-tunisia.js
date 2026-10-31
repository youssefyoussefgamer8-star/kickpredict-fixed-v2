'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { teamRatings, matchLambdas, buildMatchMarketsPoints } = require('./pricingEngine');

// SofaScore Unique Tournament ID for Tunisian Ligue Professionnelle 1: 984
const TOURNAMENT_ID = Number(process.env.SOFASCORE_TOURNAMENT_ID || 984);
const RAPIDAPI_KEY = (process.env.RAPIDAPI_KEY || '').trim();
const RAPIDAPI_HOST = (process.env.RAPIDAPI_SOFA_HOST || 'sofascore-api6.p.rapidapi.com').trim();
const DIRECT_BASE_URL = (process.env.SOFASCORE_BASE_URL || 'https://api.sofascore.com/api/v1').replace(/\/+$/, '');

let cachedSeasonId = process.env.TUNISIA_SOFASCORE_SEASON_ID
  ? Number(process.env.TUNISIA_SOFASCORE_SEASON_ID)
  : 65427;

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

let proxyDispatcher = null;
const proxyUrl = process.env.SOFA_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  try {
    const { ProxyAgent } = require('undici');
    proxyDispatcher = new ProxyAgent(proxyUrl);
    console.log(`[Tunisia SofaScore] Proxy gateway initialized: ${proxyUrl.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@')}`);
  } catch (err) {
    console.warn('[Tunisia SofaScore] Proxy initialization warning:', err.message);
  }
}

/**
 * Sanitizes and cleans API paths to prevent redundant slashes (//) and /api/v1 prefixes
 */
function sanitizePath(p) {
  if (!p) return '';
  return String(p)
    .trim()
    .replace(/^\/+/, '')
    .replace(/^(api\/)?v1\/?/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/');
}

/**
 * Candidate official endpoints on RapidAPI for tournament match fixtures/results
 */
function getRapidApiCandidateEndpoints(course = 'last') {
  if (process.env.RAPIDAPI_SOFA_ENDPOINT) {
    return [sanitizePath(process.env.RAPIDAPI_SOFA_ENDPOINT)];
  }
  if (course === 'last') {
    return [
      'tournaments/get-last-matches',
      'tournaments/get-events',
      'tournaments/get-schedule',
      'tournaments/get-matches',
      'tournaments/events',
      `unique-tournament/${TOURNAMENT_ID}/season/events/last`
    ];
  } else {
    return [
      'tournaments/get-next-matches',
      'tournaments/get-schedule',
      'tournaments/get-events',
      'tournaments/get-matches',
      'tournaments/events',
      `unique-tournament/${TOURNAMENT_ID}/season/events/next`
    ];
  }
}

let cachedWorkingEndpoint = null;

/**
 * Universal SofaScore Fetcher for raw endpoints (direct or proxy route)
 */
async function sofaFetch(path, params = {}) {
  const isRapidApi = Boolean(process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_KEY.trim());

  let url;
  let headers;

  const cleanPath = sanitizePath(path);

  if (isRapidApi) {
    const host = RAPIDAPI_HOST.replace(/\/+$/, '');
    url = new URL(`https://${host}/${cleanPath}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    headers = {
      'X-RapidAPI-Key': process.env.RAPIDAPI_KEY.trim(),
      'X-RapidAPI-Host': host,
      'Accept': 'application/json'
    };
  } else {
    const base = DIRECT_BASE_URL.replace(/\/+$/, '');
    url = new URL(`${base}/${cleanPath}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    headers = {
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

  const options = {
    headers,
    signal: AbortSignal.timeout(25000)
  };
  if (proxyDispatcher && !isRapidApi) {
    options.dispatcher = proxyDispatcher;
  }

  const res = await fetch(url.toString(), options);
  if (!res.ok) {
    if (res.status === 403 && !isRapidApi) {
      throw new Error(
        `SofaScore HTTP 403 (Cloudflare block). Add RAPIDAPI_KEY to .env/Render or set SOFA_PROXY to bypass.`
      );
    }
    throw new Error(`SofaScore HTTP ${res.status} (${res.statusText}) on ${url.toString()}`);
  }
  return res.json();
}

/**
 * Fetches tournament events via official dedicated RapidAPI endpoints with candidate fallback,
 * or via direct SofaScore route when not using RapidAPI.
 */
async function fetchTournamentEvents({
  tournamentId = TOURNAMENT_ID,
  seasonId = 65427,
  course = 'last',
  page = 0,
  fetcher = fetch
} = {}) {
  const isRapidApi = Boolean(process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_KEY.trim());

  if (!isRapidApi) {
    const directPath = `unique-tournament/${tournamentId}/season/${seasonId}/events/${course}/${page}`;
    return sofaFetch(directPath);
  }

  const candidateList = getRapidApiCandidateEndpoints(course);
  const candidates = cachedWorkingEndpoint
    ? [cachedWorkingEndpoint, ...candidateList.filter((e) => e !== cachedWorkingEndpoint)]
    : candidateList;

  let lastError = null;
  const host = RAPIDAPI_HOST.replace(/\/+$/, '');

  for (const endpoint of candidates) {
    const cleanEndpoint = sanitizePath(endpoint);
    const url = new URL(`https://${host}/${cleanEndpoint}`);
    url.searchParams.set('tournamentId', String(tournamentId));
    url.searchParams.set('tournament_id', String(tournamentId));
    url.searchParams.set('seasonId', String(seasonId));
    url.searchParams.set('season_id', String(seasonId));
    url.searchParams.set('course_events', course);
    url.searchParams.set('page', String(page));

    const options = {
      headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY.trim(),
        'X-RapidAPI-Host': host,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(25000)
    };

    try {
      const res = await fetcher(url.toString(), options);
      if (res.status === 404) {
        lastError = new Error(`RapidAPI endpoint /${cleanEndpoint} returned 404`);
        continue;
      }
      if (!res.ok) {
        throw new Error(`RapidAPI HTTP ${res.status} (${res.statusText}) on /${cleanEndpoint}`);
      }
      const data = await res.json();
      cachedWorkingEndpoint = cleanEndpoint;
      return data;
    } catch (err) {
      lastError = err;
      if (err.message && err.message.includes('404')) {
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error(`All candidate endpoints for tournament ${tournamentId} returned 404 on ${RAPIDAPI_HOST}`);
}

/**
 * Robustly extracts match/event array from any RapidAPI vendor structure
 */
function extractEventsFromResponse(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.events)) return data.events;
  if (Array.isArray(data.matches)) return data.matches;
  if (Array.isArray(data.data?.events)) return data.data.events;
  if (Array.isArray(data.data?.matches)) return data.data.matches;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.response)) return data.response;
  return [];
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

  const home = typeof homeScoreObj === 'number'
    ? homeScoreObj
    : (homeScoreObj?.current ?? homeScoreObj?.display ?? homeScoreObj?.normaltime ?? null);
  const away = typeof awayScoreObj === 'number'
    ? awayScoreObj
    : (awayScoreObj?.current ?? awayScoreObj?.display ?? awayScoreObj?.normaltime ?? null);

  const homeHt = typeof homeScoreObj === 'object' ? (homeScoreObj?.period1 ?? null) : null;
  const awayHt = typeof awayScoreObj === 'object' ? (awayScoreObj?.period1 ?? null) : null;

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
  const round = event.roundInfo?.round ?? event.round;
  if (Number.isInteger(round) && round > 0) {
    return { stage: 'REGULAR_SEASON', matchday: round, key: `MD:${round}`, label: `Matchday ${round}` };
  }
  const name = String(event.roundInfo?.name || event.round_name || 'Regular Season').trim();
  const cleanKey = name.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase() || 'MD_1';
  return { stage: 'REGULAR_SEASON', matchday: null, key: cleanKey, label: name };
}

/**
 * Resolves active SofaScore season ID for tournament 984.
 * Uses fixed season ID (65427) directly, bypassing all network calls
 * to save API requests and prevent 404 errors.
 */
async function getActiveSeasonId(_fetcher = null) {
  return cachedSeasonId || Number(process.env.TUNISIA_SOFASCORE_SEASON_ID || 65427);
}

/**
 * Full fixture schedule & Poisson ratings sync from SofaScore:
 * 1. Uses preset season ID (65427) directly (seasons lookup bypassed).
 * 2. Fetches recent finished fixtures (course: 'last') and upcoming fixtures (course: 'next').
 * 3. Builds Poisson expected-goals ratings.
 * 4. Inserts/updates matches table with 'TUN' competition code.
 */
async function syncTunisianLeague(pool) {
  try {
    const isRapidApi = Boolean(process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_KEY.trim());
    const seasonId = cachedSeasonId || Number(process.env.TUNISIA_SOFASCORE_SEASON_ID || 65427);
    console.log(
      `[Tunisia SofaScore] Direct sync for Tournament ID ${TOURNAMENT_ID}, Season ID ${seasonId} (mode: ${isRapidApi ? 'RapidAPI Gateway' : 'Direct / Proxy'}, seasons query bypassed).`
    );

    // Fetch finished fixtures and upcoming scheduled fixtures via dedicated official tournament endpoints
    const [lastRes, nextRes] = await Promise.allSettled([
      fetchTournamentEvents({ tournamentId: TOURNAMENT_ID, seasonId, course: 'last', page: 0 }),
      fetchTournamentEvents({ tournamentId: TOURNAMENT_ID, seasonId, course: 'next', page: 0 })
    ]);

    const finishedEvents = lastRes.status === 'fulfilled'
      ? extractEventsFromResponse(lastRes.value)
      : [];
    const upcomingEvents = nextRes.status === 'fulfilled'
      ? extractEventsFromResponse(nextRes.value)
      : [];

    // Deduplicate events by event ID
    const eventsMap = new Map();
    for (const ev of [...finishedEvents, ...upcomingEvents]) {
      const extId = ev?.id ?? ev?.external_id ?? ev?.matchId;
      if (extId !== undefined && extId !== null) eventsMap.set(String(extId), ev);
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
      const scores = parseSofaScoreScore(ev.homeScore ?? ev.home_score, ev.awayScore ?? ev.away_score, st);
      if (scores.home === null || scores.away === null) continue;
      finishedForModel.push({
        homeId: Number(ev.homeTeam?.id ?? ev.home_team?.id),
        awayId: Number(ev.awayTeam?.id ?? ev.away_team?.id),
        homeGoals: scores.home,
        awayGoals: scores.away
      });
    }
    const model = teamRatings(finishedForModel);
    console.log(`[Tunisia SofaScore] Calculated team ratings from ${finishedForModel.length} finished fixtures.`);

    let updatedCount = 0;
    for (const ev of allEvents) {
      const extId = Number(ev.id ?? ev.external_id ?? ev.matchId);
      const homeTeam = ev.homeTeam || ev.home_team;
      const awayTeam = ev.awayTeam || ev.away_team;
      const startTimestamp = ev.startTimestamp ?? ev.start_timestamp ?? (ev.date ? Math.floor(new Date(ev.date).getTime() / 1000) : null);
      if (!Number.isSafeInteger(extId) || !homeTeam?.name || !awayTeam?.name || !startTimestamp) continue;

      const round = roundInfoFromSofaScore(ev);
      const status = mapSofaScoreStatus(ev.status);
      const scores = parseSofaScoreScore(ev.homeScore ?? ev.home_score, ev.awayScore ?? ev.away_score, status);
      const { lambdaHome, lambdaAway } = matchLambdas(Number(homeTeam.id), Number(awayTeam.id), model);
      const markets = buildMatchMarketsPoints(lambdaHome, lambdaAway);
      const kickoff = new Date(startTimestamp * 1000).toISOString();

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
 * Smart Polling for Tunisian League live matches:
 * Runs every 2 minutes, BUT checks the database first:
 * - Only queries SofaScore if there is an active match (IN_PLAY, PAUSED)
 *   OR a match scheduled within the active window (kickoff - 10m to kickoff + 135m).
 * - If no active matches exist, 0 HTTP requests are made.
 * - When active matches exist, sends EXACTLY ONE aggregated batch query for the
 *   entire active round of Tournament 984, updating all concurrent fixtures
 *   simultaneously without looping single-match requests.
 */
async function smartPollTunisia(
  pool,
  { settleFinishedMatches, reconcileScoreCorrections, fetcher = sofaFetch } = {}
) {
  if (smartPollRunning) return;
  smartPollRunning = true;

  try {
    const isRapidApi = Boolean(process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_KEY.trim());

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
      `[Tunisia SofaScore Smart Polling] Detected ${activeMatches.length} active/upcoming matches. Executing single aggregated batch query...`
    );

    const seasonId = await getActiveSeasonId(fetcher);

    // Determine batch query target:
    // If any match is already live/paused or past its scheduled kickoff time, fetch 'events/last' (the active round).
    // If all active matches are upcoming (before kickoff), fetch 'events/next'.
    const now = new Date();
    const hasLiveOrStarted = activeMatches.some(
      (m) => m.status === 'IN_PLAY' || m.status === 'PAUSED' || (m.utc_date && new Date(m.utc_date) <= now)
    );
    const roundEndpoint = hasLiveOrStarted ? 'last' : 'next';

    let data;
    if (typeof fetcher === 'function' && fetcher !== sofaFetch && fetcher !== fetch) {
      data = await fetcher(`/tournaments/get-${roundEndpoint}-matches`, {
        tournamentId: TOURNAMENT_ID,
        seasonId
      });
    } else {
      data = await fetchTournamentEvents({
        tournamentId: TOURNAMENT_ID,
        seasonId,
        course: roundEndpoint,
        page: 0
      });
    }

    const events = extractEventsFromResponse(data);

    if (!events.length) {
      console.log(`[Tunisia SofaScore Smart Polling] 0 events returned from batch endpoint (${roundEndpoint}).`);
      return;
    }

    // Index all events from the batch response by external_id (as string & number for robust matching)
    const eventsMap = new Map();
    for (const ev of events) {
      const id = ev?.id ?? ev?.external_id ?? ev?.matchId;
      if (id !== undefined && id !== null) {
        eventsMap.set(String(id), ev);
        eventsMap.set(Number(id), ev);
      }
    }

    const updatedMatchRows = [];

    // Process all active matches in memory from the single batch response
    for (const match of activeMatches) {
      try {
        const ev = eventsMap.get(String(match.external_id)) || eventsMap.get(Number(match.external_id));
        if (!ev) continue;

        const newStatus = mapSofaScoreStatus(ev.status);
        const scores = parseSofaScoreScore(ev.homeScore ?? ev.home_score, ev.awayScore ?? ev.away_score, newStatus);

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
        console.error(`[Tunisia SofaScore Smart Polling] Failed updating match ${match.external_id}:`, err.message);
      }
    }

    if (updatedMatchRows.length > 0) {
      console.log(`[Tunisia SofaScore Smart Polling] Updated ${updatedMatchRows.length} Tunisian matches in batch.`);
      if (typeof reconcileScoreCorrections === 'function') {
        await reconcileScoreCorrections(updatedMatchRows);
      }
      if (typeof settleFinishedMatches === 'function') {
        await settleFinishedMatches();
      }
    }
  } catch (err) {
    console.error('[Tunisia SofaScore Smart Polling] Batch polling error:', err.message);
  } finally {
    smartPollRunning = false;
  }
}

/**
 * Purges legacy or obsolete Tunisian matches (from FotMob or older imports) from PostgreSQL.
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
      console.log(`[Tunisia SofaScore] Purged ${res.rowCount} legacy Tunisian matches and ${boostRes.rowCount} boosts from PostgreSQL.`);
    }
    return { deletedMatches: res.rowCount, deletedBoosts: boostRes.rowCount };
  } catch (err) {
    console.warn('[Tunisia SofaScore] Purge query warning:', err.message);
    return { deletedMatches: 0, deletedBoosts: 0 };
  }
}

/**
 * Initializes Tunisia background synchronization via SofaScore:
 * 1. Purges legacy records and runs full schedule sync on boot.
 * 2. Schedules daily full sync at 06:00 UTC.
 * 3. Schedules smart polling every 2 minutes.
 */
function initTunisiaSync({ pool, cron, settleFinishedMatches, reconcileScoreCorrections }) {
  const isRapidApi = Boolean(process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_KEY.trim());
  console.log(
    `[Tunisia SofaScore] Initialized provider for Tournament ID ${TOURNAMENT_ID} (mode: ${isRapidApi ? 'RapidAPI Gateway' : 'Direct / Proxy'}).`
  );

  // 1. Initial schedule sync on startup (purges legacy records on boot, then loads fresh fixtures)
  (async () => {
    try {
      await purgeLegacyTunisiaMatches(pool);
      await syncTunisianLeague(pool);
    } catch (err) {
      console.error('[Tunisia SofaScore] Initial startup sync error:', err.message);
    }
  })();

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
  purgeLegacyTunisiaMatches,
  sanitizePath,
  mapSofaScoreStatus,
  parseSofaScoreScore,
  roundInfoFromSofaScore,
  sofaFetch,
  fetchTournamentEvents,
  extractEventsFromResponse,
  getRapidApiCandidateEndpoints,
  getActiveSeasonId,
  setCachedSeasonId: (id) => { cachedSeasonId = id; },
  getCachedSeasonId: () => cachedSeasonId,
  setCachedWorkingEndpoint: (ep) => { cachedWorkingEndpoint = ep; },
  getCachedWorkingEndpoint: () => cachedWorkingEndpoint,
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
