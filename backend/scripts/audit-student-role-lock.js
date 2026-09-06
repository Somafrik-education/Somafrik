"use strict";

/**
 * Audit lecture seule : students.user_id lié + rôles actifs ≠ STUDENT uniquement.
 * Aucun UPDATE/DELETE/INSERT métier. Refuse --apply / --write / --fix.
 *
 *   node backend/scripts/audit-student-role-lock.js
 *   DATABASE_URL=... node backend/scripts/audit-student-role-lock.js
 */

const fs = require("node:fs");
const path = require("node:path");

const FORBIDDEN_FLAGS = new Set(["--apply", "--write", "--fix", "--mutate", "--delete"]);

const AUDIT_SQL = `
WITH linked AS (
  SELECT
    st.user_id,
    st.id AS student_id,
    st.student_code,
    st.status AS student_status,
    st.school_id
  FROM students st
  WHERE st.user_id IS NOT NULL
    AND COALESCE(st.status, 'active') NOT IN ('inactive', 'deleted', 'archived', 'closed', 'transferred')
),
roles AS (
  SELECT
    ur.user_id,
    array_agg(ur.role_key ORDER BY ur.role_key) FILTER (WHERE ur.status = 'active' AND ur.revoked_at IS NULL) AS role_keys
  FROM user_roles ur
  WHERE ur.status = 'active' AND ur.revoked_at IS NULL
  GROUP BY ur.user_id
)
SELECT
  s.school_code,
  u.id AS user_id,
  u.user_code,
  NULLIF(to_jsonb(u)->>'identity_code', '') AS identity_code,
  NULLIF(to_jsonb(u)->>'login_code', '') AS login_code,
  u.first_name,
  u.last_name,
  l.student_id,
  l.student_code,
  l.student_status,
  COALESCE(r.role_keys, ARRAY[]::text[]) AS role_keys,
  CASE
    WHEN r.role_keys IS NULL OR cardinality(r.role_keys) = 0 THEN 'missing_student'
    WHEN NOT ('STUDENT' = ANY (r.role_keys)) THEN 'missing_student'
    ELSE 'extra_roles'
  END AS anomaly_kind
FROM linked l
JOIN users u ON u.id = l.user_id
JOIN schools s ON s.id = u.school_id
LEFT JOIN roles r ON r.user_id = u.id
WHERE r.role_keys IS NULL
   OR cardinality(r.role_keys) = 0
   OR NOT ('STUDENT' = ANY (r.role_keys))
   OR cardinality(r.role_keys) <> 1
   OR EXISTS (
     SELECT 1
     FROM unnest(COALESCE(r.role_keys, ARRAY[]::text[])) AS role_key
     WHERE role_key <> 'STUDENT'
   )
ORDER BY s.school_code, u.user_code, l.student_code
`;

function assertDoesNotWrite(src) {
  const stripped = src.replace(AUDIT_SQL, "");
  if (/\b(UPDATE|DELETE|INSERT)\s+(INTO\s+)?(students|teachers|users|user_roles)\b/i.test(stripped)) {
    throw new Error("le script d'audit ne doit pas écrire students/teachers/users/user_roles");
  }
}

function assertReadOnlySource() {
  const src = fs.readFileSync(__filename, "utf8");
  assertDoesNotWrite(src);
}

function parseArgs(argv) {
  const forbidden = argv.filter((arg) => FORBIDDEN_FLAGS.has(String(arg).trim().toLowerCase()));
  if (forbidden.length) {
    const error = new Error(
      `Écriture interdite (${forbidden.join(", ")}). Ce script est un audit en lecture seule.`,
    );
    error.code = "AUDIT_WRITE_FORBIDDEN";
    throw error;
  }
}

function extraRoleFlags(roleKeys = []) {
  const keys = new Set((roleKeys ?? []).map((key) => String(key ?? "").trim().toUpperCase()).filter(Boolean));
  return {
    hasDirector: keys.has("PRINCIPAL") || keys.has("PROVISEUR") || keys.has("DIRECTEUR"),
    hasTeacher: keys.has("TEACHER"),
    hasSchoolAdmin: keys.has("SCHOOL_ADMIN"),
    hasNonStudent: [...keys].some((key) => key !== "STUDENT"),
    missingStudent: !keys.has("STUDENT"),
  };
}

function summarize(rows = []) {
  const bySchool = new Map();
  for (const row of rows) {
    const school = String(row.school_code ?? "").trim() || "(sans école)";
    const current = bySchool.get(school) || {
      schoolCode: school,
      total: 0,
      missingStudent: 0,
      extraRoles: 0,
      director: 0,
      teacher: 0,
      schoolAdmin: 0,
    };
    const flags = extraRoleFlags(row.role_keys);
    current.total += 1;
    if (flags.missingStudent) current.missingStudent += 1;
    if (flags.hasNonStudent) current.extraRoles += 1;
    if (flags.hasDirector) current.director += 1;
    if (flags.hasTeacher) current.teacher += 1;
    if (flags.hasSchoolAdmin) current.schoolAdmin += 1;
    bySchool.set(school, current);
  }
  return {
    anomalyCount: rows.length,
    bySchool: [...bySchool.values()].sort((a, b) => a.schoolCode.localeCompare(b.schoolCode)),
  };
}

async function runAudit(executor) {
  const result = await executor.query(AUDIT_SQL);
  const rows = result.rows ?? result ?? [];
  return {
    generatedAt: new Date().toISOString(),
    productionWrites: false,
    proof: "students.user_id",
    ...summarize(rows),
    rows,
  };
}

async function main() {
  parseArgs(process.argv.slice(2));
  assertReadOnlySource();

  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          skipped: true,
          reason: "DATABASE_URL absent — aucun accès production, audit SQL prêt.",
          anomalyCount: null,
          productionWrites: false,
          proof: "students.user_id",
          sql: AUDIT_SQL.trim(),
        },
        null,
        2,
      ),
    );
    return;
  }

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const probe = await pool.query("SELECT to_regclass('public.students') AS rel");
    if (!probe.rows[0]?.rel) {
      console.log(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            skipped: true,
            reason: "schéma students absent",
            anomalyCount: 0,
            productionWrites: false,
          },
          null,
          2,
        ),
      );
      return;
    }
    const report = await runAudit(pool);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

module.exports = {
  AUDIT_SQL,
  parseArgs,
  assertReadOnlySource,
  extraRoleFlags,
  summarize,
  runAudit,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
