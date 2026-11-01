'use strict';
const assert = require('assert');
const {
  mapSofaScoreStatus,
  parseSofaScoreScore,
  roundInfoFromSofaScore,
  smartPollTunisia,
  setCachedSeasonId,
  sofaFetch,
  fetchTournamentEvents,
  extractEventsFromResponse,
  getRapidApiCandidateEndpoints,
  getActiveSeasonId,
  setCachedWorkingEndpoint,
  getCachedWorkingEndpoint,
  sanitizePath,
  purgeLegacyTunisiaMatches
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

// Numeric score format support
const numericScore = parseSofaScoreScore(3, 1, 'FINISHED');
assert.strictEqual(numericScore.home, 3);
assert.strictEqual(numericScore.away, 1);

const zeroZeroScore = parseSofaScoreScore(0, 0, 'IN_PLAY');
assert.strictEqual(zeroZeroScore.home, 0);
assert.strictEqual(zeroZeroScore.away, 0);
console.log('✓ All Score Parsing tests passed (including numeric score formats)');

console.log('--- Testing Flexible Event Extraction from Vendor Responses ---');
assert.strictEqual(extractEventsFromResponse({ events: [{ id: 101 }] }).length, 1);
assert.strictEqual(extractEventsFromResponse({ matches: [{ id: 102 }] }).length, 1);
assert.strictEqual(extractEventsFromResponse({ data: { events: [{ id: 103 }] } }).length, 1);
assert.strictEqual(extractEventsFromResponse({ data: [{ id: 104 }] }).length, 1);
assert.strictEqual(extractEventsFromResponse([{ id: 105 }]).length, 1);
assert.strictEqual(extractEventsFromResponse({ events: [{ event: { id: 106, homeTeam: { name: 'EST' } } }] }).length, 1);
assert.strictEqual(extractEventsFromResponse({ rounds: [{ events: [{ id: 107 }] }] }).length, 1);
assert.strictEqual(extractEventsFromResponse({ fixtures: [{ id: 108 }] }).length, 1);
assert.strictEqual(extractEventsFromResponse({ customList: [{ matchId: 109, home_team: 'CA' }] }).length, 1);
assert.strictEqual(extractEventsFromResponse(null).length, 0);
assert.strictEqual(extractEventsFromResponse({}).length, 0);
console.log('✓ Event extraction across multiple RapidAPI vendor response formats passed');

console.log('--- Testing Round Info Extraction ---');
const r1 = roundInfoFromSofaScore({ roundInfo: { round: 8, name: 'Round 8' } });
assert.strictEqual(r1.matchday, 8);
assert.strictEqual(r1.key, 'MD:8');
assert.strictEqual(r1.label, 'Matchday 8');

const r2 = roundInfoFromSofaScore({ roundInfo: { name: 'Championship Playoff 1' } });
assert.strictEqual(r2.matchday, null);
assert.strictEqual(r2.key, 'CHAMPIONSHIP_PLAYOFF_1');
console.log('✓ All Round Info extraction tests passed');

console.log('--- Testing URL Path Sanitization (Double-Slash Prevention) ---');
assert.strictEqual(sanitizePath('/api/v1/unique-tournament/984/seasons'), 'api/v1/unique-tournament/984/seasons');
assert.strictEqual(sanitizePath('//api/v1/unique-tournament//984/seasons//'), 'api/v1/unique-tournament/984/seasons');
assert.strictEqual(sanitizePath('/api/v1/unique-tournament/984/season/65427/events/last/0'), 'api/v1/unique-tournament/984/season/65427/events/last/0');
assert.strictEqual(sanitizePath('//api/v1/unique-tournament//984/season/65427/events/last/0//'), 'api/v1/unique-tournament/984/season/65427/events/last/0');
assert.strictEqual(sanitizePath('///'), '');
console.log('✓ Path sanitization handles leading, trailing, and duplicate slashes cleanly');

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
  console.log('--- Testing Season Discovery & Fallback ---');
  setCachedSeasonId(65427);
  let seasonsFetchCalled = 0;
  const mockSeasonFetcher = async () => {
    seasonsFetchCalled++;
    return { seasons: [] };
  };
  const seasonIdResult = await getActiveSeasonId(mockSeasonFetcher);
  assert.strictEqual(seasonIdResult, 65427, 'Uses fixed season ID 65427 when cached');
  assert.strictEqual(seasonsFetchCalled, 0, 'Zero network calls made when cached');

  // Test dynamic discovery from RapidAPI when uncached
  const prevApiKey = process.env.RAPIDAPI_KEY;
  try {
    process.env.RAPIDAPI_KEY = 'test-key';
    setCachedSeasonId(null);
    delete process.env.TUNISIA_SOFASCORE_SEASON_ID;
    let discoveryCalled = 0;
    const mockDiscoveryFetcher = async () => {
      discoveryCalled++;
      return {
        ok: true,
        json: async () => ({
          seasons: [
            { id: 65427, year: '25/26', name: 'Ligue 1 25/26' },
            { id: 61627, year: '24/25', name: 'Ligue 1 24/25' }
          ]
        })
      };
    };
    const discoveredId = await getActiveSeasonId(mockDiscoveryFetcher);
    assert.strictEqual(discoveredId, 65427);
    assert.ok(discoveryCalled > 0, 'Discovers season from RapidAPI when uncached');
    console.log('✓ Season discovery and fallback verified successfully');
  } finally {
    if (prevApiKey !== undefined) process.env.RAPIDAPI_KEY = prevApiKey;
    else delete process.env.RAPIDAPI_KEY;
    setCachedSeasonId(65427);
  }

  console.log('--- Testing PostgreSQL Legacy Tunisia Purge ---');
  const deletedSqls = [];
  const mockPurgePool = {
    query: async (sql) => {
      deletedSqls.push(sql);
      if (sql.includes('FROM matches')) return { rowCount: 16 };
      if (sql.includes('FROM user_round_boosts')) return { rowCount: 2 };
      return { rowCount: 0 };
    }
  };
  const purgeResult = await purgeLegacyTunisiaMatches(mockPurgePool);
  assert.strictEqual(purgeResult.deletedMatches, 16);
  assert.strictEqual(purgeResult.deletedBoosts, 2);
  assert.strictEqual(deletedSqls.length, 2);
  console.log('✓ Legacy Tunisian matches and boosts purge verified');

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
  assert.strictEqual(fetchedPath, '/api/v1/unique-tournament/984/season/65427/events/last/0');
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

  console.log('--- Testing Official SportAPI RapidAPI Endpoints & Candidate Fallback ---');
  const originalFetch = global.fetch;
  const originalApiKey = process.env.RAPIDAPI_KEY;
  const originalHost = process.env.RAPIDAPI_SOFA_HOST;

  try {
    process.env.RAPIDAPI_KEY = 'test-rapidapi-key-12345';
    delete process.env.RAPIDAPI_SOFA_HOST;
    setCachedWorkingEndpoint(null);

    // Verify candidate lists for SportAPI
    const lastCandidates = getRapidApiCandidateEndpoints('last');
    assert.strictEqual(lastCandidates[0], 'api/v1/unique-tournament/984/season/65427/events/last/0');
    assert.ok(lastCandidates.includes('api/v1/unique-tournament/984/season/65427/events/last/0'));
    assert.ok(!lastCandidates.includes('nativePassThrough'), 'Must not contain nativePassThrough');
    assert.ok(!lastCandidates.includes('tournaments/get-events'), 'Must not contain old non-SportAPI endpoints');

    const nextCandidates = getRapidApiCandidateEndpoints('next');
    assert.strictEqual(nextCandidates[0], 'api/v1/unique-tournament/984/season/65427/events/next/0');
    assert.ok(nextCandidates.includes('api/v1/unique-tournament/984/season/65427/events/next/0'));
    assert.ok(!nextCandidates.includes('nativePassThrough'), 'Must not contain nativePassThrough');

    // Simulate SportAPI response on /api/v1/unique-tournament/984/season/65427/events/last/0
    const calledUrls = [];
    const calledOptionsList = [];

    const mockFetchSportApi = async (url, options) => {
      calledUrls.push(url);
      calledOptionsList.push(options);

      const parsedUrl = new URL(url);
      if (parsedUrl.pathname === '/api/v1/unique-tournament/984/season/65427/events/last/0') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            events: [
              {
                id: 5555,
                homeTeam: { id: 102102, name: 'Club Africain' },
                awayTeam: { id: 8153, name: 'Esperance Tunis' },
                status: { type: 'inprogress', code: 31, description: '2nd half' },
                homeScore: { current: 1, period1: 1 },
                awayScore: { current: 1, period1: 0 },
                startTimestamp: 1730000000
              }
            ]
          })
        };
      }
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const res = await fetchTournamentEvents({
      tournamentId: 984,
      seasonId: 65427,
      course: 'last',
      page: 0,
      fetcher: mockFetchSportApi
    });

    const events = extractEventsFromResponse(res);
    assert.strictEqual(events.length, 1, '1 event extracted from SportAPI response');
    assert.strictEqual(events[0].id, 5555);

    // Verify call was made to SportAPI
    assert.strictEqual(calledUrls.length, 1);

    // Verify NO double slashes in constructed URLs
    assert.ok(!calledUrls[0].includes('//api'), 'URL must have single slash');
    assert.ok(!calledUrls[0].includes('//unique-tournament'), 'URL must have single slash');

    const url1 = new URL(calledUrls[0]);
    assert.strictEqual(url1.hostname, 'sportapi7.p.rapidapi.com');
    assert.strictEqual(url1.pathname, '/api/v1/unique-tournament/984/season/65427/events/last/0');

    // Verify RapidAPI headers for SportAPI
    assert.strictEqual(calledOptionsList[0].headers['X-RapidAPI-Host'], 'sportapi7.p.rapidapi.com');
    assert.strictEqual(calledOptionsList[0].headers['X-RapidAPI-Key'], 'test-rapidapi-key-12345');

    // Verify working endpoint was cached
    assert.strictEqual(getCachedWorkingEndpoint(), 'api/v1/unique-tournament/984/season/65427/events/last/0');

    // Subsequent call should use cached working endpoint immediately
    calledUrls.length = 0;
    const res2 = await fetchTournamentEvents({
      tournamentId: 984,
      seasonId: 65427,
      course: 'last',
      page: 0,
      fetcher: mockFetchSportApi
    });
    assert.strictEqual(calledUrls.length, 1, 'Subsequent call uses cached endpoint directly (1 call)');
    assert.strictEqual(new URL(calledUrls[0]).pathname, '/api/v1/unique-tournament/984/season/65427/events/last/0');

    console.log('✓ Dedicated SportAPI tournament endpoints passed successfully (zero double slashes)');
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey !== undefined) process.env.RAPIDAPI_KEY = originalApiKey;
    else delete process.env.RAPIDAPI_KEY;
    if (originalHost !== undefined) process.env.RAPIDAPI_SOFA_HOST = originalHost;
    else delete process.env.RAPIDAPI_SOFA_HOST;
  }

  console.log('All SofaScore integration and batch smart-polling unit tests passed!');
})();
