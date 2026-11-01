'use strict';
const assert = require('node:assert/strict');

process.env.ENABLE_ODDS_API = 'true';
process.env.ODDS_PROVIDER = 'the-odds-api';
process.env.THE_ODDS_API_KEY = 'unit-test-key';
process.env.ODDS_WINDOW_DAYS = '7';

const oddsProvider = require('./oddsProvider');

async function run() {
  const kickoff = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify([{
      id: 'test-event-1',
      commence_time: kickoff,
      home_team: 'Team Alpha',
      away_team: 'Team Beta',
      bookmakers: [{
        key: 'testbook',
        markets: [{
          key: 'h2h',
          outcomes: [
            { name: 'Team Alpha', price: 1.95 },
            { name: 'Draw', price: 3.35 },
            { name: 'Team Beta', price: 4.1 }
          ]
        }, {
          key: 'totals',
          outcomes: [
            { name: 'Over', point: 2.5, price: 1.9 },
            { name: 'Under', point: 2.5, price: 1.95 }
          ]
        }]
      }]
    }]), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-requests-remaining': '499' }
    });
  };

  const updates = [];
  const pool = {
    async query(sql, params) {
      if (/^\s*SELECT id, competition_code/.test(sql)) {
        return { rows: [{
          id: 42,
          competition_code: 'PL',
          home_team: 'Team Alpha',
          away_team: 'Team Beta',
          utc_date: kickoff,
          status: 'SCHEDULED',
          home_lambda: 1.45,
          away_lambda: 1.15
        }] };
      }
      if (/^\s*UPDATE matches/.test(sql)) {
        updates.push({ sql, params });
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected pool query in test: ${sql.slice(0, 80)}`);
    }
  };

  const summary = await oddsProvider.refreshUpcomingOdds(pool, ['PL']);
  assert.equal(calls.length, 1, 'must request the events once');
  assert.equal(summary.updated, 1, 'should update the mapped match without ReferenceError');
  assert.equal(updates.length, 1, 'should execute one UPDATE statement');
  assert.equal(updates[0].params[0], 42, 'should update the matched database row');
  const points = JSON.parse(updates[0].params[1]);
  assert.ok(points.outcome_1x2.HOME >= 10, 'should persist bookmaker-derived 1X2 points');
  assert.equal(points._meta.expected_goals_source, 'bookmaker_1x2_fit');
  console.log('The Odds API refresh integration test passed.');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
