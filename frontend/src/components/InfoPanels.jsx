import React from 'react';
import { API_BASE } from '../utils/api';

export function CupPanel({ lang, setTab }) {
  return (
    <div className="kp-feature-panel">
      <div className="kp-feature-icon">🏆</div>
      <div className="kp-section-kicker">KICKPREDICT CUP</div>
      <h2>{lang === 'ar' ? 'الكأس قادم' : 'The Cup is coming'}</h2>
      <p>
        {lang === 'ar'
          ? 'تستطيع متابعة المباريات وتوقع النتائج الآن. ستظهر مسابقات الكأس هنا عندما يتم ربطها بمصدر البيانات.'
          : 'League picks are ready. Cup fixtures will appear here when a cup competition is connected to your data source.'}
      </p>
      <button className="kp-primary-small" onClick={() => setTab('matches')}>
        {lang === 'ar' ? 'العودة للمباريات' : 'Back to matches'} →
      </button>
    </div>
  );
}

export function RulesPanel({ lang, t, setTab }) {
  const ENABLE_BOOSTS = false; // Toggle to true when boost is enabled on server
  return (
    <div className="kp-panel kp-rules-panel">
      <div className="kp-section-kicker">HOW TO PLAY</div>
      <h2>{lang === 'ar' ? 'القوانين' : 'The rules of the game'}</h2>
      <p>{t.rules}</p>
      <div className="kp-rule-cards">
        <article>
          <span>01</span>
          <h3>{lang === 'ar' ? 'توقع النتيجة' : 'Make your call'}</h3>
          <p>
            {lang === 'ar'
              ? 'اختر الفائز أو التعادل، ويمكنك إدخال النتيجة الدقيقة.'
              : 'Pick the winner or draw, then add an exact score if you like.'}
          </p>
        </article>
        <article>
          <span>02</span>
          <h3>{lang === 'ar' ? 'أضف توقعاتك' : 'Add extras'}</h3>
          <p>
            {lang === 'ar'
              ? 'اختر حتى ثلاثة أسواق إضافية لكل مباراة.'
              : 'Choose up to three extra markets for every match.'}
          </p>
        </article>
        {/* Boost rule card hidden until feature is enabled on server */}
        {ENABLE_BOOSTS && (
          <article>
            <span>03</span>
            <h3>{lang === 'ar' ? 'ضاعف النقاط' : 'Boost your points'}</h3>
            <p>
              {lang === 'ar'
                ? 'فعّل مضاعف x2 قبل إغلاق المباراة.'
                : 'Use an x2 boost before the fixture locks.'}
            </p>
          </article>
        )}
      </div>
      <button className="kp-primary-small" onClick={() => setTab('matches')}>
        {lang === 'ar' ? 'ابدأ التوقع' : 'Start predicting'} →
      </button>
    </div>
  );
}

export function ProfilePanel({ user, lang, t, onLogout }) {
  return (
    <div className="kp-panel kp-profile-panel">
      <div className="kp-section-kicker">MY PROFILE</div>
      {user ? (
        <>
          <div className="kp-profile-avatar">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" />
            ) : (
              String(user.username || 'P').slice(0, 1).toUpperCase()
            )}
          </div>
          <h2>{user.username}</h2>
          <p>{lang === 'ar' ? 'إحصائياتك في دوري التوقعات' : 'Your prediction league stats'}</p>
          <div className="kp-profile-stats">
            <div>
              <strong>{Number(user.total_points || 0).toLocaleString()}</strong>
              <span>{lang === 'ar' ? 'إجمالي النقاط' : 'TOTAL POINTS'}</span>
            </div>
            <div>
              <strong>{Number(user.exact_scores_count || 0).toLocaleString()}</strong>
              <span>{lang === 'ar' ? 'نتائج دقيقة' : 'EXACT SCORES'}</span>
            </div>
          </div>
          <button className="kp-secondary-button" onClick={onLogout}>
            {t.logout}
          </button>
        </>
      ) : (
        <>
          <div className="kp-feature-icon">◉</div>
          <h2>{lang === 'ar' ? 'ملفك الشخصي' : 'Your profile awaits'}</h2>
          <p>
            {lang === 'ar'
              ? 'سجّل الدخول عبر Kick لعرض نقاطك وتثبيت توقعاتك.'
              : 'Log in with Kick to see your points and lock in predictions.'}
          </p>
          <a className="kp-login-button large-login" href={`${API_BASE}/auth/kick`}>
            {t.login} ↗
          </a>
        </>
      )}
    </div>
  );
}
