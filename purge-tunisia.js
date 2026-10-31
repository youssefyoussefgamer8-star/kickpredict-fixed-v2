'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { purgeLegacyTunisiaMatches } = require('./sync-tunisia');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set in environment.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('[Purge Tunisia] Connecting to PostgreSQL database...');
    const result = await purgeLegacyTunisiaMatches(pool);
    console.log(`[Purge Tunisia] Finished: deleted ${result.deletedMatches} matches and ${result.deletedBoosts} user boosts.`);
  } catch (err) {
    console.error('[Purge Tunisia] Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
