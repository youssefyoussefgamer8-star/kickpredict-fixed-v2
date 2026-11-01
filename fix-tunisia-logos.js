'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { MASTER_CRESTS } = require('./team-crests-master');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fixTunisiaLogos() {
  console.log('=== Starting Tunisian League Crest Correction ===');

  // 1. Fetch all distinct Tunisian teams from matches table
  const { rows: matchTeamsRows } = await pool.query(`
    SELECT DISTINCT home_team as team FROM matches WHERE competition_code = 'TUN'
    UNION
    SELECT DISTINCT away_team as team FROM matches WHERE competition_code = 'TUN'
  `);

  console.log(`Found ${matchTeamsRows.length} distinct Tunisian teams in matches table.`);

  let updatedHomeCount = 0;
  let updatedAwayCount = 0;

  for (const { team } of matchTeamsRows) {
    const crest = MASTER_CRESTS[team];
    if (!crest) {
      console.warn(`[WARNING] No crest found in MASTER_CRESTS for match team: "${team}"`);
      continue;
    }

    const resHome = await pool.query(
      `UPDATE matches
       SET home_crest = $1, updated_at = NOW()
       WHERE competition_code = 'TUN' AND home_team = $2`,
      [crest, team]
    );
    updatedHomeCount += resHome.rowCount;

    const resAway = await pool.query(
      `UPDATE matches
       SET away_crest = $1, updated_at = NOW()
       WHERE competition_code = 'TUN' AND away_team = $2`,
      [crest, team]
    );
    updatedAwayCount += resAway.rowCount;

    console.log(`✓ Updated matches for "${team}": ${resHome.rowCount} as home, ${resAway.rowCount} as away -> ${crest}`);
  }

  // 2. Fetch all teams from standings table for TUN
  const { rows: standingsTeamsRows } = await pool.query(`
    SELECT team_name FROM standings WHERE competition_code = 'TUN'
  `);

  console.log(`\nFound ${standingsTeamsRows.length} teams in standings table for TUN.`);

  let updatedStandingsCount = 0;
  for (const { team_name } of standingsTeamsRows) {
    const crest = MASTER_CRESTS[team_name];
    if (!crest) {
      console.warn(`[WARNING] No crest found in MASTER_CRESTS for standings team: "${team_name}"`);
      continue;
    }

    const resStand = await pool.query(
      `UPDATE standings
       SET crest = $1, updated_at = NOW()
       WHERE competition_code = 'TUN' AND team_name = $2`,
      [crest, team_name]
    );
    updatedStandingsCount += resStand.rowCount;
    console.log(`✓ Updated standings for "${team_name}" -> ${crest}`);
  }

  // 3. Verification Report
  console.log('\n=== Final Verification for TUN Competition ===');
  const { rows: verifiedMatches } = await pool.query(`
    SELECT DISTINCT home_team as team, home_crest as crest
    FROM matches WHERE competition_code = 'TUN'
    ORDER BY team
  `);
  console.log(`\nMatches Table (${verifiedMatches.length} teams):`);
  for (const r of verifiedMatches) {
    console.log(`  - "${r.team}": ${r.crest}`);
  }

  const { rows: verifiedStandings } = await pool.query(`
    SELECT rank, team_name, crest
    FROM standings WHERE competition_code = 'TUN'
    ORDER BY rank ASC
  `);
  console.log(`\nStandings Table (${verifiedStandings.length} teams):`);
  for (const r of verifiedStandings) {
    console.log(`  #${r.rank} "${r.team_name}": ${r.crest}`);
  }

  console.log(`\n=== Tunisian Logos Fix Completed Successfully ===`);
  console.log(`Updated matches home: ${updatedHomeCount}, away: ${updatedAwayCount}, standings: ${updatedStandingsCount}`);

  await pool.end();
}

fixTunisiaLogos().catch((err) => {
  console.error('Fatal error during fixTunisiaLogos:', err);
  process.exit(1);
});
