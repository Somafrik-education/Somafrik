"use strict";

/**
 * Boot USER_ROLES_SCHEMA_SQL complet après un boot précédent qui a installé
 * la CHECK exacte de studentGeneralIdentityPg (SEQ5 | EL, NOT VALID).
 *
 * AVANT : 20260823 DROP + CHECK EL-only, puis 20260907 UPDATE SEQ5 → 23514.
 * APRÈS : 20260823 laisse la CHECK SEQ5, backfill user_id sans réécrire l'identité.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { USER_ROLES_SCHEMA_PARTS } = require("../db/userRolesSchema");
const { STUDENT_GENERAL_IDENTITY_SQL } = require("../db/studentGeneralIdentityPg");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(
  process.env.SOMAFRIK_STUDENT_USER_ID_BACKFILL_IT_DATABASE ?? "somafrik_student_user_id_backfill_it",
)
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureDatabase(databaseUrl, databaseName) {
  const maintenance = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenance });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function constraintDef(pool) {
  const result = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def, convalidated
     FROM pg_constraint
     WHERE conname = 'students_canonical_identifier_format_check'
       AND conrelid = 'students'::regclass`,
  );
  return result.rows[0] ?? null;
}

async function applyParts(pool, label) {
  for (const part of USER_ROLES_SCHEMA_PARTS) {
    const before = await constraintDef(pool);
    try {
      await pool.query(part.sql);
    } catch (error) {
      const after = await constraintDef(pool);
      error.message = `${label} première instruction 23514=${error.code === "23514"} file=${part.file} check_before=${before?.def ?? "ABSENT"} check_after=${after?.def ?? "ABSENT"} orig=${error.message}`;
      throw error;
    }
  }
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentUserIdBackfill.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);

    const withoutUserId = USER_ROLES_SCHEMA_PARTS.filter((part) => part.file !== "20260907_student_user_id.sql");
    for (const part of withoutUserId) {
      await pool.query(part.sql);
    }
    await pool.query(STUDENT_GENERAL_IDENTITY_SQL);

    const liveCheck = await constraintDef(pool);
    assert.ok(liveCheck, "CHECK runtime absente après studentGeneralIdentityPg");
    assert.match(liveCheck.def, /\[A-Z0-9\]\{1,5\}.*\[0-9\]\{5\}/);
    assert.match(liveCheck.def, /EL-\[0-9\]\{2\}-\[0-9\]\{3\}/);
    assert.equal(liveCheck.convalidated, false);
    console.log(`CHECK exacte pré-boot: ${liveCheck.def}`);

    const country = await pool.query(`SELECT id FROM countries LIMIT 1`);
    let countryId = country.rows[0]?.id;
    if (!countryId) {
      const inserted = await pool.query(
        `INSERT INTO countries (name, iso_code, phone_code, currency)
         VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
      );
      countryId = inserted.rows[0].id;
    }
    const school = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-BOOT-0001', 'Nuru Boot', 'active') RETURNING id`,
      [countryId],
    );
    const schoolId = school.rows[0].id;

    await pool.query("ALTER TABLE students DISABLE TRIGGER USER");
    const legacy = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, identity_code, login_code)
       VALUES ($1, 'LEGACY-STU-1', 'Awa', 'Diop', 'OLD', 'OLD') RETURNING id, student_code, identity_code, login_code`,
      [schoolId],
    );
    const canonical = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, identity_code, login_code)
       VALUES ($1, 'CD-IN-AD-26-00001', 'Esther', 'Okito', 'CD-IN-AD-26-00001', 'CD-IN-AD-26-00001')
       RETURNING id`,
      [schoolId],
    );
    await pool.query("ALTER TABLE students ENABLE TRIGGER USER");

    await pool.query("ALTER TABLE users DISABLE TRIGGER USER");
    const canonicalUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, role, status)
       VALUES ($1, 'CD-IN-AD-26-00001', 'Esther', 'Okito', 'STUDENT', 'active') RETURNING id`,
      [schoolId],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, role, status)
       VALUES ($1, 'LEGACY-STU-1', 'Awa', 'Diop', 'STUDENT', 'active')`,
      [schoolId],
    );
    await pool.query("ALTER TABLE users ENABLE TRIGGER USER");

    await applyParts(pool, "boot complet USER_ROLES_SCHEMA_SQL");

    const afterCheck = await constraintDef(pool);
    assert.match(afterCheck.def, /\[A-Z0-9\]\{1,5\}.*\[0-9\]\{5\}/, "CHECK SEQ5 ne doit pas être rétrogradée en EL-only");
    assert.equal(afterCheck.convalidated, false);

    const rows = await pool.query(
      `SELECT student_code, user_id::text AS user_id, identity_code, login_code
       FROM students WHERE id IN ($1, $2)`,
      [legacy.rows[0].id, canonical.rows[0].id],
    );
    const byCode = Object.fromEntries(rows.rows.map((row) => [row.student_code, row]));
    assert.equal(byCode["LEGACY-STU-1"].user_id, null);
    assert.equal(byCode["LEGACY-STU-1"].identity_code, "OLD");
    assert.equal(byCode["LEGACY-STU-1"].login_code, "OLD");
    assert.equal(byCode["CD-IN-AD-26-00001"].user_id, String(canonicalUser.rows[0].id));

    console.log("studentUserIdBackfill.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
