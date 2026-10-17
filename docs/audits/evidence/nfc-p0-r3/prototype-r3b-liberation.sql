-- NFC-P0-R3-B — PROTOTYPE D'ÉTUDE, PAS UNE MIGRATION.
-- Démontre, sur la base locale jetable du jeu d'essai (diagnostic-r3-fixtures.sql),
-- qu'une « libération » d'UID conserve l'historique et l'unicité de l'attribution
-- courante. Tout se termine par ROLLBACK. JAMAIS sur préproduction ou production.
\set ON_ERROR_STOP on
BEGIN;

-- 1. Colonnes additives : l'ancienne ligne garde son UID, sa date et son motif de libération.
ALTER TABLE student_access_cards ADD COLUMN nfc_uid_released_at TIMESTAMPTZ;
ALTER TABLE student_access_cards ADD COLUMN nfc_uid_release_reason TEXT
  CHECK (nfc_uid_release_reason IS NULL OR nfc_uid_release_reason IN ('expired_never_encoded', 'cancelled_never_encoded'));
-- Une ligne libérée est forcément révoquée, jamais encodée ni verrouillée.
ALTER TABLE student_access_cards ADD CONSTRAINT r3_release_check CHECK (
  nfc_uid_released_at IS NULL OR (
    nfc_uid IS NOT NULL AND status = 'revoked' AND nfc_encoded_at IS NULL AND nfc_locked_at IS NULL
    AND nfc_encoding_state = 'pending' AND nfc_uid_release_reason IS NOT NULL));

-- 2. Unicité de l'attribution COURANTE : même UID interdit tant qu'une ligne n'est pas libérée.
--    (En production : CREATE UNIQUE INDEX CONCURRENTLY du nouvel index AVANT de retirer l'ancien.)
CREATE UNIQUE INDEX r3_nfc_uid_current_unique ON student_access_cards(nfc_uid)
  WHERE nfc_uid IS NOT NULL AND nfc_uid_released_at IS NULL;
DROP INDEX student_access_cards_nfc_uid_unique;

-- 3. Libération conditionnelle (une seule requête, gardes dans le WHERE) de la carte 9
--    (EXPIRED_HOLDER_INACTIVE) puis nouvelle réservation pour un autre élève (s01).
UPDATE student_access_cards SET nfc_uid_released_at = clock_timestamp(),
       nfc_uid_release_reason = 'expired_never_encoded'
 WHERE nfc_uid = '04000000000009' AND school_id = '00000000-0000-4000-8000-00000000000a'
   AND status = 'revoked' AND revoke_reason = 'nfc_reservation_expired'
   AND nfc_encoded_at IS NULL AND nfc_locked_at IS NULL AND nfc_uid_released_at IS NULL
RETURNING 'P1 libération' AS etape, id;

INSERT INTO student_access_cards (school_id, student_id, medium, status, public_id, token_hash, nfc_uid,
  nfc_tag_type, nfc_encoding_state, nfc_operation_id, nfc_reservation_expires_at)
VALUES ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000101', 'nfc', 'issued',
  'pub-r3-new-09', encode(sha256(convert_to('r3-new-09', 'UTF8')), 'hex'), '04000000000009', 'NTAG216',
  'pending', gen_random_uuid(), now() + interval '30 min')
RETURNING 'P2 nouvelle attribution' AS etape, id;

-- 4. Historique conservé : deux lignes portent l'UID, une seule est courante.
SELECT 'P3 historique' AS etape, status, revoke_reason, nfc_uid_released_at IS NOT NULL AS released,
       student_id = '00000000-0000-4000-8000-000000000109' AS ancien_titulaire
  FROM student_access_cards WHERE nfc_uid = '04000000000009' ORDER BY created_at;

-- 5. Refus attendus (chacun dans un SAVEPOINT pour continuer la démonstration).
SAVEPOINT s1;
DO $$ BEGIN
  INSERT INTO student_access_cards (school_id, student_id, medium, status, public_id, token_hash, nfc_uid,
    nfc_tag_type, nfc_encoding_state, nfc_operation_id, nfc_reservation_expires_at)
  VALUES ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000102', 'nfc', 'issued',
    'pub-r3-dup-09', encode(sha256(convert_to('r3-dup-09', 'UTF8')), 'hex'), '04000000000009', 'NTAG216',
    'pending', gen_random_uuid(), now() + interval '30 min');
  RAISE EXCEPTION 'ÉCHEC : deuxième attribution courante acceptée';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'P4 OK : deuxième attribution courante refusée (index partiel)';
END $$;
ROLLBACK TO SAVEPOINT s1;

SAVEPOINT s2;
DO $$ DECLARE n int; BEGIN
  -- Une carte de sécurité (encodée puis révoquée), perdue, remplacée, active ou verrouillée ne se libère pas.
  UPDATE student_access_cards SET nfc_uid_released_at = clock_timestamp(), nfc_uid_release_reason = 'expired_never_encoded'
   WHERE nfc_uid IN ('0400000000000D', '04000000000004', '04000000000005', '04000000000003', '0400000000000E')
     AND status = 'revoked' AND revoke_reason = 'nfc_reservation_expired'
     AND nfc_encoded_at IS NULL AND nfc_locked_at IS NULL AND nfc_uid_released_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ÉCHEC : % carte(s) non récupérable(s) libérée(s)', n; END IF;
  RAISE NOTICE 'P5 OK : cartes sécurité/perdue/remplacée/active/verrouillée non libérables par la requête gardée';
END $$;
ROLLBACK TO SAVEPOINT s2;

SAVEPOINT s3;
DO $$ BEGIN
  -- Même en contournant les gardes applicatives, la contrainte refuse de libérer une carte encodée.
  UPDATE student_access_cards SET nfc_uid_released_at = clock_timestamp(), nfc_uid_release_reason = 'expired_never_encoded'
   WHERE nfc_uid = '0400000000000D';
  RAISE EXCEPTION 'ÉCHEC : carte encodée libérée';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'P6 OK : contrainte r3_release_check refuse une carte encodée';
END $$;
ROLLBACK TO SAVEPOINT s3;

ROLLBACK;
