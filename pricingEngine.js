'use strict';

/**
 * pricingEngine.js  -  100% free stack (no odds, no paid APIs)
 *
 * 1. teamRatings()      -> attack/defence strengths from finished matches
 * 2. matchLambdas()     -> expected goals (home, away) for one match
 * 3. buildMarketsPoints -> dynamic points for every market (kickso-style):
 *        points = round( base * (pMostLikely / p) ^ 0.585 ), clamped to [base, cap]
 * 4. resolveMarkets     -> settles every market from full-time + half-time score
 */

// ---------------------------------------------------------------------------
// Market configuration
// ---------------------------------------------------------------------------
// kickso-style pricing, reverse-engineered from the "How the score pays" grids:
//   points = round( base * ( pMostLikely / p ) ^ 0.585 ),  clamped to [base, cap]
// i.e. the most likely option of a market pays exactly `base`, and every time an
// option is half as likely as that one it pays about 1.5x more (2^0.585 ~= 1.5).
const POINTS_EXPONENT = 0.585;

const MARKET_CONFIG = {
  OUTCOME_1X2: { base: 10, cap: 50 },
  EXACT_SCORE: { base: 25, cap: 113 },
  EXTRA: { cap: 35 }
};

// The 10 extras. All of them can be settled from the full-time and half-time score.
const EXTRA_MARKETS = {
  btts: ['YES', 'NO'],                          // both teams score
  ou_1_5: ['OVER', 'UNDER'],                    // total goals 1.5
  ou_2_5: ['OVER', 'UNDER'],                    // total goals 2.5
  ou_3_5: ['OVER', 'UNDER'],                    // total goals 3.5
  ht_leader: ['HOME', 'DRAW', 'AWAY'],          // who leads at half-time
  goal_both_halves: ['YES', 'NO'],              // at least one goal in each half
  // "any clean sheet" would just be the opposite of BTTS, so this one is 4-way:
  // HOME = only the home team keeps a clean sheet, AWAY = only the away team,
  // BOTH = 0-0, NONE = both teams score
  clean_sheet: ['HOME', 'AWAY', 'BOTH', 'NONE'],
  win_by_2plus: ['YES', 'NO'],                  // a team wins by 2+ goals
  goals_odd_even: ['ODD', 'EVEN'],              // total goals odd or even
  more_goals_half: ['FIRST', 'SECOND', 'EQUAL'] // which half has more goals
};

const HT_DEPENDENT_MARKETS = ['ht_leader', 'goal_both_halves', 'more_goals_half'];

// Minimum points of each extra (what its most likely option pays). Like kickso:
// two-way markets start at 10, three-way / half-time markets start at 12.
const EXTRA_BASE = {
  btts: 10,
  ou_1_5: 10,
  ou_2_5: 10,
  ou_3_5: 10,
  ht_leader: 12,
  goal_both_halves: 12,
  clean_sheet: 12,
  win_by_2plus: 10,
  goals_odd_even: 10,
  more_goals_half: 12
};

const FIRST_HALF_SHARE = 0.45; // share of expected goals scored in the first half

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function poissonArray(lambda, n) {
  const arr = new Array(n + 1);
  arr[0] = Math.exp(-lambda);
  for (let k = 1; k <= n; k++) arr[k] = (arr[k - 1] * lambda) / k;
  return arr;
}

function relativePoints(p, pMax, base, cap) {
  const safeP = Math.max(Number(p) || 0, 1e-6);
  const ratio = Math.max(1, pMax / safeP);
  return clamp(Math.round(base * Math.pow(ratio, POINTS_EXPONENT)), base, cap);
}

function normalize(obj) {
  const total = Object.values(obj).reduce((a, b) => a + b, 0);
  if (!(total > 0)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v / total;
  return out;
}

// ---------------------------------------------------------------------------
// 1 + 2. Expected goals from finished matches
// ---------------------------------------------------------------------------
const DEFAULT_AVG_HOME = 1.45;
const DEFAULT_AVG_AWAY = 1.15;
const SHRINK_GAMES = 6;        // how strongly ratings are pulled to the league average
const MIN_MATCHES_FOR_LEAGUE_AVG = 10;

/**
 * finished: [{ homeId, awayId, homeGoals, awayGoals }]
 * returns { avgHome, avgAway, ratings: Map(teamId -> { attack, defence, games }) }
 */
function teamRatings(finished) {
  let sumHome = 0;
  let sumAway = 0;
  const raw = new Map();

  const bump = (id, scored, conceded) => {
    const r = raw.get(id) || { scored: 0, conceded: 0, games: 0 };
    r.scored += scored;
    r.conceded += conceded;
    r.games += 1;
    raw.set(id, r);
  };

  for (const m of finished) {
    sumHome += m.homeGoals;
    sumAway += m.awayGoals;
    bump(m.homeId, m.homeGoals, m.awayGoals);
    bump(m.awayId, m.awayGoals, m.homeGoals);
  }

  const n = finished.length;
  const avgHome = n >= MIN_MATCHES_FOR_LEAGUE_AVG ? sumHome / n : DEFAULT_AVG_HOME;
  const avgAway = n >= MIN_MATCHES_FOR_LEAGUE_AVG ? sumAway / n : DEFAULT_AVG_AWAY;
  const avgPerTeamGame = (avgHome + avgAway) / 2;

  const ratings = new Map();
  for (const [id, r] of raw.entries()) {
    const w = r.games / (r.games + SHRINK_GAMES);
    const attackRaw = r.scored / r.games / avgPerTeamGame;
    const defenceRaw = r.conceded / r.games / avgPerTeamGame;
    ratings.set(id, {
      attack: 1 + w * (attackRaw - 1),
      defence: 1 + w * (defenceRaw - 1),
      games: r.games
    });
  }

  return { avgHome, avgAway, ratings };
}

function matchLambdas(homeId, awayId, model) {
  const h = model.ratings.get(homeId) || { attack: 1, defence: 1 };
  const a = model.ratings.get(awayId) || { attack: 1, defence: 1 };
  const lambdaHome = clamp(model.avgHome * h.attack * a.defence, 0.3, 3.8);
  const lambdaAway = clamp(model.avgAway * a.attack * h.defence, 0.3, 3.8);
  return {
    lambdaHome: Number(lambdaHome.toFixed(2)),
    lambdaAway: Number(lambdaAway.toFixed(2))
  };
}

// ---------------------------------------------------------------------------
// 3. Probabilities and points for every market
// ---------------------------------------------------------------------------
function computeProbabilities(lh, la) {
  const N = 14;
  const ph = poissonArray(lh, N);
  const pa = poissonArray(la, N);
  const total = lh + la;

  // Full-time joint grid
  let home = 0, draw = 0, away = 0, win2 = 0, mass = 0;
  const exact = {};
  for (let h = 0; h <= N; h++) {
    for (let a = 0; a <= N; a++) {
      const p = ph[h] * pa[a];
      mass += p;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
      if (Math.abs(h - a) >= 2) win2 += p;
      if (h <= 7 && a <= 7) exact[`${h}-${a}`] = p;
    }
  }
  for (const key of Object.keys(exact)) exact[key] /= mass;
  win2 /= mass;

  // Total goals (sum of two Poissons is Poisson)
  const pt = poissonArray(total, 30);
  const over = (line) => {
    let under = 0;
    for (let g = 0; g <= line; g++) under += pt[g];
    return clamp(1 - under, 0.0005, 0.9995);
  };
  const pEven = (1 + Math.exp(-2 * total)) / 2;

  // Both teams score / clean sheets
  const pHomeScores = 1 - Math.exp(-lh);
  const pAwayScores = 1 - Math.exp(-la);
  const pBtts = pHomeScores * pAwayScores;

  // First half
  const h1 = poissonArray(lh * FIRST_HALF_SHARE, 10);
  const a1 = poissonArray(la * FIRST_HALF_SHARE, 10);
  let htHome = 0, htDraw = 0, htAway = 0;
  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const p = h1[h] * a1[a];
      if (h > a) htHome += p;
      else if (h === a) htDraw += p;
      else htAway += p;
    }
  }

  // Goals per half
  const g1 = poissonArray(total * FIRST_HALF_SHARE, 25);
  const g2 = poissonArray(total * (1 - FIRST_HALF_SHARE), 25);
  let first = 0, equal = 0, second = 0;
  for (let i = 0; i <= 25; i++) {
    for (let j = 0; j <= 25; j++) {
      const p = g1[i] * g2[j];
      if (i > j) first += p;
      else if (i === j) equal += p;
      else second += p;
    }
  }
  const pBothHalves =
    (1 - Math.exp(-total * FIRST_HALF_SHARE)) * (1 - Math.exp(-total * (1 - FIRST_HALF_SHARE)));

  return {
    outcome_1x2: normalize({ HOME: home, DRAW: draw, AWAY: away }),
    exact_score: exact,
    extras: {
      btts: normalize({ YES: pBtts, NO: 1 - pBtts }),
      ou_1_5: normalize({ OVER: over(1), UNDER: 1 - over(1) }),
      ou_2_5: normalize({ OVER: over(2), UNDER: 1 - over(2) }),
      ou_3_5: normalize({ OVER: over(3), UNDER: 1 - over(3) }),
      ht_leader: normalize({ HOME: htHome, DRAW: htDraw, AWAY: htAway }),
      goal_both_halves: normalize({ YES: pBothHalves, NO: 1 - pBothHalves }),
      clean_sheet: normalize({
        HOME: Math.exp(-la) * pHomeScores,
        AWAY: Math.exp(-lh) * pAwayScores,
        BOTH: Math.exp(-total),
        NONE: pBtts
      }),
      win_by_2plus: normalize({ YES: win2, NO: 1 - win2 }),
      goals_odd_even: normalize({ ODD: 1 - pEven, EVEN: pEven }),
      more_goals_half: normalize({ FIRST: first, SECOND: second, EQUAL: equal })
    }
  };
}

function buildMarketsPoints(lambdaHome, lambdaAway) {
  const probs = computeProbabilities(lambdaHome, lambdaAway);

  // 1X2
  const o = MARKET_CONFIG.OUTCOME_1X2;
  const outcomeMax = Math.max(...Object.values(probs.outcome_1x2));
  const outcome = {};
  for (const [k, p] of Object.entries(probs.outcome_1x2)) {
    outcome[k] = relativePoints(p, outcomeMax, o.base, o.cap);
  }

  // Exact score grid 0-7 x 0-7
  const e = MARKET_CONFIG.EXACT_SCORE;
  const exactMax = Math.max(...Object.values(probs.exact_score));
  const exactScore = {};
  for (let h = 0; h <= 7; h++) {
    for (let a = 0; a <= 7; a++) {
      const key = `${h}-${a}`;
      exactScore[key] = relativePoints(probs.exact_score[key], exactMax, e.base, e.cap);
    }
  }

  // Extras
  const extras = {};
  for (const [market, selections] of Object.entries(probs.extras)) {
    const base = EXTRA_BASE[market];
    const marketMax = Math.max(...Object.values(selections));
    extras[market] = {};
    for (const [sel, p] of Object.entries(selections)) {
      extras[market][sel] = relativePoints(p, marketMax, base, MARKET_CONFIG.EXTRA.cap);
    }
  }

  return { outcome_1x2: outcome, exact_score: exactScore, extras };
}

// Convert decimal odds to normalized implied probabilities after removing the
// bookmaker margin. Invalid/missing prices are ignored rather than trusted.
function oddsToProbabilities(odds) {
  const inverse = {};
  for (const [key, raw] of Object.entries(odds || {})) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 1) inverse[key] = 1 / value;
  }
  return normalize(inverse);
}

// A light-weight Poisson 1X2 calculator used to fit expected goals to bookmaker
// prices without calculating every secondary market for every search candidate.
function outcomeProbabilitiesForLambdas(lambdaHome, lambdaAway) {
  const maxGoals = 12;
  const home = poissonArray(lambdaHome, maxGoals);
  const away = poissonArray(lambdaAway, maxGoals);
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let mass = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = home[h] * away[a];
      mass += p;
      if (h > a) pHome += p;
      else if (h === a) pDraw += p;
      else pAway += p;
    }
  }
  return { HOME: pHome / mass, DRAW: pDraw / mass, AWAY: pAway / mass };
}

// Fit home/away expected goals to de-margined 1X2 probabilities. The result is
// an approximation; direct bookmaker prices still take priority for the 1X2
// payout market itself. Returns the supplied model lambdas if input is invalid.
function inferLambdasFrom1X2(outcomeOdds, fallbackHome, fallbackAway) {
  const hasAllOdds = outcomeOdds && ['HOME', 'DRAW', 'AWAY'].every((key) => {
    const value = Number(outcomeOdds[key]);
    return Number.isFinite(value) && value > 1;
  });
  if (!hasAllOdds) return { lambdaHome: fallbackHome, lambdaAway: fallbackAway };

  const target = oddsToProbabilities(outcomeOdds);
  if (!['HOME', 'DRAW', 'AWAY'].every((key) => Number.isFinite(target[key]))) {
    return { lambdaHome: fallbackHome, lambdaAway: fallbackAway };
  }

  const loss = (lh, la) => {
    const predicted = outcomeProbabilitiesForLambdas(lh, la);
    return ['HOME', 'DRAW', 'AWAY'].reduce((sum, key) => sum + (predicted[key] - target[key]) ** 2, 0);
  };

  let bestHome = Math.max(0.3, Math.min(3.8, Number(fallbackHome) || DEFAULT_AVG_HOME));
  let bestAway = Math.max(0.3, Math.min(3.8, Number(fallbackAway) || DEFAULT_AVG_AWAY));
  let bestLoss = Infinity;
  for (let lh = 0.3; lh <= 3.800001; lh += 0.1) {
    for (let la = 0.3; la <= 3.800001; la += 0.1) {
      const score = loss(lh, la);
      if (score < bestLoss) {
        bestLoss = score;
        bestHome = lh;
        bestAway = la;
      }
    }
  }

  const coarseHome = bestHome;
  const coarseAway = bestAway;
  for (let lh = Math.max(0.3, coarseHome - 0.12); lh <= Math.min(3.8, coarseHome + 0.12) + 1e-9; lh += 0.02) {
    for (let la = Math.max(0.3, coarseAway - 0.12); la <= Math.min(3.8, coarseAway + 0.12) + 1e-9; la += 0.02) {
      const score = loss(lh, la);
      if (score < bestLoss) {
        bestLoss = score;
        bestHome = lh;
        bestAway = la;
      }
    }
  }

  return {
    lambdaHome: Number(bestHome.toFixed(2)),
    lambdaAway: Number(bestAway.toFixed(2))
  };
}

function pointsFromOdds(odds, base, cap) {
  const probabilities = oddsToProbabilities(odds);
  const values = Object.values(probabilities);
  if (!values.length) return null;
  const maxProbability = Math.max(...values);
  const out = {};
  for (const [key, probability] of Object.entries(probabilities)) {
    out[key] = relativePoints(probability, maxProbability, base, cap);
  }
  return out;
}

/**
 * Build the app's standard market-points structure, using bookmaker odds for
 * markets actually available and the expected-goals model for everything
 * else. Odds are decimal odds; their implied probabilities are normalized to
 * remove the overround. Lambda values are supplied by the team's model so
 * missing markets can still be priced consistently.
 */
function buildMatchMarketsPointsFromOdds(bundle, lambdaHome = DEFAULT_AVG_HOME, lambdaAway = DEFAULT_AVG_AWAY) {
  const outcomeOdds = bundle && bundle.outcome_1x2;
  const validOutcomeOdds = outcomeOdds && ['HOME', 'DRAW', 'AWAY'].every((k) => Number.isFinite(Number(outcomeOdds[k])) && Number(outcomeOdds[k]) > 1);
  const inferred = validOutcomeOdds
    ? inferLambdasFrom1X2(outcomeOdds, lambdaHome, lambdaAway)
    : { lambdaHome, lambdaAway };
  const model = buildMarketsPoints(inferred.lambdaHome, inferred.lambdaAway);
  const result = {
    outcome_1x2: { ...model.outcome_1x2 },
    exact_score: { ...model.exact_score },
    extras: Object.fromEntries(Object.entries(model.extras).map(([k, v]) => [k, { ...v }]))
  };
  const oddsPricedMarkets = [];
  const modelPricedMarkets = [];

  if (validOutcomeOdds) {
    result.outcome_1x2 = pointsFromOdds(outcomeOdds, MARKET_CONFIG.OUTCOME_1X2.base, MARKET_CONFIG.OUTCOME_1X2.cap);
    oddsPricedMarkets.push('outcome_1x2');
  } else {
    modelPricedMarkets.push('outcome_1x2');
  }

  const exactOdds = {};
  for (const [key, value] of Object.entries((bundle && bundle.exact_score) || {})) {
    if (/^[0-7]-[0-7]$/.test(key) && Number(value) > 1) exactOdds[key] = Number(value);
  }
  // Bookmakers usually offer only a subset of exact scores. Price those
  // selections from the available odds, and retain model prices for outcomes
  // not quoted by the bookmaker rather than rejecting the entire market.
  const exactPoints = Object.keys(exactOdds).length >= 2
    ? pointsFromOdds(exactOdds, MARKET_CONFIG.EXACT_SCORE.base, MARKET_CONFIG.EXACT_SCORE.cap)
    : null;
  if (exactPoints) {
    Object.assign(result.exact_score, exactPoints);
    oddsPricedMarkets.push('exact_score');
    if (Object.keys(exactOdds).length < 64) modelPricedMarkets.push('exact_score_unquoted_selections');
  } else {
    modelPricedMarkets.push('exact_score');
  }

  const aliases = {
    over_under_1_5: 'ou_1_5', ou_1_5: 'ou_1_5',
    over_under_2_5: 'ou_2_5', ou_2_5: 'ou_2_5',
    over_under_3_5: 'ou_3_5', ou_3_5: 'ou_3_5',
    odd_even_goals: 'goals_odd_even', goals_odd_even: 'goals_odd_even',
    highest_scoring_half: 'more_goals_half', more_goals_half: 'more_goals_half'
  };
  const extrasInput = (bundle && bundle.extras) || {};
  const extrasSeen = new Set();
  for (const [inputKey, rawSelections] of Object.entries(extrasInput)) {
    const market = aliases[inputKey] || inputKey;
    if (!EXTRA_MARKETS[market] || !rawSelections || typeof rawSelections !== 'object') continue;
    const validSelections = {};
    for (const selection of EXTRA_MARKETS[market]) {
      const price = Number(rawSelections[selection]);
      if (Number.isFinite(price) && price > 1) validSelections[selection] = price;
    }
    // Only replace a whole market when all supported selections are present;
    // this avoids assigning misleading payouts from incomplete odds feeds.
    if (EXTRA_MARKETS[market].every((selection) => validSelections[selection])) {
      result.extras[market] = pointsFromOdds(validSelections, EXTRA_BASE[market], MARKET_CONFIG.EXTRA.cap);
      extrasSeen.add(market);
      oddsPricedMarkets.push(`extras.${market}`);
    }
  }
  for (const market of Object.keys(EXTRA_MARKETS)) {
    if (!extrasSeen.has(market)) modelPricedMarkets.push(`extras.${market}`);
  }

  result._meta = {
    model_priced: modelPricedMarkets.length > 0,
    expected_goals_source: validOutcomeOdds ? 'bookmaker_1x2_fit' : 'team_model',
    expected_goals: { home: inferred.lambdaHome, away: inferred.lambdaAway },
    odds_priced_markets: oddsPricedMarkets,
    model_priced_markets: modelPricedMarkets
  };
  return result;
}

// Backward-compatible name used by the Tunisia sync scripts.
const buildMatchMarketsPoints = buildMarketsPoints;

// ---------------------------------------------------------------------------
// 4. Settlement
// ---------------------------------------------------------------------------
/**
 * { home, away }   = result used for settlement (90 minutes)
 * { htHome, htAway } = half-time score (may be null)
 * Markets that depend on the half-time score return null when it is missing.
 */
function resolveMarkets({ home, away, htHome, htAway }) {
  const total = home + away;
  const hasHt = Number.isInteger(htHome) && Number.isInteger(htAway);
  const firstHalfGoals = hasHt ? htHome + htAway : null;
  const secondHalfGoals = hasHt ? total - firstHalfGoals : null;

  return {
    outcome_1x2: home > away ? 'HOME' : home === away ? 'DRAW' : 'AWAY',
    exact_score: `${home}-${away}`,
    extras: {
      btts: home > 0 && away > 0 ? 'YES' : 'NO',
      ou_1_5: total >= 2 ? 'OVER' : 'UNDER',
      ou_2_5: total >= 3 ? 'OVER' : 'UNDER',
      ou_3_5: total >= 4 ? 'OVER' : 'UNDER',
      ht_leader: hasHt ? (htHome > htAway ? 'HOME' : htHome === htAway ? 'DRAW' : 'AWAY') : null,
      goal_both_halves: hasHt ? (firstHalfGoals > 0 && secondHalfGoals > 0 ? 'YES' : 'NO') : null,
      clean_sheet:
        home === 0 && away === 0 ? 'BOTH' : away === 0 ? 'HOME' : home === 0 ? 'AWAY' : 'NONE',
      win_by_2plus: Math.abs(home - away) >= 2 ? 'YES' : 'NO',
      goals_odd_even: total % 2 === 0 ? 'EVEN' : 'ODD',
      more_goals_half: hasHt
        ? firstHalfGoals > secondHalfGoals
          ? 'FIRST'
          : firstHalfGoals === secondHalfGoals
          ? 'EQUAL'
          : 'SECOND'
        : null
    }
  };
}

module.exports = {
  MARKET_CONFIG,
  EXTRA_BASE,
  EXTRA_MARKETS,
  HT_DEPENDENT_MARKETS,
  teamRatings,
  matchLambdas,
  buildMarketsPoints,
  buildMatchMarketsPoints,
  buildMatchMarketsPointsFromOdds,
  inferLambdasFrom1X2,
  resolveMarkets,
  DEFAULT_AVG_HOME,
  DEFAULT_AVG_AWAY
};
