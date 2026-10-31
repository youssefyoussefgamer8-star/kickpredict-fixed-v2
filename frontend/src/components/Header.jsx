import React from 'react';
import { API_BASE } from '../utils/api';

export default function Header({
  lang,
  tab,
  setTab,
  user,
  setLang,
  navItems,
  t
}) {
  return (
    <header className="kp-header">
      <div className="kp-header-inner w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" />
              ) : (
                <span>{String(user.username || 'P').slice(0, 1).toUpperCase()}</span>
              )}
            </button>
          ) : (
            <a className="kp-login-button" href={`${API_BASE}/auth/kick`}>
              <span>↗</span> {t.login}
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
