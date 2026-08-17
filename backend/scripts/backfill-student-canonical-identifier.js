"use strict";

/**
 * Backfill opt-in des matricules élèves legacy → CD-IN-EL-26-001.
 *
 * Dry-run (défaut) : inventaire, aucune écriture.
 * Apply : --apply  OU  SOMAFRIK_STUDENT_CANONICAL_BACKFILL=1
 *
 * Fail-safe : refuse si un namespace dépasserait 999, refuse de valider
 * s'il reste des lignes non canoniques (contrôles dans le SQL).
 */
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const APPLY =
  process.argv.includes("--apply") || String(process.env.SOMAFRIK_STUDENT_CANONICAL_BACKFILL ?? "") === "1";
const CANONICAL_RE = "^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$";
const BACKFILL_SQL = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260824_student_canonical_identifier_backfill.sql"),
  "utf8",
);

async function inventory(pool) {
  const leftover = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM students
     WHERE student_code IS NULL
        OR student_code !~ $1
        OR login_code IS DISTINCT FROM student_code
        OR identity_code IS DISTINCT FROM student_code`,
    [CANONICAL_RE],
  );
  const sample = await pool.query(
    `SELECT st.id, st.student_code, st.login_code, st.identity_code, s.school_code
     FROM students st
     JOIN schools s ON s.id = st.school_id
     WHERE st.student_code IS NULL
        OR st.student_code !~ $1
        OR st.login_code IS DISTINCT FROM st.student_code
        OR st.identity_code IS DISTINCT FROM st.student_code
     ORDER BY st.created_at NULLS LAST, st.student_code
     LIMIT 20`,
    [CANONICAL_RE],
  );
  return { leftover: leftover.rows[0].count, sample: sample.rows };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("backfill-student-canonical-identifier: SKIP (DATABASE_URL absent)");
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const before = await inventory(pool);
    console.log(`Lignes élèves non canoniques : ${before.leftover}`);
    if (before.sample.length) {
      console.log("Échantillon :");
      for (const row of before.sample) {
        console.log(
          `  ${row.school_code}  student_code=${row.student_code}  login=${row.login_code}  identity=${row.identity_code}`,
        );
      }
    }

    if (!APPLY) {
      console.log("Dry-run. Aucune écriture.");
      console.log("Pour appliquer : --apply  ou  SOMAFRIK_STUDENT_CANONICAL_BACKFILL=1");
      return;
    }

    if (before.leftover === 0) {
      console.log("Rien à réécrire. Validation du CHECK uniquement.");
    }

    await pool.query(BACKFILL_SQL);

    const after = await inventory(pool);
    if (after.leftover > 0) {
      throw new Error(`STUDENT_CANONICAL_BACKFILL_INCOMPLETE: ${after.leftover} ligne(s)`);
    }
    console.log("Backfill élève canonique : OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
