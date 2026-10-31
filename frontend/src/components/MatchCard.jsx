import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { EXTRAS, CATEGORIES, OPTION_LABELS } from '../constants/gameData';
import Chip from './Chip';
import ScoreGridModal from './ScoreGridModal';

export default function MatchCard({ match, user, lang, t, boostsLeft, onSaved, onError }) {
  const pred = match.prediction;
  const markets = match.markets_points;
  const settled = match.settled_outcomes;
  const finished = match.status === 'FINISHED';
  const readOnly = !user || match.is_locked;

  const [outcome, setOutcome] = useState(pred?.predicted_outcome ?? null);
  const [home, setHome] = useState(pred?.predicted_home ?? '');
  const [away, setAway] = useState(pred?.predicted_away ?? '');
  const [boost, setBoost] = useState(pred?.is_boosted ?? false);
  const [picks, setPicks] = useState(
    Array.isArray(pred?.extras_picks) ? pred.extras_picks.map((p) => ({ market: p.market, selection: p.selection })) : []
  );
  const [cat, setCat] = useState('goals');
  const [showGrid, setShowGrid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(Boolean(pred));
  const [SyncedAt, setSyncedAt] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setSyncedAt(Date.now());
    setNowMs(Date.now());
  }, [match.live_clock, match.live_seconds, match.status, match.home_score, match.away_score]);

  useEffect(() => {
    if (finished || !match.is_locked) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [finished, match.is_locked]);

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

    const deltaSec = Math.max(0, Math.floor((nowMs - SyncedAt) / 1000));
    const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

    // 1) If server provided live_seconds directly
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

    // 2) If server sent live_clock string (e.g. "3'" or "45+2'") without live_seconds
    const raw = String(match.live_clock || '').trim().replace(/'\+/g, '+');
    const kickMs = match.utc_date ? new Date(match.utc_date).getTime() : NaN;
    const baseSecOffset = Number.isFinite(kickMs)
      ? ((Math.floor((SyncedAt - kickMs) / 1000) % 60) + 60) % 60
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

  useEffect(() => {
    setOutcome(pred?.predicted_outcome ?? null);
    setHome(pred?.predicted_home ?? '');
    setAway(pred?.predicted_away ?? '');
    setBoost(pred?.is_boosted ?? false);
    setPicks(
      Array.isArray(pred?.extras_picks) ? pred.extras_picks.map((p) => ({ market: p.market, selection: p.selection })) : []
    );
    if (pred) setExpanded(true);
  }, [pred]);

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

  const potential =
    ((outcome ? outcomePts(outcome) : 0) +
      (scoreValid ? exactPts(Number(home), Number(away)) : 0) +
      picks.reduce((sum, p) => sum + extraPts(p.market, p.selection), 0)) *
    (boost ? 2 : 1);

  const hasAnyPick = Boolean(outcome) || scoreValid || picks.length > 0;

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
    e.preventDefault();
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
          isBoosted: boost,
          extras: picks
        })
      });
      onSaved(data.prediction, data.boostsUsed);
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const optionLabel = (extra, opt) => extra.labels?.[lang]?.[opt] ?? OPTION_LABELS[lang][opt];
  const outcomeOptions = [
    { key: 'HOME', label: t.home },
    { key: 'DRAW', label: t.draw },
    { key: 'AWAY', label: t.away }
  ];

  const statusBadge = finished ? (
    <span className="rounded bg-gray-800 px-2 py-0.5 font-bold text-gray-300">{t.finished}</span>
  ) : match.is_locked ? (
    <span className="rounded bg-red-950 px-2 py-0.5 font-bold text-red-400">{t.live}</span>
  ) : null;

  return (
    <>
      <form
        onSubmit={submit}
        className={`kp-match-card ${expanded ? 'is-expanded' : ''}`}
      >
        {/* Top line */}
        <div className="kp-fixture-meta flex items-center justify-between text-xs text-gray-400">
          <span className="kp-fixture-time">
            <span className="kp-clock-dot">◷</span>{' '}
            {new Date(match.utc_date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
          <div className="flex items-center gap-2">
            {pred && (
              <span className="rounded bg-[#F0C72F]/15 px-2 py-0.5 font-bold text-[#F0C72F]">{t.locked}</span>
            )}
            {statusBadge}
          </div>
        </div>

        {/* Teams + exact score inputs */}
        <div className="kp-fixture-teams grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {match.home_crest && <img src={match.home_crest} alt="" className="h-8 w-8 object-contain" />}
            <span className="truncate text-sm font-bold sm:text-base">{match.home_team}</span>
          </div>

          <div className="flex flex-col items-center justify-center gap-1">
            {liveTimerText && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-xs font-extrabold tracking-wider text-emerald-400 shadow-sm">
                {liveTimerText !== 'HT' && liveTimerText !== 'استراحة (HT)' && (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                )}
                {liveTimerText}
              </span>
            )}
            {expanded ? (
              <div className="kp-score-inputs flex items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={`${match.home_team} score`}
                  disabled={readOnly}
                  value={home}
                  onChange={scoreChange(setHome)}
                  className="h-10 w-10 rounded-lg border border-[#242C30] bg-[#0B0E0F] text-center text-base font-extrabold outline-none focus:border-[#F0C72F] disabled:opacity-50"
                />
                <span className="font-bold text-gray-500">:</span>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={`${match.away_team} score`}
                  disabled={readOnly}
                  value={away}
                  onChange={scoreChange(setAway)}
                  className="h-10 w-10 rounded-lg border border-[#242C30] bg-[#0B0E0F] text-center text-base font-extrabold outline-none focus:border-[#F0C72F] disabled:opacity-50"
                />
              </div>
            ) : (
              <div className={`kp-vs-center ${match.is_locked ? 'has-score' : ''}`}>
                {match.is_locked && match.home_score != null && match.away_score != null ? (
                  <>
                    <strong>{match.home_score}</strong>
                    <span>:</span>
                    <strong>{match.away_score}</strong>
                  </>
                ) : (
                  <span>VS</span>
                )}
              </div>
            )}
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2">
            <span className="truncate text-sm font-bold sm:text-base">{match.away_team}</span>
            {match.away_crest && <img src={match.away_crest} alt="" className="h-8 w-8 object-contain" />}
          </div>
        </div>

        <div className="kp-fixture-action-row">
          <div className="kp-fixture-status">
            {finished ? (
              <span className="kp-status-final">{lang === 'ar' ? 'انتهت' : 'FULL TIME'}</span>
            ) : match.is_locked ? (
              <span className="kp-status-live">
                <i /> {lang === 'ar' ? 'مباشر / بدأ' : 'LIVE / STARTED'}
              </span>
            ) : (
              <span className="kp-status-upcoming">{lang === 'ar' ? 'لم تبدأ' : 'UPCOMING'}</span>
            )}
            {!liveTimerText && match.status && !['TIMED', 'SCHEDULED', 'FINISHED'].includes(match.status) && (
              <span className="kp-status-code">{match.status}</span>
            )}
          </div>
          <button
            type="button"
            className={`kp-play-button ${expanded ? 'is-open' : ''}`}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? lang === 'ar'
                ? 'إخفاء'
                : 'Close picks'
              : pred
              ? lang === 'ar'
                ? 'تعديل التوقع'
                : 'View picks'
              : lang === 'ar'
              ? 'توقع الآن'
              : 'Play'}{' '}
            <span>{expanded ? '−' : '↗'}</span>
          </button>
        </div>

        {expanded && (
          <div className="kp-prediction-editor">
            {/* Exact score line: points + grid button */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">{t.exactScore}</span>
              <button
                type="button"
                onClick={() => setShowGrid(true)}
                className="font-bold text-[#F0C72F] hover:underline"
              >
                {t.howScorePays}
                {scoreValid && ` · +${exactPts(Number(home), Number(away))} ${t.pts}`}
              </button>
            </div>

            {/* Who wins */}
            <div className="rounded-xl border border-[#242C30] bg-[#0B0E0F] p-3">
              <div className="mb-2 text-xs font-semibold text-gray-400">{t.whoWins}</div>
              <div className="grid grid-cols-3 gap-2">
                {outcomeOptions.map((o) => {
                  const selected = outcome === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      disabled={readOnly}
                      onClick={() => setOutcome(selected ? null : o.key)}
                      className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs font-bold transition ${
                        selected
                          ? 'border-[#F0C72F] bg-[#F0C72F]/20 text-[#F0C72F]'
                          : 'border-[#242C30] bg-[#14191B] text-gray-300 hover:border-gray-500'
                      } disabled:cursor-default disabled:hover:border-[#242C30]`}
                    >
                      <span className="truncate">{o.label}</span>
                      <span className="font-black">+{outcomePts(o.key)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Extras */}
            <div className="rounded-xl border border-[#242C30] bg-[#0B0E0F] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400">
                  {t.extras} <span className="text-gray-500">· {t.extrasHint}</span>
                </span>
                <span className="text-xs font-black text-[#F0C72F]">{picks.length} / 3</span>
              </div>

              <div className="mb-2 flex gap-1.5 border-b border-[#242C30] pb-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCat(c)}
                    className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                      cat === c ? 'bg-[#F0C72F] text-black' : 'bg-[#14191B] text-gray-400 hover:text-white'
                    }`}
                  >
                    {t[`cat_${c}`]}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {EXTRAS.filter((x) => x.cat === cat).map((extra) => {
                  const picked = picks.find((p) => p.market === extra.key);
                  return (
                    <div
                      key={extra.key}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#242C30] bg-[#14191B] p-2"
                    >
                      <span className="text-xs font-semibold text-gray-200">{extra[lang]}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {extra.options.map((opt) => {
                          const isPicked = picked?.selection === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              disabled={readOnly}
                              onClick={() => toggleExtra(extra.key, opt)}
                              className={`rounded border px-2 py-1 text-[11px] font-bold transition ${
                                isPicked
                                  ? 'border-[#F0C72F] bg-[#F0C72F] text-black'
                                  : 'border-[#242C30] bg-[#0B0E0F] text-gray-300 hover:border-gray-500'
                              } disabled:cursor-default`}
                            >
                              {optionLabel(extra, opt)} <span className="opacity-80">+{extraPts(extra.key, opt)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Settled summary */}
            {finished && settled && pred && (
              <div className="space-y-1.5 rounded-xl border border-[#242C30] bg-[#0B0E0F] p-3 text-xs">
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
                      {t.whoWins} {OPTION_LABELS[lang][pred.predicted_outcome]}
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
                        {meta ? meta[lang] : p.market}: {meta ? optionLabel(meta, p.selection) : p.selection}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Footer */}
            {!finished && user && !match.is_locked && (
              <div className="flex items-center justify-between gap-2 border-t border-[#242C30] pt-3 text-xs">
                <button
                  type="button"
                  onClick={() => setBoost(!boost)}
                  disabled={!boost && boostsLeft <= 0 && !pred?.is_boosted}
                  className={`rounded-lg border px-3 py-2 font-bold transition disabled:opacity-40 ${
                    boost
                      ? 'border-[#F0C72F] bg-[#F0C72F]/20 text-[#F0C72F]'
                      : 'border-[#242C30] text-gray-400 hover:text-white'
                  }`}
                >
                  ⚡ {t.boost}
                </button>

                {hasAnyPick && (
                  <span className="hidden text-gray-400 sm:inline">
                    {t.potential}: <strong className="text-[#F0C72F]">+{potential}</strong>
                  </span>
                )}

                <button
                  type="submit"
                  disabled={saving || !hasAnyPick}
                  className="rounded-lg bg-[#F0C72F] px-4 py-2 font-extrabold text-black transition hover:brightness-110 disabled:opacity-40"
                >
                  {saving ? t.locking : t.lock}
                </button>
              </div>
            )}
          </div>
        )}
      </form>

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
    </>
  );
}