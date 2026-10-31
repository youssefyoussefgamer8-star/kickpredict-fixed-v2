import React from 'react';

const LEAGUE_ICONS = {
  ALL: '✦',
  PL: '◈',
  PD: '◉',
  BL1: '◆',
  SA: '●',
  FL1: '◎',
  CL: '★',
  TU1: '🇹🇳'
};

export default function LeagueSelector({
  lang,
  competition,
  competitions,
  changeCompetition,
  allMatches = []
}) {
  const isAr = lang === 'ar';

  return (
    <div className="w-full mb-6">
      <div className="flex items-center justify-between mb-3 text-xs font-black uppercase tracking-wider text-gray-400">
        <div className="flex items-center gap-2">
          <span className="text-[#53FC18]">☷</span>
          <span>{isAr ? 'اختر البطولة أو الدوري' : 'SELECT LEAGUE / COMPETITION'}</span>
        </div>
        <span className="text-[11px] font-semibold text-gray-500">
          {allMatches.length} {isAr ? 'مباراة متاحة' : 'matches available'}
        </span>
      </div>

      {/* Horizontal Scrollable Bar with smooth scrollbar-hidden style */}
      <div className="flex items-center gap-2.5 overflow-x-auto pb-2 pt-0.5 scroll-smooth no-scrollbar">
        {/* All Leagues Pill */}
        <button
          type="button"
          onClick={() => changeCompetition('ALL')}
          className={`group inline-flex shrink-0 items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-150 active:scale-95 ${
            competition === 'ALL'
              ? 'bg-[#53FC18] text-black shadow-lg shadow-[#53FC18]/25 scale-[1.02]'
              : 'bg-[#1a1a1a] text-gray-300 border border-[#2a2a2a] hover:bg-[#252525] hover:text-white hover:border-gray-600'
          }`}
        >
          <span className={`text-sm ${competition === 'ALL' ? 'text-black' : 'text-[#53FC18]'}`}>
            ✦
          </span>
          <span>{isAr ? 'كل الدوريات' : 'All Leagues'}</span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
              competition === 'ALL'
                ? 'bg-black/20 text-black'
                : 'bg-white/10 text-gray-400 group-hover:text-white'
            }`}
          >
            {allMatches.length}
          </span>
        </button>

        {/* Individual League Pills */}
        {competitions.map((c) => {
          const isSelected = competition === c.code;
          const matchCount = allMatches.filter((m) => m.competition_code === c.code).length;
          const icon = LEAGUE_ICONS[c.code] || '⚽';

          return (
            <button
              key={c.code}
              type="button"
              onClick={() => changeCompetition(c.code)}
              className={`group inline-flex shrink-0 items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-150 active:scale-95 ${
                isSelected
                  ? 'bg-[#53FC18] text-black shadow-lg shadow-[#53FC18]/25 scale-[1.02]'
                  : 'bg-[#1a1a1a] text-gray-300 border border-[#2a2a2a] hover:bg-[#252525] hover:text-white hover:border-gray-600'
              }`}
            >
              <span className={`text-sm ${isSelected ? 'text-black' : 'text-[#53FC18]'}`}>
                {icon}
              </span>
              <span>{c.name}</span>
              {matchCount > 0 && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                    isSelected
                      ? 'bg-black/20 text-black'
                      : 'bg-white/10 text-gray-400 group-hover:text-white'
                  }`}
                >
                  {matchCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
