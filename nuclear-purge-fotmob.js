'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const {
  ensureFlashscoreColumns,
  syncFlashscoreSchedule
} = require('./sync-flashscore');

async function nuclearPurgeFotmob() {
  if (!process.env.DATABASE_URL) {
    console.error('[Nuclear Purge] DATABASE_URL is not set in environment.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2
  });

  try {
    console.log('[Nuclear Purge] Connecting to PostgreSQL database...');
    await ensureFlashscoreColumns(pool);

    // 1. Delete all predictions on matches to be purged
    console.log('[Nuclear Purge] Deleting predictions linked to legacy FotMob matches...');
    const predRes = await pool.query(`
      DELETE FROM predictions
      WHERE match_id IN (
        SELECT id FROM matches
        WHERE flashscore_id IS NULL OR fotmob_id IS NOT NULL
      );
    `);
    console.log(`[Nuclear Purge] Removed ${predRes.rowCount} legacy predictions.`);

    // 2. Total wipe of all legacy matches (FINISHED, TIMED, SCHEDULED, CANCELLED) with fotmob_id or NULL flashscore_id
    console.log('[Nuclear Purge] Executing total wipe of matches where flashscore_id IS NULL or fotmob_id IS NOT NULL...');
    const matchRes = await pool.query(`
      DELETE FROM matches
      WHERE flashscore_id IS NULL OR fotmob_id IS NOT NULL;
    `);
    console.log(`[Nuclear Purge] Successfully deleted ${matchRes.rowCount} legacy FotMob matches.`);

    // 3. Clean up user_round_boosts for old rounds that no longer have matches
    console.log('[Nuclear Purge] Cleaning orphaned user round boosts...');
    const boostRes = await pool.query(`
      DELETE FROM user_round_boosts
      WHERE round_key NOT IN (
        SELECT DISTINCT round_key FROM matches WHERE round_key IS NOT NULL
      );
    `);
    console.log(`[Nuclear Purge] Cleaned ${boostRes.rowCount} orphaned user boosts.`);

    // 4. Force on-demand fetch of the 9-day window (-1 to +7) from Flashscore to populate the clean schedule
    console.log('[Nuclear Purge] Fetching fresh 9-day schedule (-1 to +7 days) from Flashscore across all competitions...');
    const fixtures = await syncFlashscoreSchedule(pool, { startDay: -1, endDay: 7 });
    console.log(`[Nuclear Purge] Retrieved and upserted ${fixtures.length} clean Flashscore fixtures into PostgreSQL.`);

    // 5. Query and display the fresh database state
    const { rows: stats } = await pool.query(`
      SELECT competition_code,
             status,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE flashscore_id IS NOT NULL) AS flashscore_count
      FROM matches
      GROUP BY competition_code, status
      ORDER BY competition_code, status;
    `);

    console.log('\n--- Final Clean Database State ---');
    console.table(stats);

    const { rows: totalRows } = await pool.query('SELECT COUNT(*) AS total FROM matches;');
    console.log(`\n[Nuclear Purge] Total matches remaining in PostgreSQL: ${totalRows[0].total} (100% Flashscore).`);
  } catch (err) {
    console.error('[Nuclear Purge] Error during purge:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  nuclearPurgeFotmob();
}

module.exports = { nuclearPurgeFotmob };
