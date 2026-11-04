import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { T } from './constants/translations';
import { api, API_BASE } from './utils/api';
import { localDateKey, formatDayLabel } from './utils/dateUtils';
import Header from './components/Header';
import Hero from './components/Hero';
import LeagueSelector from './components/LeagueSelector';
import MatchCard from './components/MatchCard';
import Leaderboard from './components/Leaderboard';
import { CupPanel, RulesPanel, ProfilePanel } from './components/InfoPanels';

function getInitialPlaceholderDates() {
  const base = new Date();
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return localDateKey(d);
  });
}

const PLACEHOLDER_DATES = getInitialPlaceholderDates();

export default function App() {
  const ENABLE_BOOSTS = false; // Toggle to true when boost is enabled on server
  const ENABLE_CUP = false; // Toggle to true when cup competitions are ready
  const [lang, setLang] = useState('en');
  const [tab, setTab] = useState('matches');
  const [user, setUser] = useState(null);
  const [competitions, setCompetitions] = useState([]);
  const [competition, setCompetition] = useState(null);
  const [round, setRound] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('');

  const t = T[lang];
  const isRtl = lang === 'ar';

  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Show OAuth callback failures returned by the backend, then remove the
  // query parameter so refreshes do not repeatedly display the same message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('error');
    if (!authError) return;

    const messages = lang === 'ar' ? {
      oauth_expired: 'انتهت صلاحية تسجيل الدخول عبر Kick. حاول مرة أخرى.',
      auth_failed: 'تعذر إكمال تسجيل الدخول عبر Kick. حاول مرة أخرى.',
      oauth_invalid: 'رُفض طلب تسجيل الدخول. حاول مرة أخرى.',
      state_mismatch: 'تعذر التحقق من جلسة تسجيل الدخول. حاول مرة أخرى.'
    } : {
      oauth_expired: 'Your Kick login expired. Please try again.',
      auth_failed: 'Kick login could not be completed. Please try again.',
      oauth_invalid: 'The login request was invalid. Please try again.',
      state_mismatch: 'The login session could not be verified. Please try again.'
    };
    showToast(messages[authError] || (lang === 'ar' ? 'فشل تسجيل الدخول. حاول مرة أخرى.' : 'Login failed. Please try again.'), true);

    params.delete('error');
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, [lang, showToast]);

  // Session + competitions
  useEffect(() => {
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
    api('/competitions')
      .then((d) => {
        setCompetitions(d.competitions);
        if (d.competitions.length > 0) setCompetition('ALL');
      })
      .catch((e) => setLoadError(e.message));
  }, []);

  const loadMatches = useCallback(async () => {
    if (!competition) return;
    setLoading(true);
    try {
      setLoadError(null);
      let nextData;
      if (competition === 'ALL' || competition === 'LIVE') {
        const leagueData = await Promise.all(competitions.map((c) =>
          api(`/matches?${new URLSearchParams({ competition: c.code }).toString()}`)
            .then((result) => ({ ...result, _competitionName: c.name, _competitionCode: c.code }))
        ));
        const combinedMatches = leagueData.flatMap((result) => result.matches.map((match) => ({
          ...match,
          _competitionName: result._competitionName,
          _competitionCode: result._competitionCode,
          _boostsLeft: Math.max(0, (result.maxBoosts || 0) - (result.boostsUsed || 0)),
          _maxBoosts: result.maxBoosts || 0
        })));
        nextData = {
          competition,
          rounds: [],
          round: null,
          maxBoosts: 0,
          boostsUsed: 0,
          matches: combinedMatches.sort((a, b) => new Date(a.utc_date) - new Date(b.utc_date))
        };
      } else {
        const qs = new URLSearchParams({ competition });
        if (round) qs.set('round', round);
        nextData = await api(`/matches?${qs.toString()}`);
      }
      const dates = Array.from(new Set((nextData.matches || []).map((m) => localDateKey(m.utc_date)).filter(Boolean))).sort();
      const todayKey = localDateKey(new Date());
      setData(nextData);
      setSelectedDate(dates.find((date) => date >= todayKey) || dates[0] || '');
      setSelectedTeam('');
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [competition, round, competitions]);

  useEffect(() => {
    if (tab === 'matches') {
      void loadMatches();
    }
  }, [tab, loadMatches]);

  const loadMatchesRef = useRef(loadMatches);
  useEffect(() => {
    loadMatchesRef.current = loadMatches;
  }, [loadMatches]);

  const hasLiveMatch = Boolean(
    (data?.matches || []).some((m) => m.status === 'IN_PLAY' || m.status === 'PAUSED') ||
    competition === 'LIVE'
  );

  // Light polling: re-fetch matches every 45s when at least one match is live (IN_PLAY or PAUSED)
  // or when viewing the LIVE tab, and pause when there are no live matches or the browser tab is hidden.
  useEffect(() => {
    if (tab !== 'matches' || !hasLiveMatch) return undefined;

    const interval = setInterval(() => {
      if (!document.hidden) {
        void loadMatchesRef.current();
      }
    }, 45 * 1000);

    return () => clearInterval(interval);
  }, [tab, hasLiveMatch]);

  const loadLeaderboard = useCallback(async () => {
    setLoadError(null);
    try {
      const d = await api(`/leaderboard?search=${encodeURIComponent(search)}`);
      setLeaderboard(Array.isArray(d.leaderboard) ? d.leaderboard : []);
    } catch (e) {
      setLoadError(e.message);
    }
  }, [search]);

  // Leaderboard (debounced search)
  useEffect(() => {
    if (tab !== 'leaderboard') return undefined;
    const id = setTimeout(() => { void loadLeaderboard(); }, 300);
    return () => clearTimeout(id);
  }, [tab, loadLeaderboard]);

  async function handleLogout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }

  function changeCompetition(code) {
    setCompetition(code);
    setRound(null);
    setSelectedTeam('');
  }

  const rounds = data?.rounds || [];
  const roundIdx = rounds.findIndex((r) => r.key === data?.round);
  const roundLabel = rounds[roundIdx]?.label || '';
  const boostsLeft = Math.max(0, (data?.maxBoosts ?? 0) - (data?.boostsUsed ?? 0));

  const allMatches = useMemo(() => data?.matches || [], [data?.matches]);
  const availableDates = useMemo(() => {
    const rawDates = Array.from(new Set(allMatches.map((m) => localDateKey(m.utc_date)).filter(Boolean))).sort();
    if (rawDates.length === 0) return [];
    const todayKey = localDateKey(new Date());
    const minStr = rawDates[0] < todayKey ? rawDates[0] : todayKey;
    const maxStr = rawDates[rawDates.length - 1];
    const minD = new Date(minStr + 'T00:00:00');
    const maxD = new Date(maxStr + 'T00:00:00');
    const filled = [];
    const cur = new Date(minD);
    while (cur <= maxD && filled.length < 14) {
      filled.push(localDateKey(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return filled;
  }, [allMatches]);

  const placeholderDates = PLACEHOLDER_DATES;

  const selectedMatches = allMatches.filter((m) => {
    if (competition === 'LIVE') {
      const isLive = m.status === 'IN_PLAY' || m.status === 'PAUSED';
      const teamMatches = !selectedTeam || m.home_team === selectedTeam || m.away_team === selectedTeam;
      return isLive && teamMatches;
    }
    const dateMatches = !selectedDate || localDateKey(m.utc_date) === selectedDate;
    const teamMatches = !selectedTeam || m.home_team === selectedTeam || m.away_team === selectedTeam;
    return dateMatches && teamMatches;
  });

  const followedTeams = Array.from(new Set(allMatches.flatMap((m) => [m.home_team, m.away_team]).filter(Boolean))).slice(0, 8);

  const matchGroups = (competition === 'ALL' || competition === 'LIVE')
    ? competitions.map((c) => ({
        code: c.code,
        name: c.name,
        matches: selectedMatches.filter((m) => m.competition_code === c.code)
      })).filter((group) => group.matches.length)
    : [{ code: competition, name: competitions.find((c) => c.code === competition)?.name || competition, matches: selectedMatches }];

  const navItems = [
    { key: 'matches', label: lang === 'ar' ? 'المباريات' : 'Matches', icon: '⚽' },
    { key: 'leaderboard', label: lang === 'ar' ? 'الترتيب' : 'Table', icon: '▤' },
    ...(ENABLE_CUP ? [{ key: 'cup', label: lang === 'ar' ? 'الكأس' : 'Cup', icon: '🏆' }] : []),
    { key: 'rules', label: lang === 'ar' ? 'القوانين' : 'Rules', icon: 'ⓘ' },
    { key: 'profile', label: lang === 'ar' ? 'حسابي' : 'My Profile', icon: '◉' }
  ];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="kp-app">
      <Header
        lang={lang}
        tab={tab}
        setTab={setTab}
        user={user}
        setLang={setLang}
        navItems={navItems}
        t={t}
      />

      {toast && (
        <div className={`kp-toast ${toast.isError ? 'is-error' : ''}`} role="status">
          <span>{toast.isError ? '!' : '✓'}</span>{toast.msg}
        </div>
      )}

      <Hero lang={lang} />

      <main className="kp-layout w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <section className="kp-content w-full">
          {loadError && (
            <div className="kp-error-banner">
              <span>{t.loadError} ({loadError})</span>
              <button onClick={() => { void (tab === 'leaderboard' ? loadLeaderboard() : loadMatches()); }}>
                {t.retry}
              </button>
            </div>
          )}

          {tab === 'matches' && (
            <>
              {/* Horizontal Scrollable League Selector */}
              <LeagueSelector
                lang={lang}
                competition={competition}
                competitions={competitions}
                changeCompetition={changeCompetition}
                allMatches={allMatches}
              />

              {/* Followed Teams Horizontal Quick-Filters */}
              {followedTeams.length > 0 && (
                <div className="mb-6 flex items-center gap-2 overflow-x-auto pb-1 text-xs no-scrollbar">
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-500 shrink-0">
                    {lang === 'ar' ? 'فرق تتابعها:' : 'TEAMS:'}
                  </span>
                  {followedTeams.map((team) => {
                    const isSelected = selectedTeam === team;
                    return (
                      <button
                        key={team}
                        type="button"
                        onClick={() => setSelectedTeam(isSelected ? '' : team)}
                        className={`inline-flex shrink-0 items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all duration-150 active:scale-95 ${
                          isSelected
                            ? 'bg-[#53FC18]/20 text-[#53FC18] border border-[#53FC18]/50 shadow-sm shadow-[#53FC18]/20'
                            : 'bg-[#1a1a1a] text-gray-300 border border-[#2a2a2a] hover:bg-[#252525] hover:text-white'
                        }`}
                      >
                        <span>{team}</span>
                        {isSelected && <span className="text-xs">✕</span>}
                      </button>
                    );
                  })}
                  {selectedTeam && (
                    <button
                      type="button"
                      onClick={() => setSelectedTeam('')}
                      className="text-[11px] font-bold text-[#53FC18] hover:underline px-1.5"
                    >
                      {lang === 'ar' ? 'عرض الكل' : 'Clear'}
                    </button>
                  )}
                </div>
              )}

              <div className="kp-section-head">
                <div>
                  <div className="kp-section-kicker">
                    {competition === 'LIVE'
                      ? (lang === 'ar' ? 'مباريات مباشرة' : 'LIVE MATCHES')
                      : (lang === 'ar' ? 'مركز المباريات' : 'MATCH CENTRE')}
                  </div>
                  <h2>
                    {competition === 'LIVE'
                      ? (lang === 'ar' ? 'المباريات المباشرة الآن' : 'Live In-Play Matches')
                      : (lang === 'ar' ? 'اختر مبارياتك' : 'Pick your matches')}{' '}
                    <span className="kp-live-pip" />
                  </h2>
                  <p>
                    {competition === 'LIVE'
                      ? (lang === 'ar' ? 'متابعة حية لنتائج وأحداث المباريات الجارية الآن.' : 'Live scores and ongoing action happening right now.')
                      : (lang === 'ar' ? 'اختر اليوم، ثم ثبّت توقعاتك قبل انطلاق المباراة.' : 'Choose a day, lock in your picks before kick-off.')}
                  </p>
                </div>
                <div className="kp-round-badge">
                  <span className="kp-round-star">{competition === 'LIVE' ? '🔴' : '✦'}</span>
                  <span>
                    <small>{competition === 'LIVE' ? (lang === 'ar' ? 'حالة البث' : 'STATUS') : (lang === 'ar' ? 'الجولة الحالية' : 'CURRENT ROUND')}</small>
                    <strong>{competition === 'LIVE' ? (lang === 'ar' ? 'مباشر' : 'Live') : (roundLabel || (lang === 'ar' ? 'الجولة' : 'Matchday'))}</strong>
                  </span>
                </div>
              </div>

              {competition !== 'LIVE' && (
                <div className="kp-date-strip" aria-label="Choose match day">
                  {availableDates.length ? availableDates.slice(0, 9).map((date) => {
                    const label = formatDayLabel(date, lang);
                    const dayCount = allMatches.filter((m) => localDateKey(m.utc_date) === date).length;
                    return (
                      <button
                        key={date}
                        onClick={() => setSelectedDate(date)}
                        className={`kp-date-chip ${selectedDate === date ? 'is-active' : ''}`}
                      >
                        <span className="kp-date-weekday">{label.weekday}</span>
                        <strong>{label.day}</strong>
                        <span className="kp-date-month">{label.month}</span>
                        <span className="kp-date-count">
                          {dayCount} {lang === 'ar' ? 'مباريات' : 'MATCH' + (dayCount === 1 ? '' : 'ES')}
                        </span>
                      </button>
                    );
                  }) : placeholderDates.map((key) => {
                    const label = formatDayLabel(key, lang);
                    return (
                      <div key={key} className="kp-date-chip is-disabled">
                        <span className="kp-date-weekday">{label.weekday}</span>
                        <strong>{label.day}</strong>
                        <span className="kp-date-month">{label.month}</span>
                        <span className="kp-date-count">—</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="kp-match-toolbar">
                <div className="kp-filter-summary">
                  <span className="kp-filter-icon">{competition === 'LIVE' ? '🔴' : '☷'}</span>
                  <strong>
                    {selectedTeam ||
                      (competition === 'LIVE'
                        ? (lang === 'ar' ? 'مباشر الآن' : 'Live In-Play')
                        : competition === 'ALL'
                          ? (lang === 'ar' ? 'كل الدوريات' : 'All Leagues')
                          : competitions.find((c) => c.code === competition)?.name) ||
                      'All Leagues'}
                  </strong>
                  <span className="kp-filter-muted">{selectedMatches.length} {lang === 'ar' ? 'مباريات' : 'matches'}</span>
                </div>
                <div className="kp-match-toolbar-right">
                  {user ? (
                    /* Boost feature disabled on server (MAX_BOOSTS = 0); hidden until enabled */
                    ENABLE_BOOSTS && (
                      <span className="kp-boost-count">
                        <span>⚡</span>{' '}
                        {(competition === 'ALL' || competition === 'LIVE')
                          ? (lang === 'ar' ? 'المضاعفات حسب الدوري' : 'BOOSTS PER LEAGUE')
                          : `${boostsLeft} / ${data?.maxBoosts ?? 0} ${lang === 'ar' ? 'مضاعفات متبقية' : 'BOOSTS LEFT'}`}
                      </span>
                    )
                  ) : (
                    <a
                      href={`${API_BASE}/auth/kick`}
                      className="kp-login-hint kp-login-link"
                      title={lang === 'ar' ? 'تسجيل الدخول عبر Kick' : 'Log in with Kick'}
                    >
                      <span>↗</span> {lang === 'ar' ? 'سجّل الدخول لتثبيت التوقعات' : 'Log in to lock in your picks'}
                    </a>
                  )}
                  <button
                    className="kp-refresh-button"
                    onClick={() => { void loadMatches(); }}
                    title={lang === 'ar' ? 'تحديث المباريات' : 'Refresh matches'}
                  >
                    ↻
                  </button>
                </div>
              </div>

              {loading && !data ? (
                <div className="kp-empty-state">
                  <div className="kp-spinner" />
                  <strong>{lang === 'ar' ? 'جاري تحميل المباريات...' : 'Loading matches...'}</strong>
                </div>
              ) : !selectedMatches.length ? (
                <div className="kp-empty-state">
                  <div className="kp-empty-ball">{competition === 'LIVE' ? '🔴' : '⚽'}</div>
                  <strong>
                    {selectedTeam
                      ? (lang === 'ar' ? 'لا توجد مباريات لهذا الفريق في هذا اليوم' : 'No matches for this team on this day')
                      : competition === 'LIVE'
                        ? (lang === 'ar' ? 'لا توجد مباريات مباشرة حالياً' : 'No live matches at the moment')
                        : t.noMatches}
                  </strong>
                  <p>
                    {competition === 'LIVE'
                      ? (lang === 'ar' ? 'لا توجد أي مباراة تلعب الآن. تصفح باقي الدوريات لمتابعة جدول المباريات القادمة.' : 'No matches are currently in progress. Select a league or All Leagues to check upcoming fixtures.')
                      : (lang === 'ar' ? 'جرّب يومًا آخر أو اختر دوريًا مختلفًا.' : 'Try another day or choose a different league.')}
                  </p>
                  {competition === 'LIVE' && (
                    <button className="kp-primary-small" onClick={() => changeCompetition('ALL')}>
                      {lang === 'ar' ? 'عرض كل الدوريات' : 'View All Leagues'}
                    </button>
                  )}
                  {selectedTeam && (
                    <button className="kp-primary-small" onClick={() => setSelectedTeam('')}>
                      {lang === 'ar' ? 'عرض كل المباريات' : 'Show all matches'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="kp-match-list">
                  {matchGroups.map((group) => (
                    <section className="kp-league-group" key={group.code}>
                      <div className="kp-match-list-heading">
                        <span className="kp-league-dot">●</span>
                        <strong>{group.name}</strong>
                        <span>{group.matches.length} {lang === 'ar' ? 'مواجهات' : 'fixtures'}</span>
                        <i />
                      </div>
                      <div className="kp-match-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {group.matches.map((m) => (
                          <MatchCard
                            key={m.id}
                            match={m}
                            user={user}
                            lang={lang}
                            t={t}
                            boostsLeft={(competition === 'ALL' || competition === 'LIVE') ? (m._boostsLeft ?? 0) : boostsLeft}
                            onSaved={(prediction, boostsUsed) => {
                              setData((prev) => ({
                                ...prev,
                                boostsUsed: (competition === 'ALL' || competition === 'LIVE') ? prev.boostsUsed : boostsUsed,
                                matches: prev.matches.map((x) => {
                                  const sameLeagueRound = (competition === 'ALL' || competition === 'LIVE') && x._competitionCode === m._competitionCode;
                                  if (x.id === m.id) {
                                    return {
                                      ...x,
                                      prediction,
                                      ...(sameLeagueRound ? { _boostsLeft: Math.max(0, (x._maxBoosts || 0) - (boostsUsed || 0)) } : {})
                                    };
                                  }
                                  if (sameLeagueRound) {
                                    return {
                                      ...x,
                                      _boostsLeft: Math.max(0, (x._maxBoosts || 0) - (boostsUsed || 0))
                                    };
                                  }
                                  return x;
                                })
                              }));
                              showToast(t.savedOk);
                            }}
                            onError={(msg) => showToast(msg, true)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'leaderboard' && (
            <Leaderboard
              lang={lang}
              t={t}
              search={search}
              setSearch={setSearch}
              leaderboard={leaderboard}
            />
          )}

          {/* Cup tab hidden until cup fixtures are ready */}
          {ENABLE_CUP && tab === 'cup' && <CupPanel lang={lang} setTab={setTab} />}

          {tab === 'rules' && <RulesPanel lang={lang} t={t} setTab={setTab} />}

          {tab === 'profile' && (
            <ProfilePanel
              user={user}
              lang={lang}
              t={t}
              onLogout={handleLogout}
            />
          )}

          <footer className="kp-content-footer">
            <span>© 2026 KICKPREDICT</span>
            <span>{lang === 'ar' ? 'توقع. اجمع النقاط. تصدّر.' : 'PREDICT. COLLECT. CLIMB.'}</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
