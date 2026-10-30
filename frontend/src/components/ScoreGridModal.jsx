import React from 'react';

export default function ScoreGridModal({
  match,
  t,
  readOnly,
  home,
  away,
  scoreValid,
  exactPts,
  onSelectScore,
  onClose
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-2xl border border-[#242C30] bg-[#101416] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-[#F0C72F]">{t.howScorePays}</h3>
            <p className="text-xs text-gray-400">{t.gridHint}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#242C30] px-3 py-1.5 text-xs font-bold hover:text-[#F0C72F]"
          >
            {t.close}
          </button>
        </div>

        <div className="mb-2 text-center text-xs font-bold text-gray-300">
          {match.away_team} →
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[520px] grid-cols-9 gap-1.5" dir="ltr">
            <div className="flex items-end justify-center pb-1 text-[10px] font-bold text-gray-400">
              {match.home_team} ↓
            </div>
            {Array.from({ length: 8 }, (_, a) => (
              <div key={`h${a}`} className="text-center text-xs font-bold text-gray-400">
                {a}
              </div>
            ))}
            {Array.from({ length: 8 }, (_, h) => (
              <React.Fragment key={`r${h}`}>
                <div className="flex items-center justify-center text-xs font-bold text-gray-400">{h}</div>
                {Array.from({ length: 8 }, (__, a) => {
                  const selected = scoreValid && Number(home) === h && Number(away) === a;
                  return (
                    <button
                      key={`${h}-${a}`}
                      type="button"
                      disabled={readOnly}
                      onClick={() => onSelectScore(h, a)}
                      className={`rounded-lg border py-2 text-center text-xs font-extrabold transition ${
                        selected
                          ? 'border-[#F0C72F] bg-[#F0C72F] text-black'
                          : 'border-[#242C30] bg-[#0B0E0F] text-[#F0C72F] hover:border-[#F0C72F]'
                      } disabled:cursor-default`}
                    >
                      +{exactPts(h, a)}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
