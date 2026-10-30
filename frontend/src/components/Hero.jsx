import React from 'react';

export default function Hero({ lang }) {
  return (
    <section className="kp-hero-wrap">
      <div className="kp-hero">
        <div className="kp-hero-content">
          <div className="kp-eyebrow">
            <span className="kp-eyebrow-dot" />{' '}
            {lang === 'ar' ? 'موسم التوقعات مفتوح' : 'PREDICTION SEASON IS LIVE'}
          </div>
          <h1>
            {lang === 'ar' ? (
              <>
                كل مباراة.<br />
                <em>توقعك يصنع الفرق.</em>
              </>
            ) : (
              <>
                Your league.<br />
                <em>Your call.</em>
              </>
            )}
          </h1>
          <p>
            {lang === 'ar'
              ? 'توقع النتائج، اجمع النقاط، وتصدر جدول الدوري.'
              : 'Call the score. Climb the table. Own the bragging rights.'}
          </p>
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
  );
}
