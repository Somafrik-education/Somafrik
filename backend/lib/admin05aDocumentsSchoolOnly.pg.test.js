"use strict";

/**
 * ADMIN-05A — preuves PostgreSQL PG-D05.
 * create / update / archive / tenant isolation / student ownership.
 * Base IT isolée uniquement. Aucune migration.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createTxAdapter } = require("../db/txAdapter");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const { DOCUMENTS_EXAMS_SCHEMA_SQL } = require("../db/documentsExamsSchema");
const { createDocumentsExamsPgStore } = require("../db/documentsExamsPgStore");
const { DOCUMENTS_EXAMS_ERROR } = require("./documentsExamsManagement");
const {
  listSchoolDocuments,
  createSchoolDocument,
  patchSchoolDocument,
  archiveSchoolDocument,
} = require("./documentsExamsService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_ADMIN05A_DOCUMENTS_IT_DATABASE ?? "somafrik_admin05a_documents_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const FORBIDDEN_DATABASES = new Set(["", "template0", "template1"]);
const SOURCE_ALLOWLIST = new Set(["postgres", "somafrik", IT_DB]);
const URL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const REMOTE_URL_MARKERS =
  /supabase|render\.com|neon\.tech|amazonaws|azure|cloudsql|preprod|production|somafrik_demo|demo\.somafrik|somafrik\.app/i;

const SCHOOL_A = {
  role: "Admin School",
  sub: "admin-a",
  schoolCode: "CD-2026-0001",
  permissions: ["Documents:READ", "Documents:CREATE", "Documents:UPDATE"],
};
const SCHOOL_B = {
  role: "Admin School",
  sub: "admin-b",
  schoolCode: "BI-2026-0002",
  permissions: ["Documents:READ", "Documents:CREATE", "Documents:UPDATE"],
};
const AUDIT = { ipAddress: "127.0.0.1", userAgent: "admin05a-pg" };

function databaseNameFromUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return decodeURIComponent(String(parsed.pathname ?? "").replace(/^\//, "")).trim();
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
  if (itDb !== "somafrik_admin05a_documents_it" && !/^[a-z][a-z0-9_]*_admin05a_documents_it$/.test(itDb)) {
    return `IT database must be somafrik_admin05a_documents_it (got ${itDb})`;
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
  const repo = {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    getDocumentsExamsStore() {
      return createDocumentsExamsPgStore(repo);
    },
    createTxScope(tx) {
      if (!tx) return repo;
      const scoped = {
        ...repo,
        query: (sql, params) => tx.query(sql, params),
        one: async (sql, params) => (await tx.query(sql, params)).rows[0] ?? null,
        all: async (sql, params) => (await tx.query(sql, params)).rows,
        recordAudit: async (payload) => {
          await tx.query(
            `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              null,
              null,
              payload.action,
              payload.entityType,
              payload.entityId,
              payload.oldValue ? JSON.stringify(payload.oldValue) : null,
              JSON.stringify(payload.newValue ?? {}),
              payload.ipAddress ?? "",
              payload.userAgent ?? "",
            ],
          );
        },
      };
      scoped.getDocumentsExamsStore = () => createDocumentsExamsPgStore(scoped);
      return scoped;
    },
    withTransaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = createTxAdapter(client);
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return repo;
}

async function expectRejection(promise, { status, code }) {
  try {
    await promise;
    throw new Error(`Expected rejection ${code || status}`);
  } catch (error) {
    if (error.message.startsWith("Expected rejection")) throw error;
    assert.equal(error.statusCode, status, error.message);
    if (code) assert.equal(error.code, code, error.message);
  }
}

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, 'CD-2026-0001', 'Lycée A', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, 'BI-2026-0002', 'Lycée B', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  const studentA = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'ELE-A-05A', 'Esther', 'OKITO', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const studentB = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'ELE-B-05A', 'Cross', 'Tenant', 'active') RETURNING id`,
    [schoolB.rows[0].id],
  );
  return {
    schoolAId: schoolA.rows[0].id,
    schoolBId: schoolB.rows[0].id,
    studentAId: studentA.rows[0].id,
    studentBId: studentB.rows[0].id,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("admin05aDocumentsSchoolOnly.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const refusal = isolationRefusal({
    itDb: IT_DB,
    sourceDb: databaseNameFromUrl(DATABASE_URL),
    host: normalizeHost(new URL(DATABASE_URL).hostname),
    databaseUrl: DATABASE_URL,
  });
  if (refusal) {
    throw new Error(`ADMIN-05A PG isolation refused: ${refusal}`);
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    const current = await pool.query("SELECT current_database() AS name");
    assert.equal(current.rows[0].name, IT_DB);
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
    await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
    await pool.query(DOCUMENTS_EXAMS_SCHEMA_SQL);
    const refs = await seed(pool);
    const repo = createRepo(pool);

    const created = await createSchoolDocument(
      repo,
      {
        title: "Attestation PG",
        documentType: "attestation",
        studentId: refs.studentAId,
        storageKey: "https://evil.example/file.pdf",
        schoolCode: "BI-2026-0002",
      },
      SCHOOL_A,
      AUDIT,
    );
    assert.equal(created.title, "Attestation PG");
    assert.equal(created.schoolCode, "CD-2026-0001");
    assert.equal(created.studentId, refs.studentAId);
    assert.equal(created.studentName, "Esther OKITO");
    assert.equal(Object.hasOwn(created, "storageKey"), false);
    const raw = await pool.query(`SELECT storage_key, school_id, student_id FROM school_documents WHERE id = $1`, [
      created.id,
    ]);
    assert.equal(raw.rows[0].storage_key, null);
    assert.equal(raw.rows[0].school_id, refs.schoolAId);
    assert.equal(raw.rows[0].student_id, refs.studentAId);
    console.log("PG-D05 create + student ownership + storage_key ignoré PASS");

    const titled = await patchSchoolDocument(repo, created.id, { title: "Attestation PG v2" }, SCHOOL_A, AUDIT);
    assert.equal(titled.title, "Attestation PG v2");
    const typed = await patchSchoolDocument(repo, created.id, { documentType: "certificat" }, SCHOOL_A, AUDIT);
    assert.equal(typed.documentType, "certificat");
    const statused = await patchSchoolDocument(repo, created.id, { status: "generating" }, SCHOOL_A, AUDIT);
    assert.equal(statused.status, "generating");
    console.log("PG-D05 update title/type/status PASS");

    const archived = await archiveSchoolDocument(repo, created.id, SCHOOL_A, AUDIT);
    assert.equal(archived.status, "archived");
    const reloaded = await listSchoolDocuments(repo, SCHOOL_A);
    const row = reloaded.find((item) => item.id === created.id);
    assert.equal(row.title, "Attestation PG v2");
    assert.equal(row.documentType, "certificat");
    assert.equal(row.status, "archived");
    console.log("PG-D05 archive + reload PASS");

    const listedB = await listSchoolDocuments(repo, SCHOOL_B);
    assert.equal(listedB.some((item) => item.id === created.id), false);
    await expectRejection(patchSchoolDocument(repo, created.id, { title: "Hack B" }, SCHOOL_B, AUDIT), {
      status: 404,
      code: DOCUMENTS_EXAMS_ERROR.NOT_FOUND,
    });
    await expectRejection(archiveSchoolDocument(repo, created.id, SCHOOL_B, AUDIT), {
      status: 404,
      code: DOCUMENTS_EXAMS_ERROR.NOT_FOUND,
    });
    console.log("PG-D05 tenant isolation PASS");

    await expectRejection(
      createSchoolDocument(
        repo,
        { title: "Cross student", documentType: "attestation", studentId: refs.studentBId },
        SCHOOL_A,
        AUDIT,
      ),
      { status: 404, code: DOCUMENTS_EXAMS_ERROR.NOT_FOUND },
    );
    console.log("PG-D05 student ownership cross-school PASS");

    const audits = await pool.query(
      `SELECT action, entity_type, entity_id, new_value, created_at
         FROM audit_logs
        WHERE entity_type = 'school_document'
        ORDER BY created_at`,
    );
    const actions = audits.rows.map((item) => item.action);
    assert.equal(actions.includes("create_school_document"), true);
    assert.equal(actions.includes("update_school_document"), true);
    assert.equal(actions.includes("archive_school_document"), true);
    for (const entry of audits.rows) {
      const blob = JSON.stringify(entry.new_value ?? {});
      assert.equal(/storageKey|storage_key|https?:\/\/|Bearer |password|pin/i.test(blob), false, blob);
      assert.ok(entry.entity_id);
      assert.ok(entry.created_at);
    }
    console.log("PG-D05 audit create/update/archive sans secret PASS");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
