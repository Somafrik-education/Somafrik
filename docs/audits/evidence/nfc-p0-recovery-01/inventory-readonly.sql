-- NFC-P0-RECOVERY-01 — requêtes de diagnostic STRICTEMENT EN LECTURE.
-- À exécuter uniquement par une personne habilitée, sur autorisation CTO,
-- dans une transaction READ ONLY. Aucune donnée nominative n'est sélectionnée.
-- Les résultats contiennent des UID : ne pas les publier dans Git ni dans un ticket public.
BEGIN TRANSACTION READ ONLY;

-- Q1. Fiche d'une carte rejetée, à partir de l'UID lu physiquement (normalisé : 04 + 12 hex, majuscules).
SELECT id, school_id, student_id IS NOT NULL AS has_student, medium, status, revoke_reason,
       nfc_tag_type, nfc_encoding_state, issued_at, nfc_reservation_expires_at,
       nfc_reservation_expires_at <= clock_timestamp() AS reservation_past,
       nfc_encoded_at, nfc_locked_at, revoked_at, nfc_replaces_card_id,
       cardinality(nfc_retry_operation_ids) AS retries
  FROM student_access_cards
 WHERE nfc_uid = :'uid';

-- Q2. Répartition des UID par état : combien de cartes physiques sont « réservées pour toujours ».
SELECT status, coalesce(revoke_reason, '-') AS reason, nfc_encoding_state, count(*)
  FROM student_access_cards
 WHERE nfc_uid IS NOT NULL
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3;

-- Q3. Réservations dont l'expiration est passée mais pas encore appliquée (expiration paresseuse).
SELECT school_id, count(*) AS stale_pending
  FROM student_access_cards
 WHERE status = 'issued' AND nfc_encoding_state = 'pending'
   AND nfc_reservation_expires_at <= clock_timestamp()
 GROUP BY 1;

-- Q4. Élèves avec plus d'une carte active (invariant attendu : 0 ligne).
SELECT school_id, student_id, count(*)
  FROM student_access_cards WHERE status = 'active'
 GROUP BY 1, 2 HAVING count(*) > 1;

-- Q5. Cartes NFC orphelines (élève absent) — attendu : 0 ligne.
SELECT c.id, c.school_id, c.status
  FROM student_access_cards c
  LEFT JOIN students s ON s.id = c.student_id
 WHERE c.nfc_uid IS NOT NULL AND s.id IS NULL;

-- Q6. Cartes déclarées « locked » (observation client) : à rapprocher d'un verrouillage physique éventuel.
SELECT school_id, status, count(*) FROM student_access_cards
 WHERE nfc_encoding_state = 'locked' GROUP BY 1, 2;

-- Q7. Historique d'audit d'une carte (sans valeurs sensibles).
SELECT created_at, action, old_value, new_value
  FROM audit_logs
 WHERE entity_type = 'student_access_card' AND entity_id = :'card_id'
 ORDER BY created_at;

ROLLBACK;
