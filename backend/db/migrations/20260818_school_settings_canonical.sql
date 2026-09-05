-- LOT 4 — Paramètres établissement canoniques (idempotent, sans COPY JSON).
CREATE TABLE IF NOT EXISTS school_settings (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  period_mode TEXT NOT NULL DEFAULT 'trimestre',
  default_scale NUMERIC(6,2) NOT NULL DEFAULT 20,
  report_card_mode TEXT NOT NULL DEFAULT 'period',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_settings_period_mode_check CHECK (period_mode IN ('trimestre', 'semestre', 'periode')),
  CONSTRAINT school_settings_report_card_mode_check CHECK (report_card_mode IN ('period', 'annual', 'custom')),
  CONSTRAINT school_settings_default_scale_check CHECK (default_scale > 0 AND default_scale <= 100)
);

CREATE OR REPLACE FUNCTION ensure_school_settings_for_school()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO school_settings (school_id)
  VALUES (NEW.id)
  ON CONFLICT (school_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schools_ensure_school_settings ON schools;
CREATE TRIGGER trg_schools_ensure_school_settings
AFTER INSERT ON schools
FOR EACH ROW
EXECUTE FUNCTION ensure_school_settings_for_school();

INSERT INTO school_settings (school_id)
SELECT id FROM schools
ON CONFLICT (school_id) DO NOTHING;
