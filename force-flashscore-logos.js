'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { MASTER_CRESTS } = require('./team-crests-master');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set in environment.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('[Flashscore Force Logos] Connecting to PostgreSQL database...');

  try {
    const { rows: initialMatches } = await pool.query('SELECT count(*) as count FROM matches');
    const { rows: initialStandings } = await pool.query('SELECT count(*) as count FROM standings');
    console.log(`[Flashscore Force Logos] Total matches: ${initialMatches[0].count}, Total standings: ${initialStandings[0].count}`);

    const teams = [];
    const crests = [];
    for (const [team, crest] of Object.entries(MASTER_CRESTS)) {
      if (crest && crest.startsWith('https://static.flashscore.com/res/image/data/')) {
        teams.push(team);
        crests.push(crest);
      }
    }
    console.log(`[Flashscore Force Logos] Prepared ${teams.length} verified Flashscore crest entries for batch update...`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Batch update home_crest
      const resHome = await client.query(
        `UPDATE matches AS m
         SET home_crest = data_table.crest
         FROM (SELECT UNNEST($1::text[]) AS team, UNNEST($2::text[]) AS crest) AS data_table
         WHERE m.home_team = data_table.team
           AND (m.home_crest IS NULL OR m.home_crest != data_table.crest)`,
        [teams, crests]
      );

      // 2. Batch update away_crest
      const resAway = await client.query(
        `UPDATE matches AS m
         SET away_crest = data_table.crest
         FROM (SELECT UNNEST($1::text[]) AS team, UNNEST($2::text[]) AS crest) AS data_table
         WHERE m.away_team = data_table.team
           AND (m.away_crest IS NULL OR m.away_crest != data_table.crest)`,
        [teams, crests]
      );

      // 3. Batch update standings crest
      const resStandings = await client.query(
        `UPDATE standings AS s
         SET crest = data_table.crest
         FROM (SELECT UNNEST($1::text[]) AS team, UNNEST($2::text[]) AS crest) AS data_table
         WHERE s.team_name = data_table.team
           AND (s.crest IS NULL OR s.crest != data_table.crest)`,
        [teams, crests]
      );

      // 4. Purge any non-Flashscore URLs
      const purgeHome = await client.query(
        `UPDATE matches
         SET home_crest = NULL
         WHERE home_crest IS NOT NULL
           AND home_crest NOT LIKE 'https://static.flashscore.com/res/image/data/%'`
      );

      const purgeAway = await client.query(
        `UPDATE matches
         SET away_crest = NULL
         WHERE away_crest IS NOT NULL
           AND away_crest NOT LIKE 'https://static.flashscore.com/res/image/data/%'`
      );

      const purgeStandings = await client.query(
        `UPDATE standings
         SET crest = NULL
         WHERE crest IS NOT NULL
           AND crest NOT LIKE 'https://static.flashscore.com/res/image/data/%'`
      );

      await client.query('COMMIT');

      console.log(`[Flashscore Force Logos] Batch Update Results:`);
      console.log(`  - Home crests updated: ${resHome.rowCount}`);
      console.log(`  - Away crests updated: ${resAway.rowCount}`);
      console.log(`  - Standings crests updated: ${resStandings.rowCount}`);
      if (purgeHome.rowCount > 0 || purgeAway.rowCount > 0 || purgeStandings.rowCount > 0) {
        console.log(`  - Non-Flashscore URLs purged: home=${purgeHome.rowCount}, away=${purgeAway.rowCount}, standings=${purgeStandings.rowCount}`);
      }
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Strict Verification Checks
    console.log('[Flashscore Force Logos] Running strict verification checks...');

    const { rows: badHomeMatches } = await pool.query(
      `SELECT count(*) as count FROM matches WHERE home_crest IS NOT NULL AND home_crest NOT LIKE 'https://static.flashscore.com/res/image/data/%'`
    );
    const { rows: badAwayMatches } = await pool.query(
      `SELECT count(*) as count FROM matches WHERE away_crest IS NOT NULL AND away_crest NOT LIKE 'https://static.flashscore.com/res/image/data/%'`
    );
    const { rows: badStandings } = await pool.query(
      `SELECT count(*) as count FROM standings WHERE crest IS NOT NULL AND crest NOT LIKE 'https://static.flashscore.com/res/image/data/%'`
    );

    const { rows: validMatches } = await pool.query(
      `SELECT count(*) as count FROM matches WHERE home_crest LIKE 'https://static.flashscore.com/res/image/data/%' OR away_crest LIKE 'https://static.flashscore.com/res/image/data/%'`
    );
    const { rows: validStandings } = await pool.query(
      `SELECT count(*) as count FROM standings WHERE crest LIKE 'https://static.flashscore.com/res/image/data/%'`
    );

    console.log(`[Flashscore Force Logos] Verification Summary:`);
    console.log(`  - Matches with valid Flashscore crests: ${validMatches[0].count}`);
    console.log(`  - Standings with valid Flashscore crests: ${validStandings[0].count}`);
    console.log(`  - Non-Flashscore home crests remaining: ${badHomeMatches[0].count}`);
    console.log(`  - Non-Flashscore away crests remaining: ${badAwayMatches[0].count}`);
    console.log(`  - Non-Flashscore standings crests remaining: ${badStandings[0].count}`);

    if (
      parseInt(badHomeMatches[0].count, 10) === 0 &&
      parseInt(badAwayMatches[0].count, 10) === 0 &&
      parseInt(badStandings[0].count, 10) === 0
    ) {
      console.log('✓ SUCCESS: 100% of crests in PostgreSQL are strictly from Flashscore CDN!');
    } else {
      console.error('✗ ERROR: Found non-Flashscore crests remaining!');
      process.exit(1);
    }
  } catch (err) {
    console.error('[Flashscore Force Logos] Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
