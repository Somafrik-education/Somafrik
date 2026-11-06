-- NFC-P0-R3-B — PROTOTYPE D'ÉTUDE, PAS UNE MIGRATION (révision 2).
-- STATUT : R3-B en HOLD (décision CTO Q3 : index partiel non autorisé à ce stade).
-- Ce fichier sert uniquement à documenter les garanties qu'exigerait une future version.
-- Démontre, sur la base locale jetable du jeu d'essai (diagnostic-r3-fixtures.sql),
-- qu'une « libération » d'UID conserve l'historique et l'unicité de l'attribution
-- courante. Tout se termine par ROLLBACK. JAMAIS sur préproduction ou production.
\set ON_ERROR_STOP on
BEGIN;

-- 1. Colonnes additives : l'ancienne ligne garde son UID, sa date et son motif de libération.
ALTER TABLE student_access_cards ADD COLUMN nfc_uid_released_at TIMESTAMPTZ;
ALTER TABLE student_access_cards ADD COLUMN nfc_uid_release_reason TEXT
  CHECK (nfc_uid_release_reason IS NULL OR nfc_uid_release_reason IN ('expired_never_encoded', 'cancelled_never_encoded'));
-- Une ligne libérée est forcément révoquée, jamais encodée ni verrouillée, ET son motif
-- historique de révocation est lui-même non sensible, couplé au motif de libération
-- (revue CTO, correction 2) : une révocation de sécurité ('revoked'), une perte, un
-- remplacement ou 'nfc_abandoned' (ambigu) ne sont JAMAIS libérables, même par un SQL fautif.
-- 'nfc_cancelled' est le motif d'annulation non sensible prévu par R3-3.
ALTER TABLE student_access_cards ADD CONSTRAINT r3_release_check CHECK (
  nfc_uid_released_at IS NULL OR (
    nfc_uid IS NOT NULL AND status = 'revoked' AND nfc_encoded_at IS NULL AND nfc_locked_at IS NULL
    AND nfc_encoding_state = 'pending' AND nfc_replaces_card_id IS NULL
    AND ((revoke_reason = 'nfc_reservation_expired' AND nfc_uid_release_reason = 'expired_never_encoded')
      OR (revoke_reason = 'nfc_cancelled' AND nfc_uid_release_reason = 'cancelled_never_encoded'))));

-- Le motif d'une révocation est figé : on ne peut pas « requalifier » une révocation de
-- sécurité en expiration pour la rendre libérable. Seules sorties admises de 'revoked' :
-- les reprises R1/R2 d'une réservation expirée (motif effacé avec changement de statut).
-- Une ligne libérée est entièrement figée sur ses champs d'attribution.
CREATE FUNCTION r3_guard_revocation() RETURNS trigger LANGUAGE plpgsql AS $g$
BEGIN
  IF OLD.nfc_uid_released_at IS NOT NULL AND (
       NEW.nfc_uid_released_at IS DISTINCT FROM OLD.nfc_uid_released_at
    OR NEW.status IS DISTINCT FROM OLD.status OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason
    OR NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.nfc_uid IS DISTINCT FROM OLD.nfc_uid) THEN
    RAISE EXCEPTION 'R3: ligne libérée immuable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'revoked' AND NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason THEN
    IF NOT (OLD.revoke_reason = 'nfc_reservation_expired' AND NEW.revoke_reason IS NULL
            AND NEW.status IN ('issued', 'active')) THEN
      RAISE EXCEPTION 'R3: motif de révocation figé' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $g$;
CREATE TRIGGER r3_guard_revocation BEFORE UPDATE ON student_access_cards
  FOR EACH ROW EXECUTE FUNCTION r3_guard_revocation();

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

SAVEPOINT s4;
DO $$ BEGIN
  -- Révocation de SÉCURITÉ d'une réservation jamais encodée (carte 16) : révoquée, non encodée,
  -- non verrouillée — la v1 du prototype l'aurait acceptée. La contrainte v2 la refuse.
  UPDATE student_access_cards SET nfc_uid_released_at = clock_timestamp(), nfc_uid_release_reason = 'expired_never_encoded'
   WHERE nfc_uid = '04000000000016';
  RAISE EXCEPTION 'ÉCHEC : révocation de sécurité libérée';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'P7 OK : révocation de sécurité jamais encodée non libérable (motif vérifié par contrainte)';
END $$;
ROLLBACK TO SAVEPOINT s4;

SAVEPOINT s5;
DO $$ BEGIN
  -- Contournement : requalifier le motif 'revoked' en expiration puis libérer.
  UPDATE student_access_cards SET revoke_reason = 'nfc_reservation_expired' WHERE nfc_uid = '04000000000016';
  RAISE EXCEPTION 'ÉCHEC : motif de sécurité requalifié';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'P8 OK : motif de révocation figé (requalification refusée)';
END $$;
ROLLBACK TO SAVEPOINT s5;

SAVEPOINT s6;
DO $$ BEGIN
  -- 'nfc_abandoned' (ambigu, jamais envoyé par les clients) n'est pas libérable non plus.
  UPDATE student_access_cards SET nfc_uid_released_at = clock_timestamp(), nfc_uid_release_reason = 'cancelled_never_encoded'
   WHERE nfc_uid = '0400000000000C';
  RAISE EXCEPTION 'ÉCHEC : nfc_abandoned libéré';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'P9 OK : nfc_abandoned non libérable';
END $$;
ROLLBACK TO SAVEPOINT s6;

SAVEPOINT s7;
DO $$ DECLARE n int; BEGIN
  -- Non-régression : la reprise R2 (revoked/expired -> issued, motif effacé) reste possible.
  UPDATE student_access_cards SET status = 'issued', revoked_at = NULL, revoke_reason = NULL,
         nfc_reservation_expires_at = clock_timestamp() + interval '30 min'
   WHERE nfc_uid = '04000000000008' AND status = 'revoked' AND revoke_reason = 'nfc_reservation_expired';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'ÉCHEC : reprise R2 bloquée'; END IF;
  RAISE NOTICE 'P10 OK : reprise R2 toujours admise par le garde';
END $$;
ROLLBACK TO SAVEPOINT s7;

SAVEPOINT s8;
DO $$ BEGIN
  -- La ligne libérée en P1 est figée (pas de « dé-libération » ni de changement de titulaire).
  UPDATE student_access_cards SET nfc_uid_released_at = NULL, nfc_uid_release_reason = NULL
   WHERE nfc_uid = '04000000000009' AND nfc_uid_released_at IS NOT NULL;
  RAISE EXCEPTION 'ÉCHEC : ligne libérée modifiée';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'P11 OK : ligne libérée immuable';
END $$;
ROLLBACK TO SAVEPOINT s8;

ROLLBACK;
