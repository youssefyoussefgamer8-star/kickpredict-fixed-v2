'use strict';
const assert = require('assert');
const {
  mapSofaScoreStatus,
  parseSofaScoreScore,
  roundInfoFromSofaScore,
  smartPollTunisia,
  setCachedSeasonId,
  sofaFetch
} = require('./sync-tunisia');
const { teamRatings, matchLambdas, buildMatchMarketsPoints } = require('./pricingEngine');

console.log('--- Testing SofaScore Status Mapping ---');
assert.strictEqual(mapSofaScoreStatus({ type: 'finished', code: 100 }), 'FINISHED');
assert.strictEqual(mapSofaScoreStatus({ type: 'inprogress', code: 6, description: '1st half' }), 'IN_PLAY');
assert.strictEqual(mapSofaScoreStatus({ type: 'inprogress', code: 7, description: 'Halftime' }), 'PAUSED');
assert.strictEqual(mapSofaScoreStatus({ type: 'inprogress', code: 31, description: '2nd half' }), 'IN_PLAY');
assert.strictEqual(mapSofaScoreStatus({ type: 'notstarted', code: 0 }), 'SCHEDULED');
assert.strictEqual(mapSofaScoreStatus({ type: 'postponed', code: 60 }), 'POSTPONED');
assert.strictEqual(mapSofaScoreStatus({ type: 'canceled', code: 70 }), 'CANCELLED');
console.log('✓ All Status Mappings passed');

console.log('--- Testing Score Parsing ---');
const finishedScore = parseSofaScoreScore(
  { current: 2, display: 2, period1: 1, normaltime: 2 },
  { current: 1, display: 1, period1: 0, normaltime: 1 },
  'FINISHED'
);
assert.strictEqual(finishedScore.home, 2);
assert.strictEqual(finishedScore.away, 1);
assert.strictEqual(finishedScore.homeHt, 1);
assert.strictEqual(finishedScore.awayHt, 0);

const liveScore = parseSofaScoreScore(
  { current: 1, period1: 1 },
  { current: 0, period1: 0 },
  'IN_PLAY'
);
assert.strictEqual(liveScore.home, 1);
assert.strictEqual(liveScore.away, 0);
assert.strictEqual(liveScore.homeHt, 1);
assert.strictEqual(liveScore.awayHt, 0);

const scheduledScore = parseSofaScoreScore(null, null, 'SCHEDULED');
assert.strictEqual(scheduledScore.home, null);
assert.strictEqual(scheduledScore.away, null);
console.log('✓ All Score Parsing tests passed');

console.log('--- Testing Round Info Extraction ---');
const r1 = roundInfoFromSofaScore({ roundInfo: { round: 8, name: 'Round 8' } });
assert.strictEqual(r1.matchday, 8);
assert.strictEqual(r1.key, 'MD:8');
assert.strictEqual(r1.label, 'Matchday 8');

const r2 = roundInfoFromSofaScore({ roundInfo: { name: 'Championship Playoff 1' } });
assert.strictEqual(r2.matchday, null);
assert.strictEqual(r2.key, 'CHAMPIONSHIP_PLAYOFF_1');
console.log('✓ All Round Info extraction tests passed');

console.log('--- Testing Pricing Engine Integration with SofaScore Data ---');
// Mock finished matches from SofaScore
const mockFinishedSofaEvents = [
  {
    homeId: 102102, // Club Africain
    awayId: 8153,   // Esperance
    homeGoals: 1,
    awayGoals: 0
  },
  {
    homeId: 6366,   // Etoile du Sahel
    awayId: 102106, // CS Sfaxien
    homeGoals: 2,
    awayGoals: 1
  },
  {
    homeId: 8153,   // Esperance
    awayId: 6366,   // Etoile du Sahel
    homeGoals: 3,
    awayGoals: 1
  },
  {
    homeId: 102109, // US Monastir
    awayId: 102116, // Stade Tunisien
    homeGoals: 0,
    awayGoals: 0
  }
];

const model = teamRatings(mockFinishedSofaEvents);
assert.ok(model.avgHome > 0, 'avgHome should be positive');
assert.ok(model.avgAway > 0, 'avgAway should be positive');

const { lambdaHome, lambdaAway } = matchLambdas(102102, 8153, model);
assert.ok(Number.isFinite(lambdaHome) && lambdaHome > 0, 'lambdaHome is valid');
assert.ok(Number.isFinite(lambdaAway) && lambdaAway > 0, 'lambdaAway is valid');

const markets = buildMatchMarketsPoints(lambdaHome, lambdaAway);
assert.ok(markets.outcome_1x2.HOME > 0, '1X2 HOME points calculated');
assert.ok(markets.outcome_1x2.DRAW > 0, '1X2 DRAW points calculated');
assert.ok(markets.outcome_1x2.AWAY > 0, '1X2 AWAY points calculated');
assert.ok(markets.exact_score['1-0'] > 0, 'Exact score 1-0 points calculated');
assert.ok(markets.extras.ou_2_5.OVER > 0, 'Extras ou_2_5 OVER points calculated');

console.log('✓ Poisson pricing engine integration test passed successfully!');

console.log('--- Testing Aggregated Smart Polling for Concurrent Matches ---');
(async () => {
  setCachedSeasonId(65427);

  // 1. Test: Zero active matches in DB should result in 0 HTTP requests
  let fetchCount = 0;
  const mockFetcher = async () => {
    fetchCount++;
    return { events: [] };
  };

  const emptyPool = {
    query: async () => ({ rows: [] })
  };

  await smartPollTunisia(emptyPool, { fetcher: mockFetcher });
  assert.strictEqual(fetchCount, 0, 'Zero requests should be sent when no matches are active');
  console.log('✓ Zero requests sent when no matches are active');

  // 2. Test: 4 concurrent matches playing simultaneously -> exactly 1 aggregated request
  fetchCount = 0;
  let fetchedPath = null;
  let fetchedParams = null;

  const mockBatchFetcher = async (path, params) => {
    fetchCount++;
    fetchedPath = path;
    fetchedParams = params;
    return {
      events: [
        {
          id: 1001,
          status: { type: 'inprogress', code: 31, description: '2nd half' },
          homeScore: { current: 2, period1: 1 },
          awayScore: { current: 1, period1: 0 }
        },
        {
          id: 1002,
          status: { type: 'inprogress', code: 7, description: 'Halftime' },
          homeScore: { current: 0, period1: 0 },
          awayScore: { current: 0, period1: 0 }
        },
        {
          id: 1003,
          status: { type: 'finished', code: 100, description: 'Ended' },
          homeScore: { current: 3, period1: 1 },
          awayScore: { current: 2, period1: 1 }
        },
        {
          id: 1004,
          status: { type: 'inprogress', code: 6, description: '1st half' },
          homeScore: { current: 1, period1: 1 },
          awayScore: { current: 0, period1: 0 }
        }
      ]
    };
  };

  const dbMatches = [
    { id: 1, external_id: 1001, status: 'IN_PLAY', home_score: 1, away_score: 1, home_ht: 1, away_ht: 0, utc_date: new Date(Date.now() - 3600000).toISOString() },
    { id: 2, external_id: 1002, status: 'IN_PLAY', home_score: 0, away_score: 0, home_ht: 0, away_ht: 0, utc_date: new Date(Date.now() - 2700000).toISOString() },
    { id: 3, external_id: 1003, status: 'IN_PLAY', home_score: 2, away_score: 2, home_ht: 1, away_ht: 1, utc_date: new Date(Date.now() - 6000000).toISOString() },
    { id: 4, external_id: 1004, status: 'SCHEDULED', home_score: null, away_score: null, home_ht: null, away_ht: null, utc_date: new Date(Date.now() - 600000).toISOString() }
  ];

  const updatedDbRows = [];
  const testPool = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id, external_id')) {
        return { rows: dbMatches };
      }
      if (sql.includes('UPDATE matches')) {
        updatedDbRows.push({
          status: params[0],
          home_score: params[1],
          away_score: params[2],
          home_ht: params[3],
          away_ht: params[4],
          id: params[5]
        });
        return { rowCount: 1 };
      }
      return { rows: [] };
    }
  };

  let reconciledRows = null;
  let settled = false;

  await smartPollTunisia(testPool, {
    settleFinishedMatches: async () => { settled = true; },
    reconcileScoreCorrections: async (rows) => { reconciledRows = rows; },
    fetcher: mockBatchFetcher
  });

  // Verify exactly 1 single batch call was made regardless of 4 concurrent matches
  assert.strictEqual(fetchCount, 1, 'Exactly 1 batch request must be sent for all concurrent matches');
  console.log('✓ Exactly 1 aggregated API request sent for 4 concurrent matches');

  // Verify all 4 matches were updated
  assert.strictEqual(updatedDbRows.length, 4, 'All 4 matches should have been updated from the single batch response');
  assert.strictEqual(updatedDbRows[0].status, 'IN_PLAY');
  assert.strictEqual(updatedDbRows[0].home_score, 2);
  assert.strictEqual(updatedDbRows[0].away_score, 1);

  assert.strictEqual(updatedDbRows[1].status, 'PAUSED'); // Halftime

  assert.strictEqual(updatedDbRows[2].status, 'FINISHED'); // Ended
  assert.strictEqual(updatedDbRows[2].home_score, 3);
  assert.strictEqual(updatedDbRows[2].away_score, 2);

  assert.strictEqual(updatedDbRows[3].status, 'IN_PLAY');
  assert.strictEqual(updatedDbRows[3].home_score, 1);
  assert.strictEqual(updatedDbRows[3].away_score, 0);

  // Verify reconciliation and settlement were triggered
  assert.ok(settled, 'settleFinishedMatches was invoked');
  assert.strictEqual(reconciledRows.length, 4, 'reconcileScoreCorrections was called with 4 updated rows');
  console.log('✓ All 4 concurrent matches updated, reconciled, and settled accurately from 1 request');

  console.log('--- Testing RapidAPI sofascore-api6 Gateway nativePassThrough Routing ---');
  const originalFetch = global.fetch;
  const originalApiKey = process.env.RAPIDAPI_KEY;
  const originalHost = process.env.RAPIDAPI_SOFA_HOST;

  try {
    process.env.RAPIDAPI_KEY = 'test-rapidapi-key-12345';
    delete process.env.RAPIDAPI_SOFA_HOST;

    let calledUrl = null;
    let calledOptions = null;
    global.fetch = async (url, options) => {
      calledUrl = url;
      calledOptions = options;
      return {
        ok: true,
        json: async () => ({ events: [{ id: 9999 }] })
      };
    };

    const result = await sofaFetch('/unique-tournament/984/season/65427/events/last/0');
    assert.ok(result.events.length === 1, 'Event returned through gateway');

    const parsedUrl = new URL(calledUrl);
    assert.strictEqual(parsedUrl.hostname, 'sofascore-api6.p.rapidapi.com', 'Correct RapidAPI host');
    assert.strictEqual(parsedUrl.pathname, '/nativePassThrough', 'Routes via /nativePassThrough');
    assert.strictEqual(parsedUrl.searchParams.get('path'), '/unique-tournament/984/season/65427/events/last/0', 'Native path without /api/v1 prefix passed as query param');
    assert.strictEqual(calledOptions.headers['X-RapidAPI-Host'], 'sofascore-api6.p.rapidapi.com', 'X-RapidAPI-Host header attached');
    assert.strictEqual(calledOptions.headers['X-RapidAPI-Key'], 'test-rapidapi-key-12345', 'X-RapidAPI-Key header attached');
    console.log('✓ sofascore-api6 nativePassThrough routing and headers verified successfully');
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey !== undefined) process.env.RAPIDAPI_KEY = originalApiKey;
    else delete process.env.RAPIDAPI_KEY;
    if (originalHost !== undefined) process.env.RAPIDAPI_SOFA_HOST = originalHost;
    else delete process.env.RAPIDAPI_SOFA_HOST;
  }

  console.log('All SofaScore integration and batch smart-polling unit tests passed!');
})();
