-- KickPredict: Purge legacy Tunisian matches (FotMob / obsolete IDs) from PostgreSQL
BEGIN;

DELETE FROM matches
WHERE competition_code IN ('TUN', 'TU1', '984')
   OR competition_code ILIKE '%TUN%';

DELETE FROM user_round_boosts
WHERE competition_code IN ('TUN', 'TU1', '984')
   OR competition_code ILIKE '%TUN%';

COMMIT;
