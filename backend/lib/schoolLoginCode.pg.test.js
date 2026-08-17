"use strict";

/**
 * PostgreSQL — login_code établissement, SEQ3 global par pays + année.
 *
 * Prérequis : DATABASE_URL (CI). Aucun secret/URI de secours.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { USER_ROLES_SCHEMA_SQL } = require("../db/userRolesSchema");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(
  process.env.SOMAFRIK_SCHOOL_LOGIN_SEQ_IT_DATABASE ?? "somafrik_school_login_seq_it",
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

function readMigration(name) {
  return fs.readFileSync(path.join(__dirname, "../db/migrations", name), "utf8");
}

function schemaSql() {
  return fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
}

function legacySchoolLoginSql() {
  return [
    readMigration("20260820_user_roles_canonical.sql"),
    readMigration("20260821_permanent_student_identifiers.sql"),
    readMigration("20260822_school_login_code.sql"),
  ].join("\n");
}

async function resetWith(pool, sql) {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(schemaSql());
  await pool.query(sql);
}

async function insertCountry(pool, name, iso, phone, currency) {
  const result = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [name, iso, phone, currency],
  );
  return result.rows[0].id;
}

async function insertSchool(pool, { countryId, schoolCode, name, createdAt }) {
  const result = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status, created_at)
     VALUES ($1, $2, $3, 'active', $4::timestamptz)
     RETURNING school_code, login_code, short_code, created_at`,
    [countryId, schoolCode, name, createdAt],
  );
  return result.rows[0];
}

async function loginCodes(pool) {
  const result = await pool.query(
    `SELECT school_code, name, login_code FROM schools ORDER BY created_at, school_code`,
  );
  return result.rows;
}

async function testSignificantInitials(pool) {
  await resetWith(pool, USER_ROLES_SCHEMA_SQL);
  const cases = [
    ["Institut Nuru", "IN"],
    ["Institut Supérieur de Commerce", "ISC"],
    ["Institut Superieur de Commerce", "ISC"],
    ["École Kanyosha", "EK"],
    ["Ecole Kanyosha", "EK"],
    ["Lycée Lumumba", "LL"],
    ["Institut Supérieur des Techniques Médicales", "ISTM"],
    ["Université de Kinshasa", "UK"],
    ["École Nationale d'Administration", "ENA"],
  ];
  for (const [name, expected] of cases) {
    const row = await pool.query(`SELECT somafrik_school_short_code($1) AS initials`, [name]);
    assert.equal(row.rows[0].initials, expected, `${name} → ${expected}`);
  }
  const forbidden = await pool.query(`
    SELECT
      somafrik_school_short_code('Institut Supérieur de Commerce') AS isc,
      somafrik_school_short_code('Institut Supérieur des Techniques Médicales') AS istm
  `);
  assert.notEqual(forbidden.rows[0].isc, "ISDC");
  assert.notEqual(forbidden.rows[0].istm, "ISDTC");
  assert.notEqual(forbidden.rows[0].istm, "ISDTM");
}

async function testCanonicalSequence(pool) {
  await resetWith(pool, USER_ROLES_SCHEMA_SQL);
  const cd = await insertCountry(pool, "RDC", "CD", "+243", "CDF");
  const bi = await insertCountry(pool, "Burundi", "BI", "+257", "BIF");

  const nuru = await insertSchool(pool, {
    countryId: cd,
    schoolCode: "CD-2026-0001",
    name: "Institut Nuru",
    createdAt: "2026-01-15T00:00:00Z",
  });
  assert.equal(nuru.login_code, "CD-IN-26-001", "A. premier RDC 2026");

  const isdc = await insertSchool(pool, {
    countryId: cd,
    schoolCode: "CD-2026-0002",
    name: "Institut Supérieur de Commerce",
    createdAt: "2026-03-01T00:00:00Z",
  });
  assert.equal(isdc.login_code, "CD-ISC-26-002", "B. deuxième RDC, initiales ISC (de ignoré)");
  assert.notEqual(isdc.login_code, "CD-ISDC-26-001", "négatif : ISDC-001 ne doit pas être produit");
  assert.notEqual(isdc.login_code, "CD-ISDC-26-002", "négatif : ISDC-002 ne doit pas être produit");
  assert.equal(isdc.short_code, "ISC");
  assert.equal(isdc.school_code, "CD-2026-0002", "school_code interne inchangé");

  const third = await insertSchool(pool, {
    countryId: cd,
    schoolCode: "CD-2026-0003",
    name: "Alpha Bravo Charlie",
    createdAt: "2026-06-01T00:00:00Z",
  });
  assert.equal(third.login_code, "CD-ABC-26-003", "C. troisième RDC 2026");

  const kanyosha = await insertSchool(pool, {
    countryId: bi,
    schoolCode: "BI-2026-0001",
    name: "Ecole Kanyosha",
    createdAt: "2026-02-01T00:00:00Z",
  });
  assert.equal(kanyosha.login_code, "BI-EK-26-001", "D. Burundi redémarre à 001");

  const lyceeBurundi = await insertSchool(pool, {
    countryId: bi,
    schoolCode: "BI-2026-0002",
    name: "Lycee Bujumbura",
    createdAt: "2026-08-01T00:00:00Z",
  });
  assert.equal(lyceeBurundi.login_code, "BI-LB-26-002", "D2. deuxième Burundi continue à 002");

  const nextYear = await insertSchool(pool, {
    countryId: cd,
    schoolCode: "CD-2027-0001",
    name: "Xavier Yves Zola",
    createdAt: "2027-01-10T00:00:00Z",
  });
  assert.equal(nextYear.login_code, "CD-XYZ-27-001", "E. RDC 2027 redémarre à 001");

  const counterCols = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_login_code_counters'
    ORDER BY ordinal_position
  `);
  assert.equal(
    counterCols.rows.some((row) => row.column_name === "school_initials"),
    false,
    "la clé compteur ne contient plus school_initials",
  );

  const pk = await pool.query(`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'school_login_code_counters'::regclass
      AND contype = 'p'
  `);
  assert.match(String(pk.rows[0]?.def ?? ""), /country_id.*creation_year|creation_year.*country_id/);

  await pool.query(USER_ROLES_SCHEMA_SQL);
  const stable = await loginCodes(pool);
  assert.deepEqual(
    stable.map((row) => row.login_code),
    ["CD-IN-26-001", "BI-EK-26-001", "CD-ISC-26-002", "CD-ABC-26-003", "BI-LB-26-002", "CD-XYZ-27-001"],
    "rerun boot ne réécrit aucun login_code",
  );
}

async function testLegacyCollisionThenContinue(pool) {
  await resetWith(pool, legacySchoolLoginSql());
  const cd = await insertCountry(pool, "RDC", "CD", "+243", "CDF");

  const nuru = await insertSchool(pool, {
    countryId: cd,
    schoolCode: "CD-2026-0001",
    name: "Institut Nuru",
    createdAt: "2026-01-15T00:00:00Z",
  });
  const isdc = await insertSchool(pool, {
    countryId: cd,
    schoolCode: "CD-2026-0002",
    name: "Institut Superieur de Commerce",
    createdAt: "2026-03-01T00:00:00Z",
  });
  assert.equal(nuru.login_code, "CD-IN-26-001");
  assert.equal(isdc.login_code, "CD-ISC-26-001", "ancien compteur par initiales : collision logique 001/001");
  assert.notEqual(isdc.login_code, "CD-ISDC-26-001");

  await pool.query(readMigration("20260823_student_canonical_identifier.sql"));
  await pool.query(readMigration("20260825_school_login_code_country_year.sql"));

  const after = await loginCodes(pool);
  assert.deepEqual(
    after.map((row) => row.login_code),
    ["CD-IN-26-001", "CD-ISC-26-001"],
    "20260825 ne réécrit pas les codes déjà émis",
  );

  const collisions = await pool.query(
    `SELECT count(*)::int AS n FROM school_login_code_sequence_audit WHERE sequence_collision`,
  );
  assert.equal(collisions.rows[0].n, 2, "diagnostic : collision logique conservée");

  const next = await insertSchool(pool, {
    countryId: cd,
    schoolCode: "CD-2026-0003",
    name: "Institut ABC",
    createdAt: "2026-09-01T00:00:00Z",
  });
  assert.equal(next.login_code, "CD-IA-26-002", "futurs codes continuent après MAX(seq)=1");
  assert.notEqual(next.login_code, "CD-IA-26-001");
}

async function testConcurrency(pool) {
  await resetWith(pool, USER_ROLES_SCHEMA_SQL);
  const cd = await insertCountry(pool, "RDC", "CD", "+243", "CDF");
  const names = [
    "Institut Alpha",
    "Institut Bravo",
    "Lycee Charlie",
    "Ecole Delta",
    "College Echo",
    "Institut Foxtrot",
    "Lycee Golf",
    "Ecole Hotel",
    "College India",
    "Institut Juliet",
  ];

  await Promise.all(
    names.map((name, index) =>
      insertSchool(pool, {
        countryId: cd,
        schoolCode: `CD-2026-${String(index + 1).padStart(4, "0")}`,
        name,
        createdAt: "2026-04-01T00:00:00Z",
      }),
    ),
  );

  const rows = await pool.query(`
    SELECT login_code, split_part(login_code, '-', 4)::integer AS seq
    FROM schools
    ORDER BY seq
  `);
  assert.equal(rows.rowCount, 10);
  assert.deepEqual(
    rows.rows.map((row) => row.seq),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    "F. concurrence : séquences 001..010 uniques",
  );
  const unique = new Set(rows.rows.map((row) => row.login_code));
  assert.equal(unique.size, 10);
}

async function testBackfillFileNotOnBoot() {
  const boot = fs.readFileSync(path.join(__dirname, "../db/userRolesSchema.js"), "utf8");
  assert.match(boot, /20260825_school_login_code_country_year\.sql/);
  assert.doesNotMatch(boot, /readFileSync\([^)]*20260825_school_login_code_seq_backfill/);
}

async function testOptInBackfillRequiresGuc(pool) {
  await resetWith(pool, USER_ROLES_SCHEMA_SQL);
  const backfill = readMigration("20260825_school_login_code_seq_backfill.sql");
  await assert.rejects(
    () => pool.query(backfill),
    (error) => String(error.message).includes("SCHOOL_LOGIN_SEQ_BACKFILL_DRY_RUN"),
  );
}

async function main() {
  testBackfillFileNotOnBoot();

  if (!DATABASE_URL) {
    console.log("schoolLoginCode.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    await testSignificantInitials(pool);
    await testCanonicalSequence(pool);
    await testLegacyCollisionThenContinue(pool);
    await testConcurrency(pool);
    await testOptInBackfillRequiresGuc(pool);
    console.log(
      [
        "OK schoolLoginCode PostgreSQL:",
        "initiales ISC pas ISDC",
        "/ SEQ pays+année",
        "/ négatif ISDC",
        "/ Burundi + année suivante",
        "/ concurrence 10",
        "/ pas de rewrite boot",
        "/ backfill opt-in GUC",
      ].join(" "),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
