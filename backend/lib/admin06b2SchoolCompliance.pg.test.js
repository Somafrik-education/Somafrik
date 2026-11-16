"use strict";

/**
 * ADMIN-06B2 — PG-C06B2 : isolation privacy + execute + export.
 * Base IT isolée uniquement. Aucune migration.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PostgresRepository } = require("../db/postgresRepository");
const { listSchoolPrivacyRequests } = require("./schoolCompliance");
const { executeErasureRequest } = require("./privacyErasure");
const { exportSchoolData } = require("./dataExportService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_ADMIN06B2_COMPLIANCE_IT_DATABASE ?? "somafrik_admin06b2_compliance_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const FORBIDDEN_DATABASES = new Set(["", "template0", "template1"]);
const SOURCE_ALLOWLIST = new Set(["postgres", "somafrik", IT_DB]);
const URL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const REMOTE_URL_MARKERS =
  /supabase|render\.com|neon\.tech|amazonaws|azure|cloudsql|preprod|production|somafrik_demo|demo\.somafrik|somafrik\.app/i;

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
  if (itDb !== "somafrik_admin06b2_compliance_it" && !/^[a-z][a-z0-9_]*_admin06b2_compliance_it$/.test(itDb)) {
    return `IT database must be somafrik_admin06b2_compliance_it (got ${itDb})`;
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
  repo.createTxScope = PostgresRepository.prototype.createTxScope;
  repo.withReadOnlyRepeatableRead = PostgresRepository.prototype.withReadOnlyRepeatableRead;
  repo.getSchoolByCode = async (code) =>
    repo.one(
      `SELECT id, school_code FROM schools WHERE upper(school_code) = upper($1) LIMIT 1`,
      [code],
    );
  repo.resolveDbUserId = PostgresRepository.prototype.resolveDbUserId;
  repo.revokeAllSessionsForUser = PostgresRepository.prototype.revokeAllSessionsForUser;
  repo.listPrivacyRequests = PostgresRepository.prototype.listPrivacyRequests;
  repo.getPrivacyRequest = PostgresRepository.prototype.getPrivacyRequest;
  repo.executePrivacyErasure = PostgresRepository.prototype.executePrivacyErasure;
  repo.recordAudit = async (entry) => {
    const school = entry.schoolCode ? await repo.getSchoolByCode(entry.schoolCode) : null;
    await pool.query(
      `INSERT INTO audit_logs (school_id, action, entity_type, entity_id, new_value)
       VALUES ($1, $2, $3, $4, $5)`,
      [school?.id ?? null, entry.action, entry.entityType, entry.entityId ?? null, JSON.stringify(entry.newValue ?? {})],
    );
  };
  return repo;
}

async function seedSchool(pool, { countryId, schoolCode, name, suffix, email, identifier }) {
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
    [countryId, schoolCode, name],
  );
  const schoolId = school.rows[0].id;
  await pool.query(
    `INSERT INTO school_settings (school_id, period_mode, default_scale, report_card_mode)
     VALUES ($1, 'trimestre', 20, 'period')
     ON CONFLICT (school_id) DO NOTHING`,
    [schoolId],
  );
  const year = await pool.query(
    `INSERT INTO academic_years (school_id, name, status, is_current)
     VALUES ($1, '2025-2026', 'open', TRUE) RETURNING id`,
    [schoolId],
  );
  const klass = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [schoolId, year.rows[0].id, `CLS-${suffix}`, `Classe ${suffix}`],
  );
  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [schoolId, `ELE-${suffix}`, "Élève", suffix],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [schoolId, student.rows[0].id, klass.rows[0].id, year.rows[0].id],
  );
  const user = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'hash-secret', 'pin-secret', 'Parent', 'active') RETURNING id`,
    [schoolId, identifier, "Prénom", suffix, email, `+243${suffix}`],
  );
  const session = await pool.query(
    `INSERT INTO sessions (user_id, school_id, session_code, refresh_token_hash, role, expires_at)
     VALUES ($1, $2, gen_random_uuid(), $3, 'Parent', NOW() + INTERVAL '1 day') RETURNING id, session_code`,
    [user.rows[0].id, schoolId, `refresh-${suffix}`],
  );
  return {
    schoolId,
    userId: user.rows[0].id,
    sessionId: session.rows[0].id,
    studentCode: `ELE-${suffix}`,
  };
}

async function insertPrivacy(pool, { requestCode, schoolId, schoolCode, userId, identifier, email, reason, status }) {
  const inserted = await pool.query(
    `INSERT INTO privacy_requests (
       request_code, school_id, user_id, school_code, identifier, contact_email,
       role_label, request_type, status, reason
     ) VALUES ($1,$2,$3,$4,$5,$6,'Parent','erasure',$7,$8)
     RETURNING id`,
    [requestCode, schoolId, userId, schoolCode, identifier, email, status, reason],
  );
  return inserted.rows[0].id;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("admin06b2SchoolCompliance.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const refusal = isolationRefusal({
    itDb: IT_DB,
    sourceDb: databaseNameFromUrl(DATABASE_URL),
    host: normalizeHost(new URL(DATABASE_URL).hostname),
    databaseUrl: DATABASE_URL,
  });
  if (refusal) {
    throw new Error(`ADMIN-06B2 PG isolation refused: ${refusal}`);
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
      name: "Lycée A C06B2",
      suffix: "A",
      email: "user.a@c06b2.test",
      identifier: "USER-A-C06B2",
    });
    const tenantB = await seedSchool(pool, {
      countryId: country.rows[0].id,
      schoolCode: "BI-2026-0002",
      name: "Lycée B C06B2",
      suffix: "B",
      email: "user.b@c06b2.test",
      identifier: "USER-B-C06B2",
    });

    const reqAPending = await insertPrivacy(pool, {
      requestCode: "PRV-A-PENDING",
      schoolId: tenantA.schoolId,
      schoolCode: "CD-2026-0001",
      userId: tenantA.userId,
      identifier: "USER-A-C06B2",
      email: "user.a@c06b2.test",
      reason: "REASON-A-C06B2",
      status: "pending",
    });
    await insertPrivacy(pool, {
      requestCode: "PRV-A-DONE",
      schoolId: tenantA.schoolId,
      schoolCode: "CD-2026-0001",
      userId: tenantA.userId,
      identifier: "USER-A-C06B2",
      email: "user.a@c06b2.test",
      reason: "REASON-A-DONE",
      status: "processed",
    });
    const reqBPending = await insertPrivacy(pool, {
      requestCode: "PRV-B-PENDING",
      schoolId: tenantB.schoolId,
      schoolCode: "BI-2026-0002",
      userId: tenantB.userId,
      identifier: "USER-B-C06B2",
      email: "user.b@c06b2.test",
      reason: "REASON-B-C06B2",
      status: "pending",
    });

    const repo = createRepo(pool);
    const principalA = {
      sub: tenantA.userId,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: ["Utilisateurs:READ", "Utilisateurs:UPDATE", "Paramètres Établissement:READ"],
      schoolCode: "CD-2026-0001",
    };
    const principalB = {
      sub: tenantB.userId,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: ["Utilisateurs:READ", "Utilisateurs:UPDATE", "Paramètres Établissement:READ"],
      schoolCode: "BI-2026-0002",
    };

    const listedA = await listSchoolPrivacyRequests(repo, principalA);
    const listedB = await listSchoolPrivacyRequests(repo, principalB);
    assert.equal(listedA.every((row) => row.schoolCode === "CD-2026-0001"), true);
    assert.equal(listedB.every((row) => row.schoolCode === "BI-2026-0002"), true);
    assert.equal(listedA.some((row) => row.id === reqBPending), false);
    assert.equal(listedB.some((row) => row.id === reqAPending), false);
    assert.equal(listedA.some((row) => row.requestCode === "PRV-B-PENDING"), false);
    assert.equal(listedB.some((row) => row.requestCode === "PRV-A-PENDING"), false);

    await assert.rejects(
      () => executeErasureRequest(repo, reqBPending, principalA),
      (error) => error.statusCode === 403,
    );
    const stillB = await pool.query("SELECT status FROM privacy_requests WHERE id = $1", [reqBPending]);
    assert.equal(stillB.rows[0].status, "pending");
    const userBBefore = await pool.query("SELECT first_name, email, status FROM users WHERE id = $1", [tenantB.userId]);
    assert.equal(userBBefore.rows[0].email, "user.b@c06b2.test");
    assert.equal(userBBefore.rows[0].status, "active");

    const executed = await executeErasureRequest(repo, reqAPending, principalA);
    assert.equal(executed.request.status, "processed");
    assert.equal(executed.accountAnonymized, true);
    assert.equal(executed.schoolRecordsRetained, true);
    assert.ok(executed.sessionsRevoked >= 1);
    const userA = await pool.query("SELECT first_name, last_name, email, phone, password_hash, pin_hash, status FROM users WHERE id = $1", [
      tenantA.userId,
    ]);
    assert.equal(userA.rows[0].first_name, "Anonymisé");
    assert.equal(userA.rows[0].email, null);
    assert.equal(userA.rows[0].password_hash, null);
    assert.equal(userA.rows[0].status, "deleted");
    const sessionA = await pool.query("SELECT revoked_at FROM sessions WHERE user_id = $1", [tenantA.userId]);
    assert.ok(sessionA.rows[0].revoked_at);
    const studentA = await pool.query("SELECT first_name, last_name FROM students WHERE student_code = $1", [
      tenantA.studentCode,
    ]);
    assert.equal(studentA.rows[0].last_name, "A");
    const userBAfter = await pool.query("SELECT first_name, email, status FROM users WHERE id = $1", [tenantB.userId]);
    assert.equal(userBAfter.rows[0].email, "user.b@c06b2.test");
    assert.equal(userBAfter.rows[0].status, "active");

    const exportA = await exportSchoolData(repo, principalA, "BI-2026-0002");
    const exportB = await exportSchoolData(repo, principalB, "CD-2026-0001");
    assert.equal(exportA.schoolCode, "CD-2026-0001");
    assert.equal(exportB.schoolCode, "BI-2026-0002");
    const studentsA = JSON.stringify(exportA.domains.students ?? []);
    const studentsB = JSON.stringify(exportB.domains.students ?? []);
    assert.equal(studentsA.includes("ELE-A"), true);
    assert.equal(studentsA.includes("ELE-B"), false);
    assert.equal(studentsB.includes("ELE-B"), true);
    assert.equal(studentsB.includes("ELE-A"), false);

    const audits = await pool.query("SELECT action, new_value FROM audit_logs WHERE action IN ('privacy_erasure', 'export_school_data')");
    assert.equal(audits.rows.some((row) => row.action === "privacy_erasure"), true);
    assert.equal(audits.rows.some((row) => row.action === "export_school_data"), true);
    const serializedAudits = JSON.stringify(audits.rows);
    assert.doesNotMatch(serializedAudits, /hash-secret|pin-secret|password|PIN|jwt/i);
    const exportAudit = audits.rows.find((row) => row.action === "export_school_data");
    assert.ok(exportAudit.new_value.includedDomains);
    assert.ok(exportAudit.new_value.generatedAt);
    assert.equal(exportAudit.new_value.domains, undefined);

    console.log("admin06b2SchoolCompliance.pg.test.js PASS");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
