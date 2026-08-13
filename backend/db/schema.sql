CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS countries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  iso_code VARCHAR(8) NOT NULL UNIQUE,
  phone_code VARCHAR(16) NOT NULL,
  currency VARCHAR(16) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL REFERENCES countries(id),
  school_code VARCHAR(32) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  logo_url TEXT,
  address TEXT,
  city TEXT,
  phone TEXT,
  email TEXT,
  school_type TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  plan_name TEXT NOT NULL,
  price_per_student NUMERIC(12, 2) NOT NULL DEFAULT 0,
  billing_currency VARCHAR(16) NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  status TEXT NOT NULL DEFAULT 'trial',
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  user_code VARCHAR(64) NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  password_hash TEXT,
  pin_hash TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;

CREATE TABLE IF NOT EXISTS academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (academic_year_id, name)
);

CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  class_code VARCHAR(64) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  level TEXT,
  section TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unicité métier (école + année + nom normalisé) : index créé APRÈS contrôle
-- fail-safe dans postgresRepository.ensureClassesDomainConstraints() /
-- migration 20260811_classes_name_uniqueness.sql (bases legacy avec doublons).
-- Ne pas créer l'index ici : schema.sql s'exécute avant la migration contrôlée.

CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  subject_code VARCHAR(64) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  coefficient NUMERIC(8, 2) NOT NULL DEFAULT 1,
  level TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS description TEXT;

CREATE TABLE IF NOT EXISTS subject_class_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  class_id UUID REFERENCES classes(id),
  level TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subject_class_scope_check CHECK (class_id IS NOT NULL OR level IS NOT NULL),
  UNIQUE (subject_id, class_id, level)
);

DELETE FROM subject_class_assignments a
USING subject_class_assignments b
WHERE a.ctid < b.ctid
  AND a.subject_id = b.subject_id
  AND COALESCE(a.class_id::TEXT, '') = COALESCE(b.class_id::TEXT, '')
  AND COALESCE(a.level, '') = COALESCE(b.level, '');

CREATE UNIQUE INDEX IF NOT EXISTS idx_subject_class_unique_scope
  ON subject_class_assignments (subject_id, COALESCE(class_id::TEXT, ''), COALESCE(level, ''));

CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  user_id UUID REFERENCES users(id),
  teacher_code VARCHAR(64) NOT NULL UNIQUE,
  speciality TEXT,
  hire_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unicité (school_id, user_id) : index créé APRÈS inventaire fail-safe dans
-- postgresRepository.ensureTeachersDomainConstraints() /
-- migration 20260812_teachers_school_user_uniqueness.sql (bases legacy avec doublons).
-- Ne pas créer l'index ici : schema.sql s'exécute avant la migration contrôlée.

CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_code VARCHAR(64) NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  gender TEXT,
  birth_date DATE,
  birth_place TEXT,
  photo_url TEXT,
  parent_phone TEXT,
  parent_email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL REFERENCES students(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  enrollment_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, academic_year_id)
);

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  teacher_id UUID NOT NULL REFERENCES teachers(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  assignment_role TEXT NOT NULL DEFAULT 'primary',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, class_id, subject_id, academic_year_id, assignment_role)
);

ALTER TABLE teacher_assignments ADD COLUMN IF NOT EXISTS assignment_role TEXT NOT NULL DEFAULT 'primary';

-- D3.6b : évaluations pédagogiques (entité distincte des notes)
CREATE TABLE IF NOT EXISTS evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  teacher_id UUID REFERENCES teachers(id),
  term_id UUID NOT NULL REFERENCES terms(id),
  title TEXT NOT NULL,
  evaluation_type TEXT NOT NULL DEFAULT 'devoir',
  evaluation_date DATE,
  max_score NUMERIC(8, 2) NOT NULL DEFAULT 20,
  coefficient NUMERIC(8, 2) NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  linked_exam_id UUID,
  legacy_json_id TEXT,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT evaluations_max_score_positive CHECK (max_score > 0),
  CONSTRAINT evaluations_coefficient_positive CHECK (coefficient > 0),
  CONSTRAINT evaluations_status_check CHECK (
    status IN ('draft', 'open', 'locked', 'published', 'archived')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_evaluations_school_legacy_json_id
  ON evaluations (school_id, legacy_json_id)
  WHERE legacy_json_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL REFERENCES students(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  teacher_id UUID NOT NULL REFERENCES teachers(id),
  term_id UUID NOT NULL REFERENCES terms(id),
  evaluation_id UUID REFERENCES evaluations(id),
  grade_type TEXT NOT NULL,
  score NUMERIC(8, 2),
  max_score NUMERIC(8, 2) NOT NULL DEFAULT 20,
  coefficient NUMERIC(8, 2) NOT NULL DEFAULT 1,
  comment TEXT,
  grade_status TEXT NOT NULL DEFAULT 'graded',
  version INTEGER NOT NULL DEFAULT 1,
  publication_status TEXT NOT NULL DEFAULT 'published',
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT grades_score_check CHECK (score IS NULL OR score <= max_score),
  CONSTRAINT grades_score_non_negative CHECK (score IS NULL OR score >= 0),
  CONSTRAINT grades_version_positive CHECK (version >= 1),
  CONSTRAINT grades_status_check CHECK (
    grade_status IN ('graded', 'absent', 'excused', 'not_submitted', 'exempt')
  ),
  CONSTRAINT grades_status_score_coherence CHECK (
    (grade_status = 'graded' AND score IS NOT NULL)
    OR (grade_status <> 'graded' AND score IS NULL)
  )
);

-- D3.6b : colonnes canoniques sur bases legacy (schéma non bloquant)
ALTER TABLE grades ADD COLUMN IF NOT EXISTS evaluation_id UUID REFERENCES evaluations(id);
ALTER TABLE grades ADD COLUMN IF NOT EXISTS grade_status TEXT NOT NULL DEFAULT 'graded';
ALTER TABLE grades ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE grades ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE grades ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE grades ADD COLUMN IF NOT EXISTS publication_status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE grades ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE grades ALTER COLUMN score DROP NOT NULL;

CREATE TABLE IF NOT EXISTS exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  subject_id UUID REFERENCES subjects(id),
  term_id UUID REFERENCES terms(id),
  exam_code VARCHAR(64) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  exam_type TEXT NOT NULL,
  exam_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES users(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exam_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id),
  score NUMERIC(8, 2) NOT NULL,
  max_score NUMERIC(8, 2) NOT NULL DEFAULT 20,
  mention TEXT,
  observation TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exam_id, student_id),
  CONSTRAINT exam_results_score_check CHECK (score <= max_score)
);

CREATE TABLE IF NOT EXISTS student_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID REFERENCES students(id),
  document_code VARCHAR(64) NOT NULL UNIQUE,
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'PDF',
  version INTEGER NOT NULL DEFAULT 1,
  storage_key TEXT,
  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'available',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promotion_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  student_id UUID NOT NULL REFERENCES students(id),
  from_class_id UUID REFERENCES classes(id),
  to_class_id UUID REFERENCES classes(id),
  decision TEXT NOT NULL,
  reason TEXT,
  decided_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (academic_year_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL REFERENCES students(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  teacher_id UUID REFERENCES teachers(id),
  attendance_date DATE NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- D3.5b : unicité canonique établissement + élève + jour
  UNIQUE (school_id, student_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL REFERENCES students(id),
  payment_code VARCHAR(64) NOT NULL UNIQUE,
  amount NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(16) NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  payment_date DATE,
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_role TEXT,
  target_class_id UUID REFERENCES classes(id),
  created_by UUID REFERENCES users(id),
  published_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  user_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT,
  channel TEXT NOT NULL DEFAULT 'app',
  status TEXT NOT NULL DEFAULT 'sent',
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_value JSONB,
  new_value JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backoffice_state (
  state_key TEXT PRIMARY KEY,
  state_payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Module Finances — Impayés (IMP-002 à IMP-016)
CREATE TABLE IF NOT EXISTS student_fee_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL REFERENCES students(id),
  class_id UUID REFERENCES classes(id),
  fee_grid_id TEXT,
  school_fee_item_id TEXT,
  fee_type TEXT NOT NULL,
  label TEXT NOT NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  academic_year TEXT,
  period_label TEXT,
  initial_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  exemption NUMERIC(12, 2) NOT NULL DEFAULT 0,
  amount_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'À payer',
  last_reminder_at TIMESTAMPTZ,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
);

-- Relances de paiement (IMP-011, IMP-012)
CREATE TABLE IF NOT EXISTS payment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL REFERENCES students(id),
  student_fee_obligation_id UUID REFERENCES student_fee_obligations(id),
  recipient TEXT NOT NULL DEFAULT 'Parent',
  channel TEXT NOT NULL DEFAULT 'notification',
  message TEXT NOT NULL,
  summary TEXT,
  send_status TEXT NOT NULL DEFAULT 'Envoyée',
  triggered_by UUID REFERENCES users(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LOT 4 — Finance canonique (statuts, grilles, allocations). Ensures runtime ajoutent les colonnes manquantes.
CREATE TABLE IF NOT EXISTS payment_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  status_code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fee_grids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  grid_code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  class_name TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  period_name TEXT NOT NULL DEFAULT '',
  currency VARCHAR(16) NOT NULL DEFAULT 'CDF',
  status TEXT NOT NULL DEFAULT 'Brouillon',
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, grid_code)
);

CREATE TABLE IF NOT EXISTS school_fee_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  fee_grid_id UUID NOT NULL REFERENCES fee_grids(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  fee_type TEXT NOT NULL,
  label TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  due_date DATE,
  period_label TEXT,
  monthly_months JSONB NOT NULL DEFAULT '[]'::jsonb,
  mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'Actif',
  profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fee_grid_id, item_code)
);

CREATE TABLE IF NOT EXISTS fee_tariff_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  fee_grid_id UUID REFERENCES fee_grids(id),
  action TEXT NOT NULL,
  actor_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  payment_id UUID NOT NULL REFERENCES payments(id),
  obligation_id UUID NOT NULL REFERENCES student_fee_obligations(id),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  school_id UUID REFERENCES schools(id),
  session_code UUID NOT NULL UNIQUE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  cache_id TEXT PRIMARY KEY,
  route_key TEXT NOT NULL,
  principal_id TEXT NOT NULL DEFAULT '',
  status_code INTEGER NOT NULL,
  response_body JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

CREATE INDEX IF NOT EXISTS idx_schools_country_id ON schools(country_id);
CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_students_school_id ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_school_search ON students(school_id, student_code, first_name, last_name);
CREATE INDEX IF NOT EXISTS idx_grades_student_id ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_grades_school_id ON grades(school_id);
CREATE INDEX IF NOT EXISTS idx_grades_evaluation_id ON grades(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_school_id ON evaluations(school_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_class_subject ON evaluations(class_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance(student_id, attendance_date);
-- D3.5b : l'index unique uq_attendance_school_student_date est créé APRÈS déduplication
-- dans postgresRepository.ensureAttendanceCanonicalUniqueness() (bases legacy sûres).
-- D3.6b : l'index unique uq_grades_school_evaluation_student est créé APRÈS migration/dédup
-- dans postgresRepository.ensureGradeCanonicalUniqueness() (bases legacy sûres).
-- Classes : uq_classes_school_year_normalized_name est créé APRÈS contrôle fail-safe
-- dans postgresRepository.ensureClassesDomainConstraints() (pas de suppression silencieuse).
CREATE INDEX IF NOT EXISTS idx_payments_student_id ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_school_id ON payments(school_id);
CREATE INDEX IF NOT EXISTS idx_student_fee_obligations_school_student ON student_fee_obligations(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_student_fee_obligations_status_due ON student_fee_obligations(school_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_student ON payment_reminders(school_id, student_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_subject_assignments_school_id ON subject_class_assignments(school_id);
CREATE INDEX IF NOT EXISTS idx_exams_school_date ON exams(school_id, exam_date);
CREATE INDEX IF NOT EXISTS idx_exam_results_exam_id ON exam_results(exam_id);
CREATE INDEX IF NOT EXISTS idx_student_documents_student_id ON student_documents(student_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_filters ON audit_logs(school_id, user_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(user_id, session_code) WHERE revoked_at IS NULL;
