"use strict";

/**
 * LOT 5 — Examens, bulletins, templates et documents établissement canoniques.
 *
 * exams / exam_results = SoT examens (pas de 3e table).
 * report_cards = publication (pas de copie des notes).
 * report_card_templates = layout de rendu uniquement.
 * school_documents = métadonnées documents établissement (pas de binaire).
 */

const DOCUMENTS_EXAMS_SCHEMA_SQL = `
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id),
  ADD COLUMN IF NOT EXISTS evaluation_type_id UUID REFERENCES evaluation_types(id),
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

UPDATE exams SET status = 'completed' WHERE status = 'published';
UPDATE exams SET status = 'scheduled' WHERE status NOT IN ('draft', 'scheduled', 'validated', 'completed', 'cancelled', 'archived');

UPDATE exams e
SET academic_year_id = t.academic_year_id
FROM terms t
WHERE e.term_id = t.id AND e.academic_year_id IS NULL;

DO $$ BEGIN
  ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_status_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE exams
    ADD CONSTRAINT exams_status_check
    CHECK (status IN ('draft', 'scheduled', 'validated', 'completed', 'cancelled', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_exams_school_date ON exams (school_id, exam_date DESC);
CREATE INDEX IF NOT EXISTS idx_exams_school_class ON exams (school_id, class_id);

CREATE TABLE IF NOT EXISTS report_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id),
  class_id UUID REFERENCES classes(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  term_id UUID NOT NULL REFERENCES terms(id),
  status TEXT NOT NULL DEFAULT 'generated',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_cards_status_check CHECK (status IN ('draft', 'generated', 'published', 'archived')),
  CONSTRAINT report_cards_student_term_unique UNIQUE (school_id, student_id, academic_year_id, term_id)
);

CREATE INDEX IF NOT EXISTS idx_report_cards_school_term ON report_cards (school_id, term_id, status);

CREATE TABLE IF NOT EXISTS report_card_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id),
  academic_year_id UUID REFERENCES academic_years(id),
  template_type TEXT NOT NULL DEFAULT 'bulletin',
  layout JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_card_templates_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT report_card_templates_type_check CHECK (template_type IN ('bulletin', 'attestation', 'certificate'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_templates_school_class
  ON report_card_templates (school_id, class_id, template_type)
  WHERE class_id IS NOT NULL AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_templates_school_default
  ON report_card_templates (school_id, template_type)
  WHERE class_id IS NULL AND status = 'active';

CREATE TABLE IF NOT EXISTS school_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id),
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  storage_key TEXT,
  mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_documents_status_check CHECK (status IN ('available', 'generating', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_school_documents_school ON school_documents (school_id, status, created_at DESC);
`;

const STRIP_LEGACY_RESIDUAL_RECORDS_SQL = `
UPDATE establishment_residual_records
SET archived_at = NOW(), status = 'archived', updated_at = NOW()
WHERE archived_at IS NULL
  AND record_domain IN ('exam', 'bulletin', 'document');
`;

async function assertDocumentsExamsSchemaPreflight(db) {
  const schools = await db.one("SELECT to_regclass('public.schools') AS ref");
  const exams = await db.one("SELECT to_regclass('public.exams') AS ref");
  const years = await db.one("SELECT to_regclass('public.academic_years') AS ref");
  const terms = await db.one("SELECT to_regclass('public.terms') AS ref");
  const residual = await db.one("SELECT to_regclass('public.establishment_residual_records') AS ref");
  if (!schools?.ref || !exams?.ref || !years?.ref || !terms?.ref || !residual?.ref) {
    const error = new Error(
      "Schéma de base requis (schools, exams, academic_years, terms, establishment_residual_records) avant LOT 5.",
    );
    error.code = "DOCUMENTS_EXAMS_SCHEMA_PREFLIGHT";
    throw error;
  }
}

module.exports = {
  DOCUMENTS_EXAMS_SCHEMA_SQL,
  STRIP_LEGACY_RESIDUAL_RECORDS_SQL,
  assertDocumentsExamsSchemaPreflight,
};
