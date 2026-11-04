'use strict';

/**
 * FotMob Integration Module for Match Lineups & Player Headshots
 * Provides high-resolution player photos via images.fotmob.com and
 * maps FotMob lineup payloads into KickPredict's tactical roster contract.
 */

const { teamRatings, matchLambdas, buildMatchMarketsPoints } = require('./pricingEngine');
const { MASTER_CRESTS } = require('./team-crests-master');

const FOTMOB_API_BASE = 'https://www.fotmob.com/api';
const FOTMOB_IMAGE_BASE = 'https://images.fotmob.com/image_resources/playerimages';

const FOTMOB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
  'Referer': 'https://www.fotmob.com/',
  'Origin': 'https://www.fotmob.com'
};

const TEAM_ALIASES = {
  psg: 'parissaintgermain',
  parissg: 'parissaintgermain',
  mancity: 'manchestercity',
  manunited: 'manchesterunited',
  manutd: 'manchesterunited',
  manchesterutd: 'manchesterunited',
  wolves: 'wolverhampton',
  spurs: 'tottenhamhotspur',
  tottenham: 'tottenhamhotspur',
  atletico: 'atleticomadrid',
  atlmadrid: 'atleticomadrid',
  atleticomadrid: 'atleticomadrid',
  barca: 'barcelona',
  bayern: 'bayernmunchen',
  bayernmunich: 'bayernmunchen',
  bayernmunchen: 'bayernmunchen',
  dortmund: 'borussiadortmund',
  bvb: 'borussiadortmund',
  borussiadortmund: 'borussiadortmund',
  betis: 'realbetis',
  realbetis: 'realbetis',
  psv: 'psveindhoven',
  psveindhoven: 'psveindhoven',
  inter: 'internazionale',
  intermilan: 'internazionale',
  milan: 'acmilan',
  acmilan: 'acmilan',
  juve: 'juventus',
  juventus: 'juventus',
  leverkusen: 'bayerleverkusen',
  bayerleverkusen: 'bayerleverkusen',
  bayer04leverkusen: 'bayerleverkusen',
  sporting: 'sportingcp',
  sportingcp: 'sportingcp',
  sportinglisbon: 'sportingcp',
  newcastle: 'newcastleunited',
  newcastleutd: 'newcastleunited',
  astonvilla: 'astonvilla',
  stuttgart: 'vfbstuttgart',
  vfbstuttgart: 'vfbstuttgart',
  frankfurt: 'eintrachtfrankfurt',
  eintrachtfrankfurt: 'eintrachtfrankfurt',
  leipzig: 'rbleipzig',
  rbleipzig: 'rbleipzig',
  roma: 'asroma',
  asroma: 'asroma',
  bilbao: 'athleticclub',
  athbilbao: 'athleticclub',
  athleticbilbao: 'athleticclub',
  athleticclub: 'athleticclub',
  depacoruna: 'deportivolacoruna',
  deportivo: 'deportivolacoruna',
  deportivolacoruna: 'deportivolacoruna',
  deportivoacoruna: 'deportivolacoruna',
  realsociedad: 'realsociedad',
  sociedad: 'realsociedad'
};

/**
 * Normalizes team name for fuzzy matching across providers
 */
function cleanTeamName(name) {
  if (!name || typeof name !== 'string') return '';
  const pre = name
    .toLowerCase()
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[œŒ]/g, 'oe')
    .replace(/[ß]/g, 'ss')
    .replace(/[ðÐ]/g, 'd')
    .replace(/[þÞ]/g, 'th')
    .replace(/\butd\b/g, 'united')
    .replace(/[\.]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  if (TEAM_ALIASES[pre]) return TEAM_ALIASES[pre];

  // Strip prefixes / suffixes like fc, cf, afc, ac, sc, as, fk, kv if not sole identifier
  let cleaned = pre
    .replace(/^(fc|cf|afc|ac|sc|as|vfb|rb|fk)/, '')
    .replace(/(fc|cf|afc|sc|fk|kv)$/, '');

  if (cleaned.length < 3) cleaned = pre;

  return TEAM_ALIASES[cleaned] || TEAM_ALIASES[pre] || cleaned;
}

/**
 * Checks whether two team name strings match
 */
function teamsMatch(nameA, nameB) {
  const cleanA = cleanTeamName(nameA);
  const cleanB = cleanTeamName(nameB);
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  if (cleanA.length >= 4 && cleanB.length >= 4) {
    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;
  }
  return false;
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
 * Maps FotMob tournament/league payload to KickPredict competition code
 * Supported: CL, PL, PD, BL1, SA, FL1, TUN
 */
function identifyFotmobCompetition(league) {
  if (!league) return null;
  const pId = league.primaryId || league.parentLeagueId || league.id;
  const idStr = String(pId);
  const name = (league.name || '').trim();
  const lowerName = name.toLowerCase();
  const ccode = (league.ccode || '').toUpperCase();

  // Exclude youth, women, and reserve competitions
  if (
    lowerName.includes('women') ||
    lowerName.includes('femm') ||
    lowerName.includes('u19') ||
    lowerName.includes('u21') ||
    lowerName.includes('youth') ||
    lowerName.includes('reserve')
  ) {
    return null;
  }

  // 1. Champions League (CL)
  if (
    idStr === '42' ||
    ((name === 'Champions League' || name === 'UEFA Champions League') && ccode === 'INT')
  ) {
    return 'CL';
  }

  // 2. Premier League (PL)
  if (
    idStr === '47' ||
    (name === 'Premier League' && ccode === 'ENG')
  ) {
    return 'PL';
  }

  // 3. La Liga (PD)
  if (
    idStr === '87' ||
    ((name === 'LaLiga' || name === 'La Liga' || name === 'Primera División') && ccode === 'ESP')
  ) {
    return 'PD';
  }

  // 4. Bundesliga (BL1)
  if (
    idStr === '54' ||
    (name === 'Bundesliga' && ccode === 'GER')
  ) {
    return 'BL1';
  }

  // 5. Serie A (SA)
  if (
    idStr === '55' ||
    (name === 'Serie A' && ccode === 'ITA')
  ) {
    return 'SA';
  }

  // 6. Ligue 1 (FL1)
  if (
    idStr === '53' ||
    (name === 'Ligue 1' && ccode === 'FRA')
  ) {
    return 'FL1';
  }

  // 7. Tunisian Ligue Professionnelle 1 (TUN)
  if (
    idStr === '326' ||
    idStr === '544' ||
    idStr === '943985' ||
    ccode === 'TUN' ||
    (lowerName.includes('tunis') && (lowerName.includes('ligue') || lowerName.includes('professionnelle') || lowerName.includes('premiere') || lowerName.includes('ligue 1') || lowerName.includes('ligue i'))) ||
    (ccode === 'TUN' && (name === 'Ligue I' || name === 'Ligue 1' || name === 'Ligue Professionnelle 1'))
  ) {
    return 'TUN';
  }

  return null;
}

/**
 * Resolves team crest URL using MASTER_CRESTS dictionary first, falling back to FotMob CDN
 */
function getFotmobCrest(teamId, teamName) {
  if (teamName && MASTER_CRESTS && MASTER_CRESTS[teamName]) {
    return MASTER_CRESTS[teamName];
  }
  if (teamId) {
    return `https://images.fotmob.com/image_resources/logo/teamlogo/${teamId}.png`;
  }
  return null;
}

/**
 * Maps FotMob match status object to KickPredict status contract
 */
function mapFotmobMatchStatus(m) {
  const status = m?.status;
  const isFinished = Boolean(
    status?.finished === true ||
    status?.reason?.short === 'FT' ||
    status?.reason?.shortKey === 'fulltime_short' ||
    status?.reason?.longKey === 'finished' ||
    m?.statusId === 6 ||
    status?.reason?.short === 'AET' ||
    status?.reason?.short === 'Pen' ||
    status?.reason?.short === 'AP'
  );
  if (isFinished) return 'FINISHED';

  const isCancelled = Boolean(
    status?.cancelled === true ||
    status?.reason?.short === 'PP' ||
    status?.reason?.short === 'Can'
  );
  if (isCancelled) return 'CANCELLED';

  const isPaused = Boolean(
    status?.reason?.short === 'HT' ||
    status?.reason?.shortKey === 'halftime_short' ||
    status?.reason?.longKey === 'pause_match'
  );
  if (isPaused) return 'PAUSED';

  const isLive = Boolean(
    status?.started === true ||
    status?.ongoing === true ||
    m?.statusId === 2 ||
    m?.statusId === 3
  );
  if (isLive) return 'IN_PLAY';

  return 'TIMED';
}

/**
 * Maps FotMob player position IDs to KickPredict contract positions ('GK', 'DF', 'MF', 'FW')
 */
function mapFotmobPosition(usualPlayingPositionId, positionId, index) {
  if (usualPlayingPositionId === 0 || positionId === 11 || index === 0) return 'GK';
  if (usualPlayingPositionId === 1) return 'DF';
  if (usualPlayingPositionId === 2) return 'MF';
  if (usualPlayingPositionId === 3) return 'FW';
  return 'MF';
}

/**
 * Extracts and maps live match events (goals, cards, subs) onto players
 */
function extractPlayerEventsMap(matchFactsEvents) {
  const map = {};
  if (!Array.isArray(matchFactsEvents)) return map;

  for (const ev of matchFactsEvents) {
    const timeStr = `${ev.time || ev.timeStr || 0}'`;

    if (ev.type === 'Goal') {
      const pId = ev.player?.id || ev.playerId;
      if (pId) {
        if (!map[pId]) map[pId] = [];
        map[pId].push({ type: 'goal', minute: timeStr, detail: 'Goal' });
      }
    } else if (ev.type === 'Card') {
      const pId = ev.player?.id || ev.playerId;
      if (pId) {
        if (!map[pId]) map[pId] = [];
        map[pId].push({
          type: ev.card === 'Red' ? 'red_card' : 'yellow_card',
          minute: timeStr,
          detail: `${ev.card || 'Yellow'} Card`
        });
      }
    } else if (ev.type === 'Substitution' && Array.isArray(ev.swap) && ev.swap.length >= 2) {
      // FotMob swap convention: swap[0] is inPlayer, swap[1] is outPlayer
      const inPlayer = ev.swap[0];
      const outPlayer = ev.swap[1];

      if (outPlayer?.id) {
        if (!map[outPlayer.id]) map[outPlayer.id] = [];
        map[outPlayer.id].push({
          type: 'sub',
          minute: timeStr,
          detail: inPlayer?.name ? `Substituted by ${inPlayer.name}` : 'Sub Out'
        });
      }
      if (inPlayer?.id) {
        if (!map[inPlayer.id]) map[inPlayer.id] = [];
        map[inPlayer.id].push({
          type: 'sub_in',
          minute: timeStr,
          detail: outPlayer?.name ? `Came on for ${outPlayer.name}` : 'Sub In'
        });
      }
    }
  }

  return map;
}

/**
 * Extracts and normalizes match statistics from FotMob matchDetails payload
 * Looks into content.stats.Periods.All.stats or content.stats
 */
function parseFotmobStats(data) {
  if (!data || !data.content) return [];
  const groups = data.content?.stats?.Periods?.All?.stats || data.content?.stats || [];
  if (!Array.isArray(groups)) return [];

  const extracted = [];
  const seenTitles = new Set();

  for (const group of groups) {
    const statItems = Array.isArray(group?.stats) ? group.stats : [];
    for (const item of statItems) {
      if (!item || !item.title) continue;
      if (!Array.isArray(item.stats) || item.stats.length < 2) continue;

      const rawHome = item.stats[0];
      const rawAway = item.stats[1];
      if (rawHome === null || rawHome === undefined || rawAway === null || rawAway === undefined) continue;

      const title = item.title.trim();
      const titleKey = title.toLowerCase();
      if (seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);

      // Parse numerical values for comparison bars
      let homeNum = 0;
      let awayNum = 0;

      if (item.rawStats && item.rawStats[0]?.value != null && item.rawStats[1]?.value != null) {
        homeNum = parseFloat(item.rawStats[0].value) || 0;
        awayNum = parseFloat(item.rawStats[1].value) || 0;
      } else {
        homeNum = parseFloat(String(rawHome).replace('%', '').trim()) || 0;
        awayNum = parseFloat(String(rawAway).replace('%', '').trim()) || 0;
      }

      // Check if stat is percentage
      const isPercent = String(rawHome).includes('%') || String(rawAway).includes('%') || item.key === 'BallPossesion';
      const homeStr = isPercent && !String(rawHome).includes('%') ? `${rawHome}%` : String(rawHome);
      const awayStr = isPercent && !String(rawAway).includes('%') ? `${rawAway}%` : String(rawAway);

      extracted.push({
        name: title,
        key: item.key || titleKey,
        home: homeStr,
        away: awayStr,
        homeVal: homeNum,
        awayVal: awayNum,
        group: group.title || 'General'
      });
    }
  }

  return extracted;
}

/**
 * Parses raw FotMob matchDetails response into KickPredict unified roster contract
 */
function parseFotmobLineup(data) {
  if (!data || typeof data !== 'object') return null;

  const stats = parseFotmobStats(data);
  const lineup = data.content?.lineup || data.lineup;

  const homeTeam = lineup?.homeTeam;
  const awayTeam = lineup?.awayTeam;

  const rawHomeStarters = Array.isArray(homeTeam?.starters) ? homeTeam.starters : [];
  const rawAwayStarters = Array.isArray(awayTeam?.starters) ? awayTeam.starters : [];

  if (rawHomeStarters.length === 0 && stats.length === 0) {
    return null;
  }

  const rawHomeSubs = Array.isArray(homeTeam?.subs) ? homeTeam.subs : [];
  const rawAwaySubs = Array.isArray(awayTeam?.subs) ? awayTeam.subs : [];

  // Match events map
  const matchFactsEvents = data.content?.matchFacts?.events?.events || [];
  const eventsMap = extractPlayerEventsMap(matchFactsEvents);

  const formationHome = homeTeam?.formation || '4-3-3';
  const formationAway = awayTeam?.formation || '4-3-3';
  const managerHome = homeTeam?.coach?.name || null;
  const managerAway = awayTeam?.coach?.name || null;

  const startingHome = rawHomeStarters.map((p, idx) => ({
    id: p.id ? String(p.id) : `h-${idx + 1}`,
    name: p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || `Player ${idx + 1}`,
    num: parseInt(p.shirtNumber, 10) || (idx + 1),
    photo: p.id ? `${FOTMOB_IMAGE_BASE}/${p.id}.png` : null,
    rating: p.performance?.rating ? String(p.performance.rating) : null,
    slot: idx + 1,
    pos: mapFotmobPosition(p.usualPlayingPositionId, p.positionId, idx),
    events: eventsMap[p.id] || []
  }));

  const startingAway = rawAwayStarters.map((p, idx) => ({
    id: p.id ? String(p.id) : `a-${idx + 1}`,
    name: p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || `Player ${idx + 1}`,
    num: parseInt(p.shirtNumber, 10) || (idx + 1),
    photo: p.id ? `${FOTMOB_IMAGE_BASE}/${p.id}.png` : null,
    rating: p.performance?.rating ? String(p.performance.rating) : null,
    slot: idx + 1,
    pos: mapFotmobPosition(p.usualPlayingPositionId, p.positionId, idx),
    events: eventsMap[p.id] || []
  }));

  const subsHome = rawHomeSubs.map((p, idx) => ({
    id: p.id ? String(p.id) : `hs-${idx + 1}`,
    name: p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || `Sub ${idx + 1}`,
    num: parseInt(p.shirtNumber, 10) || (12 + idx),
    photo: p.id ? `${FOTMOB_IMAGE_BASE}/${p.id}.png` : null,
    rating: p.performance?.rating ? String(p.performance.rating) : null,
    pos: 'SUB',
    events: eventsMap[p.id] || []
  }));

  const subsAway = rawAwaySubs.map((p, idx) => ({
    id: p.id ? String(p.id) : `as-${idx + 1}`,
    name: p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || `Sub ${idx + 1}`,
    num: parseInt(p.shirtNumber, 10) || (12 + idx),
    photo: p.id ? `${FOTMOB_IMAGE_BASE}/${p.id}.png` : null,
    rating: p.performance?.rating ? String(p.performance.rating) : null,
    pos: 'SUB',
    events: eventsMap[p.id] || []
  }));

  const homeRoster = {
    formation: formationHome,
    manager: managerHome,
    starting: startingHome,
    subs: subsHome
  };

  const awayRoster = {
    formation: formationAway,
    manager: managerAway,
    starting: startingAway,
    subs: subsAway
  };

  const headerTeams = Array.isArray(data.header?.teams) ? data.header.teams : [];
  let homeScore = headerTeams[0]?.score != null ? Number(headerTeams[0].score) : null;
  let awayScore = headerTeams[1]?.score != null ? Number(headerTeams[1].score) : null;

  const headerStatus = data.header?.status;
  if ((homeScore == null || awayScore == null) && typeof headerStatus?.scoreStr === 'string' && headerStatus.scoreStr.includes('-')) {
    const parts = headerStatus.scoreStr.split('-').map((s) => parseInt(s.trim(), 10));
    if (!isNaN(parts[0]) && !isNaN(parts[1])) {
      homeScore = parts[0];
      awayScore = parts[1];
    }
  }

  const isFinished = Boolean(
    headerStatus?.finished === true ||
    headerStatus?.reason?.short === 'FT' ||
    headerStatus?.reason?.shortKey === 'fulltime_short' ||
    headerStatus?.reason?.longKey === 'finished' ||
    data.header?.statusId === 6 ||
    headerStatus?.reason?.short === 'AET' ||
    headerStatus?.reason?.short === 'Pen' ||
    headerStatus?.reason?.short === 'AP'
  );
  const isPaused = Boolean(
    headerStatus?.reason?.short === 'HT' ||
    headerStatus?.reason?.shortKey === 'halftime_short' ||
    headerStatus?.reason?.longKey === 'pause_match'
  );
  const isCancelled = Boolean(
    headerStatus?.cancelled === true ||
    headerStatus?.reason?.short === 'PP' ||
    headerStatus?.reason?.short === 'Can'
  );
  const isLive = !isFinished && !isCancelled && Boolean(
    headerStatus?.started === true ||
    headerStatus?.ongoing === true
  );
  const liveClock = headerStatus?.liveTime?.short || headerStatus?.reason?.short || (isFinished ? 'FT' : null);

  return {
    source: 'fotmob',
    confirmed: Boolean(lineup.lineupType === 'confirmed' || startingHome.length >= 7),
    formationHome,
    formationAway,
    managerHome,
    managerAway,
    startingHome,
    startingAway,
    subsHome,
    subsAway,
    homeRoster,
    awayRoster,
    scores: {
      home: homeScore,
      away: awayScore
    },
    status: isFinished ? 'FINISHED' : (isCancelled ? 'CANCELLED' : (isPaused ? 'PAUSED' : (isLive ? 'IN_PLAY' : null))),
    liveClock,
    stats
  };
}

/**
 * Safely parses response as JSON supporting both res.json() and res.text()
 */
async function safeParseJsonResponse(res) {
  if (!res) return null;
  if (typeof res.json === 'function') {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  if (typeof res.text === 'function') {
    try {
      const text = await res.text();
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Searches FotMob for match ID on a given date (with ±1 day fallback)
 */
async function findFotmobMatchId(homeTeam, awayTeam, matchDate, { fetcher = fetch } = {}) {
  if (!homeTeam || !awayTeam) return null;

  const targetDate = matchDate ? new Date(matchDate) : new Date();
  const baseDate = !isNaN(targetDate.getTime()) ? targetDate : new Date();

  // Generate target date string and adjacent dates for timezone offset robustness
  const datesToCheck = [];
  const toDateStr = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

  datesToCheck.push(toDateStr(baseDate));
  datesToCheck.push(toDateStr(new Date(baseDate.getTime() - 24 * 60 * 60 * 1000)));
  datesToCheck.push(toDateStr(new Date(baseDate.getTime() + 24 * 60 * 60 * 1000)));

  for (const dStr of datesToCheck) {
    const urls = [
      `${FOTMOB_API_BASE}/data/matches?date=${dStr}`,
      `${FOTMOB_API_BASE}/matches?date=${dStr}`
    ];

    for (const url of urls) {
      try {
        console.log(`[FotMob Finder] Querying ${url} for "${homeTeam}" vs "${awayTeam}"...`);
        const res = await fetcher(url, {
          headers: FOTMOB_HEADERS,
          signal: AbortSignal.timeout(8000)
        });

        if (res.ok) {
          const data = await safeParseJsonResponse(res);
          const leagues = Array.isArray(data?.leagues) ? data.leagues : [];

          for (const league of leagues) {
            const matches = Array.isArray(league.matches) ? league.matches : [];
            for (const m of matches) {
              const hName = m.home?.name || m.home?.shortName || '';
              const aName = m.away?.name || m.away?.shortName || '';

              const isMatch =
                (teamsMatch(hName, homeTeam) && teamsMatch(aName, awayTeam)) ||
                (teamsMatch(hName, awayTeam) && teamsMatch(aName, homeTeam));

              if (isMatch && m.id) {
                console.log(`[FotMob Finder] Match found! matchId: ${m.id} (${hName} vs ${aName}) on date ${dStr}`);
                return m.id;
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[FotMob Finder] Error querying ${url}:`, err.message);
      }
    }
  }

  return null;
}

/**
 * Main fetch function: Fetches and parses FotMob lineups for any fixture
 */
async function fetchFotmobLineup(homeTeam, awayTeam, matchDate, matchId = null, { fetcher = fetch } = {}) {
  let targetMatchId = matchId;
  if (!targetMatchId && homeTeam && awayTeam) {
    targetMatchId = await findFotmobMatchId(homeTeam, awayTeam, matchDate, { fetcher });
  }

  if (!targetMatchId) {
    console.warn(`[FotMob] No matchId found for "${homeTeam}" vs "${awayTeam}"`);
    return null;
  }

  const urls = [
    `${FOTMOB_API_BASE}/data/matchDetails?matchId=${targetMatchId}`,
    `${FOTMOB_API_BASE}/matchDetails?matchId=${targetMatchId}`
  ];

  for (const url of urls) {
    try {
      console.log(`[FotMob] Fetching match details from ${url}...`);
      const res = await fetcher(url, {
        headers: FOTMOB_HEADERS,
        signal: AbortSignal.timeout(8000)
      });

      if (res.ok) {
        const data = await safeParseJsonResponse(res);
        if (!data) continue;
        const parsed = parseFotmobLineup(data);
        if (parsed && (parsed.startingHome?.length > 0 || (Array.isArray(parsed.stats) && parsed.stats.length > 0))) {
          console.log(`[FotMob] Details successfully parsed for ${targetMatchId} (${parsed.startingHome?.length || 0} home starters, ${parsed.stats?.length || 0} stats)`);
          return parsed;
        }
      }
    } catch (err) {
      console.warn(`[FotMob] Fetch error from ${url}:`, err.message);
    }
  }

  return null;
}

let fotmobLivePollingRunning = false;

/**
 * Smart Live Polling via FotMob API:
 * 1. Queries PostgreSQL for active matches ('IN_PLAY', 'PAUSED', 'LIVE') or matches scheduled around now.
 * 2. Fetches https://www.fotmob.com/api/data/matches?date=YYYYMMDD (and /matches) for needed dates.
 * 3. Matches fixtures by fotmob_id or fuzzy team names.
 * 4. Updates home_score, away_score, status, and live_clock in PostgreSQL.
 * 5. Triggers settlement and score corrections when a match finishes.
 */
async function smartLivePollingFotmob(
  pool,
  { settleFinishedMatches, reconcileScoreCorrections, fetcher = fetch } = {}
) {
  if (fotmobLivePollingRunning) return;
  fotmobLivePollingRunning = true;

  try {
    // 1. Local Database Gate: Find matches needing live polling (including early lineups 75m before kickoff)
    const { rows: activeMatches } = await pool.query(
      `SELECT id, external_id, fotmob_id, flashscore_id, competition_code, home_team, away_team, utc_date, status, home_score, away_score,
              home_ht, away_ht, points_calculated, match_lineups, match_stats
       FROM matches
       WHERE (
            status NOT IN ('FINISHED', 'CANCELLED', 'POSTPONED')
            AND utc_date <= NOW() + INTERVAL '75 minutes'
            AND utc_date >= NOW() - INTERVAL '14 days'
          )
          OR (
            status = 'FINISHED'
            AND (home_score IS NULL OR away_score IS NULL OR points_calculated IS NOT TRUE)
            AND utc_date >= NOW() - INTERVAL '7 days'
          )
       ORDER BY utc_date ASC`
    );

    if (activeMatches.length === 0) {
      if (typeof settleFinishedMatches === 'function') {
        try {
          await settleFinishedMatches();
        } catch (settleErr) {
          console.error('[FotMob Live Polling] Settlement error during idle check:', settleErr.message);
        }
      }
      return;
    }

    console.log(`[FotMob Live Polling] Detected ${activeMatches.length} active/near matches. Fetching FotMob feeds...`);

    // 2. Identify required dates in YYYYMMDD format
    const toDateStr = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');
    const dateSet = new Set();
    dateSet.add(toDateStr(new Date())); // Today

    for (const m of activeMatches) {
      if (m.utc_date) {
        const d = new Date(m.utc_date);
        if (!isNaN(d.getTime())) {
          dateSet.add(toDateStr(d));
          dateSet.add(toDateStr(new Date(d.getTime() - 24 * 60 * 60 * 1000)));
          dateSet.add(toDateStr(new Date(d.getTime() + 24 * 60 * 60 * 1000)));
        }
      }
    }

    // 3. Fetch FotMob schedule for each unique date and collect all matches
    const fotmobMatches = [];
    for (const dStr of dateSet) {
      const urls = [
        `${FOTMOB_API_BASE}/data/matches?date=${dStr}`,
        `${FOTMOB_API_BASE}/matches?date=${dStr}`
      ];
      for (const url of urls) {
        try {
          const res = await fetcher(url, {
            headers: FOTMOB_HEADERS,
            signal: AbortSignal.timeout(8000)
          });
          if (res.ok) {
            const data = await safeParseJsonResponse(res);
            const leagues = Array.isArray(data?.leagues) ? data.leagues : [];
            for (const l of leagues) {
              const ms = Array.isArray(l.matches) ? l.matches : [];
              for (const m of ms) {
                fotmobMatches.push(m);
              }
            }
            break; // Stop after first working endpoint for this date
          }
        } catch (fetchErr) {
          console.warn(`[FotMob Live Polling] Error fetching ${url}:`, fetchErr.message);
        }
      }
    }

    console.log(`[FotMob Live Polling] Gathered ${fotmobMatches.length} fixtures from FotMob.`);

    // 4. Update each database match with real scores, status, and time
    let updatedCount = 0;
    const newlyFinishedMatches = [];

    for (const dbMatch of activeMatches) {
      try {
        const fm = fotmobMatches.find((m) => {
          if (dbMatch.fotmob_id && String(m.id) === String(dbMatch.fotmob_id)) return true;
          const hName = m.home?.name || m.home?.shortName || '';
          const aName = m.away?.name || m.away?.shortName || '';
          return (
            (teamsMatch(hName, dbMatch.home_team) && teamsMatch(aName, dbMatch.away_team)) ||
            (teamsMatch(hName, dbMatch.away_team) && teamsMatch(aName, dbMatch.home_team))
          );
        });

        if (!fm) continue;

        // Extract scores
        let homeScore = fm.home?.score != null ? Number(fm.home.score) : null;
        let awayScore = fm.away?.score != null ? Number(fm.away.score) : null;
        if ((homeScore == null || awayScore == null) && typeof fm.status?.scoreStr === 'string' && fm.status.scoreStr.includes('-')) {
          const parts = fm.status.scoreStr.split('-').map((s) => parseInt(s.trim(), 10));
          if (!isNaN(parts[0]) && !isNaN(parts[1])) {
            homeScore = parts[0];
            awayScore = parts[1];
          }
        }

        // Map status explicitly
        let newStatus = dbMatch.status;
        const isFin = Boolean(
          fm.status?.finished === true ||
          fm.status?.reason?.short === 'FT' ||
          fm.status?.reason?.shortKey === 'fulltime_short' ||
          fm.status?.reason?.longKey === 'finished' ||
          fm.statusId === 6 ||
          fm.status?.reason?.short === 'AET' ||
          fm.status?.reason?.short === 'Pen' ||
          fm.status?.reason?.short === 'AP'
        );
        const isPaused = Boolean(
          fm.status?.reason?.short === 'HT' ||
          fm.status?.reason?.shortKey === 'halftime_short' ||
          fm.status?.reason?.longKey === 'pause_match'
        );
        const isCancelled = Boolean(
          fm.status?.cancelled === true ||
          fm.status?.reason?.short === 'PP' ||
          fm.status?.reason?.short === 'Can'
        );
        const isOngoing = Boolean(
          fm.status?.ongoing === true ||
          (fm.status?.started === true && !fm.status?.finished)
        );

        if (isFin) {
          newStatus = 'FINISHED';
        } else if (isCancelled) {
          newStatus = 'CANCELLED';
        } else if (isPaused) {
          newStatus = 'PAUSED';
        } else if (isOngoing) {
          newStatus = 'IN_PLAY';
        }

        const scoreChanged =
          (homeScore !== null && homeScore !== dbMatch.home_score) ||
          (awayScore !== null && awayScore !== dbMatch.away_score);
        const statusChanged = newStatus !== dbMatch.status;

        if (scoreChanged || statusChanged || (!dbMatch.fotmob_id && fm.id)) {
          await pool.query(
            `UPDATE matches
             SET home_score = COALESCE($1, home_score),
                 away_score = COALESCE($2, away_score),
                 status = $3,
                 fotmob_id = COALESCE(fotmob_id, $4),
                 updated_at = NOW()
             WHERE id = $5`,
            [homeScore, awayScore, newStatus, fm.id, dbMatch.id]
          );

          updatedCount++;
          console.log(
            `[FotMob Live Polling] Match ${dbMatch.id} (${dbMatch.home_team} vs ${dbMatch.away_team}) updated: status=${newStatus}, score=${homeScore}-${awayScore} (fotmobId: ${fm.id})`
          );

          if (newStatus === 'FINISHED' && dbMatch.status !== 'FINISHED') {
            newlyFinishedMatches.push({ id: dbMatch.id, homeScore, awayScore });
          }

          if (scoreChanged && typeof reconcileScoreCorrections === 'function') {
            try {
              await reconcileScoreCorrections(dbMatch.id, homeScore, awayScore);
            } catch (reconErr) {
              console.error(`[FotMob Live Polling] Score reconciliation error for match ${dbMatch.id}:`, reconErr.message);
            }
          }
        }

        // Check if early official lineups or stats can be captured (within 75 mins of kickoff, live, or finished)
        const hasLineupsInDB = dbMatch.match_lineups && (
          (Array.isArray(dbMatch.match_lineups?.startingHome) && dbMatch.match_lineups.startingHome.length >= 7) ||
          (Array.isArray(dbMatch.match_lineups?.homeRoster?.starting) && dbMatch.match_lineups.homeRoster.starting.length >= 7)
        );
        const hasStatsInDB = Array.isArray(dbMatch.match_stats) && dbMatch.match_stats.length > 0;
        const kickoffNear = dbMatch.utc_date && (new Date(dbMatch.utc_date).getTime() - Date.now() <= 75 * 60 * 1000);

        if ((!hasLineupsInDB || !hasStatsInDB) && (kickoffNear || isOngoing || isFin)) {
          try {
            const details = await fetchFotmobLineup(dbMatch.home_team, dbMatch.away_team, dbMatch.utc_date, fm.id, { fetcher });
            if (details) {
              const hasUsableStarting = Array.isArray(details.startingHome) && details.startingHome.length >= 7;
              const hasUsableStats = Array.isArray(details.stats) && details.stats.length > 0;

              if (hasUsableStarting || hasUsableStats) {
                await pool.query(
                  `UPDATE matches
                   SET match_lineups = COALESCE($1::jsonb, match_lineups),
                       match_stats = COALESCE($2::jsonb, match_stats),
                       updated_at = NOW()
                   WHERE id = $3`,
                  [
                    hasUsableStarting ? JSON.stringify(details) : null,
                    hasUsableStats ? JSON.stringify(details.stats) : null,
                    dbMatch.id
                  ]
                );
                console.log(`[FotMob Live Polling] Saved details to DB for match ${dbMatch.id} (lineups: ${hasUsableStarting}, stats: ${hasUsableStats})`);
              }
            }
          } catch (lineupErr) {
            console.warn(`[FotMob Live Polling] Details sync error for match ${dbMatch.id}:`, lineupErr.message);
          }
        }
      } catch (matchErr) {
        console.error(`[FotMob Live Polling] Error processing match ${dbMatch.id}:`, matchErr.message);
      }
    }

    console.log(`[FotMob Live Polling] Cycle complete: updated ${updatedCount} matches.`);

    // Trigger settlement if matches completed
    if (newlyFinishedMatches.length > 0 && typeof settleFinishedMatches === 'function') {
      try {
        console.log(`[FotMob Live Polling] Triggering settlement for ${newlyFinishedMatches.length} newly finished matches...`);
        await settleFinishedMatches();
      } catch (settleErr) {
        console.error('[FotMob Live Polling] Settlement execution error:', settleErr.message);
      }
    }
  } catch (err) {
    console.error('[FotMob Live Polling] Uncaught cycle error:', err.message);
  } finally {
    fotmobLivePollingRunning = false;
  }
}

/**
 * Daily fixtures synchronizer using FotMob API:
 * 1. Iterates from startDay (default -1, yesterday) through endDay (default +7, 7 days ahead).
 * 2. Fetches https://www.fotmob.com/api/data/matches?date=YYYYMMDD (fallback /matches?date=...).
 * 3. Filters matches for supported competitions: CL, PL, PD, BL1, SA, FL1, TUN.
 * 4. Calculates Poisson probability points and builds markets.
 * 5. Executes UPSERT into PostgreSQL matches table, linking fotmob_id and updating kickoff dates, scores, status, and team names.
 * 6. Triggers settlement for newly finished matches if settleFinishedMatches is provided.
 */
async function syncFotmobFixtures(
  pool,
  { fetcher = fetch, startDay = -1, endDay = 7, settleFinishedMatches } = {}
) {
  const actualStart = startDay !== undefined ? startDay : -1;
  const actualEnd = endDay !== undefined ? endDay : 7;
  const totalDays = actualEnd - actualStart + 1;
  console.log(`[FotMob Fixtures Sync] Fetching ${totalDays}-day fixtures schedule (${actualStart} to +${actualEnd}) for all competitions...`);

  try {
    const toDateStr = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    };

    const allDiscoveredMatches = [];
    const now = Date.now();

    for (let dayOffset = actualStart; dayOffset <= actualEnd; dayOffset++) {
      const targetDate = new Date(now + dayOffset * 24 * 60 * 60 * 1000);
      const dStr = toDateStr(targetDate);

      const urls = [
        `${FOTMOB_API_BASE}/data/matches?date=${dStr}`,
        `${FOTMOB_API_BASE}/matches?date=${dStr}`
      ];

      let dayMatches = [];
      for (const url of urls) {
        try {
          const res = await fetcher(url, {
            headers: FOTMOB_HEADERS,
            signal: AbortSignal.timeout(8000)
          });
          if (res.ok) {
            const data = await safeParseJsonResponse(res);
            const leagues = Array.isArray(data?.leagues) ? data.leagues : [];
            for (const league of leagues) {
              const compCode = identifyFotmobCompetition(league);
              if (!compCode) continue;

              const matches = Array.isArray(league.matches) ? league.matches : [];
              for (const m of matches) {
                if (m && m.id) {
                  dayMatches.push({
                    raw: m,
                    league,
                    compCode,
                    dateStr: dStr
                  });
                }
              }
            }
            if (dayMatches.length > 0) break;
          }
        } catch (err) {
          console.warn(`[FotMob Fixtures Sync] Error fetching date ${dStr} from ${url}:`, err.message);
        }
      }

      console.log(`[FotMob Fixtures Sync] Date ${dStr} (offset ${dayOffset}): found ${dayMatches.length} approved fixtures.`);
      allDiscoveredMatches.push(...dayMatches);
    }

    console.log(`[FotMob Fixtures Sync] Total fixtures gathered across all days: ${allDiscoveredMatches.length}`);

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

    let storedCount = 0;
    const newlyFinishedMatches = [];

    for (const item of allDiscoveredMatches) {
      const m = item.raw;
      const compCode = item.compCode;
      const fotmobMatchId = Number(m.id);
      if (!Number.isSafeInteger(fotmobMatchId) || fotmobMatchId <= 0) continue;

      const isTunisia = compCode === 'TUN';
      const rawHome = m.home?.name || m.home?.shortName || '';
      const rawAway = m.away?.name || m.away?.shortName || '';
      if (!rawHome || !rawAway) continue;

      const homeTeam = isTunisia ? formatTunisianTeam(rawHome) : rawHome.trim();
      const awayTeam = isTunisia ? formatTunisianTeam(rawAway) : rawAway.trim();
      const homeCrest = getFotmobCrest(m.home?.id, homeTeam);
      const awayCrest = getFotmobCrest(m.away?.id, awayTeam);

      let kickoffIso;
      if (m.status?.utcTime) {
        kickoffIso = new Date(m.status.utcTime).toISOString();
      } else if (m.timeTS) {
        kickoffIso = new Date(m.timeTS).toISOString();
      } else {
        kickoffIso = new Date().toISOString();
      }

      const status = mapFotmobMatchStatus(m);
      const matchday = parseInt(m.tournamentStage, 10) || 1;

      let homeScore = null;
      let awayScore = null;
      if (status === 'FINISHED' || status === 'IN_PLAY' || status === 'PAUSED') {
        if (m.home?.score != null && m.away?.score != null) {
          homeScore = Number(m.home.score);
          awayScore = Number(m.away.score);
        } else if (typeof m.status?.scoreStr === 'string' && m.status.scoreStr.includes('-')) {
          const parts = m.status.scoreStr.split('-').map(s => parseInt(s.trim(), 10));
          if (!isNaN(parts[0]) && !isNaN(parts[1])) {
            homeScore = parts[0];
            awayScore = parts[1];
          }
        }
      }

      const compModel = modelsByComp[compCode] || teamRatings([]);
      const homeIdNum = Number(m.home?.id) || fotmobMatchId;
      const awayIdNum = Number(m.away?.id) || (fotmobMatchId + 1);
      const { lambdaHome, lambdaAway } = matchLambdas(homeIdNum, awayIdNum, compModel);
      const markets = buildMatchMarketsPoints(lambdaHome, lambdaAway);

      if (!pool) {
        storedCount++;
        continue;
      }

      // Check if match already exists in PostgreSQL
      let existingMatch = null;
      let dbRows = [];
      try {
        const queryRes = await pool.query(
          `SELECT id, external_id, fotmob_id, flashscore_id, competition_code, home_team, away_team, utc_date, status, home_score, away_score, points_calculated
           FROM matches
           WHERE fotmob_id = $1
              OR external_id = $1
              OR (
                competition_code = $2
                AND utc_date >= $3::timestamptz - INTERVAL '36 hours'
                AND utc_date <= $3::timestamptz + INTERVAL '36 hours'
              )
           LIMIT 100`,
          [fotmobMatchId, compCode, kickoffIso]
        );
        dbRows = queryRes.rows || [];

        existingMatch = dbRows.find(r =>
          String(r.fotmob_id) === String(fotmobMatchId) ||
          String(r.external_id) === String(fotmobMatchId) ||
          ((teamsMatch(r.home_team, homeTeam) && teamsMatch(r.away_team, awayTeam)) ||
           (teamsMatch(r.home_team, awayTeam) && teamsMatch(r.away_team, homeTeam)))
        );
      } catch (findErr) {
        console.warn(`[FotMob Fixtures Sync] Match lookup error for ${homeTeam} vs ${awayTeam}:`, findErr.message);
      }

      if (existingMatch) {
        if (status === 'FINISHED' && existingMatch.status !== 'FINISHED') {
          newlyFinishedMatches.push({ id: existingMatch.id, homeScore, awayScore });
        }

        await pool.query(
          `UPDATE matches
           SET fotmob_id = $1,
               competition_code = $2,
               home_team = $3,
               home_crest = COALESCE($4, home_crest),
               away_team = $5,
               away_crest = COALESCE($6, away_crest),
               utc_date = CASE WHEN points_calculated THEN utc_date ELSE $7::timestamptz END,
               status = CASE
                 WHEN points_calculated AND utc_date < NOW() - INTERVAL '48 hours' THEN status
                 WHEN points_calculated AND ($8 != 'FINISHED' OR $9::int IS NULL OR $10::int IS NULL) THEN status
                 ELSE $8
               END,
               home_score = CASE
                 WHEN points_calculated AND utc_date < NOW() - INTERVAL '48 hours' THEN home_score
                 WHEN points_calculated AND ($8 != 'FINISHED' OR $9::int IS NULL OR $10::int IS NULL) THEN home_score
                 ELSE COALESCE($9::int, home_score)
               END,
               away_score = CASE
                 WHEN points_calculated AND utc_date < NOW() - INTERVAL '48 hours' THEN away_score
                 WHEN points_calculated AND ($8 != 'FINISHED' OR $9::int IS NULL OR $10::int IS NULL) THEN away_score
                 ELSE COALESCE($10::int, away_score)
               END,
               round_key = COALESCE(round_key, 'REGULAR_SEASON'),
               round_label = COALESCE(round_label, 'Matchday'),
               updated_at = NOW()
           WHERE id = $11`,
          [
            fotmobMatchId,
            compCode,
            homeTeam,
            homeCrest,
            awayTeam,
            awayCrest,
            kickoffIso,
            status,
            homeScore,
            awayScore,
            existingMatch.id
          ]
        );

        // Clean up any unlinked placeholder duplicate without predictions
        const duplicateUnlinked = dbRows.filter(r =>
          r.id !== existingMatch.id &&
          !r.fotmob_id &&
          ((teamsMatch(r.home_team, homeTeam) && teamsMatch(r.away_team, awayTeam)) ||
           (teamsMatch(r.home_team, awayTeam) && teamsMatch(r.away_team, homeTeam)))
        );
        for (const dup of duplicateUnlinked) {
          try {
            await pool.query(
              `DELETE FROM matches WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM predictions WHERE match_id = $1)`,
              [dup.id]
            );
          } catch (_) {}
        }

        storedCount++;
      } else {
        // Remove any unlinked placeholder duplicate without predictions before inserting
        const duplicateUnlinked = dbRows.filter(r =>
          !r.fotmob_id &&
          ((teamsMatch(r.home_team, homeTeam) && teamsMatch(r.away_team, awayTeam)) ||
           (teamsMatch(r.home_team, awayTeam) && teamsMatch(r.away_team, homeTeam)))
        );
        for (const dup of duplicateUnlinked) {
          try {
            await pool.query(
              `DELETE FROM matches WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM predictions WHERE match_id = $1)`,
              [dup.id]
            );
          } catch (_) {}
        }

        await pool.query(
          `INSERT INTO matches (
             external_id, fotmob_id, competition_code, stage, matchday, round_key, round_label,
             home_team, home_crest, away_team, away_crest, utc_date, status,
             home_score, away_score, home_lambda, away_lambda, markets_points, updated_at
           ) VALUES (
             $1, $2, $3, 'REGULAR_SEASON', $4, 'REGULAR_SEASON', 'Matchday',
             $5, $6, $7, $8, $9::timestamptz, $10,
             $11, $12, $13, $14, $15::jsonb, NOW()
           )
           ON CONFLICT (external_id) DO UPDATE SET
             fotmob_id = EXCLUDED.fotmob_id,
             competition_code = EXCLUDED.competition_code,
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
               ELSE COALESCE(EXCLUDED.home_score, matches.home_score)
             END,
             away_score = CASE
               WHEN matches.points_calculated AND matches.utc_date < NOW() - INTERVAL '48 hours' THEN matches.away_score
               WHEN matches.points_calculated AND (EXCLUDED.status != 'FINISHED' OR EXCLUDED.home_score IS NULL OR EXCLUDED.away_score IS NULL) THEN matches.away_score
               ELSE COALESCE(EXCLUDED.away_score, matches.away_score)
             END,
             updated_at = NOW()`,
          [
            fotmobMatchId,
            fotmobMatchId,
            compCode,
            matchday,
            homeTeam,
            homeCrest,
            awayTeam,
            awayCrest,
            kickoffIso,
            status,
            homeScore,
            awayScore,
            lambdaHome,
            lambdaAway,
            JSON.stringify(markets)
          ]
        );
        storedCount++;
      }
    }

    console.log(`[FotMob Fixtures Sync] Successfully stored/updated ${storedCount} fixtures in PostgreSQL.`);

    if (newlyFinishedMatches.length > 0 && typeof settleFinishedMatches === 'function') {
      try {
        console.log(`[FotMob Fixtures Sync] Triggering settlement for ${newlyFinishedMatches.length} newly finished matches...`);
        await settleFinishedMatches();
      } catch (settleErr) {
        console.error('[FotMob Fixtures Sync] Settlement execution error:', settleErr.message);
      }
    }

    return allDiscoveredMatches;
  } catch (err) {
    console.error('[FotMob Fixtures Sync] Schedule sync error:', err.message);
    return [];
  }
}

module.exports = {
  FOTMOB_API_BASE,
  FOTMOB_IMAGE_BASE,
  FOTMOB_HEADERS,
  cleanTeamName,
  teamsMatch,
  mapFotmobPosition,
  extractPlayerEventsMap,
  parseFotmobLineup,
  findFotmobMatchId,
  fetchFotmobLineup,
  parseFotmobStats,
  smartLivePollingFotmob,
  identifyFotmobCompetition,
  formatTunisianTeam,
  getFotmobCrest,
  mapFotmobMatchStatus,
  syncFotmobFixtures
};
