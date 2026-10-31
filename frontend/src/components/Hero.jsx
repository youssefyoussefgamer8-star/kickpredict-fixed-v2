import React from 'react';

export default function Hero({ lang }) {
  const isAr = lang === 'ar';
  return (
    <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-2">
      <div className="relative overflow-hidden rounded-2xl border border-[#2a2a2a] bg-gradient-to-r from-[#0a0d0c] via-[#0e1410] to-[#0a0d0c] shadow-2xl">
        {/* Kick Neon Green top ambient light strip */}
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-[#53FC18] to-transparent opacity-80" />

        {/* Ambient neon radial glows */}
        <div className="pointer-events-none absolute -top-24 right-1/4 h-72 w-72 rounded-full bg-[#53FC18]/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-12 h-64 w-64 rounded-full bg-[#53FC18]/5 blur-3xl" />

        <div className="relative z-10 flex flex-col justify-between p-6 sm:p-10 md:p-12 lg:flex-row lg:items-center">
          {/* Content */}
          <div className="max-w-2xl">
            {/* Kick Live Eyebrow */}
            <div className="inline-flex items-center gap-2 rounded-full border border-[#53FC18]/30 bg-[#53FC18]/10 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-[#53FC18]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#53FC18] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#53FC18]" />
              </span>
              <span>{isAr ? 'موسم التوقعات مشتعل' : 'PREDICTION SEASON IS LIVE'}</span>
            </div>

            {/* Main Punchy Heading */}
            <h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl leading-[1.08]">
              {isAr ? (
                <>
                  كل مباراة.<br />
                  <span className="text-[#53FC18] drop-shadow-[0_0_35px_rgba(83,252,24,0.35)]">
                    توقعك يصنع الفرق.
                  </span>
                </>
              ) : (
                <>
                  Your league.<br />
                  <span className="text-[#53FC18] drop-shadow-[0_0_35px_rgba(83,252,24,0.35)]">
                    Your call.
                  </span>
                </>
              )}
            </h1>

            <p className="mt-3 sm:mt-4 text-sm sm:text-base text-gray-400 max-w-lg leading-relaxed">
              {isAr
                ? 'توقع نتائج المباريات الحية، اجمع النقاط في الوقت الفعلي، وتصدر جدول الترتيب مع Kick.'
                : 'Call the scores in real-time, climb the leaderboard, and dominate the prediction table with Kick.'}
            </p>

            {/* Feature Pills */}
            <div className="mt-6 flex flex-wrap items-center gap-2.5 text-xs font-bold text-gray-300">
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 backdrop-blur-sm">
                <span className="text-[#53FC18]">⚡</span>
                <span>{isAr ? 'مجاني 100%' : '100% FREE TO PLAY'}</span>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 backdrop-blur-sm">
                <span className="text-[#53FC18]">🔒</span>
                <span>{isAr ? 'تُقفل التوقعات عند الصافرة' : 'PICKS LOCK AT KICK-OFF'}</span>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 backdrop-blur-sm">
                <span className="text-[#53FC18]">🏆</span>
                <span>{isAr ? 'جوائز ونقاط فورية' : 'INSTANT POINTS'}</span>
              </div>
            </div>
          </div>

          {/* Stadium Pitch Art Graphic */}
          <div className="pointer-events-none relative mt-8 hidden lg:block lg:mt-0 lg:w-[420px] lg:h-[220px]" aria-hidden="true">
            <div className="absolute inset-0 flex items-center justify-center">
              {/* Stadium Rings */}
              <div className="absolute h-56 w-56 rounded-full border border-[#53FC18]/20 shadow-[0_0_40px_rgba(83,252,24,0.15)] animate-[spin_40s_linear_infinite]" />
              <div className="absolute h-44 w-44 rounded-full border border-dashed border-[#53FC18]/15" />

              {/* Glowing Pitch */}
              <div className="relative h-36 w-64 rounded border-2 border-[#53FC18]/50 bg-gradient-to-br from-[#53FC18]/10 via-[#0d1f11]/60 to-[#07130a]/80 shadow-[0_0_60px_rgba(83,252,24,0.2)] transform -rotate-12 skew-x-[-10deg]">
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 border-l border-[#53FC18]/50" />
                <div className="absolute top-1/2 left-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#53FC18]/50" />
                <div className="absolute top-1/2 left-0 h-20 w-8 -translate-y-1/2 border-r border-y border-[#53FC18]/40" />
                <div className="absolute top-1/2 right-0 h-20 w-8 -translate-y-1/2 border-l border-y border-[#53FC18]/40" />
              </div>

              {/* Kick Sparkle */}
              <div className="absolute -top-2 right-12 text-[#53FC18] text-2xl animate-bounce drop-shadow-[0_0_12px_#53FC18]">
                ✦
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
