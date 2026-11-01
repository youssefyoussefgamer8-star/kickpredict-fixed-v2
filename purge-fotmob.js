'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const {
  ensureFlashscoreColumns,
  syncFlashscoreSchedule
} = require('./sync-flashscore');

async function purgeFotmobAndResync() {
  if (!process.env.DATABASE_URL) {
    console.error('[Purge FotMob] DATABASE_URL is not set in environment.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2
  });

  try {
    console.log('[Purge FotMob] Connecting to PostgreSQL database...');

    // 1. Ensure flashscore_id and match detail columns exist
    console.log('[Purge FotMob] Verifying schema and Flashscore columns...');
    await ensureFlashscoreColumns(pool);

    // 2. Remove any orphaned predictions on upcoming non-Flashscore matches
    const predRes = await pool.query(`
      DELETE FROM predictions
      WHERE match_id IN (
        SELECT id FROM matches
        WHERE status IN ('TIMED', 'SCHEDULED')
          AND (flashscore_id IS NULL OR fotmob_id IS NOT NULL)
      );
    `);
    if (predRes.rowCount > 0) {
      console.log(`[Purge FotMob] Removed ${predRes.rowCount} predictions on legacy upcoming matches.`);
    }

    // 3. Purge all upcoming/scheduled FotMob matches
    console.log('[Purge FotMob] Purging old upcoming FotMob matches (status TIMED/SCHEDULED with no flashscore_id)...');
    const deleteRes = await pool.query(`
      DELETE FROM matches
      WHERE status IN ('TIMED', 'SCHEDULED')
        AND (flashscore_id IS NULL OR fotmob_id IS NOT NULL);
    `);
    console.log(`[Purge FotMob] Successfully purged ${deleteRes.rowCount} legacy FotMob matches from PostgreSQL.`);

    // 4. Force on-demand fetch of the 4-day window from Flashscore
    console.log('[Purge FotMob] Fetching fresh 4-day schedule (today + 3 days) from Flashscore across all competitions...');
    const fixtures = await syncFlashscoreSchedule(pool, { daysCount: 4 });
    console.log(`[Purge FotMob] Retrieved and upserted ${fixtures.length} clean Flashscore fixtures into PostgreSQL.`);

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

    console.log('\n--- Current Database Breakdown by Competition & Status ---');
    console.table(stats);

    console.log('\n[Purge FotMob] Database successfully cleansed and populated with Flashscore schedule!');
  } catch (err) {
    console.error('[Purge FotMob] Error during purge and resync:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  purgeFotmobAndResync();
}

module.exports = { purgeFotmobAndResync };
