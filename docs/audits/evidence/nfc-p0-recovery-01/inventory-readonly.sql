-- NFC-P0-RECOVERY-01 — requêtes de diagnostic STRICTEMENT EN LECTURE (révision 2).
-- À exécuter uniquement par une personne habilitée, sur autorisation CTO,
-- dans une transaction READ ONLY (la transaction se termine par ROLLBACK).
--
-- Règles de minimisation (revue CTO) :
--   * jamais token_hash, cardToken, NDEF, secret, nfc_operation_id ni identifiant d'opération ;
--   * jamais nom, code élève, téléphone, e-mail, IP, user-agent, identifiant d'utilisateur ;
--   * les identifiants internes (UUID de carte, d'établissement) ne servent qu'à relier les requêtes ;
--   * l'UID n'apparaît qu'en paramètre d'entrée de Q1 et Q8, jamais en sortie ;
--   * les journaux d'audit sont lus en LISTE BLANCHE de clés (Q7) : old_value/new_value
--     contiennent studentId, schoolId, actorUserId, operationId, replacesCardId,
--     replacedByCardId, cardId — aucune de ces clés n'est restituée.
-- Les résultats restent dans le registre restreint hors Git.
BEGIN TRANSACTION READ ONLY;

-- Q1. Fiche d'une carte rejetée à partir de l'UID lu physiquement
--     (normalisé : 04 + 12 hexadécimaux, majuscules).
SELECT c.id AS card_id, c.school_id, c.medium, c.status, c.revoke_reason,
       c.nfc_tag_type, c.nfc_encoding_state,
       c.issued_at, c.nfc_reservation_expires_at,
       c.nfc_reservation_expires_at <= clock_timestamp() AS reservation_past,
       c.nfc_encoded_at, c.nfc_locked_at, c.revoked_at,
       c.nfc_replaces_card_id IS NOT NULL AS is_replacement,
       cardinality(c.nfc_retry_operation_ids) AS secret_rotations
  FROM student_access_cards c
 WHERE c.nfc_uid = :'uid';

-- Q2. Répartition des UID par état : combien de cartes physiques sont bloquées.
SELECT status, coalesce(revoke_reason, '-') AS reason, nfc_encoding_state,
       (nfc_encoded_at IS NOT NULL) AS ever_encoded, count(*) AS cards
  FROM student_access_cards
 WHERE nfc_uid IS NOT NULL
 GROUP BY 1, 2, 3, 4
 ORDER BY 1, 2, 3, 4;

-- Q3. Réservations dont l'expiration est passée mais pas encore appliquée (expiration paresseuse).
SELECT school_id, count(*) AS stale_pending
  FROM student_access_cards
 WHERE status = 'issued' AND nfc_encoding_state = 'pending'
   AND nfc_reservation_expires_at <= clock_timestamp()
 GROUP BY 1;

-- Q4. Invariant « au plus une carte active par élève » — attendu : 0.
--     Seul un compteur par établissement est restitué (aucun identifiant d'élève).
SELECT school_id, count(*) AS students_with_several_active_cards
  FROM (SELECT school_id, student_id FROM student_access_cards
         WHERE status = 'active' GROUP BY 1, 2 HAVING count(*) > 1) d
 GROUP BY 1;

-- Q5. Cartes NFC orphelines (élève absent ou d'un autre établissement) — attendu : 0.
SELECT c.school_id, c.status, count(*) AS orphan_cards
  FROM student_access_cards c
  LEFT JOIN students s ON s.id = c.student_id AND s.school_id = c.school_id
 WHERE c.nfc_uid IS NOT NULL AND s.id IS NULL
 GROUP BY 1, 2;

-- Q6. Cartes déclarées « locked » (observation client) : à rapprocher d'un verrouillage physique.
SELECT school_id, status, count(*) AS cards
  FROM student_access_cards
 WHERE nfc_encoding_state = 'locked'
 GROUP BY 1, 2;

-- Q7. Historique d'audit d'une carte — LISTE BLANCHE de clés non sensibles.
--     Pas de user_id, ip_address, user_agent ni de JSON brut.
SELECT a.created_at,
       a.action,
       a.old_value ->> 'status' AS old_status,
       a.old_value ->> 'state'  AS old_state,
       a.new_value ->> 'status' AS new_status,
       a.new_value ->> 'state'  AS new_state,
       a.new_value ->> 'reason' AS reason,
       a.new_value ->> 'tagType' AS tag_type,
       a.new_value ->> 'medium' AS medium,
       (a.new_value ? 'replacesCardId' AND a.new_value ->> 'replacesCardId' IS NOT NULL) AS is_replacement
  FROM audit_logs a
 WHERE a.entity_type = 'student_access_card' AND a.entity_id = :'card_id'
 ORDER BY a.created_at;

-- Q8. Éligibilité à une REPRISE de réservation expirée (procédure §R du protocole).
--     Vérifie, sans rien modifier : titulaire toujours inscrit dans le même établissement,
--     carte jamais encodée, motif d'expiration, absence de carte active ou de réservation vivante.
SELECT c.id AS card_id,
       c.status = 'revoked' AND c.revoke_reason = 'nfc_reservation_expired' AS expired_reservation,
       c.nfc_encoded_at IS NULL AS never_encoded,
       c.nfc_replaces_card_id IS NULL AS not_a_replacement,
       s.id IS NOT NULL AS holder_in_same_school,
       coalesce(s.status, '-') AS holder_status,
       NOT EXISTS (SELECT 1 FROM student_access_cards a
                    WHERE a.school_id = c.school_id AND a.student_id = c.student_id
                      AND a.status = 'active') AS no_active_card,
       NOT EXISTS (SELECT 1 FROM student_access_cards p
                    WHERE p.school_id = c.school_id AND p.student_id = c.student_id
                      AND p.status = 'issued' AND p.nfc_encoding_state = 'pending'
                      AND p.nfc_reservation_expires_at > clock_timestamp()) AS no_live_reservation
  FROM student_access_cards c
  LEFT JOIN students s ON s.id = c.student_id AND s.school_id = c.school_id
 WHERE c.nfc_uid = :'uid';

ROLLBACK;
