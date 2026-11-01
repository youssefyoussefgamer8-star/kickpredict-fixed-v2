'use strict';
const assert = require('assert');
const {
  parseFlashscoreFeed,
  flashscoreIdToBigInt,
  bigIntToFlashscoreId,
  formatTunisianTeam,
  getFlashscoreCrest,
  mapFlashscoreStatus,
  parseFlashscoreScore,
  roundInfoFromFlashscore,
  isTunisianLigue1,
  fetchFlashscoreFeed,
  syncTunisianLeague,
  smartPollTunisia,
  purgeLegacyTunisiaMatches
} = require('./sync-tunisia');
const { teamRatings, matchLambdas, buildMatchMarketsPoints } = require('./pricingEngine');

console.log('--- Testing Flashscore ID Conversion ---');
const origId = '4SrepIgn';
const bigIntVal = flashscoreIdToBigInt(origId);
assert.ok(Number.isSafeInteger(bigIntVal), 'Must be safe integer');
assert.strictEqual(bigIntVal, 17178619729887);
const revertedId = bigIntToFlashscoreId(bigIntVal);
assert.strictEqual(revertedId, origId, 'Reversible conversion must match original');
console.log('✓ Flashscore ID reversible conversion verified');

console.log('--- Testing Flashscore Raw Feed Parsing ---');
const sampleFeed = `SA÷1¬~ZA÷TUNISIA: Ligue Professionnelle 1¬ZEE÷lfv2BGo7¬ZB÷190¬ZY÷Tunisia¬ZC÷G4Jhegue¬ZD÷p¬ZE÷6RacM8Ea¬ZF÷0¬ZO÷0¬ZG÷1¬ZH÷190_lfv2BGo7¬ZJ÷2¬ZL÷/football/tunisia/ligue-professionnelle-1/¬OAJ÷YBrafEB7-j18GLkLE.png¬ZX÷00Tunisia¬~AA÷4SrepIgn¬AD÷1793712600¬ADE÷1793712600¬AB÷1¬CR÷1¬AC÷1¬CX÷Stade Tunisien¬WM÷STA¬PX÷IVPZsB67¬AE÷Stade Tunisien¬OA÷O4tnXRT0-GOX2DTa1.png¬WN÷CLU¬PY÷C2lt6Igm¬AF÷Club Africain¬OB÷vRAKqa7k-KARMbQBD.png¬ER÷Round 7¬~AA÷5TseqJho¬AD÷1793719800¬AB÷2¬AC÷17¬CX÷Esperance Tunis¬WM÷EST¬AE÷Esperance Tunis¬AF÷Etoile Sahel¬AG÷1¬AH÷0¬BA÷1¬BB÷0¬~`;

const tournaments = parseFlashscoreFeed(sampleFeed);
assert.strictEqual(tournaments.length, 1);
assert.strictEqual(tournaments[0].tournamentId, 'lfv2BGo7');
assert.strictEqual(tournaments[0].matches.length, 2);
assert.ok(isTunisianLigue1(tournaments[0]), 'Should identify Tunisian Ligue 1');

const m1 = tournaments[0].matches[0];
assert.strictEqual(m1.id, '4SrepIgn');
assert.strictEqual(m1.AE, 'Stade Tunisien');
assert.strictEqual(m1.AF, 'Club Africain');
assert.strictEqual(m1.OA, 'O4tnXRT0-GOX2DTa1.png');
console.log('✓ Raw feed parser extracted tournaments and matches accurately');

console.log('--- Testing Team Name Arabic Translation ---');
assert.strictEqual(formatTunisianTeam('Stade Tunisien'), 'الملعب التونسي');
assert.strictEqual(formatTunisianTeam('Club Africain'), 'النادي الإفريقي');
assert.strictEqual(formatTunisianTeam('Étoile du Sahel'), 'النجم الساحلي');
assert.strictEqual(formatTunisianTeam('Esperance Tunis'), 'الترجي الرياضي');
assert.strictEqual(formatTunisianTeam('النادي الصفاقسي'), 'النادي الصفاقسي');
console.log('✓ Team Arabic name mapping and accent normalization passed');

console.log('--- Testing Flashscore Crest URLs ---');
assert.strictEqual(
  getFlashscoreCrest('O4tnXRT0-GOX2DTa1.png'),
  'https://static.flashscore.com/res/image/data/O4tnXRT0-GOX2DTa1.png'
);
assert.strictEqual(getFlashscoreCrest(null), null);
console.log('✓ Flashscore crest CDN URLs verified');

console.log('--- Testing Flashscore Status Mapping ---');
assert.strictEqual(mapFlashscoreStatus({ AB: '1', AC: '1' }), 'SCHEDULED');
assert.strictEqual(mapFlashscoreStatus({ AB: '2', AC: '1' }), 'IN_PLAY');
assert.strictEqual(mapFlashscoreStatus({ AB: '2', AC: '17' }), 'PAUSED'); // Halftime
assert.strictEqual(mapFlashscoreStatus({ AB: '2', AC: '2' }), 'IN_PLAY');
assert.strictEqual(mapFlashscoreStatus({ AB: '3', AC: '3' }), 'FINISHED');
assert.strictEqual(mapFlashscoreStatus({ AB: '4', AC: '11' }), 'POSTPONED');
assert.strictEqual(mapFlashscoreStatus({ AB: '1', AC: '12' }), 'CANCELLED');
console.log('✓ Status mapping verified across all Flashscore status codes');

console.log('--- Testing Score Parsing ---');
const finishedMatch = { AB: '3', AC: '3', AG: '2', AH: '1', BA: '1', BB: '0' };
const s1 = parseFlashscoreScore(finishedMatch, 'FINISHED');
assert.strictEqual(s1.home, 2);
assert.strictEqual(s1.away, 1);
assert.strictEqual(s1.homeHt, 1);
assert.strictEqual(s1.awayHt, 0);

const liveMatch = { AB: '2', AC: '1', AG: '1', AH: '0' };
const s2 = parseFlashscoreScore(liveMatch, 'IN_PLAY');
assert.strictEqual(s2.home, 1);
assert.strictEqual(s2.away, 0);

const scheduledMatch = { AB: '1', AC: '1' };
const s3 = parseFlashscoreScore(scheduledMatch, 'SCHEDULED');
assert.strictEqual(s3.home, null);
assert.strictEqual(s3.away, null);

// Direct numeric format
const s4 = parseFlashscoreScore(0, 0, 'IN_PLAY');
assert.strictEqual(s4.home, 0);
assert.strictEqual(s4.away, 0);
console.log('✓ Score and half-time parsing verified');

console.log('--- Testing Round Info Extraction ---');
const r1 = roundInfoFromFlashscore({ ER: 'Round 7' });
assert.strictEqual(r1.matchday, 7);
assert.strictEqual(r1.key, 'MD:7');
assert.strictEqual(r1.label, 'الجولة 7');

const r2 = roundInfoFromFlashscore({ ER: 'الجولة 14' });
assert.strictEqual(r2.matchday, 14);
assert.strictEqual(r2.key, 'MD:14');
console.log('✓ Round info extraction passed');

console.log('--- Testing Poisson Pricing Integration with Flashscore Data ---');
const mockEvents = [
  { homeId: 8239, awayId: 8234, homeGoals: 1, awayGoals: 0 },
  { homeId: 8235, awayId: 8237, homeGoals: 2, awayGoals: 1 },
  { homeId: 8234, awayId: 8235, homeGoals: 3, awayGoals: 1 },
  { homeId: 8238, awayId: 8233, homeGoals: 0, awayGoals: 0 }
];

const model = teamRatings(mockEvents);
const { lambdaHome, lambdaAway } = matchLambdas(8239, 8234, model);
const markets = buildMatchMarketsPoints(lambdaHome, lambdaAway);
assert.ok(markets.outcome_1x2.HOME > 0);
assert.ok(markets.outcome_1x2.DRAW > 0);
assert.ok(markets.outcome_1x2.AWAY > 0);
console.log('✓ Pricing engine integration verified');

console.log('--- Testing PostgreSQL Legacy Purge ---');
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
  console.log('✓ Legacy Tunisian matches purge verified');

  console.log('--- Testing Midnight 4-Day Cron Job ---');
  const insertedRows = [];
  const midnightPool = {
    query: async (sql, params) => {
      if (sql.includes('SELECT home_score')) return { rows: [] };
      if (sql.includes('INSERT INTO matches')) {
        insertedRows.push({
          external_id: params[0],
          home_team: params[4],
          home_crest: params[5],
          away_team: params[6],
          away_crest: params[7],
          utc_date: params[8],
          status: params[9]
        });
        return { rowCount: 1 };
      }
      return { rows: [] };
    }
  };

  const mockMidnightFetcher = async (url) => {
    // Return sample feed for Day 2, empty for other days
    if (url.includes('f_1_2_2_ar_1')) {
      return {
        ok: true,
        text: async () => sampleFeed
      };
    }
    return {
      ok: true,
      text: async () => 'SA÷1¬~'
    };
  };

  const fetchedFixtures = await syncTunisianLeague(midnightPool, {
    fetcher: mockMidnightFetcher,
    daysCount: 4
  });

  assert.strictEqual(fetchedFixtures.length, 2, '2 fixtures discovered across 4 days');
  assert.strictEqual(insertedRows.length, 2, '2 fixtures inserted into PostgreSQL');
  assert.strictEqual(insertedRows[0].home_team, 'الملعب التونسي');
  assert.strictEqual(insertedRows[0].away_team, 'النادي الإفريقي');
  assert.strictEqual(insertedRows[0].status, 'SCHEDULED');
  assert.strictEqual(insertedRows[0].home_crest, 'https://static.flashscore.com/res/image/data/O4tnXRT0-GOX2DTa1.png');
  console.log('✓ Midnight Cron Job fetched 4-day window and cached fixtures in DB');

  console.log('--- Testing Just-in-Time Polling Gate Condition ---');
  // 1. Gate Condition Test: ZERO live matches -> strictly outputs Idling: No live matches and 0 HTTP requests
  let networkCalls = 0;
  const mockPollingFetcher = async () => {
    networkCalls++;
    return {
      ok: true,
      text: async () => ''
    };
  };

  const emptyPool = {
    query: async () => ({ rows: [] })
  };

  let capturedLogs = [];
  const origLog = console.log;
  console.log = (...args) => {
    capturedLogs.push(args.join(' '));
    origLog(...args);
  };

  await smartPollTunisia(emptyPool, { fetcher: mockPollingFetcher });
  console.log = origLog;

  assert.strictEqual(networkCalls, 0, 'Zero network calls must be made when no matches are live');
  assert.ok(
    capturedLogs.some(l => l.includes('Idling: No live matches')),
    'Must log "Idling: No live matches"'
  );
  console.log('✓ Strict Gate Condition verified: zero network calls when no match is live');

  // 2. Live Match in progress -> Exactly 1 surgical request to Flashscore feed
  networkCalls = 0;
  const activeDbMatches = [
    {
      id: 10,
      external_id: flashscoreIdToBigInt('5TseqJho'),
      home_team: 'الترجي الرياضي',
      away_team: 'النجم الساحلي',
      utc_date: new Date(Date.now() - 3600000).toISOString(),
      status: 'IN_PLAY',
      home_score: 0,
      away_score: 0,
      home_ht: null,
      away_ht: null
    }
  ];

  const updatedParams = [];
  const livePool = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id, external_id')) {
        return { rows: activeDbMatches };
      }
      if (sql.includes('UPDATE matches')) {
        updatedParams.push(params);
        return { rowCount: 1 };
      }
      return { rows: [] };
    }
  };

  let settled = false;
  let reconciled = null;

  await smartPollTunisia(livePool, {
    settleFinishedMatches: async () => { settled = true; },
    reconcileScoreCorrections: async (rows) => { reconciled = rows; },
    fetcher: async (url) => {
      networkCalls++;
      return {
        ok: true,
        text: async () => sampleFeed
      };
    }
  });

  assert.strictEqual(networkCalls, 1, 'Exactly 1 request made to Flashscore during live match');
  assert.strictEqual(updatedParams.length, 1, 'Match record updated with live score from Flashscore');
  assert.strictEqual(updatedParams[0][0], 'PAUSED'); // Halftime AC:17
  assert.strictEqual(updatedParams[0][1], 1); // Home score AG: 1
  assert.strictEqual(updatedParams[0][2], 0); // Away score AH: 0
  assert.strictEqual(updatedParams[0][3], 1); // Home HT BA: 1
  assert.strictEqual(updatedParams[0][4], 0); // Away HT BB: 0
  assert.strictEqual(reconciled.length, 1);
  console.log('✓ Just-in-Time live polling accurately updated live scores and status');

  console.log('\nAll Flashscore sync and Just-in-Time unit & integration tests passed cleanly!');
})();
