'use strict';
/**
 * Forwarding bridge to sync-flashscore.js for backward compatibility.
 */
const flashscore = require('./sync-flashscore');

async function purgeLegacyTunisiaMatches(pool) {
  try {
    const res = await pool.query(`
      DELETE FROM matches
      WHERE competition_code IN ('TUN', 'TU1', '984')
         OR competition_code ILIKE '%TUN%';
    `);
    const boostRes = await pool.query(`
      DELETE FROM user_round_boosts
      WHERE competition_code IN ('TUN', 'TU1', '984')
         OR competition_code ILIKE '%TUN%';
    `);
    if (res.rowCount > 0 || boostRes.rowCount > 0) {
      console.log(`[Flashscore] Purged ${res.rowCount} legacy Tunisian matches and ${boostRes.rowCount} boosts from PostgreSQL.`);
    }
    return { deletedMatches: res.rowCount, deletedBoosts: boostRes.rowCount };
  } catch (err) {
    console.warn('[Flashscore] Purge query notice:', err.message);
    return { deletedMatches: 0, deletedBoosts: 0 };
  }
}

module.exports = {
  ...flashscore,
  purgeLegacyTunisiaMatches,
  syncTunisianLeague: flashscore.syncFlashscoreSchedule,
  smartPollTunisia: flashscore.smartLivePolling,
  initTunisiaSync: flashscore.initFlashscoreSync
};
