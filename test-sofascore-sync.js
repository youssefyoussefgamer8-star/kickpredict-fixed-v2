'use strict';
const assert = require('assert');
const {
  parseFlashscoreFeed,
  parseFlashscoreStats,
  parseFlashscoreIncidents,
  parseFlashscoreLineups,
  flashscoreIdToBigInt,
  bigIntToFlashscoreId,
  identifyCompetition,
  formatTunisianTeam,
  getFlashscoreCrest,
  mapFlashscoreStatus,
  parseFlashscoreScore,
  roundInfoFromFlashscore,
  syncFlashscoreSchedule,
  smartLivePolling
} = require('./sync-flashscore');
const { purgeLegacyTunisiaMatches } = require('./sync-tunisia');
const { teamRatings, matchLambdas, buildMatchMarketsPoints } = require('./pricingEngine');

console.log('--- Testing Flashscore ID Conversion ---');
const origId = '4SrepIgn';
const bigIntVal = flashscoreIdToBigInt(origId);
assert.ok(Number.isSafeInteger(bigIntVal), 'Must be safe integer');
assert.strictEqual(bigIntVal, 17178619729887);
const revertedId = bigIntToFlashscoreId(bigIntVal);
assert.strictEqual(revertedId, origId, 'Reversible conversion must match original');
console.log('✓ Flashscore ID reversible conversion verified');

console.log('--- Testing Multi-Competition Identification ---');
assert.strictEqual(identifyCompetition({ country: 'England', name: 'ENGLAND: Premier League', url: '/football/england/premier-league/' }), 'PL');
assert.strictEqual(identifyCompetition({ country: 'Spain', name: 'SPAIN: LaLiga', url: '/football/spain/laliga/' }), 'PD');
assert.strictEqual(identifyCompetition({ country: 'Germany', name: 'GERMANY: Bundesliga', url: '/football/germany/bundesliga/' }), 'BL1');
assert.strictEqual(identifyCompetition({ country: 'Italy', name: 'ITALY: Serie A', url: '/football/italy/serie-a/' }), 'SA');
assert.strictEqual(identifyCompetition({ country: 'France', name: 'FRANCE: Ligue 1', url: '/football/france/ligue-1/' }), 'FL1');
assert.strictEqual(identifyCompetition({ country: 'Europe', name: 'EUROPE: Champions League - League phase', url: '/football/europe/champions-league/' }), 'CL');
assert.strictEqual(identifyCompetition({ country: 'Tunisia', name: 'TUNISIA: Ligue Professionnelle 1', url: '/football/tunisia/ligue-professionnelle-1/' }), 'TUN');

// Verify cups / youth are ignored
assert.strictEqual(identifyCompetition({ country: 'England', name: 'ENGLAND: Premier League Cup', url: '/football/england/premier-league-cup/' }), null);
assert.strictEqual(identifyCompetition({ country: 'Spain', name: 'SPAIN: LaLiga2', url: '/football/spain/laliga2/' }), null);
assert.strictEqual(identifyCompetition({ country: 'Germany', name: 'GERMANY: 2. Bundesliga', url: '/football/germany/2-bundesliga/' }), null);
console.log('✓ All 7 core competitions identified with cup/youth exclusion');

console.log('--- Testing Flashscore Raw Feed Parsing ---');
const sampleMultiCompFeed = `
SA÷1¬~ZA÷ENGLAND: Premier League¬ZEE÷2RsOHwbC¬ZB÷198¬ZY÷England¬ZC÷23¬ZL÷/football/england/premier-league/¬OAJ÷logo.png¬~AA÷plMatch1¬AD÷1793712600¬AB÷1¬CR÷1¬AC÷1¬AE÷Arsenal¬AF÷Chelsea¬OA÷ars.png¬OB÷che.png¬ER÷Round 10¬~ZA÷TUNISIA: Ligue Professionnelle 1¬ZEE÷lfv2BGo7¬ZB÷190¬ZY÷Tunisia¬ZC÷G4Jhegue¬ZL÷/football/tunisia/ligue-professionnelle-1/¬~AA÷tunMatch1¬AD÷1793719800¬AB÷1¬AE÷Stade Tunisien¬AF÷Club Africain¬OA÷st.png¬OB÷ca.png¬ER÷Round 5¬~
`;

const tournaments = parseFlashscoreFeed(sampleMultiCompFeed);
assert.strictEqual(tournaments.length, 2);
assert.strictEqual(identifyCompetition(tournaments[0]), 'PL');
assert.strictEqual(identifyCompetition(tournaments[1]), 'TUN');
assert.strictEqual(tournaments[0].matches.length, 1);
assert.strictEqual(tournaments[1].matches.length, 1);
console.log('✓ Multi-competition raw feed parsed accurately');

console.log('--- Testing Live Match Stats, Incidents & Lineups Parsing ---');
const sampleStatsFeed = `SE÷Match¬~SF÷Top stats¬~SD÷12¬SG÷Ball possession¬SH÷58%¬SI÷42%¬~SD÷34¬SG÷Total shots¬SH÷15¬SI÷8¬~SD÷432¬SG÷Expected goals (xG)¬SH÷1.85¬SI÷0.72¬~`;
const stats = parseFlashscoreStats(sampleStatsFeed);
assert.strictEqual(stats.length, 3);
assert.strictEqual(stats[0].name, 'Ball possession');
assert.strictEqual(stats[0].home, '58%');
assert.strictEqual(stats[0].away, '42%');
assert.strictEqual(stats[2].name, 'Expected goals (xG)');
assert.strictEqual(stats[2].home, '1.85');

const sampleIncidentsFeed = `AC÷1st Half¬~III÷inc1¬IA÷1¬IB÷24'¬IK÷Goal¬IF÷Saka B.¬IL÷Normal Goal¬~III÷inc2¬IA÷2¬IB÷40'¬IK÷Yellow Card¬IF÷Fernandez E.¬IL÷Foul¬~`;
const incidents = parseFlashscoreIncidents(sampleIncidentsFeed);
assert.strictEqual(incidents.length, 2);
assert.strictEqual(incidents[0].minute, "24'");
assert.strictEqual(incidents[0].player, 'Saka B.');
assert.strictEqual(incidents[0].type, 'Goal');
assert.strictEqual(incidents[0].team, 'home');
assert.strictEqual(incidents[1].player, 'Fernandez E.');
assert.strictEqual(incidents[1].type, 'Yellow Card');
assert.strictEqual(incidents[1].team, 'away');

const sampleLineupsFeed = `LA÷Formation¬LD÷4-3-3¬~LD÷4-2-3-1¬~LI÷Raya D.¬~LI÷White B.¬~LI÷Sanchez R.¬~`;
const lineups = parseFlashscoreLineups(sampleLineupsFeed);
assert.strictEqual(lineups.formationHome, '4-3-3');
assert.strictEqual(lineups.formationAway, '4-2-3-1');
assert.ok(lineups.startingHome.includes('Raya D.'));
console.log('✓ Stats, incidents, and lineups parser verified');

console.log('--- Testing Team Names & Crests ---');
assert.strictEqual(formatTunisianTeam('Stade Tunisien'), 'الملعب التونسي');
assert.strictEqual(formatTunisianTeam('Club Africain'), 'النادي الإفريقي');
assert.strictEqual(formatTunisianTeam('Étoile du Sahel'), 'النجم الساحلي');
assert.strictEqual(getFlashscoreCrest('logo.png'), 'https://static.flashscore.com/res/image/data/logo.png');
assert.strictEqual(getFlashscoreCrest('any-logo.png', 'Arsenal'), 'https://crests.football-data.org/57.png');
assert.strictEqual(getFlashscoreCrest(null, 'الترجي الرياضي'), 'https://imagecache.365scores.com/image/upload/f_png,w_120,h_120,c_limit,q_auto:eco/v1/Competitors/8234');
console.log('✓ Team names and crests verified');

console.log('--- Testing Status and Score Mapping ---');
assert.strictEqual(mapFlashscoreStatus({ AB: '1', AC: '1' }), 'SCHEDULED');
assert.strictEqual(mapFlashscoreStatus({ AB: '2', AC: '1' }), 'IN_PLAY');
assert.strictEqual(mapFlashscoreStatus({ AB: '2', AC: '17' }), 'PAUSED'); // Halftime
assert.strictEqual(mapFlashscoreStatus({ AB: '3', AC: '3' }), 'FINISHED');
assert.strictEqual(mapFlashscoreStatus({ AB: '3', AC: '10' }), 'FINISHED'); // Extra time
assert.strictEqual(mapFlashscoreStatus({ AC: '11' }), 'FINISHED'); // Penalties
assert.strictEqual(mapFlashscoreStatus({ AB: '4', AC: '1' }), 'POSTPONED');
assert.strictEqual(mapFlashscoreStatus({ AB: '1', AC: '12' }), 'CANCELLED');

const s = parseFlashscoreScore({ AB: '3', AC: '3', AG: '3', AH: '1', BA: '1', BB: '0' });
assert.strictEqual(s.home, 3);
assert.strictEqual(s.away, 1);
assert.strictEqual(s.homeHt, 1);
assert.strictEqual(s.awayHt, 0);
console.log('✓ Status and score mapping verified');

console.log('--- Testing On-Boot & Midnight Schedule Sync (4-day window) ---');
(async () => {
  const upserted = [];
  const testPool = {
    query: async (sql, params) => {
      if (sql.includes('SELECT home_score')) return { rows: [] };
      if (sql.includes('INSERT INTO matches')) {
        upserted.push({
          external_id: params[0],
          flashscore_id: params[1],
          competition_code: params[2],
          home_team: params[6],
          away_team: params[8],
          utc_date: params[10],
          status: params[11],
          markets_points: JSON.parse(params[18])
        });
        return { rowCount: 1 };
      }
      return { rows: [] };
    }
  };

  const mockScheduleFetcher = async (url) => {
    return {
      ok: true,
      text: async () => sampleMultiCompFeed
    };
  };

  const fixtures = await syncFlashscoreSchedule(testPool, {
    fetcher: mockScheduleFetcher,
    daysCount: 1
  });

  assert.strictEqual(fixtures.length, 2);
  assert.strictEqual(upserted.length, 2);

  // Check PL fixture
  const pl = upserted.find(u => u.competition_code === 'PL');
  assert.ok(pl);
  assert.strictEqual(pl.home_team, 'Arsenal');
  assert.strictEqual(pl.away_team, 'Chelsea');
  assert.strictEqual(pl.status, 'SCHEDULED');
  assert.ok(pl.markets_points.outcome_1x2.HOME > 0);

  // Check TUN fixture
  const tun = upserted.find(u => u.competition_code === 'TUN');
  assert.ok(tun);
  assert.strictEqual(tun.home_team, 'الملعب التونسي');
  assert.strictEqual(tun.away_team, 'النادي الإفريقي');
  assert.strictEqual(tun.status, 'SCHEDULED');
  console.log('✓ On-Boot & Midnight schedule sync successfully populated multi-league fixtures');

  console.log('--- Testing Smart Live Polling (Strict Local Gate) ---');
  // 1. Gate condition: 0 live matches -> SILENT SKIP, ZERO network calls
  let networkCalls = 0;
  const mockSilentFetcher = async () => {
    networkCalls++;
    return { ok: true, text: async () => '' };
  };

  const emptyPool = {
    query: async () => ({ rows: [] })
  };

  await smartLivePolling(emptyPool, { fetcher: mockSilentFetcher });
  assert.strictEqual(networkCalls, 0, 'Zero network calls must be made when no live match exists');
  console.log('✓ Gate condition passed: silently skipped with ZERO network requests');

  // 2. Active match in progress -> Surgical query for live scores, stats, incidents & lineups
  networkCalls = 0;
  const activeMatches = [
    {
      id: 50,
      external_id: flashscoreIdToBigInt('liveMatch1'),
      flashscore_id: 'liveMatch1',
      competition_code: 'PL',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      utc_date: new Date(Date.now() - 3600000).toISOString(),
      status: 'IN_PLAY',
      home_score: 0,
      away_score: 0,
      home_ht: null,
      away_ht: null
    }
  ];

  const liveDay0Feed = `
SA÷1¬~ZA÷ENGLAND: Premier League¬ZEE÷2RsOHwbC¬ZB÷198¬ZY÷England¬ZC÷23¬ZL÷/football/england/premier-league/¬~AA÷liveMatch1¬AD÷1793712600¬AB÷2¬AC÷2¬AE÷Arsenal¬AF÷Chelsea¬AG÷2¬AH÷1¬BA÷1¬BB÷0¬~
`;

  const updatedParams = [];
  const livePool = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id, external_id')) {
        return { rows: activeMatches };
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

  await smartLivePolling(livePool, {
    settleFinishedMatches: async () => { settled = true; },
    reconcileScoreCorrections: async (rows) => { reconciled = rows; },
    fetcher: async (url) => {
      networkCalls++;
      if (url.includes('df_st_1_')) return { ok: true, text: async () => sampleStatsFeed };
      if (url.includes('df_sui_1_')) return { ok: true, text: async () => sampleIncidentsFeed };
      if (url.includes('df_li_1_')) return { ok: true, text: async () => sampleLineupsFeed };
      return { ok: true, text: async () => liveDay0Feed };
    }
  });

  assert.ok(networkCalls >= 1, 'Network call executed only when match is live');
  assert.strictEqual(updatedParams.length, 1, 'Match record updated with live data');
  assert.strictEqual(updatedParams[0][0], 'IN_PLAY');
  assert.strictEqual(updatedParams[0][1], 2); // Home score 2
  assert.strictEqual(updatedParams[0][2], 1); // Away score 1
  assert.strictEqual(updatedParams[0][3], 1); // Home HT 1
  assert.strictEqual(updatedParams[0][4], 0); // Away HT 0

  // Check stats, incidents, and lineups were saved to DB record
  const savedStats = JSON.parse(updatedParams[0][5]);
  const savedIncidents = JSON.parse(updatedParams[0][6]);
  const savedLineups = JSON.parse(updatedParams[0][7]);
  assert.strictEqual(savedStats[0].name, 'Ball possession');
  assert.strictEqual(savedIncidents[0].player, 'Saka B.');
  assert.strictEqual(savedLineups.formationHome, '4-3-3');
  assert.ok(settled, 'Settlement triggered');
  assert.strictEqual(reconciled.length, 1);
  console.log('✓ Smart live polling successfully retrieved live score, stats, incidents, and lineups');

  console.log('--- Testing PostgreSQL Legacy Purge ---');
  const deletedSqls = [];
  const mockPurgePool = {
    query: async (sql) => {
      deletedSqls.push(sql);
      return { rowCount: 1 };
    }
  };
  const res = await purgeLegacyTunisiaMatches(mockPurgePool);
  assert.strictEqual(res.deletedMatches, 1);
  console.log('✓ Legacy purge utility verified');

  console.log('\nAll Universal Flashscore multi-competition unit and integration tests passed cleanly!');
})();
