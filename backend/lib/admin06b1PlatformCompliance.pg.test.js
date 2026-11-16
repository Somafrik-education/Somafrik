"use strict";

/**
 * ADMIN-06B1 — PG-C06B1 : agrégats privacy globaux non-PII.
 * Base IT isolée uniquement. Aucune migration. Aucune lecture row-level.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PostgresRepository } = require("../db/postgresRepository");
const { collectObjectKeyPaths, getPlatformCompliance } = require("./platformCompliance");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_ADMIN06B1_COMPLIANCE_IT_DATABASE ?? "somafrik_admin06b1_compliance_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const FORBIDDEN_DATABASES = new Set(["", "template0", "template1"]);
const SOURCE_ALLOWLIST = new Set(["postgres", "somafrik", IT_DB]);
const URL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const REMOTE_URL_MARKERS =
  /supabase|render\.com|neon\.tech|amazonaws|azure|cloudsql|preprod|production|somafrik_demo|demo\.somafrik|somafrik\.app/i;

const PII = Object.freeze({
  emailA: "alice.pii.schoolA@forbidden-c06b1.test",
  identifierA: "IDENT-PII-SCHOOL-A-C06B1",
  reasonA: "REASON-PII-SCHOOL-A-C06B1",
  requestCodeA: "PRV-PII-A-C06B1",
  schoolCodeA: "CD-2026-0001",
  schoolNameA: "Lycée PII Alpha C06B1",
  emailB: "bob.pii.schoolB@forbidden-c06b1.test",
  identifierB: "IDENT-PII-SCHOOL-B-C06B1",
  reasonB: "REASON-PII-SCHOOL-B-C06B1",
  requestCodeB: "PRV-PII-B-C06B1",
  schoolCodeB: "BI-2026-0002",
  schoolNameB: "Lycée PII Beta C06B1",
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
  if (itDb !== "somafrik_admin06b1_compliance_it" && !/^[a-z][a-z0-9_]*_admin06b1_compliance_it$/.test(itDb)) {
    return `IT database must be somafrik_admin06b1_compliance_it (got ${itDb})`;
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

function createCountsRepo(pool) {
  const repo = Object.create(PostgresRepository.prototype);
  repo.init = async () => {};
  repo.one = async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null;
  repo.all = async (sql, params) => (await pool.query(sql, params)).rows;
  return repo;
}

async function insertPrivacyRequest(pool, { requestCode, schoolId, schoolCode, identifier, email, reason, status }) {
  const inserted = await pool.query(
    `INSERT INTO privacy_requests (
       request_code, school_id, school_code, identifier, contact_email,
       role_label, request_type, status, reason
     ) VALUES ($1,$2,$3,$4,$5,'Parent','erasure',$6,$7)
     RETURNING id`,
    [requestCode, schoolId, schoolCode, identifier, email, status, reason],
  );
  return inserted.rows[0].id;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("admin06b1PlatformCompliance.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const refusal = isolationRefusal({
    itDb: IT_DB,
    sourceDb: databaseNameFromUrl(DATABASE_URL),
    host: normalizeHost(new URL(DATABASE_URL).hostname),
    databaseUrl: DATABASE_URL,
  });
  if (refusal) {
    throw new Error(`ADMIN-06B1 PG isolation refused: ${refusal}`);
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
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [country.rows[0].id, PII.schoolCodeA, PII.schoolNameA],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [country.rows[0].id, PII.schoolCodeB, PII.schoolNameB],
    );

    const requestIds = [
      await insertPrivacyRequest(pool, {
        requestCode: PII.requestCodeA,
        schoolId: schoolA.rows[0].id,
        schoolCode: PII.schoolCodeA,
        identifier: PII.identifierA,
        email: PII.emailA,
        reason: PII.reasonA,
        status: "pending",
      }),
      await insertPrivacyRequest(pool, {
        requestCode: `${PII.requestCodeA}-PROC`,
        schoolId: schoolA.rows[0].id,
        schoolCode: PII.schoolCodeA,
        identifier: PII.identifierA,
        email: PII.emailA,
        reason: PII.reasonA,
        status: "processed",
      }),
      await insertPrivacyRequest(pool, {
        requestCode: PII.requestCodeB,
        schoolId: schoolB.rows[0].id,
        schoolCode: PII.schoolCodeB,
        identifier: PII.identifierB,
        email: PII.emailB,
        reason: PII.reasonB,
        status: "pending",
      }),
      await insertPrivacyRequest(pool, {
        requestCode: `${PII.requestCodeB}-REJ`,
        schoolId: schoolB.rows[0].id,
        schoolCode: PII.schoolCodeB,
        identifier: PII.identifierB,
        email: PII.emailB,
        reason: PII.reasonB,
        status: "rejected",
      }),
    ];

    const repo = createCountsRepo(pool);
    const counts = await repo.getPlatformPrivacyRequestCounts();
    assert.deepEqual(Object.keys(counts).sort(), ["pending", "processed", "rejected", "total"]);
    assert.deepEqual(counts, { total: 4, pending: 2, processed: 1, rejected: 1 });

    const payload = await getPlatformCompliance(repo, {
      role: "Super Administrateur Somafrik",
      roleKeys: ["SUPER_ADMIN"],
      permissions: ["ALL_PRIVILEGES"],
    });
    assert.deepEqual(payload.privacyRequests, { total: 4, pending: 2, processed: 1, rejected: 1 });
    assert.deepEqual(collectObjectKeyPaths(payload).sort(), [
      "capabilities",
      "capabilities.accountDeletionPage",
      "capabilities.accountDeletionPage.configured",
      "capabilities.erasureRequestIntake",
      "capabilities.erasureRequestIntake.configured",
      "capabilities.privacyPolicy",
      "capabilities.privacyPolicy.configured",
      "capabilities.schoolDataExport",
      "capabilities.schoolDataExport.configured",
      "capabilities.selfErasure",
      "capabilities.selfErasure.configured",
      "generatedAt",
      "privacyRequests",
      "privacyRequests.pending",
      "privacyRequests.processed",
      "privacyRequests.rejected",
      "privacyRequests.total",
      "protections",
      "protections.advancedReportsPlatformDenied",
      "protections.auditLogsPlatformDenied",
      "protections.schoolDataExportPlatformDenied",
      "protections.schoolPrivacyExecutionPlatformDenied",
      "protections.schoolPrivacyRequestsPlatformDenied",
      "schemaVersion",
      "scope",
    ]);

    const serialized = JSON.stringify(payload);
    const leaks = [
      PII.emailA,
      PII.emailB,
      PII.identifierA,
      PII.identifierB,
      PII.reasonA,
      PII.reasonB,
      PII.requestCodeA,
      PII.requestCodeB,
      PII.schoolCodeA,
      PII.schoolCodeB,
      PII.schoolNameA,
      PII.schoolNameB,
      schoolA.rows[0].id,
      schoolB.rows[0].id,
      ...requestIds,
    ];
    for (const leak of leaks) {
      assert.equal(serialized.includes(String(leak)), false, `PII leaked: ${leak}`);
    }

    console.log("admin06b1PlatformCompliance.pg.test.js PASS");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
