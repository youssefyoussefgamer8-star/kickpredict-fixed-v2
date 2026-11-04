'use strict';
require('dotenv').config();
const assert = require('assert');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const {
  fetchMatchLiveDetails,
  bigIntToFlashscoreId
} = require('./sync-flashscore');
const { fetchFotmobLineup } = require('./sync-fotmob');

(async () => {
  console.log('================================================================');
  console.log('   TEST: FINISHED MATCH LINEUPS FETCH & DB PERSISTENCE           ');
  console.log('================================================================\n');

  try {
    // 1. Locate a finished match in PostgreSQL (e.g. 167040 Liverpool vs Arsenal, or 167046)
    const { rows } = await pool.query(
      `SELECT id, external_id, flashscore_id, competition_code, home_team, away_team, status,
              utc_date, home_score, away_score, match_lineups
       FROM matches
       WHERE status = 'FINISHED'
       ORDER BY utc_date DESC
       LIMIT 1`
    );

    if (rows.length === 0) {
      console.log('No finished match found in DB to test.');
      process.exit(0);
    }

    const testMatch = rows[0];
    const matchId = testMatch.id;
    const rawFlashId = testMatch.flashscore_id || (testMatch.external_id ? bigIntToFlashscoreId(testMatch.external_id) : null);
    console.log(`Testing Finished Match: ${testMatch.home_team} vs ${testMatch.away_team} (id=${matchId}, flashscore_id=${rawFlashId}, status=${testMatch.status})`);

    // Reset match_lineups to null in DB to simulate freshly queried finished match
    await pool.query(`UPDATE matches SET match_lineups = NULL WHERE id = $1`, [matchId]);
    testMatch.match_lineups = null;

    // Verify it is null
    const checkBefore = await pool.query(`SELECT match_lineups FROM matches WHERE id = $1`, [matchId]);
    assert.strictEqual(checkBefore.rows[0].match_lineups, null, 'match_lineups should initially be null');
    console.log('✓ Successfully reset match_lineups to NULL in PostgreSQL');

    // Helper from server.js
    function hasUsableLineups(lineups) {
      if (!lineups) return false;
      let parsed = lineups;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { return false; }
      }
      if (!parsed || typeof parsed !== 'object') return false;
      const startingHome = parsed.homeRoster?.starting || parsed.startingHome;
      const startingAway = parsed.awayRoster?.starting || parsed.startingAway;
      return Array.isArray(startingHome) && startingHome.length > 0 &&
             Array.isArray(startingAway) && startingAway.length > 0;
    }

    // Simulate server.js /api/matches/:id/details flow
    const hasLineupsInDB = hasUsableLineups(testMatch.match_lineups);
    const isFinished = testMatch.status === 'FINISHED' || testMatch.status === 'FT';
    const isLive = testMatch.status === 'IN_PLAY' || testMatch.status === 'PAUSED' || testMatch.status === '1H' || testMatch.status === '2H' || testMatch.status === 'HT';
    const kickoffNearOrPast = testMatch.utc_date && (new Date(testMatch.utc_date).getTime() - Date.now() <= 60 * 60 * 1000);

    const needsLineups = !hasLineupsInDB;
    const needsLiveMatchUpdate = isLive || !isFinished || kickoffNearOrPast;

    assert.strictEqual(isFinished, true, 'Match must be recognized as finished');
    assert.strictEqual(needsLineups, true, 'needsLineups MUST be true for finished match with no lineups');
    console.log(`✓ Flags verified: isFinished=${isFinished}, needsLineups=${needsLineups}`);

    let bestLineups = null;
    let liveDetails = null;

    if (needsLineups) {
      // Sole and primary lineups provider: FotMob
      try {
        const fotmobLineup = await fetchFotmobLineup(testMatch.home_team, testMatch.away_team, testMatch.utc_date);
        if (hasUsableLineups(fotmobLineup)) {
          bestLineups = fotmobLineup;
        }
      } catch (e) {
        console.warn('FotMob error in test:', e.message);
      }
    }

    assert.ok(hasUsableLineups(bestLineups), 'bestLineups must be a usable lineup object');
    assert.ok(bestLineups.startingHome.length >= 11, 'Must contain starting home players');
    assert.ok(bestLineups.startingAway.length >= 11, 'Must contain starting away players');
    console.log(`✓ Lineups fetched for finished match: ${bestLineups.startingHome.length} home starters, ${bestLineups.startingAway.length} away starters`);

    // Persist to PostgreSQL
    await pool.query(
      `UPDATE matches
       SET match_lineups = $1::jsonb,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(bestLineups), matchId]
    );
    console.log('✓ Successfully executed UPDATE matches SET match_lineups = $1::jsonb in PostgreSQL');

    // Query DB again to verify persistence
    const checkAfter = await pool.query(
      `SELECT match_lineups, status FROM matches WHERE id = $1`,
      [matchId]
    );
    const persisted = checkAfter.rows[0].match_lineups;
    assert.ok(hasUsableLineups(persisted), 'Persisted lineups must be usable in DB');
    assert.strictEqual(checkAfter.rows[0].status, 'FINISHED', 'Status must remain FINISHED');
    console.log('✓ Verified DB persistence: Subsequent requests will read directly from DB cache with zero network calls!');

    console.log('\n================================================================');
    console.log('   ALL FINISHED MATCH LINEUPS TESTS PASSED WITH 100% SUCCESS    ');
    console.log('================================================================');
    process.exit(0);
  } catch (err) {
    console.error('Test failed with error:', err);
    process.exit(1);
  }
})();
