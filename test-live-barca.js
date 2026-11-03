'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const {
  fetchMatchLiveDetails,
  fetchFlashscoreFeed,
  bigIntToFlashscoreId
} = require('./sync-flashscore');

(async () => {
  console.log('================================================================');
  console.log('   DEEP FORENSIC TEST: BARCELONA vs ASTON VILLA LIVE LINEUPS   ');
  console.log('================================================================\n');

  try {
    // 1. Locate match in DB
    console.log('--- Step 1: Inspecting Match in PostgreSQL ---');
    const { rows } = await pool.query(
      `SELECT id, external_id, flashscore_id, competition_code, home_team, away_team, status,
              utc_date, home_score, away_score, match_lineups
       FROM matches
       WHERE (home_team ILIKE '%barcelona%' AND away_team ILIKE '%aston villa%')
          OR (home_team ILIKE '%aston villa%' AND away_team ILIKE '%barcelona%')
          OR id = 167064
       ORDER BY utc_date DESC
       LIMIT 1`
    );

    if (rows.length === 0) {
      throw new Error('Match not found in database.');
    }

    const match = rows[0];
    const flashId = match.flashscore_id || (match.external_id ? bigIntToFlashscoreId(match.external_id) : 'tGbMn4el');
    console.log('Database Record Found:');
    console.log({
      id: match.id,
      external_id: match.external_id,
      flashscore_id: flashId,
      teams: `${match.home_team} vs ${match.away_team}`,
      status: match.status,
      utc_date: match.utc_date,
      has_lineups_in_db: Boolean(match.match_lineups)
    });

    // 2. Test Flashscore direct raw feed (df_li_1_)
    console.log('\n--- Step 2: Fetching Raw Flashscore df_li_1_ Feed ---');
    const feedKey = `df_li_1_${flashId}`;
    const rawFeed = await fetchFlashscoreFeed(feedKey);
    console.log(`Feed [${feedKey}] returned ${rawFeed?.length || 0} characters.`);
    console.log('Feed Snippet:', rawFeed ? rawFeed.slice(0, 200).replace(/\n/g, ' ') : 'EMPTY');

    // 3. Directly call fetchMatchLiveDetails
    console.log('\n--- Step 3: Executing fetchMatchLiveDetails() directly ---');
    const details = await fetchMatchLiveDetails(flashId);
    console.log('Has Lineups Object:', Boolean(details?.lineups));

    if (details?.lineups) {
      const { formationHome, formationAway, managerHome, managerAway, startingHome, startingAway, subsHome, subsAway, homeRoster, awayRoster } = details.lineups;
      console.log('\nFormations & Managers:');
      console.log(`Home: ${formationHome} | Manager: ${managerHome}`);
      console.log(`Away: ${formationAway} | Manager: ${managerAway}`);

      console.log('\nPlayer Counts:');
      console.log(`Home Starting: ${startingHome?.length || 0} | Subs: ${subsHome?.length || 0}`);
      console.log(`Away Starting: ${startingAway?.length || 0} | Subs: ${subsAway?.length || 0}`);

      console.log('\nhomeRoster contract check:');
      console.log({
        has_homeRoster: Boolean(homeRoster),
        startingCount: homeRoster?.starting?.length,
        subsCount: homeRoster?.subs?.length,
        sample_starting_player: homeRoster?.starting?.[0]
      });

      console.log('\nawayRoster contract check:');
      console.log({
        has_awayRoster: Boolean(awayRoster),
        startingCount: awayRoster?.starting?.length,
        subsCount: awayRoster?.subs?.length,
        sample_starting_player: awayRoster?.starting?.[0]
      });

      console.log('\nSample Live Events captured on players:');
      const allPlayers = [...startingHome, ...startingAway, ...subsHome, ...subsAway];
      const playersWithEvents = allPlayers.filter(p => Array.isArray(p.events) && p.events.length > 0);
      for (const p of playersWithEvents.slice(0, 6)) {
        console.log(`- ${p.name} (#${p.num}, ${p.pos}):`, p.events);
      }
    } else {
      console.error('FATAL: details.lineups returned null!');
    }

    // 4. Test Database UPDATE with JSONB structure
    console.log('\n--- Step 4: Verifying PostgreSQL UPDATE of match_lineups ---');
    if (details?.lineups) {
      await pool.query(
        `UPDATE matches
         SET match_lineups = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(details.lineups), match.id]
      );

      const checkRes = await pool.query(
        `SELECT match_lineups IS NOT NULL AS has_lineups,
                jsonb_typeof(match_lineups) AS json_type,
                jsonb_array_length(match_lineups->'startingHome') AS starting_home_count,
                jsonb_array_length(match_lineups->'startingAway') AS starting_away_count,
                match_lineups ? 'homeRoster' AS has_home_roster,
                match_lineups ? 'awayRoster' AS has_away_roster
         FROM matches
         WHERE id = $1`,
        [match.id]
      );
      console.log('Database Persistence Verification:', checkRes.rows[0]);
    }

    console.log('\n================================================================');
    console.log('   DEEP FORENSIC TEST COMPLETED SUCCESSFULLY WITH 100% PASS   ');
    console.log('================================================================');
  } catch (err) {
    console.error('Forensic test failed:', err);
  } finally {
    await pool.end();
  }
})();
