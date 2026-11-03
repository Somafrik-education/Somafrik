"use strict";

/**
 * STUDENT-INTEGRITY-01 — lecture seule.
 * Un élève affiché comme actif doit exister dans le référentiel de son établissement.
 * Sans inscription active, aucune nouvelle opération n'est proposée.
 * Les écritures historiques et financières restent consultables.
 */

const ACTIVE_ENROLLMENT = new Set(["active", "enrolled"]);
const ARCHIVED_STUDENT = new Set(["archived", "inactive", "deleted", "transferred", "sorti"]);

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase();
}

function enrollmentIsActive(input) {
  if (input.hasActiveEnrollment === true) return true;
  if (input.hasActiveEnrollment === false) return false;
  const status = normalizeToken(input.enrollmentStatus);
  if (!status) return null;
  return ACTIVE_ENROLLMENT.has(status);
}

/**
 * @param {object} input
 * @returns {{
 *   category: "missing" | "orphan_finance" | "school_mismatch" | "archived" | "no_active_enrollment" | "identity_mismatch" | "active",
 *   collectionEligible: boolean,
 *   historyVisible: boolean,
 * }}
 */
function classifyStudentIntegrity(input = {}) {
  const financeRowExists = input.financeRowExists === true;
  const studentExists = input.studentExists === true;
  const archived = input.archived === true || ARCHIVED_STUDENT.has(normalizeToken(input.studentStatus));
  const schoolMismatch = input.schoolMismatch === true;
  const activeEnrollment = enrollmentIsActive(input);
  const displayed = asText(input.displayedStudentId);
  const uuid = asText(input.studentUuid);
  const matricule = asText(input.matricule);
  const identityMismatch = Boolean(
    studentExists &&
      displayed &&
      (uuid || matricule) &&
      displayed !== uuid &&
      displayed !== matricule,
  );

  if (!studentExists && financeRowExists) {
    return { category: "orphan_finance", collectionEligible: false, historyVisible: true };
  }
  if (!studentExists) {
    return { category: "missing", collectionEligible: false, historyVisible: false };
  }
  if (schoolMismatch) {
    return { category: "school_mismatch", collectionEligible: false, historyVisible: true };
  }
  if (archived) {
    return { category: "archived", collectionEligible: false, historyVisible: true };
  }
  if (activeEnrollment === false) {
    return { category: "no_active_enrollment", collectionEligible: false, historyVisible: true };
  }
  if (identityMismatch) {
    return { category: "identity_mismatch", collectionEligible: true, historyVisible: true };
  }
  return { category: "active", collectionEligible: true, historyVisible: true };
}

function readOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === 1 || value === "t" || value === "true") return true;
  if (value === false || value === 0 || value === "f" || value === "false") return false;
  return undefined;
}

function classifyUnpaidFees(fees, displayedStudentId) {
  const list = Array.isArray(fees) ? fees : [];
  const primary = list[0] ?? {};
  const canonicalStudentId = asText(primary.canonicalStudentId || primary.studentDbId);
  const matricule = asText(primary.studentCode || primary.matricule);
  const flags = list
    .map((fee) => readOptionalBoolean(fee.hasActiveEnrollment))
    .filter((value) => value !== undefined);
  const hasActiveEnrollment = flags.length ? flags.some(Boolean) : undefined;
  const studentStatus = asText(primary.studentStatus);
  const explicitMissing = list.some((fee) => fee.studentExists === false || fee.orphanFinance === true);
  return {
    canonicalStudentId: canonicalStudentId || asText(displayedStudentId),
    matricule: matricule || undefined,
    ...classifyStudentIntegrity({
      studentExists: explicitMissing ? false : true,
      financeRowExists: list.length > 0,
      studentUuid: canonicalStudentId,
      matricule,
      displayedStudentId,
      studentStatus,
      archived: primary.archived === true,
      hasActiveEnrollment,
      schoolMismatch: primary.schoolMismatch === true,
    }),
  };
}

const INTEGRITY_COUNT_SQL = `
SELECT s.school_code AS school_code, anomaly.category, COUNT(*)::int AS count
FROM (
  SELECT o.school_id, 'orphan_finance'::text AS category
  FROM student_fee_obligations o
  LEFT JOIN students st ON st.id = o.student_id
  WHERE st.id IS NULL
  UNION ALL
  SELECT o.school_id, 'school_mismatch'
  FROM student_fee_obligations o
  JOIN students st ON st.id = o.student_id
  WHERE o.school_id IS DISTINCT FROM st.school_id
  UNION ALL
  SELECT st.school_id, 'archived'
  FROM students st
  WHERE lower(btrim(COALESCE(st.status, ''))) IN ('archived', 'inactive', 'deleted', 'transferred', 'sorti')
  UNION ALL
  SELECT st.school_id, 'no_active_enrollment'
  FROM students st
  WHERE lower(btrim(COALESCE(st.status, 'active'))) NOT IN ('archived', 'inactive', 'deleted', 'transferred', 'sorti')
    AND NOT EXISTS (
      SELECT 1 FROM enrollments e
      WHERE e.student_id = st.id
        AND e.school_id = st.school_id
        AND lower(btrim(e.status)) IN ('active', 'enrolled')
    )
    AND EXISTS (
      SELECT 1 FROM student_fee_obligations o
      WHERE o.student_id = st.id AND o.school_id = st.school_id AND COALESCE(o.balance, 0) > 0
    )
  UNION ALL
  SELECT st.school_id, 'identity_mismatch'
  FROM students st
  JOIN student_fee_obligations o ON o.student_id = st.id AND o.school_id = st.school_id
  WHERE NULLIF(btrim(o.profile_payload->>'studentId'), '') IS NOT NULL
    AND btrim(o.profile_payload->>'studentId') <> st.id::text
    AND btrim(o.profile_payload->>'studentId') <> btrim(st.student_code)
) anomaly
JOIN schools s ON s.id = anomaly.school_id
GROUP BY s.school_code, anomaly.category
ORDER BY s.school_code, anomaly.category
`;

const STUDENT_DIAGNOSIS_SQL = `
SELECT st.id::text AS student_uuid,
       s.school_code,
       st.status AS student_status,
       COALESCE(
         json_agg(
           DISTINCT jsonb_build_object(
             'enrollmentStatus', e.status,
             'classCode', cl.class_code,
             'academicYear', ay.name
           )
         ) FILTER (WHERE e.id IS NOT NULL),
         '[]'::json
       ) AS enrollments,
       COUNT(DISTINCT o.id)::int AS obligation_count,
       COUNT(DISTINCT o.id) FILTER (WHERE COALESCE(o.balance, 0) > 0)::int AS open_obligation_count,
       COUNT(DISTINCT p.id)::int AS payment_count,
       BOOL_OR(
         NULLIF(btrim(o.profile_payload->>'studentId'), '') IS NOT NULL
         AND btrim(o.profile_payload->>'studentId') <> st.id::text
         AND btrim(o.profile_payload->>'studentId') <> btrim(st.student_code)
       ) AS identity_mismatch
FROM students st
JOIN schools s ON s.id = st.school_id
LEFT JOIN enrollments e ON e.student_id = st.id AND e.school_id = st.school_id
LEFT JOIN classes cl ON cl.id = e.class_id
LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
LEFT JOIN student_fee_obligations o ON o.student_id = st.id AND o.school_id = st.school_id
LEFT JOIN payments p ON p.student_id = st.id AND p.school_id = st.school_id
WHERE st.student_code = $1
GROUP BY st.id, s.school_code, st.status
`;

function summarizeIntegrityCounts(rows = []) {
  const schools = {};
  const totals = {};
  for (const row of rows) {
    const schoolCode = asText(row.school_code || row.schoolCode) || "UNKNOWN";
    const category = asText(row.category) || "unknown";
    const count = Number(row.count) || 0;
    schools[schoolCode] ??= {};
    schools[schoolCode][category] = (schools[schoolCode][category] || 0) + count;
    totals[category] = (totals[category] || 0) + count;
  }
  return { schools, totals };
}

function assertReadOnlySql(sql) {
  const body = String(sql || "");
  if (!/^\s*(SELECT|WITH)\b/i.test(body)) {
    throw new Error("STUDENT_INTEGRITY_SQL_NOT_SELECT");
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|COPY)\b/i.test(body)) {
    throw new Error("STUDENT_INTEGRITY_SQL_NOT_READONLY");
  }
  if (/\b(first_name|last_name|parent_phone|parent_email)\b/i.test(body)) {
    throw new Error("STUDENT_INTEGRITY_SQL_PII");
  }
}

module.exports = {
  classifyStudentIntegrity,
  classifyUnpaidFees,
  readOptionalBoolean,
  summarizeIntegrityCounts,
  assertReadOnlySql,
  INTEGRITY_COUNT_SQL,
  STUDENT_DIAGNOSIS_SQL,
};
