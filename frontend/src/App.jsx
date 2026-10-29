import React, { useCallback, useEffect, useState } from 'react';
import './App.css';

// Keep API calls same-origin by default. Vite proxies /api in development,
// and frontend/vercel.json rewrites /api to the backend in production.
const DEFAULT_API_BASE = '/api';
const API_BASE = String(import.meta.env.VITE_API_URL || DEFAULT_API_BASE).replace(/\/+$/, '');

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, { ...options, credentials: 'include', headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Static content
// ---------------------------------------------------------------------------
const EXTRAS = [
  { key: 'btts', cat: 'goals', en: 'Both teams to score?', ar: 'هل يسجل الفريقان؟', options: ['YES', 'NO'] },
  { key: 'ou_1_5', cat: 'goals', en: 'Over or under 1.5 goals?', ar: 'أكثر أم أقل من 1.5 هدف؟', options: ['OVER', 'UNDER'] },
  { key: 'ou_2_5', cat: 'goals', en: 'Over or under 2.5 goals?', ar: 'أكثر أم أقل من 2.5 هدف؟', options: ['OVER', 'UNDER'] },
  { key: 'ou_3_5', cat: 'goals', en: 'Over or under 3.5 goals?', ar: 'أكثر أم أقل من 3.5 هدف؟', options: ['OVER', 'UNDER'] },
  { key: 'goals_odd_even', cat: 'goals', en: 'Total goals odd or even?', ar: 'مجموع الأهداف فردي أم زوجي؟', options: ['ODD', 'EVEN'] },
  { key: 'ht_leader', cat: 'halves', en: 'Who leads at half-time?', ar: 'من يتقدم في الشوط الأول؟', options: ['HOME', 'DRAW', 'AWAY'] },
  { key: 'goal_both_halves', cat: 'halves', en: 'A goal in both halves?', ar: 'هدف في كلا الشوطين؟', options: ['YES', 'NO'] },
  { key: 'more_goals_half', cat: 'halves', en: 'Which half has more goals?', ar: 'أي شوط فيه أهداف أكثر؟', options: ['FIRST', 'EQUAL', 'SECOND'] },
  {
    key: 'clean_sheet',
    cat: 'result',
    en: 'Clean sheet',
    ar: 'الشباك النظيفة',
    options: ['HOME', 'AWAY', 'BOTH', 'NONE'],
    labels: {
      en: { HOME: 'Home only', AWAY: 'Away only', BOTH: 'Both (0-0)', NONE: 'None' },
      ar: { HOME: 'المضيف فقط', AWAY: 'الضيف فقط', BOTH: 'الاثنان (0-0)', NONE: 'لا أحد' }
    }
  },
  { key: 'win_by_2plus', cat: 'result', en: 'Win by 2+ goals?', ar: 'فوز بفارق هدفين أو أكثر؟', options: ['YES', 'NO'] }
];

const CATEGORIES = ['goals', 'halves', 'result'];

const OPTION_LABELS = {
  en: {
    YES: 'Yes', NO: 'No', OVER: 'Over', UNDER: 'Under', ODD: 'Odd', EVEN: 'Even',
    HOME: 'Home', DRAW: 'Draw', AWAY: 'Away', FIRST: '1st half', SECOND: '2nd half', EQUAL: 'Equal',
    BOTH: 'Both', NONE: 'None'
  },
  ar: {
    YES: 'نعم', NO: 'لا', OVER: 'أكثر', UNDER: 'أقل', ODD: 'فردي', EVEN: 'زوجي',
    HOME: 'المضيف', DRAW: 'تعادل', AWAY: 'الضيف', FIRST: 'الأول', SECOND: 'الثاني', EQUAL: 'متساوي',
    BOTH: 'الاثنان', NONE: 'لا أحد'
  }
};

function localDateKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayLabel(key, lang) {
  const d = new Date(`${key}T12:00:00`);
  return {
    weekday: new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'short' }).format(d),
    day: new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { day: '2-digit' }).format(d),
    month: new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { month: 'short' }).format(d)
  };
}

const T = {
  en: {
    brand: 'KICKPREDICT',
    matches: 'Matches',
    leaderboard: 'Leaderboard',
    login: 'Login with Kick',
    logout: 'Logout',
    pts: 'pts',
    boostsLeft: 'x2 boosts left',
    loginPrompt: 'Log in with Kick to make your picks before kickoff.',
    rules:
      'Free to play. Points change from match to match: the less likely your pick, the more it pays. Lock in who wins, the exact score and up to 3 extras.',
    whoWins: 'Who wins?',
    exactScore: 'Exact score',
    howScorePays: 'How the score pays',
    extras: 'Extras',
    extrasHint: 'Pick up to 3',
    cat_goals: 'Goals',
    cat_halves: 'Halves',
    cat_result: 'Result',
    boost: 'x2 Boost',
    lock: 'Lock in picks',
    locking: 'Locking...',
    locked: 'Locked',
    live: 'Started',
    finished: 'Finished',
    potential: 'Up to',
    maxExtras: 'You can pick at most 3 extras.',
    bothScores: 'Enter both scores, or leave both empty.',
    savedOk: 'Picks locked in!',
    home: 'Home',
    draw: 'Draw',
    away: 'Away',
    close: 'Close',
    rank: 'Rank',
    player: 'Player',
    exact: 'Exact scores',
    total: 'Total points',
    search: 'Search player...',
    noMatches: 'No matches synced yet. The server loads them a few seconds after it starts.',
    loadError: 'Could not reach the server.',
    retry: 'Retry',
    yourPicks: 'Your picks',
    result: 'Result',
    void: 'void',
    gridHint: 'Tap a score to pick it. Rows: home goals, columns: away goals.'
  },
  ar: {
    brand: 'كيك بريديكت',
    matches: 'المباريات',
    leaderboard: 'المتصدرون',
    login: 'تسجيل الدخول عبر Kick',
    logout: 'خروج',
    pts: 'نقطة',
    boostsLeft: 'مضاعفات x2 متبقية',
    loginPrompt: 'سجّل دخولك عبر Kick لتثبّت توقعاتك قبل صافرة البداية.',
    rules:
      'مجاني بالكامل. النقاط تتغير من مباراة لأخرى: كلما كان توقعك أقل احتمالاً دفع أكثر. ثبّت الفائز والنتيجة الدقيقة وحتى 3 توقعات إضافية.',
    whoWins: 'من يفوز؟',
    exactScore: 'النتيجة الدقيقة',
    howScorePays: 'جدول نقاط النتيجة',
    extras: 'توقعات إضافية',
    extrasHint: 'اختر حتى 3',
    cat_goals: 'الأهداف',
    cat_halves: 'الأشواط',
    cat_result: 'النتيجة',
    boost: 'مضاعفة x2',
    lock: 'تثبيت التوقعات',
    locking: 'جاري التثبيت...',
    locked: 'مثبّت',
    live: 'بدأت',
    finished: 'انتهت',
    potential: 'حتى',
    maxExtras: 'الحد الأقصى 3 توقعات إضافية.',
    bothScores: 'أدخل النتيجتين معاً أو اتركهما فارغتين.',
    savedOk: 'تم تثبيت توقعاتك!',
    home: 'المضيف',
    draw: 'تعادل',
    away: 'الضيف',
    close: 'إغلاق',
    rank: 'المركز',
    player: 'اللاعب',
    exact: 'نتائج دقيقة',
    total: 'مجموع النقاط',
    search: 'ابحث عن لاعب...',
    noMatches: 'لا توجد مباريات بعد. يحملها السيرفر بعد ثوانٍ من تشغيله.',
    loadError: 'تعذر الاتصال بالسيرفر.',
    retry: 'إعادة المحاولة',
    yourPicks: 'توقعاتك',
    result: 'النتيجة',
    void: 'ملغي',
    gridHint: 'اضغط على نتيجة لاختيارها. الصفوف: أهداف المضيف، الأعمدة: أهداف الضيف.'
  }
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
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
      if (competition === 'ALL') {
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
          competition: 'ALL',
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
  }, [competition, round, user, competitions]);

  useEffect(() => {
    if (tab === 'matches') loadMatches();
  }, [tab, loadMatches]);

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

  const allMatches = data?.matches || [];
  const availableDates = Array.from(new Set(allMatches.map((m) => localDateKey(m.utc_date)).filter(Boolean))).sort();
  const selectedMatches = allMatches.filter((m) => {
    const dateMatches = !selectedDate || localDateKey(m.utc_date) === selectedDate;
    const teamMatches = !selectedTeam || m.home_team === selectedTeam || m.away_team === selectedTeam;
    return dateMatches && teamMatches;
  });
  const followedTeams = Array.from(new Set(allMatches.flatMap((m) => [m.home_team, m.away_team]).filter(Boolean))).slice(0, 8);
  const matchGroups = competition === 'ALL'
    ? competitions.map((c) => ({ code: c.code, name: c.name, matches: selectedMatches.filter((m) => m.competition_code === c.code) })).filter((group) => group.matches.length)
    : [{ code: competition, name: competitions.find((c) => c.code === competition)?.name || competition, matches: selectedMatches }];
  const navItems = [
    { key: 'matches', label: lang === 'ar' ? 'المباريات' : 'Matches', icon: '⚽' },
    { key: 'leaderboard', label: lang === 'ar' ? 'الترتيب' : 'Table', icon: '▤' },
    { key: 'cup', label: lang === 'ar' ? 'الكأس' : 'Cup', icon: '🏆' },
    { key: 'rules', label: lang === 'ar' ? 'القوانين' : 'Rules', icon: 'ⓘ' },
    { key: 'profile', label: lang === 'ar' ? 'حسابي' : 'My Profile', icon: '◉' }
  ];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="kp-app">
      <header className="kp-header">
        <div className="kp-header-inner">
          <button className="kp-brand" onClick={() => setTab('matches')} aria-label="KickPredict home">
            <span className="kp-brand-mark">K</span>
            <span className="kp-brand-copy">
              <strong>KICK<span>PREDICT</span></strong>
              <small>{lang === 'ar' ? 'دوري التوقعات' : 'THE PREDICTION LEAGUE'}</small>
            </span>
          </button>

          <nav className="kp-top-nav" aria-label="Main navigation">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`kp-nav-link ${tab === item.key ? 'is-active' : ''}`}
              >
                <span className="kp-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="kp-account-actions">
            {user && (
              <div className="kp-points-pill" title={lang === 'ar' ? 'مجموع النقاط' : 'Total points'}>
                <span className="kp-coin">✦</span>
                <strong>{Number(user.total_points || 0).toLocaleString()}</strong>
                <small>PTS</small>
              </div>
            )}
            <button className="kp-language-toggle" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
              {lang === 'en' ? 'عربي' : 'EN'}
            </button>
            {user ? (
              <button className="kp-avatar-button" onClick={() => setTab('profile')} title={user.username}>
                {user.avatar_url ? <img src={user.avatar_url} alt="" /> : <span>{String(user.username || 'P').slice(0, 1).toUpperCase()}</span>}
              </button>
            ) : (
              <a className="kp-login-button" href={`${API_BASE}/auth/kick`}>
                <span>↗</span> {t.login}
              </a>
            )}
          </div>
        </div>
      </header>

      {toast && (
        <div className={`kp-toast ${toast.isError ? 'is-error' : ''}`} role="status">
          <span>{toast.isError ? '!' : '✓'}</span>{toast.msg}
        </div>
      )}

      <section className="kp-hero-wrap">
        <div className="kp-hero">
          <div className="kp-hero-content">
            <div className="kp-eyebrow"><span className="kp-eyebrow-dot" /> {lang === 'ar' ? 'موسم التوقعات مفتوح' : 'PREDICTION SEASON IS LIVE'}</div>
            <h1>{lang === 'ar' ? <>كل مباراة.<br /><em>توقعك يصنع الفرق.</em></> : <>Your league.<br /><em>Your call.</em></>}</h1>
            <p>{lang === 'ar' ? 'توقع النتائج، اجمع النقاط، وتصدر جدول الدوري.' : 'Call the score. Climb the table. Own the bragging rights.'}</p>
            <div className="kp-hero-meta">
              <span>⚡ {lang === 'ar' ? 'مجاني للعب' : 'FREE TO PLAY'}</span>
              <span>•</span>
              <span>{lang === 'ar' ? 'توقعات قبل البداية' : 'PICKS LOCK AT KICK-OFF'}</span>
            </div>
          </div>
          <div className="kp-hero-art" aria-hidden="true">
            <div className="kp-stadium-ring ring-one" />
            <div className="kp-stadium-ring ring-two" />
            <div className="kp-pitch">
              <span className="kp-pitch-half" />
              <span className="kp-pitch-circle" />
              <span className="kp-pitch-box box-top" />
              <span className="kp-pitch-box box-bottom" />
            </div>
            <div className="kp-hero-star">✦</div>
          </div>
        </div>
      </section>

      <main className="kp-layout">
        <aside className="kp-sidebar">
          <section className="kp-side-section">
            <div className="kp-side-heading">{lang === 'ar' ? 'المسابقات' : 'LEAGUES'} <span>⌄</span></div>
            <button className={`kp-side-link ${competition === 'ALL' ? 'is-selected' : ''}`} onClick={() => changeCompetition('ALL')}>
              <span className="kp-side-symbol all-symbol">✦</span>
              <span>{lang === 'ar' ? 'كل الدوريات' : 'All Leagues'}</span>
            </button>
            {competitions.map((c) => (
              <button key={c.code} onClick={() => changeCompetition(c.code)} className={`kp-side-link ${competition === c.code ? 'is-selected' : ''}`}>
                <span className={`kp-side-symbol league-${String(c.code).toLowerCase()}`}>{c.code === 'CL' ? '★' : c.code === 'PL' ? '◈' : c.code === 'PD' ? '◉' : c.code === 'SA' ? '●' : c.code === 'BL1' ? '◆' : '◎'}</span>
                <span className="kp-side-link-text">{c.name}</span>
                {competition === c.code && <span className="kp-side-active-dot" />}
              </button>
            ))}
          </section>

          <section className="kp-side-section kp-follow-section">
            <div className="kp-side-heading">{lang === 'ar' ? 'فرق تتابعها' : 'TEAMS YOU FOLLOW'} <span>⌄</span></div>
            {followedTeams.length ? followedTeams.map((team) => (
              <button key={team} onClick={() => setSelectedTeam(selectedTeam === team ? '' : team)} className={`kp-side-link kp-team-link ${selectedTeam === team ? 'is-selected' : ''}`}>
                <span className="kp-team-dot">{String(team).slice(0, 1).toUpperCase()}</span>
                <span className="kp-side-link-text">{team}</span>
                {selectedTeam === team && <span className="kp-side-active-dot" />}
              </button>
            )) : <p className="kp-side-empty">{lang === 'ar' ? 'ستظهر الفرق هنا عند تحميل المباريات.' : 'Teams appear here once matches load.'}</p>}
            {selectedTeam && <button className="kp-clear-filter" onClick={() => setSelectedTeam('')}>{lang === 'ar' ? 'مسح فلتر الفريق ×' : 'Clear team filter ×'}</button>}
          </section>

          <section className="kp-side-section kp-games-section">
            <div className="kp-side-heading">{lang === 'ar' ? 'ألعاب إضافية' : 'EXTRA GAMES'} <span>⌄</span></div>
            <div className="kp-extra-game-row">
              <span className="kp-monopoly-icon">🎲</span>
              <span><strong>Monopoly</strong><small>{lang === 'ar' ? 'قريبًا' : 'COMING SOON'}</small></span>
              <span className="kp-soon-tag">SOON</span>
            </div>
          </section>

          <div className="kp-side-card">
            <div className="kp-side-card-icon">⚡</div>
            <strong>{lang === 'ar' ? 'ضاعف فرصك' : 'Play smart.'}</strong>
            <p>{lang === 'ar' ? 'استخدم مضاعف النقاط في الجولة المناسبة.' : 'Use your x2 boost when it matters most.'}</p>
            <button onClick={() => user ? setTab('matches') : (window.location.href = `${API_BASE}/auth/kick`)}>{lang === 'ar' ? 'ابدأ التوقع' : 'Make your picks'} <span>→</span></button>
          </div>

          <div className="kp-sidebar-foot">KICKPREDICT <span>© 2026</span></div>
        </aside>

        <section className="kp-content">
          {loadError && (
            <div className="kp-error-banner">
              <span>{t.loadError} ({loadError})</span>
              <button onClick={() => { void (tab === 'leaderboard' ? loadLeaderboard() : loadMatches()); }}>{t.retry}</button>
            </div>
          )}

          {tab === 'matches' && (
            <>
              <div className="kp-section-head">
                <div>
                  <div className="kp-section-kicker">{lang === 'ar' ? 'مركز المباريات' : 'MATCH CENTRE'}</div>
                  <h2>{lang === 'ar' ? 'اختر مبارياتك' : 'Pick your matches'} <span className="kp-live-pip" /></h2>
                  <p>{lang === 'ar' ? 'اختر اليوم، ثم ثبّت توقعاتك قبل انطلاق المباراة.' : 'Choose a day, lock in your picks before kick-off.'}</p>
                </div>
                <div className="kp-round-badge">
                  <span className="kp-round-star">✦</span>
                  <span><small>{lang === 'ar' ? 'الجولة الحالية' : 'CURRENT ROUND'}</small><strong>{roundLabel || (lang === 'ar' ? 'الجولة' : 'Matchday')}</strong></span>
                </div>
              </div>

              <div className="kp-date-strip" aria-label="Choose match day">
                {availableDates.length ? availableDates.slice(0, 9).map((date) => {
                  const label = formatDayLabel(date, lang);
                  const dayCount = allMatches.filter((m) => localDateKey(m.utc_date) === date).length;
                  return (
                    <button key={date} onClick={() => setSelectedDate(date)} className={`kp-date-chip ${selectedDate === date ? 'is-active' : ''}`}>
                      <span className="kp-date-weekday">{label.weekday}</span>
                      <strong>{label.day}</strong>
                      <span className="kp-date-month">{label.month}</span>
                      <span className="kp-date-count">{dayCount} {lang === 'ar' ? 'مباريات' : 'MATCH' + (dayCount === 1 ? '' : 'ES')}</span>
                    </button>
                  );
                }) : Array.from({ length: 5 }, (_, i) => {
                  const d = new Date(); d.setDate(d.getDate() + i);
                  const key = localDateKey(d);
                  const label = formatDayLabel(key, lang);
                  return <div key={key} className="kp-date-chip is-disabled"><span className="kp-date-weekday">{label.weekday}</span><strong>{label.day}</strong><span className="kp-date-month">{label.month}</span><span className="kp-date-count">—</span></div>;
                })}
              </div>

              <div className="kp-match-toolbar">
                <div className="kp-filter-summary">
                  <span className="kp-filter-icon">☷</span>
                  <strong>{selectedTeam || (competition === 'ALL' ? (lang === 'ar' ? 'كل الدوريات' : 'All Leagues') : competitions.find((c) => c.code === competition)?.name) || 'All Leagues'}</strong>
                  <span className="kp-filter-muted">{selectedMatches.length} {lang === 'ar' ? 'مباريات' : 'matches'}</span>
                </div>
                <div className="kp-match-toolbar-right">
                  {user ? <span className="kp-boost-count"><span>⚡</span> {competition === 'ALL' ? (lang === 'ar' ? 'المضاعفات حسب الدوري' : 'BOOSTS PER LEAGUE') : `${boostsLeft} / ${data?.maxBoosts ?? 0} ${lang === 'ar' ? 'مضاعفات متبقية' : 'BOOSTS LEFT'}`}</span> : <span className="kp-login-hint">{lang === 'ar' ? 'سجّل الدخول لتثبيت التوقعات' : 'Log in to lock in your picks'}</span>}
                  <button className="kp-refresh-button" onClick={() => { void loadMatches(); }} title={lang === 'ar' ? 'تحديث المباريات' : 'Refresh matches'}>↻</button>
                </div>
              </div>

              {loading && !data ? (
                <div className="kp-empty-state"><div className="kp-spinner" /><strong>{lang === 'ar' ? 'جاري تحميل المباريات...' : 'Loading matches...'}</strong></div>
              ) : !selectedMatches.length ? (
                <div className="kp-empty-state">
                  <div className="kp-empty-ball">⚽</div>
                  <strong>{selectedTeam ? (lang === 'ar' ? 'لا توجد مباريات لهذا الفريق في هذا اليوم' : 'No matches for this team on this day') : t.noMatches}</strong>
                  <p>{lang === 'ar' ? 'جرّب يومًا آخر أو اختر دوريًا مختلفًا.' : 'Try another day or choose a different league.'}</p>
                  {selectedTeam && <button className="kp-primary-small" onClick={() => setSelectedTeam('')}>{lang === 'ar' ? 'عرض كل المباريات' : 'Show all matches'}</button>}
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
                      <div className="kp-match-grid">
                        {group.matches.map((m) => (
                          <MatchCard
                            key={m.id}
                            match={m}
                            user={user}
                            lang={lang}
                            t={t}
                            boostsLeft={competition === 'ALL' ? (m._boostsLeft ?? 0) : boostsLeft}
                            onSaved={(prediction, boostsUsed) => {
                              setData((prev) => ({
                                ...prev,
                                boostsUsed: competition === 'ALL' ? prev.boostsUsed : boostsUsed,
                                matches: prev.matches.map((x) => {
                                  const sameLeagueRound = competition === 'ALL' && x._competitionCode === m._competitionCode;
                                  if (x.id === m.id) return { ...x, prediction, ...(sameLeagueRound ? { _boostsLeft: Math.max(0, (x._maxBoosts || 0) - (boostsUsed || 0)) } : {}) };
                                  if (sameLeagueRound) return { ...x, _boostsLeft: Math.max(0, (x._maxBoosts || 0) - (boostsUsed || 0)) };
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
            <div className="kp-panel">
              <div className="kp-section-head compact-head">
                <div><div className="kp-section-kicker">{lang === 'ar' ? 'المنافسة' : 'THE COMPETITION'}</div><h2>{lang === 'ar' ? 'جدول المتصدرين' : 'The leaderboard'}</h2><p>{lang === 'ar' ? 'تابع ترتيب اللاعبين ومجموع نقاطهم.' : 'See who is climbing the prediction table.'}</p></div>
                <span className="kp-trophy-large">🏆</span>
              </div>
              <div className="kp-search-wrap"><span>⌕</span><input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} /></div>
              <div className="kp-table-wrap"><table className="kp-leaderboard-table"><thead><tr><th>{t.rank}</th><th>{t.player}</th><th>{t.exact}</th><th>{t.total}</th></tr></thead><tbody>
                {leaderboard.map((row) => <tr key={row.id}><td><span className={`kp-rank-number ${row.rank <= 3 ? 'top-rank' : ''}`}>#{row.rank}</span></td><td><div className="kp-player-cell">{row.avatar_url ? <img src={row.avatar_url} alt="" /> : <span className="kp-player-placeholder">{String(row.username || 'P').slice(0, 1).toUpperCase()}</span>}<strong>{row.username}</strong></div></td><td>{row.exact_scores_count}</td><td><strong className="kp-points-value">{Number(row.total_points || 0).toLocaleString()} <small>PTS</small></strong></td></tr>)}
                {!leaderboard.length && <tr><td colSpan="4" className="kp-no-rows">{lang === 'ar' ? 'لا توجد نتائج مطابقة حتى الآن.' : 'No leaderboard entries found yet.'}</td></tr>}
              </tbody></table></div>
            </div>
          )}

          {tab === 'cup' && (
            <div className="kp-feature-panel"><div className="kp-feature-icon">🏆</div><div className="kp-section-kicker">KICKPREDICT CUP</div><h2>{lang === 'ar' ? 'الكأس قادم' : 'The Cup is coming'}</h2><p>{lang === 'ar' ? 'تستطيع متابعة المباريات وتوقع النتائج الآن. ستظهر مسابقات الكأس هنا عندما يتم ربطها بمصدر البيانات.' : 'League picks are ready. Cup fixtures will appear here when a cup competition is connected to your data source.'}</p><button className="kp-primary-small" onClick={() => setTab('matches')}>{lang === 'ar' ? 'العودة للمباريات' : 'Back to matches'} →</button></div>
          )}

          {tab === 'rules' && (
            <div className="kp-panel kp-rules-panel"><div className="kp-section-kicker">HOW TO PLAY</div><h2>{lang === 'ar' ? 'القوانين' : 'The rules of the game'}</h2><p>{t.rules}</p><div className="kp-rule-cards"><article><span>01</span><h3>{lang === 'ar' ? 'توقع النتيجة' : 'Make your call'}</h3><p>{lang === 'ar' ? 'اختر الفائز أو التعادل، ويمكنك إدخال النتيجة الدقيقة.' : 'Pick the winner or draw, then add an exact score if you like.'}</p></article><article><span>02</span><h3>{lang === 'ar' ? 'أضف توقعاتك' : 'Add extras'}</h3><p>{lang === 'ar' ? 'اختر حتى ثلاثة أسواق إضافية لكل مباراة.' : 'Choose up to three extra markets for every match.'}</p></article><article><span>03</span><h3>{lang === 'ar' ? 'ضاعف النقاط' : 'Boost your points'}</h3><p>{lang === 'ar' ? 'فعّل مضاعف x2 قبل إغلاق المباراة.' : 'Use an x2 boost before the fixture locks.'}</p></article></div><button className="kp-primary-small" onClick={() => setTab('matches')}>{lang === 'ar' ? 'ابدأ التوقع' : 'Start predicting'} →</button></div>
          )}

          {tab === 'profile' && (
            <div className="kp-panel kp-profile-panel">
              <div className="kp-section-kicker">MY PROFILE</div>
              {user ? <><div className="kp-profile-avatar">{user.avatar_url ? <img src={user.avatar_url} alt="" /> : String(user.username || 'P').slice(0, 1).toUpperCase()}</div><h2>{user.username}</h2><p>{lang === 'ar' ? 'إحصائياتك في دوري التوقعات' : 'Your prediction league stats'}</p><div className="kp-profile-stats"><div><strong>{Number(user.total_points || 0).toLocaleString()}</strong><span>{lang === 'ar' ? 'إجمالي النقاط' : 'TOTAL POINTS'}</span></div><div><strong>{Number(user.exact_scores_count || 0).toLocaleString()}</strong><span>{lang === 'ar' ? 'نتائج دقيقة' : 'EXACT SCORES'}</span></div></div><button className="kp-secondary-button" onClick={handleLogout}>{t.logout}</button></> : <><div className="kp-feature-icon">◉</div><h2>{lang === 'ar' ? 'ملفك الشخصي' : 'Your profile awaits'}</h2><p>{lang === 'ar' ? 'سجّل الدخول عبر Kick لعرض نقاطك وتثبيت توقعاتك.' : 'Log in with Kick to see your points and lock in predictions.'}</p><a className="kp-login-button large-login" href={`${API_BASE}/auth/kick`}>{t.login} ↗</a></>}
            </div>
          )}

          <footer className="kp-content-footer"><span>© 2026 KICKPREDICT</span><span>{lang === 'ar' ? 'توقع. اجمع النقاط. تصدّر.' : 'PREDICT. COLLECT. CLIMB.'}</span></footer>
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match card
// ---------------------------------------------------------------------------
function MatchCard({ match, user, lang, t, boostsLeft, onSaved, onError }) {
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

  // ----- points helpers (locked points win over live points) -----
  const outcomePts = (o) =>
    (pred && pred.predicted_outcome === o ? pred.outcome_points_locked : markets.outcome_1x2?.[o]) ?? 0;

  const exactPts = (h, a) =>
    (pred && pred.predicted_home === h && pred.predicted_away === a
      ? pred.exact_points_locked
      : markets.exact_score?.[`${h}-${a}`]) ?? 0;

  const extraPts = (market, selection) => {
    const locked = pred?.extras_picks?.find((p) => p.market === market && p.selection === selection);
    return locked ? locked.points_locked : markets.extras?.[market]?.[selection] ?? 0;
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
          <span className="kp-fixture-time"><span className="kp-clock-dot">◷</span> {new Date(match.utc_date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
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
              {match.is_locked && match.home_score != null && match.away_score != null
                ? <><strong>{match.home_score}</strong><span>:</span><strong>{match.away_score}</strong></>
                : <span>VS</span>}
            </div>
          )}

          <div className="flex min-w-0 items-center justify-end gap-2">
            <span className="truncate text-sm font-bold sm:text-base">{match.away_team}</span>
            {match.away_crest && <img src={match.away_crest} alt="" className="h-8 w-8 object-contain" />}
          </div>
        </div>

        <div className="kp-fixture-action-row">
          <div className="kp-fixture-status">
            {finished ? <span className="kp-status-final">{lang === 'ar' ? 'انتهت' : 'FULL TIME'}</span> : match.is_locked ? <span className="kp-status-live"><i /> {lang === 'ar' ? 'مباشر / بدأ' : 'LIVE / STARTED'}</span> : <span className="kp-status-upcoming">{lang === 'ar' ? 'لم تبدأ' : 'UPCOMING'}</span>}
            {match.status && !['TIMED', 'SCHEDULED', 'FINISHED'].includes(match.status) && <span className="kp-status-code">{match.status}</span>}
          </div>
          <button type="button" className={`kp-play-button ${expanded ? 'is-open' : ''}`} onClick={() => setExpanded(!expanded)}>
            {expanded ? (lang === 'ar' ? 'إخفاء' : 'Close picks') : pred ? (lang === 'ar' ? 'تعديل التوقع' : 'View picks') : (lang === 'ar' ? 'توقع الآن' : 'Play')} <span>{expanded ? '−' : '↗'}</span>
          </button>
        </div>

        {expanded && <div className="kp-prediction-editor">
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
        </div>}
      </form>

      {/* "How the score pays" modal */}
      {showGrid && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3"
          onClick={() => setShowGrid(false)}
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
                onClick={() => setShowGrid(false)}
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
                          onClick={() => {
                            setHome(String(h));
                            setAway(String(a));
                            setShowGrid(false);
                          }}
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
      )}
    </>
  );
}

function Chip({ ok, voided, voidText, children }) {
  const style = voided
    ? 'border-yellow-600 bg-yellow-950/60 text-yellow-300'
    : ok
    ? 'border-[#F0C72F] bg-[#F0C72F]/20 text-[#F0C72F]'
    : 'border-red-800 bg-red-950/50 text-red-400';
  return (
    <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${style}`}>
      {voided ? '– ' : ok ? '✓ ' : '✗ '}
      {children}
      {voided && voidText ? ` (${voidText})` : ''}
    </span>
  );
}
