'use strict';
const assert = require('node:assert/strict');
const pricing = require('./pricingEngine');
const oddsProvider = require('./oddsProvider');

function assertPointTable(actual, selections, label) {
  assert.ok(actual && typeof actual === 'object', `${label} must be an object`);
  for (const selection of selections) {
    assert.ok(Number.isFinite(actual[selection]), `${label}.${selection} must be numeric`);
    assert.ok(actual[selection] >= 0, `${label}.${selection} must not be negative`);
  }
}

function run() {
  const model = pricing.buildMarketsPoints(1.45, 1.15);
  assertPointTable(model.outcome_1x2, ['HOME', 'DRAW', 'AWAY'], 'model.outcome_1x2');
  assert.equal(Object.keys(model.exact_score).length, 64, '0-7 exact score grid must have 64 selections');
  assert.equal(pricing.buildMatchMarketsPoints, pricing.buildMarketsPoints, 'legacy export alias must work');

  for (const [market, selections] of Object.entries(pricing.EXTRA_MARKETS)) {
    assertPointTable(model.extras[market], selections, `model.extras.${market}`);
  }

  const outcome = pricing.resolveMarkets({ home: 2, away: 1, htHome: 1, htAway: 1 });
  assert.equal(outcome.outcome_1x2, 'HOME');
  assert.equal(outcome.exact_score, '2-1');
  assert.equal(outcome.extras.ou_2_5, 'OVER');
  assert.equal(outcome.extras.more_goals_half, 'FIRST');

  const oddsPriced = pricing.buildMatchMarketsPointsFromOdds({
    outcome_1x2: { HOME: 2.1, DRAW: 3.4, AWAY: 3.7 },
    exact_score: { '1-0': 7.5, '1-1': 6.8, '2-1': 9.2 },
    extras: {
      over_under_2_5: { OVER: 1.9, UNDER: 1.95 },
      odd_even_goals: { ODD: 1.95, EVEN: 1.9 }
    }
  }, 1.6, 1.1);

  assertPointTable(oddsPriced.outcome_1x2, ['HOME', 'DRAW', 'AWAY'], 'odds.outcome_1x2');
  assertPointTable(oddsPriced.exact_score, ['0-0', '1-0', '1-1', '2-1', '7-7'], 'odds.exact_score');
  assertPointTable(oddsPriced.extras.ou_2_5, ['OVER', 'UNDER'], 'odds.extras.ou_2_5');
  assertPointTable(oddsPriced.extras.goals_odd_even, ['ODD', 'EVEN'], 'odds.extras.goals_odd_even');
  assert.deepEqual(oddsPriced._meta.odds_priced_markets, [
    'outcome_1x2', 'exact_score', 'extras.ou_2_5', 'extras.goals_odd_even'
  ]);
  assert.equal(oddsPriced._meta.expected_goals_source, 'bookmaker_1x2_fit');
  assert.equal(oddsPriced._meta.expected_goals.home >= 0.3 && oddsPriced._meta.expected_goals.home <= 3.8, true);
  assert.equal(oddsPriced._meta.expected_goals.away >= 0.3 && oddsPriced._meta.expected_goals.away <= 3.8, true);
  assert.ok(oddsPriced._meta.model_priced_markets.includes('exact_score_unquoted_selections'));
  assert.equal(oddsPriced._meta.model_priced, true, 'markets absent from the feed should use model fallback');

  const strongHomeOdds = pricing.buildMatchMarketsPointsFromOdds({
    outcome_1x2: { HOME: 1.25, DRAW: 6.5, AWAY: 12.0 }
  }, 1.45, 1.15);
  assert.notDeepEqual(strongHomeOdds._meta.expected_goals, { home: 1.45, away: 1.15 },
    '1X2 odds should inform expected goals used for model-priced markets');

  assert.equal(typeof oddsProvider.refreshUpcomingOdds, 'function');
  assert.equal(typeof oddsProvider.parseTheOddsApiEvent, 'function');

  const parsedEvent = oddsProvider.parseTheOddsApiEvent({
    id: 'test-event',
    home_team: 'Manchester United',
    away_team: 'Chelsea',
    bookmakers: [{
      key: 'testbook',
      markets: [
        { key: 'h2h', outcomes: [
          { name: 'Manchester United', price: 2.1 },
          { name: 'Draw', price: 3.4 },
          { name: 'Chelsea', price: 3.6 }
        ] },
        { key: 'totals', outcomes: [
          { name: 'Over', point: 2.5, price: 1.9 },
          { name: 'Under', point: 2.5, price: 1.95 }
        ] }
      ]
    }]
  });
  assert.ok(parsedEvent, 'The Odds API event parser should accept a valid h2h feed');
  assert.deepEqual(Object.keys(parsedEvent.outcome_1x2).sort(), ['AWAY', 'DRAW', 'HOME']);
  assert.deepEqual(parsedEvent.extras.over_under_2_5, { OVER: 1.9, UNDER: 1.95 });
  console.log('All pricing, odds parsing, and settlement unit tests passed.');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
