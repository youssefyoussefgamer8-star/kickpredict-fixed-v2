'use strict';
const assert = require('assert');
const {
  cleanTeamName,
  teamsMatch,
  mapFotmobPosition,
  parseFotmobLineup,
  findFotmobMatchId,
  fetchFotmobLineup,
  smartLivePollingFotmob
} = require('./sync-fotmob');

console.log('--- Testing FotMob Module ---');

// 1. Team Name Matching & Zombie Match Handling
assert.ok(teamsMatch('FC Barcelona', 'Barcelona'));
assert.ok(teamsMatch('Aston Villa', 'Aston Villa FC'));
assert.ok(teamsMatch('Paris Saint-Germain', 'PSG'));
assert.ok(teamsMatch('Atl. Madrid', 'Atlético Madrid'));
assert.ok(teamsMatch('Bayern Munich', 'Bayern München'));
assert.ok(teamsMatch('Manchester Utd', 'Manchester United'), 'Manchester Utd alias match');
assert.ok(teamsMatch('AS Roma', 'Roma'), 'AS Roma alias match');
assert.ok(teamsMatch('Bodo/Glimt', 'Bodø/Glimt'), 'Bodø/Glimt special diacritic match');
assert.ok(teamsMatch('Galatasaray', 'Galatasaray'));
assert.ok(teamsMatch('Stuttgart', 'VfB Stuttgart'), 'Stuttgart alias match');
assert.ok(teamsMatch('Dep. A Coruna', 'Deportivo A Coruña'), 'Deportivo A Coruña alias match');
assert.ok(teamsMatch('Ath Bilbao', 'Athletic Club'), 'Athletic Club alias match');
assert.strictEqual(teamsMatch('Real Madrid', 'Barcelona'), false);
console.log('✓ Fuzzy team matching verified for FotMob (including Bodø/Glimt, Manchester Utd, and A Coruña)');

// 2. Position Mapping
assert.strictEqual(mapFotmobPosition(0, 11, 0), 'GK');
assert.strictEqual(mapFotmobPosition(1, 33, 1), 'DF');
assert.strictEqual(mapFotmobPosition(2, 58, 5), 'MF');
assert.strictEqual(mapFotmobPosition(3, 115, 10), 'FW');
console.log('✓ Position mapping verified');

// 3. Mock Lineup Parsing
const mockData = {
  content: {
    matchFacts: {
      events: {
        events: [
          { type: 'Goal', time: 10, player: { id: 1001, name: 'Lamine Yamal' } },
          { type: 'Card', time: 25, card: 'Yellow', player: { id: 1002, name: 'Pedri' } },
          {
            type: 'Substitution',
            time: 60,
            swap: [
              { id: 1003, name: 'Gavi' },
              { id: 1002, name: 'Pedri' }
            ]
          }
        ]
      }
    },
    lineup: {
      lineupType: 'confirmed',
      homeTeam: {
        name: 'Barcelona',
        formation: '4-2-3-1',
        coach: { name: 'Hansi Flick' },
        starters: [
          { id: 999, name: 'Joan García', shirtNumber: '1', usualPlayingPositionId: 0, performance: { rating: 8.0 } },
          { id: 1001, name: 'Lamine Yamal', shirtNumber: '10', usualPlayingPositionId: 3, performance: { rating: 8.5 } },
          { id: 1002, name: 'Pedri', shirtNumber: '8', usualPlayingPositionId: 2, performance: { rating: 7.5 } }
        ],
        subs: [
          { id: 1003, name: 'Gavi', shirtNumber: '6', usualPlayingPositionId: 2, performance: { rating: 6.8 } }
        ]
      },
      awayTeam: {
        name: 'Aston Villa',
        formation: '4-2-3-1',
        coach: { name: 'Unai Emery' },
        starters: [
          { id: 888, name: 'Zion Suzuki', shirtNumber: '1', usualPlayingPositionId: 0, performance: { rating: 6.5 } }
        ],
        subs: []
      }
    }
  }
};

const parsed = parseFotmobLineup(mockData);
assert.ok(parsed, 'Parsed lineup must be non-null');
assert.strictEqual(parsed.source, 'fotmob');
assert.strictEqual(parsed.confirmed, true);
assert.strictEqual(parsed.formationHome, '4-2-3-1');
assert.strictEqual(parsed.formationAway, '4-2-3-1');
assert.strictEqual(parsed.managerHome, 'Hansi Flick');
assert.strictEqual(parsed.managerAway, 'Unai Emery');

// Check starters
assert.strictEqual(parsed.startingHome.length, 3);
assert.strictEqual(parsed.startingHome[0].name, 'Joan García');
assert.strictEqual(parsed.startingHome[0].pos, 'GK');
assert.strictEqual(parsed.startingHome[0].photo, 'https://images.fotmob.com/image_resources/playerimages/999.png');
assert.strictEqual(parsed.startingHome[0].rating, '8');

// Check events
assert.strictEqual(parsed.startingHome[1].name, 'Lamine Yamal');
assert.strictEqual(parsed.startingHome[1].events[0].type, 'goal');
assert.strictEqual(parsed.startingHome[2].name, 'Pedri');
assert.strictEqual(parsed.startingHome[2].events[0].type, 'yellow_card');
assert.strictEqual(parsed.startingHome[2].events[1].type, 'sub');

// Check subs
assert.strictEqual(parsed.subsHome.length, 1);
assert.strictEqual(parsed.subsHome[0].name, 'Gavi');
assert.strictEqual(parsed.subsHome[0].events[0].type, 'sub_in');

console.log('✓ Mock lineup parsing and events mapping verified');

// 4. Live Test on Real Match (Barcelona vs Aston Villa)
(async () => {
  console.log('Testing Live FotMob Lineup fetch for Barcelona vs Aston Villa...');
  const realLineup = await fetchFotmobLineup('Barcelona', 'Aston Villa', '2026-11-03T20:00:00.000Z');
  assert.ok(realLineup, 'Real lineup must be fetched from FotMob');
  assert.strictEqual(realLineup.startingHome.length, 11, 'Should have 11 home starters');
  assert.strictEqual(realLineup.startingAway.length, 11, 'Should have 11 away starters');
  assert.ok(realLineup.managerHome, 'Home manager must be present');
  assert.ok(realLineup.managerAway, 'Away manager must be present');
  assert.strictEqual(realLineup.scores?.home, 3, 'Barcelona score must be 3');
  assert.strictEqual(realLineup.scores?.away, 0, 'Aston Villa score must be 0');
  assert.strictEqual(realLineup.status, 'FINISHED', 'Status must be FINISHED');
  console.log(`✓ Real FotMob lineup fetched successfully! (${realLineup.startingHome.length} home, ${realLineup.startingAway.length} away players)`);
  console.log(`  Home Manager: ${realLineup.managerHome} | Away Manager: ${realLineup.managerAway}`);
  console.log(`  Real Score Extracted: ${realLineup.scores.home} - ${realLineup.scores.away} (Status: ${realLineup.status})`);
  console.log(`  Sample Starters: ${realLineup.startingHome[0].name} (#${realLineup.startingHome[0].num}), ${realLineup.startingAway[0].name} (#${realLineup.startingAway[0].num})`);

  // 5. Test smartLivePollingFotmob Gate & Updates
  console.log('\nTesting smartLivePollingFotmob...');
  let networkCalls = 0;
  const emptyPool = {
    query: async () => ({ rows: [] })
  };
  await smartLivePollingFotmob(emptyPool, {
    fetcher: async () => {
      networkCalls++;
      return { ok: true, json: async () => ({ leagues: [] }) };
    }
  });
  assert.strictEqual(networkCalls, 0, 'Gate condition: zero network calls when no active matches in DB');
  console.log('✓ smartLivePollingFotmob gate passed (0 calls when idle)');

  // Active match test
  const activeMatch = {
    id: 101,
    home_team: 'Barcelona',
    away_team: 'Aston Villa',
    status: 'IN_PLAY',
    utc_date: '2026-11-03T20:00:00.000Z',
    home_score: 0,
    away_score: 0
  };

  const updatedQueries = [];
  const livePool = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id, external_id')) {
        return { rows: [activeMatch] };
      }
      if (sql.includes('UPDATE matches')) {
        updatedQueries.push({ sql, params });
        return { rowCount: 1 };
      }
      return { rows: [] };
    }
  };

  await smartLivePollingFotmob(livePool, {
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        leagues: [
          {
            matches: [
              {
                id: 6106263,
                home: { name: 'Barcelona', score: 3 },
                away: { name: 'Aston Villa', score: 0 },
                status: { finished: true, reason: { short: 'FT' } }
              }
            ]
          }
        ]
      })
    })
  });

  assert.strictEqual(updatedQueries.length, 1, 'Match record must be updated');
  assert.strictEqual(updatedQueries[0].params[0], 3, 'Home score should update to 3');
  assert.strictEqual(updatedQueries[0].params[1], 0, 'Away score should update to 0');
  assert.strictEqual(updatedQueries[0].params[2], 'FINISHED', 'Status should update to FINISHED');
  console.log('✓ smartLivePollingFotmob successfully detected live score & status and updated database');

  console.log('\nAll FotMob module tests passed 100%!');
})();
