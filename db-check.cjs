require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const result = await pool.query(`
      SELECT id, external_id, competition_code, round_key,
             home_team, away_team, status
      FROM public.matches
      WHERE external_id = 999999999991
    `);
    console.log(result.rows);
  } catch (e) {
    console.error(e.message);
  } finally {
    await pool.end();
  }
}

main();
