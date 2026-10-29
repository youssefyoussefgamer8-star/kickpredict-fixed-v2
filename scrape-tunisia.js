'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { buildMatchMarketsPoints } = require('./pricingEngine');

// This script intentionally creates a separate DEMO competition. It never
// deletes or overwrites real Tunisian league data.
if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_DATA !== 'true') {
  console.error('Demo data generation is disabled. Set ALLOW_DEMO_DATA=true in a local .env to opt in.');
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in the root .env file.');
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const teams = [
    'Demo Espérance', 'Demo Club Africain', 'Demo Étoile du Sahel', 'Demo CS Sfaxien',
    'Demo US Monastir', 'Demo Stade Tunisien', 'Demo Olympique Béja', 'Demo ES Zarzis',
    'Demo CA Bizertin', 'Demo US Ben Guerdane', 'Demo AS Soliman', 'Demo EGS Gafsa',
    'Demo JS Omrane', 'Demo AS Gabès', 'Demo US Tataouine', 'Demo ES Métlaoui'
  ];

  (async () => {
    const now = Date.now();
    let inserted = 0;
    const stableUnit = (value) => {
      let hash = 2166136261;
      for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
      return (hash % 1000) / 1000;
    };
    for (let i = 0; i < teams.length; i += 2) {
      const matchday = 1;
      const kickoff = new Date(now + (i / 2 + 1) * 3600000 * 8).toISOString();
      // These are synthetic demo values only; they are not claims about real clubs.
      const homeLambda = Number((1.1 + stableUnit(teams[i]) * 1.35).toFixed(2));
      const awayLambda = Number((0.65 + stableUnit(teams[i + 1]) * 1.15).toFixed(2));
      const points = buildMatchMarketsPoints(homeLambda, awayLambda);
      await pool.query(
        `INSERT INTO matches (
           external_id, competition_code, stage, matchday, round_key, round_label,
           home_team, away_team, utc_date, status, home_lambda, away_lambda,
           markets_points, updated_at
         ) VALUES ($1, 'DEMO', 'REGULAR_SEASON', $2, $3, $4, $5, $6, $7,
                   'SCHEDULED', $8, $9, $10::jsonb, NOW())
         ON CONFLICT (external_id) DO NOTHING`,
        [
          9900000000 + i, matchday, `MD:${matchday}`, `Demo Matchday ${matchday}`,
          teams[i], teams[i + 1], kickoff, homeLambda, awayLambda, JSON.stringify(points)
        ]
      );
      inserted++;
    }
    console.log(`[Demo] Prepared ${inserted} demo fixtures in competition DEMO. No rows were deleted.`);
  })()
    .catch((error) => {
      console.error('[Demo] Failed:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
