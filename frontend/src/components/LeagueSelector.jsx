import React, { useState } from 'react';

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

const LEAGUE_FALLBACK_ICONS = {
  LIVE: '🔴',
  ALL: '✦',
  PL: '◈',
  PD: '◉',
  BL1: '◆',
  SA: '●',
  FL1: '◎',
  CL: '★',
  TUN: '🇹🇳',
  TU1: '🇹🇳'
};

const LEAGUE_NAME_OVERRIDES = {
  TUN: 'LIGUE PROFESSIONNELLE 1',
  TU1: 'LIGUE PROFESSIONNELLE 1'
};

export default function LeagueSelector({
  lang,
  competition,
  competitions,
  changeCompetition,
  allMatches = []
}) {
  const isAr = lang === 'ar';
  const [isExpanded, setIsExpanded] = useState(true);

  const liveMatches = allMatches.filter((m) => m.status === 'IN_PLAY' || m.status === 'PAUSED');
  const liveCount = liveMatches.length;

  const currentSelectionName = (() => {
    if (competition === 'LIVE') return isAr ? 'مباشر 🔴' : 'LIVE 🔴';
    if (competition === 'ALL') return isAr ? 'كل الدوريات' : 'ALL LEAGUES';
    if (LEAGUE_NAME_OVERRIDES[competition]) return LEAGUE_NAME_OVERRIDES[competition];
    const found = competitions.find((c) => c.code === competition);
    return found ? found.name.toUpperCase() : competition;
  })();

  return (
    <div className="w-full mb-8 bg-black rounded-2xl border border-[#222222] shadow-2xl overflow-hidden">
      {/* Top Bar with Section Title & Current Status */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1c1c1c] bg-[#0a0a0a]">
        <div className="flex items-center gap-3">
          <span className="text-[#F0C72F] font-black text-base">☰</span>
          <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
            {isAr ? 'اختيار البطولة' : 'SELECT LEAGUE'}
          </span>
          {competition && (
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#181818] text-[#F0C72F] border border-[#333]">
              {currentSelectionName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {liveCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-950/80 border border-red-500/50 text-red-400 text-[11px] font-black tracking-wider animate-pulse">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              {liveCount} {isAr ? 'مباشر' : 'LIVE'}
            </span>
          )}
          <span className="text-[11px] font-semibold text-gray-400">
            {allMatches.length} {isAr ? 'مباراة' : 'matches'}
          </span>
        </div>
      </div>

      {/* Vertical List of Leagues (matches image_62fd15.png design) */}
      <div
        className={`p-3 space-y-1.5 transition-all duration-300 ${
          isExpanded ? 'max-h-[620px] overflow-y-auto' : 'max-h-[290px] overflow-hidden'
        }`}
      >
        {/* 1. LIVE OPTION (At the very top of the list with pulsing red indicator) */}
        <button
          type="button"
          onClick={() => changeCompetition('LIVE')}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-150 active:scale-[0.99] ${
            competition === 'LIVE'
              ? 'bg-[#1c0808] border-2 border-red-500 shadow-lg shadow-red-950/50'
              : 'bg-[#0d0d0d] hover:bg-[#180a0a] border border-[#261010] hover:border-red-900/60'
          }`}
        >
          <div className="flex items-center gap-3.5" dir="ltr">
            <span className="relative flex h-4 w-4 items-center justify-center shrink-0">
              {liveCount > 0 && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-3 w-3 ${
                  liveCount > 0 ? 'bg-red-500 animate-pulse' : 'bg-red-500'
                }`}
              />
            </span>
            <div className="flex items-center gap-2">
              <span className="font-black uppercase tracking-wider text-sm sm:text-base text-red-400">
                {isAr ? 'مباشر 🔴' : 'LIVE 🔴'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-mono font-bold tracking-tight">
                {isAr ? 'جارية الآن' : 'IN-PLAY'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-mono font-black px-2.5 py-0.5 rounded-full ${
                liveCount > 0 ? 'bg-red-600 text-white shadow-sm shadow-red-600/40' : 'bg-white/10 text-gray-400'
              }`}
            >
              {liveCount}
            </span>
            {competition === 'LIVE' && <span className="text-red-400 font-black text-sm">✓</span>}
          </div>
        </button>

        {/* 2. ALL LEAGUES OPTION */}
        <button
          type="button"
          onClick={() => changeCompetition('ALL')}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-150 active:scale-[0.99] ${
            competition === 'ALL'
              ? 'bg-[#141414] border-2 border-[#53FC18] shadow-lg shadow-[#53FC18]/10'
              : 'bg-[#0d0d0d] hover:bg-[#171717] border border-[#1f1f1f] hover:border-gray-700'
          }`}
        >
          <div className="flex items-center gap-3.5" dir="ltr">
            <div className="w-7 h-7 rounded-lg bg-[#1a1a1a] flex items-center justify-center text-[#53FC18] font-black text-sm shrink-0 border border-[#2a2a2a]">
              ✦
            </div>
            <span className="font-black uppercase tracking-wider text-sm sm:text-base text-white">
              {isAr ? 'كل الدوريات' : 'ALL LEAGUES'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-white/10 text-gray-300">
              {allMatches.length}
            </span>
            {competition === 'ALL' && <span className="text-[#53FC18] font-black text-sm">✓</span>}
          </div>
        </button>

        {/* 3. INDIVIDUAL LEAGUES (Exact visual style from image_62fd15.png: logo on left, white bold uppercase on right) */}
        {competitions.map((c) => {
          const isSelected = competition === c.code;
          const matchCount = allMatches.filter((m) => m.competition_code === c.code).length;
          const logoUrl = LEAGUE_LOGOS[c.code];
          const fallbackIcon = LEAGUE_FALLBACK_ICONS[c.code] || '⚽';
          const displayName = LEAGUE_NAME_OVERRIDES[c.code] || (c.name || c.code).toUpperCase();

          return (
            <button
              key={c.code}
              type="button"
              onClick={() => changeCompetition(c.code)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-150 active:scale-[0.99] ${
                isSelected
                  ? 'bg-[#181818] border-2 border-[#F0C72F] shadow-lg shadow-[#F0C72F]/10'
                  : 'bg-[#0d0d0d] hover:bg-[#171717] border border-[#1f1f1f] hover:border-gray-700'
              }`}
            >
              <div className="flex items-center gap-3.5" dir="ltr">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={c.name}
                    className="w-7 h-7 sm:w-8 sm:h-8 object-contain shrink-0 filter drop-shadow-sm"
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      if (e.currentTarget.nextElementSibling) {
                        e.currentTarget.nextElementSibling.style.display = 'flex';
                      }
                    }}
                  />
                ) : null}
                <span
                  className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[#1a1a1a] items-center justify-center text-sm shrink-0 border border-[#2a2a2a]"
                  style={{ display: logoUrl ? 'none' : 'flex' }}
                >
                  {fallbackIcon}
                </span>
                <span className="font-black uppercase tracking-wider text-sm sm:text-base text-white text-left">
                  {displayName}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {matchCount > 0 && (
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-white/10 text-gray-300">
                    {matchCount}
                  </span>
                )}
                {isSelected && <span className="text-[#F0C72F] font-black text-sm">✓</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Yellow / Gold Chevron Toggle at the bottom (matching image_62fd15.png) */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full flex items-center justify-center py-2.5 bg-[#0a0a0a] hover:bg-[#141414] border-t border-[#1a1a1a] transition-colors cursor-pointer group"
        title={isExpanded ? (isAr ? 'طي القائمة' : 'Collapse') : (isAr ? 'عرض كل البطولات' : 'Expand all leagues')}
      >
        <svg
          className={`w-6 h-6 text-[#F0C72F] group-hover:scale-110 transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : 'rotate-0'
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  );
}
