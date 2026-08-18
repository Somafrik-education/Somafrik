"use strict";

/**
 * Backfill opt-in des matricules élèves vers la règle générale :
 * {ISO}-{ETAB}-{INITIALES_ELEVE}-{YY}-{SEQ5}.
 * Exemple : CD-IN-EL-26-001 -> CD-IN-OHS-26-00001.
 *
 * Dry-run par défaut. Application explicite uniquement avec --apply
 * ou SOMAFRIK_STUDENT_GENERAL_IDENTITY_BACKFILL=1.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const {
  STUDENT_GENERAL_IDENTITY_SQL,
} = require("../db/studentGeneralIdentityPg");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const APPLY =
  process.argv.includes("--apply") ||
  String(process.env.SOMAFRIK_STUDENT_GENERAL_IDENTITY_BACKFILL ?? "") === "1";
const CANONICAL_RE = "^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$";
const BACKFILL_SQL = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260827_student_general_identity_backfill.sql"),
  "utf8",
);

async function inventory(pool) {
  const result = await pool.query(
    `SELECT st.id, st.student_code, st.login_code, st.identity_code,
            st.first_name, st.last_name, s.school_code
     FROM students st
     JOIN schools s ON s.id = st.school_id
     WHERE st.student_code !~ $1
        OR st.login_code IS DISTINCT FROM st.student_code
        OR st.identity_code IS DISTINCT FROM st.student_code
     ORDER BY st.created_at NULLS LAST, st.student_code`,
    [CANONICAL_RE],
  );
  return result.rows;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("backfill-student-general-identity: SKIP (DATABASE_URL absent)");
    return;
  }
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const before = await inventory(pool);
    console.log(`Élèves à convertir : ${before.length}`);
    for (const row of before.slice(0, 20)) {
      console.log(`  ${row.school_code} ${row.student_code} ${row.last_name} ${row.first_name}`);
    }

    if (!APPLY) {
      console.log("Dry-run. Aucune écriture.");
      console.log("Pour appliquer : --apply ou SOMAFRIK_STUDENT_GENERAL_IDENTITY_BACKFILL=1");
      return;
    }

    // Installe d'abord le contrat nouveau-format et ses fonctions PostgreSQL.
    await pool.query(STUDENT_GENERAL_IDENTITY_SQL);
    await pool.query(BACKFILL_SQL);

    const after = await inventory(pool);
    if (after.length) {
      throw new Error(`STUDENT_GENERAL_IDENTITY_BACKFILL_INCOMPLETE: ${after.length} ligne(s)`);
    }
    console.log("Backfill identifiants élèves : OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
