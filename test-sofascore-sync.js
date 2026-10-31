'use strict';
const assert = require('assert');
const {
  mapSofaScoreStatus,
  parseSofaScoreScore,
  roundInfoFromSofaScore
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
console.log('All SofaScore integration unit tests passed!');
