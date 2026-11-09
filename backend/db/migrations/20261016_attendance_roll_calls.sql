-- CARTE-PR3-B — journal des appels en classe validés.
-- Une ligne par session d'appel validée (sessionId = Idempotency-Key) : auteur réel, rôles relus
-- en base, mode, enseignant attribué, justification (direction) et bilan des écritures.
-- La double validation d'une même session est refusée par la contrainte d'unicité.
-- Aucune donnée d'élève, aucun jeton : uniquement des compteurs.
CREATE TABLE IF NOT EXISTS attendance_roll_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  roll_call_date DATE NOT NULL,
  session_id UUID NOT NULL,
  mode TEXT NOT NULL,
  author_user_id UUID NOT NULL REFERENCES users(id),
  author_role_keys TEXT[] NOT NULL,
  teacher_id UUID REFERENCES teachers(id),
  justification TEXT,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  manual_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  corrected_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  protected_count INTEGER NOT NULL DEFAULT 0,
  validated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT attendance_roll_calls_session_unique UNIQUE (school_id, session_id),
  CONSTRAINT attendance_roll_calls_mode_check CHECK (mode IN ('teacher', 'direction')),
  CONSTRAINT attendance_roll_calls_role_keys_check CHECK (cardinality(author_role_keys) > 0),
  -- Enseignant : présence attribuée à l'enseignant affecté, sans justification.
  -- Direction : aucune attribution à un enseignant, justification obligatoire.
  CONSTRAINT attendance_roll_calls_mode_shape_check CHECK (
    (mode = 'teacher' AND teacher_id IS NOT NULL AND justification IS NULL)
    OR (mode = 'direction' AND teacher_id IS NULL AND justification IS NOT NULL)
  ),
  CONSTRAINT attendance_roll_calls_counts_check CHECK (
    scanned_count >= 0 AND manual_count >= 0 AND created_count >= 0
    AND corrected_count >= 0 AND unchanged_count >= 0 AND protected_count >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_attendance_roll_calls_class_date
  ON attendance_roll_calls (school_id, class_id, roll_call_date);
