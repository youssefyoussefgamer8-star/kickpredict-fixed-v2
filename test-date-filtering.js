const assert = require('assert');
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Test dateUtils logic
function localDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function utcDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    return value.trim().slice(0, 10);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function isMatchOnDate(utcDate, targetDateStr) {
  if (!utcDate || !targetDateStr) return false;
  const target = targetDateStr.trim();
  const lKey = localDateKey(utcDate);
  if (lKey === target) return true;
  const uKey = utcDateKey(utcDate);
  if (uKey === target) return true;
  try {
    const targetNoon = new Date(`${target}T12:00:00Z`).getTime();
    const matchTime = new Date(utcDate).getTime();
    if (!Number.isNaN(targetNoon) && !Number.isNaN(matchTime)) {
      if (Math.abs(matchTime - targetNoon) <= 14 * 3600 * 1000) {
        return true;
      }
    }
  } catch {}
  return false;
}

async function runTests() {
  console.log('--- Testing isMatchOnDate Timezone Resilience ---');
  // Match kickoff at 20:00 UTC on 2026-11-04
  const matchUtc = '2026-11-04T20:00:00.000Z';
  assert.strictEqual(isMatchOnDate(matchUtc, '2026-11-04'), true, 'Should match 2026-11-04');
  assert.strictEqual(isMatchOnDate(matchUtc, '2026-11-05'), false, 'Should not match 2026-11-05');
  assert.strictEqual(isMatchOnDate(matchUtc, '2026-11-03'), false, 'Should not match 2026-11-03');

  // Match kickoff at 17:45 UTC on 2026-11-04
  const matchEarly = '2026-11-04T17:45:00.000Z';
  assert.strictEqual(isMatchOnDate(matchEarly, '2026-11-04'), true, 'Should match 2026-11-04');
  assert.strictEqual(isMatchOnDate(matchEarly, '2026-11-03'), false, 'Should not match 2026-11-03');

  console.log('✓ isMatchOnDate unit tests passed cleanly');

  console.log('\n--- Testing PostgreSQL Date Filtering Query ---');
  const COMPETITIONS = ['PL', 'PD', 'BL1', 'SA', 'FL1', 'CL', 'TUN'];
  const testDate = '2026-11-04';

  const res = await pool.query(
    `SELECT id, competition_code, home_team, away_team, utc_date, status
     FROM matches
     WHERE competition_code = ANY($1::varchar[])
       AND (fotmob_id IS NOT NULL OR flashscore_id IS NOT NULL OR utc_date >= NOW() - INTERVAL '4 days')
       AND (
         (utc_date AT TIME ZONE 'UTC')::date BETWEEN $2::date AND $3::date
         OR (utc_date AT TIME ZONE 'Africa/Tunis')::date BETWEEN $2::date AND $3::date
         OR (utc_date AT TIME ZONE 'Europe/London')::date BETWEEN $2::date AND $3::date
       )
     ORDER BY utc_date ASC, id ASC`,
    [COMPETITIONS, testDate, testDate]
  );

  console.log(`Found ${res.rows.length} matches for date ${testDate}`);
  assert.strictEqual(res.rows.length, 9, `Expected exactly 9 CL matches on ${testDate}`);
  for (const row of res.rows) {
    assert.strictEqual(row.competition_code, 'CL', 'Match should be Champions League');
    assert.strictEqual(isMatchOnDate(row.utc_date, testDate), true, 'Frontend matcher should also confirm match belongs to date');
  }
  console.log('✓ All 9 Champions League matches on 2026-11-04 successfully identified and matched!');

  await pool.end();
  console.log('\nALL DATE FILTERING TESTS PASSED 100%!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
