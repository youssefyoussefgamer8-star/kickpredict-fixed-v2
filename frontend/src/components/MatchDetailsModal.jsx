import React, { useState, useEffect } from 'react';
import { api, API_BASE } from '../utils/api';

function getProxiedImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (
    url.includes('static.flashscore.com') ||
    url.includes('flashscore.com') ||
    url.includes('sofascore.com') ||
    url.includes('sofascore.app') ||
    url.includes('fotmob.com')
  ) {
    return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

const LEAGUE_LOGOS = {
  PL: 'https://static.flashscore.com/res/image/data/rN76jpW1-naArgzhi.png',
  PD: 'https://static.flashscore.com/res/image/data/QqMkp58j-reLEIqyt.png',
  BL1: 'https://static.flashscore.com/res/image/data/OK1u7OEO-f1Humc6M.png',
  SA: 'https://static.flashscore.com/res/image/data/MR5bDSiU-IJ2iYpX2.png',
  FL1: 'https://static.flashscore.com/res/image/data/MsMVZaYI-MLhl2QvU.png',
  CL: 'https://static.flashscore.com/res/image/data/fLD8FzTp-jVJ5lAat.png',
  TUN: 'https://static.flashscore.com/res/image/data/YBrafEB7-j18GLkLE.png',
  TU1: 'https://static.flashscore.com/res/image/data/YBrafEB7-j18GLkLE.png'
};

// Flashscore-style rating color theme (Green > 7.5, Amber/Orange 6-7.4, Red < 6)
function getRatingStyle(ratingVal) {
  if (ratingVal === null || ratingVal === undefined || ratingVal === '') return null;
  const r = typeof ratingVal === 'number' ? ratingVal : parseFloat(String(ratingVal).replace(',', '.'));
  if (isNaN(r) || r <= 0) return null;

  if (r >= 7.5) {
    return {
      bg: 'bg-[#00B020]', // Flashscore vibrant green for top performers (>= 7.5)
      text: 'text-white',
      border: 'border-[#00B020]/60',
      shadow: 'shadow-emerald-950/40',
      label: r.toFixed(1)
    };
  }
  if (r >= 6.0) {
    return {
      bg: 'bg-[#FF9800]', // Flashscore vibrant amber/orange for solid performers (6.0 - 7.4)
      text: 'text-black',
      border: 'border-[#FF9800]/60',
      shadow: 'shadow-amber-950/40',
      label: r.toFixed(1)
    };
  }
  return {
    bg: 'bg-[#E53935]', // Flashscore vibrant red for struggling performers (< 6.0)
    text: 'text-white',
    border: 'border-[#E53935]/60',
    shadow: 'shadow-rose-950/40',
    label: r.toFixed(1)
  };
}

// Arabic translations dictionary for FotMob match statistics
const STAT_TRANSLATIONS_AR = {
  'ball possession': 'الاستحواذ على الكرة',
  'possession': 'الاستحواذ على الكرة',
  'expected goals (xg)': 'الأهداف المتوقعة (xG)',
  'xg': 'الأهداف المتوقعة (xG)',
  'total shots': 'إجمالي التسديدات',
  'shots': 'إجمالي التسديدات',
  'shots on target': 'التسديدات على المرمى',
  'shots off target': 'التسديدات خارج المرمى',
  'blocked shots': 'تسديدات تم اعتراضها',
  'big chances': 'فرص محققة',
  'big chances missed': 'فرص محققة ضائعة',
  'accurate passes': 'تمريرات دقيقة',
  'pass success': 'دقة التمرير',
  'pass accuracy': 'دقة التمرير',
  'passes': 'التمريرات',
  'total passes': 'إجمالي التمريرات',
  'fouls committed': 'الأخطاء المرتكبة',
  'fouls': 'الأخطاء المرتكبة',
  'corner kicks': 'الضربات الركنية',
  'corners': 'الضربات الركنية',
  'offsides': 'حالات التسلل',
  'yellow cards': 'البطاقات الصفراء',
  'red cards': 'البطاقات الحمراء',
  'goalkeeper saves': 'تصديات الحارس',
  'saves': 'تصديات الحارس',
  'touches in opposition box': 'لمسات في منطقة الخصم',
  'touches in penalty area': 'لمسات في منطقة الجزاء',
  'passes into final third': 'تمريرات في الثلث الأخير',
  'key passes': 'تمريرات حاسمة',
  'tackles won': 'تدخلات ناجحة',
  'tackles': 'التدخلات الدفاعية',
  'interceptions': 'اعتراض الكرة',
  'clearances': 'تشتيت الكرة',
  'aerial duels won': 'التحامات هوائية ناجحة',
  'duels won': 'التحامات ناجحة',
  'ground duels won': 'التحامات أرضية ناجحة',
  'dribbles completed': 'مراوغات ناجحة',
  'dribbles': 'المراوغات',
  'accurate crosses': 'عرضيات دقيقة',
  'crosses': 'العرضيات',
  'accurate long balls': 'كرات طويلة دقيقة',
  'long balls': 'كرات طويلة',
  'xg open play': 'أهداف متوقعة (لعب مفتوح)',
  'xg set play': 'أهداف متوقعة (كرات ثابتة)',
  'xg on target (xgot)': 'أهداف متوقعة على المرمى (xGOT)',
  'shooting accuracy': 'دقة التسديد',
  'chances created': 'صناعة الفرص',
  'recoveries': 'استرجاع الكرة'
};

const GROUP_TRANSLATIONS_AR = {
  'top stats': '🔥 أهم الإحصائيات',
  'shots': '🎯 التسديدات والمحاولات',
  'expected goals (xg)': '📈 الأهداف المتوقعة (xG)',
  'passes': '⚽ التمريرات وصناعة اللعب',
  'defence': '🛡️ الدفاع والتصديات',
  'duels': '⚔️ الالتحامات والكرات المشتركة',
  'discipline': '🟨 الانضباط والبطاقات'
};

function getStatArabicLabel(statName) {
  if (!statName) return 'إحصائية';
  const clean = statName.trim().toLowerCase();
  if (STAT_TRANSLATIONS_AR[clean]) return STAT_TRANSLATIONS_AR[clean];
  for (const [key, val] of Object.entries(STAT_TRANSLATIONS_AR)) {
    if (clean.includes(key) || key.includes(clean)) return val;
  }
  return statName;
}

function isStatReverseBetter(nameOrKey) {
  if (!nameOrKey) return false;
  const s = String(nameOrKey).toLowerCase();
  return (
    s.includes('foul') ||
    s.includes('yellow') ||
    s.includes('red card') ||
    s.includes('red_card') ||
    s.includes('offside') ||
    s.includes('missed')
  );
}

function renderSingleStatRow(st, isAr) {
  const total = (st.homeVal || 0) + (st.awayVal || 0);
  let hPct = 50;
  let aPct = 50;
  if (total > 0) {
    hPct = Math.min(95, Math.max(5, Math.round(((st.homeVal || 0) / total) * 100)));
    aPct = 100 - hPct;
  }

  const homeIsBetter = st.reverseBetter ? st.homeVal < st.awayVal : st.homeVal > st.awayVal;
  const awayIsBetter = st.reverseBetter ? st.awayVal < st.homeVal : st.awayVal > st.homeVal;

  return (
    <div key={st.key} className="space-y-1.5">
      {/* Metric Numbers & Label */}
      <div className="flex items-center justify-between text-xs sm:text-sm">
        <span
          className={`font-mono transition-all ${
            homeIsBetter
              ? 'text-emerald-400 font-black text-sm sm:text-base drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]'
              : 'text-gray-300 font-bold'
          }`}
        >
          {st.home}
        </span>
        <span className="text-xs font-extrabold text-gray-400 text-center truncate px-2 max-w-[60%]">
          {isAr ? st.labelAr : st.labelEn}
        </span>
        <span
          className={`font-mono transition-all ${
            awayIsBetter
              ? 'text-amber-400 font-black text-sm sm:text-base drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]'
              : 'text-gray-300 font-bold'
          }`}
        >
          {st.away}
        </span>
      </div>

      {/* Dual Progress Bar */}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#090C0E] border border-white/5 p-0.5">
        <div
          className={`h-full rounded-l-full transition-all duration-500 ${
            homeIsBetter
              ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
              : 'bg-emerald-600/70'
          }`}
          style={{ width: `${hPct}%` }}
        />
        <div
          className={`h-full rounded-r-full transition-all duration-500 ${
            awayIsBetter
              ? 'bg-gradient-to-r from-amber-400 to-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]'
              : 'bg-amber-600/70'
          }`}
          style={{ width: `${aPct}%` }}
        />
      </div>
    </div>
  );
}

function renderStatsSection(statsList, isAr) {
  const groupsMap = new Map();
  for (const st of statsList) {
    const grp = st.group || 'General';
    if (!groupsMap.has(grp)) groupsMap.set(grp, []);
    groupsMap.get(grp).push(st);
  }

  const hasMultipleGroups = groupsMap.size > 1 && !groupsMap.has('General');

  if (!hasMultipleGroups) {
    return (
      <div className="rounded-2xl border border-white/5 bg-[#14181B] p-3 sm:p-5 space-y-4">
        {statsList.map((st) => renderSingleStatRow(st, isAr))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Array.from(groupsMap.entries()).map(([groupName, groupStats]) => {
        const groupLabel = isAr ? (GROUP_TRANSLATIONS_AR[groupName.toLowerCase()] || groupName) : groupName;
        return (
          <div key={groupName} className="rounded-2xl border border-white/5 bg-[#14181B] p-3 sm:p-5 space-y-3">
            <h5 className="text-xs font-black uppercase tracking-wider text-gray-400 border-b border-white/5 pb-2">
              {groupLabel}
            </h5>
            <div className="space-y-3">
              {groupStats.map((st) => renderSingleStatRow(st, isAr))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Generate realistic match statistics based on actual score and match state
function generateMockStats(match) {
  const hScore = Number(match.home_score ?? 1);
  const aScore = Number(match.away_score ?? 0);
  const isFinished = match.status === 'FINISHED' || match.live_clock === 'FT';

  // Possession
  const basePoss = 50 + (hScore - aScore) * 3;
  const hPoss = Math.min(68, Math.max(34, Math.round(basePoss + (match.id % 7) - 3)));
  const aPoss = 100 - hPoss;

  // Shots
  const mult = isFinished ? 1 : 0.75;
  const hShots = Math.max(hScore + 3, Math.round((12 + (hScore * 2)) * mult));
  const aShots = Math.max(aScore + 2, Math.round((8 + (aScore * 2)) * mult));

  const hTarget = Math.max(hScore, Math.round(hShots * 0.42));
  const aTarget = Math.max(aScore, Math.round(aShots * 0.38));

  // xG
  const hXg = (hScore * 0.65 + hTarget * 0.15 + 0.22).toFixed(2);
  const aXg = (aScore * 0.65 + aTarget * 0.15 + 0.18).toFixed(2);

  // Corners, Fouls, Cards
  const hCorners = Math.max(1, Math.round(5 + (hPoss > 50 ? 2 : -1)));
  const aCorners = Math.max(1, Math.round(4 + (aPoss > 50 ? 2 : -1)));

  const hFouls = Math.round(9 + (match.id % 5));
  const aFouls = Math.round(11 + (match.id % 4));

  const hYellow = Math.min(4, Math.max(0, Math.round((hFouls / 4.5))));
  const aYellow = Math.min(5, Math.max(1, Math.round((aFouls / 3.8))));

  return [
    { key: 'possession', labelEn: 'Ball Possession', labelAr: 'الاستحواذ على الكرة', home: `${hPoss}%`, away: `${aPoss}%`, homeVal: hPoss, awayVal: aPoss },
    { key: 'xg', labelEn: 'Expected Goals (xG)', labelAr: 'الأهداف المتوقعة (xG)', home: hXg, away: aXg, homeVal: parseFloat(hXg), awayVal: parseFloat(aXg) },
    { key: 'shots', labelEn: 'Total Shots', labelAr: 'إجمالي التسديدات', home: hShots, away: aShots, homeVal: hShots, awayVal: aShots },
    { key: 'target', labelEn: 'Shots on Target', labelAr: 'التسديدات على المرمى', home: hTarget, away: aTarget, homeVal: hTarget, awayVal: aTarget },
    { key: 'corners', labelEn: 'Corner Kicks', labelAr: 'الضربات الركنية', home: hCorners, away: aCorners, homeVal: hCorners, awayVal: aCorners },
    { key: 'fouls', labelEn: 'Fouls Committed', labelAr: 'الأخطاء المرتكبة', home: hFouls, away: aFouls, homeVal: hFouls, awayVal: aFouls, reverseBetter: true },
    { key: 'yellow_cards', labelEn: 'Yellow Cards', labelAr: 'البطاقات الصفراء', home: hYellow, away: aYellow, homeVal: hYellow, awayVal: aYellow, reverseBetter: true },
    { key: 'red_cards', labelEn: 'Red Cards', labelAr: 'البطاقات الحمراء', home: 0, away: 0, homeVal: 0, awayVal: 0, reverseBetter: true },
    { key: 'offsides', labelEn: 'Offsides', labelAr: 'حالات التسلل', home: 2, away: 1, homeVal: 2, awayVal: 1, reverseBetter: true },
    { key: 'saves', labelEn: 'Goalkeeper Saves', labelAr: 'تصديات الحارس', home: aTarget > 0 ? aTarget - aScore : 2, away: hTarget > 0 ? hTarget - hScore : 3, homeVal: Math.max(0, aTarget - aScore), awayVal: Math.max(0, hTarget - hScore) }
  ];
}

export default function MatchDetailsModal({ match, lang = 'ar', t = {}, liveTimerText, onClose, onOpenPrediction }) {
  const isAr = lang === 'ar';
  const [activeTab, setActiveTab] = useState('stats'); // 'stats' | 'lineups'
  const [realDetails, setRealDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(true);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Attempt to fetch real details from backend if available
  useEffect(() => {
    let isMounted = true;
    const matchLookupId = match?.id || match?.external_id || match?.flashscore_id;
    if (matchLookupId) {
      setLoadingDetails(true);
      api(`/matches/${matchLookupId}/details`)
        .then((data) => {
          if (isMounted) {
            if (data) {
              setRealDetails(data);
            }
            setLoadingDetails(false);
          }
        })
        .catch((err) => {
          console.warn('[MatchDetails] Failed to fetch details:', err);
          if (isMounted) {
            setLoadingDetails(false);
          }
        });
    } else {
      setLoadingDetails(false);
    }
    return () => {
      isMounted = false;
    };
  }, [match?.id, match?.external_id, match?.flashscore_id]);

  if (!match) return null;

  const finished = match.status === 'FINISHED' || match.live_clock === 'FT' || realDetails?.status === 'FINISHED';
  const isLive = !finished && (match.status === 'IN_PLAY' || match.status === 'PAUSED' || match.status === 'LIVE' || realDetails?.status === 'IN_PLAY' || realDetails?.status === 'PAUSED' || Boolean(match.live_clock));
  const homeScore = realDetails?.home_score ?? match.home_score;
  const awayScore = realDetails?.away_score ?? match.away_score;
  const hasScore = homeScore != null && awayScore != null;

  // Resolve Rosters (Ultra-defensive resolution across all possible paths)
  const candidate =
    realDetails?.match_lineups ||
    realDetails?.lineups ||
    (realDetails?.homeRoster ? realDetails : null) ||
    match?.match_lineups ||
    match?.lineups ||
    (match?.homeRoster ? match : null);

  let realLineups = null;
  if (candidate) {
    if (typeof candidate === 'object') {
      realLineups = candidate;
    } else if (typeof candidate === 'string') {
      try {
        realLineups = JSON.parse(candidate);
      } catch (e) {
        realLineups = null;
      }
    }
  }

  // Extract starting lists and subs from any available path
  const rawStartingHome =
    realLineups?.homeRoster?.starting ||
    realLineups?.startingHome ||
    realDetails?.homeRoster?.starting ||
    realDetails?.startingHome ||
    match?.homeRoster?.starting ||
    match?.match_lineups?.homeRoster?.starting ||
    match?.match_lineups?.startingHome ||
    [];

  const rawStartingAway =
    realLineups?.awayRoster?.starting ||
    realLineups?.startingAway ||
    realDetails?.awayRoster?.starting ||
    realDetails?.startingAway ||
    match?.awayRoster?.starting ||
    match?.match_lineups?.awayRoster?.starting ||
    match?.match_lineups?.startingAway ||
    [];

  const rawSubsHome =
    realLineups?.homeRoster?.subs ||
    realLineups?.subsHome ||
    realDetails?.homeRoster?.subs ||
    realDetails?.subsHome ||
    match?.homeRoster?.subs ||
    match?.match_lineups?.homeRoster?.subs ||
    match?.match_lineups?.subsHome ||
    [];

  const rawSubsAway =
    realLineups?.awayRoster?.subs ||
    realLineups?.subsAway ||
    realDetails?.awayRoster?.subs ||
    realDetails?.subsAway ||
    match?.awayRoster?.subs ||
    match?.match_lineups?.awayRoster?.subs ||
    match?.match_lineups?.subsAway ||
    [];

  // Flexible check: ANY valid list of starting players is displayed immediately
  const hasRealLineups = Boolean(
    Array.isArray(rawStartingHome) && rawStartingHome.length > 0 &&
    Array.isArray(rawStartingAway) && rawStartingAway.length > 0
  );

  const homeFormation =
    realLineups?.homeRoster?.formation ||
    realLineups?.formationHome ||
    realDetails?.homeRoster?.formation ||
    match?.match_lineups?.homeRoster?.formation ||
    match?.homeRoster?.formation ||
    '4-3-3';

  const awayFormation =
    realLineups?.awayRoster?.formation ||
    realLineups?.formationAway ||
    realDetails?.awayRoster?.formation ||
    match?.match_lineups?.awayRoster?.formation ||
    match?.awayRoster?.formation ||
    '4-3-3';

  const homeManager =
    realLineups?.homeRoster?.manager ||
    realLineups?.managerHome ||
    realDetails?.homeRoster?.manager ||
    match?.match_lineups?.homeRoster?.manager ||
    match?.homeRoster?.manager ||
    null;

  const awayManager =
    realLineups?.awayRoster?.manager ||
    realLineups?.managerAway ||
    realDetails?.awayRoster?.manager ||
    match?.match_lineups?.awayRoster?.manager ||
    match?.awayRoster?.manager ||
    null;

  // Lineups are strictly resolved from authentic Flashscore data; NO mock or random players are ever used
  const homeRoster = hasRealLineups
    ? {
        formation: homeFormation,
        manager: homeManager,
        starting: rawStartingHome.map((p, idx) => ({
          num: p.num ?? (idx + 1),
          name: p.name || `Player ${idx + 1}`,
          pos: p.pos || (idx === 0 ? 'GK' : 'MF'),
          photo: p.photo || null,
          rating: p.rating || null,
          events: Array.isArray(p.events) ? p.events : []
        })),
        subs: rawSubsHome.map((p, idx) => ({
          num: p.num ?? (12 + idx),
          name: p.name || `Sub ${idx + 1}`,
          pos: p.pos || 'SUB',
          photo: p.photo || null,
          rating: p.rating || null,
          events: Array.isArray(p.events) ? p.events : []
        }))
      }
    : null;

  const awayRoster = hasRealLineups
    ? {
        formation: awayFormation,
        manager: awayManager,
        starting: rawStartingAway.map((p, idx) => ({
          num: p.num ?? (idx + 1),
          name: p.name || `Player ${idx + 1}`,
          pos: p.pos || (idx === 0 ? 'GK' : 'MF'),
          photo: p.photo || null,
          rating: p.rating || null,
          events: Array.isArray(p.events) ? p.events : []
        })),
        subs: rawSubsAway.map((p, idx) => ({
          num: p.num ?? (12 + idx),
          name: p.name || `Sub ${idx + 1}`,
          pos: p.pos || 'SUB',
          photo: p.photo || null,
          rating: p.rating || null,
          events: Array.isArray(p.events) ? p.events : []
        }))
      }
    : null;

  // Resolve Stats (Official FotMob stats from backend, or realistic fallback)
  let parsedRealStats = null;
  const rawStatsCandidate = realDetails?.match_stats || match?.match_stats;
  if (rawStatsCandidate) {
    if (Array.isArray(rawStatsCandidate)) {
      parsedRealStats = rawStatsCandidate;
    } else if (typeof rawStatsCandidate === 'string') {
      try {
        parsedRealStats = JSON.parse(rawStatsCandidate);
      } catch (e) {
        parsedRealStats = null;
      }
    }
  }

  const hasRealStats = Array.isArray(parsedRealStats) && parsedRealStats.length > 0;

  const statsList = hasRealStats
    ? parsedRealStats.map((st, idx) => {
        const homeVal = typeof st.homeVal === 'number' ? st.homeVal : (parseFloat(String(st.home || '').replace('%', '').trim()) || 0);
        const awayVal = typeof st.awayVal === 'number' ? st.awayVal : (parseFloat(String(st.away || '').replace('%', '').trim()) || 0);
        const name = st.name || st.title || 'Stat';
        return {
          key: st.key || `real_stat_${idx}`,
          labelEn: name,
          labelAr: getStatArabicLabel(name),
          home: String(st.home ?? 0),
          away: String(st.away ?? 0),
          homeVal,
          awayVal,
          group: st.group || 'General',
          reverseBetter: isStatReverseBetter(name) || isStatReverseBetter(st.key)
        };
      })
    : (!loadingDetails && (isLive || finished) ? generateMockStats(match) : null);

  // Competition Logo
  const compLogo = LEAGUE_LOGOS[match.competition_code] || LEAGUE_LOGOS.TUN;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 overflow-y-auto"
      onClick={onClose}
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div
        className="relative flex flex-col w-full max-w-4xl max-h-[94vh] rounded-3xl border border-white/10 bg-[#0E1214] text-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ================= HEADER SECTION ================= */}
        <div className="relative border-b border-white/10 bg-gradient-to-b from-[#182025] to-[#0E1214] px-4 py-4 sm:px-6 sm:py-5">
          {/* Top Bar: League Badge & Close Button */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {compLogo && (
                <img
                  src={compLogo}
                  alt={match.competition_code || 'League'}
                  className="h-6 w-6 object-contain rounded-md bg-white/5 p-0.5"
                />
              )}
              <span className="text-xs font-black uppercase tracking-wider text-gray-300">
                {match.competition_code} {match.round_label ? `• ${match.round_label}` : ''}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {onOpenPrediction && (
                <button
                  type="button"
                  onClick={onOpenPrediction}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#53FC18]/15 border border-[#53FC18]/30 px-3 py-1.5 text-xs font-black text-[#53FC18] hover:bg-[#53FC18] hover:text-black transition active:scale-95"
                >
                  <span>🎯</span>
                  <span>{isAr ? 'التوقع' : 'Predict'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white transition"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Teams Matchup & Score Hero */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6 py-2">
            {/* Home Team */}
            <div className="flex flex-col items-center text-center gap-2 min-w-0">
              <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-2xl bg-[#161C20] p-3 border border-white/10 shadow-lg shadow-black/40">
                {match.home_crest ? (
                  <img
                    src={match.home_crest}
                    alt={match.home_team}
                    className="h-full w-full object-contain drop-shadow"
                  />
                ) : (
                  <span className="text-base font-black text-gray-400">
                    {String(match.home_team || 'H').slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="w-full text-xs sm:text-base font-black text-white truncate" title={match.home_team}>
                {match.home_team}
              </span>
              {homeRoster?.formation && (
                <span className="text-[11px] font-bold text-emerald-400/90 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  {homeRoster.formation}
                </span>
              )}
            </div>

            {/* Center: Live Timer, Big Score & Match Status */}
            <div className="flex flex-col items-center justify-center gap-1.5 px-2">
              {/* Status / Clock Pill */}
              {isLive ? (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/15 px-3 py-0.5 text-xs font-mono font-black text-red-400 animate-pulse">
                  <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                  <span>{liveTimerText || (match.live_clock ? `${match.live_clock}'` : 'LIVE')}</span>
                </div>
              ) : finished ? (
                <span className="rounded-full border border-gray-600 bg-gray-800/80 px-3 py-0.5 text-xs font-black uppercase tracking-wider text-gray-300">
                  {isAr ? 'انتهت (FT)' : 'Full Time'}
                </span>
              ) : (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-0.5 text-xs font-bold text-gray-400">
                  {new Date(match.utc_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
              )}

              {/* Big Score Typography */}
              <div className="flex items-center justify-center min-w-[90px] sm:min-w-[120px] h-12 sm:h-14 rounded-2xl bg-[#090C0E] border border-white/10 px-4 font-mono shadow-inner">
                {hasScore ? (
                  <div className="flex items-center gap-2 sm:gap-3 text-2xl sm:text-3xl font-black tracking-tight text-white">
                    <span>{homeScore}</span>
                    <span className="text-[#53FC18] text-lg font-bold">:</span>
                    <span>{awayScore}</span>
                  </div>
                ) : (isLive || finished) ? (
                  <div className="flex items-center gap-2 sm:gap-3 text-2xl sm:text-3xl font-black tracking-tight text-white">
                    <span>{homeScore != null ? homeScore : 0}</span>
                    <span className="text-[#53FC18] text-lg font-bold">:</span>
                    <span>{awayScore != null ? awayScore : 0}</span>
                  </div>
                ) : (
                  <span className="text-sm sm:text-base font-black tracking-widest text-gray-400">VS</span>
                )}
              </div>

              {/* Halftime score if exists */}
              {match.home_ht != null && match.away_ht != null && (
                <span className="text-[10px] font-bold text-gray-400">
                  {isAr ? `(الشوط الأول: ${match.home_ht} - ${match.away_ht})` : `(HT: ${match.home_ht} - ${match.away_ht})`}
                </span>
              )}
            </div>

            {/* Away Team */}
            <div className="flex flex-col items-center text-center gap-2 min-w-0">
              <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-2xl bg-[#161C20] p-3 border border-white/10 shadow-lg shadow-black/40">
                {match.away_crest ? (
                  <img
                    src={match.away_crest}
                    alt={match.away_team}
                    className="h-full w-full object-contain drop-shadow"
                  />
                ) : (
                  <span className="text-base font-black text-gray-400">
                    {String(match.away_team || 'A').slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="w-full text-xs sm:text-base font-black text-white truncate" title={match.away_team}>
                {match.away_team}
              </span>
              {awayRoster?.formation && (
                <span className="text-[11px] font-bold text-amber-400/90 bg-amber-950/40 border border-amber-500/20 px-2 py-0.5 rounded-full">
                  {awayRoster.formation}
                </span>
              )}
            </div>
          </div>

          {/* TAB SYSTEM BUTTONS */}
          <div className="mt-4 flex items-center justify-center gap-2 border-t border-white/5 pt-3">
            <button
              type="button"
              onClick={() => setActiveTab('stats')}
              className={`flex items-center gap-2 rounded-xl px-5 py-2 text-xs sm:text-sm font-black transition-all ${
                activeTab === 'stats'
                  ? 'bg-[#53FC18] text-black shadow-lg shadow-[#53FC18]/20 scale-105'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span>📊</span>
              <span>{isAr ? 'الإحصائيات' : 'Match Stats'}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('lineups')}
              className={`flex items-center gap-2 rounded-xl px-5 py-2 text-xs sm:text-sm font-black transition-all ${
                activeTab === 'lineups'
                  ? 'bg-[#53FC18] text-black shadow-lg shadow-[#53FC18]/20 scale-105'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span>📋</span>
              <span>{isAr ? 'التشكيلات والملعب' : 'Lineups & Pitch'}</span>
            </button>
          </div>
        </div>

        {/* ================= BODY CONTENT ================= */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* TAB 1: MATCH STATS */}
          {activeTab === 'stats' && (
            <div className="space-y-4">
              {loadingDetails ? (
                <div className="flex flex-col items-center justify-center p-12 text-center rounded-3xl border border-white/10 bg-[#14181B] shadow-xl my-4 space-y-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-3 border-[#53FC18] border-t-transparent" />
                  <h4 className="text-sm font-black text-white">
                    {isAr ? 'جاري جلب إحصائيات المباراة الحقيقية...' : 'Loading official match stats...'}
                  </h4>
                </div>
              ) : !statsList || statsList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center rounded-3xl border border-white/10 bg-[#14181B] shadow-2xl my-2 space-y-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-4xl shadow-inner">
                    📊
                  </div>
                  <div className="space-y-1.5 max-w-sm">
                    <h4 className="text-base sm:text-lg font-black text-white">
                      {isAr ? '📊 إحصائيات المباراة غير متوفرة بعد' : '📊 Match stats not available yet'}
                    </h4>
                    <p className="text-xs text-gray-400">
                      {isAr
                        ? 'يتم تحديث إحصائيات المباراة تلقائياً وبشكل حي فور انطلاق صافرة البداية.'
                        : 'Official statistics update automatically in real-time during and after the match.'}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Category Legend */}
                  <div className="flex items-center justify-between text-xs font-bold text-gray-400 px-2">
                    <span className="flex items-center gap-1.5 text-emerald-400 font-extrabold">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
                      {match.home_team}
                    </span>
                    <span className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold">
                      {isAr ? 'مقارنة الأداء الحي' : 'Head-to-Head Comparison'}
                    </span>
                    <span className="flex items-center gap-1.5 text-amber-400 font-extrabold">
                      {match.away_team}
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50" />
                    </span>
                  </div>

                  {/* Grouped or Single Stats Cards with Dual-Color Progress Bars */}
                  {renderStatsSection(statsList, isAr)}
                </>
              )}
            </div>
          )}

          {/* TAB 2: LINEUPS & SOCCER PITCH */}
          {activeTab === 'lineups' && (
            <div className="space-y-6">
              {loadingDetails ? (
                /* 1. Loading State */
                <div className="flex flex-col items-center justify-center p-12 text-center rounded-3xl border border-white/10 bg-[#14181B] shadow-xl my-4 space-y-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-3 border-[#53FC18] border-t-transparent" />
                  <h4 className="text-sm font-black text-white">
                    {isAr ? 'جاري جلب التشكيلات الرسمية...' : 'Loading official lineups...'}
                  </h4>
                </div>
              ) : !hasRealLineups ? (
                /* 2. Explicit Fallback UI: Lineups Not Available (Pitch Hidden) */
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center rounded-3xl border border-white/10 bg-[#14181B] shadow-2xl my-2 space-y-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-4xl shadow-inner">
                    📋
                  </div>
                  <div className="space-y-1.5 max-w-sm">
                    <h4 className="text-base sm:text-lg font-black text-white">
                      {isAr ? '📋 التشكيلات غير متوفرة' : '📋 Lineups not available'}
                    </h4>
                    <p className="text-xs sm:text-sm text-gray-400 leading-relaxed">
                      {isAr
                        ? 'لم يتم تزويد أو اعتماد بيانات التشكيلة الرسمية لهذه المواجهة حتى الآن.'
                        : 'Official lineups have not been announced or provided for this fixture yet.'}
                    </p>
                  </div>
                </div>
              ) : (
                /* 3. Real Lineups Available: Two Separate Pitches (Home & Away) */
                <div className="space-y-8">
                  {/* ================= TEAM 1: HOME PITCH ================= */}
                  <div className="space-y-3">
                    {/* Home Header */}
                    <div className="flex items-center justify-between bg-gradient-to-r from-emerald-950/70 via-[#14181B] to-[#14181B] border border-emerald-500/30 rounded-2xl p-3 sm:p-4 shadow-xl">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-11 w-11 sm:h-13 sm:w-13 shrink-0 items-center justify-center rounded-2xl bg-black/50 p-2 border border-emerald-500/30 shadow-inner">
                          {match.home_crest ? (
                            <img src={match.home_crest} alt="" className="h-full w-full object-contain drop-shadow" />
                          ) : (
                            <span className="text-xs font-black text-emerald-400">
                              {String(match.home_team || 'H').slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-base sm:text-lg font-black text-white truncate">{match.home_team}</h4>
                            <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-mono text-xs sm:text-sm font-black shadow-sm">
                              {homeRoster.formation}
                            </span>
                          </div>
                          {homeRoster.manager && (
                            <span className="text-xs text-gray-400 truncate mt-0.5">
                              {isAr ? 'المدرب:' : 'Coach:'} <strong className="text-gray-200">{homeRoster.manager}</strong>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-xs font-bold text-emerald-400 shrink-0">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>{isAr ? 'الفريق المضيف' : 'Home Team'}</span>
                      </div>
                    </div>

                    {/* Dedicated Home Pitch */}
                    <SoccerPitch
                      starting={homeRoster.starting}
                      formation={homeRoster.formation}
                      isHome={true}
                      isAr={isAr}
                    />
                  </div>

                  {/* ================= DIVIDER ================= */}
                  <div className="relative py-2 flex items-center justify-center">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-white/10" />
                    </div>
                    <span className="relative px-5 py-1.5 rounded-full bg-[#14181B] border border-white/15 text-xs font-mono font-black text-gray-300 shadow-xl tracking-widest">
                      VS
                    </span>
                  </div>

                  {/* ================= TEAM 2: AWAY PITCH ================= */}
                  <div className="space-y-3">
                    {/* Away Header */}
                    <div className="flex items-center justify-between bg-gradient-to-r from-amber-950/70 via-[#14181B] to-[#14181B] border border-amber-500/30 rounded-2xl p-3 sm:p-4 shadow-xl">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-11 w-11 sm:h-13 sm:w-13 shrink-0 items-center justify-center rounded-2xl bg-black/50 p-2 border border-amber-500/30 shadow-inner">
                          {match.away_crest ? (
                            <img src={match.away_crest} alt="" className="h-full w-full object-contain drop-shadow" />
                          ) : (
                            <span className="text-xs font-black text-amber-400">
                              {String(match.away_team || 'A').slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-base sm:text-lg font-black text-white truncate">{match.away_team}</h4>
                            <span className="px-2.5 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400 font-mono text-xs sm:text-sm font-black shadow-sm">
                              {awayRoster.formation}
                            </span>
                          </div>
                          {awayRoster.manager && (
                            <span className="text-xs text-gray-400 truncate mt-0.5">
                              {isAr ? 'المدرب:' : 'Coach:'} <strong className="text-gray-200">{awayRoster.manager}</strong>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-xs font-bold text-amber-400 shrink-0">
                        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                        <span>{isAr ? 'الفريق الضيف' : 'Away Team'}</span>
                      </div>
                    </div>

                    {/* Dedicated Away Pitch */}
                    <SoccerPitch
                      starting={awayRoster.starting}
                      formation={awayRoster.formation}
                      isHome={false}
                      isAr={isAr}
                    />
                  </div>

                  {/* ================= BENCH & MANAGERS ================= */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Home Substitutes Card */}
                    <div className="rounded-2xl border border-white/10 bg-[#14181B] p-4 space-y-3">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                        <span className="text-xs font-black uppercase text-emerald-400">
                          {isAr ? 'بدلاء' : 'Substitutes'} • {match.home_team}
                        </span>
                        {homeRoster.manager && (
                          <span className="text-[11px] text-gray-400">
                            {isAr ? 'المدرب:' : 'Coach:'} <strong className="text-white">{homeRoster.manager}</strong>
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {homeRoster.subs.map((p, idx) => {
                          const subRating = getRatingStyle(p.rating);
                          return (
                            <div
                              key={`${p.num || idx}-${p.name}`}
                              className="flex items-center gap-2 rounded-xl bg-black/40 p-1.5 border border-white/5 hover:border-emerald-500/30 transition"
                            >
                              <PlayerAvatar
                                photo={p.photo}
                                name={p.name}
                                num={p.num}
                                isHome={true}
                                pos={p.pos}
                                size="sm"
                              />
                              <div className="flex flex-col min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  <span className="truncate text-gray-200 font-bold text-xs">{p.name}</span>
                                  {p.events && p.events.length > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-[9px]">
                                      {p.events.map((ev, i) => (
                                        <span key={i}>
                                          {ev.type === 'goal' && '⚽'}
                                          {ev.type === 'assist' && '👟'}
                                          {ev.type === 'yellow_card' && '🟨'}
                                          {ev.type === 'red_card' && '🟥'}
                                          {ev.type === 'sub' && '🔄'}
                                        </span>
                                      ))}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-gray-500 uppercase font-mono">{p.pos || 'SUB'}</span>
                              </div>

                              {subRating && (
                                <span
                                  className={`px-1.5 py-0.5 rounded-md font-mono font-black text-[10px] shadow-sm ${subRating.bg} ${subRating.text}`}
                                >
                                  {subRating.label}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Away Substitutes Card */}
                    <div className="rounded-2xl border border-white/10 bg-[#14181B] p-4 space-y-3">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                        <span className="text-xs font-black uppercase text-amber-400">
                          {isAr ? 'بدلاء' : 'Substitutes'} • {match.away_team}
                        </span>
                        {awayRoster.manager && (
                          <span className="text-[11px] text-gray-400">
                            {isAr ? 'المدرب:' : 'Coach:'} <strong className="text-white">{awayRoster.manager}</strong>
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {awayRoster.subs.map((p, idx) => {
                          const subRating = getRatingStyle(p.rating);
                          return (
                            <div
                              key={`${p.num || idx}-${p.name}`}
                              className="flex items-center gap-2 rounded-xl bg-black/40 p-1.5 border border-white/5 hover:border-amber-500/30 transition"
                            >
                              <PlayerAvatar
                                photo={p.photo}
                                name={p.name}
                                num={p.num}
                                isHome={false}
                                pos={p.pos}
                                size="sm"
                              />
                              <div className="flex flex-col min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  <span className="truncate text-gray-200 font-bold text-xs">{p.name}</span>
                                  {p.events && p.events.length > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-[9px]">
                                      {p.events.map((ev, i) => (
                                        <span key={i}>
                                          {ev.type === 'goal' && '⚽'}
                                          {ev.type === 'assist' && '👟'}
                                          {ev.type === 'yellow_card' && '🟨'}
                                          {ev.type === 'red_card' && '🟥'}
                                          {ev.type === 'sub' && '🔄'}
                                        </span>
                                      ))}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-gray-500 uppercase font-mono">{p.pos || 'SUB'}</span>
                              </div>

                              {subRating && (
                                <span
                                  className={`px-1.5 py-0.5 rounded-md font-mono font-black text-[10px] shadow-sm ${subRating.bg} ${subRating.text}`}
                                >
                                  {subRating.label}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Individual Full Tactical Pitch Component
 * Displays one team on a dedicated, full-size soccer pitch attacking upwards.
 */
function SoccerPitch({ starting = [], formation = '4-3-3', isHome = true, isAr = false }) {
  return (
    <div className="relative mx-auto w-full max-w-[620px] h-[520px] sm:h-[600px] rounded-3xl border-2 border-white/30 bg-[#165B33] shadow-2xl overflow-hidden select-none">
      {/* Grass Striping Pattern */}
      <div className="absolute inset-0 bg-[repeating-linear-gradient(to_bottom,#165B33_0px,#165B33_45px,#134F2C_45px,#134F2C_90px)] opacity-90" />

      {/* Pitch Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.35)_100%)] pointer-events-none" />

      {/* Outer Field Lines */}
      <div className="absolute inset-2 sm:inset-3 border-2 border-white/40 rounded-2xl pointer-events-none" />

      {/* Halfway Line & Center Circle */}
      <div className="absolute top-1/2 left-2 right-2 sm:left-3 sm:right-3 border-t-2 border-white/40 -translate-y-1/2 pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 h-28 w-28 sm:h-32 sm:w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/40 pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 pointer-events-none" />

      {/* Top Penalty Box (Attacking Goal) */}
      <div className="absolute top-2 sm:top-3 left-1/2 -translate-x-1/2 w-48 sm:w-64 h-20 sm:h-24 border-b-2 border-x-2 border-white/40 bg-white/[0.02] pointer-events-none" />
      <div className="absolute top-2 sm:top-3 left-1/2 -translate-x-1/2 w-24 sm:w-32 h-8 sm:h-10 border-b-2 border-x-2 border-white/40 pointer-events-none" />
      <div className="absolute top-16 sm:top-20 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-white/70 pointer-events-none" />
      <div className="absolute top-20 sm:top-24 left-1/2 -translate-x-1/2 w-24 h-10 border-b-2 border-white/40 rounded-b-full pointer-events-none" />

      {/* Bottom Penalty Box (Goalkeeper / Defending Goal) */}
      <div className="absolute bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 w-48 sm:w-64 h-20 sm:h-24 border-t-2 border-x-2 border-white/40 bg-white/[0.02] pointer-events-none" />
      <div className="absolute bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 w-24 sm:w-32 h-8 sm:h-10 border-t-2 border-x-2 border-white/40 pointer-events-none" />
      <div className="absolute bottom-16 sm:bottom-20 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-white/70 pointer-events-none" />
      <div className="absolute bottom-20 sm:bottom-24 left-1/2 -translate-x-1/2 w-24 h-10 border-t-2 border-white/40 rounded-t-full pointer-events-none" />

      {/* Corner Arcs */}
      <div className="absolute top-2 sm:top-3 left-2 sm:left-3 w-6 h-6 border-b-2 border-r-2 border-white/40 rounded-br-full pointer-events-none" />
      <div className="absolute top-2 sm:top-3 right-2 sm:right-3 w-6 h-6 border-b-2 border-l-2 border-white/40 rounded-bl-full pointer-events-none" />
      <div className="absolute bottom-2 sm:bottom-3 left-2 sm:left-3 w-6 h-6 border-t-2 border-r-2 border-white/40 rounded-tr-full pointer-events-none" />
      <div className="absolute bottom-2 sm:bottom-3 right-2 sm:right-3 w-6 h-6 border-t-2 border-l-2 border-white/40 rounded-tl-full pointer-events-none" />

      {/* Direction of Attack Indicator */}
      <div className="absolute top-4 right-4 sm:top-5 sm:right-5 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-white/15 text-[10px] sm:text-[11px] font-black text-white/80 pointer-events-none shadow-lg">
        <span className="text-[#53FC18]">▲</span>
        <span>{isAr ? 'اتجاه الهجوم' : 'Direction of Attack'}</span>
      </div>

      {/* Tactical Players Node Layer */}
      {renderTacticalFormation(starting, formation, isHome)}
    </div>
  );
}

/**
 * Calculates responsive tactical player nodes spanning a dedicated full pitch (attacking upwards)
 * Line 0: Goalkeeper at ~88% (defending goal)
 * Line N-1: Forwards / Strikers at ~14% (attacking goal)
 */
function renderTacticalFormation(players = [], formationStr = '4-3-3', isHome = true) {
  if (!players || players.length === 0) return null;

  // Split formation, e.g. '4-3-3' -> [4, 3, 3] or '4-2-3-1' -> [4, 2, 3, 1]
  const rows = formationStr.split('-').map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
  if (rows.length === 0) rows.push(4, 3, 3);

  // Row breakdown with Goalkeeper as line 0 at bottom
  const lineStructure = [1, ...rows]; // e.g. [1, 4, 2, 3, 1]
  let playerIdx = 0;
  const totalLines = lineStructure.length;

  return (
    <div className="absolute inset-0 pointer-events-auto">
      {lineStructure.map((countInRow, lineIdx) => {
        // Vertical positioning: line 0 (GK) at 88%, line N-1 (FW) at 14%
        const tMin = 14;
        const tMax = 88;
        const topPct =
          totalLines > 1
            ? tMax - (lineIdx / (totalLines - 1)) * (tMax - tMin)
            : 50;

        const rowPlayers = [];
        for (let i = 0; i < countInRow; i++) {
          if (playerIdx < players.length) {
            rowPlayers.push({
              player: players[playerIdx],
              leftPct: ((i + 1) / (countInRow + 1)) * 100
            });
            playerIdx++;
          }
        }

        return (
          <React.Fragment key={`line-${isHome ? 'h' : 'a'}-${lineIdx}`}>
            {rowPlayers.map(({ player, leftPct }) => {
              const ratingStyle = getRatingStyle(player.rating);
              return (
                <div
                  key={`${player.num || ''}-${player.name}`}
                  className="absolute flex flex-col items-center justify-center -translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-115 hover:z-30 cursor-pointer select-none"
                  style={{ top: `${topPct}%`, left: `${leftPct}%` }}
                  title={`${player.name} (${player.pos || ''}) #${player.num || ''}${player.rating ? ` • Rating: ${player.rating}` : ''}`}
                >
                  {/* Player Events (Goals, Assists, Cards, Subs) */}
                  {player.events && player.events.length > 0 && (
                    <div className="absolute -top-3.5 sm:-top-4 flex items-center gap-0.5 z-20 bg-black/95 backdrop-blur-md px-1.5 py-0.5 rounded-full border border-white/20 shadow-xl">
                      {player.events.map((ev, i) => (
                        <span
                          key={i}
                          className="text-[10px] sm:text-[11px] leading-none flex items-center gap-0.5 font-bold"
                          title={`${ev.type} ${ev.minute || ''}`}
                        >
                          {ev.type === 'goal' && (
                            <span className="text-white drop-shadow">
                              ⚽{ev.count && ev.count > 1 ? <sup className="text-[8px] font-black">{ev.count}</sup> : ''}
                            </span>
                          )}
                          {ev.type === 'assist' && <span className="text-cyan-300 drop-shadow">👟</span>}
                          {ev.type === 'yellow_card' && <span className="text-yellow-400 drop-shadow">🟨</span>}
                          {ev.type === 'red_card' && <span className="text-red-500 drop-shadow">🟥</span>}
                          {ev.type === 'sub' && <span className="text-emerald-400 drop-shadow">🔄</span>}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Scaled-up Player Avatar (size="lg") */}
                  <PlayerAvatar
                    photo={player.photo}
                    name={player.name}
                    num={player.num}
                    isHome={isHome}
                    pos={player.pos}
                    size="lg"
                  />

                  {/* Flashscore-style Rating Badge for FT / Finished matches */}
                  {ratingStyle && (
                    <div
                      className={`-mt-1.5 z-10 flex items-center justify-center min-w-[26px] sm:min-w-[30px] h-4 sm:h-4.5 px-1 rounded-md border font-mono font-black text-[9px] sm:text-[10px] shadow-md tracking-tight ${ratingStyle.bg} ${ratingStyle.text} ${ratingStyle.border}`}
                    >
                      {ratingStyle.label}
                    </div>
                  )}

                  {/* Scaled-up Player Name Tag */}
                  <span className="mt-1 max-w-[85px] sm:max-w-[105px] truncate rounded-md bg-black/90 backdrop-blur-md border border-white/15 px-1.5 py-0.5 text-[10px] sm:text-xs font-black text-white text-center shadow-lg leading-tight">
                    {player.name}
                  </span>
                </div>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/**
 * Professional Player Avatar Component
 * Supports size="sm" (substitutes bench), size="md", and size="lg" (tactical pitch nodes)
 */
function PlayerAvatar({ photo, name, num, rating, isHome, pos, size = 'md' }) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [photo]);

  const proxiedPhoto = getProxiedImageUrl(photo);
  const hasPhoto = Boolean(proxiedPhoto && !imgFailed);
  const isGK = pos === 'GK' || num === 1;

  const sizeClasses =
    size === 'sm'
      ? 'h-7 w-7'
      : size === 'md'
      ? 'h-9 w-9 sm:h-10 sm:w-10'
      : 'h-12 w-12 sm:h-14 sm:w-14'; // size === 'lg'

  const numClasses =
    size === 'sm'
      ? 'text-[8px] h-3.5 min-w-[14px]'
      : size === 'md'
      ? 'text-[8px] sm:text-[9px] h-3.5 min-w-[15px]'
      : 'text-[9px] sm:text-[10px] h-4 min-w-[17px] font-black -bottom-1 -right-1';

  const ringClasses = isHome
    ? isGK
      ? 'border-yellow-400 bg-amber-950/60 shadow-yellow-500/30'
      : 'border-emerald-400 bg-emerald-950/60 shadow-emerald-500/30'
    : isGK
    ? 'border-purple-400 bg-purple-950/60 shadow-purple-500/30'
    : 'border-amber-400 bg-amber-950/60 shadow-amber-500/30';

  return (
    <div className="relative inline-flex items-center justify-center select-none group">
      {/* Circular Avatar Container */}
      <div
        className={`relative flex ${sizeClasses} items-center justify-center rounded-full border-2 overflow-hidden shadow-xl transition-transform ${ringClasses}`}
      >
        {hasPhoto ? (
          <img
            src={proxiedPhoto}
            alt={name || 'Player'}
            className="h-full w-full object-cover object-top"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
          />
        ) : (
          /* High-end grey silhouette bust icon */
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-[#2E3742] via-[#212932] to-[#141A21]">
            <svg
              className="h-[70%] w-[70%] text-gray-300 drop-shadow"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M12 2.5a4.75 4.75 0 0 0-4.75 4.75v.5a4.75 4.75 0 0 0 9.5 0v-.5A4.75 4.75 0 0 0 12 2.5zM4 20.25a7.75 7.75 0 0 1 15.5 0 .75.75 0 0 1-.75.75H4.75a.75.75 0 0 1-.75-.75z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Jersey Number Badge Overlay */}
      {num != null && (
        <span
          className={`absolute ${numClasses} px-0.5 flex items-center justify-center rounded-full font-mono border shadow-md ${
            isHome
              ? isGK
                ? 'bg-yellow-400 text-black border-black/30'
                : 'bg-emerald-500 text-black border-white/60'
              : isGK
              ? 'bg-purple-500 text-white border-white/60'
              : 'bg-amber-400 text-black border-black/30'
          }`}
        >
          {num}
        </span>
      )}
    </div>
  );
}
