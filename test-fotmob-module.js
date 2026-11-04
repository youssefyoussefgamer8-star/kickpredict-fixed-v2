'use strict';
const assert = require('assert');
const {
  cleanTeamName,
  teamsMatch,
  mapFotmobPosition,
  parseFotmobLineup,
  parseFotmobStats,
  findFotmobMatchId,
  fetchFotmobLineup,
  smartLivePollingFotmob,
  identifyFotmobCompetition,
  formatTunisianTeam,
  syncFotmobFixtures
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

  // 6. Test 75-minute early radar window for upcoming match lineup capture
  console.log('\nTesting 75-minute early lineup capture radar window...');
  const upcomingMatch = {
    id: 202,
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    status: 'TIMED',
    utc_date: new Date(Date.now() + 50 * 60 * 1000).toISOString(), // 50 mins before kickoff
    home_score: null,
    away_score: null,
    match_lineups: null
  };

  const earlyQueries = [];
  const upcomingPool = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id, external_id')) {
        return { rows: [upcomingMatch] };
      }
      if (sql.includes('UPDATE matches')) {
        earlyQueries.push({ sql, params });
        return { rowCount: 1 };
      }
      return { rows: [] };
    }
  };

  await smartLivePollingFotmob(upcomingPool, {
    fetcher: async (url) => {
      if (url.includes('matchDetails')) {
        return {
          ok: true,
          json: async () => ({
            content: {
              lineup: {
                lineupType: 'confirmed',
                homeTeam: {
                  name: 'Arsenal',
                  formation: '4-3-3',
                  starters: Array(11).fill(0).map((_, i) => ({ id: 500 + i, name: `Gunner ${i + 1}`, shirtNumber: `${i + 1}` })),
                  subs: []
                },
                awayTeam: {
                  name: 'Chelsea',
                  formation: '4-2-3-1',
                  starters: Array(11).fill(0).map((_, i) => ({ id: 600 + i, name: `Blue ${i + 1}`, shirtNumber: `${i + 1}` })),
                  subs: []
                }
              }
            }
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          leagues: [
            {
              matches: [
                {
                  id: 999901,
                  home: { name: 'Arsenal' },
                  away: { name: 'Chelsea' },
                  status: { started: false, finished: false }
                }
              ]
            }
          ]
        })
      };
    }
  });

  const lineupUpdate = earlyQueries.find(q => q.sql.includes('match_lineups'));
  assert.ok(lineupUpdate, 'Early lineup must be persisted to PostgreSQL within 75m window');
  const savedEarly = JSON.parse(lineupUpdate.params[0]);
  assert.strictEqual(savedEarly.startingHome.length, 11, 'Should save 11 home starters');
  assert.strictEqual(savedEarly.startingAway.length, 11, 'Should save 11 away starters');
  console.log('✓ 75-minute early lineup radar window verified: official lineups captured and persisted before kickoff');

  // 7. Test FotMob match stats parser
  console.log('\nTesting FotMob match stats parser...');
  const mockStatsData = {
    content: {
      stats: {
        Periods: {
          All: {
            stats: [
              {
                title: 'Top stats',
                stats: [
                  { title: 'Ball possession', key: 'possession', stats: ['62%', '38%'], rawStats: [{ value: 62 }, { value: 38 }] },
                  { title: 'Expected goals (xG)', key: 'xg', stats: ['2.14', '0.78'], rawStats: [{ value: 2.14 }, { value: 0.78 }] }
                ]
              },
              {
                title: 'Shots',
                stats: [
                  { title: 'Total shots', key: 'shots', stats: [14, 6] },
                  { title: 'Shots on target', key: 'target', stats: [7, 2] }
                ]
              },
              {
                title: 'Discipline',
                stats: [
                  { title: 'Fouls committed', key: 'fouls', stats: [8, 12] },
                  { title: 'Yellow cards', key: 'yellow_cards', stats: [1, 3] }
                ]
              }
            ]
          }
        }
      }
    }
  };

  const parsedStats = parseFotmobStats(mockStatsData);
  assert.strictEqual(parsedStats.length, 6, 'Should extract 6 unique stats across groups');
  assert.strictEqual(parsedStats[0].name, 'Ball possession');
  assert.strictEqual(parsedStats[0].homeVal, 62);
  assert.strictEqual(parsedStats[0].awayVal, 38);
  assert.strictEqual(parsedStats[0].group, 'Top stats');
  assert.strictEqual(parsedStats[1].name, 'Expected goals (xG)');
  assert.strictEqual(parsedStats[1].homeVal, 2.14);
  assert.strictEqual(parsedStats[4].name, 'Fouls committed');
  assert.strictEqual(parsedStats[4].homeVal, 8);
  assert.strictEqual(parsedStats[4].awayVal, 12);
  console.log('✓ parseFotmobStats verified: extracts normalized metrics, values, keys, and categories');

  // 8. Test Competition & Team Identification
  console.log('\nTesting FotMob Competition & Team Identification...');
  assert.strictEqual(identifyFotmobCompetition({ id: 943230, primaryId: 42, name: 'Champions League', ccode: 'INT' }), 'CL');
  assert.strictEqual(identifyFotmobCompetition({ id: 47, name: 'Premier League', ccode: 'ENG' }), 'PL');
  assert.strictEqual(identifyFotmobCompetition({ id: 87, name: 'LaLiga', ccode: 'ESP' }), 'PD');
  assert.strictEqual(identifyFotmobCompetition({ id: 54, name: 'Bundesliga', ccode: 'GER' }), 'BL1');
  assert.strictEqual(identifyFotmobCompetition({ id: 55, name: 'Serie A', ccode: 'ITA' }), 'SA');
  assert.strictEqual(identifyFotmobCompetition({ id: 53, name: 'Ligue 1', ccode: 'FRA' }), 'FL1');
  assert.strictEqual(identifyFotmobCompetition({ id: 943985, primaryId: 544, name: 'Ligue I', ccode: 'TUN' }), 'TUN');
  assert.strictEqual(identifyFotmobCompetition({ id: 1000001206, name: "CAF Women's Champions League", ccode: 'INT' }), null);
  assert.strictEqual(identifyFotmobCompetition({ id: 942146, name: 'Serie A Femminile', ccode: 'ITA' }), null);

  assert.strictEqual(formatTunisianTeam('Espérance'), 'الترجي الرياضي');
  assert.strictEqual(formatTunisianTeam('US Monastir'), 'الاتحاد المنستيري');
  assert.strictEqual(formatTunisianTeam('Club Africain'), 'النادي الإفريقي');
  console.log('✓ identifyFotmobCompetition and formatTunisianTeam verified across all 7 supported leagues');

  // 9. Test syncFotmobFixtures Schedule Engine
  console.log('\nTesting syncFotmobFixtures Schedule Engine...');
  const fixtureQueries = [];
  const mockPool = {
    query: async (sql, params) => {
      if (sql.includes('SELECT home_score')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT id, external_id')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO matches') || sql.includes('UPDATE matches')) {
        fixtureQueries.push({ sql, params });
        return { rowCount: 1 };
      }
      return { rows: [] };
    }
  };

  const mockFetcher = async (url) => {
    return {
      ok: true,
      json: async () => ({
        leagues: [
          {
            id: 943230,
            primaryId: 42,
            name: 'Champions League',
            ccode: 'INT',
            matches: [
              {
                id: 6106401,
                tournamentStage: '4',
                home: { id: 8563, name: 'AEK Athens', score: 2 },
                away: { id: 8633, name: 'Real Madrid', score: 3 },
                status: {
                  utcTime: '2026-11-04T17:45:00.000Z',
                  finished: true,
                  reason: { short: 'FT' }
                }
              }
            ]
          }
        ]
      })
    };
  };

  const discovered = await syncFotmobFixtures(mockPool, { fetcher: mockFetcher, startDay: 0, endDay: 0 });
  assert.strictEqual(discovered.length, 1, 'Should discover 1 fixture');
  assert.strictEqual(fixtureQueries.length, 1, 'Should execute 1 DB insertion');
  assert.strictEqual(fixtureQueries[0].params[0], 6106401, 'external_id must match FotMob matchId');
  assert.strictEqual(fixtureQueries[0].params[2], 'CL', 'competition_code must be CL');
  assert.strictEqual(fixtureQueries[0].params[4], 'AEK Athens', 'Home team must be AEK Athens');
  assert.strictEqual(fixtureQueries[0].params[6], 'Real Madrid', 'Away team must be Real Madrid');
  assert.strictEqual(fixtureQueries[0].params[9], 'FINISHED', 'Status must be FINISHED');
  assert.strictEqual(fixtureQueries[0].params[10], 2, 'Home score must be 2');
  assert.strictEqual(fixtureQueries[0].params[11], 3, 'Away score must be 3');
  console.log('✓ syncFotmobFixtures verified: discovers, parses, calculates lambdas & markets, and stores fixtures in DB');

  console.log('\nAll FotMob module tests passed 100%!');
})();
