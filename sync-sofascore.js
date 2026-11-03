'use strict';

/**
 * Sofascore Integration Module for Match Lineups & Player Headshots
 * Provides high-resolution player photos via img.sofascore.com and
 * maps Sofascore lineup payloads into KickPredict's tactical roster contract.
 */

const SOFASCORE_API_BASE = 'https://api.sofascore.com/api/v1';
const SOFASCORE_IMAGE_BASE = 'https://img.sofascore.com/api/v1/player';

const SOFASCORE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.sofascore.com/',
  'Origin': 'https://www.sofascore.com',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site'
};

const TEAM_ALIASES = {
  psg: 'parissaintgermain',
  parissg: 'parissaintgermain',
  mancity: 'manchestercity',
  manunited: 'manchesterunited',
  manutd: 'manchesterunited',
  wolves: 'wolverhampton',
  spurs: 'tottenham',
  atletico: 'atleticomadrid',
  barca: 'barcelona',
  bayern: 'bayernmunchen',
  dortmund: 'borussiadortmund',
  inter: 'internazionale',
  milan: 'acmilan',
  juve: 'juventus'
};

/**
 * Normalizes team name for fuzzy matching across providers
 */
function cleanTeamName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Checks if two team names are equivalent
 */
function teamsMatch(a, b) {
  let cleanA = cleanTeamName(a);
  let cleanB = cleanTeamName(b);
  if (!cleanA || !cleanB) return false;
  if (TEAM_ALIASES[cleanA]) cleanA = TEAM_ALIASES[cleanA];
  if (TEAM_ALIASES[cleanB]) cleanB = TEAM_ALIASES[cleanB];
  return cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA);
}

/**
 * Maps raw Sofascore lineups JSON into KickPredict's tactical lineup contract
 * (homeRoster, awayRoster, startingHome/Away, subsHome/Away, formations, managers)
 */
function parseSofascoreLineups(data) {
  if (!data || typeof data !== 'object') return null;
  const home = data.home || {};
  const away = data.away || {};

  const formationHome = home.formation || '4-3-3';
  const formationAway = away.formation || '4-3-3';

  // Support staff / managers
  const managerHome = Array.isArray(home.supportStaff)
    ? home.supportStaff.find((s) => /manager|coach/i.test(s.role || ''))?.name || null
    : null;

  const managerAway = Array.isArray(away.supportStaff)
    ? away.supportStaff.find((s) => /manager|coach/i.test(s.role || ''))?.name || null
    : null;

  const mapPlayer = (item, idx, isSub = false) => {
    const p = item.player || {};
    const pId = p.id ? String(p.id) : null;
    const pName = p.name || p.slug || `Player ${idx + 1}`;
    const pNum = item.shirtNumber || item.jerseyNumber || p.jerseyNumber || (isSub ? 12 + idx : idx + 1);

    // Map Sofascore position letter (G -> GK, D -> DF, M -> MF, F -> FW)
    let pos = 'MF';
    const rawPos = String(item.position || p.position || '').toUpperCase();
    if (rawPos === 'G' || rawPos === 'GK' || pNum === 1) {
      pos = 'GK';
    } else if (rawPos === 'D' || rawPos === 'DF') {
      pos = 'DF';
    } else if (rawPos === 'M' || rawPos === 'MF') {
      pos = 'MF';
    } else if (rawPos === 'F' || rawPos === 'FW' || rawPos === 'A') {
      pos = 'FW';
    }
    if (isSub) pos = 'SUB';

    // High-resolution Sofascore player image CDN URL
    const photo = pId ? `${SOFASCORE_IMAGE_BASE}/${pId}/image` : null;
    const rating = item.statistics?.rating ? String(item.statistics.rating) : null;

    // Collect individual player incidents / stats
    const events = [];
    if (item.statistics?.goals && item.statistics.goals > 0) {
      events.push({ type: 'goal', minute: '', count: item.statistics.goals });
    }
    if (item.statistics?.assists && item.statistics.assists > 0) {
      events.push({ type: 'assist', minute: '', count: item.statistics.assists });
    }
    if (item.statistics?.yellowCards && item.statistics.yellowCards > 0) {
      events.push({ type: 'yellow_card', minute: '' });
    }
    if (item.statistics?.redCards && item.statistics.redCards > 0) {
      events.push({ type: 'red_card', minute: '' });
    }

    return {
      id: pId,
      name: pName,
      num: typeof pNum === 'number' ? pNum : parseInt(pNum, 10) || (idx + 1),
      photo,
      rating,
      slot: idx + 1,
      pos,
      events
    };
  };

  const homePlayers = Array.isArray(home.players) ? home.players : [];
  const awayPlayers = Array.isArray(away.players) ? away.players : [];

  const startingHome = homePlayers.filter((p) => !p.substitute).map((p, i) => mapPlayer(p, i, false));
  const subsHome = homePlayers.filter((p) => p.substitute).map((p, i) => mapPlayer(p, i, true));

  const startingAway = awayPlayers.filter((p) => !p.substitute).map((p, i) => mapPlayer(p, i, false));
  const subsAway = awayPlayers.filter((p) => p.substitute).map((p, i) => mapPlayer(p, i, true));

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

  console.log(`[Sofascore Parser] Parsed lineups: Home ${formationHome} (${startingHome.length} starting, ${subsHome.length} subs), Away ${formationAway} (${startingAway.length} starting, ${subsAway.length} subs)`);

  return {
    source: 'sofascore',
    confirmed: Boolean(data.confirmed),
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
 * Helper to safely extract event objects from various Sofascore search/schedule responses
 */
function extractEventsFromSofascore(data) {
  const events = [];
  if (!data || typeof data !== 'object') return events;

  if (Array.isArray(data.events)) {
    events.push(...data.events);
  }
  if (Array.isArray(data.results)) {
    for (const item of data.results) {
      if (item.type === 'event' && item.entity) {
        events.push(item.entity);
      } else if (item.id && (item.homeTeam || item.homeTeamName) && (item.awayTeam || item.awayTeamName)) {
        events.push(item);
      }
    }
  }
  return events;
}

/**
 * Searches for a Sofascore event ID given team names and date.
 * Accurately searches past dates, schedule endpoints, and direct keyword search.
 */
async function findSofascoreEventId(homeTeam, awayTeam, matchDate, { fetcher = fetch } = {}) {
  if (!homeTeam || !awayTeam) return null;

  const targetDate = matchDate ? new Date(matchDate) : new Date();
  const targetTs = !isNaN(targetDate.getTime()) ? Math.floor(targetDate.getTime() / 1000) : null;

  // 1. Direct Search Approach (/search/all?q={teamName})
  // Searches for recent/past matches of either team and matches the fixture pair
  const searchQueries = [homeTeam, awayTeam].filter(Boolean);
  for (const query of searchQueries) {
    try {
      const searchUrl = `${SOFASCORE_API_BASE}/search/all?q=${encodeURIComponent(query)}`;
      console.log(`[Sofascore Finder] Searching Sofascore for "${query}"...`);
      const res = await fetcher(searchUrl, {
        headers: SOFASCORE_HEADERS,
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const data = await res.json();
        const events = extractEventsFromSofascore(data);
        const matchingEvents = events.filter((ev) => {
          const evHome = ev.homeTeam?.name || ev.homeTeamName || '';
          const evAway = ev.awayTeam?.name || ev.awayTeamName || '';
          return (teamsMatch(evHome, homeTeam) && teamsMatch(evAway, awayTeam)) ||
                 (teamsMatch(evHome, awayTeam) && teamsMatch(evAway, homeTeam));
        });

        if (matchingEvents.length > 0) {
          // If we have a target date, find the closest event in time
          if (targetTs && matchingEvents.length > 1) {
            matchingEvents.sort((a, b) => {
              const diffA = Math.abs((a.startTimestamp || 0) - targetTs);
              const diffB = Math.abs((b.startTimestamp || 0) - targetTs);
              return diffA - diffB;
            });
          }
          const chosen = matchingEvents[0];
          console.log(`[Sofascore Finder] Match found via search! eventId: ${chosen.id} (${chosen.homeTeam?.name || chosen.homeTeamName} vs ${chosen.awayTeam?.name || chosen.awayTeamName})`);
          return chosen.id;
        }
      }
    } catch (searchErr) {
      console.warn(`[Sofascore Finder] Search query "${query}" error:`, searchErr.message);
    }
  }

  // 2. Scheduled Events Approach: check target date, and +/- 1 day to cover timezone boundaries
  if (targetTs) {
    const datesToCheck = [];
    const baseDate = new Date(targetDate);
    datesToCheck.push(baseDate.toISOString().slice(0, 10));

    // Previous day (for evening matches in UTC that were next day local)
    const prevDate = new Date(baseDate.getTime() - 24 * 60 * 60 * 1000);
    datesToCheck.push(prevDate.toISOString().slice(0, 10));

    // Next day (for morning matches in UTC that were previous day local)
    const nextDate = new Date(baseDate.getTime() + 24 * 60 * 60 * 1000);
    datesToCheck.push(nextDate.toISOString().slice(0, 10));

    for (const dStr of datesToCheck) {
      try {
        const scheduleUrl = `${SOFASCORE_API_BASE}/sport/football/scheduled-events/${dStr}`;
        console.log(`[Sofascore Finder] Checking scheduled events for ${dStr} ("${homeTeam}" vs "${awayTeam}")...`);
        const res = await fetcher(scheduleUrl, {
          headers: SOFASCORE_HEADERS,
          signal: AbortSignal.timeout(8000)
        });

        if (res.ok) {
          const data = await res.json();
          const events = extractEventsFromSofascore(data);
          const match = events.find((ev) => {
            const evHome = ev.homeTeam?.name || ev.homeTeamName || '';
            const evAway = ev.awayTeam?.name || ev.awayTeamName || '';
            return (teamsMatch(evHome, homeTeam) && teamsMatch(evAway, awayTeam)) ||
                   (teamsMatch(evHome, awayTeam) && teamsMatch(evAway, homeTeam));
          });

          if (match?.id) {
            console.log(`[Sofascore Finder] Match found on ${dStr}! Sofascore eventId: ${match.id} (${match.homeTeam?.name || match.homeTeamName} vs ${match.awayTeam?.name || match.awayTeamName})`);
            return match.id;
          }
        }
      } catch (scheduleErr) {
        console.warn(`[Sofascore Finder] Schedule search for ${dStr} error:`, scheduleErr.message);
      }
    }
  }

  return null;
}

/**
 * Main fetch function: Fetches and returns parsed Sofascore lineups
 */
async function fetchSofascoreLineups(homeTeam, awayTeam, matchDate, eventId = null, { fetcher = fetch } = {}) {
  let targetEventId = eventId;
  if (!targetEventId && homeTeam && awayTeam) {
    targetEventId = await findSofascoreEventId(homeTeam, awayTeam, matchDate, { fetcher });
  }

  if (!targetEventId) {
    console.warn(`[Sofascore] No eventId available for ${homeTeam} vs ${awayTeam}`);
    return null;
  }

  const url = `${SOFASCORE_API_BASE}/event/${targetEventId}/lineups`;
  console.log(`[Sofascore] Fetching lineups from ${url}...`);

  try {
    const res = await fetcher(url, {
      headers: SOFASCORE_HEADERS,
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      console.warn(`[Sofascore] Lineups HTTP ${res.status} (${res.statusText}) for event ${targetEventId}`);
      return null;
    }

    const data = await res.json();
    return parseSofascoreLineups(data);
  } catch (err) {
    console.warn(`[Sofascore] Fetch error for event ${targetEventId}: ${err.message}`);
    return null;
  }
}

module.exports = {
  SOFASCORE_API_BASE,
  SOFASCORE_IMAGE_BASE,
  SOFASCORE_HEADERS,
  cleanTeamName,
  teamsMatch,
  extractEventsFromSofascore,
  parseSofascoreLineups,
  findSofascoreEventId,
  fetchSofascoreLineups
};
