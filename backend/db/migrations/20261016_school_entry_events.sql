-- CARTE-PR3-A1 — passages au portail de l'établissement.
-- Table séparée de `attendance` : un passage au portail n'est jamais une présence en classe.
-- Aucune donnée de carte sensible (ni jeton, ni hash, ni UID NFC) : seulement l'identifiant de carte.
CREATE TABLE IF NOT EXISTS school_entry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL,
  card_id UUID NOT NULL,
  class_id UUID REFERENCES classes(id),
  academic_year_id UUID REFERENCES academic_years(id),
  event_type TEXT NOT NULL DEFAULT 'entry',
  local_date DATE NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  medium TEXT NOT NULL,
  recorded_by UUID NOT NULL REFERENCES users(id),
  recorded_by_role_keys TEXT[] NOT NULL,
  operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_entry_events_event_type_check CHECK (event_type IN ('entry')),
  CONSTRAINT school_entry_events_medium_check CHECK (medium IN ('nfc', 'qr')),
  CONSTRAINT school_entry_events_role_keys_check CHECK (cardinality(recorded_by_role_keys) > 0),
  CONSTRAINT school_entry_events_operation_unique UNIQUE (school_id, operation_id),
  -- Isolation tenant : l'élève appartient à l'établissement, la carte à cet élève.
  CONSTRAINT school_entry_events_student_tenant_fk
    FOREIGN KEY (school_id, student_id) REFERENCES students (school_id, id),
  CONSTRAINT school_entry_events_card_student_fk
    FOREIGN KEY (school_id, student_id, card_id) REFERENCES student_access_cards (school_id, student_id, id)
);

-- Une seule entrée par élève, par jour local et par établissement : un doublon NFC/QR ne crée
-- jamais un second événement.
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_entry_events_daily_entry
  ON school_entry_events (school_id, student_id, local_date)
  WHERE event_type = 'entry';

CREATE INDEX IF NOT EXISTS idx_school_entry_events_school_date_class
  ON school_entry_events (school_id, local_date, class_id);
