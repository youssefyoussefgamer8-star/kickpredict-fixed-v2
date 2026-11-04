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

  const headerTeams = Array.isArray(data.header?.teams) ? data.header.teams : [];
  const homeScore = headerTeams[0]?.score != null ? Number(headerTeams[0].score) : null;
  const awayScore = headerTeams[1]?.score != null ? Number(headerTeams[1].score) : null;

  const headerStatus = data.header?.status;
  const isFinished = Boolean(headerStatus?.finished || headerStatus?.reason?.short === 'FT');
  const isPaused = Boolean(headerStatus?.reason?.short === 'HT' || headerStatus?.reason?.shortKey === 'halftime_short');
  const isLive = Boolean(headerStatus?.started && !headerStatus?.finished);
  const liveClock = headerStatus?.liveTime?.short || headerStatus?.reason?.short || null;

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
    status: isFinished ? 'FINISHED' : (isPaused ? 'PAUSED' : (isLive ? 'IN_PLAY' : null)),
    liveClock
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
    // 1. Local Database Gate: Find matches needing live polling
    const { rows: activeMatches } = await pool.query(
      `SELECT id, external_id, fotmob_id, flashscore_id, competition_code, home_team, away_team, utc_date, status, home_score, away_score,
              home_ht, away_ht, points_calculated
       FROM matches
       WHERE status IN ('IN_PLAY', 'PAUSED', 'LIVE', '1H', '2H', 'HT')
          OR (
            status IN ('TIMED', 'SCHEDULED')
            AND utc_date <= NOW() + INTERVAL '30 minutes'
            AND utc_date >= NOW() - INTERVAL '300 minutes'
          )
          OR (
            status = 'FINISHED'
            AND (home_score IS NULL OR away_score IS NULL OR points_calculated IS NOT TRUE)
            AND utc_date >= NOW() - INTERVAL '24 hours'
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
        const homeScore = fm.home?.score != null ? Number(fm.home.score) : null;
        const awayScore = fm.away?.score != null ? Number(fm.away.score) : null;

        // Map status
        let newStatus = dbMatch.status;
        if (fm.status?.finished === true || fm.status?.reason?.short === 'FT') {
          newStatus = 'FINISHED';
        } else if (fm.status?.reason?.short === 'HT' || fm.status?.reason?.shortKey === 'halftime_short') {
          newStatus = 'PAUSED';
        } else if (fm.status?.ongoing === true || (fm.status?.started === true && !fm.status?.finished)) {
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
  smartLivePollingFotmob
};
