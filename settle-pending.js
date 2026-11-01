require('dotenv').config();
const { Pool } = require('pg');
const { resolveMarkets } = require('./pricingEngine');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function settlePendingMatches() {
  console.log('=====================================================');
  console.log('   STARTING SETTLEMENT OF PENDING FINISHED MATCHES');
  console.log('=====================================================');

  // Also check for matches that started > 125 minutes ago with scores that are still IN_PLAY or PAUSED
  const autoFinishRes = await pool.query(`
    UPDATE matches
    SET status = 'FINISHED', updated_at = NOW()
    WHERE status IN ('IN_PLAY', 'PAUSED')
      AND utc_date < NOW() - INTERVAL '125 minutes'
      AND home_score IS NOT NULL
      AND away_score IS NOT NULL
    RETURNING id, home_team, away_team, home_score, away_score
  `);
  if (autoFinishRes.rowCount > 0) {
    console.log(`✓ Auto-transitioned ${autoFinishRes.rowCount} overdue live matches to FINISHED:`);
    console.table(autoFinishRes.rows);
  }

  // Fetch all finished matches that haven't been settled yet
  const { rows: finished } = await pool.query(`
    SELECT id, home_team, away_team, home_score, away_score, home_ht, away_ht, utc_date
    FROM matches
    WHERE status = 'FINISHED'
      AND points_calculated = FALSE
      AND home_score IS NOT NULL
      AND away_score IS NOT NULL
    ORDER BY utc_date ASC
  `);

  console.log(`Found ${finished.length} finished matches pending settlement.`);

  let totalPredsSettled = 0;
  let matchesSettled = 0;

  for (const m of finished) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const locked = await client.query(`
        SELECT id, home_team, away_team, home_score, away_score, home_ht, away_ht, utc_date
        FROM matches
        WHERE id = $1 AND status = 'FINISHED' AND points_calculated = FALSE
        FOR UPDATE SKIP LOCKED
      `, [m.id]);

      if (locked.rowCount === 0) {
        await client.query('ROLLBACK');
        continue;
      }

      const lockedMatch = locked.rows[0];
      const outcomes = resolveMarkets({
        home: lockedMatch.home_score,
        away: lockedMatch.away_score,
        htHome: lockedMatch.home_ht,
        htAway: lockedMatch.away_ht
      });

      const { rows: preds } = await client.query(`
        SELECT id, user_id, predicted_outcome, predicted_home, predicted_away, is_boosted,
               outcome_points_locked, exact_points_locked, extras_picks
        FROM predictions
        WHERE match_id = $1 AND points_awarded IS NULL
        FOR UPDATE
      `, [lockedMatch.id]);

      for (const pred of preds) {
        let base = 0;

        // "Who wins" pick (1X2)
        if (pred.predicted_outcome && pred.predicted_outcome === outcomes.outcome_1x2) {
          base += Number(pred.outcome_points_locked || 0);
        }

        // Exact score pick
        const hasScore = pred.predicted_home !== null && pred.predicted_away !== null;
        const isExact = hasScore && `${pred.predicted_home}-${pred.predicted_away}` === outcomes.exact_score;
        if (isExact) base += Number(pred.exact_points_locked || 0);

        // Extras
        const picks = Array.isArray(pred.extras_picks) ? pred.extras_picks : [];
        const settledExtras = picks.map((pick) => {
          const actual = outcomes.extras ? outcomes.extras[pick.market] : undefined;
          if (actual === null || actual === undefined) {
            return { ...pick, status: 'VOID', won: null, points_earned: 0 };
          }
          const won = actual === pick.selection;
          const earned = won ? Number(pick.points_locked || 0) : 0;
          base += earned;
          return { ...pick, status: won ? 'WON' : 'LOST', won, points_earned: earned };
        });

        const finalPoints = base;

        await client.query(`
          UPDATE predictions
          SET points_awarded = $1, extras_picks = $2::jsonb, updated_at = NOW()
          WHERE id = $3
        `, [finalPoints, JSON.stringify(settledExtras), pred.id]);

        await client.query(`
          UPDATE users
          SET total_points = total_points + $1,
              exact_scores_count = exact_scores_count + $2
          WHERE id = $3
        `, [finalPoints, isExact ? 1 : 0, pred.user_id]);
      }

      await client.query(`
        UPDATE matches
        SET points_calculated = TRUE,
            settled_outcomes = $1::jsonb,
            settled_home_score = $2,
            settled_away_score = $3,
            settled_home_ht = $4,
            settled_away_ht = $5,
            updated_at = NOW()
        WHERE id = $6
      `, [
        JSON.stringify(outcomes),
        lockedMatch.home_score,
        lockedMatch.away_score,
        lockedMatch.home_ht,
        lockedMatch.away_ht,
        lockedMatch.id
      ]);

      await client.query('COMMIT');
      matchesSettled++;
      totalPredsSettled += preds.length;
      console.log(`[Settle] Match ${lockedMatch.id} (${lockedMatch.home_team} ${lockedMatch.home_score}-${lockedMatch.away_score} ${lockedMatch.away_team}): settled ${preds.length} predictions`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[Settle] Failed for match ${m.id}:`, err.message);
    } finally {
      client.release();
    }
  }

  console.log('=====================================================');
  console.log(`   SETTLEMENT SUMMARY: ${matchesSettled} matches settled, ${totalPredsSettled} user predictions awarded points.`);
  console.log('=====================================================');

  await pool.end();
  process.exit(0);
}

settlePendingMatches().catch(err => {
  console.error('Fatal error during settlement:', err);
  process.exit(1);
});
