import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { EXTRAS, CATEGORIES, OPTION_LABELS } from '../constants/gameData';
import Chip from './Chip';
import ScoreGridModal from './ScoreGridModal';
import MatchDetailsModal from './MatchDetailsModal';

export default function MatchCard({ match, user, lang, t, onSaved, onError }) {
  const pred = match.prediction;
  const markets = match.markets_points;
  const settled = match.settled_outcomes;
  const finished = match.status === 'FINISHED' || match.live_clock === 'FT';
  const readOnly = !user || match.is_locked;

  const [outcome, setOutcome] = useState(pred?.predicted_outcome ?? null);
  const [home, setHome] = useState(pred?.predicted_home ?? '');
  const [away, setAway] = useState(pred?.predicted_away ?? '');
  const [picks, setPicks] = useState(
    Array.isArray(pred?.extras_picks) ? pred.extras_picks.map((p) => ({ market: p.market, selection: p.selection })) : []
  );
  const [cat, setCat] = useState('all');
  const [showGrid, setShowGrid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showFullTable, setShowFullTable] = useState(false);
  const [formTab, setFormTab] = useState('home');
  const [showDetails, setShowDetails] = useState(false);

  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setOutcome(pred?.predicted_outcome ?? null);
    setHome(pred?.predicted_home ?? '');
    setAway(pred?.predicted_away ?? '');
    setPicks(
      Array.isArray(pred?.extras_picks) ? pred.extras_picks.map((p) => ({ market: p.market, selection: p.selection })) : []
    );
  }, [pred]);

  useEffect(() => {
    setSyncedAt(Date.now());
    setNowMs(Date.now());
  }, [match.live_clock, match.live_seconds, match.status, match.home_score, match.away_score]);

  useEffect(() => {
    if (finished || !match.is_locked) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [finished, match.is_locked]);

  // Close modal on Escape key
  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !showGrid) setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, showGrid]);

  function getLiveTimerDisplay() {
    if (finished) return null;
    if (match.status === 'PAUSED' || match.live_clock === 'HT') {
      return lang === 'ar' ? 'استراحة (HT)' : 'HT';
    }
    const isPlaying =
      match.status === 'IN_PLAY' ||
      Boolean(match.live_clock) ||
      Number.isFinite(match.live_seconds);
    if (!isPlaying) return null;

    const deltaSec = Math.max(0, Math.floor((nowMs - syncedAt) / 1000));
    const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

    if (Number.isFinite(match.live_seconds)) {
      const totalSec = match.live_seconds + deltaSec;
      if (match.live_stoppage_base) {
        const addMin = Math.floor(totalSec / 60);
        const addSec = totalSec % 60;
        return `${match.live_stoppage_base}+${pad2(addMin)}:${pad2(addSec)}`;
      }
      const curMin = Math.floor(totalSec / 60);
      const curSec = totalSec % 60;
      if (curMin >= 45 && match.live_seconds < 45 * 60) {
        return `45+${pad2(curMin - 45)}:${pad2(curSec)}`;
      }
      if (curMin >= 90) {
        return `90+${pad2(curMin - 90)}:${pad2(curSec)}`;
      }
      return `${pad2(curMin)}:${pad2(curSec)}`;
    }

    const raw = String(match.live_clock || '').trim().replace(/'\+/g, '+');
    const kickMs = match.utc_date ? new Date(match.utc_date).getTime() : NaN;
    const baseSecOffset = Number.isFinite(kickMs)
      ? ((Math.floor((syncedAt - kickMs) / 1000) % 60) + 60) % 60
      : 0;

    const stopMatch = raw.match(/^(\d+)\s*'?\s*\+\s*(\d+)/);
    if (stopMatch) {
      const baseMin = parseInt(stopMatch[1], 10);
      const addedMin = parseInt(stopMatch[2], 10);
      const totalStopSec = addedMin * 60 + baseSecOffset + deltaSec;
      return `${baseMin}+${pad2(Math.floor(totalStopSec / 60))}:${pad2(totalStopSec % 60)}`;
    }

    const normMatch = raw.match(/^(\d+)/);
    if (normMatch) {
      const min = parseInt(normMatch[1], 10);
      const totalSec = min * 60 + baseSecOffset + deltaSec;
      const curMin = Math.floor(totalSec / 60);
      const curSec = totalSec % 60;
      if (curMin >= 45 && min < 45) {
        return `45+${pad2(curMin - 45)}:${pad2(curSec)}`;
      }
      if (curMin >= 90) {
        return `90+${pad2(curMin - 90)}:${pad2(curSec)}`;
      }
      return `${pad2(curMin)}:${pad2(curSec)}`;
    }

    return null;
  }

  const liveTimerText = getLiveTimerDisplay();

  // Points helpers (locked points win over live points)
  const outcomePts = (o) =>
    (pred && pred.predicted_outcome === o ? pred.outcome_points_locked : markets?.outcome_1x2?.[o]) ?? 0;

  const exactPts = (h, a) =>
    (pred && pred.predicted_home === h && pred.predicted_away === a
      ? pred.exact_points_locked
      : markets?.exact_score?.[`${h}-${a}`]) ?? 0;

  const extraPts = (market, selection) => {
    const locked = pred?.extras_picks?.find((p) => p.market === market && p.selection === selection);
    return locked ? locked.points_locked : markets?.extras?.[market]?.[selection] ?? 0;
  };

  const scoreFilled = home !== '' && away !== '';
  const scoreValid =
    scoreFilled && Number.isInteger(Number(home)) && Number.isInteger(Number(away));

  const extrasPointsSum = picks.reduce((sum, p) => sum + extraPts(p.market, p.selection), 0);

  const potential =
    (outcome ? outcomePts(outcome) : 0) +
    (scoreValid ? exactPts(Number(home), Number(away)) : 0) +
    extrasPointsSum;

  const hasAnyPick = Boolean(outcome) || scoreValid || picks.length > 0;

  // Compute min-max ranges for display badges
  const outcomeValues = ['HOME', 'DRAW', 'AWAY'].map((k) => outcomePts(k)).filter((v) => v > 0);
  const minOutcomePts = outcomeValues.length ? Math.min(...outcomeValues) : 10;
  const maxOutcomePts = outcomeValues.length ? Math.max(...outcomeValues) : 15;

  const exactValues = markets?.exact_score ? Object.values(markets.exact_score).filter((v) => v > 0) : [];
  const minExactPts = exactValues.length ? Math.min(...exactValues) : 25;
  const maxExactPts = exactValues.length ? Math.max(...exactValues) : 110;

  function scoreChange(setter) {
    return (e) => {
      const v = e.target.value;
      if (v === '' || (/^\d$/.test(v) && Number(v) <= 7)) setter(v);
    };
  }

  function toggleExtra(market, selection) {
    if (readOnly) return;
    const existing = picks.find((p) => p.market === market);
    if (existing && existing.selection === selection) {
      setPicks(picks.filter((p) => p.market !== market));
    } else if (existing) {
      setPicks(picks.map((p) => (p.market === market ? { market, selection } : p)));
    } else if (picks.length >= 3) {
      onError(t.maxExtras);
    } else {
      setPicks([...picks, { market, selection }]);
    }
  }

  async function submit(e) {
    if (e) e.preventDefault();
    if (home !== '' && away === '') return onError(t.bothScores);
    if (home === '' && away !== '') return onError(t.bothScores);
    setSaving(true);
    try {
      const data = await api('/predictions', {
        method: 'POST',
        body: JSON.stringify({
          matchId: match.id,
          predictedOutcome: outcome,
          predictedHome: home === '' ? null : Number(home),
          predictedAway: away === '' ? null : Number(away),
          isBoosted: false,
          extras: picks
        })
      });
      onSaved(data.prediction, 0);
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Always replace generic HOME / AWAY labels with actual club names (match.home_team / match.away_team)
  function formatTeamOptionLabel(extra, opt) {
    const key = String(opt || '').toUpperCase();
    if (key === 'HOME') return match.home_team;
    if (key === 'AWAY') return match.away_team;
    if (key === 'HOME_ONLY') {
      return lang === 'ar' ? `${match.home_team} فقط` : `${match.home_team} ONLY`;
    }
    if (key === 'AWAY_ONLY') {
      return lang === 'ar' ? `${match.away_team} فقط` : `${match.away_team} ONLY`;
    }

    const baseLabel = String(extra?.labels?.[lang]?.[opt] ?? OPTION_LABELS[lang]?.[opt] ?? opt);
    return baseLabel
      .replace(/\bHOME ONLY\b/gi, lang === 'ar' ? `${match.home_team} فقط` : `${match.home_team} ONLY`)
      .replace(/\bAWAY ONLY\b/gi, lang === 'ar' ? `${match.away_team} فقط` : `${match.away_team} ONLY`)
      .replace(/\bHOME\b/gi, match.home_team)
      .replace(/\bAWAY\b/gi, match.away_team)
      .replace(/صاحب الأرض|المضيف/g, match.home_team)
      .replace(/الضيف/g, match.away_team);
  }

  const outcomeOptions = [
    { key: 'HOME', label: match.home_team, crest: match.home_crest },
    { key: 'DRAW', label: t.draw || (lang === 'ar' ? 'تعادل' : 'DRAW'), crest: null },
    { key: 'AWAY', label: match.away_team, crest: match.away_crest }
  ];

  const statusBadge = finished ? (
    <span className="rounded bg-gray-800 px-2 py-0.5 font-bold text-gray-300">{t.finished}</span>
  ) : match.is_locked ? (
    <span className="rounded bg-red-950 px-2 py-0.5 font-bold text-red-400">{t.live}</span>
  ) : null;

  // Standings slice helper (shows top 6 + rows around home/away teams, or full table)
  const standings = Array.isArray(match.standings) ? match.standings : [];
  function getDisplayedStandings() {
    if (showFullTable || standings.length <= 10) {
      return standings.map((r) => ({ type: 'row', data: r }));
    }
    const keepIndices = new Set([0, 1, 2, 3, 4, 5]);
    standings.forEach((r, idx) => {
      if (r.team === match.home_team || r.team === match.away_team) {
        if (idx - 1 >= 0) keepIndices.add(idx - 1);
        keepIndices.add(idx);
        if (idx + 1 < standings.length) keepIndices.add(idx + 1);
      }
    });
    const sortedIdx = Array.from(keepIndices).sort((a, b) => a - b);
    const items = [];
    let prev = -1;
    for (const idx of sortedIdx) {
      if (prev !== -1 && idx - prev > 1) {
        items.push({ type: 'gap', key: `gap-${idx}` });
      }
      if (standings[idx]) items.push({ type: 'row', data: standings[idx] });
      prev = idx;
    }
    return items;
  }

  const displayedStandings = getDisplayedStandings();
  const activeFormList =
    formTab === 'home'
      ? Array.isArray(match.home_form)
        ? match.home_form
        : []
      : Array.isArray(match.away_form)
      ? match.away_form
      : [];

  const roomStats = match.room_stats || {
    total_players: pred ? 1 : 0,
    who_wins: { label: match.home_team, pct: 68 },
    btts: { selection: 'YES', pct: 74 },
    over_under: { selection: 'OVER 2.5', pct: 79 }
  };

  const filteredExtras = cat === 'all' ? EXTRAS : EXTRAS.filter((x) => x.cat === cat);

  const displayHomeBox =
    home !== '' ? home : match.is_locked && match.home_score != null ? String(match.home_score) : '';
  const displayAwayBox =
    away !== '' ? away : match.is_locked && match.away_score != null ? String(match.away_score) : '';

  return (
    <>
      {/* Compact Match Card in Responsive Grid */}
      <div
        onClick={() => setShowDetails(true)}
        className="kp-match-card group relative flex flex-col justify-between rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 sm:p-5 shadow-lg transition-all duration-200 hover:-translate-y-1 hover:border-[#53FC18]/50 hover:shadow-2xl hover:shadow-black/60 cursor-pointer"
      >
        {/* Top Meta Line: Time & Status Badges */}
        <div className="flex items-center justify-between text-[11px] font-semibold text-gray-400 pb-2 border-b border-white/5">
          <div className="flex items-center gap-1.5 truncate">
            <span className="text-[#53FC18]">◷</span>
            <span className="truncate">
              {new Date(match.utc_date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {pred && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[#53FC18]/15 border border-[#53FC18]/30 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#53FC18]">
                <span>✓</span> {t.locked}
              </span>
            )}
            {statusBadge}
          </div>
        </div>

        {/* Teams Matchup: Opposing Home vs Away with Centered Scoreboard */}
        <div className="my-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {/* Home Team */}
          <div className="flex flex-col items-center text-center gap-1.5 min-w-0">
            <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl bg-[#111315] p-2 border border-white/5 shadow-inner transition-transform group-hover:scale-105">
              {match.home_crest ? (
                <img src={match.home_crest} alt="" className="h-full w-full object-contain drop-shadow" />
              ) : (
                <span className="text-xs font-black text-gray-400">{String(match.home_team || 'H').slice(0, 2).toUpperCase()}</span>
              )}
            </div>
            <span className="w-full truncate text-xs sm:text-sm font-extrabold text-white" title={match.home_team}>
              {match.home_team}
            </span>
          </div>

          {/* Center Scoreboard / Live Clock / VS */}
          <div className="flex flex-col items-center justify-center gap-1 px-1">
            {liveTimerText && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-black text-emerald-400 animate-pulse">
                {liveTimerText}
              </span>
            )}

            <div className="flex items-center justify-center min-w-[62px] h-10 rounded-xl bg-[#0f1214] border border-white/10 px-2.5 font-mono shadow-inner">
              {match.is_locked && match.home_score != null && match.away_score != null ? (
                <div className="flex items-center gap-1.5 text-lg font-black text-white">
                  <span>{match.home_score}</span>
                  <span className="text-[#53FC18] text-xs font-bold">:</span>
                  <span>{match.away_score}</span>
                </div>
              ) : scoreFilled ? (
                <div className="flex items-center gap-1 text-base font-black text-[#53FC18]">
                  <span>{home}</span>
                  <span className="text-gray-500 text-xs">:</span>
                  <span>{away}</span>
                </div>
              ) : (
                <span className="text-xs font-black tracking-widest text-gray-400">VS</span>
              )}
            </div>

            {/* Potential or Earned Points Preview */}
            {finished && pred?.points_awarded != null ? (
              <span className="text-[10px] font-black text-[#53FC18]">
                +{pred.points_awarded} {t.pts}
              </span>
            ) : !match.is_locked && potential > 0 ? (
              <span className="text-[10px] font-bold text-gray-400">
                {potential} {t.pts}
              </span>
            ) : null}
          </div>

          {/* Away Team */}
          <div className="flex flex-col items-center text-center gap-1.5 min-w-0">
            <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl bg-[#111315] p-2 border border-white/5 shadow-inner transition-transform group-hover:scale-105">
              {match.away_crest ? (
                <img src={match.away_crest} alt="" className="h-full w-full object-contain drop-shadow" />
              ) : (
                <span className="text-xs font-black text-gray-400">{String(match.away_team || 'A').slice(0, 2).toUpperCase()}</span>
              )}
            </div>
            <span className="w-full truncate text-xs sm:text-sm font-extrabold text-white" title={match.away_team}>
              {match.away_team}
            </span>
          </div>
        </div>

        {/* Card Footer: Match Status & Modern Action Button */}
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {finished ? (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-white/5 text-gray-400 border border-white/5">
                {lang === 'ar' ? 'انتهت' : 'FT'}
              </span>
            ) : match.is_locked ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-red-500/15 text-red-400 border border-red-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-ping" />
                {lang === 'ar' ? 'مباشر' : 'LIVE'}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-[#53FC18]/10 text-[#53FC18] border border-[#53FC18]/20">
                {lang === 'ar' ? 'متاح للتوقع' : 'OPEN'}
              </span>
            )}

            {/* Direct Match Details Pill Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowDetails(true);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition active:scale-95"
              title={lang === 'ar' ? 'عرض تفاصيل المباراة والتشكيلات' : 'View match details and lineups'}
            >
              <span>📊</span>
              <span>{lang === 'ar' ? 'التفاصيل' : 'Details'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
            className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-150 active:scale-95 shadow-md ${
              pred
                ? 'bg-[#152417] text-[#53FC18] border border-[#53FC18]/40 hover:bg-[#53FC18] hover:text-black hover:shadow-[#53FC18]/20'
                : 'bg-[#53FC18] text-black hover:bg-[#45dc12] hover:shadow-[#53FC18]/25'
            }`}
          >
            <span>{pred ? (lang === 'ar' ? 'عرض التوقع' : 'View Picks') : (lang === 'ar' ? 'توقع الآن' : 'Play')}</span>
            <span className="text-sm">↗</span>
          </button>
        </div>
      </div>

      {/* Full-Screen Match Center Modal */}
      {expanded && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md p-3 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          {/* Top Action Bar */}
          <div className="mx-auto mb-4 flex max-w-[1440px] items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-full bg-[#F0C72F] px-4 py-1.5 text-xs font-black uppercase tracking-wider text-black shadow hover:brightness-110"
              >
                <span>🖨️</span>
                <span>{lang === 'ar' ? 'طباعة التذكرة' : 'PRINT TICKET'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowDetails(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600/90 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-white shadow hover:bg-emerald-500"
              >
                <span>📊</span>
                <span>{lang === 'ar' ? 'الإحصائيات والتشكيلات' : 'STATS & LINEUPS'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-white shadow hover:bg-red-500"
            >
              <span>✕</span>
              <span>{lang === 'ar' ? 'إغلاق' : 'CLOSE'}</span>
            </button>
          </div>

          {/* Main 3-Column Match Center Layout */}
          <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 xl:grid-cols-[260px_1fr_310px]">
            {/* LEFT COLUMN: LEAGUE TABLE */}
            <div className="flex flex-col justify-between rounded-2xl border border-[#242C30] bg-[#0B0E0F]/95 p-4 shadow-2xl">
              <div>
                <div className="mb-3 flex items-center justify-between border-b border-[#242C30] pb-2.5">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-white">
                    <span className="text-[#F0C72F]">🏆</span>
                    <span>{lang === 'ar' ? 'جدول الترتيب' : 'TABLE'}</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">PTS</span>
                </div>

                {displayedStandings.length === 0 ? (
                  <div className="py-8 text-center text-xs text-gray-500">
                    {lang === 'ar' ? 'لا تتوفر بيانات الترتيب بعد' : 'Standings not available yet'}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {displayedStandings.map((item) => {
                      if (item.type === 'gap') {
                        return (
                          <div key={item.key} className="py-0.5 text-center text-xs text-gray-600">
                            •••
                          </div>
                        );
                      }
                      const r = item.data;
                      const isMatchTeam = r.team === match.home_team || r.team === match.away_team;
                      return (
                        <div
                          key={r.team}
                          className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition ${
                            isMatchTeam
                              ? 'border-l-2 border-[#F0C72F] bg-[#3B1D1E] font-extrabold text-white'
                              : 'text-gray-300 hover:bg-[#14191B]'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="w-4 text-[11px] font-bold text-gray-500">{r.rank}</span>
                            {r.crest && <img src={r.crest} alt="" className="h-4 w-4 shrink-0 object-contain" />}
                            <span className="truncate uppercase tracking-tight">{r.team}</span>
                          </div>
                          <span className="ml-2 font-mono text-sm font-black text-white">{r.points}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {standings.length > 8 && (
                <button
                  type="button"
                  onClick={() => setShowFullTable(!showFullTable)}
                  className="mt-4 w-full rounded-lg border border-[#242C30] bg-[#14191B] py-2 text-[11px] font-extrabold uppercase tracking-wider text-gray-300 transition hover:border-gray-500 hover:text-white"
                >
                  {showFullTable
                    ? lang === 'ar'
                      ? 'عرض مختصر'
                      : 'COMPACT TABLE'
                    : lang === 'ar'
                    ? `الجدول الكامل (${standings.length})`
                    : `FULL TABLE (${standings.length})`}
                </button>
              )}
            </div>

            {/* CENTER COLUMN: BANNER + SCOREBOARD + WHO WINS + EXTRAS */}
            <form onSubmit={submit} className="flex flex-col gap-4">
              {/* Top Golden Status Banner */}
              <div className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D97706] via-[#F59E0B] to-[#D97706] px-4 py-3 text-center text-xs font-black uppercase tracking-wider text-black shadow-lg sm:text-sm">
                <span>◷</span>
                {finished && pred?.points_awarded != null ? (
                  <span>
                    {lang === 'ar' ? 'النتيجة النهائية · ربحت' : 'FINAL RESULT · EARNED'}{' '}
                    <strong className="text-base">+{pred.points_awarded}</strong>{' '}
                    {lang === 'ar' ? 'نقطة' : 'POINTS'}
                  </span>
                ) : match.is_locked ? (
                  <span>
                    {lang === 'ar' ? 'بانتظار النتيجة' : 'WAITING FOR THE RESULT'}{' '}
                    <strong className="mx-1 text-base">{potential}</strong>{' '}
                    {lang === 'ar' ? 'نقطة' : 'POINTS'}
                  </span>
                ) : (
                  <span>
                    {lang === 'ar' ? 'مجموع النقاط المحتملة' : 'POTENTIAL PAYOUT'}{' '}
                    <strong className="mx-1 text-base">{potential}</strong>{' '}
                    {lang === 'ar' ? 'نقطة' : 'POINTS'}
                  </span>
                )}
              </div>

              {/* Upper Center Card: Match Scoreboard (Left) + Who Wins (Right) */}
              <div className="grid grid-cols-1 gap-4 rounded-2xl border border-[#242C30] bg-[#0B0E0F]/95 p-5 shadow-2xl lg:grid-cols-[1.15fr_1fr]">
                {/* Left Side: Match Scoreboard & Exact Score */}
                <div className="flex flex-col justify-between border-b border-[#242C30] pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
                  <div className="mb-4 flex items-center justify-between text-xs font-extrabold uppercase tracking-wider">
                    <span className="text-gray-200">{match.competition_name || match.competition_code}</span>
                    <div className="flex items-center gap-2 text-gray-400">
                      <span>
                        {new Date(match.utc_date).toLocaleString('en-US', {
                          month: 'short',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false
                        })}
                      </span>
                      {match.is_locked && !finished && (
                        <span className="inline-flex items-center gap-1 text-red-500">
                          <span className="h-2 w-2 animate-ping rounded-full bg-red-500" />
                          LIVE
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Teams & Score Boxes */}
                  <div className="my-auto grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2">
                    {/* Home Team */}
                    <div className="flex flex-col items-center gap-2 text-center">
                      {match.home_crest && (
                        <img src={match.home_crest} alt="" className="h-12 w-12 object-contain drop-shadow" />
                      )}
                      <span className="max-w-[120px] truncate text-xs font-black uppercase tracking-tight text-white sm:text-sm">
                        {match.home_team}
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`${match.home_team} score`}
                        disabled={readOnly}
                        value={displayHomeBox}
                        placeholder="-"
                        onChange={scoreChange(setHome)}
                        className="mt-1 h-14 w-12 rounded-xl border border-[#2A3439] bg-[#14191B] text-center font-mono text-2xl font-black text-white outline-none transition focus:border-[#F0C72F] disabled:opacity-90"
                      />
                    </div>

                    {/* Center Live Timer + Points Range + Score Grid Trigger */}
                    <div className="flex flex-col items-center justify-center gap-2 px-2">
                      {liveTimerText && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 font-mono text-xs font-black tracking-wider text-emerald-400 shadow">
                          {liveTimerText !== 'HT' && liveTimerText !== 'استراحة (HT)' && (
                            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                          )}
                          {liveTimerText}
                        </span>
                      )}

                      {match.is_locked && match.home_score != null && match.away_score != null && (
                        <div className="rounded-lg bg-[#14191B] px-2.5 py-1 font-mono text-xs font-bold text-gray-300">
                          {lang === 'ar' ? 'النتيجة الآن:' : 'Live:'}{' '}
                          <strong className="text-[#F0C72F]">
                            {match.home_score} : {match.away_score}
                          </strong>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => setShowGrid(true)}
                        className="group flex flex-col items-center gap-1 rounded-xl border border-transparent px-2 py-1 transition hover:border-[#242C30] hover:bg-[#14191B]"
                        title={t.howScorePays}
                      >
                        <span className="font-mono text-xs font-black text-gray-300 group-hover:text-[#F0C72F]">
                          {scoreValid ? `+${exactPts(Number(home), Number(away))}` : `${minExactPts}-${maxExactPts}`}
                        </span>
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F0C72F] text-xs font-black text-black shadow">
                          ◷
                        </span>
                      </button>
                    </div>

                    {/* Away Team */}
                    <div className="flex flex-col items-center gap-2 text-center">
                      {match.away_crest && (
                        <img src={match.away_crest} alt="" className="h-12 w-12 object-contain drop-shadow" />
                      )}
                      <span className="max-w-[120px] truncate text-xs font-black uppercase tracking-tight text-white sm:text-sm">
                        {match.away_team}
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`${match.away_team} score`}
                        disabled={readOnly}
                        value={displayAwayBox}
                        placeholder="-"
                        onChange={scoreChange(setAway)}
                        className="mt-1 h-14 w-12 rounded-xl border border-[#2A3439] bg-[#14191B] text-center font-mono text-2xl font-black text-white outline-none transition focus:border-[#F0C72F] disabled:opacity-90"
                      />
                    </div>
                  </div>
                </div>

                {/* Right Side: WHO WINS? */}
                <div className="flex flex-col justify-between">
                  <div className="mb-3 flex items-center justify-between text-xs font-black uppercase tracking-wider">
                    <span className="text-gray-300">{t.whoWins || 'WHO WINS?'}</span>
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-gray-300">
                      <span className="inline-block h-3.5 w-3.5 rounded-full bg-[#F0C72F] text-center text-[10px] font-black leading-3.5 text-black">
                        ◷
                      </span>
                      {minOutcomePts}-{maxOutcomePts}
                    </span>
                  </div>

                  <div className="my-auto flex flex-col gap-2.5">
                    {outcomeOptions.map((o) => {
                      const selected = outcome === o.key;
                      return (
                        <button
                          key={o.key}
                          type="button"
                          disabled={readOnly}
                          onClick={() => setOutcome(selected ? null : o.key)}
                          className={`flex items-center justify-between rounded-xl border px-3.5 py-3 text-xs font-black uppercase tracking-wider transition ${
                            selected
                              ? 'border-[#F0C72F] bg-[#F0C72F] text-black shadow-lg'
                              : 'border-[#242C30] bg-[#14191B] text-white hover:border-gray-500'
                          } disabled:cursor-default`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            {o.crest && <img src={o.crest} alt="" className="h-5 w-5 shrink-0 object-contain" />}
                            <span className="truncate">{o.label}</span>
                          </div>
                          <span className={`font-mono text-xs font-black ${selected ? 'text-black' : 'text-gray-300'}`}>
                            +{outcomePts(o.key)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Lower Center Card: EXTRAS */}
              <div className="rounded-2xl border border-[#242C30] bg-[#0B0E0F]/95 p-5 shadow-2xl">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black uppercase tracking-wider text-white">{t.extras}</span>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                      {lang === 'ar' ? 'اختر حتى 3 توقعات إضافية' : 'CLICK ANY EXTRA PREDICTION'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-[#F0C72F] px-2 py-0.5 font-mono text-xs font-black text-black">
                      {picks.length}/3
                    </span>
                    <span className="rounded-md border border-[#242C30] bg-[#14191B] px-2.5 py-0.5 font-mono text-xs font-extrabold text-gray-200">
                      {extrasPointsSum}/60 pts
                    </span>
                  </div>
                </div>

                {/* Category Filter Pills */}
                <div className="mb-4 flex flex-wrap gap-2 border-b border-[#242C30] pb-3">
                  <button
                    type="button"
                    onClick={() => setCat('all')}
                    className={`rounded-full px-3 py-1 text-xs font-black uppercase transition ${
                      cat === 'all' ? 'bg-[#F0C72F] text-black' : 'bg-[#14191B] text-gray-400 hover:text-white'
                    }`}
                  >
                    {lang === 'ar' ? 'الكل' : 'ALL'} {picks.length}/{EXTRAS.length}
                  </button>
                  {CATEGORIES.map((c) => {
                    const catExtras = EXTRAS.filter((x) => x.cat === c);
                    const pickedInCat = picks.filter((p) => catExtras.some((ce) => ce.key === p.market)).length;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCat(c)}
                        className={`rounded-full px-3 py-1 text-xs font-black uppercase transition ${
                          cat === c ? 'bg-[#F0C72F] text-black' : 'bg-[#14191B] text-gray-400 hover:text-white'
                        }`}
                      >
                        {t[`cat_${c}`]} {pickedInCat}/{catExtras.length}
                      </button>
                    );
                  })}
                </div>

                {/* Extras Grid */}
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  {filteredExtras.map((extra) => {
                    const picked = picks.find((p) => p.market === extra.key);
                    return (
                      <div
                        key={extra.key}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 transition ${
                          picked
                            ? 'border-[#F0C72F]/60 bg-[#25200B]/70'
                            : 'border-[#242C30] bg-[#14191B]'
                        }`}
                      >
                        <span className="text-xs font-extrabold uppercase tracking-tight text-gray-200">
                          {extra[lang]}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {extra.options.map((opt) => {
                            const isPicked = picked?.selection === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                disabled={readOnly}
                                onClick={() => toggleExtra(extra.key, opt)}
                                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-black uppercase transition ${
                                  isPicked
                                    ? 'border-[#F0C72F] bg-[#F0C72F] text-black shadow'
                                    : 'border-[#242C30] bg-[#0B0E0F] text-gray-300 hover:border-gray-500'
                                } disabled:cursor-default`}
                              >
                                <span>{formatTeamOptionLabel(extra, opt)}</span>
                                <span className={isPicked ? 'text-black/80' : 'text-[#F0C72F]'}>
                                  +{extraPts(extra.key, opt)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Settled Summary inside Modal */}
                {finished && settled && pred && (
                  <div className="mt-4 space-y-2 rounded-xl border border-[#242C30] bg-[#14191B] p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">
                        {t.result}: <strong className="text-white">{match.home_score} - {match.away_score}</strong>
                      </span>
                      {pred.points_awarded != null && (
                        <span className="rounded-lg bg-[#F0C72F]/20 px-3 py-1 text-sm font-black text-[#F0C72F]">
                          +{pred.points_awarded} {t.pts}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {pred.predicted_outcome && (
                        <Chip ok={pred.predicted_outcome === settled.outcome_1x2}>
                          {t.whoWins} {formatTeamOptionLabel(null, pred.predicted_outcome)}
                        </Chip>
                      )}
                      {pred.predicted_home != null && (
                        <Chip ok={`${pred.predicted_home}-${pred.predicted_away}` === settled.exact_score}>
                          {t.exactScore} {pred.predicted_home}-{pred.predicted_away}
                        </Chip>
                      )}
                      {(pred.extras_picks || []).map((p) => {
                        const meta = EXTRAS.find((x) => x.key === p.market);
                        return (
                          <Chip key={p.market} ok={p.status === 'WON'} voided={p.status === 'VOID'} voidText={t.void}>
                            {meta ? meta[lang] : p.market}: {formatTeamOptionLabel(meta, p.selection)}
                          </Chip>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Submit Bar (Boost completely removed) */}
                {!finished && user && !match.is_locked && (
                  <div className="mt-4 flex items-center justify-end border-t border-[#242C30] pt-4 text-xs">
                    <button
                      type="submit"
                      disabled={saving || !hasAnyPick}
                      className="rounded-xl bg-[#F0C72F] px-6 py-2.5 text-xs font-black uppercase tracking-wider text-black shadow-lg transition hover:brightness-110 disabled:opacity-40"
                    >
                      {saving ? t.locking : t.lock}
                    </button>
                  </div>
                )}
              </div>
            </form>

            {/* RIGHT COLUMN: HOW THE ROOM PLAYED + FORM */}
            <div className="flex flex-col gap-4">
              {/* Top Right Card: HOW THE ROOM PLAYED */}
              <div className="rounded-2xl border border-[#242C30] bg-[#0B0E0F]/95 p-4 shadow-2xl">
                <div className="mb-1 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-white">
                  <span className="text-[#F0C72F]">👥</span>
                  <span>{lang === 'ar' ? 'كيف توقعت الغرفة' : 'HOW THE ROOM PLAYED'}</span>
                </div>
                <div className="mb-3 text-[11px] font-semibold text-gray-500">
                  {roomStats.total_players}{' '}
                  {lang === 'ar' ? 'لاعب في هذه المباراة' : 'players on this match'}
                </div>

                <div className="space-y-3">
                  {/* Stat 1: Who wins? */}
                  <div className="rounded-xl border border-[#242C30] bg-[#14191B] p-3">
                    <div className="mb-1 text-[11px] font-bold text-gray-400">
                      <span className="text-[#F0C72F]">1</span>{' '}
                      {lang === 'ar' ? 'من يفوز؟' : 'Who wins?'}
                    </div>
                    <div className="mb-1.5 flex items-center justify-between text-xs font-black uppercase text-white">
                      <span className="truncate">{roomStats.who_wins?.label || match.home_team}</span>
                      <span>{roomStats.who_wins?.pct ?? 68}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full rounded-full bg-[#F0C72F]"
                        style={{ width: `${Math.min(100, Math.max(5, roomStats.who_wins?.pct ?? 68))}%` }}
                      />
                    </div>
                  </div>

                  {/* Stat 2: Do both teams score? */}
                  <div className="rounded-xl border border-[#242C30] bg-[#14191B] p-3">
                    <div className="mb-1 text-[11px] font-bold text-gray-400">
                      <span className="text-[#F0C72F]">2</span>{' '}
                      {lang === 'ar' ? 'هل يسجل الفريقان؟' : 'Do both teams score?'}
                    </div>
                    <div className="mb-1.5 flex items-center justify-between text-xs font-black uppercase text-white">
                      <span>{roomStats.btts?.selection || 'YES'}</span>
                      <span>{roomStats.btts?.pct ?? 74}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full rounded-full bg-[#F0C72F]"
                        style={{ width: `${Math.min(100, Math.max(5, roomStats.btts?.pct ?? 74))}%` }}
                      />
                    </div>
                  </div>

                  {/* Stat 3: Over or under 2.5 goals? */}
                  <div className="rounded-xl border border-[#242C30] bg-[#14191B] p-3">
                    <div className="mb-1 text-[11px] font-bold text-gray-400">
                      <span className="text-[#F0C72F]">3</span>{' '}
                      {lang === 'ar' ? 'أكثر أو أقل من 2.5 هدف؟' : 'Over or under 2.5 goals?'}
                    </div>
                    <div className="mb-1.5 flex items-center justify-between text-xs font-black uppercase text-white">
                      <span>{roomStats.over_under?.selection || 'OVER 2.5'}</span>
                      <span>{roomStats.over_under?.pct ?? 79}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full rounded-full bg-[#F0C72F]"
                        style={{ width: `${Math.min(100, Math.max(5, roomStats.over_under?.pct ?? 79))}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Right Card: FORM (Last 5 Matches) */}
              <div className="flex-1 rounded-2xl border border-[#242C30] bg-[#0B0E0F]/95 p-4 shadow-2xl">
                <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-white">
                  <span className="text-[#F0C72F]">📰</span>
                  <span>{lang === 'ar' ? 'آخر المباريات (FORM)' : 'FORM'}</span>
                </div>

                {/* Team Switcher Tabs */}
                <div className="mb-3 grid grid-cols-2 gap-2 rounded-full bg-[#14191B] p-1">
                  <button
                    type="button"
                    onClick={() => setFormTab('home')}
                    className={`truncate rounded-full px-3 py-1.5 text-[11px] font-black uppercase transition ${
                      formTab === 'home' ? 'bg-[#F0C72F] text-black shadow' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {match.home_team}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormTab('away')}
                    className={`truncate rounded-full px-3 py-1.5 text-[11px] font-black uppercase transition ${
                      formTab === 'away' ? 'bg-[#F0C72F] text-black shadow' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {match.away_team}
                  </button>
                </div>

                <div className="mb-2 text-[11px] font-black uppercase tracking-wider text-gray-300">
                  {formTab === 'home' ? match.home_team : match.away_team}
                </div>

                {activeFormList.length === 0 ? (
                  <div className="py-6 text-center text-xs text-gray-500">
                    {lang === 'ar' ? 'لا توجد مباريات سابقة مسجلة' : 'No recent matches recorded'}
                  </div>
                ) : (
                  <div className="divide-y divide-[#242C30]/60">
                    {activeFormList.map((fm, idx) => {
                      const badgeColor =
                        fm.result === 'W'
                          ? 'bg-emerald-500 text-black'
                          : fm.result === 'D'
                          ? 'bg-amber-500 text-black'
                          : 'bg-red-500 text-white';
                      const shortDate = fm.utc_date
                        ? new Date(fm.utc_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : '';
                      return (
                        <div key={idx} className="flex items-center justify-between gap-2 py-2.5 text-xs">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-black ${badgeColor}`}
                            >
                              {fm.result}
                            </span>
                            {fm.opponent_crest && (
                              <img src={fm.opponent_crest} alt="" className="h-4 w-4 shrink-0 object-contain" />
                            )}
                            <div className="min-w-0">
                              <div className="truncate text-[11px] font-extrabold uppercase text-gray-200">
                                VS {fm.opponent}
                              </div>
                              <div className="truncate text-[9px] font-bold uppercase text-gray-500">
                                {fm.competition_name}
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2.5">
                            <span className="font-mono text-xs font-black text-white">{fm.score}</span>
                            <span className="w-11 text-right text-[10px] font-semibold text-gray-500">
                              {shortDate}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* "How the score pays" modal */}
      {showGrid && (
        <ScoreGridModal
          match={match}
          t={t}
          readOnly={readOnly}
          home={home}
          away={away}
          scoreValid={scoreValid}
          exactPts={exactPts}
          onSelectScore={(h, a) => {
            setHome(String(h));
            setAway(String(a));
            setShowGrid(false);
          }}
          onClose={() => setShowGrid(false)}
        />
      )}

      {/* Match Details Modal (Stats & Lineups) */}
      {showDetails && (
        <MatchDetailsModal
          match={match}
          lang={lang}
          t={t}
          liveTimerText={liveTimerText}
          onClose={() => setShowDetails(false)}
          onOpenPrediction={() => {
            setShowDetails(false);
            setExpanded(true);
          }}
        />
      )}
    </>
  );
}