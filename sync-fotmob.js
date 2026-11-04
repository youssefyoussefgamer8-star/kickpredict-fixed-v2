'use strict';

/**
 * FotMob Integration Module for Match Lineups & Player Headshots
 * Provides high-resolution player photos via images.fotmob.com and
 * maps FotMob lineup payloads into KickPredict's tactical roster contract.
 */

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
  rbleipzig: 'rbleipzig'
};

/**
 * Normalizes team name for fuzzy matching across providers
 */
function cleanTeamName(name) {
  if (!name || typeof name !== 'string') return '';
  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  if (TEAM_ALIASES[normalized]) return TEAM_ALIASES[normalized];

  // Strip prefixes / suffixes like fc, cf, afc, ac, sc, as if not sole identifier
  let cleaned = normalized
    .replace(/^(fc|cf|afc|ac|sc|as|vfb|rb|fk)/, '')
    .replace(/(fc|cf|afc|sc)$/, '');

  if (cleaned.length < 3) cleaned = normalized;

  return TEAM_ALIASES[cleaned] || TEAM_ALIASES[normalized] || cleaned;
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
 * Parses raw FotMob matchDetails response into KickPredict unified roster contract
 */
function parseFotmobLineup(data) {
  if (!data || typeof data !== 'object') return null;

  const lineup = data.content?.lineup || data.lineup;
  if (!lineup || typeof lineup !== 'object') return null;

  const homeTeam = lineup.homeTeam;
  const awayTeam = lineup.awayTeam;

  const rawHomeStarters = Array.isArray(homeTeam?.starters) ? homeTeam.starters : [];
  const rawAwayStarters = Array.isArray(awayTeam?.starters) ? awayTeam.starters : [];

  if (rawHomeStarters.length === 0 || rawAwayStarters.length === 0) {
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
    awayRoster
  };
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
          const data = await res.json();
          const leagues = Array.isArray(data.leagues) ? data.leagues : [];

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
        const data = await res.json();
        const parsed = parseFotmobLineup(data);
        if (parsed && parsed.startingHome?.length > 0) {
          console.log(`[FotMob] Lineups successfully parsed for ${targetMatchId} (${parsed.startingHome.length} home starters)`);
          return parsed;
        }
      }
    } catch (err) {
      console.warn(`[FotMob] Fetch error from ${url}:`, err.message);
    }
  }

  return null;
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
  fetchFotmobLineup
};
