-- Affectation du professeur principal d'une classe.
-- Une seule affectation active par classe. L'historique n'est jamais
-- supprimé silencieusement (fin = status inactive + ended_at).

CREATE TABLE IF NOT EXISTS class_head_teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  teacher_id UUID NOT NULL REFERENCES teachers(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_head_teachers_one_active
  ON class_head_teachers (class_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_class_head_teachers_school_teacher
  ON class_head_teachers (school_id, teacher_id, status);
