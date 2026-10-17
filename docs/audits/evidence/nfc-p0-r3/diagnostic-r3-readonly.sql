-- NFC-P0-R3 — diagnostic des cartes NFC vierges à propriétaire inconnu.
-- STRICTEMENT EN LECTURE : transaction READ ONLY terminée par ROLLBACK.
-- À exécuter uniquement par une personne habilitée, sur autorisation CTO.
--
-- Paramètres (psql) :
--   :'school_id' UUID de l'établissement qui présente les cartes ;
--   :'uids'      liste des UID lus physiquement, dans l'ordre des cartes,
--                séparés par des virgules (normalisés : 04 + 12 hexadécimaux, majuscules).
--   Exemple : psql -v school_id=... -v uids='04A1B2C3D4E5F6,04...' -f diagnostic-r3-readonly.sql
--
-- Minimisation (mêmes règles que NFC-P0-RECOVERY-01 rév. 2) :
--   * l'UID n'apparaît en sortie que masqué (04 + 8 points + 4 derniers caractères) ;
--   * jamais token_hash, NDEF, secret, nfc_operation_id, identité ni code élève ;
--   * pour une carte d'un AUTRE établissement, seul le booléen same_school=false et le
--     code OTHER_SCHOOL sortent : aucun statut, aucune date, aucun identifiant.
--   * card_id n'est restitué que pour l'établissement présentateur (lien avec Q7 de RECOVERY-01).
BEGIN TRANSACTION READ ONLY;

WITH input AS (
  SELECT ord, upper(trim(uid)) AS uid
    FROM unnest(string_to_array(:'uids', ',')) WITH ORDINALITY AS t(uid, ord)
), rows AS (
  SELECT i.ord, i.uid, c.*,
         (c.id IS NOT NULL) AS known,
         (c.school_id = :'school_id'::uuid) AS same_school,
         s.status AS holder_status,
         EXISTS (SELECT 1 FROM student_access_cards a
                  WHERE a.school_id = c.school_id AND a.student_id = c.student_id
                    AND a.status = 'active' AND a.id <> c.id) AS holder_has_other_active,
         EXISTS (SELECT 1 FROM student_access_cards p
                  WHERE p.school_id = c.school_id AND p.student_id = c.student_id AND p.id <> c.id
                    AND p.status = 'issued' AND p.nfc_encoding_state = 'pending'
                    AND p.nfc_reservation_expires_at > clock_timestamp()) AS holder_has_live_reservation,
         (c.nfc_reservation_expires_at <= clock_timestamp()) AS deadline_past
    FROM input i
    LEFT JOIN student_access_cards c ON c.nfc_uid = i.uid
    LEFT JOIN students s ON s.id = c.student_id AND s.school_id = c.school_id
), classified AS (
  SELECT r.*,
    CASE
      WHEN NOT r.known THEN 'UID_UNKNOWN'
      WHEN NOT r.same_school THEN 'OTHER_SCHOOL'
      WHEN r.nfc_encoding_state = 'locked' OR r.nfc_locked_at IS NOT NULL THEN 'LOCKED_RECORDED'
      WHEN r.status = 'active' THEN 'ACTIVE'
      WHEN r.status = 'lost' THEN 'LOST'
      WHEN r.status = 'replaced' THEN 'REPLACED'
      WHEN r.status = 'issued' AND r.nfc_encoding_state = 'pending' AND NOT r.deadline_past THEN 'LIVE_RESERVATION'
      WHEN r.status = 'issued' AND r.nfc_encoding_state = 'pending' AND r.deadline_past THEN 'EXPIRED_NOT_MATERIALISED'
      WHEN r.status = 'revoked' AND r.revoke_reason = 'nfc_reservation_expired' AND r.nfc_encoded_at IS NULL THEN
        CASE
          WHEN r.nfc_replaces_card_id IS NOT NULL THEN 'EXPIRED_REPLACEMENT'
          WHEN coalesce(r.holder_status, '-') <> 'active' THEN 'EXPIRED_HOLDER_INACTIVE'
          WHEN r.holder_has_other_active OR r.holder_has_live_reservation THEN 'EXPIRED_HOLDER_HAS_CARD'
          ELSE 'R2_ELIGIBLE'
        END
      WHEN r.status = 'revoked' AND r.nfc_encoded_at IS NULL THEN 'REVOKED_NEVER_ENCODED'
      WHEN r.status = 'revoked' THEN 'REVOKED_SECURITY'
      ELSE 'UNCLASSIFIED'
    END AS r3_code
  FROM rows r
)
SELECT ord AS carte,
       left(uid, 2) || '••••••••' || right(uid, 4) AS uid_masque,
       CASE WHEN known THEN same_school END AS same_school,
       r3_code,
       -- Les colonnes suivantes ne sortent que pour l'établissement présentateur.
       CASE WHEN same_school THEN id END AS card_id,
       CASE WHEN same_school THEN status END AS status,
       CASE WHEN same_school THEN revoke_reason END AS revoke_reason,
       CASE WHEN same_school THEN nfc_tag_type END AS tag_type,
       CASE WHEN same_school THEN nfc_encoding_state END AS encoding_state,
       CASE WHEN same_school THEN nfc_encoded_at IS NOT NULL END AS ever_encoded,
       CASE WHEN same_school THEN nfc_replaces_card_id IS NOT NULL END AS is_replacement,
       CASE WHEN same_school THEN holder_status END AS holder_status,
       CASE WHEN same_school THEN nfc_recovery_count END AS recovery_count,
       CASE WHEN same_school THEN cardinality(nfc_retry_operation_ids) END AS secret_rotations,
       CASE WHEN same_school THEN date_trunc('day', issued_at) END AS issued_day,
       CASE WHEN same_school THEN date_trunc('day', revoked_at) END AS revoked_day
  FROM classified
 ORDER BY ord;

ROLLBACK;
