import React from 'react';

export default function Leaderboard({
  lang,
  t,
  search,
  setSearch,
  leaderboard
}) {
  return (
    <div className="kp-panel">
      <div className="kp-section-head compact-head">
        <div>
          <div className="kp-section-kicker">{lang === 'ar' ? 'المنافسة' : 'THE COMPETITION'}</div>
          <h2>{lang === 'ar' ? 'جدول المتصدرين' : 'The leaderboard'}</h2>
          <p>{lang === 'ar' ? 'تابع ترتيب اللاعبين ومجموع نقاطهم.' : 'See who is climbing the prediction table.'}</p>
        </div>
        <span className="kp-trophy-large">🏆</span>
      </div>
      <div className="kp-search-wrap">
        <span>⌕</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.search}
        />
      </div>
      <div className="kp-table-wrap">
        <table className="kp-leaderboard-table">
          <thead>
            <tr>
              <th>{t.rank}</th>
              <th>{t.player}</th>
              <th>{t.exact}</th>
              <th>{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className={`kp-rank-number ${row.rank <= 3 ? 'top-rank' : ''}`}>
                    #{row.rank}
                  </span>
                </td>
                <td>
                  <div className="kp-player-cell">
                    {row.avatar_url ? (
                      <img src={row.avatar_url} alt="" />
                    ) : (
                      <span className="kp-player-placeholder">
                        {String(row.username || 'P').slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <strong>{row.username}</strong>
                  </div>
                </td>
                <td>{row.exact_scores_count}</td>
                <td>
                  <strong className="kp-points-value">
                    {Number(row.total_points || 0).toLocaleString()} <small>PTS</small>
                  </strong>
                </td>
              </tr>
            ))}
            {!leaderboard.length && (
              <tr>
                <td colSpan="4" className="kp-no-rows">
                  {lang === 'ar' ? 'لا توجد نتائج مطابقة حتى الآن.' : 'No leaderboard entries found yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
