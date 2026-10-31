'use strict';

const assert = require('node:assert/strict');
const {
  cleanExtrasPicks,
  revertPredictionSettlement,
  calculatePredictionSettlement,
  applyCorrectionToPrediction,
  shouldAllowCorrection
} = require('./settlementCorrection');

function runTests() {
  console.log('Running settlement correction unit tests...');

  // -------------------------------------------------------------------------
  // Test 1: Chelsea vs Man United - 3-0 to 2-0 (HT 0-0)
  // Player A: predicted 2-0 (HOME, outcome locked: 12, exact locked: 35)
  // Under 3-0: won outcome 12, lost exact -> points_awarded was 12
  // Under 2-0: won outcome 12, won exact 35 -> points_awarded should be 47
  // -------------------------------------------------------------------------
  {
    const user = { total_points: 100, exact_scores_count: 2 };
    const prediction = {
      predicted_outcome: 'HOME',
      predicted_home: 2,
      predicted_away: 0,
      outcome_points_locked: 12,
      exact_points_locked: 35,
      points_awarded: 12,
      extras_picks: []
    };
    const oldScore = { home: 3, away: 0, htHome: 0, htAway: 0 };
    const newScore = { home: 2, away: 0, htHome: 0, htAway: 0 };

    const result = applyCorrectionToPrediction({
      user,
      prediction,
      oldSettledScore: oldScore,
      newScore
    });

    assert.equal(result.prediction.points_awarded, 47, 'Player A new points awarded must be 47 (12 + 35)');
    assert.equal(result.user.total_points, 135, 'User total points should go from 100 - 12 + 47 = 135');
    assert.equal(result.user.exact_scores_count, 3, 'User exact scores count should increment by 1 (2 -> 3)');
    assert.equal(result.deltaPoints, 35, 'Net delta points should be +35');
    assert.equal(result.deltaExact, 1, 'Net delta exact should be +1');
  }

  // -------------------------------------------------------------------------
  // Test 2: Player B predicted exact 3-0 on old score
  // Under 3-0: won outcome 12 + exact 35 = 47 pts, exact_scores_count was incremented
  // Under 2-0: won outcome 12, lost exact -> points_awarded should be 12, exact_count -1
  // -------------------------------------------------------------------------
  {
    const user = { total_points: 150, exact_scores_count: 5 };
    const prediction = {
      predicted_outcome: 'HOME',
      predicted_home: 3,
      predicted_away: 0,
      outcome_points_locked: 12,
      exact_points_locked: 35,
      points_awarded: 47,
      extras_picks: []
    };
    const oldScore = { home: 3, away: 0, htHome: 0, htAway: 0 };
    const newScore = { home: 2, away: 0, htHome: 0, htAway: 0 };

    const result = applyCorrectionToPrediction({
      user,
      prediction,
      oldSettledScore: oldScore,
      newScore
    });

    assert.equal(result.prediction.points_awarded, 12, 'Player B new points awarded must be 12 (outcome only)');
    assert.equal(result.user.total_points, 115, 'User total points should go from 150 - 47 + 12 = 115');
    assert.equal(result.user.exact_scores_count, 4, 'User exact count should decrement by 1 (5 -> 4)');
    assert.equal(result.deltaPoints, -35, 'Net delta points should be -35');
    assert.equal(result.deltaExact, -1, 'Net delta exact should be -1');
  }

  // -------------------------------------------------------------------------
  // Test 3: Player C without extras_picks (empty array or null)
  // Ensures extras_picks is never null and remains '[]'
  // -------------------------------------------------------------------------
  {
    assert.deepEqual(cleanExtrasPicks(null), [], 'cleanExtrasPicks(null) must return empty array');
    assert.deepEqual(cleanExtrasPicks(undefined), [], 'cleanExtrasPicks(undefined) must return empty array');
    assert.deepEqual(cleanExtrasPicks([]), [], 'cleanExtrasPicks([]) must return empty array');

    const user = { total_points: 50, exact_scores_count: 1 };
    const prediction = {
      predicted_outcome: 'DRAW',
      predicted_home: 1,
      predicted_away: 1,
      outcome_points_locked: 20,
      exact_points_locked: 40,
      points_awarded: 0,
      extras_picks: null // test null safety
    };
    const oldScore = { home: 3, away: 0, htHome: 0, htAway: 0 };
    const newScore = { home: 2, away: 0, htHome: 0, htAway: 0 };

    const result = applyCorrectionToPrediction({
      user,
      prediction,
      oldSettledScore: oldScore,
      newScore
    });

    assert.ok(Array.isArray(result.prediction.extras_picks), 'extras_picks must be an array');
    assert.equal(result.prediction.extras_picks.length, 0, 'extras_picks must remain empty');
    assert.notEqual(result.prediction.extras_picks, null, 'extras_picks must not be null');
  }

  // -------------------------------------------------------------------------
  // Test 4: With extras (e.g. ou_2_5 OVER: 3-0 was OVER, 2-0 is UNDER)
  // -------------------------------------------------------------------------
  {
    const user = { total_points: 80, exact_scores_count: 0 };
    const prediction = {
      predicted_outcome: 'HOME',
      predicted_home: 2,
      predicted_away: 1,
      outcome_points_locked: 12,
      exact_points_locked: 35,
      points_awarded: 30, // 12 (home) + 18 (ou_2_5 OVER)
      extras_picks: [
        { market: 'ou_2_5', selection: 'OVER', points_locked: 18, status: 'WON', won: true, points_earned: 18 }
      ]
    };
    const oldScore = { home: 3, away: 0, htHome: 0, htAway: 0 };
    const newScore = { home: 2, away: 0, htHome: 0, htAway: 0 }; // 2 goals = UNDER

    const result = applyCorrectionToPrediction({
      user,
      prediction,
      oldSettledScore: oldScore,
      newScore
    });

    assert.equal(result.prediction.points_awarded, 12, 'ou_2_5 OVER lost in 2-0, only outcome HOME (12) awarded');
    assert.equal(result.user.total_points, 62, 'User total points should be 80 - 30 + 12 = 62');
    assert.equal(result.prediction.extras_picks[0].status, 'LOST', 'ou_2_5 extra should be LOST');
    assert.equal(result.prediction.extras_picks[0].won, false, 'won must be false');
    assert.equal(result.prediction.extras_picks[0].points_earned, 0, 'points_earned must be 0');
  }

  // -------------------------------------------------------------------------
  // Test 5: Idempotency - Calling revert twice DOES NOT deduct twice
  // -------------------------------------------------------------------------
  {
    const user = { total_points: 100, exact_scores_count: 2 };
    const prediction = {
      predicted_outcome: 'HOME',
      predicted_home: 3,
      predicted_away: 0,
      points_awarded: 47,
      extras_picks: []
    };
    const oldScore = { home: 3, away: 0 };

    // First revert
    const revert1 = revertPredictionSettlement({ user, prediction, oldSettledScore: oldScore });
    assert.equal(revert1.reverted, true, 'First revert should succeed');
    assert.equal(revert1.user.total_points, 53, 'Points deducted: 100 - 47 = 53');
    assert.equal(revert1.user.exact_scores_count, 1, 'Exact count decremented: 2 - 1 = 1');
    assert.equal(revert1.prediction.points_awarded, null, 'points_awarded set to null');

    // Second revert on the already-reverted prediction
    const revert2 = revertPredictionSettlement({
      user: revert1.user,
      prediction: revert1.prediction,
      oldSettledScore: oldScore
    });
    assert.equal(revert2.reverted, false, 'Second revert should be a no-op');
    assert.equal(revert2.user.total_points, 53, 'User points must NOT be deducted again');
    assert.equal(revert2.user.exact_scores_count, 1, 'User exact count must NOT be decremented again');
    assert.equal(revert2.deductedPoints, 0, 'deductedPoints must be 0 on second call');
    assert.equal(revert2.deductedExact, 0, 'deductedExact must be 0 on second call');
  }

  // -------------------------------------------------------------------------
  // Test 6: Eligibility checks in shouldAllowCorrection
  // - Rejects if status !== 'FINISHED'
  // - Rejects if new scores are null
  // - Rejects if kickoff > 48h ago
  // - Rejects if last_corrected_at < 60s ago
  // - Accepts valid 3-0 -> 2-0 change within 48h
  // -------------------------------------------------------------------------
  {
    const now = Date.now();
    const baseMatch = {
      id: 10730,
      status: 'FINISHED',
      home_score: 3,
      away_score: 0,
      home_ht: 0,
      away_ht: 0,
      settled_home_score: 3,
      settled_away_score: 0,
      settled_home_ht: 0,
      settled_away_ht: 0,
      points_calculated: true,
      utc_date: new Date(now - 2 * 3600 * 1000).toISOString(), // 2 hours ago
      last_corrected_at: null
    };

    // Valid correction
    const checkValid = shouldAllowCorrection({
      match: baseMatch,
      newStatus: 'FINISHED',
      newScore: { home: 2, away: 0, htHome: 0, htAway: 0 },
      now
    });
    assert.equal(checkValid.allow, true, 'Valid correction within 48h should be allowed');
    assert.equal(checkValid.oldScore.home, 3);
    assert.equal(checkValid.oldScore.away, 0);

    // Rejection 1: Non-FINISHED status
    const checkNotFinished = shouldAllowCorrection({
      match: baseMatch,
      newStatus: 'IN_PLAY',
      newScore: { home: 2, away: 0, htHome: 0, htAway: 0 },
      now
    });
    assert.equal(checkNotFinished.allow, false);
    assert.ok(checkNotFinished.reason.includes('Status is not FINISHED'));

    // Rejection 2: Null full-time score
    const checkNullScore = shouldAllowCorrection({
      match: baseMatch,
      newStatus: 'FINISHED',
      newScore: { home: null, away: 0, htHome: 0, htAway: 0 },
      now
    });
    assert.equal(checkNullScore.allow, false);
    assert.ok(checkNullScore.reason.includes('null'));

    // Rejection 3: Older than 48 hours
    const oldMatch = {
      ...baseMatch,
      utc_date: new Date(now - 50 * 3600 * 1000).toISOString() // 50 hours ago
    };
    const checkOld = shouldAllowCorrection({
      match: oldMatch,
      newStatus: 'FINISHED',
      newScore: { home: 2, away: 0, htHome: 0, htAway: 0 },
      now
    });
    assert.equal(checkOld.allow, false);
    assert.ok(checkOld.reason.includes('limit 48h'));

    // Rejection 4: Throttled (corrected 30s ago)
    const recentlyCorrectedMatch = {
      ...baseMatch,
      last_corrected_at: new Date(now - 30 * 1000).toISOString() // 30s ago
    };
    const checkThrottled = shouldAllowCorrection({
      match: recentlyCorrectedMatch,
      newStatus: 'FINISHED',
      newScore: { home: 2, away: 0, htHome: 0, htAway: 0 },
      now
    });
    assert.equal(checkThrottled.allow, false);
    assert.ok(checkThrottled.reason.includes('Rate limited'));

    // Rejection 5: Same score (no change)
    const checkSameScore = shouldAllowCorrection({
      match: baseMatch,
      newStatus: 'FINISHED',
      newScore: { home: 3, away: 0, htHome: 0, htAway: 0 },
      now
    });
    assert.equal(checkSameScore.allow, false);
    assert.ok(checkSameScore.reason.includes('Scores match settled score'));
  }

  console.log('All settlement correction unit tests passed successfully!');
}

try {
  runTests();
} catch (err) {
  console.error('Settlement correction test failed:', err);
  process.exitCode = 1;
}
