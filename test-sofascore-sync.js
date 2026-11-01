'use strict';
const assert = require('assert');
const {
  map365ScoresStatus,
  parse365ScoresScore,
  roundInfoFrom365Scores,
  get365ScoresCrest,
  fetch365ScoresGames,
  smartPollTunisia,
  syncTunisianLeague,
  purgeLegacyTunisiaMatches,
  COMPETITION_ID,
  BASE_URL
} = require('./sync-tunisia');
const { teamRatings, matchLambdas, buildMatchMarketsPoints } = require('./pricingEngine');

console.log('--- Testing 365Scores Status Mapping ---');
assert.strictEqual(map365ScoresStatus({ statusGroup: 4, statusText: 'انتهت' }), 'FINISHED');
assert.strictEqual(map365ScoresStatus({ statusGroup: 3, statusText: 'شوط 1' }), 'IN_PLAY');
assert.strictEqual(map365ScoresStatus({ statusGroup: 3, statusText: 'شوط 2' }), 'IN_PLAY');
assert.strictEqual(map365ScoresStatus({ statusGroup: 1, statusText: 'استراحة' }), 'PAUSED');
assert.strictEqual(map365ScoresStatus({ statusGroup: 2, statusText: 'لم تبدأ' }), 'SCHEDULED');
assert.strictEqual(map365ScoresStatus({ statusGroup: 4, statusText: 'تأجلت' }), 'POSTPONED');
assert.strictEqual(map365ScoresStatus({ statusGroup: 5, statusText: 'ألغيت' }), 'CANCELLED');
assert.strictEqual(map365ScoresStatus({ statusGroup: 2, statusText: 'مؤجلة', shortStatusText: 'تأجلت' }), 'POSTPONED');

// Backwards compatibility format checks
assert.strictEqual(map365ScoresStatus({ type: 'finished', code: 100 }), 'FINISHED');
assert.strictEqual(map365ScoresStatus({ type: 'inprogress', code: 6, description: '1st half' }), 'IN_PLAY');
assert.strictEqual(map365ScoresStatus({ type: 'inprogress', code: 7, description: 'Halftime' }), 'PAUSED');
assert.strictEqual(map365ScoresStatus({ type: 'notstarted', code: 0 }), 'SCHEDULED');
assert.strictEqual(map365ScoresStatus({ type: 'postponed', code: 60 }), 'POSTPONED');
assert.strictEqual(map365ScoresStatus({ type: 'canceled', code: 70 }), 'CANCELLED');
console.log('✓ All 365Scores Status Mappings passed');

console.log('--- Testing 365Scores Score Parsing ---');
// 1. Full 365Scores game object
const finishedGame = {
  statusGroup: 4,
  statusText: 'انتهت',
  homeCompetitor: { score: 2 },
  awayCompetitor: { score: 1 },
  stages: [
    { id: 7, name: 'First Half', homeCompetitorScore: 1, awayCompetitorScore: 0 }
  ]
};
const parsedFinished = parse365ScoresScore(finishedGame, 'FINISHED');
assert.strictEqual(parsedFinished.home, 2);
assert.strictEqual(parsedFinished.away, 1);
assert.strictEqual(parsedFinished.homeHt, 1);
assert.strictEqual(parsedFinished.awayHt, 0);

// 2. Live in-play game
const liveGame = {
  statusGroup: 3,
  statusText: 'شوط 2',
  homeCompetitor: { score: 1 },
  awayCompetitor: { score: 0 },
  stages: [
    { id: 7, name: 'First Half', homeCompetitorScore: 1, awayCompetitorScore: 0 }
  ]
};
const parsedLive = parse365ScoresScore(liveGame, 'IN_PLAY');
assert.strictEqual(parsedLive.home, 1);
assert.strictEqual(parsedLive.away, 0);
assert.strictEqual(parsedLive.homeHt, 1);
assert.strictEqual(parsedLive.awayHt, 0);

// 3. Scheduled game (-1 scores from 365Scores)
const scheduledGame = {
  statusGroup: 2,
  statusText: 'لم تبدأ',
  homeCompetitor: { score: -1 },
  awayCompetitor: { score: -1 }
};
const parsedScheduled = parse365ScoresScore(scheduledGame, 'SCHEDULED');
assert.strictEqual(parsedScheduled.home, null);
assert.strictEqual(parsedScheduled.away, null);

// 4. Numeric direct parameters
const numericScore = parse365ScoresScore(3, 1, 'FINISHED');
assert.strictEqual(numericScore.home, 3);
assert.strictEqual(numericScore.away, 1);

const zeroZeroScore = parse365ScoresScore(0, 0, 'IN_PLAY');
assert.strictEqual(zeroZeroScore.home, 0);
assert.strictEqual(zeroZeroScore.away, 0);

// 5. SofaScore-style period objects
const sofaStyleScore = parse365ScoresScore(
  { current: 2, period1: 1 },
  { current: 1, period1: 0 },
  'FINISHED'
);
assert.strictEqual(sofaStyleScore.home, 2);
assert.strictEqual(sofaStyleScore.away, 1);
assert.strictEqual(sofaStyleScore.homeHt, 1);
assert.strictEqual(sofaStyleScore.awayHt, 0);
console.log('✓ All 365Scores Score Parsing tests passed');

console.log('--- Testing 365Scores Crest URL & Round Info ---');
assert.strictEqual(
  get365ScoresCrest(8233),
  'https://imagecache.365scores.com/image/upload/f_png,w_80,h_80,c_limit,q_auto:best/competitors/8233'
);
assert.strictEqual(get365ScoresCrest(null), null);

const r1 = roundInfoFrom365Scores({ roundNum: 8, roundName: 'الجولة' });
assert.strictEqual(r1.matchday, 8);
assert.strictEqual(r1.key, 'MD:8');
assert.strictEqual(r1.label, 'الجولة 8');

const r2 = roundInfoFrom365Scores({ roundName: 'Championship Playoff 1' });
assert.strictEqual(r2.matchday, null);
assert.strictEqual(r2.key, 'CHAMPIONSHIP_PLAYOFF_1');

const r3 = roundInfoFrom365Scores({ stageNum: 2 });
assert.strictEqual(r3.matchday, null);
assert.strictEqual(r3.key, 'STAGE_2');
console.log('✓ Crest URL and Round Info extraction tests passed');

console.log('--- Testing Pricing Engine Integration with 365Scores Data ---');
const mockFinished365Events = [
  {
    homeId: 8239, // Club Africain
    awayId: 8234, // Esperance
    homeGoals: 1,
    awayGoals: 0
  },
  {
    homeId: 8235, // Etoile du Sahel
    awayId: 8237, // CS Sfaxien
    homeGoals: 2,
    awayGoals: 1
  },
  {
    homeId: 8234, // Esperance
    awayId: 8235, // Etoile du Sahel
    homeGoals: 3,
    awayGoals: 1
  },
  {
    homeId: 8238, // US Monastir
    awayId: 8233, // Stade Tunisien
    homeGoals: 0,
    awayGoals: 0
  }
];

const model = teamRatings(mockFinished365Events);
assert.ok(model.avgHome > 0, 'avgHome should be positive');
assert.ok(model.avgAway > 0, 'avgAway should be positive');

const { lambdaHome, lambdaAway } = matchLambdas(8239, 8234, model);
assert.ok(Number.isFinite(lambdaHome) && lambdaHome > 0, 'lambdaHome is valid');
assert.ok(Number.isFinite(lambdaAway) && lambdaAway > 0, 'lambdaAway is valid');

const markets = buildMatchMarketsPoints(lambdaHome, lambdaAway);
assert.ok(markets.outcome_1x2.HOME > 0, '1X2 HOME points calculated');
assert.ok(markets.outcome_1x2.DRAW > 0, '1X2 DRAW points calculated');
assert.ok(markets.outcome_1x2.AWAY > 0, '1X2 AWAY points calculated');
assert.ok(markets.exact_score['1-0'] > 0, 'Exact score 1-0 points calculated');
assert.ok(markets.extras.ou_2_5.OVER > 0, 'Extras ou_2_5 OVER points calculated');
console.log('✓ Poisson pricing engine integration test passed successfully!');

console.log('--- Testing PostgreSQL Legacy Tunisia Purge ---');
(async () => {
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

  console.log('--- Testing Aggregated Smart Polling for Concurrent Matches via 365Scores ---');
  // 1. Zero active matches in DB should result in 0 HTTP requests
  let fetchCount = 0;
  const mockFetcher = async () => {
    fetchCount++;
    return {
      ok: true,
      json: async () => ({ games: [] })
    };
  };

  const emptyPool = {
    query: async () => ({ rows: [] })
  };

  await smartPollTunisia(emptyPool, { fetcher: mockFetcher });
  assert.strictEqual(fetchCount, 0, 'Zero requests should be sent when no matches are active in DB');
  console.log('✓ Zero requests sent when no matches are active');

  // 2. 4 concurrent matches playing simultaneously -> exactly 1 aggregated request to 365Scores
  fetchCount = 0;
  let requestedUrl = null;

  const mockBatchFetcher = async (url) => {
    fetchCount++;
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({
        games: [
          {
            id: 1001,
            statusGroup: 3,
            statusText: 'شوط 2',
            homeCompetitor: { id: 8233, name: 'الملعب التونسي', score: 2 },
            awayCompetitor: { id: 8234, name: 'الترجي', score: 1 },
            stages: [{ id: 7, homeCompetitorScore: 1, awayCompetitorScore: 0 }]
          },
          {
            id: 1002,
            statusGroup: 1,
            statusText: 'استراحة',
            homeCompetitor: { id: 8235, name: 'النجم الساحلي', score: 0 },
            awayCompetitor: { id: 8237, name: 'النادي الصفاقسي', score: 0 },
            stages: [{ id: 7, homeCompetitorScore: 0, awayCompetitorScore: 0 }]
          },
          {
            id: 1003,
            statusGroup: 4,
            statusText: 'انتهت',
            homeCompetitor: { id: 8238, name: 'الاتحاد المنستيري', score: 3 },
            awayCompetitor: { id: 8239, name: 'النادي الأفريقي', score: 2 },
            stages: [{ id: 7, homeCompetitorScore: 1, awayCompetitorScore: 1 }]
          },
          {
            id: 1004,
            statusGroup: 3,
            statusText: 'شوط 1',
            homeCompetitor: { id: 8236, name: 'الترجي الجرجيسي', score: 1 },
            awayCompetitor: { id: 8240, name: 'النادي البنزرتي', score: 0 },
            stages: [{ id: 7, homeCompetitorScore: 1, awayCompetitorScore: 0 }]
          }
        ]
      })
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
  assert.ok(requestedUrl.includes('competitions=554'), 'URL must target 365Scores competition 554');
  assert.ok(requestedUrl.includes('langId=27'), 'URL must include Arabic langId=27');
  console.log('✓ Exactly 1 aggregated 365Scores request sent for 4 concurrent matches');

  // Verify all 4 matches were updated
  assert.strictEqual(updatedDbRows.length, 4, 'All 4 matches should have been updated from the single batch response');
  assert.strictEqual(updatedDbRows[0].status, 'IN_PLAY');
  assert.strictEqual(updatedDbRows[0].home_score, 2);
  assert.strictEqual(updatedDbRows[0].away_score, 1);

  assert.strictEqual(updatedDbRows[1].status, 'PAUSED'); // Halftime
  assert.strictEqual(updatedDbRows[1].home_score, 0);
  assert.strictEqual(updatedDbRows[1].away_score, 0);

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

  console.log('--- Testing Full 365Scores Sync with Arabic Names ---');
  const upsertedRows = [];
  const fullSyncPool = {
    query: async (sql, params) => {
      if (sql.includes('SELECT home_score')) return { rows: [] };
      if (sql.includes('INSERT INTO matches')) {
        upsertedRows.push({
          external_id: params[0],
          matchday: params[1],
          round_key: params[2],
          round_label: params[3],
          home_team: params[4],
          home_crest: params[5],
          away_team: params[6],
          away_crest: params[7],
          utc_date: params[8],
          status: params[9],
          home_score: params[10],
          away_score: params[11]
        });
        return { rowCount: 1 };
      }
      return { rows: [] };
    }
  };

  const mockFullSyncFetcher = async (url) => {
    if (url.includes('/results/')) {
      return {
        ok: true,
        json: async () => ({
          games: [
            {
              id: 4800323,
              competitionId: 554,
              roundNum: 6,
              roundName: 'الجولة',
              startTime: '2026-10-29T14:30:00+01:00',
              statusGroup: 4,
              statusText: 'انتهت',
              homeCompetitor: { id: 8233, name: 'الملعب التونسي', score: 1 },
              awayCompetitor: { id: 8236, name: 'الترجي الجرجيسي', score: 0 }
            }
          ]
        })
      };
    }
    if (url.includes('/current/')) {
      return {
        ok: true,
        json: async () => ({
          games: [
            {
              id: 4797637,
              competitionId: 554,
              roundNum: 7,
              roundName: 'الجولة',
              startTime: '2026-11-03T14:30:00+01:00',
              statusGroup: 2,
              statusText: 'لم تبدأ',
              homeCompetitor: { id: 8233, name: 'الملعب التونسي', score: -1 },
              awayCompetitor: { id: 8239, name: 'النادي الأفريقي', score: -1 }
            }
          ]
        })
      };
    }
    return { ok: false, status: 404 };
  };

  await syncTunisianLeague(fullSyncPool, { fetcher: mockFullSyncFetcher });
  assert.strictEqual(upsertedRows.length, 2, 'Two matches upserted into matches table');
  
  // Verify finished result
  const resMatch = upsertedRows.find(m => m.external_id === 4800323);
  assert.ok(resMatch);
  assert.strictEqual(resMatch.home_team, 'الملعب التونسي');
  assert.strictEqual(resMatch.away_team, 'الترجي الجرجيسي');
  assert.strictEqual(resMatch.status, 'FINISHED');
  assert.strictEqual(resMatch.home_score, 1);
  assert.strictEqual(resMatch.away_score, 0);
  assert.strictEqual(resMatch.home_crest, 'https://imagecache.365scores.com/image/upload/f_png,w_80,h_80,c_limit,q_auto:best/competitors/8233');

  // Verify scheduled fixture
  const curMatch = upsertedRows.find(m => m.external_id === 4797637);
  assert.ok(curMatch);
  assert.strictEqual(curMatch.home_team, 'الملعب التونسي');
  assert.strictEqual(curMatch.away_team, 'النادي الأفريقي');
  assert.strictEqual(curMatch.status, 'SCHEDULED');
  assert.strictEqual(curMatch.home_score, null);
  assert.strictEqual(curMatch.away_score, null);

  console.log('✓ Full 365Scores sync upserted Arabic match records and Poisson markets successfully');
  console.log('All 365Scores unit and integration tests passed cleanly!');
})();
