-- KickPredict Migration: Auto-correction & Settlement Tracking Columns
-- Safe to re-run in Neon PostgreSQL.
-- DO NOT RUN AUTOMATICALLY: Review and execute in Neon SQL console when ready.

BEGIN;

ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS settled_home_score INT,
    ADD COLUMN IF NOT EXISTS settled_away_score INT,
    ADD COLUMN IF NOT EXISTS settled_home_ht INT,
    ADD COLUMN IF NOT EXISTS settled_away_ht INT,
    ADD COLUMN IF NOT EXISTS last_corrected_at TIMESTAMPTZ;

-- Backfill existing settled matches so settled_* reflects what was previously calculated
UPDATE matches
SET 
    settled_home_score = COALESCE(settled_home_score, home_score),
    settled_away_score = COALESCE(settled_away_score, away_score),
    settled_home_ht = COALESCE(settled_home_ht, home_ht),
    settled_away_ht = COALESCE(settled_away_ht, away_ht)
WHERE points_calculated = TRUE 
  AND settled_home_score IS NULL;

COMMIT;
