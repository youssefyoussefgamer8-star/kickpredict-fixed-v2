-- KickPredict PostgreSQL schema and idempotent migration.
-- Safe to re-run. Back up production data before applying any migration.

BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    kick_id VARCHAR(64) UNIQUE NOT NULL,
    username VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    total_points INT NOT NULL DEFAULT 0,
    exact_scores_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
    id BIGSERIAL PRIMARY KEY,
    external_id BIGINT UNIQUE NOT NULL,
    competition_code VARCHAR(20) NOT NULL,
    stage VARCHAR(64) NOT NULL DEFAULT 'REGULAR_SEASON',
    matchday INT,
    round_key VARCHAR(64) NOT NULL DEFAULT 'MD-1',
    round_label VARCHAR(100),
    home_team VARCHAR(150) NOT NULL,
    home_crest TEXT,
    away_team VARCHAR(150) NOT NULL,
    away_crest TEXT,
    utc_date TIMESTAMPTZ NOT NULL,
    status VARCHAR(32) NOT NULL,
    home_score INT,
    away_score INT,
    home_ht INT,
    away_ht INT,
    home_lambda NUMERIC(4,2) NOT NULL DEFAULT 1.45,
    away_lambda NUMERIC(4,2) NOT NULL DEFAULT 1.15,
    markets_points JSONB,
    settled_outcomes JSONB,
    af_fixture_id BIGINT,
    odds_source VARCHAR(20),
    odds_updated_at TIMESTAMPTZ,
    points_calculated BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add columns used by the current server to older installations.
ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS stage VARCHAR(64) DEFAULT 'REGULAR_SEASON',
    ADD COLUMN IF NOT EXISTS matchday INT,
    ADD COLUMN IF NOT EXISTS round_key VARCHAR(64) DEFAULT 'MD-1',
    ADD COLUMN IF NOT EXISTS round_label VARCHAR(100),
    ADD COLUMN IF NOT EXISTS home_crest TEXT,
    ADD COLUMN IF NOT EXISTS away_crest TEXT,
    ADD COLUMN IF NOT EXISTS home_score INT,
    ADD COLUMN IF NOT EXISTS away_score INT,
    ADD COLUMN IF NOT EXISTS home_ht INT,
    ADD COLUMN IF NOT EXISTS away_ht INT,
    ADD COLUMN IF NOT EXISTS home_lambda NUMERIC(4,2),
    ADD COLUMN IF NOT EXISTS away_lambda NUMERIC(4,2),
    ADD COLUMN IF NOT EXISTS markets_points JSONB,
    ADD COLUMN IF NOT EXISTS settled_outcomes JSONB,
    ADD COLUMN IF NOT EXISTS af_fixture_id BIGINT,
    ADD COLUMN IF NOT EXISTS odds_source VARCHAR(20),
    ADD COLUMN IF NOT EXISTS odds_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS points_calculated BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Migrate values from names used by an older schema, when those columns exist.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'matches' AND column_name = 'ht_home_score') THEN
        EXECUTE 'UPDATE matches SET home_ht = COALESCE(home_ht, ht_home_score)';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'matches' AND column_name = 'ht_away_score') THEN
        EXECUTE 'UPDATE matches SET away_ht = COALESCE(away_ht, ht_away_score)';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'matches' AND column_name = 'home_goals_avg') THEN
        EXECUTE 'UPDATE matches SET home_lambda = COALESCE(home_goals_avg, home_lambda)';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'matches' AND column_name = 'away_goals_avg') THEN
        EXECUTE 'UPDATE matches SET away_lambda = COALESCE(away_goals_avg, away_lambda)';
    END IF;
END $$;

UPDATE matches SET round_key = 'MD-1' WHERE round_key IS NULL OR BTRIM(round_key) = '';
UPDATE matches
SET round_label = CASE
    WHEN matchday IS NOT NULL THEN 'Matchday ' || matchday::text
    ELSE INITCAP(REPLACE(COALESCE(NULLIF(round_key, ''), 'Round'), '_', ' '))
END
WHERE round_label IS NULL OR BTRIM(round_label) = '';
UPDATE matches SET home_lambda = 1.45 WHERE home_lambda IS NULL;
UPDATE matches SET away_lambda = 1.15 WHERE away_lambda IS NULL;
UPDATE matches SET points_calculated = FALSE WHERE points_calculated IS NULL;
UPDATE matches SET updated_at = NOW() WHERE updated_at IS NULL;

ALTER TABLE matches ALTER COLUMN round_key SET DEFAULT 'MD-1';
ALTER TABLE matches ALTER COLUMN round_key SET NOT NULL;
ALTER TABLE matches ALTER COLUMN home_lambda SET DEFAULT 1.45;
ALTER TABLE matches ALTER COLUMN home_lambda SET NOT NULL;
ALTER TABLE matches ALTER COLUMN away_lambda SET DEFAULT 1.15;
ALTER TABLE matches ALTER COLUMN away_lambda SET NOT NULL;
ALTER TABLE matches ALTER COLUMN points_calculated SET DEFAULT FALSE;
ALTER TABLE matches ALTER COLUMN points_calculated SET NOT NULL;
ALTER TABLE matches ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE matches ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE matches ALTER COLUMN matchday DROP NOT NULL;

CREATE TABLE IF NOT EXISTS predictions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    predicted_outcome VARCHAR(10) CHECK (predicted_outcome IN ('HOME', 'DRAW', 'AWAY')),
    predicted_home INT CHECK (predicted_home >= 0 AND predicted_home <= 7),
    predicted_away INT CHECK (predicted_away >= 0 AND predicted_away <= 7),
    is_boosted BOOLEAN NOT NULL DEFAULT FALSE,
    outcome_points_locked INT NOT NULL DEFAULT 12,
    exact_points_locked INT NOT NULL DEFAULT 35,
    extras_picks JSONB NOT NULL DEFAULT '[]'::jsonb,
    points_awarded INT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, match_id),
    CONSTRAINT chk_max_3_extras CHECK (jsonb_array_length(extras_picks) <= 3)
);

-- Ensure older predictions tables support score-only and extras-only entries.
ALTER TABLE predictions
    ADD COLUMN IF NOT EXISTS predicted_outcome VARCHAR(10),
    ADD COLUMN IF NOT EXISTS predicted_home INT,
    ADD COLUMN IF NOT EXISTS predicted_away INT,
    ADD COLUMN IF NOT EXISTS is_boosted BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS outcome_points_locked INT DEFAULT 12,
    ADD COLUMN IF NOT EXISTS exact_points_locked INT DEFAULT 35,
    ADD COLUMN IF NOT EXISTS extras_picks JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS points_awarded INT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE predictions ALTER COLUMN predicted_outcome DROP NOT NULL;
ALTER TABLE predictions ALTER COLUMN predicted_home DROP NOT NULL;
ALTER TABLE predictions ALTER COLUMN predicted_away DROP NOT NULL;
UPDATE predictions SET is_boosted = FALSE WHERE is_boosted IS NULL;
UPDATE predictions SET outcome_points_locked = 12 WHERE outcome_points_locked IS NULL;
UPDATE predictions SET exact_points_locked = 35 WHERE exact_points_locked IS NULL;
UPDATE predictions SET extras_picks = '[]'::jsonb WHERE extras_picks IS NULL;
UPDATE predictions SET updated_at = NOW() WHERE updated_at IS NULL;
ALTER TABLE predictions ALTER COLUMN is_boosted SET DEFAULT FALSE;
ALTER TABLE predictions ALTER COLUMN is_boosted SET NOT NULL;
ALTER TABLE predictions ALTER COLUMN outcome_points_locked SET DEFAULT 12;
ALTER TABLE predictions ALTER COLUMN outcome_points_locked SET NOT NULL;
ALTER TABLE predictions ALTER COLUMN exact_points_locked SET DEFAULT 35;
ALTER TABLE predictions ALTER COLUMN exact_points_locked SET NOT NULL;
ALTER TABLE predictions ALTER COLUMN extras_picks SET DEFAULT '[]'::jsonb;
ALTER TABLE predictions ALTER COLUMN extras_picks SET NOT NULL;
ALTER TABLE predictions ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE predictions ALTER COLUMN updated_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS user_round_boosts (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    competition_code VARCHAR(20) NOT NULL,
    round_key VARCHAR(64) NOT NULL,
    matchday INT,
    boosts_used INT NOT NULL DEFAULT 0 CHECK (boosts_used >= 0),
    PRIMARY KEY (user_id, competition_code, round_key)
);

-- Bring existing boost counters forward without discarding their values.
DO $$
BEGIN
    IF to_regclass('public.user_matchday_boosts') IS NOT NULL THEN
        EXECUTE $migrate$
            INSERT INTO user_round_boosts (user_id, competition_code, round_key, matchday, boosts_used)
            SELECT user_id, competition_code, round_key, matchday, boosts_used
            FROM user_matchday_boosts
            ON CONFLICT (user_id, competition_code, round_key)
            DO UPDATE SET boosts_used = GREATEST(user_round_boosts.boosts_used, EXCLUDED.boosts_used)
        $migrate$;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_leaderboard ON users (total_points DESC, exact_scores_count DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_matches_comp_round ON matches (competition_code, round_key, utc_date);
CREATE INDEX IF NOT EXISTS idx_matches_unsettled ON matches (status, points_calculated)
    WHERE status = 'FINISHED' AND points_calculated = FALSE;
CREATE INDEX IF NOT EXISTS idx_matches_af_fixture ON matches (af_fixture_id) WHERE af_fixture_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions (match_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_user_match_unique ON predictions (user_id, match_id);

COMMIT;
