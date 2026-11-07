-- NFC-PRES-LOCAL-PR1c — journal des appels : synchronisation hors ligne et ACK durable.
-- Migration ADDITIVE et idempotente : aucune suppression, aucune réécriture des appels historiques.
-- Les lignes existantes (appels en ligne) reçoivent source = 'online' par défaut et restent valides.
-- L'unicité (school_id, session_id) existante est conservée : une session n'est jamais enregistrée deux fois.
ALTER TABLE attendance_roll_calls ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'online';
ALTER TABLE attendance_roll_calls ADD COLUMN IF NOT EXISTS operation_id UUID;
ALTER TABLE attendance_roll_calls ADD COLUMN IF NOT EXISTS payload_digest TEXT;
ALTER TABLE attendance_roll_calls ADD COLUMN IF NOT EXISTS ack_body JSONB;

DO $offline_sync$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'attendance_roll_calls_source_check' AND conrelid = 'attendance_roll_calls'::regclass
  ) THEN
    ALTER TABLE attendance_roll_calls ADD CONSTRAINT attendance_roll_calls_source_check
      CHECK (source IN ('online', 'offline'));
  END IF;
  -- Une ligne hors ligne porte toujours l'opération, l'empreinte du lot et l'ACK figé ;
  -- une ligne en ligne n'en porte aucun (pas de mélange des deux parcours).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'attendance_roll_calls_offline_shape_check' AND conrelid = 'attendance_roll_calls'::regclass
  ) THEN
    ALTER TABLE attendance_roll_calls ADD CONSTRAINT attendance_roll_calls_offline_shape_check CHECK (
      (source = 'online' AND operation_id IS NULL AND payload_digest IS NULL AND ack_body IS NULL)
      -- IS NOT NULL explicites : une expression NULL serait acceptée par un CHECK.
      OR (source = 'offline' AND mode = 'teacher' AND operation_id IS NOT NULL
          AND payload_digest IS NOT NULL AND payload_digest ~ '^[0-9a-f]{64}$'
          AND ack_body IS NOT NULL AND jsonb_typeof(ack_body) = 'object')
    );
  END IF;
END
$offline_sync$;
