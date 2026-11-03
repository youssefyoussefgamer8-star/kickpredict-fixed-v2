'use strict';
const assert = require('assert');
const {
  parseSofascoreLineups,
  teamsMatch,
  cleanTeamName,
  extractEventsFromSofascore,
  findSofascoreEventId
} = require('./sync-sofascore');

console.log('--- Testing Sofascore Module ---');

// 1. Team Name Matching
assert.ok(teamsMatch('FC Barcelona', 'Barcelona'));
assert.ok(teamsMatch('Aston Villa', 'Aston Villa FC'));
assert.ok(teamsMatch('Paris Saint-Germain', 'PSG'));
assert.strictEqual(teamsMatch('Real Madrid', 'Barcelona'), false);
console.log('✓ Fuzzy team matching verified');

// 2. Sample Sofascore Lineups JSON
const sampleSofascoreData = {
  confirmed: true,
  home: {
    formation: '4-2-3-1',
    supportStaff: [
      { name: 'Hansi Flick', role: 'Manager' }
    ],
    players: [
      {
        player: { id: 868812, name: 'Joan García', position: 'G' },
        shirtNumber: 1,
        position: 'G',
        substitute: false,
        statistics: { rating: 7.2 }
      },
      {
        player: { id: 104523, name: 'Lamine Yamal', position: 'F' },
        shirtNumber: 10,
        position: 'F',
        substitute: false,
        statistics: { rating: 8.4, goals: 1 }
      },
      {
        player: { id: 991234, name: 'Gavi', position: 'M' },
        shirtNumber: 6,
        position: 'M',
        substitute: true,
        statistics: { rating: 6.8 }
      }
    ]
  },
  away: {
    formation: '4-2-3-1',
    supportStaff: [
      { name: 'Unai Emery', role: 'Head Coach' }
    ],
    players: [
      {
        player: { id: 554433, name: 'Zion Suzuki', position: 'G' },
        shirtNumber: 1,
        position: 'G',
        substitute: false,
        statistics: { rating: 6.9 }
      },
      {
        player: { id: 778899, name: 'Ollie Watkins', position: 'F' },
        shirtNumber: 11,
        position: 'F',
        substitute: false,
        statistics: { rating: 7.1 }
      }
    ]
  }
};

const parsed = parseSofascoreLineups(sampleSofascoreData);

assert.strictEqual(parsed.source, 'sofascore');
assert.strictEqual(parsed.confirmed, true);
assert.strictEqual(parsed.formationHome, '4-2-3-1');
assert.strictEqual(parsed.formationAway, '4-2-3-1');
assert.strictEqual(parsed.managerHome, 'Hansi Flick');
assert.strictEqual(parsed.managerAway, 'Unai Emery');

// Home starting checks
assert.strictEqual(parsed.startingHome.length, 2);
assert.strictEqual(parsed.startingHome[0].name, 'Joan García');
assert.strictEqual(parsed.startingHome[0].num, 1);
assert.strictEqual(parsed.startingHome[0].pos, 'GK');
assert.strictEqual(parsed.startingHome[0].photo, 'https://img.sofascore.com/api/v1/player/868812/image');
assert.strictEqual(parsed.startingHome[0].rating, '7.2');

// Events check (Lamine Yamal goal)
assert.strictEqual(parsed.startingHome[1].name, 'Lamine Yamal');
assert.strictEqual(parsed.startingHome[1].events[0].type, 'goal');

// Subs check
assert.strictEqual(parsed.subsHome.length, 1);
assert.strictEqual(parsed.subsHome[0].name, 'Gavi');
assert.strictEqual(parsed.subsHome[0].pos, 'SUB');

// Unified Roster Contract check
assert.ok(parsed.homeRoster && parsed.homeRoster.starting.length === 2);
assert.ok(parsed.awayRoster && parsed.awayRoster.starting.length === 2);
assert.strictEqual(parsed.homeRoster.formation, '4-2-3-1');
assert.strictEqual(parsed.homeRoster.manager, 'Hansi Flick');

console.log('✓ Sofascore lineups parser, player photos & unified roster contract verified');

(async () => {
  // 3. Test extractEventsFromSofascore
  const searchFormat1 = {
    results: [
      {
        type: 'event',
        entity: {
          id: 11223344,
          homeTeam: { name: 'FC Barcelona' },
          awayTeam: { name: 'Aston Villa' },
          startTimestamp: 1730664000
        }
      }
    ]
  };
  const extracted1 = extractEventsFromSofascore(searchFormat1);
  assert.strictEqual(extracted1.length, 1);
  assert.strictEqual(extracted1[0].id, 11223344);

  const searchFormat2 = {
    events: [
      {
        id: 55667788,
        homeTeam: { name: 'Liverpool' },
        awayTeam: { name: 'Arsenal' },
        startTimestamp: 1730478600
      }
    ]
  };
  const extracted2 = extractEventsFromSofascore(searchFormat2);
  assert.strictEqual(extracted2.length, 1);
  assert.strictEqual(extracted2[0].id, 55667788);
  console.log('✓ extractEventsFromSofascore handles both results.entity and events formats');

  // 4. Test findSofascoreEventId with mock fetcher for Past Dates via Search
  const mockFetcherSearch = async (url) => {
    if (url.includes('/search/all?q=')) {
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              type: 'event',
              entity: {
                id: 998877,
                homeTeam: { name: 'Barcelona' },
                awayTeam: { name: 'Aston Villa' },
                startTimestamp: 1730664000
              }
            }
          ]
        })
      };
    }
    return { ok: false, status: 404 };
  };

  const foundSearchId = await findSofascoreEventId('Barcelona', 'Aston Villa', '2026-11-03T20:00:00.000Z', {
    fetcher: mockFetcherSearch
  });
  assert.strictEqual(foundSearchId, 998877);
  console.log('✓ findSofascoreEventId resolves past dates via /search/all direct team query');

  // 5. Test findSofascoreEventId with mock fetcher for timezone boundary (+/- 1 day)
  const mockFetcherTimezone = async (url) => {
    if (url.includes('/search/all?q=')) {
      return { ok: false, status: 403 }; // simulate search blocked
    }
    if (url.includes('/sport/football/scheduled-events/2026-11-02')) {
      // found on previous day due to timezone shift
      return {
        ok: true,
        json: async () => ({
          events: [
            {
              id: 334455,
              homeTeam: { name: 'Barcelona' },
              awayTeam: { name: 'Aston Villa' }
            }
          ]
        })
      };
    }
    return { ok: true, json: async () => ({ events: [] }) };
  };

  const foundTimezoneId = await findSofascoreEventId('Barcelona', 'Aston Villa', '2026-11-03T01:00:00.000Z', {
    fetcher: mockFetcherTimezone
  });
  assert.strictEqual(foundTimezoneId, 334455);
  console.log('✓ findSofascoreEventId resolves matches on timezone day boundaries');

  console.log('\nAll Sofascore module tests passed cleanly!');
})();
