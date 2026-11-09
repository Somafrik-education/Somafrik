-- NFC-ROLES-FINAL-01 — journal des appels : mode « staff » (appel de classe local-first effectué par
-- un responsable scolaire autorisé : Directeur, Secrétaire, Préfet, Proviseur, Principal).
-- Migration ADDITIVE et idempotente : les contraintes sont ÉLARGIES (aucune ligne existante ne
-- devient invalide), aucune donnée supprimée ni réécrite. « staff » : aucun enseignant attribué
-- (teacher_id NULL, jamais d'enseignant fictif) et aucune justification ; l'auteur réel reste
-- author_user_id / author_role_keys.
DO $staff_mode$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'attendance_roll_calls_mode_check' AND conrelid = 'attendance_roll_calls'::regclass
       AND pg_get_constraintdef(oid) LIKE '%staff%'
  ) THEN
    ALTER TABLE attendance_roll_calls DROP CONSTRAINT IF EXISTS attendance_roll_calls_mode_check;
    ALTER TABLE attendance_roll_calls ADD CONSTRAINT attendance_roll_calls_mode_check
      CHECK (mode IN ('teacher', 'direction', 'staff'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'attendance_roll_calls_mode_shape_check' AND conrelid = 'attendance_roll_calls'::regclass
       AND pg_get_constraintdef(oid) LIKE '%staff%'
  ) THEN
    ALTER TABLE attendance_roll_calls DROP CONSTRAINT IF EXISTS attendance_roll_calls_mode_shape_check;
    ALTER TABLE attendance_roll_calls ADD CONSTRAINT attendance_roll_calls_mode_shape_check CHECK (
      (mode = 'teacher' AND teacher_id IS NOT NULL AND justification IS NULL)
      OR (mode = 'direction' AND teacher_id IS NULL AND justification IS NOT NULL)
      OR (mode = 'staff' AND teacher_id IS NULL AND justification IS NULL)
    );
  END IF;
  -- Une ligne « staff » n'existe que par la synchronisation hors ligne (operation_id, empreinte, ACK).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'attendance_roll_calls_offline_shape_check' AND conrelid = 'attendance_roll_calls'::regclass
       AND pg_get_constraintdef(oid) LIKE '%staff%'
  ) THEN
    ALTER TABLE attendance_roll_calls DROP CONSTRAINT IF EXISTS attendance_roll_calls_offline_shape_check;
    ALTER TABLE attendance_roll_calls ADD CONSTRAINT attendance_roll_calls_offline_shape_check CHECK (
      (source = 'online' AND mode IN ('teacher', 'direction') AND operation_id IS NULL AND payload_digest IS NULL AND ack_body IS NULL)
      OR (source = 'offline' AND mode IN ('teacher', 'staff') AND operation_id IS NOT NULL
          AND payload_digest IS NOT NULL AND payload_digest ~ '^[0-9a-f]{64}$'
          AND ack_body IS NOT NULL AND jsonb_typeof(ack_body) = 'object')
    );
  END IF;
END
$staff_mode$;
