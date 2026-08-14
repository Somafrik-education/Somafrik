-- LOT 5 — Examens, bulletins, templates et documents établissement canoniques.
-- Idempotent. Aucune copie heuristique de JSON résiduel.
--
-- Le boot runtime (runDocumentsExamsCanonicalBoot) n'applique PAS ce fichier
-- avant l'inventaire. Ordre obligatoire :
--   preflight → inventaire residual → inventaire statuts exams
--   → STOP si ambigu (LEGACY_*_AMBIGUOUS / LEGACY_EXAM_STATUS_AMBIGUOUS)
--   → DDL → normalisation déterministe (published → completed uniquement)
--   → CHECK status → strip residual
--
-- Conversion déterministe documentée : exams.status 'published' → 'completed'.
-- Tout autre statut hors
--   draft | scheduled | validated | completed | cancelled | archived | published
-- bloque le boot. Aucun mapping heuristique vers 'scheduled'.

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id),
  ADD COLUMN IF NOT EXISTS evaluation_type_id UUID REFERENCES evaluation_types(id),
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

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

UPDATE exams SET status = 'completed' WHERE status = 'published';

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
