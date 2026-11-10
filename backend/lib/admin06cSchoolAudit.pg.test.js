"use strict";

/**
 * ADMIN-06C — PG-C06C : isolation journal d’audit school-only.
 * Base IT isolée uniquement. Aucune migration.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PostgresRepository } = require("../db/postgresRepository");
const { listSchoolAuditSummaries } = require("./schoolAudit");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_ADMIN06C_COMPLIANCE_IT_DATABASE ?? "somafrik_admin06c_compliance_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const FORBIDDEN_DATABASES = new Set(["", "template0", "template1"]);
const SOURCE_ALLOWLIST = new Set(["postgres", "somafrik", IT_DB]);
const URL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const REMOTE_URL_MARKERS =
  /supabase|render\.com|neon\.tech|amazonaws|azure|cloudsql|preprod|production|somafrik_demo|demo\.somafrik|somafrik\.app/i;

const PII = Object.freeze({
  emailA: "alice.injected@c06c.test",
  phoneA: "+243600000001",
  ipA: "203.0.113.10",
  uaA: "Injected-UA-A",
  emailB: "bob.injected@c06c.test",
  phoneB: "+243600000002",
  ipB: "203.0.113.20",
  uaB: "Injected-UA-B",
});

function databaseNameFromUrl(databaseUrl) {
  return decodeURIComponent(String(new URL(databaseUrl).pathname ?? "").replace(/^\//, "")).trim();
}

function normalizeHost(host) {
  return String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
}

function isLoopbackUrlHost(host) {
  const value = normalizeHost(host);
  if (!value) return false;
  if (URL_LOOPBACK_HOSTS.has(value)) return true;
  if (value.startsWith("::ffff:") && URL_LOOPBACK_HOSTS.has(value.slice("::ffff:".length))) return true;
  return false;
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function isolationRefusal({ itDb, sourceDb, host, databaseUrl } = {}) {
  if (!itDb) return "IT database name empty after sanitization";
  if (FORBIDDEN_DATABASES.has(itDb)) return `IT database name forbidden (${itDb})`;
  if (itDb !== "somafrik_admin06c_compliance_it" && !/^[a-z][a-z0-9_]*_admin06c_compliance_it$/.test(itDb)) {
    return `IT database must be somafrik_admin06c_compliance_it (got ${itDb})`;
  }
  if (!sourceDb) return "DATABASE_URL database empty";
  if (FORBIDDEN_DATABASES.has(sourceDb)) return `DATABASE_URL database forbidden (${sourceDb})`;
  if (!SOURCE_ALLOWLIST.has(sourceDb)) {
    return `DATABASE_URL database ${sourceDb} is not an authorized CI/IT maintenance database`;
  }
  if (databaseUrl && REMOTE_URL_MARKERS.test(databaseUrl)) {
    return "DATABASE_URL matches a remote/demo/preprod/production marker — refusing";
  }
  if (!isLoopbackUrlHost(host)) {
    return `DATABASE_URL host is not a loopback test host (${host || "empty"})`;
  }
  return null;
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

function createRepo(pool) {
  const repo = Object.create(PostgresRepository.prototype);
  repo.pool = pool;
  repo.ready = true;
  repo.init = async () => {};
  repo.query = PostgresRepository.prototype.query;
  repo.one = PostgresRepository.prototype.one;
  repo.all = PostgresRepository.prototype.all;
  repo.getSchoolByCode = async (code) =>
    repo.one(
      `SELECT id, school_code FROM schools WHERE upper(school_code) = upper($1) LIMIT 1`,
      [code],
    );
  repo.listSchoolAuditSummaries = PostgresRepository.prototype.listSchoolAuditSummaries;
  return repo;
}

async function seedSchool(pool, { countryId, schoolCode, name, suffix, email, identifier }) {
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
    [countryId, schoolCode, name],
  );
  const schoolId = school.rows[0].id;
  const user = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'hash-secret', 'pin-secret', 'Admin School', 'active') RETURNING id`,
    [schoolId, identifier, "Admin", suffix, email, `+243${suffix}`],
  );
  return { schoolId, userId: user.rows[0].id };
}

async function insertAudit(pool, {
  schoolId,
  userId,
  action,
  entityType,
  entityId,
  oldValue,
  newValue,
  ipAddress,
  userAgent,
  createdAt,
}) {
  const inserted = await pool.query(
    `INSERT INTO audit_logs (
       school_id, user_id, action, entity_type, entity_id,
       old_value, new_value, ip_address, user_agent, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)
     RETURNING id`,
    [
      schoolId,
      userId,
      action,
      entityType,
      entityId,
      JSON.stringify(oldValue),
      JSON.stringify(newValue),
      ipAddress,
      userAgent,
      createdAt,
    ],
  );
  return inserted.rows[0].id;
}

function assertSafeHttpPayload(rows) {
  const serialized = JSON.stringify(rows);
  assert.doesNotMatch(serialized, /oldValue|newValue|old_value|new_value/);
  assert.doesNotMatch(serialized, /ipAddress|ip_address|userAgent|user_agent/);
  assert.doesNotMatch(serialized, /schoolId|schoolCode|userId|userCode/);
  assert.doesNotMatch(serialized, /alice\.injected|bob\.injected|\+24360000000|Injected-UA|203\.0\.113/);
  assert.doesNotMatch(serialized, /hash-secret|pin-secret|password|token|jwt/i);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["action", "actor", "createdAt", "entityId", "entityType", "id"]);
  }
}

async function main() {
  if (!DATABASE_URL) {
    console.log("admin06cSchoolAudit.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const refusal = isolationRefusal({
    itDb: IT_DB,
    sourceDb: databaseNameFromUrl(DATABASE_URL),
    host: normalizeHost(new URL(DATABASE_URL).hostname),
    databaseUrl: DATABASE_URL,
  });
  if (refusal) {
    throw new Error(`ADMIN-06C PG isolation refused: ${refusal}`);
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    const current = await pool.query("SELECT current_database() AS name");
    assert.equal(current.rows[0].name, IT_DB);
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const tenantA = await seedSchool(pool, {
      countryId: country.rows[0].id,
      schoolCode: "CD-2026-0001",
      name: "Lycée A C06C",
      suffix: "A",
      email: "user.a@c06c.test",
      identifier: "USER-A-C06C",
    });
    const tenantB = await seedSchool(pool, {
      countryId: country.rows[0].id,
      schoolCode: "BI-2026-0002",
      name: "Lycée B C06C",
      suffix: "B",
      email: "user.b@c06c.test",
      identifier: "USER-B-C06C",
    });

    const idA1 = await insertAudit(pool, {
      schoolId: tenantA.schoolId,
      userId: tenantA.userId,
      action: "user_update",
      entityType: "user",
      entityId: "USER-A-C06C",
      oldValue: { email: PII.emailA },
      newValue: { phone: PII.phoneA },
      ipAddress: PII.ipA,
      userAgent: PII.uaA,
      createdAt: "2026-10-03T12:00:00.000Z",
    });
    const idA2 = await insertAudit(pool, {
      schoolId: tenantA.schoolId,
      userId: tenantA.userId,
      action: "privacy_erasure",
      entityType: "privacy_request",
      entityId: "PRV-A-C06C",
      oldValue: { email: PII.emailA },
      newValue: { phone: PII.phoneA },
      ipAddress: PII.ipA,
      userAgent: PII.uaA,
      createdAt: "2026-10-03T11:00:00.000Z",
    });
    const idA3 = await insertAudit(pool, {
      schoolId: tenantA.schoolId,
      userId: null,
      action: "export_school_data",
      entityType: "school",
      entityId: "export-a",
      oldValue: { email: PII.emailA },
      newValue: { phone: PII.phoneA },
      ipAddress: PII.ipA,
      userAgent: PII.uaA,
      createdAt: "2026-10-03T10:00:00.000Z",
    });
    const idB1 = await insertAudit(pool, {
      schoolId: tenantB.schoolId,
      userId: tenantB.userId,
      action: "other_action",
      entityType: "user",
      entityId: "USER-B-C06C",
      oldValue: { email: PII.emailB },
      newValue: { phone: PII.phoneB },
      ipAddress: PII.ipB,
      userAgent: PII.uaB,
      createdAt: "2026-10-03T13:00:00.000Z",
    });

    const repo = createRepo(pool);
    const principalA = {
      sub: tenantA.userId,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: ["Audit:READ"],
      schoolCode: "CD-2026-0001",
    };
    const principalB = {
      sub: tenantB.userId,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: ["Audit:READ"],
      schoolCode: "BI-2026-0002",
    };

    const listedA = await listSchoolAuditSummaries(repo, principalA);
    const listedB = await listSchoolAuditSummaries(repo, principalB);
    assert.deepEqual(
      listedA.map((row) => row.id),
      [idA1, idA2, idA3],
    );
    assert.deepEqual(
      listedB.map((row) => row.id),
      [idB1],
    );
    assert.equal(listedA.some((row) => row.id === idB1), false);
    assert.equal(listedB.some((row) => row.id === idA1), false);
    assert.equal(listedA[0].actor, "Admin A");
    assert.equal(listedA.find((row) => row.action === "export_school_data")?.actor, "Système");
    assert.equal(listedB[0].actor, "Admin B");

    const overrideB = await listSchoolAuditSummaries(repo, principalA, { schoolCode: "BI-2026-0002" });
    assert.deepEqual(
      overrideB.map((row) => row.id),
      [idA1, idA2, idA3],
    );
    assert.equal(overrideB.some((row) => row.id === idB1), false);

    const filtered = await listSchoolAuditSummaries(repo, principalA, { action: "user_update" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, idA1);
    assert.equal(filtered.some((row) => row.id === idB1), false);

    assertSafeHttpPayload(listedA);
    assertSafeHttpPayload(listedB);
    assertSafeHttpPayload(overrideB);
    assertSafeHttpPayload(filtered);

    const raw = await pool.query(
      `SELECT old_value, new_value, ip_address, user_agent FROM audit_logs WHERE id = $1`,
      [idA1],
    );
    assert.equal(raw.rows[0].old_value.email, PII.emailA);
    assert.equal(raw.rows[0].new_value.phone, PII.phoneA);
    assert.equal(raw.rows[0].ip_address, PII.ipA);
    assert.equal(raw.rows[0].user_agent, PII.uaA);

    console.log("admin06cSchoolAudit.pg.test.js PASS");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
