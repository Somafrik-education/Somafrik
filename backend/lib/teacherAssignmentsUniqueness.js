"use strict";

/**
 * Unicité des affectations ACTIVES uniquement.
 * Index unique PARTIEL : un enseignant peut être réaffecté au même tuple
 * (classe, matière, année, rôle) après status='deleted'.
 *
 * Politique : jamais de suppression silencieuse de l'historique.
 */

const TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX = "uq_teacher_assignments_active_tuple";
const TEACHER_ASSIGNMENTS_ACTIVE_DUPLICATES_CODE = "TEACHER_ASSIGNMENTS_ACTIVE_DUPLICATES";
const TEACHER_ASSIGNMENTS_ACTIVE_INDEX_MISSING_CODE = "TEACHER_ASSIGNMENTS_ACTIVE_INDEX_MISSING";

const ACTIVE_ASSIGNMENT_STATUS_SQL = `COALESCE(status, 'active') = 'active'`;

const COUNT_ACTIVE_ASSIGNMENT_DUPLICATE_GROUPS_SQL = `
  SELECT COUNT(*)::int AS duplicate_groups
  FROM (
    SELECT teacher_id, class_id, subject_id, academic_year_id, assignment_role
    FROM teacher_assignments
    WHERE ${ACTIVE_ASSIGNMENT_STATUS_SQL}
    GROUP BY teacher_id, class_id, subject_id, academic_year_id, assignment_role
    HAVING COUNT(*) > 1
  ) d
`;

const LIST_ACTIVE_ASSIGNMENT_DUPLICATE_GROUPS_SQL = `
  SELECT
    s.school_code,
    t.teacher_code,
    COUNT(*)::int AS duplicate_count,
    array_agg(ta.id::text ORDER BY ta.updated_at DESC NULLS LAST, ta.created_at DESC NULLS LAST, ta.id DESC) AS assignment_ids
  FROM teacher_assignments ta
  JOIN teachers t ON t.id = ta.teacher_id
  JOIN schools s ON s.id = ta.school_id
  WHERE COALESCE(ta.status, 'active') = 'active'
  GROUP BY s.school_code, t.teacher_code, ta.teacher_id, ta.class_id, ta.subject_id, ta.academic_year_id, ta.assignment_role
  HAVING COUNT(*) > 1
  ORDER BY s.school_code, t.teacher_code
  LIMIT 20
`;

const DROP_LEGACY_TEACHER_ASSIGNMENT_GLOBAL_UNIQUES_SQL = `
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = ANY (current_schemas(false))
      AND t.relname = 'teacher_assignments'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) ILIKE '%teacher_id%'
      AND pg_get_constraintdef(c.oid) ILIKE '%class_id%'
      AND pg_get_constraintdef(c.oid) ILIKE '%subject_id%'
      AND pg_get_constraintdef(c.oid) ILIKE '%academic_year_id%'
      AND pg_get_constraintdef(c.oid) ILIKE '%assignment_role%'
  LOOP
    EXECUTE format('ALTER TABLE teacher_assignments DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;

  FOR rec IN
    SELECT i.indexrelid::regclass AS indexreg
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = ANY (current_schemas(false))
      AND t.relname = 'teacher_assignments'
      AND i.indisunique
      AND NOT i.indisprimary
      AND pg_get_indexdef(i.indexrelid) ILIKE '%teacher_id%'
      AND pg_get_indexdef(i.indexrelid) ILIKE '%class_id%'
      AND pg_get_indexdef(i.indexrelid) ILIKE '%subject_id%'
      AND pg_get_indexdef(i.indexrelid) ILIKE '%academic_year_id%'
      AND pg_get_indexdef(i.indexrelid) ILIKE '%assignment_role%'
      AND pg_get_indexdef(i.indexrelid) NOT ILIKE '%WHERE%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %s', rec.indexreg);
  END LOOP;
END $$;
`;

const CREATE_TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ${TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX}
  ON teacher_assignments (teacher_id, class_id, subject_id, academic_year_id, assignment_role)
  WHERE ${ACTIVE_ASSIGNMENT_STATUS_SQL}
`;

const CHECK_TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX_SQL = `
  SELECT 1 AS present
  FROM pg_indexes
  WHERE schemaname = ANY (current_schemas(false))
    AND indexname = $1
  LIMIT 1
`;

function formatActiveAssignmentDuplicateDiagnostic(groups = [], duplicateGroups = 0) {
  const samples = (Array.isArray(groups) ? groups : [])
    .slice(0, 10)
    .map((row) => {
      const ids = Array.isArray(row.assignment_ids)
        ? row.assignment_ids.join(",")
        : String(row.assignment_ids ?? "");
      return `${row.school_code}/${row.teacher_code}×${row.duplicate_count}[${ids}]`;
    })
    .join("; ");
  return (
    `Affectations : ${duplicateGroups} groupe(s) en doublon parmi les lignes actives ` +
    `(teacher_id, class_id, subject_id, academic_year_id, assignment_role). ` +
    `Résolution explicite requise avant création de l'index ${TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX}. ` +
    `Aucune suppression automatique de l'historique n'est effectuée.` +
    (samples ? ` Exemples: ${samples}` : "")
  );
}

function createTeacherAssignmentsUniquenessError(message, meta = {}) {
  const error = new Error(message);
  error.name = "TeacherAssignmentsUniquenessError";
  error.code = meta.code || TEACHER_ASSIGNMENTS_ACTIVE_DUPLICATES_CODE;
  if (meta.inventory) {
    error.inventory = meta.inventory;
  }
  return error;
}

function isTeacherAssignmentsActiveUniquenessViolation(error) {
  if (!error || String(error.code) !== "23505") {
    return false;
  }
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "");
  const message = String(error.message ?? "");
  return (
    constraint === TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX ||
    detail.includes(TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX) ||
    message.includes(TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX)
  );
}

async function inventoryActiveAssignmentDuplicates(db) {
  const before = await db.one(COUNT_ACTIVE_ASSIGNMENT_DUPLICATE_GROUPS_SQL);
  const duplicateGroups = Number(before?.duplicate_groups ?? 0);
  const groups =
    duplicateGroups > 0 ? await db.all(LIST_ACTIVE_ASSIGNMENT_DUPLICATE_GROUPS_SQL) : [];
  return {
    duplicateGroups,
    groups: Array.isArray(groups) ? groups : [],
    diagnostic: formatActiveAssignmentDuplicateDiagnostic(groups, duplicateGroups),
  };
}

async function ensureTeacherAssignmentsActiveUniqueness(db, logger = console) {
  const logInfo = typeof logger.info === "function" ? logger.info.bind(logger) : console.log;
  const logError = typeof logger.error === "function" ? logger.error.bind(logger) : console.error;

  const inventory = await inventoryActiveAssignmentDuplicates(db);
  logInfo(
    `[teacher-assignments] inventaire read-only (affectations actives) : ` +
      `${inventory.duplicateGroups} groupe(s) en doublon`,
  );

  if (inventory.duplicateGroups > 0) {
    logError(`[teacher-assignments] ${inventory.diagnostic}`);
    throw createTeacherAssignmentsUniquenessError(inventory.diagnostic, {
      code: TEACHER_ASSIGNMENTS_ACTIVE_DUPLICATES_CODE,
      inventory: {
        duplicateGroups: inventory.duplicateGroups,
        sampleCount: inventory.groups.length,
      },
    });
  }

  await db.query(DROP_LEGACY_TEACHER_ASSIGNMENT_GLOBAL_UNIQUES_SQL);

  try {
    await db.query(CREATE_TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX_SQL);
  } catch (error) {
    if (isTeacherAssignmentsActiveUniquenessViolation(error)) {
      const groups = await db.all(LIST_ACTIVE_ASSIGNMENT_DUPLICATE_GROUPS_SQL);
      const duplicateGroups = Array.isArray(groups) ? groups.length : 0;
      const diagnostic = formatActiveAssignmentDuplicateDiagnostic(groups, duplicateGroups);
      logError(`[teacher-assignments] échec CREATE INDEX : ${diagnostic}`);
      throw createTeacherAssignmentsUniquenessError(diagnostic, {
        code: TEACHER_ASSIGNMENTS_ACTIVE_DUPLICATES_CODE,
        inventory: { duplicateGroups, sampleCount: duplicateGroups },
      });
    }
    throw error;
  }

  const indexRow = await db.one(CHECK_TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX_SQL, [
    TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX,
  ]);
  if (!indexRow?.present) {
    const diagnostic =
      `Affectations : index ${TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX} absent après tentative de création.`;
    logError(`[teacher-assignments] ${diagnostic}`);
    throw createTeacherAssignmentsUniquenessError(diagnostic, {
      code: TEACHER_ASSIGNMENTS_ACTIVE_INDEX_MISSING_CODE,
    });
  }

  logInfo(
    `[teacher-assignments] contrainte active satisfaite (index ${TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX})`,
  );
}

module.exports = {
  TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX,
  TEACHER_ASSIGNMENTS_ACTIVE_DUPLICATES_CODE,
  TEACHER_ASSIGNMENTS_ACTIVE_INDEX_MISSING_CODE,
  COUNT_ACTIVE_ASSIGNMENT_DUPLICATE_GROUPS_SQL,
  LIST_ACTIVE_ASSIGNMENT_DUPLICATE_GROUPS_SQL,
  DROP_LEGACY_TEACHER_ASSIGNMENT_GLOBAL_UNIQUES_SQL,
  CREATE_TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX_SQL,
  CHECK_TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX_SQL,
  formatActiveAssignmentDuplicateDiagnostic,
  createTeacherAssignmentsUniquenessError,
  isTeacherAssignmentsActiveUniquenessViolation,
  inventoryActiveAssignmentDuplicates,
  ensureTeacherAssignmentsActiveUniqueness,
};
