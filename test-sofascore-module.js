'use strict';
const assert = require('assert');
const {
  parseSofascoreLineups,
  teamsMatch,
  cleanTeamName
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
console.log('All Sofascore module tests passed cleanly!');
