"use strict";

/**
 * Audit non destructif : comptes users liés à la fois à un élève actif et un enseignant actif.
 * Lecture seule. Aucun UPDATE/DELETE/INSERT métier.
 *
 *   node backend/scripts/audit-student-teacher-dual-profiles.js
 *   DATABASE_URL=... node backend/scripts/audit-student-teacher-dual-profiles.js
 *
 * Refuse --apply / --write / --fix. Les doublons existants restent à arbitrer hors production auto.
 */

const fs = require("node:fs");
const path = require("node:path");

const FORBIDDEN_FLAGS = new Set(["--apply", "--write", "--fix", "--mutate", "--delete"]);

const AUDIT_SQL = `
SELECT
  u.id AS user_id,
  s.school_code,
  u.user_code,
  u.identity_code,
  u.login_code,
  u.first_name,
  u.last_name,
  st.id AS student_id,
  st.student_code,
  st.status AS student_status,
  t.id AS teacher_id,
  t.teacher_code,
  t.status AS teacher_status
FROM users u
JOIN schools s ON s.id = u.school_id
JOIN students st
  ON st.school_id = u.school_id
 AND (
   st.student_code = u.user_code
   OR st.student_code = u.identity_code
   OR st.student_code = u.login_code
 )
JOIN teachers t
  ON t.school_id = u.school_id
 AND t.user_id = u.id
WHERE COALESCE(st.status, 'active') NOT IN ('inactive', 'deleted', 'archived', 'closed', 'transferred')
  AND COALESCE(t.status, 'active') NOT IN ('inactive', 'deleted', 'archived')
ORDER BY s.school_code, u.identity_code, u.user_code
`;

function assertReadOnlySource() {
  const src = fs.readFileSync(__filename, "utf8");
  assertDoesNotWrite(src);
  const sqlFile = fs.readFileSync(
    path.join(__dirname, "../db/migrations/20260906_business_profile_exclusivity.sql"),
    "utf8",
  );
  if (/UPDATE\s+students|DELETE\s+FROM\s+students|UPDATE\s+teachers|DELETE\s+FROM\s+teachers/i.test(sqlFile)) {
    throw new Error("la migration d'exclusivité ne doit pas réécrire les profils existants");
  }
}

function assertDoesNotWrite(src) {
  if (/\b(UPDATE|DELETE|INSERT)\s+(INTO\s+)?(students|teachers|users|user_roles)\b/i.test(src.replace(AUDIT_SQL, ""))) {
    throw new Error("le script d'audit ne doit pas écrire students/teachers/users/user_roles");
  }
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

async function runAudit(executor) {
  const result = await executor.query(AUDIT_SQL);
  const rows = result.rows ?? result ?? [];
  return {
    generatedAt: new Date().toISOString(),
    dualProfileCount: rows.length,
    rows,
    productionWrites: false,
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
          dualProfileCount: null,
          productionWrites: false,
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
    const report = await runAudit(pool);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(error.code === "AUDIT_WRITE_FORBIDDEN" ? 2 : 1);
  });
}

module.exports = {
  AUDIT_SQL,
  parseArgs,
  runAudit,
  assertReadOnlySource,
};
