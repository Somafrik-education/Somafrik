"use strict";

/**
 * Inventaire read-only des collisions school_courses qui stoppent le boot :
 * CANONICAL_SCHOOL_COURSE_AMBIGUOUS.
 *
 * Aucun INSERT / UPDATE / DELETE / DDL. Aucun choix silencieux appliqué.
 * Les propositions (keep / archive / needs_human) sont diagnostiques.
 */

const fs = require("node:fs");
const path = require("node:path");

const CANONICAL_SCHOOL_COURSE_AMBIGUOUS = "CANONICAL_SCHOOL_COURSE_AMBIGUOUS";
const SCHOOL_COURSE_AMBIGUITY_OK = "SCHOOL_COURSE_AMBIGUITY_OK";
const UNIQUE_INDEX_NAME = "uq_school_courses_class_subject_active";

const WRITE_FLAG_ARGS = Object.freeze(["--apply", "--write", "--fix", "--migrate", "--backfill", "--delete"]);
const WRITE_ENV_KEYS = Object.freeze([
  "SOMAFRIK_SCHOOL_COURSE_AMBIGUITY_APPLY",
  "SOMAFRIK_SCHOOL_COURSE_AMBIGUITY_BACKFILL",
]);
const SQL_WRITE_TOKEN = /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL)\b/i;

const CHECK_UNIQUE_INDEX_SQL = `
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = ANY (current_schemas(false))
   AND indexname = $1
 LIMIT 1
`;

const CHECK_WEEKLY_TABLE_SQL = `
SELECT to_regclass('public.course_schedule_weekly_slots') IS NOT NULL AS present
`;

/** SQL demandé : groupes actifs (school, class, subject) avec COUNT(*) > 1. */
const SELECT_DUPLICATE_ACTIVE_GROUPS_SQL = `
SELECT
  sc.school_id,
  s.school_code,
  sc.class_id,
  c.class_code,
  c.name AS class_name,
  sc.subject_id,
  sub.subject_code,
  sub.name AS subject_name,
  COUNT(*)::int AS active_count,
  ARRAY_AGG(sc.id ORDER BY sc.created_at, sc.id) AS school_course_ids
FROM school_courses sc
JOIN schools s ON s.id = sc.school_id
JOIN classes c ON c.id = sc.class_id
JOIN subjects sub ON sub.id = sc.subject_id
WHERE sc.status = 'active'
GROUP BY
  sc.school_id, s.school_code,
  sc.class_id, c.class_code, c.name,
  sc.subject_id, sub.subject_code, sub.name
HAVING COUNT(*) > 1
ORDER BY active_count DESC, s.school_code, c.class_code, sub.subject_code
`;

const SELECT_DUPLICATE_ACTIVE_ROWS_SQL = `
SELECT
  sc.id,
  sc.school_id,
  s.school_code,
  sc.class_id,
  c.class_code,
  c.name AS class_name,
  sc.subject_id,
  sub.subject_code,
  sub.name AS subject_name,
  sc.teacher_id,
  t.teacher_code,
  sc.course_code,
  sc.status,
  sc.created_at,
  sc.updated_at,
  0::int AS weekly_slot_count
FROM school_courses sc
JOIN schools s ON s.id = sc.school_id
JOIN classes c ON c.id = sc.class_id
JOIN subjects sub ON sub.id = sc.subject_id
LEFT JOIN teachers t ON t.id = sc.teacher_id
WHERE sc.status = 'active'
  AND (sc.school_id, sc.class_id, sc.subject_id) IN (
    SELECT school_id, class_id, subject_id
    FROM school_courses
    WHERE status = 'active'
    GROUP BY school_id, class_id, subject_id
    HAVING COUNT(*) > 1
  )
ORDER BY s.school_code, c.class_code, sub.subject_code, sc.created_at, sc.id
`;

const SELECT_DUPLICATE_ACTIVE_ROWS_WITH_WEEKLY_SQL = `
SELECT
  sc.id,
  sc.school_id,
  s.school_code,
  sc.class_id,
  c.class_code,
  c.name AS class_name,
  sc.subject_id,
  sub.subject_code,
  sub.name AS subject_name,
  sc.teacher_id,
  t.teacher_code,
  sc.course_code,
  sc.status,
  sc.created_at,
  sc.updated_at,
  (
    SELECT COUNT(*)::int
    FROM course_schedule_weekly_slots w
    WHERE w.school_course_id = sc.id
  ) AS weekly_slot_count
FROM school_courses sc
JOIN schools s ON s.id = sc.school_id
JOIN classes c ON c.id = sc.class_id
JOIN subjects sub ON sub.id = sc.subject_id
LEFT JOIN teachers t ON t.id = sc.teacher_id
WHERE sc.status = 'active'
  AND (sc.school_id, sc.class_id, sc.subject_id) IN (
    SELECT school_id, class_id, subject_id
    FROM school_courses
    WHERE status = 'active'
    GROUP BY school_id, class_id, subject_id
    HAVING COUNT(*) > 1
  )
ORDER BY s.school_code, c.class_code, sub.subject_code, sc.created_at, sc.id
`;

/**
 * Collision boot la plus probable si l'index unique actif existe :
 * teacher_assignment active vs school_course actif classe+matière
 * dont teacher_id est distinct (ou plusieurs lignes actives).
 */
const SELECT_ASSIGNMENT_CLASS_SUBJECT_COLLISIONS_SQL = `
SELECT
  ta.id AS assignment_id,
  ta.school_id,
  s.school_code,
  ta.teacher_id AS assignment_teacher_id,
  t.teacher_code AS assignment_teacher_code,
  ta.class_id,
  c.class_code,
  c.name AS class_name,
  ta.subject_id,
  sub.subject_code,
  sub.name AS subject_name,
  ta.academic_year_id,
  sc.id AS school_course_id,
  sc.teacher_id AS course_teacher_id,
  ct.teacher_code AS course_teacher_code,
  sc.course_code,
  sc.status AS course_status,
  sc.created_at AS course_created_at,
  sc.updated_at AS course_updated_at
FROM teacher_assignments ta
JOIN schools s ON s.id = ta.school_id
JOIN teachers t ON t.id = ta.teacher_id
JOIN classes c ON c.id = ta.class_id
JOIN subjects sub ON sub.id = ta.subject_id
JOIN school_courses sc
  ON sc.school_id = ta.school_id
 AND sc.class_id = ta.class_id
 AND sc.subject_id = ta.subject_id
 AND sc.status = 'active'
LEFT JOIN teachers ct ON ct.id = sc.teacher_id
WHERE ta.status = 'active'
  AND (
    sc.teacher_id IS DISTINCT FROM ta.teacher_id
    OR (
      SELECT COUNT(*)::int
      FROM school_courses sc2
      WHERE sc2.school_id = ta.school_id
        AND sc2.class_id = ta.class_id
        AND sc2.subject_id = ta.subject_id
        AND sc2.status = 'active'
    ) > 1
  )
ORDER BY s.school_code, c.class_code, sub.subject_code, ta.created_at, sc.created_at, sc.id
`;

const SELECT_NON_CANONICAL_ASSIGNMENTS_SQL = `
SELECT
  ta.id AS assignment_id,
  ta.school_id,
  s.school_code,
  ta.teacher_id,
  t.id AS teacher_row_id,
  t.school_id AS teacher_school_id,
  t.status AS teacher_status,
  ta.class_id,
  c.id AS class_row_id,
  c.school_id AS class_school_id,
  c.academic_year_id AS class_academic_year_id,
  ta.subject_id,
  sub.id AS subject_row_id,
  sub.school_id AS subject_school_id,
  ta.academic_year_id,
  ay.id AS year_row_id,
  ay.school_id AS year_school_id
FROM teacher_assignments ta
LEFT JOIN teachers t ON t.id = ta.teacher_id
LEFT JOIN classes c ON c.id = ta.class_id
LEFT JOIN subjects sub ON sub.id = ta.subject_id
LEFT JOIN academic_years ay ON ay.id = ta.academic_year_id
LEFT JOIN schools s ON s.id = ta.school_id
WHERE ta.status = 'active'
  AND (
    ta.teacher_id IS NULL
    OR ta.class_id IS NULL
    OR ta.subject_id IS NULL
    OR ta.academic_year_id IS NULL
    OR ta.school_id IS NULL
    OR t.id IS NULL
    OR c.id IS NULL
    OR sub.id IS NULL
    OR ay.id IS NULL
    OR s.school_code IS NULL
    OR t.school_id IS DISTINCT FROM ta.school_id
    OR c.school_id IS DISTINCT FROM ta.school_id
    OR sub.school_id IS DISTINCT FROM ta.school_id
    OR ay.school_id IS DISTINCT FROM ta.school_id
    OR c.academic_year_id IS DISTINCT FROM ta.academic_year_id
    OR lower(COALESCE(t.status, 'active')) IN ('deleted', 'archived')
  )
ORDER BY s.school_code NULLS LAST, ta.created_at, ta.id
`;

const CHECK_DEPENDENCY_TABLES_SQL = `
SELECT
  to_regclass('public.course_schedule_weekly_slots') IS NOT NULL AS weekly_present,
  to_regclass('public.course_schedule_slots') IS NOT NULL AS dated_slots_present,
  to_regclass('public.evaluations') IS NOT NULL AS evaluations_present,
  to_regclass('public.grades') IS NOT NULL AS grades_present,
  to_regclass('public.report_cards') IS NOT NULL AS report_cards_present
`;

/**
 * Dry-run SELECT du repair #531 : cours actif teacher_id NULL + exactement
 * une teacher_assignment active canonique. Aucun UPDATE.
 */
const SELECT_NULL_TEACHER_REPAIRABLE_SQL = `
SELECT
  sc.id AS school_course_id,
  sc.school_id,
  s.school_code,
  sc.class_id,
  c.class_code,
  sc.subject_id,
  sub.subject_code,
  sc.course_code,
  ta.id AS assignment_id,
  ta.teacher_id AS proposed_teacher_id,
  t.teacher_code AS proposed_teacher_code
FROM school_courses sc
JOIN schools s ON s.id = sc.school_id
JOIN teacher_assignments ta
  ON ta.school_id = sc.school_id
 AND ta.class_id = sc.class_id
 AND ta.subject_id = sc.subject_id
 AND ta.status = 'active'
JOIN teachers t
  ON t.id = ta.teacher_id
 AND t.school_id = ta.school_id
JOIN classes c
  ON c.id = ta.class_id
 AND c.school_id = ta.school_id
 AND c.academic_year_id = ta.academic_year_id
JOIN subjects sub
  ON sub.id = ta.subject_id
 AND sub.school_id = ta.school_id
JOIN academic_years ay
  ON ay.id = ta.academic_year_id
 AND ay.school_id = ta.school_id
WHERE sc.status = 'active'
  AND sc.teacher_id IS NULL
  AND lower(COALESCE(t.status, 'active')) NOT IN ('deleted', 'archived')
  AND (
    SELECT COUNT(*)::int
    FROM teacher_assignments ta2
    JOIN teachers t2
      ON t2.id = ta2.teacher_id
     AND t2.school_id = ta2.school_id
    JOIN classes c2
      ON c2.id = ta2.class_id
     AND c2.school_id = ta2.school_id
     AND c2.academic_year_id = ta2.academic_year_id
    JOIN subjects sub2
      ON sub2.id = ta2.subject_id
     AND sub2.school_id = ta2.school_id
    JOIN academic_years ay2
      ON ay2.id = ta2.academic_year_id
     AND ay2.school_id = ta2.school_id
    WHERE ta2.school_id = sc.school_id
      AND ta2.class_id = sc.class_id
      AND ta2.subject_id = sc.subject_id
      AND ta2.status = 'active'
      AND lower(COALESCE(t2.status, 'active')) NOT IN ('deleted', 'archived')
  ) = 1
ORDER BY s.school_code, c.class_code, sub.subject_code, sc.id
`;

const SELECT_COLLISION_DEPENDENCY_COUNTS_SQL = `
SELECT
  sc.id AS school_course_id,
  sc.school_id,
  s.school_code,
  sc.class_id,
  c.class_code,
  sc.subject_id,
  sub.subject_code,
  sc.course_code,
  sc.teacher_id IS NULL AS teacher_id_null,
  0::int AS weekly_slot_count,
  0::int AS dated_slot_count,
  (
    SELECT COUNT(*)::int
    FROM teacher_assignments ta
    WHERE ta.school_id = sc.school_id
      AND ta.class_id = sc.class_id
      AND ta.subject_id = sc.subject_id
      AND ta.status = 'active'
  ) AS active_assignment_count,
  0::int AS evaluation_count,
  0::int AS grade_count,
  0::int AS report_card_count
FROM school_courses sc
JOIN schools s ON s.id = sc.school_id
JOIN classes c ON c.id = sc.class_id
JOIN subjects sub ON sub.id = sc.subject_id
WHERE sc.status = 'active'
  AND (
    (sc.school_id, sc.class_id, sc.subject_id) IN (
      SELECT school_id, class_id, subject_id
      FROM school_courses
      WHERE status = 'active'
      GROUP BY school_id, class_id, subject_id
      HAVING COUNT(*) > 1
    )
    OR EXISTS (
      SELECT 1
      FROM teacher_assignments ta
      WHERE ta.status = 'active'
        AND ta.school_id = sc.school_id
        AND ta.class_id = sc.class_id
        AND ta.subject_id = sc.subject_id
        AND (
          sc.teacher_id IS DISTINCT FROM ta.teacher_id
          OR (
            SELECT COUNT(*)::int
            FROM school_courses sc2
            WHERE sc2.school_id = ta.school_id
              AND sc2.class_id = ta.class_id
              AND sc2.subject_id = ta.subject_id
              AND sc2.status = 'active'
          ) > 1
        )
    )
  )
ORDER BY s.school_code, c.class_code, sub.subject_code, sc.id
`;

const SELECT_COLLISION_DEPENDENCY_COUNTS_FULL_SQL = `
SELECT
  sc.id AS school_course_id,
  sc.school_id,
  s.school_code,
  sc.class_id,
  c.class_code,
  sc.subject_id,
  sub.subject_code,
  sc.course_code,
  sc.teacher_id IS NULL AS teacher_id_null,
  CASE WHEN $1::bool THEN (
    SELECT COUNT(*)::int
    FROM course_schedule_weekly_slots w
    WHERE w.school_course_id = sc.id
  ) ELSE 0 END AS weekly_slot_count,
  CASE WHEN $2::bool THEN (
    SELECT COUNT(*)::int
    FROM course_schedule_slots d
    WHERE d.school_id = sc.school_id
      AND d.class_id = sc.class_id
      AND d.subject_name = sub.name
  ) ELSE 0 END AS dated_slot_count,
  (
    SELECT COUNT(*)::int
    FROM teacher_assignments ta
    WHERE ta.school_id = sc.school_id
      AND ta.class_id = sc.class_id
      AND ta.subject_id = sc.subject_id
      AND ta.status = 'active'
  ) AS active_assignment_count,
  CASE WHEN $3::bool THEN (
    SELECT COUNT(*)::int
    FROM evaluations e
    WHERE e.school_id = sc.school_id
      AND e.class_id = sc.class_id
      AND e.subject_id = sc.subject_id
  ) ELSE 0 END AS evaluation_count,
  CASE WHEN $4::bool THEN (
    SELECT COUNT(*)::int
    FROM grades g
    WHERE g.school_id = sc.school_id
      AND g.class_id = sc.class_id
      AND g.subject_id = sc.subject_id
  ) ELSE 0 END AS grade_count,
  CASE WHEN $5::bool THEN (
    SELECT COUNT(*)::int
    FROM report_cards rc
    WHERE rc.school_id = sc.school_id
      AND rc.class_id = sc.class_id
  ) ELSE 0 END AS report_card_count
FROM school_courses sc
JOIN schools s ON s.id = sc.school_id
JOIN classes c ON c.id = sc.class_id
JOIN subjects sub ON sub.id = sc.subject_id
WHERE sc.status = 'active'
  AND (
    (sc.school_id, sc.class_id, sc.subject_id) IN (
      SELECT school_id, class_id, subject_id
      FROM school_courses
      WHERE status = 'active'
      GROUP BY school_id, class_id, subject_id
      HAVING COUNT(*) > 1
    )
    OR EXISTS (
      SELECT 1
      FROM teacher_assignments ta
      WHERE ta.status = 'active'
        AND ta.school_id = sc.school_id
        AND ta.class_id = sc.class_id
        AND ta.subject_id = sc.subject_id
        AND (
          sc.teacher_id IS DISTINCT FROM ta.teacher_id
          OR (
            SELECT COUNT(*)::int
            FROM school_courses sc2
            WHERE sc2.school_id = ta.school_id
              AND sc2.class_id = ta.class_id
              AND sc2.subject_id = ta.subject_id
              AND sc2.status = 'active'
          ) > 1
        )
    )
  )
ORDER BY s.school_code, c.class_code, sub.subject_code, sc.id
`;

const ALL_INVENTORY_SQL = Object.freeze([
  CHECK_UNIQUE_INDEX_SQL,
  CHECK_WEEKLY_TABLE_SQL,
  CHECK_DEPENDENCY_TABLES_SQL,
  SELECT_DUPLICATE_ACTIVE_GROUPS_SQL,
  SELECT_DUPLICATE_ACTIVE_ROWS_SQL,
  SELECT_DUPLICATE_ACTIVE_ROWS_WITH_WEEKLY_SQL,
  SELECT_ASSIGNMENT_CLASS_SUBJECT_COLLISIONS_SQL,
  SELECT_NON_CANONICAL_ASSIGNMENTS_SQL,
  SELECT_NULL_TEACHER_REPAIRABLE_SQL,
  SELECT_COLLISION_DEPENDENCY_COUNTS_SQL,
  SELECT_COLLISION_DEPENDENCY_COUNTS_FULL_SQL,
]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function stripSqlComments(sql) {
  return String(sql ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function assertSelectOnlySql(sql) {
  const text = stripSqlComments(sql);
  if (SQL_WRITE_TOKEN.test(text)) {
    throw new Error("SQL d'inventaire invalide : jeton d'écriture détecté.");
  }
  if (!/\bSELECT\b/i.test(text)) {
    throw new Error("SQL d'inventaire invalide : SELECT obligatoire.");
  }
}

function assertInventorySqlIsSelectOnly(sqlList = ALL_INVENTORY_SQL) {
  for (const sql of sqlList) {
    assertSelectOnlySql(sql);
  }
  const standalone = fs.readFileSync(
    path.join(__dirname, "../db/inventory_school_course_ambiguity.sql"),
    "utf8",
  );
  assertSelectOnlySql(standalone);
}

function assertNoWriteFlags(argv = process.argv, env = process.env) {
  const args = Array.isArray(argv) ? argv : [];
  const flaggedArg = args.find((arg) => WRITE_FLAG_ARGS.includes(String(arg)));
  if (flaggedArg) {
    const error = new Error(
      `Inventaire SELECT-only : drapeau d'écriture refusé (${flaggedArg}). Aucune correction automatique.`,
    );
    error.code = "SCHOOL_COURSE_INVENTORY_WRITE_REFUSED";
    throw error;
  }
  for (const key of WRITE_ENV_KEYS) {
    const raw = asTrimmed(env?.[key]);
    if (raw && raw !== "0" && raw.toLowerCase() !== "false") {
      const error = new Error(
        `Inventaire SELECT-only : variable ${key} refusée. Aucun archivage automatique.`,
      );
      error.code = "SCHOOL_COURSE_INVENTORY_WRITE_REFUSED";
      throw error;
    }
  }
}

function groupKey(row) {
  return `${row.school_id}|${row.class_id}|${row.subject_id}`;
}

function uniqueTeacherIds(rows) {
  return [...new Set((rows ?? []).map((row) => String(row.teacher_id ?? "")).filter(Boolean))];
}

/**
 * Proposition diagnostique — jamais appliquée par l'inventaire.
 *
 * - Doublons actifs même classe+matière : un gagnant unique si exactement
 *   une ligne matche une affectation active du même enseignant, sinon
 *   si une seule ligne a des créneaux weekly et les autres 0.
 * - Affectation vs autre enseignant : needs_human (conflit métier).
 * - Affectation non canonique : needs_human.
 */
function proposeDuplicateGroupRepair(groupRows, matchingAssignmentTeacherIds = []) {
  const rows = Array.isArray(groupRows) ? groupRows : [];
  const assignmentTeachers = new Set((matchingAssignmentTeacherIds ?? []).map(String).filter(Boolean));
  const teacherIds = uniqueTeacherIds(rows);

  if (rows.length <= 1) {
    return { action: "none", confidence: "n/a", keepId: rows[0]?.id ?? null, archiveIds: [], reason: "pas de doublon" };
  }

  if (teacherIds.length > 1) {
    return {
      action: "needs_human",
      confidence: "conflict",
      keepId: null,
      archiveIds: [],
      reason: "plusieurs teacher_id actifs pour la même classe+matière — aucun choix silencieux",
    };
  }

  const assignmentMatches = rows.filter((row) => assignmentTeachers.has(String(row.teacher_id ?? "")));
  if (assignmentMatches.length === 1) {
    const keepId = assignmentMatches[0].id;
    return {
      action: "archive_duplicates",
      confidence: "unique_assignment_match",
      keepId,
      archiveIds: rows.filter((row) => row.id !== keepId).map((row) => row.id),
      reason: "une seule ligne aligne teacher_id sur une teacher_assignment active",
    };
  }

  const withSlots = rows.filter((row) => Number(row.weekly_slot_count ?? 0) > 0);
  const withoutSlots = rows.filter((row) => Number(row.weekly_slot_count ?? 0) === 0);
  if (withSlots.length === 1 && withoutSlots.length === rows.length - 1) {
    const keepId = withSlots[0].id;
    return {
      action: "archive_duplicates",
      confidence: "unique_weekly_dependency",
      keepId,
      archiveIds: withoutSlots.map((row) => row.id),
      reason: "une seule ligne a des course_schedule_weekly_slots",
    };
  }

  return {
    action: "needs_human",
    confidence: "ambiguous",
    keepId: null,
    archiveIds: [],
    reason: "plusieurs lignes exploitables — aucun choix silencieux",
  };
}

function classifyAssignmentCollision(row, repairableCourseIds = new Set()) {
  const courseTeacher = row.course_teacher_id;
  if (courseTeacher == null || String(courseTeacher).trim() === "") {
    if (repairableCourseIds.has(String(row.school_course_id))) {
      return "null_teacher_repairable";
    }
    return "null_teacher_ambiguous";
  }
  if (String(courseTeacher) !== String(row.assignment_teacher_id ?? "")) {
    return "other_teacher";
  }
  return "duplicate_active";
}

function proposeRepair(inventory) {
  const assignmentTeachersByKey = new Map();
  for (const row of inventory.assignmentCollisions ?? []) {
    const key = groupKey(row);
    if (!assignmentTeachersByKey.has(key)) assignmentTeachersByKey.set(key, new Set());
    if (row.assignment_teacher_id) {
      assignmentTeachersByKey.get(key).add(String(row.assignment_teacher_id));
    }
  }

  const repairableCourseIds = new Set(
    (inventory.nullTeacherRepairable ?? []).map((row) => String(row.school_course_id)),
  );

  const duplicateProposals = (inventory.duplicateGroups ?? []).map((group) => {
    const proposal = proposeDuplicateGroupRepair(
      group.rows,
      [...(assignmentTeachersByKey.get(group.key) ?? [])],
    );
    return {
      key: group.key,
      schoolCode: group.school_code,
      classCode: group.class_code,
      subjectCode: group.subject_code,
      activeCount: group.active_count,
      ...proposal,
    };
  });

  const assignmentCollisions = inventory.assignmentCollisions ?? [];
  const nullTeacherProposals = assignmentCollisions
    .filter((row) => classifyAssignmentCollision(row, repairableCourseIds) === "null_teacher_repairable")
    .map((row) => ({
      key: groupKey(row),
      assignmentId: row.assignment_id,
      schoolCourseId: row.school_course_id,
      schoolCode: row.school_code,
      classCode: row.class_code,
      subjectCode: row.subject_code,
      action: "repairable_bind_teacher",
      confidence: "unique_canonical_assignment",
      keepId: row.school_course_id,
      archiveIds: [],
      reason:
        "school_course actif teacher_id NULL + une seule teacher_assignment canonique — dry-run #531, aucun bind automatique",
    }));

  const assignmentOtherTeacher = assignmentCollisions.filter((row) => {
    const kind = classifyAssignmentCollision(row, repairableCourseIds);
    const duplicate = (inventory.duplicateGroups ?? []).some((group) => group.key === groupKey(row));
    return !duplicate && kind !== "null_teacher_repairable" && kind !== "duplicate_active";
  });

  const assignmentProposals = assignmentOtherTeacher.map((row) => ({
    key: groupKey(row),
    assignmentId: row.assignment_id,
    schoolCode: row.school_code,
    classCode: row.class_code,
    subjectCode: row.subject_code,
    collisionKind: classifyAssignmentCollision(row, repairableCourseIds),
    action: "needs_human",
    confidence: "conflict",
    keepId: null,
    archiveIds: [],
    reason:
      classifyAssignmentCollision(row, repairableCourseIds) === "null_teacher_ambiguous"
        ? "school_course teacher_id NULL sans unique affectation canonique — aucun choix silencieux"
        : "affectation active vs school_course actif d'un autre enseignant — isolation métier, aucun choix silencieux",
  }));

  const nonCanonicalProposals = (inventory.nonCanonicalAssignments ?? []).map((row) => ({
    assignmentId: row.assignment_id,
    schoolCode: row.school_code,
    action: "needs_human",
    confidence: "non_canonical",
    keepId: null,
    archiveIds: [],
    reason: "teacher_assignment active avec références non canoniques",
  }));

  const autoArchiveIds = [
    ...new Set(
      duplicateProposals
        .filter((item) => item.action === "archive_duplicates")
        .flatMap((item) => item.archiveIds),
    ),
  ];

  return {
    duplicateProposals,
    assignmentProposals,
    nullTeacherProposals,
    nonCanonicalProposals,
    autoArchiveIds,
    repairableBindTeacher: nullTeacherProposals.length > 0,
    needsHuman:
      duplicateProposals.some((item) => item.action === "needs_human") ||
      assignmentProposals.length > 0 ||
      nonCanonicalProposals.length > 0,
  };
}

function buildInventoryReport({
  uniqueIndex = null,
  duplicateGroups = [],
  duplicateRows = [],
  assignmentCollisions = [],
  nonCanonicalAssignments = [],
  nullTeacherRepairable = [],
  dependencyCounts = [],
} = {}) {
  const rowsByKey = new Map();
  for (const row of duplicateRows) {
    const key = groupKey(row);
    if (!rowsByKey.has(key)) rowsByKey.set(key, []);
    rowsByKey.get(key).push(row);
  }

  const groups = duplicateGroups.map((group) => {
    const key = groupKey(group);
    return {
      key,
      school_id: group.school_id,
      school_code: group.school_code,
      class_id: group.class_id,
      class_code: group.class_code,
      class_name: group.class_name,
      subject_id: group.subject_id,
      subject_code: group.subject_code,
      subject_name: group.subject_name,
      active_count: Number(group.active_count ?? 0),
      school_course_ids: group.school_course_ids,
      rows: rowsByKey.get(key) ?? [],
    };
  });

  const repairableCourseIds = new Set(
    (nullTeacherRepairable ?? []).map((row) => String(row.school_course_id)),
  );
  const classifiedCollisions = (assignmentCollisions ?? []).map((row) => ({
    ...row,
    collisionKind: classifyAssignmentCollision(row, repairableCourseIds),
  }));

  const inventory = {
    uniqueIndex: {
      name: UNIQUE_INDEX_NAME,
      present: Boolean(uniqueIndex?.indexname),
      definition: uniqueIndex?.indexdef ?? null,
    },
    duplicateGroups: groups,
    duplicateRows,
    assignmentCollisions: classifiedCollisions,
    nonCanonicalAssignments,
    nullTeacherRepairable,
    dependencyCounts,
  };
  inventory.proposal = proposeRepair(inventory);
  inventory.summary = summarizeInventory(inventory);

  const blocking =
    groups.length > 0 ||
    classifiedCollisions.length > 0 ||
    nonCanonicalAssignments.length > 0;

  inventory.code = blocking ? CANONICAL_SCHOOL_COURSE_AMBIGUOUS : SCHOOL_COURSE_AMBIGUITY_OK;
  inventory.blocksBoot = blocking;
  inventory.diagnostic = formatDiagnostic(inventory);
  return inventory;
}

function summarizeInventory(inventory) {
  const collisions = inventory.assignmentCollisions ?? [];
  const byKind = {
    null_teacher_repairable: collisions.filter((row) => row.collisionKind === "null_teacher_repairable").length,
    null_teacher_ambiguous: collisions.filter((row) => row.collisionKind === "null_teacher_ambiguous").length,
    other_teacher: collisions.filter((row) => row.collisionKind === "other_teacher").length,
    duplicate_active: collisions.filter((row) => row.collisionKind === "duplicate_active").length,
  };
  const schools = new Set(
    [
      ...(inventory.duplicateGroups ?? []).map((group) => group.school_code),
      ...collisions.map((row) => row.school_code),
      ...(inventory.nonCanonicalAssignments ?? []).map((row) => row.school_code),
      ...(inventory.nullTeacherRepairable ?? []).map((row) => row.school_code),
    ].filter(Boolean),
  );
  const deps = inventory.dependencyCounts ?? [];
  const sum = (key) => deps.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  return {
    schoolCount: schools.size,
    schoolCodes: [...schools].sort(),
    duplicateGroupCount: inventory.duplicateGroups?.length ?? 0,
    assignmentCollisionCount: collisions.length,
    nonCanonicalAssignmentCount: inventory.nonCanonicalAssignments?.length ?? 0,
    nullTeacherRepairableCount: inventory.nullTeacherRepairable?.length ?? 0,
    collisionKindCounts: byKind,
    dependencyTotals: {
      collidingCourseCount: deps.length,
      weeklySlots: sum("weekly_slot_count"),
      datedSlots: sum("dated_slot_count"),
      activeAssignments: sum("active_assignment_count"),
      evaluations: sum("evaluation_count"),
      grades: sum("grade_count"),
      reportCards: sum("report_card_count"),
    },
  };
}

function formatDiagnostic(inventory) {
  const dup = inventory.duplicateGroups?.length ?? 0;
  const assign = inventory.assignmentCollisions?.length ?? 0;
  const refs = inventory.nonCanonicalAssignments?.length ?? 0;
  const index = inventory.uniqueIndex?.present ? "présent" : "absent";
  if (!inventory.blocksBoot) {
    return (
      `school_courses : 0 collision boot (doublons actifs=0, affectation vs autre enseignant=0, ` +
      `refs non canoniques=0). Index ${UNIQUE_INDEX_NAME}=${index}.`
    );
  }
  const samples = (inventory.duplicateGroups ?? [])
    .slice(0, 8)
    .map(
      (group) =>
        `${group.school_code}/${group.class_code}+${group.subject_code}×${group.active_count}`,
    )
    .join("; ");
  const assignmentSamples = (inventory.assignmentCollisions ?? [])
    .slice(0, 8)
    .map(
      (row) =>
        `${row.school_code}/${row.class_code}+${row.subject_code} assignment=${row.assignment_teacher_code} course=${row.course_teacher_code}`,
    )
    .join("; ");
  const kinds = inventory.summary?.collisionKindCounts ?? {};
  const nullRepairable = inventory.summary?.nullTeacherRepairableCount ?? 0;
  return (
    `CANONICAL_SCHOOL_COURSE_AMBIGUOUS — index ${UNIQUE_INDEX_NAME}=${index} ; ` +
    `doublons actifs=${dup}${samples ? ` [${samples}]` : ""} ; ` +
    `collisions affectation/cours=${assign}${assignmentSamples ? ` [${assignmentSamples}]` : ""} ; ` +
    `teacher_id NULL réparables=${nullRepairable} ; ` +
    `autre enseignant=${kinds.other_teacher ?? 0} ; ` +
    `affectations non canoniques=${refs}. ` +
    `Fail-closed : aucun choix silencieux. Inventaire read-only.`
  );
}

async function inventorySchoolCourseAmbiguity(db) {
  const indexRow = await db.one(CHECK_UNIQUE_INDEX_SQL, [UNIQUE_INDEX_NAME]);
  const weeklyRow = await db.one(CHECK_WEEKLY_TABLE_SQL);
  const weeklyPresent = Boolean(weeklyRow?.present);
  const tables = (await db.one(CHECK_DEPENDENCY_TABLES_SQL)) ?? {};
  const duplicateGroups = await db.all(SELECT_DUPLICATE_ACTIVE_GROUPS_SQL);
  const duplicateRows = await db.all(
    weeklyPresent ? SELECT_DUPLICATE_ACTIVE_ROWS_WITH_WEEKLY_SQL : SELECT_DUPLICATE_ACTIVE_ROWS_SQL,
  );
  const assignmentCollisions = await db.all(SELECT_ASSIGNMENT_CLASS_SUBJECT_COLLISIONS_SQL);
  const nonCanonicalAssignments = await db.all(SELECT_NON_CANONICAL_ASSIGNMENTS_SQL);
  const nullTeacherRepairable = await db.all(SELECT_NULL_TEACHER_REPAIRABLE_SQL);
  const dependencyCounts = await db.all(SELECT_COLLISION_DEPENDENCY_COUNTS_FULL_SQL, [
    Boolean(tables.weekly_present),
    Boolean(tables.dated_slots_present),
    Boolean(tables.evaluations_present),
    Boolean(tables.grades_present),
    Boolean(tables.report_cards_present),
  ]);
  return buildInventoryReport({
    uniqueIndex: indexRow,
    duplicateGroups,
    duplicateRows,
    assignmentCollisions,
    nonCanonicalAssignments,
    nullTeacherRepairable,
    dependencyCounts,
  });
}

module.exports = {
  CANONICAL_SCHOOL_COURSE_AMBIGUOUS,
  SCHOOL_COURSE_AMBIGUITY_OK,
  UNIQUE_INDEX_NAME,
  WRITE_FLAG_ARGS,
  ALL_INVENTORY_SQL,
  CHECK_UNIQUE_INDEX_SQL,
  CHECK_WEEKLY_TABLE_SQL,
  CHECK_DEPENDENCY_TABLES_SQL,
  SELECT_DUPLICATE_ACTIVE_GROUPS_SQL,
  SELECT_DUPLICATE_ACTIVE_ROWS_SQL,
  SELECT_DUPLICATE_ACTIVE_ROWS_WITH_WEEKLY_SQL,
  SELECT_ASSIGNMENT_CLASS_SUBJECT_COLLISIONS_SQL,
  SELECT_NON_CANONICAL_ASSIGNMENTS_SQL,
  SELECT_NULL_TEACHER_REPAIRABLE_SQL,
  SELECT_COLLISION_DEPENDENCY_COUNTS_SQL,
  SELECT_COLLISION_DEPENDENCY_COUNTS_FULL_SQL,
  assertSelectOnlySql,
  assertInventorySqlIsSelectOnly,
  assertNoWriteFlags,
  groupKey,
  classifyAssignmentCollision,
  proposeDuplicateGroupRepair,
  proposeRepair,
  buildInventoryReport,
  summarizeInventory,
  formatDiagnostic,
  inventorySchoolCourseAmbiguity,
};
