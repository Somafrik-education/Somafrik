-- NFC-P0-R3 — diagnostic des cartes NFC vierges à propriétaire inconnu (révision 2).
-- STRICTEMENT EN LECTURE : transaction READ ONLY terminée par ROLLBACK.
-- À exécuter uniquement par la personne habilitée, sur autorisation CTO (Q5).
--
-- Paramètres (psql) :
--   :'school_id' UUID de l'établissement qui présente les cartes ;
--   :'uids'      UID lus physiquement, dans l'ordre des cartes, séparés par des virgules
--                (normalisés : 04 + 12 hexadécimaux, majuscules).
--
-- Cloisonnement (revue CTO, correction 1) — deux étapes séparées :
--   ÉTAPE 1 « global_lookup » : seule lecture qui traverse les établissements. Elle ne lit
--            QUE deux colonnes : nfc_uid (clé de recherche) et le booléen school_id = :'school_id'.
--            Ni statut, ni dates, ni titulaire, ni identifiant de carte.
--   ÉTAPE 2 « school_cards » / « school_holders » : détails, avec liste explicite de colonnes
--            (aucun c.*), filtrés sur school_id = :'school_id' DANS la lecture de la table.
--            Une ligne d'un autre établissement n'y entre jamais ; les sous-requêtes sur le
--            titulaire sont elles aussi bornées à :'school_id'.
-- Minimisation : UID masqué en sortie ; jamais token_hash, NDEF, secret, nfc_operation_id,
-- identité ni code élève.
BEGIN TRANSACTION READ ONLY;

WITH input AS (
  SELECT ord, upper(trim(uid)) AS uid
    FROM unnest(string_to_array(:'uids', ',')) WITH ORDINALITY AS t(uid, ord)
),
-- ÉTAPE 1 — recherche globale minimale (unicité UID globale) : existe / même établissement.
global_lookup AS (
  SELECT g.nfc_uid AS uid, (g.school_id = :'school_id'::uuid) AS same_school
    FROM student_access_cards g
   WHERE g.nfc_uid IN (SELECT uid FROM input)
),
-- ÉTAPE 2 — détails autorisés, établissement présentateur uniquement.
school_cards AS (
  SELECT c.id, c.student_id, c.nfc_uid AS uid, c.status, c.revoke_reason, c.nfc_tag_type,
         c.nfc_encoding_state, c.nfc_encoded_at, c.nfc_locked_at, c.nfc_replaces_card_id,
         c.nfc_recovery_count, c.nfc_retry_operation_ids, c.issued_at, c.revoked_at,
         (c.nfc_reservation_expires_at <= clock_timestamp()) AS deadline_past
    FROM student_access_cards c
   WHERE c.school_id = :'school_id'::uuid
     AND c.nfc_uid IN (SELECT uid FROM input)
),
school_holders AS (
  SELECT sc.id AS card_id,
         s.status AS holder_status,
         EXISTS (SELECT 1 FROM student_access_cards a
                  WHERE a.school_id = :'school_id'::uuid AND a.student_id = sc.student_id
                    AND a.status = 'active' AND a.id <> sc.id) AS holder_has_other_active,
         EXISTS (SELECT 1 FROM student_access_cards p
                  WHERE p.school_id = :'school_id'::uuid AND p.student_id = sc.student_id
                    AND p.id <> sc.id AND p.status = 'issued' AND p.nfc_encoding_state = 'pending'
                    AND p.nfc_reservation_expires_at > clock_timestamp()) AS holder_has_live_reservation
    FROM school_cards sc
    LEFT JOIN students s ON s.school_id = :'school_id'::uuid AND s.id = sc.student_id
),
classified AS (
  SELECT i.ord, i.uid, gl.same_school, h.holder_status,
         sc.id, sc.status, sc.revoke_reason, sc.nfc_tag_type, sc.nfc_encoding_state,
         sc.nfc_encoded_at, sc.nfc_replaces_card_id, sc.nfc_recovery_count,
         sc.nfc_retry_operation_ids, sc.issued_at, sc.revoked_at,
    CASE
      WHEN gl.uid IS NULL THEN 'UID_UNKNOWN'
      WHEN NOT gl.same_school THEN 'OTHER_SCHOOL'
      WHEN sc.nfc_encoding_state = 'locked' OR sc.nfc_locked_at IS NOT NULL THEN 'LOCKED_RECORDED'
      WHEN sc.status = 'active' THEN 'ACTIVE'
      WHEN sc.status = 'lost' THEN 'LOST'
      WHEN sc.status = 'replaced' THEN 'REPLACED'
      WHEN sc.status = 'issued' AND sc.nfc_encoding_state = 'pending' AND NOT sc.deadline_past THEN 'LIVE_RESERVATION'
      WHEN sc.status = 'issued' AND sc.nfc_encoding_state = 'pending' AND sc.deadline_past THEN 'EXPIRED_NOT_MATERIALISED'
      WHEN sc.status = 'revoked' AND sc.revoke_reason = 'nfc_reservation_expired' AND sc.nfc_encoded_at IS NULL THEN
        CASE
          WHEN sc.nfc_replaces_card_id IS NOT NULL THEN 'EXPIRED_REPLACEMENT'
          WHEN coalesce(h.holder_status, '-') <> 'active' THEN 'EXPIRED_HOLDER_INACTIVE'
          WHEN h.holder_has_other_active OR h.holder_has_live_reservation THEN 'EXPIRED_HOLDER_HAS_CARD'
          ELSE 'R2_ELIGIBLE'
        END
      WHEN sc.status = 'revoked' AND sc.nfc_encoded_at IS NULL THEN 'REVOKED_NEVER_ENCODED'
      WHEN sc.status = 'revoked' THEN 'REVOKED_SECURITY'
      ELSE 'UNCLASSIFIED'
    END AS r3_code
    FROM input i
    LEFT JOIN global_lookup gl ON gl.uid = i.uid
    LEFT JOIN school_cards sc ON sc.uid = i.uid
    LEFT JOIN school_holders h ON h.card_id = sc.id
)
SELECT ord AS carte,
       left(uid, 2) || '••••••••' || right(uid, 4) AS uid_masque,
       same_school,
       r3_code,
       id AS card_id,                         -- NULL hors établissement (étape 2 vide)
       status, revoke_reason, nfc_tag_type AS tag_type, nfc_encoding_state AS encoding_state,
       holder_status,
       nfc_encoded_at IS NOT NULL AS ever_encoded,
       nfc_replaces_card_id IS NOT NULL AS is_replacement,
       nfc_recovery_count AS recovery_count,
       cardinality(nfc_retry_operation_ids) AS secret_rotations,
       date_trunc('day', issued_at) AS issued_day,
       date_trunc('day', revoked_at) AS revoked_day
  FROM classified
 ORDER BY ord;

ROLLBACK;
