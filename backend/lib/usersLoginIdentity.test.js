"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Pool } = require("pg");
const {
  USERS_LOGIN_IDENTITY_DUPLICATES_CODE,
  ACTIVE_USER_IDENTITY_STATUS_SQL,
  activeIdentityStatusSql,
  formatUsersLoginIdentityDuplicateDiagnostic,
  isUsersLoginIdentityUniquenessViolation,
} = require("./usersLoginIdentity");
const { AuthService } = require("../services/authService");
const { BackOfficeAccessService } = require("../services/backOfficeAccessService");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");
const { USER_ROLES_SCHEMA_SQL } = require("../db/userRolesSchema");
const fs = require("node:fs");
const path = require("node:path");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureDatabase(databaseUrl, databaseName) {
  const maintenance = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await maintenance.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await maintenance.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await maintenance.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

test("formatUsersLoginIdentityDuplicateDiagnostic inclut le code et les exemples", () => {
  const message = formatUsersLoginIdentityDuplicateDiagnostic(
    [{ school_code: "CD-2026-0001", email_key: "a@b.com", duplicate_count: 2, user_codes: ["U1", "U2"] }],
    1,
  );
  assert.match(message, /1 groupe\(s\) en doublon/);
  assert.match(message, /CD-2026-0001/);
});

test("isUsersLoginIdentityUniquenessViolation détecte la contrainte PG", () => {
  assert.equal(
    isUsersLoginIdentityUniquenessViolation({ code: "23505", constraint: "uq_users_school_email" }),
    true,
  );
  assert.equal(isUsersLoginIdentityUniquenessViolation({ code: "23505", constraint: "other" }), false);
});

test("code diagnostic users login identity", () => {
  assert.equal(USERS_LOGIN_IDENTITY_DUPLICATES_CODE, "USERS_LOGIN_IDENTITY_DUPLICATES");
});

test("activeIdentityStatusSql qualifie status quand un alias est fourni", () => {
  assert.match(activeIdentityStatusSql("u"), /COALESCE\(u\.status/);
  assert.doesNotMatch(activeIdentityStatusSql("u"), /JOIN/);
  assert.match(ACTIVE_USER_IDENTITY_STATUS_SQL, /COALESCE\(status/);
  assert.match(ACTIVE_USER_IDENTITY_STATUS_SQL, /archived/);
});

test("migration et module alignent index partiels sur archived/deleted", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "../db/migrations/20260814_users_login_identity_uniqueness.sql"),
    "utf8",
  );
  assert.match(migration, /NOT IN \('deleted', 'archived'\)/);
  const indexBlocks = migration.match(/CREATE UNIQUE INDEX[\s\S]*?;/g) ?? [];
  assert.equal(indexBlocks.length, 4);
  for (const block of indexBlocks) {
    assert.match(block, /NOT IN \('deleted', 'archived'\)/);
  }
});

function schoolLoginFixture() {
  const school = {
    id: "school-ik",
    code: "CD-2026-0001",
    legacySchoolCode: "CD-2026-0001",
    publicId: "CD-IK-26-001",
    loginCode: "CD-IK-26-001",
    shortCode: "IK",
    country: "RDC",
    countryCode: "CD",
    name: "Institut K",
    status: "Actif",
    validationStatus: "Validé",
  };
  const user = {
    id: "user-gk",
    userCode: "GK-26-00001",
    identifier: "GK-26-00001",
    publicId: "GK-26-00001",
    schoolCode: school.code,
    firstName: "Grace",
    lastName: "Kabongo",
    role: "Admin School",
    accessChannel: "Application",
    status: "Actif",
    password: "Somafrik26!",
    mustChangePassword: false,
    permissions: [],
  };
  return { school, user };
}

test("AuthService accepte CD-IK-26-001 avec GK-26-00001", async () => {
  attachMemoryLoginLockoutStore();
  const { school, user } = schoolLoginFixture();
  const service = new AuthService({
    school,
    schools: [school],
    teachers: [],
    students: [],
    userAccounts: [user],
    countries: [],
    subscriptions: [],
  });

  assert.deepEqual(service.identify({ schoolCode: "CD-IK-26-001", identifier: "GK-26-00001" }), {
    role: "school_admin",
    roleLabel: "Admin Établissement",
  });

  const result = await service.login({
    role: "school_admin",
    schoolCode: "CD-IK-26-001",
    identifier: "GK-26-00001",
    pin: "Somafrik26!",
  });
  assert.equal(result.school.loginCode, "CD-IK-26-001");
  assert.equal(result.user.id, user.id);
  assert.equal(result.user.schoolCode, school.code);
});

test("BackOfficeAccessService résout CD-IK-26-001 vers le tenant historique", async () => {
  attachMemoryLoginLockoutStore();
  const { school, user } = schoolLoginFixture();
  const service = new BackOfficeAccessService({
    school,
    schools: [school],
    userAccounts: [user],
    students: [],
    countries: [],
    subscriptions: [],
  });

  const result = await service.login({
    schoolCode: "CD-IK-26-001",
    identifier: "GK-26-00001",
    password: "Somafrik26!",
  });
  assert.equal(result.user.id, user.id);
  assert.equal(result.schoolContext.loginCode, "CD-IK-26-001");
  assert.equal(result.schoolContext.code, school.code);
});

test("PostgreSQL découple short_code unique et initiales publiques sans renumérotation au reboot", async (t) => {
  if (!DATABASE_URL) {
    t.skip("DATABASE_URL absent");
    return;
  }

  const databaseName = "somafrik_school_login_code_it";
  const url = await ensureDatabase(DATABASE_URL, databaseName);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(USER_ROLES_SCHEMA_SQL);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const countryId = country.rows[0].id;

    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status, created_at)
       VALUES ($1, 'CD-2026-1001', 'Institut Kibwija', 'active', '2026-02-01T00:00:00Z')`,
      [countryId],
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status, created_at)
       VALUES ($1, 'CD-2026-1002', 'Institut Kibwija', 'active', '2026-05-01T00:00:00Z')`,
      [countryId],
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, short_code, name, status, created_at)
       VALUES ($1, 'CD-2026-1003', 'IN', 'Universite de Kinshasa', 'active', '2026-06-01T00:00:00Z')`,
      [countryId],
    );

    const rows = await pool.query(
      `SELECT school_code, short_code, login_code
       FROM schools
       ORDER BY school_code`,
    );
    assert.deepEqual(
      rows.rows.map((row) => row.login_code),
      ["CD-IK-26-001", "CD-IK-26-002", "CD-IN-26-003"],
      "le suffixe IK2 reste interne et l'override sémantique IN reste public",
    );
    assert.deepEqual(
      rows.rows.map((row) => row.short_code),
      ["IK", "IK2", "IN"],
      "short_code interne reste unique sans contaminer les initiales publiques",
    );

    await pool.query(USER_ROLES_SCHEMA_SQL);
    const stable = await pool.query(
      `SELECT login_code FROM schools ORDER BY school_code`,
    );
    assert.deepEqual(
      stable.rows.map((row) => row.login_code),
      ["CD-IK-26-001", "CD-IK-26-002", "CD-IN-26-003"],
      "rerun migration/boot ne renumérote aucun établissement",
    );
  } finally {
    await pool.end();
  }
});