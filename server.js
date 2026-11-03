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
const { initFlashscoreSync, syncFlashscoreSchedule, smartLivePolling, fetchMatchLiveDetails, bigIntToFlashscoreId } = require('./sync-flashscore');
const { initTunisiaSync } = require('./sync-tunisia');

const {
  EXTRA_MARKETS,
  teamRatings,
  matchLambdas,
  buildMarketsPoints,
  resolveMarkets,
  DEFAULT_AVG_HOME,
  DEFAULT_AVG_AWAY
} = require('./pricingEngine');

const {
  shouldAllowCorrection,
  cleanExtrasPicks,
  MAX_CORRECTION_HOURS,
  MIN_CORRECTION_INTERVAL_MS
} = require('./settlementCorrection');

// ---------------------------------------------------------------------------
// 1. Startup validation (fail fast)
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'KICK_CLIENT_ID',
  'KICK_CLIENT_SECRET',
  'KICK_REDIRECT_URI',
  'FRONTEND_URL'
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

// Boost feature disabled globally
const MAX_BOOSTS = 0;

// Supported competitions
const COMPETITION_NAMES = {
  PL: 'Premier League',
  PD: 'La Liga',
  BL1: 'Bundesliga',
  SA: 'Serie A',
  FL1: 'Ligue 1',
  CL: 'Champions League',
  TUN: 'Ligue Professionnelle 1',
  TU1: 'Ligue Professionnelle 1',
  DEMO: 'Demo League'
};

const COMPETITIONS = [...new Set(
  (process.env.COMPETITION_CODES ? (process.env.COMPETITION_CODES.includes('TUN') || process.env.COMPETITION_CODES.includes('TU1') ? process.env.COMPETITION_CODES : `${process.env.COMPETITION_CODES},TUN`) : 'PL,PD,BL1,SA,FL1,CL,TUN')
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
    sameSite: 'lax',
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
// 3b. Live Match Clock (MM:SS + Stoppage Time) & Match Center Insights Helper
// ---------------------------------------------------------------------------
const ESPN_LEAGUE_SLUGS = {
  PL: 'eng.1',
  PD: 'esp.1',
  BL1: 'ger.1',
  SA: 'ita.1',
  FL1: 'fra.1',
  CL: 'uefa.champions',
  TUN: 'tun.1',
  TU1: 'tun.1'
};

const espnLiveCache = new Map();
const ESPN_CACHE_TTL_MS = 15 * 1000; // 15 seconds cache

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

function extractClockDetails(statusObj, utcDate) {
  if (!statusObj) return null;
  const typeName = statusObj.type?.name || '';
  const shortDetail = statusObj.type?.shortDetail || '';
  if (typeName === 'STATUS_HALFTIME' || shortDetail === 'HT') {
    return { live_clock: 'HT', live_seconds: null, live_stoppage_base: null };
  }
  const rawClock = String(statusObj.displayClock || shortDetail || '').trim().replace(/'\+/g, '+');
  if (!rawClock || rawClock === "0'" || rawClock === '0:00') return null;

  const kickoffMs = utcDate ? new Date(utcDate).getTime() : NaN;
  const secFromKickoff = Number.isFinite(kickoffMs)
    ? ((Math.floor((Date.now() - kickoffMs) / 1000) % 60) + 60) % 60
    : 0;
  const espnClockSec = Number(statusObj.clock);
  const secPart =
    Number.isFinite(espnClockSec) && espnClockSec > 0 && espnClockSec % 60 !== 0
      ? Math.floor(espnClockSec % 60)
      : secFromKickoff;

  const stoppageMatch = rawClock.match(/^(\d+)\s*'?\s*\+\s*(\d+)/);
  if (stoppageMatch) {
    const baseMin = parseInt(stoppageMatch[1], 10);
    const addedMin = parseInt(stoppageMatch[2], 10);
    return {
      live_clock: `${baseMin}+${addedMin}'`,
      live_seconds: addedMin * 60 + secPart,
      live_stoppage_base: baseMin
    };
  }

  const normalMatch = rawClock.match(/^(\d+)/);
  if (normalMatch) {
    const min = parseInt(normalMatch[1], 10);
    return {
      live_clock: `${min}'`,
      live_seconds: min * 60 + secPart,
      live_stoppage_base: null
    };
  }

  return { live_clock: rawClock, live_seconds: null, live_stoppage_base: null };
}

function computeFallbackClockDetails(utcDate, status) {
  if (status === 'PAUSED') {
    return { live_clock: 'HT', live_seconds: null, live_stoppage_base: null };
  }
  if (status !== 'IN_PLAY') return null;
  const elapsedSec = Math.floor((Date.now() - new Date(utcDate).getTime()) / 1000);
  if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return null;
  if (elapsedSec > 125 * 60) {
    return { live_clock: 'FT', live_seconds: null, live_stoppage_base: null };
  }

  if (elapsedSec <= 45 * 60) {
    const min = Math.max(1, Math.floor(elapsedSec / 60));
    return { live_clock: `${min}'`, live_seconds: elapsedSec, live_stoppage_base: null };
  }
  if (elapsedSec <= 53 * 60) {
    const stopSec = elapsedSec - 45 * 60;
    const addedMin = Math.max(1, Math.floor(stopSec / 60));
    return { live_clock: `45+${addedMin}'`, live_seconds: stopSec, live_stoppage_base: 45 };
  }
  if (elapsedSec <= 62 * 60) {
    return { live_clock: 'HT', live_seconds: null, live_stoppage_base: null };
  }
  const secondHalfSec = elapsedSec - 17 * 60;
  if (secondHalfSec <= 90 * 60) {
    const min = Math.max(46, Math.floor(secondHalfSec / 60));
    return { live_clock: `${min}'`, live_seconds: secondHalfSec, live_stoppage_base: null };
  }
  if (secondHalfSec <= 105 * 60) {
    const stopSec = secondHalfSec - 90 * 60;
    const addedMin = Math.max(1, Math.floor(stopSec / 60));
    return { live_clock: `90+${addedMin}'`, live_seconds: stopSec, live_stoppage_base: 90 };
  }
  return { live_clock: 'FT', live_seconds: null, live_stoppage_base: null };
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
    return { ...m, live_clock: 'FT', live_seconds: null, live_stoppage_base: null };
  }
  let clockInfo = null;
  let liveStatus = m.status;
  let liveHomeScore = m.home_score;
  let liveAwayScore = m.away_score;

  const mTime = m.utc_date ? new Date(m.utc_date).getTime() : null;
  const elapsedMinutes = mTime ? (Date.now() - mTime) / (60 * 1000) : 0;

  if (Array.isArray(espnEvents) && espnEvents.length > 0 && mTime) {
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
        clockInfo = extractClockDetails(ev.status, m.utc_date);
        liveStatus = typeName === 'STATUS_HALFTIME' ? 'PAUSED' : 'IN_PLAY';
        const hScore = parseInt(homeComp?.score, 10);
        const aScore = parseInt(awayComp?.score, 10);
        if (!Number.isNaN(hScore) && !Number.isNaN(aScore)) {
          liveHomeScore = hScore;
          liveAwayScore = aScore;
        }
      } else if (state === 'post') {
        liveStatus = 'FINISHED';
        clockInfo = { live_clock: 'FT', live_seconds: null, live_stoppage_base: null };
        const hScore = parseInt(homeComp?.score, 10);
        const aScore = parseInt(awayComp?.score, 10);
        if (!Number.isNaN(hScore) && !Number.isNaN(aScore)) {
          liveHomeScore = hScore;
          liveAwayScore = aScore;
        }
      }
    }
  }

  // Overdue safeguard: If match has run > 125 minutes with scores present, transition to FINISHED
  if (liveStatus !== 'FINISHED' && elapsedMinutes > 125 && liveHomeScore !== null && liveAwayScore !== null) {
    liveStatus = 'FINISHED';
    clockInfo = { live_clock: 'FT', live_seconds: null, live_stoppage_base: null };
  }

  if (!clockInfo) {
    clockInfo = computeFallbackClockDetails(m.utc_date, liveStatus);
  }

  return {
    ...m,
    status: liveStatus,
    home_score: liveHomeScore,
    away_score: liveAwayScore,
    live_clock: clockInfo ? clockInfo.live_clock : null,
    live_seconds: clockInfo ? clockInfo.live_seconds : null,
    live_stoppage_base: clockInfo ? clockInfo.live_stoppage_base : null
  };
}

function buildStandingsAndForm(finishedMatches, competitionCode) {
  const tableMap = new Map();
  const teamMatches = new Map();
  const compName = COMPETITION_NAMES[competitionCode] || competitionCode;

  function ensureTeam(name, crest) {
    if (!tableMap.has(name)) {
      tableMap.set(name, {
        team: name,
        crest: crest || null,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        points: 0
      });
    } else if (crest && !tableMap.get(name).crest) {
      tableMap.get(name).crest = crest;
    }
    if (!teamMatches.has(name)) {
      teamMatches.set(name, []);
    }
  }

  // finishedMatches is ordered by utc_date DESC
  for (const fm of finishedMatches) {
    const h = fm.home_team;
    const a = fm.away_team;
    const hs = Number(fm.home_score);
    const as = Number(fm.away_score);
    if (!h || !a || !Number.isFinite(hs) || !Number.isFinite(as)) continue;

    ensureTeam(h, fm.home_crest);
    ensureTeam(a, fm.away_crest);

    // Record recent form (up to 5 most recent matches per team)
    const hList = teamMatches.get(h);
    if (hList.length < 5) {
      hList.push({
        result: hs > as ? 'W' : hs === as ? 'D' : 'L',
        opponent: a,
        opponent_crest: fm.away_crest || null,
        score: `${hs}-${as}`,
        utc_date: fm.utc_date,
        competition_name: compName
      });
    }
    const aList = teamMatches.get(a);
    if (aList.length < 5) {
      aList.push({
        result: as > hs ? 'W' : as === hs ? 'D' : 'L',
        opponent: h,
        opponent_crest: fm.home_crest || null,
        score: `${hs}-${as}`,
        utc_date: fm.utc_date,
        competition_name: compName
      });
    }

    // Standings count league stages (or all matches if tournament)
    const isLeagueStage = !fm.stage || ['REGULAR_SEASON', 'LEAGUE_STAGE'].includes(fm.stage);
    if (isLeagueStage) {
      const hRow = tableMap.get(h);
      const aRow = tableMap.get(a);
      hRow.played += 1;
      aRow.played += 1;
      hRow.gf += hs;
      hRow.ga += as;
      hRow.gd = hRow.gf - hRow.ga;
      aRow.gf += as;
      aRow.ga += hs;
      aRow.gd = aRow.gf - aRow.ga;

      if (hs > as) {
        hRow.won += 1;
        hRow.points += 3;
        aRow.lost += 1;
      } else if (hs < as) {
        aRow.won += 1;
        aRow.points += 3;
        hRow.lost += 1;
      } else {
        hRow.drawn += 1;
        aRow.drawn += 1;
        hRow.points += 1;
        aRow.points += 1;
      }
    }
  }

  const standings = Array.from(tableMap.values())
    .sort((x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team))
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  return { standings, teamMatches };
}

function buildRoomStatsForMatches(matchList, allPredRows) {
  const byMatch = new Map();
  for (const m of matchList) {
    byMatch.set(String(m.id), []);
  }
  for (const r of allPredRows) {
    const key = String(r.match_id);
    if (byMatch.has(key)) byMatch.get(key).push(r);
  }

  const result = {};
  for (const m of matchList) {
    const preds = byMatch.get(String(m.id)) || [];
    const totalPlayers = preds.length;

    // 1. Who wins?
    const outcomeCounts = { HOME: 0, DRAW: 0, AWAY: 0 };
    let outcomeTotal = 0;

    // 2. Both teams score & Over/Under 2.5 goals
    const bttsCounts = { YES: 0, NO: 0 };
    let bttsTotal = 0;
    const ou25Counts = { OVER: 0, UNDER: 0 };
    let ou25Total = 0;

    for (const p of preds) {
      if (p.predicted_outcome && outcomeCounts[p.predicted_outcome] !== undefined) {
        outcomeCounts[p.predicted_outcome] += 1;
        outcomeTotal += 1;
      }
      const extras = Array.isArray(p.extras_picks) ? p.extras_picks : [];
      let foundBtts = false;
      let foundOu = false;

      for (const ex of extras) {
        const mk = String(ex.market || '').toLowerCase();
        const sel = String(ex.selection || '').toUpperCase();
        if (mk.includes('btts') || mk.includes('both')) {
          if (sel === 'YES' || sel === 'NO') {
            bttsCounts[sel] += 1;
            bttsTotal += 1;
            foundBtts = true;
          }
        } else if (mk.includes('25') || mk.includes('2.5') || mk.includes('over_under') || mk.includes('total_goals')) {
          if (sel.includes('OVER') || sel === 'YES') {
            ou25Counts.OVER += 1;
            ou25Total += 1;
            foundOu = true;
          } else if (sel.includes('UNDER') || sel === 'NO') {
            ou25Counts.UNDER += 1;
            ou25Total += 1;
            foundOu = true;
          }
        }
      }

      // Also infer from exact score if user didn't pick that specific extra
      if (!foundBtts && p.predicted_home !== null && p.predicted_away !== null) {
        const bothScored = Number(p.predicted_home) > 0 && Number(p.predicted_away) > 0;
        bttsCounts[bothScored ? 'YES' : 'NO'] += 1;
        bttsTotal += 1;
      }
      if (!foundOu && p.predicted_home !== null && p.predicted_away !== null) {
        const over25 = Number(p.predicted_home) + Number(p.predicted_away) > 2;
        ou25Counts[over25 ? 'OVER' : 'UNDER'] += 1;
        ou25Total += 1;
      }
    }

    // Fallback to model probabilities if 0 predictions exist yet so UI always looks rich
    const mkPts =
      m.markets_points ||
      buildMarketsPoints(
        Number(m.home_lambda || DEFAULT_AVG_HOME),
        Number(m.away_lambda || DEFAULT_AVG_AWAY)
      );

    let topOutcome = 'HOME';
    let topOutcomePct = 50;
    if (outcomeTotal > 0) {
      topOutcome = Object.keys(outcomeCounts).reduce((a, b) =>
        outcomeCounts[a] >= outcomeCounts[b] ? a : b
      );
      topOutcomePct = Math.round((outcomeCounts[topOutcome] / outcomeTotal) * 100);
    } else if (mkPts?.outcome_1x2) {
      const o = mkPts.outcome_1x2;
      // Lower points means higher probability
      topOutcome = ['HOME', 'DRAW', 'AWAY'].reduce((a, b) => ((o[a] || 99) <= (o[b] || 99) ? a : b));
      const invSum = 1 / (o.HOME || 10) + 1 / (o.DRAW || 10) + 1 / (o.AWAY || 10);
      topOutcomePct = Math.round((1 / (o[topOutcome] || 10) / invSum) * 100);
    }

    let topBtts = 'YES';
    let topBttsPct = 55;
    if (bttsTotal > 0) {
      topBtts = bttsCounts.YES >= bttsCounts.NO ? 'YES' : 'NO';
      topBttsPct = Math.round((bttsCounts[topBtts] / bttsTotal) * 100);
    }

    let topOu25 = 'OVER 2.5';
    let topOu25Pct = 60;
    if (ou25Total > 0) {
      const isOver = ou25Counts.OVER >= ou25Counts.UNDER;
      topOu25 = isOver ? 'OVER 2.5' : 'UNDER 2.5';
      topOu25Pct = Math.round(((isOver ? ou25Counts.OVER : ou25Counts.UNDER) / ou25Total) * 100);
    }

    result[m.id] = {
      total_players: totalPlayers,
      who_wins: {
        selection: topOutcome,
        label:
          topOutcome === 'HOME'
            ? m.home_team
            : topOutcome === 'AWAY'
            ? m.away_team
            : 'DRAW',
        pct: topOutcomePct
      },
      btts: {
        selection: topBtts,
        pct: topBttsPct
      },
      over_under: {
        selection: topOu25,
        pct: topOu25Pct
      }
    };
  }

  return result;
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
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    });
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
       WHERE competition_code = $1
         AND round_key IS NOT NULL
         AND (flashscore_id IS NOT NULL OR utc_date >= NOW() - INTERVAL '4 days')
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
      `SELECT id, external_id, flashscore_id, competition_code, round_key, round_label,
              home_team, home_crest, away_team, away_crest,
              utc_date, status, home_score, away_score, home_ht, away_ht,
              home_lambda, away_lambda, markets_points, settled_outcomes,
              match_stats, match_incidents, match_lineups,
              (NOW() >= utc_date OR status NOT IN ('TIMED', 'SCHEDULED')) AS is_locked
       FROM matches
       WHERE competition_code = $1
         AND round_key = $2
         AND (flashscore_id IS NOT NULL OR utc_date >= NOW() - INTERVAL '4 days')
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

      if (MAX_BOOSTS > 0) {
        const boostRes = await pool.query(
          `SELECT boosts_used FROM user_round_boosts
           WHERE user_id = $1 AND competition_code = $2 AND round_key = $3`,
          [req.user.id, competition, roundKey]
        );
        boostsUsed = boostRes.rows[0]?.boosts_used || 0;
      }
    }

    const hasActiveMatches = matches.some(
      (m) => m.status !== 'FINISHED' && (m.is_locked || ['IN_PLAY', 'PAUSED'].includes(m.status))
    );
    const espnEvents = hasActiveMatches ? await fetchEspnScoreboard(competition) : [];

    // Fetch official standings from standings table first
    const standingsRes = await pool.query(
      `SELECT team_name as team, crest, rank, played, won, drawn, lost, gf, ga, gd, points
       FROM standings
       WHERE competition_code = $1
       ORDER BY rank ASC`,
      [competition]
    );

    // Fetch finished matches in this competition for Standings Table + Last 5 Form
    const finishedMatchesRes = await pool.query(
      `SELECT home_team, home_crest, away_team, away_crest, home_score, away_score, utc_date, stage
       FROM matches
       WHERE competition_code = $1
         AND status = 'FINISHED'
         AND home_score IS NOT NULL
         AND away_score IS NOT NULL
       ORDER BY utc_date DESC`,
      [competition]
    );
    const { standings: fallbackStandings, teamMatches } = buildStandingsAndForm(finishedMatchesRes.rows, competition);
    const standings = standingsRes.rows.length > 0 ? standingsRes.rows : fallbackStandings;

    // Fetch all predictions on this round's matches for "HOW THE ROOM PLAYED"
    const allRoundPredsRes =
      matches.length > 0
        ? await pool.query(
            `SELECT match_id, predicted_outcome, predicted_home, predicted_away, extras_picks
             FROM predictions
             WHERE match_id = ANY($1::bigint[])`,
            [matches.map((m) => m.id)]
          )
        : { rows: [] };
    const roomStatsMap = buildRoomStatsForMatches(matches, allRoundPredsRes.rows);

    res.json({
      competition,
      competition_name: COMPETITION_NAMES[competition] || competition,
      rounds,
      round: roundKey,
      maxBoosts: MAX_BOOSTS,
      boostsUsed,
      standings,
      matches: matches.map((rawMatch) => {
        const m = enrichMatchWithLiveClock(rawMatch, espnEvents);
        return {
          ...m,
          competition_name: COMPETITION_NAMES[competition] || competition,
          markets_points:
            m.markets_points ||
            buildMarketsPoints(
              Number(m.home_lambda || DEFAULT_AVG_HOME),
              Number(m.away_lambda || DEFAULT_AVG_AWAY)
            ),
          prediction: userPredictions[m.id] || null,
          standings,
          home_form: teamMatches.get(m.home_team) || [],
          away_form: teamMatches.get(m.away_team) || [],
          room_stats: roomStatsMap[m.id] || null
        };
      })
    });
  })
);

app.get(
  '/api/standings',
  asyncHandler(async (req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    });
    const competition = (req.query.competition || 'TUN').toUpperCase();
    const { rows } = await pool.query(
      `SELECT team_name as team, crest, rank, played, won, drawn, lost, gf, ga, gd, points
       FROM standings
       WHERE competition_code = $1
       ORDER BY rank ASC`,
      [competition]
    );
    res.json({
      competition,
      competition_name: COMPETITION_NAMES[competition] || competition,
      standings: rows
    });
  })
);

app.get(
  '/api/matches/:id/details',
  asyncHandler(async (req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    });
    const rawParam = String(req.params.id || '').trim();
    if (!rawParam) {
      return res.status(400).json({ error: 'Invalid match id.' });
    }

    const isNum = /^\d+$/.test(rawParam);
    console.log(`[API /details] Request for match id/param: "${rawParam}" (isNum: ${isNum})`);

    const { rows } = await pool.query(
      isNum
        ? `SELECT id, external_id, flashscore_id, competition_code, home_team, away_team, status,
                  utc_date, home_score, away_score, home_ht, away_ht, match_stats, match_incidents, match_lineups
           FROM matches
           WHERE id = $1::bigint OR external_id = $1::bigint
           LIMIT 1`
        : `SELECT id, external_id, flashscore_id, competition_code, home_team, away_team, status,
                  utc_date, home_score, away_score, home_ht, away_ht, match_stats, match_incidents, match_lineups
           FROM matches
           WHERE flashscore_id = $1
           LIMIT 1`,
      [rawParam]
    );

    if (rows.length === 0) {
      console.warn(`[API /details] Match not found for param: "${rawParam}"`);
      return res.status(404).json({ error: 'Match not found.' });
    }
    const row = rows[0];
    const matchId = row.id;
    const rawFlashId = row.flashscore_id || (row.external_id && bigIntToFlashscoreId ? bigIntToFlashscoreId(row.external_id) : null);
    console.log(`[API /details] Match resolved: id=${matchId}, external_id=${row.external_id}, flashscore_id=${rawFlashId}, status=${row.status}, hasLineupsInDB=${Boolean(row.match_lineups)}`);

    const isFinished = row.status === 'FINISHED';
    const isLive = row.status === 'IN_PLAY' || row.status === 'PAUSED' || row.status === '1H' || row.status === '2H' || row.status === 'HT';
    const kickoffNearOrPast = row.utc_date && (new Date(row.utc_date).getTime() - Date.now() <= 60 * 60 * 1000);
    const shouldFetchLive = Boolean(rawFlashId && fetchMatchLiveDetails && (!row.match_lineups || isLive || !isFinished || kickoffNearOrPast));

    console.log(`[API /details] shouldFetchLive=${shouldFetchLive} (isLive=${isLive}, isFinished=${isFinished}, kickoffNearOrPast=${Boolean(kickoffNearOrPast)}, hasLineups=${Boolean(row.match_lineups)})`);

    if (shouldFetchLive) {
      try {
        console.log(`[API /details] Fetching live details from Flashscore for ${rawFlashId}...`);
        const liveDetails = await fetchMatchLiveDetails(rawFlashId);
        if (liveDetails) {
          const hasLineups = Boolean(liveDetails.lineups);
          const hasStats = Array.isArray(liveDetails.stats) && liveDetails.stats.length > 0;
          const hasIncidents = Array.isArray(liveDetails.incidents) && liveDetails.incidents.length > 0;
          console.log(`[API /details] Live details for ${rawFlashId} retrieved: lineups=${hasLineups}, stats=${hasStats}, incidents=${hasIncidents}`);

          let liveStatus = row.status;
          let liveHomeScore = row.home_score;
          let liveAwayScore = row.away_score;
          if (liveDetails.scores && liveDetails.scores.home !== null && liveDetails.scores.away !== null) {
            liveHomeScore = liveDetails.scores.home;
            liveAwayScore = liveDetails.scores.away;
            if (row.status === 'SCHEDULED' || row.status === 'TIMED') {
              liveStatus = 'IN_PLAY';
            }
          }

          if (hasLineups || hasStats || hasIncidents || liveHomeScore !== row.home_score || liveStatus !== row.status) {
            await pool.query(
              `UPDATE matches
               SET flashscore_id = COALESCE(flashscore_id, $1),
                   match_stats = COALESCE($2::jsonb, match_stats),
                   match_incidents = COALESCE($3::jsonb, match_incidents),
                   match_lineups = COALESCE($4::jsonb, match_lineups),
                   status = $5,
                   home_score = COALESCE($6, home_score),
                   away_score = COALESCE($7, away_score),
                   updated_at = NOW()
               WHERE id = $8`,
              [
                rawFlashId,
                hasStats ? JSON.stringify(liveDetails.stats) : null,
                hasIncidents ? JSON.stringify(liveDetails.incidents) : null,
                hasLineups ? JSON.stringify(liveDetails.lineups) : null,
                liveStatus,
                liveHomeScore,
                liveAwayScore,
                matchId
              ]
            );
            if (hasLineups) row.match_lineups = liveDetails.lineups;
            if (hasStats) row.match_stats = liveDetails.stats;
            if (hasIncidents) row.match_incidents = liveDetails.incidents;
            row.status = liveStatus;
            row.home_score = liveHomeScore;
            row.away_score = liveAwayScore;
            console.log(`[API /details] Successfully saved details to DB for match ${matchId}`);
          }
        }
      } catch (liveErr) {
        console.error(`[API /details] Error fetching live details for match ${matchId} (${rawFlashId}):`, liveErr.message);
      }
    }

    // Ensure all contract properties (match_lineups, lineups, homeRoster, awayRoster) are explicitly defined
    const lineupsPayload = row.match_lineups || null;
    row.lineups = lineupsPayload;
    if (lineupsPayload) {
      row.homeRoster = lineupsPayload.homeRoster || {
        formation: lineupsPayload.formationHome || '4-3-3',
        manager: lineupsPayload.managerHome || null,
        starting: lineupsPayload.startingHome || [],
        subs: lineupsPayload.subsHome || []
      };
      row.awayRoster = lineupsPayload.awayRoster || {
        formation: lineupsPayload.formationAway || '4-3-3',
        manager: lineupsPayload.managerAway || null,
        starting: lineupsPayload.startingAway || [],
        subs: lineupsPayload.subsAway || []
      };
    }

    console.log(`[API /details] Returning response for match ${matchId}: lineups=${Boolean(row.lineups || row.match_lineups)}`);
    res.json(row);
  })
);

// ---------------------------------------------------------------------------
// 4b. Image Proxy (to bypass browser CORS/Hotlinking restrictions on Flashscore CDNs)
// ---------------------------------------------------------------------------
app.get(
  '/api/image-proxy',
  asyncHandler(async (req, res) => {
    const rawUrl = req.query.url;
    if (!rawUrl || typeof rawUrl !== 'string') {
      return res.status(400).send('Missing url parameter');
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return res.status(400).send('Invalid url');
    }

    // Security check: restrict proxying strictly to trusted public football image domains
    const allowedHosts = [
      'static.flashscore.com',
      'flashscore.com',
      'res.cloudinary.com',
      'upload.wikimedia.org'
    ];
    const isAllowed = allowedHosts.some(
      (h) => parsedUrl.hostname === h || parsedUrl.hostname.endsWith('.' + h)
    );
    if (!isAllowed) {
      return res.status(403).send('Forbidden host');
    }

    try {
      const upstreamRes = await fetch(parsedUrl.href, {
        headers: {
          'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 14; SM-S928B Build/UP1A.231005.007)',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        },
        signal: AbortSignal.timeout(8000)
      });

      if (!upstreamRes.ok) {
        return res.status(upstreamRes.status).send('Upstream image error');
      }

      const contentType = upstreamRes.headers.get('content-type') || 'image/png';
      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*'
      });

      const buffer = Buffer.from(await upstreamRes.arrayBuffer());
      return res.send(buffer);
    } catch (err) {
      return res.status(502).send('Error fetching upstream image');
    }
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
    const wantBoost = false; // Boost disabled

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

      if (!markets || typeof markets !== 'object') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Match market pricing data is unavailable. Please try again shortly.' });
      }

      // Validate required market keys before locking points
      if (outcome && (typeof markets.outcome_1x2?.[outcome] !== 'number' || isNaN(markets.outcome_1x2[outcome]))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Market pricing for outcome "${outcome}" is missing. Please try again shortly.` });
      }

      const scoreKey = `${h}-${a}`;
      if (h !== null && (typeof markets.exact_score?.[scoreKey] !== 'number' || isNaN(markets.exact_score[scoreKey]))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Market pricing for score "${scoreKey}" is missing. Please try again shortly.` });
      }

      for (const pick of rawExtras) {
        const extraPts = markets.extras?.[pick.market]?.[pick.selection];
        if (typeof extraPts !== 'number' || isNaN(extraPts)) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: `Market pricing for extra "${pick.market} - ${pick.selection}" is missing. Please try again shortly.` });
        }
      }

      // Lock the points with safe fallbacks
      const outcomePointsLocked = outcome ? (markets.outcome_1x2?.[outcome] ?? 0) : 0;
      const exactPointsLocked = h !== null ? (markets.exact_score?.[scoreKey] ?? 0) : 0;
      const lockedExtras = rawExtras.map((pick) => ({
        market: pick.market,
        selection: pick.selection,
        points_locked: markets.extras?.[pick.market]?.[pick.selection] ?? 0
      }));

      // Atomic x2 boost reservation per user / competition / round (optimized to skip if boosts disabled)
      let boostsUsed = 0;
      if (MAX_BOOSTS > 0 && wantBoost) {
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
        boostsUsed = boostRow.rows[0]?.boosts_used || 0;

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
      }

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
// 7. Settlement & Auto-Correction: idempotent, transaction-safe per match
// ---------------------------------------------------------------------------

/**
 * Settles a locked match record and its pending predictions within an open transaction.
 * Saves settled_home_score, settled_away_score, settled_home_ht, settled_away_ht so any
 * future score revisions can be detected and reconciled cleanly.
 */
async function settleMatchRecord(client, lockedMatch) {
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
    [lockedMatch.id]
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
      const actual = outcomes.extras ? outcomes.extras[pick.market] : undefined;
      if (actual === null || actual === undefined) {
        // Half-time market when provider did not return HT score
        return { ...pick, status: 'VOID', won: null, points_earned: 0 };
      }
      const won = actual === pick.selection;
      const earned = won ? Number(pick.points_locked || 0) : 0;
      base += earned;
      return { ...pick, status: won ? 'WON' : 'LOST', won, points_earned: earned };
    });

    const finalPoints = base;

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
     SET points_calculated = TRUE,
         settled_outcomes = $1::jsonb,
         settled_home_score = $2,
         settled_away_score = $3,
         settled_home_ht = $4,
         settled_away_ht = $5,
         updated_at = NOW()
     WHERE id = $6`,
    [
      JSON.stringify(outcomes),
      lockedMatch.home_score,
      lockedMatch.away_score,
      lockedMatch.home_ht,
      lockedMatch.away_ht,
      lockedMatch.id
    ]
  );

  return { predsCount: preds.length, outcomes };
}

/**
 * Reverts previous settlement effects and immediately re-settles on the new score.
 * Executed in a single atomic transaction with FOR UPDATE row locking.
 */
async function correctAndResettleMatch(client, match, newScore) {
  const oldHome = match.settled_home_score !== null && match.settled_home_score !== undefined
    ? Number(match.settled_home_score)
    : Number(match.home_score);
  const oldAway = match.settled_away_score !== null && match.settled_away_score !== undefined
    ? Number(match.settled_away_score)
    : Number(match.away_score);
  const oldHtHome = match.settled_home_ht !== null && match.settled_home_ht !== undefined
    ? Number(match.settled_home_ht)
    : (match.home_ht !== null ? Number(match.home_ht) : null);
  const oldHtAway = match.settled_away_ht !== null && match.settled_away_ht !== undefined
    ? Number(match.settled_away_ht)
    : (match.away_ht !== null ? Number(match.away_ht) : null);

  // 1. Deduct points_awarded and decrement exact_scores_count from users who matched old settled score
  await client.query(
    `UPDATE users u
     SET total_points = GREATEST(0, u.total_points - COALESCE(p.points_awarded, 0)),
         exact_scores_count = GREATEST(0, u.exact_scores_count - (
           CASE
             WHEN p.predicted_home IS NOT NULL
              AND p.predicted_away IS NOT NULL
              AND p.predicted_home = $1
              AND p.predicted_away = $2
             THEN 1
             ELSE 0
           END
         ))
     FROM predictions p
     WHERE p.user_id = u.id
       AND p.match_id = $3
       AND p.points_awarded IS NOT NULL`,
    [oldHome, oldAway, match.id]
  );

  // 2. Reset predictions: points_awarded = NULL, clean extras_picks (preserve array, never NULL)
  await client.query(
    `UPDATE predictions p
     SET points_awarded = NULL,
         extras_picks = CASE
           WHEN p.extras_picks IS NULL OR jsonb_array_length(p.extras_picks) = 0 THEN '[]'::jsonb
           ELSE COALESCE(
             (
               SELECT jsonb_agg(elem - 'status' - 'won' - 'points_earned')
               FROM jsonb_array_elements(p.extras_picks) AS elem
             ),
             '[]'::jsonb
           )
         END,
         updated_at = NOW()
     WHERE p.match_id = $1`,
    [match.id]
  );

  // 3. Update matches with new score and reset settlement flags
  await client.query(
    `UPDATE matches
     SET home_score = $1,
         away_score = $2,
         home_ht = $3,
         away_ht = $4,
         status = 'FINISHED',
         points_calculated = FALSE,
         settled_outcomes = NULL,
         last_corrected_at = NOW(),
         updated_at = NOW()
     WHERE id = $5`,
    [newScore.home, newScore.away, newScore.htHome, newScore.htAway, match.id]
  );

  // 4. Re-settle immediately within this exact same transaction
  const updatedLockedMatch = {
    ...match,
    home_score: newScore.home,
    away_score: newScore.away,
    home_ht: newScore.htHome,
    away_ht: newScore.htAway
  };

  const { predsCount } = await settleMatchRecord(client, updatedLockedMatch);

  console.log(
    `[Correction] Match ${match.id} (${match.home_team} vs ${match.away_team}): ` +
    `corrected from ${oldHome}-${oldAway} (HT ${oldHtHome ?? '-'}-${oldHtAway ?? '-'}) ` +
    `to ${newScore.home}-${newScore.away} (HT ${newScore.htHome ?? '-'}-${newScore.htAway ?? '-'}). ` +
    `Re-settled for ${predsCount} predictions.`
  );

  return { predsCount };
}

/**
 * Checks incoming sync rows against database-settled matches and performs auto-correction
 * if provider scores changed within 48h.
 */
async function reconcileScoreCorrections(incomingRows) {
  const finishedRows = (incomingRows || []).filter(
    (r) => r.status === 'FINISHED' && r.home_score !== null && r.away_score !== null
  );
  if (finishedRows.length === 0) return;

  const externalIds = finishedRows.map((r) => r.external_id);
  const { rows: settledMatches } = await pool.query(
    `SELECT id, external_id, home_team, away_team, status, utc_date,
            home_score, away_score, home_ht, away_ht,
            settled_home_score, settled_away_score, settled_home_ht, settled_away_ht,
            points_calculated, last_corrected_at
     FROM matches
     WHERE external_id = ANY($1::bigint[])
       AND points_calculated = TRUE
       AND utc_date >= NOW() - INTERVAL '48 hours'`,
    [externalIds]
  );

  for (const match of settledMatches) {
    const incoming = finishedRows.find((r) => String(r.external_id) === String(match.external_id));
    if (!incoming) continue;

    const newScore = {
      home: incoming.home_score,
      away: incoming.away_score,
      htHome: incoming.home_ht,
      htAway: incoming.away_ht
    };

    const check = shouldAllowCorrection({
      match,
      newStatus: incoming.status,
      newScore
    });

    if (!check.allow) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockRes = await client.query(
        `SELECT id, external_id, home_team, away_team, status, utc_date,
                home_score, away_score, home_ht, away_ht,
                settled_home_score, settled_away_score, settled_home_ht, settled_away_ht,
                points_calculated, last_corrected_at
         FROM matches
         WHERE id = $1
         FOR UPDATE`,
        [match.id]
      );
      if (lockRes.rowCount === 0) {
        await client.query('ROLLBACK');
        continue;
      }
      const lockedMatch = lockRes.rows[0];
      const recheck = shouldAllowCorrection({
        match: lockedMatch,
        newStatus: incoming.status,
        newScore
      });
      if (!recheck.allow) {
        await client.query('ROLLBACK');
        continue;
      }

      await correctAndResettleMatch(client, lockedMatch, newScore);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[Correction] Failed for match ${match.id}:`, err.message);
    } finally {
      client.release();
    }
  }
}

/**
 * Safety net: checks for any settled match in the database where current score differs
 * from settled score, within 48h, and triggers correction.
 */
async function reconcileUnsettledCorrections() {
  const { rows: discrepancyMatches } = await pool.query(
    `SELECT id, external_id, home_team, away_team, status, utc_date,
            home_score, away_score, home_ht, away_ht,
            settled_home_score, settled_away_score, settled_home_ht, settled_away_ht,
            points_calculated, last_corrected_at
     FROM matches
     WHERE points_calculated = TRUE
       AND status = 'FINISHED'
       AND home_score IS NOT NULL
       AND away_score IS NOT NULL
       AND utc_date >= NOW() - INTERVAL '48 hours'
       AND (
         (settled_home_score IS NOT NULL AND home_score != settled_home_score)
         OR (settled_away_score IS NOT NULL AND away_score != settled_away_score)
         OR (settled_home_ht IS NOT NULL AND home_ht IS NOT NULL AND home_ht != settled_home_ht)
         OR (settled_away_ht IS NOT NULL AND away_ht IS NOT NULL AND away_ht != settled_away_ht)
       )`
  );

  for (const match of discrepancyMatches) {
    const newScore = {
      home: match.home_score,
      away: match.away_score,
      htHome: match.home_ht,
      htAway: match.away_ht
    };

    const check = shouldAllowCorrection({
      match,
      newStatus: match.status,
      newScore
    });

    if (!check.allow) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockRes = await client.query(
        `SELECT id, external_id, home_team, away_team, status, utc_date,
                home_score, away_score, home_ht, away_ht,
                settled_home_score, settled_away_score, settled_home_ht, settled_away_ht,
                points_calculated, last_corrected_at
         FROM matches
         WHERE id = $1
         FOR UPDATE`,
        [match.id]
      );
      if (lockRes.rowCount === 0) {
        await client.query('ROLLBACK');
        continue;
      }
      const lockedMatch = lockRes.rows[0];
      const recheck = shouldAllowCorrection({
        match: lockedMatch,
        newStatus: lockedMatch.status,
        newScore
      });
      if (!recheck.allow) {
        await client.query('ROLLBACK');
        continue;
      }

      await correctAndResettleMatch(client, lockedMatch, newScore);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[Correction] Failed for discrepancy match ${match.id}:`, err.message);
    } finally {
      client.release();
    }
  }
}

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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

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

      const { predsCount } = await settleMatchRecord(client, lockedMatch);

      await client.query('COMMIT');
      console.log(`[Settle] Match ${lockedMatch.id} settled (${predsCount} predictions)`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[Settle] Failed for match ${m.id}:`, err.message);
    } finally {
      client.release();
    }
  }
}

let schemaEnsured = false;

/**
 * Automatically ensures that the auto-correction tracking and Flashscore columns exist in PostgreSQL.
 * Runs idempotently on boot so deployments on Render or fresh databases never fail.
 */
async function ensureAutoCorrectionSchema() {
  if (schemaEnsured) return true;
  try {
    await pool.query(`
      ALTER TABLE matches
        ADD COLUMN IF NOT EXISTS settled_home_score INT,
        ADD COLUMN IF NOT EXISTS settled_away_score INT,
        ADD COLUMN IF NOT EXISTS settled_home_ht INT,
        ADD COLUMN IF NOT EXISTS settled_away_ht INT,
        ADD COLUMN IF NOT EXISTS last_corrected_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS flashscore_id VARCHAR(32),
        ADD COLUMN IF NOT EXISTS match_stats JSONB,
        ADD COLUMN IF NOT EXISTS match_incidents JSONB,
        ADD COLUMN IF NOT EXISTS match_lineups JSONB;

      CREATE INDEX IF NOT EXISTS idx_matches_flashscore_id ON matches(flashscore_id);

      UPDATE matches
      SET settled_home_score = COALESCE(settled_home_score, home_score),
          settled_away_score = COALESCE(settled_away_score, away_score),
          settled_home_ht = COALESCE(settled_home_ht, home_ht),
          settled_away_ht = COALESCE(settled_away_ht, away_ht)
      WHERE points_calculated = TRUE AND settled_home_score IS NULL;
    `);
    schemaEnsured = true;
    console.log('[Database] Auto-correction & Flashscore columns verified.');
    return true;
  } catch (err) {
    console.error('[Database] Schema verification error:', err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 9. Error handler + start
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[API Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Universal Flashscore synchronization: On-Boot Fetch + Midnight Cron + Smart 2m Live Polling.
// (Legacy 1-minute blind polling removed to prevent Cloudflare blocks and reduce server load)

// Odds have their own conservative schedule so they don't consume quota every
// time match data is refreshed. They are optional and disabled without a key.
const enableOddsApi = process.env.ENABLE_ODDS_API === 'true';
const ODDS_CRON = process.env.ODDS_CRON || oddsProvider.DEFAULT_CRON;
if (enableOddsApi && oddsProvider.isEnabled()) {
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
  console.log('[Odds] Disabled (ENABLE_ODDS_API is false or no API key configured). Daily quota protected.');
}

const server = app.listen(PORT, async () => {
  console.log(`KickPredict backend listening on port ${PORT}`);
  console.log(`Competitions: ${COMPETITIONS.join(', ')}`);
  await ensureAutoCorrectionSchema();
  initFlashscoreSync({
    pool,
    cron,
    settleFinishedMatches,
    reconcileScoreCorrections
  });
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