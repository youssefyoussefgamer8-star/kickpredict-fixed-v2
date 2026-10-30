'use strict';
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const { Pool } = require('pg');
const oddsProvider = require('./oddsProvider');

const {
  EXTRA_MARKETS,
  teamRatings,
  matchLambdas,
  buildMarketsPoints,
  resolveMarkets,
  DEFAULT_AVG_HOME,
  DEFAULT_AVG_AWAY
} = require('./pricingEngine');

// ---------------------------------------------------------------------------
// 1. Startup validation (fail fast)
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'KICK_CLIENT_ID',
  'KICK_CLIENT_SECRET',
  'KICK_REDIRECT_URI',
  'FOOTBALL_DATA_API_KEY',
  'FRONTEND_URL',
  'MAX_BOOSTS_PER_MATCHDAY'
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key] || process.env[key].trim() === '') {
    console.error(`[FATAL] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET must be at least 32 characters. Generate one with:');
  console.error(`  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
  process.exit(1);
}

const MAX_BOOSTS = Number(process.env.MAX_BOOSTS_PER_MATCHDAY);
if (!Number.isInteger(MAX_BOOSTS) || MAX_BOOSTS < 0) {
  console.error('[FATAL] MAX_BOOSTS_PER_MATCHDAY must be a non-negative integer.');
  process.exit(1);
}

// Competitions available on the football-data.org FREE tier
const COMPETITION_NAMES = {
  PL: 'Premier League',
  PD: 'La Liga',
  BL1: 'Bundesliga',
  SA: 'Serie A',
  FL1: 'Ligue 1',
  CL: 'Champions League',
  TU1: 'Tunisian Ligue Professionnelle 1',
  DEMO: 'Demo League'
};
const FOOTBALL_DATA_COMPETITIONS = new Set(['PL', 'PD', 'BL1', 'SA', 'FL1', 'CL']);

const COMPETITIONS = [...new Set(
  (process.env.COMPETITION_CODES || 'PL,PD,BL1,SA,FL1,CL')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
)];

for (const code of COMPETITIONS) {
  if (!COMPETITION_NAMES[code]) {
    console.error(`[FATAL] Unsupported competition code in COMPETITION_CODES: ${code}`);
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT || 4000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('[FATAL] PORT must be an integer between 1 and 65535.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX || 10) });
const app = express();
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

app.set('trust proxy', 1);

function toOrigin(value) {
  try { return new URL(value).origin; } catch { return null; }
}

const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()),
    ...(isProduction ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'])
  ].map(toOrigin).filter(Boolean)
);

app.use(cors({
  origin(origin, callback) {
    // Requests without an Origin header (health checks and command-line tools) are allowed.
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

function authCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/'
  };
}
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions, slow down.' }
});

app.use('/api', globalLimiter);

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/health', asyncHandler(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
}));

// ---------------------------------------------------------------------------
// 2. Auth helpers
// ---------------------------------------------------------------------------
function authenticate(req, res, next) {
  const token = req.cookies.kp_session;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (_err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function optionalAuth(req, _res, next) {
  const token = req.cookies.kp_session;
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      /* ignore */
    }
  }
  next();
}

// ---------------------------------------------------------------------------
// 3. Kick OAuth 2.1 (PKCE)
// ---------------------------------------------------------------------------
app.get('/api/auth/kick', (_req, res) => {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  const oauthCookie = jwt.sign({ codeVerifier, state }, process.env.JWT_SECRET, { expiresIn: '10m' });
  res.cookie('kp_oauth_state', oauthCookie, {
    ...authCookieOptions(),
    maxAge: 10 * 60 * 1000
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.KICK_CLIENT_ID,
    redirect_uri: process.env.KICK_REDIRECT_URI,
    scope: 'user:read',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state
  });

  res.redirect(`https://id.kick.com/oauth/authorize?${params.toString()}`);
});

app.get('/api/auth/kick/callback', async (req, res) => {
  const { code, state } = req.query;
  const oauthCookie = req.cookies.kp_oauth_state;
  res.clearCookie('kp_oauth_state', authCookieOptions());

  if (!code || !state || !oauthCookie) {
    return res.redirect(`${process.env.FRONTEND_URL}?error=oauth_invalid`);
  }

  let savedState;
  try {
    savedState = jwt.verify(oauthCookie, process.env.JWT_SECRET);
  } catch (_err) {
    return res.redirect(`${process.env.FRONTEND_URL}?error=oauth_expired`);
  }

  if (savedState.state !== state) {
    return res.redirect(`${process.env.FRONTEND_URL}?error=state_mismatch`);
  }

  try {
    const tokenRes = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
        redirect_uri: process.env.KICK_REDIRECT_URI,
        code_verifier: savedState.codeVerifier,
        code: String(code)
      })
    });
    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenData = await tokenRes.json();

    const userRes = await fetch('https://api.kick.com/public/v1/users', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!userRes.ok) throw new Error('User fetch failed');
    const userPayload = await userRes.json();
    const kickUser = Array.isArray(userPayload.data) ? userPayload.data[0] : userPayload.data || userPayload;

    const kickId = String(kickUser.user_id || kickUser.id);
    const username = kickUser.name || kickUser.username || `kick_${kickId}`;
    const avatarUrl = kickUser.profile_picture || kickUser.avatar_url || null;

    const { rows } = await pool.query(
      `INSERT INTO users (kick_id, username, avatar_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (kick_id) DO UPDATE
       SET username = EXCLUDED.username, avatar_url = EXCLUDED.avatar_url
       RETURNING id, kick_id, username, avatar_url, total_points, exact_scores_count`,
      [kickId, username, avatarUrl]
    );

    const user = rows[0];
    const sessionToken = jwt.sign(
      { id: user.id, kickId: user.kick_id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('kp_session', sessionToken, {
      ...authCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.redirect(process.env.FRONTEND_URL);
  } catch (err) {
    console.error('[OAuth Error]', err);
    res.redirect(`${process.env.FRONTEND_URL}?error=auth_failed`);
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('kp_session', authCookieOptions());
  res.json({ ok: true });
});

app.get(
  '/api/auth/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, kick_id, username, avatar_url, total_points, exact_scores_count FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  })
);

// ---------------------------------------------------------------------------
// 3b. Live Match Clock & Real-Time Score Helper (ESPN Public Scoreboard API)
// ---------------------------------------------------------------------------
const ESPN_LEAGUE_SLUGS = {
  PL: 'eng.1',
  PD: 'esp.1',
  BL1: 'ger.1',
  SA: 'ita.1',
  FL1: 'fra.1',
  CL: 'uefa.champions',
  TU1: 'tun.1'
};

const espnLiveCache = new Map();
const ESPN_CACHE_TTL_MS = 20 * 1000; // 20 seconds cache

function normalizeTeamTokens(name) {
  if (!name) return [];
  const clean = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');
  const stopWords = new Set([
    'fc', 'cf', 'sc', 'ac', 'rc', 'as', 'ud', 'cd', 'sd', 'ca', 'ss', 'ssc',
    'real', 'club', 'deportivo', 'athletic', 'atletico', 'stade', 'olympique',
    'borussia', 'bayer', 'rb', 'vfl', 'vfb', 'tsg', 'fsv', '1', 'de', 'la', 'le', 'los', 'el', 'al'
  ]);
  const tokens = clean.split(/\s+/).filter((w) => w.length >= 2 && !stopWords.has(w));
  return tokens.length > 0 ? tokens : clean.split(/\s+/).filter(Boolean);
}

function teamsSimilarity(dbName, espnCompetitor) {
  if (!dbName || !espnCompetitor || !espnCompetitor.team) return 0;
  const t = espnCompetitor.team;
  const candidates = [t.displayName, t.shortDisplayName, t.name, t.abbreviation, t.location].filter(Boolean);
  const dbLower = String(dbName).toLowerCase().trim();
  for (const c of candidates) {
    if (String(c).toLowerCase().trim() === dbLower) return 10;
  }
  const dbTokens = normalizeTeamTokens(dbName);
  let best = 0;
  for (const c of candidates) {
    const cTokens = normalizeTeamTokens(c);
    for (const dt of dbTokens) {
      for (const ct of cTokens) {
        if (dt === ct) best = Math.max(best, 6);
        else if (dt.length >= 3 && ct.length >= 3 && (dt.startsWith(ct) || ct.startsWith(dt))) {
          best = Math.max(best, 4);
        }
      }
    }
  }
  return best;
}

function formatEspnClock(statusObj) {
  if (!statusObj) return null;
  const typeName = statusObj.type?.name || '';
  const shortDetail = statusObj.type?.shortDetail || '';
  if (typeName === 'STATUS_HALFTIME' || shortDetail === 'HT') {
    return 'HT';
  }
  const rawClock = String(statusObj.displayClock || shortDetail || '').trim();
  if (!rawClock || rawClock === "0'" || rawClock === '0:00') return null;
  // Normalize e.g. "45'+3'" -> "45+3'"
  return rawClock.replace(/'\+/g, '+');
}

function computeFallbackLiveClock(utcDate, status) {
  if (status === 'PAUSED') return 'HT';
  if (status !== 'IN_PLAY') return null;
  const elapsed = Math.floor((Date.now() - new Date(utcDate).getTime()) / 60000);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 150) return null;
  if (elapsed <= 45) return `${Math.max(1, elapsed)}'`;
  if (elapsed <= 53) return `45+${elapsed - 45}'`;
  if (elapsed <= 62) return 'HT';
  const secondHalfMin = elapsed - 17;
  if (secondHalfMin <= 90) return `${Math.max(46, secondHalfMin)}'`;
  if (secondHalfMin <= 105) return `90+${secondHalfMin - 90}'`;
  return "90+'";
}

async function fetchEspnScoreboard(competition) {
  const slug = ESPN_LEAGUE_SLUGS[competition];
  if (!slug) return [];
  const cached = espnLiveCache.get(competition);
  if (cached && Date.now() - cached.ts < ESPN_CACHE_TTL_MS) {
    return cached.events;
  }
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return cached ? cached.events : [];
    const data = await res.json();
    const events = Array.isArray(data.events) ? data.events : [];
    espnLiveCache.set(competition, { ts: Date.now(), events });
    return events;
  } catch (_err) {
    return cached ? cached.events : [];
  }
}

function enrichMatchWithLiveClock(m, espnEvents) {
  if (m.status === 'FINISHED') {
    return { ...m, live_clock: 'FT' };
  }
  let liveClock = null;
  let liveStatus = m.status;
  let liveHomeScore = m.home_score;
  let liveAwayScore = m.away_score;

  if (Array.isArray(espnEvents) && espnEvents.length > 0 && m.utc_date) {
    const mTime = new Date(m.utc_date).getTime();
    let bestEvent = null;
    let bestScore = 0;

    for (const ev of espnEvents) {
      const evTime = new Date(ev.date).getTime();
      if (Math.abs(evTime - mTime) > 45 * 60 * 1000) continue;
      const comp = ev.competitions && ev.competitions[0];
      const competitors = (comp && comp.competitors) || [];
      const homeComp = competitors.find((c) => c.homeAway === 'home') || competitors[0];
      const awayComp = competitors.find((c) => c.homeAway === 'away') || competitors[1];
      const sim = teamsSimilarity(m.home_team, homeComp) + teamsSimilarity(m.away_team, awayComp);
      if (sim > bestScore) {
        bestScore = sim;
        bestEvent = { ev, homeComp, awayComp };
      }
    }

    if (bestEvent && bestScore >= 4) {
      const { ev, homeComp, awayComp } = bestEvent;
      const state = ev.status?.type?.state;
      const typeName = ev.status?.type?.name || '';
      if (state === 'in') {
        liveClock = formatEspnClock(ev.status);
        liveStatus = typeName === 'STATUS_HALFTIME' ? 'PAUSED' : 'IN_PLAY';
        const hScore = parseInt(homeComp?.score, 10);
        const aScore = parseInt(awayComp?.score, 10);
        if (!Number.isNaN(hScore) && !Number.isNaN(aScore)) {
          liveHomeScore = hScore;
          liveAwayScore = aScore;
        }
      } else if (state === 'post' && !m.settled_outcomes) {
        const hScore = parseInt(homeComp?.score, 10);
        const aScore = parseInt(awayComp?.score, 10);
        if (!Number.isNaN(hScore) && !Number.isNaN(aScore)) {
          liveHomeScore = hScore;
          liveAwayScore = aScore;
        }
      }
    }
  }

  if (!liveClock) {
    liveClock = computeFallbackLiveClock(m.utc_date, liveStatus);
  }

  return {
    ...m,
    status: liveStatus,
    home_score: liveHomeScore,
    away_score: liveAwayScore,
    live_clock: liveClock
  };
}

// ---------------------------------------------------------------------------
// 4. Competitions + matches
// ---------------------------------------------------------------------------
app.get('/api/competitions', (_req, res) => {
  res.json({ competitions: COMPETITIONS.map((code) => ({ code, name: COMPETITION_NAMES[code] })) });
});

app.get(
  '/api/matches',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const competition = String(req.query.competition || COMPETITIONS[0]).toUpperCase();
    if (!COMPETITIONS.includes(competition)) {
      return res.status(400).json({ error: 'Unknown competition.' });
    }

    const roundsRes = await pool.query(
      `SELECT round_key,
              MIN(utc_date) AS first_date,
              MAX(utc_date) AS last_date,
              MIN(utc_date) FILTER (WHERE status IN ('TIMED', 'SCHEDULED') AND utc_date >= NOW() - INTERVAL '3 hours') AS next_upcoming_date,
              COUNT(*) FILTER (WHERE status IN ('TIMED', 'SCHEDULED') AND utc_date >= NOW() - INTERVAL '3 hours') AS upcoming_count,
              MAX(round_label) AS label
       FROM matches
       WHERE competition_code = $1 AND round_key IS NOT NULL
       GROUP BY round_key
       ORDER BY MIN(utc_date) ASC`,
      [competition]
    );
    const rounds = roundsRes.rows.map((r) => ({ key: r.round_key, label: r.label }));

    if (rounds.length === 0) {
      return res.json({ competition, rounds: [], round: null, maxBoosts: MAX_BOOSTS, boostsUsed: 0, matches: [] });
    }

    let roundKey =
      req.query.round && rounds.some((r) => r.key === req.query.round) ? String(req.query.round) : null;

    if (!roundKey) {
      const upcomingRounds = roundsRes.rows
        .filter((r) => Number(r.upcoming_count) > 0 && r.next_upcoming_date)
        .sort((a, b) => new Date(a.next_upcoming_date) - new Date(b.next_upcoming_date));
      const current = upcomingRounds.find((r) => Number(r.upcoming_count) >= 2) || upcomingRounds[0];
      roundKey = (current || roundsRes.rows[roundsRes.rows.length - 1]).round_key;
    }

    const { rows: matches } = await pool.query(
      `SELECT id, external_id, competition_code, round_key, round_label,
              home_team, home_crest, away_team, away_crest,
              utc_date, status, home_score, away_score, home_ht, away_ht,
              home_lambda, away_lambda, markets_points, settled_outcomes,
              (NOW() >= utc_date OR status NOT IN ('TIMED', 'SCHEDULED')) AS is_locked
       FROM matches
       WHERE competition_code = $1 AND round_key = $2
       ORDER BY utc_date ASC, id ASC`,
      [competition, roundKey]
    );

    const userPredictions = {};
    let boostsUsed = 0;

    if (req.user && matches.length > 0) {
      const predRes = await pool.query(
        `SELECT match_id, predicted_outcome, predicted_home, predicted_away, is_boosted,
                outcome_points_locked, exact_points_locked, extras_picks, points_awarded
         FROM predictions
         WHERE user_id = $1 AND match_id = ANY($2::bigint[])`,
        [req.user.id, matches.map((m) => m.id)]
      );
      for (const p of predRes.rows) userPredictions[p.match_id] = p;

      const boostRes = await pool.query(
        `SELECT boosts_used FROM user_round_boosts
         WHERE user_id = $1 AND competition_code = $2 AND round_key = $3`,
        [req.user.id, competition, roundKey]
      );
      boostsUsed = boostRes.rows[0]?.boosts_used || 0;
    }

    const hasActiveMatches = matches.some(
      (m) => m.status !== 'FINISHED' && (m.is_locked || ['IN_PLAY', 'PAUSED'].includes(m.status))
    );
    const espnEvents = hasActiveMatches ? await fetchEspnScoreboard(competition) : [];

    res.json({
      competition,
      rounds,
      round: roundKey,
      maxBoosts: MAX_BOOSTS,
      boostsUsed,
      matches: matches.map((rawMatch) => {
        const m = enrichMatchWithLiveClock(rawMatch, espnEvents);
        return {
          ...m,
          markets_points:
            m.markets_points ||
            buildMarketsPoints(
              Number(m.home_lambda || DEFAULT_AVG_HOME),
              Number(m.away_lambda || DEFAULT_AVG_AWAY)
            ),
          prediction: userPredictions[m.id] || null
        };
      })
    });
  })
);

// ---------------------------------------------------------------------------
// 5. Submit a prediction (points are LOCKED at submission time)
// ---------------------------------------------------------------------------
app.post(
  '/api/predictions',
  authenticate,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const { matchId, predictedOutcome, predictedHome, predictedAway, isBoosted, extras } = req.body || {};
    const wantBoost = Boolean(isBoosted);

    if (!/^\d+$/.test(String(matchId || ''))) {
      return res.status(400).json({ error: 'Invalid match.' });
    }

    // Independent "Who wins" pick
    const outcome = predictedOutcome ? String(predictedOutcome).toUpperCase() : null;
    if (outcome && !['HOME', 'DRAW', 'AWAY'].includes(outcome)) {
      return res.status(400).json({ error: 'Invalid "Who wins" pick.' });
    }

    // Exact score pick (optional, but both numbers or none)
    const isEmpty = (v) => v === null || v === undefined || v === '';
    const hasHome = !isEmpty(predictedHome);
    const hasAway = !isEmpty(predictedAway);
    if (hasHome !== hasAway) {
      return res.status(400).json({ error: 'Enter both scores, or leave both empty.' });
    }

    let h = null;
    let a = null;
    if (hasHome) {
      h = Number(predictedHome);
      a = Number(predictedAway);
      if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || h > 7 || a < 0 || a > 7) {
        return res.status(400).json({ error: 'Scores must be whole numbers from 0 to 7.' });
      }
    }

    // Extras (max 3, unique market, valid selection)
    const rawExtras = Array.isArray(extras) ? extras : [];
    if (rawExtras.length > 3) {
      return res.status(400).json({ error: 'You can pick at most 3 extras per match.' });
    }
    const seen = new Set();
    for (const item of rawExtras) {
      if (!item || typeof item.market !== 'string' || typeof item.selection !== 'string') {
        return res.status(400).json({ error: 'Invalid extra pick.' });
      }
      if (!EXTRA_MARKETS[item.market] || !EXTRA_MARKETS[item.market].includes(item.selection)) {
        return res.status(400).json({ error: `Invalid extra: ${item.market}.` });
      }
      if (seen.has(item.market)) {
        return res.status(400).json({ error: `Duplicate extra: ${item.market}.` });
      }
      seen.add(item.market);
    }

    if (!outcome && h === null && rawExtras.length === 0) {
      return res.status(400).json({ error: 'Pick who wins, a score, or at least one extra.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const matchRes = await client.query(
        `SELECT id, competition_code, round_key, home_lambda, away_lambda, markets_points,
                (NOW() >= utc_date OR status NOT IN ('TIMED', 'SCHEDULED')) AS locked
         FROM matches WHERE id = $1 FOR SHARE`,
        [matchId]
      );

      if (!matchRes.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Match not found.' });
      }

      const match = matchRes.rows[0];
      if (match.locked) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Predictions are locked after kickoff.' });
      }
      if (!match.round_key) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Match data is still syncing. Try again in a few minutes.' });
      }

      const markets =
        match.markets_points ||
        buildMarketsPoints(
          Number(match.home_lambda || DEFAULT_AVG_HOME),
          Number(match.away_lambda || DEFAULT_AVG_AWAY)
        );

      // Lock the points as they are right now
      const outcomePointsLocked = outcome ? markets.outcome_1x2[outcome] : 0;
      const exactPointsLocked = h !== null ? markets.exact_score[`${h}-${a}`] : 0;
      const lockedExtras = rawExtras.map((pick) => ({
        market: pick.market,
        selection: pick.selection,
        points_locked: markets.extras[pick.market][pick.selection]
      }));

      // Atomic x2 boost reservation per user / competition / round
      await client.query(
        `INSERT INTO user_round_boosts (user_id, competition_code, round_key, boosts_used)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (user_id, competition_code, round_key) DO NOTHING`,
        [req.user.id, match.competition_code, match.round_key]
      );

      const boostRow = await client.query(
        `SELECT boosts_used FROM user_round_boosts
         WHERE user_id = $1 AND competition_code = $2 AND round_key = $3
         FOR UPDATE`,
        [req.user.id, match.competition_code, match.round_key]
      );

      const existing = await client.query(
        `SELECT is_boosted FROM predictions WHERE user_id = $1 AND match_id = $2 FOR UPDATE`,
        [req.user.id, match.id]
      );

      const wasBoosted = existing.rows[0]?.is_boosted || false;
      let boostsUsed = boostRow.rows[0].boosts_used;

      if (!wasBoosted && wantBoost) {
        if (boostsUsed >= MAX_BOOSTS) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `You already used your ${MAX_BOOSTS} x2 boost(s) in this round.` });
        }
        boostsUsed += 1;
      } else if (wasBoosted && !wantBoost) {
        boostsUsed = Math.max(0, boostsUsed - 1);
      }

      await client.query(
        `UPDATE user_round_boosts SET boosts_used = $1
         WHERE user_id = $2 AND competition_code = $3 AND round_key = $4`,
        [boostsUsed, req.user.id, match.competition_code, match.round_key]
      );

      const upsert = await client.query(
        `INSERT INTO predictions (
           user_id, match_id, predicted_outcome, predicted_home, predicted_away, is_boosted,
           outcome_points_locked, exact_points_locked, extras_picks, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
         ON CONFLICT (user_id, match_id) DO UPDATE
         SET predicted_outcome = EXCLUDED.predicted_outcome,
             predicted_home = EXCLUDED.predicted_home,
             predicted_away = EXCLUDED.predicted_away,
             is_boosted = EXCLUDED.is_boosted,
             outcome_points_locked = EXCLUDED.outcome_points_locked,
             exact_points_locked = EXCLUDED.exact_points_locked,
             extras_picks = EXCLUDED.extras_picks,
             updated_at = NOW()
         RETURNING match_id, predicted_outcome, predicted_home, predicted_away, is_boosted,
                   outcome_points_locked, exact_points_locked, extras_picks, points_awarded`,
        [
          req.user.id,
          match.id,
          outcome,
          h,
          a,
          wantBoost,
          outcomePointsLocked,
          exactPointsLocked,
          JSON.stringify(lockedExtras)
        ]
      );

      await client.query('COMMIT');
      res.json({ prediction: upsert.rows[0], boostsUsed });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

// ---------------------------------------------------------------------------
// 6. Leaderboard (rank computed BEFORE the search filter)
// ---------------------------------------------------------------------------
app.get(
  '/api/leaderboard',
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || '').trim();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const { rows } = await pool.query(
      `WITH ranked_users AS (
         SELECT id, username, avatar_url, total_points, exact_scores_count,
                RANK() OVER (ORDER BY total_points DESC, exact_scores_count DESC, created_at ASC) AS global_rank
         FROM users
       )
       SELECT id, username, avatar_url, total_points, exact_scores_count, global_rank::int AS rank
       FROM ranked_users
       WHERE ($1 = '' OR username ILIKE '%' || $1 || '%')
       ORDER BY global_rank ASC, id ASC
       LIMIT $2 OFFSET $3`,
      [search, limit, offset]
    );

    res.json({ leaderboard: rows });
  })
);

// ---------------------------------------------------------------------------
// 7. football-data.org sync (FREE tier, max 10 requests/minute)
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SYNC_GAP_MS = 7000; // 6 competitions x 1 call, 7s apart => well under 10 req/min

const STAGE_LABELS = {
  PLAYOFFS: 'Play-offs',
  LAST_32: 'Round of 32',
  LAST_16: 'Round of 16',
  QUARTER_FINALS: 'Quarter-finals',
  SEMI_FINALS: 'Semi-finals',
  THIRD_PLACE: 'Third place',
  FINAL: 'Final'
};
const LEAGUE_STAGES = ['REGULAR_SEASON', 'LEAGUE_STAGE'];

function roundInfo(m) {
  const stage = m.stage || 'REGULAR_SEASON';
  const md = Number.isInteger(m.matchday) ? m.matchday : null;
  if (LEAGUE_STAGES.includes(stage) && md) {
    return { stage, matchday: md, key: `MD:${md}`, label: `Matchday ${md}` };
  }
  const pretty =
    STAGE_LABELS[stage] ||
    stage
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  return { stage, matchday: md, key: stage, label: pretty };
}

const scoreOf = (s) => ({
  home: s ? s.home ?? s.homeTeam ?? null : null,
  away: s ? s.away ?? s.awayTeam ?? null : null
});

/**
 * Score used for settlement: the 90-minute result.
 * football-data's fullTime includes extra time / penalties for knockout matches,
 * so when the match went beyond 90 minutes we use score.regularTime instead.
 */
function settlementScore(score) {
  const full = scoreOf(score && score.fullTime);
  const regular = scoreOf(score && score.regularTime);
  const beyond90 = score && score.duration && score.duration !== 'REGULAR';
  if (beyond90 && regular.home !== null && regular.away !== null) return regular;
  return full;
}

async function syncCompetition(code) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches`, {
    headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY },
    signal: AbortSignal.timeout(20000)
  });

  if (res.status === 429) {
    console.warn(`[Sync] ${code}: rate limited by football-data.org, will retry next run.`);
    return false;
  }
  if (!res.ok) {
    console.error(`[Sync] ${code}: football-data.org returned HTTP ${res.status}`);
    return true;
  }

  const data = await res.json();
  const all = Array.isArray(data.matches) ? data.matches : [];

  // Matches with both teams known
  const valid = all.filter((m) => m.homeTeam && m.homeTeam.id && m.awayTeam && m.awayTeam.id && m.id);

  // Expected goals model from finished matches of this competition
  const finishedForModel = [];
  for (const m of valid) {
    if (m.status !== 'FINISHED') continue;
    const s = settlementScore(m.score);
    if (s.home === null || s.away === null) continue;
    finishedForModel.push({
      homeId: m.homeTeam.id,
      awayId: m.awayTeam.id,
      homeGoals: s.home,
      awayGoals: s.away
    });
  }
  const model = teamRatings(finishedForModel);

  const rows = valid.map((m) => {
    const info = roundInfo(m);
    const result = settlementScore(m.score);
    const ht = scoreOf(m.score && m.score.halfTime);
    const { lambdaHome, lambdaAway } = matchLambdas(m.homeTeam.id, m.awayTeam.id, model);

    return {
      external_id: m.id,
      competition_code: code,
      matchday: info.matchday,
      stage: info.stage,
      round_key: info.key,
      round_label: info.label,
      home_team: m.homeTeam.shortName || m.homeTeam.name || 'TBD',
      home_crest: m.homeTeam.crest || null,
      away_team: m.awayTeam.shortName || m.awayTeam.name || 'TBD',
      away_crest: m.awayTeam.crest || null,
      utc_date: m.utcDate,
      status: m.status,
      home_score: result.home,
      away_score: result.away,
      home_ht: ht.home,
      away_ht: ht.away,
      home_lambda: lambdaHome,
      away_lambda: lambdaAway,
      markets_points: buildMarketsPoints(lambdaHome, lambdaAway)
    };
  });

  if (rows.length === 0) return true;

  await pool.query(
    `INSERT INTO matches (
       external_id, competition_code, matchday, stage, round_key, round_label,
       home_team, home_crest, away_team, away_crest, utc_date, status,
       home_score, away_score, home_ht, away_ht, home_lambda, away_lambda, markets_points, updated_at
     )
     SELECT x.external_id, x.competition_code, x.matchday, x.stage, x.round_key, x.round_label,
            x.home_team, x.home_crest, x.away_team, x.away_crest, x.utc_date, x.status,
            x.home_score, x.away_score, x.home_ht, x.away_ht, x.home_lambda, x.away_lambda, x.markets_points, NOW()
     FROM jsonb_to_recordset($1::jsonb) AS x(
       external_id bigint, competition_code text, matchday int, stage text, round_key text, round_label text,
       home_team text, home_crest text, away_team text, away_crest text, utc_date timestamptz, status text,
       home_score int, away_score int, home_ht int, away_ht int,
       home_lambda numeric, away_lambda numeric, markets_points jsonb
     )
     ON CONFLICT (external_id) DO UPDATE SET
       competition_code = EXCLUDED.competition_code,
       matchday = EXCLUDED.matchday,
       stage = EXCLUDED.stage,
       round_key = EXCLUDED.round_key,
       round_label = EXCLUDED.round_label,
       home_team = EXCLUDED.home_team,
       home_crest = EXCLUDED.home_crest,
       away_team = EXCLUDED.away_team,
       away_crest = EXCLUDED.away_crest,
       utc_date = EXCLUDED.utc_date,
       status = CASE WHEN matches.points_calculated THEN matches.status ELSE EXCLUDED.status END,
       home_score = CASE WHEN matches.points_calculated THEN matches.home_score ELSE EXCLUDED.home_score END,
       away_score = CASE WHEN matches.points_calculated THEN matches.away_score ELSE EXCLUDED.away_score END,
       home_ht = CASE WHEN matches.points_calculated THEN matches.home_ht ELSE EXCLUDED.home_ht END,
       away_ht = CASE WHEN matches.points_calculated THEN matches.away_ht ELSE EXCLUDED.away_ht END,
       -- Freeze all settlement-related values after points have been awarded.
       home_lambda = CASE
         WHEN matches.points_calculated THEN matches.home_lambda
         WHEN EXCLUDED.status IN ('TIMED', 'SCHEDULED') THEN EXCLUDED.home_lambda
         ELSE COALESCE(matches.home_lambda, EXCLUDED.home_lambda)
       END,
       away_lambda = CASE
         WHEN matches.points_calculated THEN matches.away_lambda
         WHEN EXCLUDED.status IN ('TIMED', 'SCHEDULED') THEN EXCLUDED.away_lambda
         ELSE COALESCE(matches.away_lambda, EXCLUDED.away_lambda)
       END,
       markets_points = CASE
         WHEN matches.points_calculated THEN matches.markets_points
         WHEN EXCLUDED.status IN ('TIMED', 'SCHEDULED') AND matches.odds_source = 'bookmaker'
           THEN COALESCE(matches.markets_points, EXCLUDED.markets_points)
         WHEN EXCLUDED.status IN ('TIMED', 'SCHEDULED')
           THEN EXCLUDED.markets_points
         ELSE COALESCE(matches.markets_points, EXCLUDED.markets_points)
       END,
       updated_at = NOW()`,
    [JSON.stringify(rows)]
  );

  console.log(`[Sync] ${code}: ${rows.length} matches (${finishedForModel.length} finished used for ratings)`);
  return true;
}

// ---------------------------------------------------------------------------
// 8. Settlement: idempotent, one transaction per match
// ---------------------------------------------------------------------------
async function settleFinishedMatches() {
  const { rows: finished } = await pool.query(
    `SELECT id, home_score, away_score, home_ht, away_ht, utc_date
     FROM matches
     WHERE status = 'FINISHED'
       AND points_calculated = FALSE
       AND home_score IS NOT NULL
       AND away_score IS NOT NULL`
  );

  for (const m of finished) {
    const initiallyHasHt = m.home_ht !== null && m.away_ht !== null;
    const initiallyHoursSinceKickoff = (Date.now() - new Date(m.utc_date).getTime()) / 3600000;

    // Avoid locking rows that are expected to receive their half-time score shortly.
    if (!initiallyHasHt && initiallyHoursSinceKickoff < 24) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Read the scores again while locking the match, so a concurrent data sync
      // cannot cause us to settle against a stale snapshot.
      const locked = await client.query(
        `SELECT id, home_score, away_score, home_ht, away_ht, utc_date
         FROM matches
         WHERE id = $1 AND status = 'FINISHED' AND points_calculated = FALSE
         FOR UPDATE SKIP LOCKED`,
        [m.id]
      );
      if (locked.rowCount === 0) {
        await client.query('ROLLBACK');
        continue;
      }
      const lockedMatch = locked.rows[0];
      if (lockedMatch.home_score === null || lockedMatch.away_score === null) {
        await client.query('ROLLBACK');
        continue;
      }
      const hasHt = lockedMatch.home_ht !== null && lockedMatch.away_ht !== null;
      const hoursSinceKickoff = (Date.now() - new Date(lockedMatch.utc_date).getTime()) / 3600000;
      if (!hasHt && hoursSinceKickoff < 24) {
        await client.query('ROLLBACK');
        continue;
      }
      const outcomes = resolveMarkets({
        home: lockedMatch.home_score,
        away: lockedMatch.away_score,
        htHome: lockedMatch.home_ht,
        htAway: lockedMatch.away_ht
      });

      const { rows: preds } = await client.query(
        `SELECT id, user_id, predicted_outcome, predicted_home, predicted_away, is_boosted,
                outcome_points_locked, exact_points_locked, extras_picks
         FROM predictions
         WHERE match_id = $1 AND points_awarded IS NULL
         FOR UPDATE`,
        [m.id]
      );

      for (const pred of preds) {
        let base = 0;

        // "Who wins" pick
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
          const actual = outcomes.extras[pick.market];
          if (actual === null || actual === undefined) {
            // Only possible for half-time markets when the API never provided the half-time score
            return { ...pick, status: 'VOID', won: null, points_earned: 0 };
          }
          const won = actual === pick.selection;
          const earned = won ? Number(pick.points_locked || 0) : 0;
          base += earned;
          return { ...pick, status: won ? 'WON' : 'LOST', won, points_earned: earned };
        });

        const finalPoints = base * (pred.is_boosted ? 2 : 1);

        await client.query(
          `UPDATE predictions
           SET points_awarded = $1, extras_picks = $2::jsonb, updated_at = NOW()
           WHERE id = $3`,
          [finalPoints, JSON.stringify(settledExtras), pred.id]
        );

        await client.query(
          `UPDATE users
           SET total_points = total_points + $1,
               exact_scores_count = exact_scores_count + $2
           WHERE id = $3`,
          [finalPoints, isExact ? 1 : 0, pred.user_id]
        );
      }

      await client.query(
        `UPDATE matches
         SET points_calculated = TRUE, settled_outcomes = $1::jsonb, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(outcomes), lockedMatch.id]
      );

      await client.query('COMMIT');
      console.log(`[Settle] Match ${lockedMatch.id} settled (${preds.length} predictions)`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[Settle] Failed for match ${m.id}:`, err.message);
    } finally {
      client.release();
    }
  }
}

let syncing = false;
async function syncAll() {
  if (syncing) return;
  syncing = true;
  try {
    const syncCodes = COMPETITIONS.filter((code) => FOOTBALL_DATA_COMPETITIONS.has(code));
    for (let i = 0; i < syncCodes.length; i++) {
      if (i > 0) await sleep(SYNC_GAP_MS);
      try {
        const ok = await syncCompetition(syncCodes[i]);
        if (!ok) break; // rate limited: stop this run
      } catch (err) {
        console.error(`[Sync] ${syncCodes[i]} failed:`, err.message);
      }
    }
    await settleFinishedMatches();
  } catch (err) {
    console.error('[Sync] Unexpected error:', err);
  } finally {
    syncing = false;
  }
}

// ---------------------------------------------------------------------------
// 9. Error handler + start
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[API Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Match/result sync: every 10 minutes by default. The per-competition delay respects the
// football-data.org free-tier rate limit.
const SYNC_CRON = process.env.SYNC_CRON || '*/2 * * * *';
if (!cron.validate(SYNC_CRON)) {
  console.error(`[FATAL] Invalid SYNC_CRON expression: ${SYNC_CRON}`);
} else {
  cron.schedule(SYNC_CRON, syncAll);
  console.log(`[Sync] Scheduled with cron: ${SYNC_CRON}`);
}

// Odds have their own conservative schedule so they don't consume quota every
// time match data is refreshed. They are optional and disabled without a key.
const ODDS_CRON = process.env.ODDS_CRON || oddsProvider.DEFAULT_CRON;
if (oddsProvider.isEnabled()) {
  if (!cron.validate(ODDS_CRON)) {
    console.error(`[Odds] Invalid ODDS_CRON expression: ${ODDS_CRON}`);
  } else {
    cron.schedule(ODDS_CRON, async () => {
      try {
        const oddsCompetitions = COMPETITIONS.filter((code) => oddsProvider.ODDS_API_SPORTS[code]);
        const result = await oddsProvider.refreshUpcomingOdds(pool, oddsCompetitions);
        console.log('[Odds] Refresh complete:', result);
      } catch (err) {
        console.error('[Odds] Refresh failed:', err.message);
      }
    });
    console.log(`[Odds] Provider ${oddsProvider.PROVIDER} scheduled with cron: ${ODDS_CRON}`);
  }
} else {
  console.log('[Odds] Disabled (no configured odds API key).');
}

const server = app.listen(PORT, () => {
  console.log(`KickPredict backend listening on port ${PORT}`);
  console.log(`Competitions: ${COMPETITIONS.join(', ')}`);
  syncAll();
});

pool.on('error', (err) => console.error('[Database] Unexpected idle client error:', err.message));

async function shutdown(signal) {
  console.log(`[Server] ${signal} received; shutting down.`);
  server.close(async () => {
    try { await pool.end(); } catch (err) { console.error('[Database] Shutdown error:', err.message); }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));