'use strict';

const { resolveMarkets } = require('./pricingEngine');

const MAX_CORRECTION_HOURS = 48;
const MIN_CORRECTION_INTERVAL_MS = 60 * 1000; // 1 minute flip-flop guard

/**
 * Strips settlement properties from extras_picks and guarantees a valid array (never null).
 * @param {Array|null|undefined} extras
 * @returns {Array}
 */
function cleanExtrasPicks(extras) {
  if (!Array.isArray(extras) || extras.length === 0) {
    return [];
  }
  return extras.map((pick) => ({
    market: pick.market,
    selection: pick.selection,
    points_locked: Number(pick.points_locked || 0)
  }));
}

/**
 * Reverts the points and exact-score count awarded in a previous settlement.
 * Safe to call repeatedly: if points_awarded is null, it performs no deduction.
 *
 * @param {Object} params
 * @param {Object} params.user { total_points, exact_scores_count }
 * @param {Object} params.prediction { points_awarded, predicted_home, predicted_away, extras_picks }
 * @param {Object} params.oldSettledScore { home, away }
 * @returns {Object} { user, prediction, reverted, deductedPoints, deductedExact }
 */
function revertPredictionSettlement({ user, prediction, oldSettledScore }) {
  if (prediction.points_awarded === null || prediction.points_awarded === undefined) {
    return {
      user: { ...user },
      prediction: {
        ...prediction,
        extras_picks: cleanExtrasPicks(prediction.extras_picks)
      },
      reverted: false,
      deductedPoints: 0,
      deductedExact: 0
    };
  }

  const deductedPoints = Number(prediction.points_awarded || 0);
  const newUserTotal = Math.max(0, Number(user.total_points || 0) - deductedPoints);

  const hadExact =
    prediction.predicted_home !== null &&
    prediction.predicted_home !== undefined &&
    prediction.predicted_away !== null &&
    prediction.predicted_away !== undefined &&
    oldSettledScore &&
    oldSettledScore.home !== null &&
    oldSettledScore.home !== undefined &&
    oldSettledScore.away !== null &&
    oldSettledScore.away !== undefined &&
    Number(prediction.predicted_home) === Number(oldSettledScore.home) &&
    Number(prediction.predicted_away) === Number(oldSettledScore.away);

  const deductedExact = hadExact ? 1 : 0;
  const newUserExact = Math.max(0, Number(user.exact_scores_count || 0) - deductedExact);

  return {
    user: {
      ...user,
      total_points: newUserTotal,
      exact_scores_count: newUserExact
    },
    prediction: {
      ...prediction,
      points_awarded: null,
      extras_picks: cleanExtrasPicks(prediction.extras_picks)
    },
    reverted: true,
    deductedPoints,
    deductedExact
  };
}

/**
 * Calculates new prediction points and settled extras against resolved outcomes.
 *
 * @param {Object} params
 * @param {Object} params.prediction
 * @param {Object} params.outcomes (output of resolveMarkets)
 * @returns {Object} { points_awarded, isExact, extras_picks }
 */
function calculatePredictionSettlement({ prediction, outcomes }) {
  let base = 0;

  // 1X2 Outcome
  if (prediction.predicted_outcome && prediction.predicted_outcome === outcomes.outcome_1x2) {
    base += Number(prediction.outcome_points_locked || 0);
  }

  // Exact Score
  const hasScore =
    prediction.predicted_home !== null &&
    prediction.predicted_home !== undefined &&
    prediction.predicted_away !== null &&
    prediction.predicted_away !== undefined;

  const isExact = hasScore && `${prediction.predicted_home}-${prediction.predicted_away}` === outcomes.exact_score;
  if (isExact) {
    base += Number(prediction.exact_points_locked || 0);
  }

  // Extras
  const picks = cleanExtrasPicks(prediction.extras_picks);
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

  return {
    points_awarded: base,
    isExact,
    extras_picks: settledExtras
  };
}

/**
 * Full end-to-end correction calculation for a single user prediction:
 * Reverts old settlement, recalculates against new score, and returns updated user and prediction.
 *
 * @param {Object} params
 * @param {Object} params.user
 * @param {Object} params.prediction
 * @param {Object} params.oldSettledScore { home, away, htHome, htAway }
 * @param {Object} params.newScore { home, away, htHome, htAway }
 * @returns {Object}
 */
function applyCorrectionToPrediction({ user, prediction, oldSettledScore, newScore }) {
  const revertResult = revertPredictionSettlement({ user, prediction, oldSettledScore });

  const outcomes = resolveMarkets({
    home: newScore.home,
    away: newScore.away,
    htHome: newScore.htHome,
    htAway: newScore.htAway
  });

  const settlement = calculatePredictionSettlement({
    prediction: revertResult.prediction,
    outcomes
  });

  const finalTotal = revertResult.user.total_points + settlement.points_awarded;
  const finalExact = revertResult.user.exact_scores_count + (settlement.isExact ? 1 : 0);

  return {
    user: {
      ...revertResult.user,
      total_points: finalTotal,
      exact_scores_count: finalExact
    },
    prediction: {
      ...revertResult.prediction,
      points_awarded: settlement.points_awarded,
      extras_picks: settlement.extras_picks
    },
    outcomes,
    deltaPoints: finalTotal - Number(user.total_points || 0),
    deltaExact: finalExact - Number(user.exact_scores_count || 0)
  };
}

/**
 * Validates whether a match is eligible for automatic score correction.
 *
 * @param {Object} params
 * @param {Object} params.match
 * @param {string} params.newStatus
 * @param {Object} params.newScore { home, away, htHome, htAway }
 * @param {number} [params.now]
 * @returns {Object} { allow: boolean, reason: string|null, oldScore: Object }
 */
function shouldAllowCorrection({ match, newStatus, newScore, now = Date.now() }) {
  if (newStatus !== 'FINISHED') {
    return { allow: false, reason: 'Status is not FINISHED' };
  }

  if (newScore.home === null || newScore.home === undefined || newScore.away === null || newScore.away === undefined) {
    return { allow: false, reason: 'New score contains null full-time score' };
  }

  const matchKickoff = new Date(match.utc_date).getTime();
  const hoursSinceKickoff = (now - matchKickoff) / 3600000;
  if (hoursSinceKickoff >= MAX_CORRECTION_HOURS) {
    return { allow: false, reason: `Match kicked off ${hoursSinceKickoff.toFixed(1)}h ago (limit ${MAX_CORRECTION_HOURS}h)` };
  }

  if (match.last_corrected_at) {
    const timeSinceLastCorrection = now - new Date(match.last_corrected_at).getTime();
    if (timeSinceLastCorrection < MIN_CORRECTION_INTERVAL_MS) {
      return { allow: false, reason: `Rate limited: last corrected ${Math.round(timeSinceLastCorrection / 1000)}s ago` };
    }
  }

  const oldHome = match.settled_home_score !== null && match.settled_home_score !== undefined
    ? Number(match.settled_home_score)
    : (match.home_score !== null && match.home_score !== undefined ? Number(match.home_score) : null);

  const oldAway = match.settled_away_score !== null && match.settled_away_score !== undefined
    ? Number(match.settled_away_score)
    : (match.away_score !== null && match.away_score !== undefined ? Number(match.away_score) : null);

  const oldHtHome = match.settled_home_ht !== null && match.settled_home_ht !== undefined
    ? Number(match.settled_home_ht)
    : (match.home_ht !== null && match.home_ht !== undefined ? Number(match.home_ht) : null);

  const oldHtAway = match.settled_away_ht !== null && match.settled_away_ht !== undefined
    ? Number(match.settled_away_ht)
    : (match.away_ht !== null && match.away_ht !== undefined ? Number(match.away_ht) : null);

  const isScoreDifferent =
    oldHome === null ||
    oldAway === null ||
    newScore.home !== oldHome ||
    newScore.away !== oldAway ||
    (newScore.htHome !== null && newScore.htHome !== undefined && newScore.htHome !== oldHtHome) ||
    (newScore.htAway !== null && newScore.htAway !== undefined && newScore.htAway !== oldHtAway);

  if (!isScoreDifferent) {
    return { allow: false, reason: 'Scores match settled score' };
  }

  return {
    allow: true,
    reason: null,
    oldScore: {
      home: oldHome,
      away: oldAway,
      htHome: oldHtHome,
      htAway: oldHtAway
    }
  };
}

module.exports = {
  cleanExtrasPicks,
  revertPredictionSettlement,
  calculatePredictionSettlement,
  applyCorrectionToPrediction,
  shouldAllowCorrection,
  MAX_CORRECTION_HOURS,
  MIN_CORRECTION_INTERVAL_MS
};
