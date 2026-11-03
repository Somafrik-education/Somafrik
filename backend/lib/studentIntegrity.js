"use strict";

/**
 * STUDENT-INTEGRITY-01 — lecture seule.
 * Un élève affiché comme actif doit exister dans le référentiel de son établissement.
 * Sans inscription active, aucune nouvelle opération n'est proposée.
 * Les écritures historiques et financières restent consultables.
 */

const ACTIVE_ENROLLMENT = new Set(["active", "enrolled"]);
const ARCHIVED_STUDENT = new Set(["archived", "inactive", "deleted", "transferred", "sorti"]);
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIAGNOSTIC_PERMISSIONS = new Set([
  "Impayés:READ",
  "Paiements:READ",
  "Gérer paiements",
  "Voir rapports financiers",
  "ALL_PRIVILEGES",
]);

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase();
}

function verifiedCanonicalUuid(...values) {
  for (const value of values) {
    const text = asText(value);
    if (CANONICAL_UUID.test(text)) return text;
  }
  return "";
}

/**
 * Fail-closed : seule une inscription explicitement active ou enrolled est vérifiée.
 * Absent, null, vide ou statut inconnu ne devient jamais une inscription active.
 */
function enrollmentIsActive(input = {}) {
  if (input.hasActiveEnrollment === true) return true;
  if (input.hasActiveEnrollment === false || input.hasActiveEnrollment === null) return false;
  const status = normalizeToken(input.enrollmentStatus);
  if (!status) return false;
  return ACTIVE_ENROLLMENT.has(status);
}

/**
 * @param {object} input
 * @returns {{
 *   category: "missing" | "orphan_finance" | "school_mismatch" | "archived" | "no_active_enrollment" | "unverified_identity" | "identity_mismatch" | "active",
 *   collectionEligible: boolean,
 *   historyVisible: boolean,
 * }}
 */
function classifyStudentIntegrity(input = {}) {
  const financeRowExists = input.financeRowExists === true;
  const archived = input.archived === true || ARCHIVED_STUDENT.has(normalizeToken(input.studentStatus));
  const schoolMismatch = input.schoolMismatch === true;
  const activeEnrollment = enrollmentIsActive(input);
  const displayed = asText(input.displayedStudentId);
  const uuid = verifiedCanonicalUuid(input.studentUuid);
  const matricule = asText(input.matricule);
  const studentExists = input.studentExists === true && Boolean(uuid);
  const identityMismatch = Boolean(
    displayed &&
      displayed !== uuid &&
      displayed !== matricule,
  );

  if (!uuid) {
    if (financeRowExists) {
      return {
        category: matricule ? "unverified_identity" : "orphan_finance",
        collectionEligible: false,
        historyVisible: true,
      };
    }
    return { category: "missing", collectionEligible: false, historyVisible: false };
  }
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
  if (activeEnrollment !== true) {
    return { category: "no_active_enrollment", collectionEligible: false, historyVisible: true };
  }
  if (identityMismatch) {
    return { category: "identity_mismatch", collectionEligible: true, historyVisible: true };
  }
  return { category: "active", collectionEligible: true, historyVisible: true };
}

/**
 * UUID canonique, ou identifiant interne distinct du matricule.
 * Un matricule seul, ou recopié dans dbId, n'est pas une identité vérifiée.
 */
function resolveCanonicalStudentDbId(student = {}) {
  const uuid = verifiedCanonicalUuid(student.dbId);
  if (uuid) return uuid;
  const dbId = asText(student.dbId);
  const matricule = asText(student.studentCode || student.matricule || student.publicId);
  if (!dbId || (matricule && dbId === matricule)) return "";
  return dbId;
}

function readOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === 1 || value === "t" || value === "true") return true;
  if (value === false || value === 0 || value === "f" || value === "false") return false;
  return undefined;
}

function enrollmentSignal(value) {
  if (value === null) return null;
  return readOptionalBoolean(value);
}

function classifyUnpaidFees(fees, displayedStudentId) {
  const list = Array.isArray(fees) ? fees : [];
  const primary = list[0] ?? {};
  const canonicalStudentId = verifiedCanonicalUuid(primary.canonicalStudentId, primary.studentDbId);
  const matricule = asText(primary.studentCode || primary.matricule);
  const signals = list.map((fee) => enrollmentSignal(fee.hasActiveEnrollment));
  const explicitTrue = signals.some((value) => value === true);
  const explicitNegative = signals.some((value) => value === false || value === null);
  const hasActiveEnrollment = explicitTrue ? true : explicitNegative ? false : undefined;
  const studentStatus = asText(primary.studentStatus);
  const explicitOrphan = list.some(
    (fee) => fee.orphanFinance === true || fee.studentDbId === "" || fee.canonicalStudentId === "",
  );
  const explicitMissing = list.some((fee) => fee.studentExists === false);
  return {
    canonicalStudentId,
    matricule: matricule || undefined,
    ...classifyStudentIntegrity({
      studentExists: !explicitMissing && !explicitOrphan && Boolean(canonicalStudentId),
      financeRowExists: list.length > 0,
      studentUuid: canonicalStudentId,
      matricule,
      displayedStudentId,
      studentStatus,
      archived: primary.archived === true,
      hasActiveEnrollment,
      enrollmentStatus: primary.enrollmentStatus,
      schoolMismatch: list.some((fee) => fee.schoolMismatch === true),
    }),
  };
}

const INTEGRITY_COUNT_SQL = `
SELECT COALESCE(NULLIF(btrim(s.school_code), ''), 'UNKNOWN') AS school_code,
       anomaly.category,
       COUNT(*)::int AS count
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
LEFT JOIN schools s ON s.id = anomaly.school_id
GROUP BY COALESCE(NULLIF(btrim(s.school_code), ''), 'UNKNOWN'), anomaly.category
ORDER BY 1, anomaly.category
`;

const ORPHAN_OBLIGATION_SQL = `
SELECT o.id::text AS obligation_id,
       COALESCE(NULLIF(btrim(s.school_code), ''), '') AS school_code,
       o.student_id::text AS student_id,
       o.balance,
       o.currency,
       o.status
FROM student_fee_obligations o
LEFT JOIN students st ON st.id = o.student_id
LEFT JOIN schools s ON s.id = o.school_id
WHERE st.id IS NULL
ORDER BY s.school_code NULLS LAST, o.id
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

function canReadStudentIntegrityDiagnostic(principal) {
  const permissions = new Set(principal?.permissions ?? []);
  for (const permission of DIAGNOSTIC_PERMISSIONS) {
    if (permissions.has(permission)) return true;
  }
  return false;
}

function diagnosticAccessDecision(principal) {
  if (!principal) return { allowed: true, operator: true };
  if (canReadStudentIntegrityDiagnostic(principal)) return { allowed: true, operator: false };
  return { allowed: false, operator: false };
}

function projectOrphanObligations(rows = []) {
  return rows.map((row) => ({
    obligationId: asText(row.obligation_id || row.obligationId),
    schoolCode: asText(row.school_code || row.schoolCode),
    studentId: asText(row.student_id || row.studentId),
    balance: Number(row.balance) || 0,
    currency: asText(row.currency),
    status: asText(row.status),
  }));
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
  verifiedCanonicalUuid,
  resolveCanonicalStudentDbId,
  readOptionalBoolean,
  summarizeIntegrityCounts,
  canReadStudentIntegrityDiagnostic,
  diagnosticAccessDecision,
  projectOrphanObligations,
  assertReadOnlySql,
  INTEGRITY_COUNT_SQL,
  ORPHAN_OBLIGATION_SQL,
  STUDENT_DIAGNOSIS_SQL,
};
