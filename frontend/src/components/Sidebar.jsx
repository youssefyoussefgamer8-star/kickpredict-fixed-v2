import React from 'react';
import { API_BASE } from '../utils/api';

export default function Sidebar({
  lang,
  competition,
  competitions,
  changeCompetition,
  followedTeams,
  selectedTeam,
  setSelectedTeam,
  user,
  setTab
}) {
  return (
    <aside className="kp-sidebar">
      <section className="kp-side-section">
        <div className="kp-side-heading">{lang === 'ar' ? 'المسابقات' : 'LEAGUES'} <span>⌄</span></div>
        <button
          className={`kp-side-link ${competition === 'ALL' ? 'is-selected' : ''}`}
          onClick={() => changeCompetition('ALL')}
        >
          <span className="kp-side-symbol all-symbol">✦</span>
          <span>{lang === 'ar' ? 'كل الدوريات' : 'All Leagues'}</span>
        </button>
        {competitions.map((c) => (
          <button
            key={c.code}
            onClick={() => changeCompetition(c.code)}
            className={`kp-side-link ${competition === c.code ? 'is-selected' : ''}`}
          >
            <span className={`kp-side-symbol league-${String(c.code).toLowerCase()}`}>
              {c.code === 'CL' ? '★' : c.code === 'PL' ? '◈' : c.code === 'PD' ? '◉' : c.code === 'SA' ? '●' : c.code === 'BL1' ? '◆' : '◎'}
            </span>
            <span className="kp-side-link-text">{c.name}</span>
            {competition === c.code && <span className="kp-side-active-dot" />}
          </button>
        ))}
      </section>

      <section className="kp-side-section kp-follow-section">
        <div className="kp-side-heading">{lang === 'ar' ? 'فرق تتابعها' : 'TEAMS YOU FOLLOW'} <span>⌄</span></div>
        {followedTeams.length ? (
          followedTeams.map((team) => (
            <button
              key={team}
              onClick={() => setSelectedTeam(selectedTeam === team ? '' : team)}
              className={`kp-side-link kp-team-link ${selectedTeam === team ? 'is-selected' : ''}`}
            >
              <span className="kp-team-dot">{String(team).slice(0, 1).toUpperCase()}</span>
              <span className="kp-side-link-text">{team}</span>
              {selectedTeam === team && <span className="kp-side-active-dot" />}
            </button>
          ))
        ) : (
          <p className="kp-side-empty">{lang === 'ar' ? 'ستظهر الفرق هنا عند تحميل المباريات.' : 'Teams appear here once matches load.'}</p>
        )}
        {selectedTeam && (
          <button className="kp-clear-filter" onClick={() => setSelectedTeam('')}>
            {lang === 'ar' ? 'مسح فلتر الفريق ×' : 'Clear team filter ×'}
          </button>
        )}
      </section>

      <section className="kp-side-section kp-games-section">
        <div className="kp-side-heading">{lang === 'ar' ? 'ألعاب إضافية' : 'EXTRA GAMES'} <span>⌄</span></div>
        <div className="kp-extra-game-row">
          <span className="kp-monopoly-icon">🎲</span>
          <span>
            <strong>Monopoly</strong>
            <small>{lang === 'ar' ? 'قريبًا' : 'COMING SOON'}</small>
          </span>
          <span className="kp-soon-tag">SOON</span>
        </div>
      </section>

      <div className="kp-side-card">
        <div className="kp-side-card-icon">⚡</div>
        <strong>{lang === 'ar' ? 'ضاعف فرصك' : 'Play smart.'}</strong>
        <p>{lang === 'ar' ? 'استخدم مضاعف النقاط في الجولة المناسبة.' : 'Use your x2 boost when it matters most.'}</p>
        <button onClick={() => (user ? setTab('matches') : (window.location.href = `${API_BASE}/auth/kick`))}>
          {lang === 'ar' ? 'ابدأ التوقع' : 'Make your picks'} <span>→</span>
        </button>
      </div>

      <div className="kp-sidebar-foot">
        KICKPREDICT <span>© 2026</span>
      </div>
    </aside>
  );
}
