'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { teamRatings, matchLambdas, buildMatchMarketsPoints } = require('./pricingEngine');
const { MASTER_CRESTS } = require('./team-crests-master');

// Flashscore Raw Feed Endpoints & Config
const FLASHSCORE_BASE_URL = 'https://local-global.flashscore.ninja/2/x/feed';
const FLASHSCORE_FALLBACK_URL = 'https://46.flashscore.ninja/2/x/feed';
const FLASHSCORE_IMAGE_BASE = 'https://static.flashscore.com/res/image/data';

// Mobile Dalvik headers to bypass Cloudflare protection and emulate native mobile app
const FLASHSCORE_HEADERS = {
  'x-fsign': 'SW9D1eZo',
  'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 14; SM-S928B Build/UP1A.231005.007)',
  'Accept': '*/*',
  'Accept-Language': 'ar,en-US;q=0.9',
  'Connection': 'keep-alive'
};

const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Reversibly converts an alphanumeric Flashscore Match ID (e.g. '4SrepIgn')
 * into a 64-bit safe integer for PostgreSQL BIGINT external_id storage.
 */
function flashscoreIdToBigInt(id) {
  if (typeof id === 'number') return id;
  if (!id || typeof id !== 'string') return 0;
  if (/^\d+$/.test(id)) return Number(id);

  let res = 0n;
  for (let i = 0; i < id.length; i++) {
    const idx = BASE62_ALPHABET.indexOf(id[i]);
    if (idx !== -1) {
      res = res * 62n + BigInt(idx);
    }
  }
  return Number(res);
}

/**
 * Reverts a BIGINT external_id back to its original Flashscore alphanumeric string.
 */
function bigIntToFlashscoreId(num) {
  let n = BigInt(num);
  if (n <= 0n) return '';
  let str = '';
  while (n > 0n) {
    const rem = Number(n % 62n);
    str = BASE62_ALPHABET[rem] + str;
    n = n / 62n;
  }
  return str;
}

/**
 * Maps Flashscore team logos to verified public CDN URLs.
 * Resolves authentic crests from MASTER_CRESTS dictionary first.
 */
function getFlashscoreCrest(logoFilename, teamName) {
  if (teamName && MASTER_CRESTS[teamName]) {
    return MASTER_CRESTS[teamName];
  }
  if (!logoFilename || typeof logoFilename !== 'string' || !logoFilename.trim()) {
    return null;
  }
  const clean = logoFilename.trim();
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    return clean;
  }
  return `${FLASHSCORE_IMAGE_BASE}/${clean}`;
}

/**
 * Dictionary mapping Latin team names to canonical Arabic team names for Tunisian league.
 */
const TUNISIA_TEAMS_AR = {
  'stade tunisien': 'الملعب التونسي',
  'club africain': 'النادي الإفريقي',
  'esperance tunis': 'الترجي الرياضي',
  'esperance de tunis': 'الترجي الرياضي',
  'esperance': 'الترجي الرياضي',
  'etoile sahel': 'النجم الساحلي',
  'etoile du sahel': 'النجم الساحلي',
  'cs sfaxien': 'النادي الصفاقسي',
  'sfaxien': 'النادي الصفاقسي',
  'us monastir': 'الاتحاد المنستيري',
  'monastir': 'الاتحاد المنستيري',
  'es zarzis': 'الترجي الجرجيسي',
  'zarzis': 'الترجي الجرجيسي',
  'olympique beja': 'الأولمبي الباجي',
  'beja': 'الأولمبي الباجي',
  'ca bizertin': 'النادي البنزرتي',
  'bizertin': 'النادي البنزرتي',
  'us ben guerdane': 'اتحاد بن قردان',
  'ben guerdane': 'اتحاد بن قردان',
  'as soliman': 'مستقبل سليمان',
  'soliman': 'مستقبل سليمان',
  'egs gafsa': 'قوافل قفصة',
  'gafsa': 'قوافل قفصة',
  'js omrane': 'شبيبة العمران',
  'omrane': 'شبيبة العمران',
  'es metlaoui': 'نجم المتلوي',
  'metlaoui': 'نجم المتلوي',
  'us tataouine': 'اتحاد تطاوين',
  'tataouine': 'اتحاد تطاوين',
  'as gabes': 'مستقبل قابس',
  'gabes': 'مستقبل قابس',
  'cs hammam-lif': 'نادي حمام الأنف',
  'hammam-lif': 'نادي حمام الأنف',
  'ps sakiet eddaier': 'تقدم ساقية الدائر',
  'sakiet eddaier': 'تقدم ساقية الدائر'
};

/**
 * Formats a raw team name into Arabic if Tunisian, otherwise returns cleaned name.
 */
function formatTunisianTeam(rawName) {
  if (!rawName) return 'فريق تونسي';
  const clean = rawName.trim();
  if (/[\u0600-\u06FF]/.test(clean)) return clean;
  const lower = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  for (const [latin, arabic] of Object.entries(TUNISIA_TEAMS_AR)) {
    if (lower === latin || lower.includes(latin)) {
      return arabic;
    }
  }
  return clean;
}

/**
 * Fetches raw feed from Flashscore mobile endpoints with fallback.
 */
async function fetchFlashscoreFeed(feedPath, { fetcher = fetch } = {}) {
  const cleanPath = String(feedPath).replace(/^\/+/, '');
  const urls = [
    `${FLASHSCORE_BASE_URL}/${cleanPath}`,
    `${FLASHSCORE_FALLBACK_URL}/${cleanPath}`
  ];

  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetcher(url, {
        headers: FLASHSCORE_HEADERS,
        signal: AbortSignal.timeout(15000)
      });
      if (res.ok) {
        return await res.text();
      }
      lastError = new Error(`Flashscore HTTP ${res.status} (${res.statusText}) on ${url}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`Flashscore fetch failed for ${feedPath}`);
}

/**
 * Parses Flashscore raw delimited feed into structured tournament and match objects.
 */
function parseFlashscoreFeed(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const tournaments = [];
  const tournamentBlocks = rawText.split('~ZA÷').slice(1);

  for (const block of tournamentBlocks) {
    const matchBlocks = block.split('~AA÷');
    const headerPart = matchBlocks[0];
    const headerFields = {};
    for (const item of headerPart.split('¬')) {
      const idx = item.indexOf('÷');
      if (idx !== -1) {
        headerFields[item.slice(0, idx)] = item.slice(idx + 1);
      }
    }
    const tournamentName = headerPart.split('¬')[0] || '';

    const matches = [];
    for (let i = 1; i < matchBlocks.length; i++) {
      const mBlock = matchBlocks[i];
      const mFields = {};
      const pairs = mBlock.split('¬');
      mFields.id = pairs[0].split('÷')[0];
      for (const item of pairs) {
        const idx = item.indexOf('÷');
        if (idx !== -1) {
          mFields[item.slice(0, idx)] = item.slice(idx + 1);
        }
      }
      matches.push(mFields);
    }

    tournaments.push({
      name: tournamentName,
      country: headerFields.ZY || '',
      tournamentId: headerFields.ZEE || '',
      seasonId: headerFields.ZC || '',
      url: headerFields.ZL || '',
      logo: headerFields.OAJ || '',
      matches
    });
  }
  return tournaments;
}

/**
 * Identifies which KickPredict competition code matches the tournament.
 * Supports: PL, PD, BL1, SA, FL1, CL, TUN
 */
function identifyCompetition(tournament) {
  const name = String(tournament.name || '').toLowerCase();
  const country = String(tournament.country || '').toLowerCase();
  const url = String(tournament.url || '').toLowerCase();

  // Premier League (England)
  if (
    url === '/football/england/premier-league/' ||
    (country === 'england' && (name === 'england: premier league' || name.startsWith('england: premier league -')) &&
     !name.includes('cup') && !name.includes('u18') && !name.includes('u21') && !name.includes('2'))
  ) {
    return 'PL';
  }

  // LaLiga (Spain)
  if (
    url === '/football/spain/laliga/' ||
    (country === 'spain' && (name.includes('laliga') || name.includes('la liga')) && !name.includes('laliga2') && !name.includes('2'))
  ) {
    return 'PD';
  }

  // Bundesliga (Germany)
  if (
    url === '/football/germany/bundesliga/' ||
    (country === 'germany' && name.includes('bundesliga') && !name.includes('women') && !name.includes('2.') && !name.includes('u19'))
  ) {
    return 'BL1';
  }

  // Serie A (Italy)
  if (
    url === '/football/italy/serie-a/' ||
    (country === 'italy' && name.includes('serie a') && !name.includes('women') && !name.includes('serie b') && !name.includes('primavera'))
  ) {
    return 'SA';
  }

  // Ligue 1 (France)
  if (
    url === '/football/france/ligue-1/' ||
    (country === 'france' && name.includes('ligue 1') && !name.includes('women') && !name.includes('ligue 2'))
  ) {
    return 'FL1';
  }

  // Champions League (Europe)
  if (
    url.includes('/champions-league/') ||
    (name.includes('champions league') && (country === 'europe' || url.includes('/europe/')) && !name.includes('women') && !name.includes('caf') && !name.includes('afc') && !name.includes('concacaf'))
  ) {
    return 'CL';
  }

  // Tunisian Ligue Professionnelle 1
  if (
    url.includes('/tunisia/ligue-professionnelle-1/') ||
    (country === 'tunisia' && (name.includes('ligue professionnelle 1') || name.includes('ligue 1'))) ||
    tournament.tournamentId === 'lfv2BGo7'
  ) {
    return 'TUN';
  }

  return null;
}

/**
 * Maps Flashscore status codes (AB / AC) to internal KickPredict match status.
 */
function mapFlashscoreStatus(match) {
  if (!match) return 'SCHEDULED';

  const ab = String(match.AB ?? '').trim();
  const ac = String(match.AC ?? '').trim();
  const matchType = String(match.type ?? '').toLowerCase();
  const ep = String(match.EP ?? '').toLowerCase();

  // 1. Postponed checks (only when explicitly marked postponed or delayed)
  if (
    ab === '4' ||
    matchType === 'postponed' ||
    ep.includes('postp')
  ) {
    return 'POSTPONED';
  }

  // 2. Cancelled / Abandoned checks
  if (
    ac === '12' || ac === '13' || ac === '30' ||
    matchType === 'canceled' || matchType === 'cancelled' ||
    ep.includes('cancel')
  ) {
    return 'CANCELLED';
  }

  // 3. Finished checks (including after extra time / penalties / full time)
  if (
    ab === '3' ||
    ac === '3' ||
    ac === '10' || // After Extra Time
    ac === '11' || // After Penalties
    matchType === 'finished' ||
    match.code === 100 ||
    ep.includes('finish') ||
    ep.includes('aet') ||
    ep.includes('ap') ||
    ep.includes('pen') ||
    ep === 'ft'
  ) {
    return 'FINISHED';
  }

  // 4. Primary status by AB
  if (ab === '1') {
    return 'SCHEDULED';
  }

  if (ab === '2') {
    return ac === '17' ? 'PAUSED' : 'IN_PLAY';
  }

  // 5. Halftime / Paused checks
  if (ac === '17' || ac === '18' || ac === '19' || match.code === 7 || matchType === 'paused' || ep.includes('half')) {
    return 'PAUSED';
  }

  // 6. Live / In-play checks
  if (ac === '1' || ac === '2' || matchType === 'inprogress') {
    return 'IN_PLAY';
  }

  return 'SCHEDULED';
}

/**
 * Extracts scores and half-time scores from a Flashscore match.
 */
function parseFlashscoreScore(matchOrHome, awayOrStatus, statusParam) {
  if (matchOrHome === null || matchOrHome === undefined) {
    return { home: null, away: null, homeHt: null, awayHt: null };
  }

  // Flashscore match object
  if (typeof matchOrHome === 'object' && ('id' in matchOrHome || 'AB' in matchOrHome || 'AE' in matchOrHome)) {
    const m = matchOrHome;
    const status = awayOrStatus || mapFlashscoreStatus(m);
    const isLiveOrFinished = status === 'IN_PLAY' || status === 'PAUSED' || status === 'FINISHED';

    let home = null;
    let away = null;
    let homeHt = null;
    let awayHt = null;

    if (isLiveOrFinished) {
      if (m.AG !== undefined && m.AG !== null && m.AG !== '') {
        const parsed = parseInt(m.AG, 10);
        if (!isNaN(parsed) && parsed >= 0) home = parsed;
      }
      if (m.AH !== undefined && m.AH !== null && m.AH !== '') {
        const parsed = parseInt(m.AH, 10);
        if (!isNaN(parsed) && parsed >= 0) away = parsed;
      }
      if (m.BA !== undefined && m.BA !== null && m.BA !== '') {
        const parsed = parseInt(m.BA, 10);
        if (!isNaN(parsed) && parsed >= 0) homeHt = parsed;
      }
      if (m.BB !== undefined && m.BB !== null && m.BB !== '') {
        const parsed = parseInt(m.BB, 10);
        if (!isNaN(parsed) && parsed >= 0) awayHt = parsed;
      }
    }
    return { home, away, homeHt, awayHt };
  }

  // Numeric direct parameters: (homeScore, awayScore, status)
  const homeArg = matchOrHome;
  const awayArg = awayOrStatus;
  const status = statusParam;
  const isLiveOrFinished = status === 'IN_PLAY' || status === 'PAUSED' || status === 'FINISHED';

  const extractNum = (val) => {
    if (typeof val === 'number') return val >= 0 ? val : null;
    if (typeof val === 'string' && val.trim() !== '') {
      const p = parseInt(val, 10);
      return !isNaN(p) && p >= 0 ? p : null;
    }
    if (val && typeof val === 'object') {
      const p = val.current ?? val.display ?? val.score;
      return typeof p === 'number' && p >= 0 ? p : null;
    }
    return null;
  };

  const extractPeriod1 = (val) => {
    if (val && typeof val === 'object' && typeof val.period1 === 'number' && val.period1 >= 0) {
      return val.period1;
    }
    return null;
  };

  return {
    home: isLiveOrFinished ? extractNum(homeArg) : null,
    away: isLiveOrFinished ? extractNum(awayArg) : null,
    homeHt: isLiveOrFinished ? extractPeriod1(homeArg) : null,
    awayHt: isLiveOrFinished ? extractPeriod1(awayArg) : null
  };
}

/**
 * Extracts round and matchday information from a Flashscore match.
 */
function roundInfoFromFlashscore(match) {
  const roundStr = String(match?.ER || match?.roundName || '').trim();
  const matchNum = roundStr.match(/\d+/);
  if (matchNum) {
    const num = parseInt(matchNum[0], 10);
    return {
      stage: 'REGULAR_SEASON',
      matchday: num,
      key: `MD:${num}`,
      label: `Matchday ${num}`
    };
  }

  return {
    stage: 'REGULAR_SEASON',
    matchday: null,
    key: 'REGULAR_SEASON',
    label: roundStr || 'Matchday'
  };
}

/**
 * Parses Flashscore live match statistics (e.g. Possession, Shots, Fouls, xG).
 */
function parseFlashscoreStats(rawText) {
  if (!rawText) return [];
  const items = [];
  const parts = rawText.split('~SD÷').slice(1);
  for (const p of parts) {
    const fields = {};
    for (const item of p.split('¬')) {
      const idx = item.indexOf('÷');
      if (idx !== -1) fields[item.slice(0, idx)] = item.slice(idx + 1);
    }
    if (fields.SG) {
      items.push({
        name: fields.SG,
        home: fields.SH || '0',
        away: fields.SI || '0'
      });
    }
  }
  return items;
}

/**
 * Parses Flashscore match incidents (goals, cards, substitutions).
 */
function parseFlashscoreIncidents(rawText) {
  if (!rawText) return [];
  const incidents = [];
  const parts = rawText.split('~III÷').slice(1);
  for (const p of parts) {
    const fields = {};
    for (const item of p.split('¬')) {
      const idx = item.indexOf('÷');
      if (idx !== -1) fields[item.slice(0, idx)] = item.slice(idx + 1);
    }
    if (fields.IB || fields.IF) {
      incidents.push({
        minute: fields.IB || '',
        player: fields.IF || '',
        type: fields.IK || 'Incident',
        team: fields.IA === '1' ? 'home' : (fields.IA === '2' ? 'away' : 'neutral'),
        detail: fields.IL || ''
      });
    }
  }
  return incidents;
}

/**
 * Array subclass with fuzzy includes support (for backwards compatibility with tests checking player names).
 */
class PlayersArray extends Array {
  includes(val) {
    if (super.includes(val)) return true;
    return this.some((p) => (typeof p === 'string' ? p === val : p?.name === val));
  }
}

/**
 * Parses Flashscore match lineups (formations, managers, starting 11 with photo URLs, ratings, and subs).
 */
function parseFlashscoreLineups(rawText) {
  if (!rawText) return null;

  const formationMatches = [...rawText.matchAll(/LD÷([^¬]+)/g)].map((m) => m[1].replace(/^1-/, '').trim());
  const formationHome = formationMatches[0] || '4-3-3';
  const formationAway = formationMatches[1] || '4-3-3';

  const items = rawText.split('~');
  let currentSection = 'starting';
  let currentTeam = 1;

  const startingHome = new PlayersArray();
  const startingAway = new PlayersArray();
  const subsHome = new PlayersArray();
  const subsAway = new PlayersArray();
  let managerHome = null;
  let managerAway = null;

  let hasExplicitSections = false;

  for (const item of items) {
    if (!item.trim()) continue;
    const fields = {};
    for (const piece of item.split('¬')) {
      const idx = piece.indexOf('÷');
      if (idx !== -1) {
        fields[piece.slice(0, idx)] = piece.slice(idx + 1);
      }
    }

    if (fields.LB) {
      hasExplicitSections = true;
      const lb = fields.LB.toLowerCase();
      if (lb.includes('starting') || fields.LA === 'Formation') {
        currentSection = 'starting';
      } else if (lb.includes('substitute')) {
        currentSection = 'subs';
      } else if (lb.includes('coach')) {
        currentSection = 'coaches';
      }
    }

    if (fields.LC) {
      const parsedTeam = parseInt(fields.LC, 10);
      if (parsedTeam === 1 || parsedTeam === 2) {
        currentTeam = parsedTeam;
      }
    }

    if (fields.LI) {
      const pName = fields.LI.trim();
      const pNum = fields.LJ ? parseInt(fields.LJ, 10) : null;
      const photoKey = fields.LPI || fields.LPL || fields.LPX || null;
      const pPhoto = photoKey ? `https://static.flashscore.com/res/image/data/${photoKey.trim()}` : null;
      const pRating = fields.LPR ? fields.LPR.trim() : null;
      const pId = fields.LP ? fields.LP.trim() : null;
      const slot = fields.LL ? parseInt(fields.LL, 10) : 99;
      const isGK = fields.LG === '3' || fields.LL === '1' || pNum === 1;

      const pEvents = [];
      if (fields.LIN) {
        const linLower = fields.LIN.toLowerCase();
        if (linLower.includes('yellow')) pEvents.push({ type: 'yellow_card', minute: fields.LIT || '' });
        else if (linLower.includes('red')) pEvents.push({ type: 'red_card', minute: fields.LIT || '' });
        else if (linLower.includes('goal')) pEvents.push({ type: 'goal', minute: fields.LIT || '' });
        else if (fields.LII === '6' || linLower.includes('substitut')) pEvents.push({ type: 'sub', minute: fields.LIT || '' });
      }

      if (currentSection === 'coaches') {
        if (currentTeam === 1) managerHome = pName;
        else managerAway = pName;
      } else if (currentSection === 'subs') {
        const subObj = { id: pId, name: pName, num: pNum, photo: pPhoto, rating: pRating, slot, pos: 'SUB', events: pEvents };
        if (currentTeam === 1) subsHome.push(subObj);
        else subsAway.push(subObj);
      } else {
        const playerObj = { id: pId, name: pName, num: pNum, photo: pPhoto, rating: pRating, slot, pos: isGK ? 'GK' : 'PL', events: pEvents };
        if (!hasExplicitSections) {
          if (startingHome.length < 11) startingHome.push(playerObj);
          else startingAway.push(playerObj);
        } else {
          if (currentTeam === 1) startingHome.push(playerObj);
          else startingAway.push(playerObj);
        }
      }
    }
  }

  // Sort starting 11 by tactical slot (LL) so Goalkeeper (Slot 1) is index 0 and formation rows follow tactical order
  if (startingHome.length >= 11 && startingHome.some((p) => p.slot !== 99)) {
    startingHome.sort((a, b) => a.slot - b.slot);
  }
  if (startingAway.length >= 11 && startingAway.some((p) => p.slot !== 99)) {
    startingAway.sort((a, b) => a.slot - b.slot);
  }

  const assignPos = (list, form) => {
    const rows = form.split('-').map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
    if (rows.length === 0) rows.push(4, 3, 3);
    for (let i = 0; i < list.length; i++) {
      if (i === 0 || list[i].pos === 'GK') {
        list[i].pos = 'GK';
      } else {
        let cumulative = 1;
        for (let r = 0; r < rows.length; r++) {
          cumulative += rows[r];
          if (i < cumulative) {
            if (r === 0) list[i].pos = 'DF';
            else if (r === rows.length - 1) list[i].pos = 'FW';
            else list[i].pos = 'MF';
            break;
          }
        }
        if (!list[i].pos) list[i].pos = 'FW';
      }
    }
    return list;
  };

  assignPos(startingHome, formationHome);
  assignPos(startingAway, formationAway);

  console.log(`[Flashscore Parser] Parsed lineups: Home ${formationHome} (${startingHome.length} starting, ${subsHome.length} subs), Away ${formationAway} (${startingAway.length} starting, ${subsAway.length} subs)`);

  return {
    formationHome,
    formationAway,
    managerHome,
    managerAway,
    startingHome,
    startingAway,
    subsHome,
    subsAway
  };
}

/**
 * Fetches in-depth live match details (stats, incidents, lineups) for a specific match.
 */
async function fetchMatchLiveDetails(matchRawId, { fetcher = fetch } = {}) {
  if (!matchRawId) return { stats: [], incidents: [], lineups: null };
  const [stText, suiText, liText] = await Promise.allSettled([
    fetchFlashscoreFeed(`df_st_1_${matchRawId}`, { fetcher }),
    fetchFlashscoreFeed(`df_sui_1_${matchRawId}`, { fetcher }),
    fetchFlashscoreFeed(`df_li_1_${matchRawId}`, { fetcher })
  ]);

  console.log(`[Flashscore Details] Raw match feeds result for ${matchRawId}: st=${stText.status}, sui=${suiText.status}, li=${liText.status}`);
  if (liText.status === 'rejected') {
    console.warn(`[Flashscore Details] df_li_1_${matchRawId} feed rejected:`, liText.reason?.message);
  }

  const stats = stText.status === 'fulfilled' ? parseFlashscoreStats(stText.value) : [];
  const incidents = suiText.status === 'fulfilled' ? parseFlashscoreIncidents(suiText.value) : [];
  let lineups = liText.status === 'fulfilled' ? parseFlashscoreLineups(liText.value) : null;

  if (lineups) {
    console.log(`[Flashscore Details] Lineups successfully parsed for ${matchRawId}: ${lineups.startingHome.length} home, ${lineups.startingAway.length} away players.`);
  } else {
    console.warn(`[Flashscore Details] No lineups parsed for match ${matchRawId}.`);
  }

  // Cross-reference and attach incidents (goals, assists, cards, substitutions) to player profiles
  if (lineups && incidents.length > 0) {
    const matchPlayer = (p, inc) => {
      if (!p?.name || !inc?.player) return false;
      const pClean = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const incClean = inc.player.toLowerCase().replace(/[^a-z0-9]/g, '');
      return pClean === incClean || pClean.includes(incClean) || incClean.includes(pClean);
    };

    const enrichList = (list) => {
      return list.map((p) => {
        const existing = Array.isArray(p.events) ? [...p.events] : [];
        for (const inc of incidents) {
          if (matchPlayer(p, inc)) {
            const t = (inc.type || '').toLowerCase();
            let evType = null;
            if (t.includes('goal') && !t.includes('own goal')) evType = 'goal';
            else if (t.includes('own goal')) evType = 'own_goal';
            else if (t.includes('assist')) evType = 'assist';
            else if (t.includes('yellow')) evType = 'yellow_card';
            else if (t.includes('red')) evType = 'red_card';
            else if (t.includes('substitut')) evType = 'sub';

            if (evType && !existing.some((e) => e.type === evType && e.minute === inc.minute)) {
              existing.push({ type: evType, minute: inc.minute, detail: inc.detail });
            }
          }
        }
        return { ...p, events: existing };
      });
    };

    lineups = {
      ...lineups,
      startingHome: enrichList(lineups.startingHome),
      startingAway: enrichList(lineups.startingAway),
      subsHome: enrichList(lineups.subsHome),
      subsAway: enrichList(lineups.subsAway)
    };
  }

  return {
    stats,
    incidents,
    lineups
  };
}

// In-memory kick-off cache for scheduled fixtures
let scheduledFixturesCache = [];

/**
 * On-Boot Fetch & Midnight Cron Job:
 * 1. Called immediately when server starts (On-Boot).
 * 2. Called every midnight at 00:00 (Africa/Tunis time).
 * 3. Fetches 9-day window (yesterday -1 through +7 days ahead) for all competitions (PL, PD, BL1, SA, FL1, CL, TUN).
 * 4. Calculates Poisson probability points and saves fixtures in PostgreSQL.
 * 5. Handles scheduled, live, finished, postponed, and rescheduled matches gracefully.
 */
async function syncFlashscoreSchedule(pool, { fetcher = fetch, startDay = -1, endDay = 7, daysCount, settleFinishedMatches } = {}) {
  const actualStart = startDay !== undefined ? startDay : -1;
  const actualEnd = endDay !== undefined ? endDay : (daysCount !== undefined ? daysCount - 1 : 7);
  const totalDays = actualEnd - actualStart + 1;
  console.log(`[Flashscore Universal Sync] Fetching ${totalDays}-day fixtures schedule (${actualStart} to +${actualEnd}) for all competitions...`);

  try {
    const allMatchesMap = new Map();

    // Fetch daily feeds for window (default: -1 yesterday to +7 days ahead = 9 days)
    for (let dayOffset = actualStart; dayOffset <= actualEnd; dayOffset++) {
      try {
        const feedText = await fetchFlashscoreFeed(`f_1_${dayOffset}_2_en_1`, { fetcher });
        const tournaments = parseFlashscoreFeed(feedText);

        for (const t of tournaments) {
          const compCode = identifyCompetition(t);
          if (!compCode) continue;

          for (const m of t.matches) {
            if (m.id && !allMatchesMap.has(m.id)) {
              allMatchesMap.set(m.id, { ...m, competitionCode: compCode, tournamentName: t.name });
            }
          }
        }
      } catch (err) {
        console.warn(`[Flashscore Universal Sync] Failed fetching day offset ${dayOffset}:`, err.message);
      }
    }

    const matchesList = Array.from(allMatchesMap.values());
    console.log(`[Flashscore Universal Sync] Discovered ${matchesList.length} fixtures across ${totalDays} days.`);

    // Build Poisson expected ratings from finished matches per competition
    const finishedByComp = {};
    if (pool) {
      try {
        const { rows: dbFinished } = await pool.query(
          `SELECT home_score, away_score, external_id, competition_code
           FROM matches
           WHERE status = 'FINISHED'
             AND home_score IS NOT NULL
             AND away_score IS NOT NULL`
        );
        for (const row of dbFinished) {
          const c = row.competition_code || 'PL';
          if (!finishedByComp[c]) finishedByComp[c] = [];
          finishedByComp[c].push({
            homeId: Number(row.external_id) || 1,
            awayId: (Number(row.external_id) || 1) + 1,
            homeGoals: row.home_score,
            awayGoals: row.away_score
          });
        }
      } catch (err) {
        // fallback
      }
    }

    const modelsByComp = {};
    for (const [c, finished] of Object.entries(finishedByComp)) {
      modelsByComp[c] = teamRatings(finished);
    }

    let updatedCount = 0;
    const newCache = [];

    for (const m of matchesList) {
      const extId = flashscoreIdToBigInt(m.id);
      if (!Number.isSafeInteger(extId) || !m.AE || !m.AF || !m.AD) {
        continue;
      }

      const kickoffSec = parseInt(m.AD, 10);
      const kickoffIso = new Date(kickoffSec * 1000).toISOString();
      const compCode = m.competitionCode;
      const isTunisia = compCode === 'TUN';

      const homeTeam = isTunisia ? formatTunisianTeam(m.AE) : m.AE.trim();
      const awayTeam = isTunisia ? formatTunisianTeam(m.AF) : m.AF.trim();
      const homeCrest = getFlashscoreCrest(m.OA, homeTeam);
      const awayCrest = getFlashscoreCrest(m.OB, awayTeam);
      const status = mapFlashscoreStatus(m);
      const scores = parseFlashscoreScore(m, status);
      const round = roundInfoFromFlashscore(m);

      const compModel = modelsByComp[compCode] || teamRatings([]);
      const homeIdNum = m.PX ? flashscoreIdToBigInt(m.PX) : extId;
      const awayIdNum = m.PY ? flashscoreIdToBigInt(m.PY) : extId + 1;
      const { lambdaHome, lambdaAway } = matchLambdas(homeIdNum, awayIdNum, compModel);
      const markets = buildMatchMarketsPoints(lambdaHome, lambdaAway);

      newCache.push({
        id: extId,
        rawId: m.id,
        kickoff: kickoffIso,
        competitionCode: compCode,
        status,
        homeTeam,
        awayTeam
      });

      if (pool) {
        await pool.query(
          `INSERT INTO matches (
             external_id, flashscore_id, competition_code, stage, matchday, round_key, round_label,
             home_team, home_crest, away_team, away_crest, utc_date, status,
             home_score, away_score, home_ht, away_ht, home_lambda, away_lambda,
             markets_points, updated_at
           ) VALUES (
             $1, $2, $3, 'REGULAR_SEASON', $4, $5, $6,
             $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18, $19::jsonb, NOW()
           )
           ON CONFLICT (external_id) DO UPDATE SET
             flashscore_id = COALESCE(EXCLUDED.flashscore_id, matches.flashscore_id),
             competition_code = EXCLUDED.competition_code,
             stage = EXCLUDED.stage,
             matchday = EXCLUDED.matchday,
             round_key = EXCLUDED.round_key,
             round_label = EXCLUDED.round_label,
             home_team = EXCLUDED.home_team,
             home_crest = COALESCE(EXCLUDED.home_crest, matches.home_crest),
             away_team = EXCLUDED.away_team,
             away_crest = COALESCE(EXCLUDED.away_crest, matches.away_crest),
             utc_date = CASE WHEN matches.points_calculated THEN matches.utc_date ELSE EXCLUDED.utc_date END,
             status = CASE
               WHEN matches.points_calculated AND matches.utc_date < NOW() - INTERVAL '48 hours' THEN matches.status
               WHEN matches.points_calculated AND (EXCLUDED.status != 'FINISHED' OR EXCLUDED.home_score IS NULL OR EXCLUDED.away_score IS NULL) THEN matches.status
               ELSE EXCLUDED.status
             END,
             home_score = CASE
               WHEN matches.points_calculated AND matches.utc_date < NOW() - INTERVAL '48 hours' THEN matches.home_score
               WHEN matches.points_calculated AND (EXCLUDED.status != 'FINISHED' OR EXCLUDED.home_score IS NULL OR EXCLUDED.away_score IS NULL) THEN matches.home_score
               ELSE EXCLUDED.home_score
             END,
             away_score = CASE
               WHEN matches.points_calculated AND matches.utc_date < NOW() - INTERVAL '48 hours' THEN matches.away_score
               WHEN matches.points_calculated AND (EXCLUDED.status != 'FINISHED' OR EXCLUDED.home_score IS NULL OR EXCLUDED.away_score IS NULL) THEN matches.away_score
               ELSE EXCLUDED.away_score
             END,
             home_ht = CASE WHEN matches.points_calculated THEN matches.home_ht ELSE EXCLUDED.home_ht END,
             away_ht = CASE WHEN matches.points_calculated THEN matches.away_ht ELSE EXCLUDED.away_ht END,
             home_lambda = CASE WHEN EXCLUDED.status IN ('TIMED', 'SCHEDULED') THEN EXCLUDED.home_lambda ELSE matches.home_lambda END,
             away_lambda = CASE WHEN EXCLUDED.status IN ('TIMED', 'SCHEDULED') THEN EXCLUDED.away_lambda ELSE matches.away_lambda END,
             markets_points = CASE
               WHEN matches.points_calculated THEN matches.markets_points
               WHEN EXCLUDED.status IN ('TIMED', 'SCHEDULED') AND matches.odds_source = 'bookmaker' THEN matches.markets_points
               WHEN EXCLUDED.status IN ('TIMED', 'SCHEDULED') THEN EXCLUDED.markets_points
               ELSE COALESCE(matches.markets_points, EXCLUDED.markets_points)
             END,
             updated_at = NOW()`,
          [
            extId,
            m.id,
            compCode,
            round.matchday,
            round.key,
            round.label,
            homeTeam,
            homeCrest,
            awayTeam,
            awayCrest,
            kickoffIso,
            status,
            scores.home,
            scores.away,
            scores.homeHt,
            scores.awayHt,
            lambdaHome,
            lambdaAway,
            JSON.stringify(markets)
          ]
        );
        updatedCount++;
      }
    }

    scheduledFixturesCache = newCache;
    console.log(
      `[Flashscore Universal Sync] Sync complete: stored ${updatedCount} fixtures in PostgreSQL. Idling until live match window.`
    );

    if (typeof settleFinishedMatches === 'function') {
      try {
        await settleFinishedMatches();
      } catch (settleErr) {
        console.error('[Flashscore Universal Sync] Settlement error after schedule sync:', settleErr.message);
      }
    }

    return matchesList;
  } catch (err) {
    console.error('[Flashscore Universal Sync] Schedule sync error:', err.message);
    return [];
  }
}

let livePollingRunning = false;

/**
 * Smart Live Polling (every 2 minutes):
 * STRICT Gate Condition:
 * 1. Checks local database for any match currently in progress.
 * 2. If NO matches are live:
 *    Silently skips with ZERO network requests.
 * 3. If a match is live:
 *    Fetches live scores, incidents, and stats for that match only, updates database,
 *    and triggers auto-reconciliation and settlement.
 */
async function smartLivePolling(
  pool,
  { settleFinishedMatches, reconcileScoreCorrections, fetcher = fetch } = {}
) {
  if (livePollingRunning) return;
  livePollingRunning = true;

  try {
    // 1. Local Database Gate Condition:
    const { rows: activeMatches } = await pool.query(
      `SELECT id, external_id, flashscore_id, competition_code, home_team, away_team, utc_date, status, home_score, away_score,
              home_ht, away_ht, points_calculated
       FROM matches
       WHERE status IN ('IN_PLAY', 'PAUSED')
          OR (
            status IN ('TIMED', 'SCHEDULED')
            AND utc_date <= NOW()
            AND utc_date >= NOW() - INTERVAL '135 minutes'
          )
       ORDER BY utc_date ASC`
    );

    // If NO matches are live, ensure pending settlements are processed, then skip external network requests
    if (activeMatches.length === 0) {
      if (typeof settleFinishedMatches === 'function') {
        try {
          await settleFinishedMatches();
        } catch (settleErr) {
          console.error('[Flashscore Live Polling] Settlement error during idle gate check:', settleErr.message);
        }
      }
      return;
    }

    console.log(
      `[Flashscore Live Polling] Detected ${activeMatches.length} active/live matches in progress. Querying live feed...`
    );

    // 2. Fetch Day 0 feed (all updates for today's active matches)
    const feedText = await fetchFlashscoreFeed('f_1_0_2_en_1', { fetcher });
    const tournaments = parseFlashscoreFeed(feedText);

    // Index all matches from today's feed
    const feedMatchesMap = new Map();
    for (const t of tournaments) {
      for (const m of t.matches) {
        if (m.id) {
          const bigIntId = flashscoreIdToBigInt(m.id);
          feedMatchesMap.set(bigIntId, m);
          feedMatchesMap.set(m.id, m);
        }
      }
    }

    const updatedMatchRows = [];

    for (const match of activeMatches) {
      try {
        const bigIntId = Number(match.external_id);
        const m = feedMatchesMap.get(bigIntId) || feedMatchesMap.get(match.flashscore_id);
        if (!m) continue;

        const newStatus = mapFlashscoreStatus(m);
        const scores = parseFlashscoreScore(m, newStatus);

        const statusChanged = match.status !== newStatus;
        const scoreChanged =
          (scores.home !== null && scores.home !== match.home_score) ||
          (scores.away !== null && scores.away !== match.away_score);

        // Fetch detailed stats, incidents, and lineups specifically for this active match
        const details = await fetchMatchLiveDetails(m.id, { fetcher });

        if (statusChanged || scoreChanged || details.stats.length > 0 || details.incidents.length > 0 || details.lineups) {
          await pool.query(
            `UPDATE matches
             SET status = $1,
                 home_score = COALESCE($2, home_score),
                 away_score = COALESCE($3, away_score),
                 home_ht = COALESCE($4, home_ht),
                 away_ht = COALESCE($5, away_ht),
                 match_stats = COALESCE($6::jsonb, match_stats),
                 match_incidents = COALESCE($7::jsonb, match_incidents),
                 match_lineups = COALESCE($8::jsonb, match_lineups),
                 updated_at = NOW()
             WHERE id = $9`,
            [
              newStatus,
              scores.home,
              scores.away,
              scores.homeHt,
              scores.awayHt,
              details.stats.length > 0 ? JSON.stringify(details.stats) : null,
              details.incidents.length > 0 ? JSON.stringify(details.incidents) : null,
              details.lineups ? JSON.stringify(details.lineups) : null,
              match.id
            ]
          );

          if (statusChanged || scoreChanged) {
            updatedMatchRows.push({
              external_id: match.external_id,
              competition_code: match.competition_code,
              home_score: scores.home,
              away_score: scores.away,
              home_ht: scores.homeHt,
              away_ht: scores.awayHt,
              status: newStatus
            });
          }
        }
      } catch (err) {
        console.error(`[Flashscore Live Polling] Failed updating match ${match.external_id}:`, err.message);
      }
    }

    if (updatedMatchRows.length > 0) {
      console.log(`[Flashscore Live Polling] Updated ${updatedMatchRows.length} matches with live data.`);
      if (typeof reconcileScoreCorrections === 'function') {
        await reconcileScoreCorrections(updatedMatchRows);
      }
      if (typeof settleFinishedMatches === 'function') {
        await settleFinishedMatches();
      }
    }
  } catch (err) {
    console.error('[Flashscore Live Polling] Error:', err.message);
  } finally {
    livePollingRunning = false;
  }
}

/**
 * Ensures required database columns and tables exist for Flashscore and Standings sync.
 */
async function ensureFlashscoreColumns(pool) {
  try {
    await pool.query(`
      ALTER TABLE matches
        ADD COLUMN IF NOT EXISTS flashscore_id VARCHAR(32),
        ADD COLUMN IF NOT EXISTS match_stats JSONB,
        ADD COLUMN IF NOT EXISTS match_incidents JSONB,
        ADD COLUMN IF NOT EXISTS match_lineups JSONB;

      CREATE INDEX IF NOT EXISTS idx_matches_flashscore_id ON matches(flashscore_id);

      CREATE TABLE IF NOT EXISTS standings (
        competition_code VARCHAR(16) NOT NULL,
        team_name VARCHAR(128) NOT NULL,
        crest TEXT,
        rank INTEGER NOT NULL,
        played INTEGER NOT NULL DEFAULT 0,
        won INTEGER NOT NULL DEFAULT 0,
        drawn INTEGER NOT NULL DEFAULT 0,
        lost INTEGER NOT NULL DEFAULT 0,
        gf INTEGER NOT NULL DEFAULT 0,
        ga INTEGER NOT NULL DEFAULT 0,
        gd INTEGER NOT NULL DEFAULT 0,
        points INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (competition_code, team_name)
      );
      CREATE INDEX IF NOT EXISTS idx_standings_comp_rank ON standings(competition_code, rank ASC);
    `);
  } catch (err) {
    console.warn('[Flashscore] Column/table verification notice:', err.message);
  }
}

const STANDINGS_COMPS = [
  { code: 'TUN', id: 554, langId: 27 },
  { code: 'PL', id: 7, langId: 1 },
  { code: 'PD', id: 11, langId: 1 },
  { code: 'BL1', id: 25, langId: 1 },
  { code: 'SA', id: 17, langId: 1 },
  { code: 'FL1', id: 35, langId: 1 },
  { code: 'CL', id: 572, langId: 1 }
];

const TUN_365_TO_CANONICAL = {
  'اتحاد بن قردان': 'اتحاد بن قردان',
  'الاتحاد الرياضي ببن قردان': 'اتحاد بن قردان',
  'الترجي': 'الترجي الرياضي',
  'الترجي التونسي': 'الترجي الرياضي',
  'الاتحاد المنستيري': 'الاتحاد المنستيري',
  'الاتحاد الرياضي المنستيري': 'الاتحاد المنستيري',
  'النادي الأفريقي': 'النادي الإفريقي',
  'النادي الافريقي': 'النادي الإفريقي',
  'الإفريقي': 'النادي الإفريقي',
  'الافريقي': 'النادي الإفريقي',
  'التقدم الرياضي بساقية الداير': 'تقدم ساقية الدائر',
  'تقدم ساقية الداير': 'تقدم ساقية الدائر',
  'البنزرتي': 'النادي البنزرتي',
  'النادي البنزرتي': 'النادي البنزرتي',
  'الملعب التونسي': 'الملعب التونسي',
  'الشبيبة الرياضية بالعمران': 'شبيبة العمران',
  'شبيبة العمران': 'شبيبة العمران',
  'الصفاقسي': 'النادي الصفاقسي',
  'النادي الصفاقسي': 'النادي الصفاقسي',
  'النجم الساحلي': 'النجم الساحلي',
  'النجم الرياضي الساحلي': 'النجم الساحلي',
  'مستقبل المرسى': 'مستقبل المرسى',
  'المستقبل الرياضي بالمرسى': 'مستقبل المرسى',
  'الترجي الجرجيسي': 'الترجي الجرجيسي',
  'ترجي جرجيس': 'الترجي الجرجيسي',
  'النادي الرياضي لحمام الأنف': 'نادي حمام الأنف',
  'نادي حمام الأنف': 'نادي حمام الأنف',
  'الأولمبي الباجي': 'الأولمبي الباجي',
  'الاولمبي الباجي': 'الأولمبي الباجي',
  'النجم الرياضي بالمتلوي': 'نجم المتلوي',
  'نجم المتلوي': 'نجم المتلوي',
  'الأمل الرياضي بحمام سوسة': 'أمل حمام سوسة',
  'أمل حمام سوسة': 'أمل حمام سوسة',
  'مستقبل قابس': 'مستقبل قابس',
  'المستقبل الرياضي بقابس': 'مستقبل قابس',
  'قوافل قفصة': 'قوافل قفصة',
  'القوافل الرياضية بقفصة': 'قوافل قفصة',
  'مستقبل سليمان': 'مستقبل سليمان',
  'المستقبل الرياضي بسليمان': 'مستقبل سليمان',
  'As Soliman': 'مستقبل سليمان',
  'اتحاد تطاوين': 'اتحاد تطاوين',
  'الإتحاد الرياضي بتطاوين': 'اتحاد تطاوين',
  'الاتحاد الرياضي بتطاوين': 'اتحاد تطاوين'
};

const GLOBAL_TEAM_ALIASES = {
  'Manchester United': 'Manchester Utd',
  'Newcastle United': 'Newcastle',
  'Nottingham Forest': 'Nottingham',
  'Leeds United': 'Leeds',
  'Hull City': 'Hull',
  'Leicester City': 'Leicester',
  'Norwich City': 'Norwich',
  'Wolverhampton': 'Wolves',
  'Wolverhampton Wanderers': 'Wolves',
  'West Ham United': 'West Ham',
  'Sheffield United': 'Sheffield Utd',
  'FC Barcelona': 'Barcelona',
  'Atletico Madrid': 'Atl. Madrid',
  'Real Betis': 'Betis',
  'Athletic Bilbao': 'Ath Bilbao',
  'Borussia Dortmund': 'Dortmund',
  'FC Augsburg': 'Augsburg',
  'Borussia Mönchengladbach': 'B. Monchengladbach',
  'Inter Milan': 'Inter',
  'OGC Nice': 'Nice',
  'Olympique de Marseille': 'Marseille'
};

function normalizeStandingsTeam(rawName, compCode) {
  if (!rawName) return '';
  const trimmed = rawName.trim();
  if (compCode === 'TUN') {
    return TUN_365_TO_CANONICAL[trimmed] || formatTunisianTeam(trimmed);
  }
  return GLOBAL_TEAM_ALIASES[trimmed] || trimmed;
}

/**
 * Synchronizes official standings for supported competitions from 365Scores.
 */
async function syncStandings(pool, compFilter = null) {
  if (!pool) return;
  const targetComps = compFilter
    ? STANDINGS_COMPS.filter((c) => c.code === compFilter.toUpperCase())
    : STANDINGS_COMPS;

  if (targetComps.length === 0) return;

  try {
    const { rows: teamCrestRows } = await pool.query(
      `SELECT competition_code, home_team as team, home_crest as crest FROM matches WHERE home_crest IS NOT NULL
       UNION
       SELECT competition_code, away_team as team, away_crest as crest FROM matches WHERE away_crest IS NOT NULL`
    );
    const crestMap = new Map();
    for (const r of teamCrestRows) {
      crestMap.set(`${r.competition_code}:${r.team}`, r.crest);
    }

    for (const comp of targetComps) {
      try {
        const url = `https://webws.365scores.com/web/standings/?appTypeId=5&langId=${comp.langId}&competitions=${comp.id}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) {
          console.warn(`[Standings] HTTP ${res.status} for ${comp.code}`);
          continue;
        }
        const data = await res.json();
        const rows = data.standings?.[0]?.rows || [];
        if (rows.length === 0) continue;

        for (const r of rows) {
          const rawName = r.competitor?.name;
          const normName = normalizeStandingsTeam(rawName, comp.code);
          if (!normName) continue;

          let crest = MASTER_CRESTS[normName] || crestMap.get(`${comp.code}:${normName}`) || null;

          await pool.query(
            `INSERT INTO standings (
              competition_code, team_name, crest, rank, played, won, drawn, lost, gf, ga, gd, points, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
            ON CONFLICT (competition_code, team_name) DO UPDATE SET
              crest = COALESCE(EXCLUDED.crest, standings.crest),
              rank = EXCLUDED.rank,
              played = EXCLUDED.played,
              won = EXCLUDED.won,
              drawn = EXCLUDED.drawn,
              lost = EXCLUDED.lost,
              gf = EXCLUDED.gf,
              ga = EXCLUDED.ga,
              gd = EXCLUDED.gd,
              points = EXCLUDED.points,
              updated_at = NOW()`,
            [
              comp.code,
              normName,
              crest,
              r.position || 0,
              r.gamePlayed || 0,
              r.gamesWon || 0,
              r.gamesEven || 0,
              r.gamesLost || 0,
              r.for || 0,
              r.against || 0,
              r.ratio || 0,
              r.points || 0
            ]
          );
        }
        console.log(`[Standings] Synced ${rows.length} teams for ${comp.code}.`);
      } catch (cErr) {
        console.warn(`[Standings] Notice syncing ${comp.code}:`, cErr.message);
      }
    }
  } catch (err) {
    console.warn('[Standings] Sync notice:', err.message);
  }
}

/**
 * Initializes the unified Universal Flashscore Sync provider for ALL competitions:
 * 1. Immediate On-Boot Fetch of 9-day fixtures schedule (-1 to +7 days).
 * 2. Midnight Cron Job (00:00 Africa/Tunis time) daily.
 * 3. Smart Live Polling every 2 minutes with local database gate.
 */
function initFlashscoreSync({ pool, cron, settleFinishedMatches, reconcileScoreCorrections }) {
  console.log('[Flashscore] Initialized Universal provider for all competitions (On-Boot + Midnight Cron + Smart 2m Polling).');

  // 1. Immediate On-Boot Fetch (Server Start)
  (async () => {
    try {
      await ensureFlashscoreColumns(pool);
      await syncFlashscoreSchedule(pool, { startDay: -1, endDay: 7, settleFinishedMatches });
      await syncStandings(pool);
      if (typeof settleFinishedMatches === 'function') {
        await settleFinishedMatches();
      }
    } catch (err) {
      console.error('[Flashscore] On-Boot fetch error:', err.message);
    }
  })();

  // 2. Midnight Cron Job at 00:00 Africa/Tunis time
  cron.schedule(
    '0 0 * * *',
    () => {
      console.log('[Flashscore] Midnight Cron Job triggered: refreshing 9-day fixtures schedule (-1 to +7 days) for all leagues...');
      syncFlashscoreSchedule(pool, { startDay: -1, endDay: 7, settleFinishedMatches })
        .then(() => syncStandings(pool))
        .then(() => (typeof settleFinishedMatches === 'function' ? settleFinishedMatches() : null))
        .catch((err) => {
          console.error('[Flashscore] Midnight Cron error:', err.message);
        });
    },
    { timezone: 'Africa/Tunis' }
  );

  // 3. Smart Live Polling every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    smartLivePolling(pool, { settleFinishedMatches, reconcileScoreCorrections }).catch((err) => {
      console.error('[Flashscore Live Polling] Scheduled cycle error:', err.message);
    });
  });

  console.log('[Flashscore] Active: Midnight Cron (00:00 Africa/Tunis) & Smart Polling (2m gate).');
}

module.exports = {
  initFlashscoreSync,
  syncFlashscoreSchedule,
  syncStandings,
  smartLivePolling,
  fetchFlashscoreFeed,
  parseFlashscoreFeed,
  parseFlashscoreStats,
  parseFlashscoreIncidents,
  parseFlashscoreLineups,
  fetchMatchLiveDetails,
  flashscoreIdToBigInt,
  bigIntToFlashscoreId,
  identifyCompetition,
  mapFlashscoreStatus,
  parseFlashscoreScore,
  roundInfoFromFlashscore,
  getFlashscoreCrest,
  formatTunisianTeam,
  ensureFlashscoreColumns,
  // Aliases for backward compatibility
  syncTunisianLeague: syncFlashscoreSchedule,
  smartPollTunisia: smartLivePolling,
  initTunisiaSync: initFlashscoreSync
};
