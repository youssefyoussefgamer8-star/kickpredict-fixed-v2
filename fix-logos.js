require('dotenv').config();
const { Pool } = require('pg');
const { MASTER_CRESTS } = require('./team-crests-master');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fixLogos() {
  console.log('=====================================================');
  console.log('   STARTING LOGO CORRECTION & RESTORATION (fix-logos.js)');
  console.log('=====================================================');

  const client = await pool.connect();
  try {
    let totalHomeUpdated = 0;
    let totalAwayUpdated = 0;
    let totalStandingsUpdated = 0;

    for (const [teamName, crestUrl] of Object.entries(MASTER_CRESTS)) {
      // 1. Update home_crest in matches table
      const resHome = await client.query(
        `UPDATE matches
         SET home_crest = $1
         WHERE home_team = $2
           AND (home_crest IS DISTINCT FROM $1)`,
        [crestUrl, teamName]
      );
      if (resHome.rowCount > 0) {
        totalHomeUpdated += resHome.rowCount;
      }

      // 2. Update away_crest in matches table
      const resAway = await client.query(
        `UPDATE matches
         SET away_crest = $1
         WHERE away_team = $2
           AND (away_crest IS DISTINCT FROM $1)`,
        [crestUrl, teamName]
      );
      if (resAway.rowCount > 0) {
        totalAwayUpdated += resAway.rowCount;
      }

      // 3. Update crest in standings table
      const resStandings = await client.query(
        `UPDATE standings
         SET crest = $1
         WHERE team_name = $2
           AND (crest IS DISTINCT FROM $1)`,
        [crestUrl, teamName]
      );
      if (resStandings.rowCount > 0) {
        totalStandingsUpdated += resStandings.rowCount;
      }
    }

    console.log(`✓ Updated matches home_crest: ${totalHomeUpdated} rows`);
    console.log(`✓ Updated matches away_crest: ${totalAwayUpdated} rows`);
    console.log(`✓ Updated standings crests:   ${totalStandingsUpdated} rows`);

    // Verification check for Premier League
    const { rows: plMatches } = await client.query(
      `SELECT home_team, home_crest, away_team, away_crest
       FROM matches
       WHERE competition_code = 'PL'
       LIMIT 5`
    );
    console.log('\n--- Sample Verified Premier League Matches in DB ---');
    console.table(plMatches);

    // Check if any match still has the clone WWpbDXxS URL
    const { rows: remainingClones } = await client.query(
      `SELECT COUNT(*) as clone_count
       FROM matches
       WHERE home_crest LIKE '%WWpbDXxS%' OR away_crest LIKE '%WWpbDXxS%'`
    );
    console.log(`\nRemaining WWpbDXxS clone URLs in matches: ${remainingClones[0].clone_count}`);

    console.log('\n=====================================================');
    console.log('   LOGO RESTORATION COMPLETED SUCCESSFULLY!');
    console.log('=====================================================');
  } catch (err) {
    console.error('Error during logo fix:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

fixLogos().catch(console.error);
