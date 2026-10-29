'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { teamRatings, matchLambdas, buildMatchMarketsPoints } = require('./pricingEngine');

const API_KEY = (process.env.API_FOOTBALL_KEY || '').trim();
const LEAGUE_ID = Number(process.env.TUNISIA_LEAGUE_ID || 202);
const now = new Date();
const CURRENT_SEASON = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const SEASON = Number(process.env.TUNISIA_SEASON || CURRENT_SEASON);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

function mapStatus(short) {
  if (['FT', 'AET', 'PEN'].includes(short)) return 'FINISHED';
  if (['1H', '2H', 'HT', 'ET', 'P', 'LIVE'].includes(short)) return 'IN_PLAY';
  if (['PST', 'ABD', 'INT'].includes(short)) return 'POSTPONED';
  if (['CANC', 'WO'].includes(short)) return 'CANCELLED';
  return 'SCHEDULED';
}

function matchdayFromRound(round) {
  const text = String(round || '');
  const found = /(?:regular\s+season\s*[-:]?\s*)?(\d+)/i.exec(text);
  return found ? Number(found[1]) : null;
}

async function syncTunisianLeague() {
  if (!API_KEY) throw new Error('Missing API_FOOTBALL_KEY in the root .env file.');
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL in the root .env file.');
  if (!Number.isInteger(SEASON) || SEASON < 2000) throw new Error('TUNISIA_SEASON must be a valid season year.');

  const url = new URL('https://v3.football.api-sports.io/fixtures');
  url.searchParams.set('league', String(LEAGUE_ID));
  url.searchParams.set('season', String(SEASON));
  console.log(`[Tunisia Sync] Loading league ${LEAGUE_ID}, season ${SEASON}...`);

  const response = await fetch(url, {
    headers: { 'x-apisports-key': API_KEY },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`API-Football returned HTTP ${response.status}.`);

  const payload = await response.json();
  const apiErrors = payload.errors;
  const hasErrors = Array.isArray(apiErrors)
    ? apiErrors.length > 0
    : apiErrors && typeof apiErrors === 'object' && Object.keys(apiErrors).length > 0;
  if (hasErrors) throw new Error(`API-Football error: ${JSON.stringify(apiErrors)}`);

  const fixtures = Array.isArray(payload.response) ? payload.response : [];
  if (!fixtures.length) {
    console.warn('[Tunisia Sync] No fixtures returned. No database rows were deleted or changed.');
    return;
  }

  const teamKey = (team) => team && team.id != null ? String(team.id) : String(team?.name || '');
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
    // Use the 90-minute score for settlement, including after extra time or penalties.
    const fullTime = fixture.score?.fulltime;
    const homeScore = status === 'FINISHED' ? (fullTime?.home ?? null) : null;
    const awayScore = status === 'FINISHED' ? (fullTime?.away ?? null) : null;
    const homeHt = fixture.score?.halftime?.home ?? null;
    const awayHt = fixture.score?.halftime?.away ?? null;
    const { lambdaHome: homeLambda, lambdaAway: awayLambda } = matchLambdas(
      teamKey(homeTeam), teamKey(awayTeam), model
    );
    const markets = buildMatchMarketsPoints(homeLambda, awayLambda);

    await pool.query(
      `INSERT INTO matches (
         external_id, competition_code, stage, matchday, round_key, round_label,
         home_team, home_crest, away_team, away_crest, utc_date, status,
         home_score, away_score, home_ht, away_ht, home_lambda, away_lambda,
         markets_points, updated_at
       ) VALUES (
         $1, 'TU1', 'REGULAR_SEASON', $2, $3, $4,
         $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17::jsonb, NOW()
       )
       ON CONFLICT (external_id) DO UPDATE SET
         competition_code = 'TU1',
         stage = EXCLUDED.stage,
         matchday = EXCLUDED.matchday,
         round_key = EXCLUDED.round_key,
         round_label = EXCLUDED.round_label,
         home_team = EXCLUDED.home_team,
         home_crest = EXCLUDED.home_crest,
         away_team = EXCLUDED.away_team,
         away_crest = EXCLUDED.away_crest,
         utc_date = CASE WHEN matches.points_calculated THEN matches.utc_date ELSE EXCLUDED.utc_date END,
         status = CASE WHEN matches.points_calculated THEN matches.status ELSE EXCLUDED.status END,
         home_score = CASE WHEN matches.points_calculated THEN matches.home_score ELSE EXCLUDED.home_score END,
         away_score = CASE WHEN matches.points_calculated THEN matches.away_score ELSE EXCLUDED.away_score END,
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
        id, matchday, roundKey, roundLabel,
        homeTeam.shortName || homeTeam.name, homeTeam.logo || null,
        awayTeam.shortName || awayTeam.name, awayTeam.logo || null,
        kickoff, status, homeScore, awayScore, homeHt, awayHt,
        homeLambda, awayLambda, JSON.stringify(markets)
      ]
    );
    updatedCount++;
  }
  console.log(`[Tunisia Sync] Processed ${updatedCount} fixtures. No existing league rows were bulk-deleted.`);
}

syncTunisianLeague()
  .catch((error) => {
    console.error('[Tunisia Sync] Failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
