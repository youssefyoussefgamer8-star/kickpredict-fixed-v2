# KickPredict

KickPredict is a React/Vite frontend and an Express/PostgreSQL backend for free-to-play football predictions.

## Requirements

- Node.js 20.19+ (Node 22 LTS recommended)
- PostgreSQL
- Kick OAuth credentials
- football-data.org API key for the default PL/PD/BL1/SA/FL1/CL match sync
- Optional: The Odds API or API-Football credentials for bookmaker odds

## Local setup

1. Copy `.env.example` to `.env`, then fill in your actual credentials. Do not commit `.env`.
2. Generate a JWT secret of at least 32 characters, for example with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Apply `schema.sql` to your PostgreSQL database. It is designed to be re-runnable and migrates the older match-column and boost-table names used by previous versions. Back up production data before applying it.
4. Install backend dependencies with `npm ci`.
5. In another terminal, run `npm ci --prefix frontend`.
6. Start the backend with `npm start` and the frontend with `npm run dev --prefix frontend`.
7. The frontend can use the configured `VITE_API_URL`; when that variable is omitted in local development, Vite proxies `/api` to `http://localhost:4000`.

## Environment variables

The backend expects `DATABASE_URL`, `JWT_SECRET`, `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`, `KICK_REDIRECT_URI`, `FOOTBALL_DATA_API_KEY`, `FRONTEND_URL`, and `MAX_BOOSTS_PER_MATCHDAY`.

For a Vercel frontend talking to a Render backend, set `NODE_ENV=production` on the backend. The frontend defaults to the same-origin `/api` path: Vite proxies it locally, and `frontend/vercel.json` rewrites it to Render in production. If your backend host changes, update that rewrite destination. You can normally leave `VITE_API_URL` unset or set it to `/api` on Vercel; do not point it directly at Render when using the rewrite, because that bypasses the same-origin path. Also set `FRONTEND_URL` and `CORS_ORIGINS` on the backend to the exact deployed frontend origin. For Kick OAuth, register and set `KICK_REDIRECT_URI` to `https://<your-vercel-domain>/api/auth/kick/callback` so the callback uses the same browser origin as the OAuth-state cookie; configure the exact same URI in the Kick developer settings. Production requires HTTPS.

## Database updates

Run `schema.sql` against the existing database. It adds `round_label`, `home_ht`, `away_ht`, `home_lambda`, `away_lambda`, and odds metadata when missing; maps values from the legacy `ht_home_score`, `ht_away_score`, `home_goals_avg`, and `away_goals_avg` columns; and migrates boost counters from `user_matchday_boosts` to `user_round_boosts` without deleting the legacy table.

## Match data and odds

- The server syncs the default six football-data.org competitions every 10 minutes.
- To sync Tunisia's Ligue 1, set `API_FOOTBALL_KEY` and `TUNISIA_SEASON`, add `TU1` to `COMPETITION_CODES`, apply `schema.sql`, and run `node sync-tunisia.js`. The API-Football subscription must provide fixtures for the requested season.
- Odds refresh is optional. When a supported key is configured, the backend schedules it with `ODDS_CRON` (default `10 6 * * *`). To trigger manually, use `node run-odds-now.js`. The bookmaker feed prices quoted selections; unquoted exact-score selections retain the model-based price. When a valid 1X2 market is available, the remaining model-priced markets use expected goals fitted approximately from those odds. Check provider quota before running repeated refreshes.
- `scrape-tunisia.js` only inserts separate `DEMO` fixtures; it never deletes or replaces actual Tunisian league matches. It requires `ALLOW_DEMO_DATA=true` and refuses to run in production.

## Additional review fixes

- The Odds API refresh matches each mapped event back to its database row before reading its expected-goals values; this avoids an undefined-variable error in the refresh loop.
- Partial correct-score feeds now price the quoted selections and keep model prices for unquoted scores. When a valid bookmaker 1X2 market is available, a bounded Poisson fit estimates expected goals for the other model-priced markets. This is an approximation, not a guarantee of higher predictive accuracy.
- The Tunisia sync calculates team ratings from finished fixtures returned for the selected season instead of assigning the same expected-goals values to every real match. The separate `scrape-tunisia.js` script is intentionally only a DEMO-data generator and must not be used as a real-data source.
- The frontend now displays Kick OAuth callback errors, retries the leaderboard from the leaderboard tab, uses a same-origin `/api` default, and has a KickPredict page title.
- `npm test` includes a mocked refresh path for The Odds API; no real API credentials or provider quota are needed for that test.

These tests do not replace a migration dry-run against a copy of the production database, a real Kick OAuth login, or live provider verification. Back up production data before migrations and validate deployment environment variables before going live.

## Checks

- `npm test`: offline tests for market pricing, settlement rules, and a mocked The Odds API refresh path.
- `npm run check`: syntax checks for backend JavaScript files.
- `npm run build --prefix frontend`: production frontend build.

Live API tests (`test-api.js`, `test-leagues.js`, and `test-odds.js`) require valid API credentials and may consume provider quota.
