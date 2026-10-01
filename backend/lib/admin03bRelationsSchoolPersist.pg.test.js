"use strict";

/**
 * ADMIN-03B — preuve PostgreSQL dédiée update / archive / isolation.
 *
 * Fail-closed : refuse toute URL qui n'est pas un hôte loopback + base
 * maintenance autorisée (postgres|somafrik) ou la base IT dédiée.
 * DROP SCHEMA public uniquement après preuve que current_database()
 * = somafrik_admin03b_relations_it.
 *
 * Ne pas pointer vers production / préprod / démo.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { ensureSchoolLoginCodeColumn } = require("../db/ensureSchoolLoginCodeColumn");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const { CLIENTS_ERROR } = require("./clientsManagement");
const { TenantScopeService } = require("../services/tenantScopeService");
const { isUuid, resolvePrincipalSub } = require("./principalIdentity");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_ADMIN03B_RELATIONS_IT_DATABASE ?? "somafrik_admin03b_relations_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const FORBIDDEN_DATABASES = new Set(["", "template0", "template1"]);
const SOURCE_ALLOWLIST = new Set(["postgres", "somafrik", IT_DB]);
const URL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const CONNECTION_HOST_KEYS = ["host", "hostname", "hostaddr"];
const REMOTE_URL_MARKERS =
  /supabase|render\.com|neon\.tech|amazonaws|azure|cloudsql|preprod|production|somafrik_demo|demo\.somafrik|somafrik\.app/i;
const PERSON_NAME_KEYS = new Set(["fromContactName", "toStudentName", "contact_name", "student_name"]);
const PERSON_NAME_VALUES = ["Baudouin", "Esther", "Sarah", "OKITO"];

const tenantScope = new TenantScopeService();

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

function hostFromUrl(databaseUrl) {
  return normalizeHost(new URL(databaseUrl).hostname);
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function isolationRefusal({ itDb, sourceDb, host, databaseUrl, env } = {}) {
  if (!itDb) return "IT database name empty after sanitization";
  if (FORBIDDEN_DATABASES.has(itDb)) return `IT database name forbidden (${itDb})`;
  if (itDb !== "somafrik_admin03b_relations_it" && !/^[a-z][a-z0-9_]*_admin03b_relations_it$/.test(itDb)) {
    return `IT database must be somafrik_admin03b_relations_it (got ${itDb})`;
  }
  if (!sourceDb) return "DATABASE_URL database empty";
  if (FORBIDDEN_DATABASES.has(sourceDb)) return `DATABASE_URL database forbidden (${sourceDb})`;
  if (!SOURCE_ALLOWLIST.has(sourceDb)) {
    return `DATABASE_URL database ${sourceDb} is not an authorized CI/IT maintenance database`;
  }
  if (databaseUrl && REMOTE_URL_MARKERS.test(databaseUrl)) {
    return "DATABASE_URL matches a remote/demo/preprod/production marker — refusing";
  }
  if (databaseUrl) {
    const parsed = new URL(databaseUrl);
    for (const key of CONNECTION_HOST_KEYS) {
      if (parsed.searchParams.has(key)) {
        return `DATABASE_URL contains ${key} connection-destination override — refusing`;
      }
    }
  }
  for (const key of ["PGHOST", "PGHOSTADDR"]) {
    const value = String((env || process.env)[key] ?? "").trim();
    if (!value) continue;
    if (value.startsWith("/")) continue;
    if (!isLoopbackUrlHost(value)) {
      return `${key} overrides connection destination (${value}) — refusing`;
    }
  }
  if (!isLoopbackUrlHost(host)) {
    return `DATABASE_URL host is not a loopback test host (${host || "empty"})`;
  }
  return null;
}

function createRepo(pool) {
  return {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
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
}

const PoolRef = { Pool: null };

async function ensureItDatabase(sourceUrl, itDb) {
  const sourceDb = databaseNameFromUrl(sourceUrl);
  if (sourceDb === itDb) return sourceUrl;
  const pool = new PoolRef.Pool({ connectionString: sourceUrl });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [itDb]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${itDb}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(sourceUrl, itDb);
}

async function assertAuthorizedItConnection(pool, itDb) {
  const { rows } = await pool.query(`SELECT current_database() AS name`);
  const current = String(rows[0]?.name ?? "").trim();
  if (current !== itDb) {
    throw new Error(
      `Refusing DROP SCHEMA public: current_database=${current || "empty"} is not authorized IT ${itDb}`,
    );
  }
}

function assertNoPersonNamesInAudit(value) {
  const walk = (node) => {
    if (node == null) return;
    if (typeof node === "string") {
      for (const name of PERSON_NAME_VALUES) {
        assert.equal(node.includes(name), false, `audit_logs leaked person name ${name}: ${node}`);
      }
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "object") {
      for (const [key, nested] of Object.entries(node)) {
        assert.equal(PERSON_NAME_KEYS.has(key), false, `audit_logs leaked ${key}`);
        assert.equal(["phone", "email", "address", "password", "pin", "secret"].includes(key), false, key);
        walk(nested);
      }
    }
  };
  walk(value);
}

async function scenario(id, fn) {
  try {
    await fn();
    console.log(`${id} PASS`);
  } catch (error) {
    console.log(`${id} FAIL`);
    throw error;
  }
}

async function main() {
  if (!DATABASE_URL) {
    console.log("admin03bRelationsSchoolPersist.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  let sourceDb;
  let host;
  try {
    sourceDb = databaseNameFromUrl(DATABASE_URL);
    host = hostFromUrl(DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL unparseable — refusing ADMIN-03B PG runner");
  }

  const refusal = isolationRefusal({
    itDb: IT_DB,
    sourceDb,
    host,
    databaseUrl: DATABASE_URL,
    env: process.env,
  });
  if (refusal) {
    throw new Error(`Refusing ADMIN-03B PG runner: ${refusal}`);
  }

  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch {
    throw new Error("module pg absent — refusing ADMIN-03B PG runner");
  }
  PoolRef.Pool = Pool;

  const isolatedUrl = await ensureItDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await assertAuthorizedItConnection(pool, IT_DB);
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
    await ensureSchoolLoginCodeColumn((sql) => pool.query(sql));

    const repo = createRepo(pool);
    await ensureClientsCanonicalBootstrap(repo, { info() {}, error() {} });

    const countryCd = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const countryBi = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'CD-IN-26-001', 'INSTITUT NURU', 'active') RETURNING id`,
      [countryCd.rows[0].id],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, 'BI-2026-0002', 'BI-KG-26-002', 'KIGOBE', 'active') RETURNING id`,
      [countryBi.rows[0].id],
    );
    const esther = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, 'STU-ESTHER', 'Esther', 'OKITO', 'active') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const sarah = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, 'STU-SARAH', 'Sarah', 'OKITO', 'active') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, 'STU-B', 'Cross', 'Tenant', 'active')`,
      [schoolB.rows[0].id],
    );

    const actor = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
       VALUES ($1, 'USR-ADMIN03B', 'Admin', 'Nuru', 'admin03b.pg@test.local', 'Admin School', 'active')
       RETURNING id`,
      [schoolA.rows[0].id],
    );
    const actorId = actor.rows[0].id;
    assert.ok(isUuid(actorId), "users.id production is UUID");

    const SCHOOL_A = {
      sub: resolvePrincipalSub({ id: actorId }),
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: ["Relations:READ", "Relations:CREATE", "Relations:UPDATE", "Gérer utilisateurs"],
      schoolCode: "CD-2026-0001",
      schoolId: schoolA.rows[0].id,
      identifier: "admin-a",
    };
    const SCHOOL_B = {
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: ["Relations:READ", "Relations:CREATE", "Relations:UPDATE", "Gérer utilisateurs"],
      schoolCode: "BI-2026-0002",
      schoolId: schoolB.rows[0].id,
      identifier: "admin-b",
    };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "admin03b-pg" };
    const store = createClientsPgStore(repo);

    const contact = await store.createContact(
      { firstName: "Baudouin", lastName: "OKITO", contactType: "Parent", phone: "+243811111111" },
      SCHOOL_A,
      auditMeta,
    );
    const created = await store.createRelation(
      { fromContactId: contact.id, toStudentId: esther.rows[0].id, isPrincipal: "Oui" },
      SCHOOL_A,
      auditMeta,
    );
    const relationId = created.relation.id;
    assert.equal(created.created, true);
    assert.equal(created.relation.toStudentId, esther.rows[0].id);
    assert.equal(created.relation.fromContactName.includes("Baudouin"), true);

    await scenario("R03B-PG-01 update persist", async () => {
      const updated = await store.updateRelation(
        relationId,
        { fromContactId: contact.id, toStudentId: sarah.rows[0].id, isPrincipal: "Non" },
        SCHOOL_A,
        auditMeta,
      );
      assert.equal(updated.toStudentId, sarah.rows[0].id);
      assert.equal(updated.isPrincipal, "Non");
      assert.equal(String(updated.fromContactName || "").includes("Baudouin"), true);

      const row = await pool.query(
        `SELECT r.id, r.status, r.student_id::text AS student_id, r.profile_payload, s.school_code
           FROM contact_relations r
           JOIN schools s ON s.id = r.school_id
          WHERE r.id = $1`,
        [relationId],
      );
      assert.equal(row.rowCount, 1);
      assert.equal(row.rows[0].status, "active");
      assert.equal(row.rows[0].student_id, sarah.rows[0].id);
      assert.equal(row.rows[0].school_code, "CD-2026-0001");
    });

    await scenario("R03B-PG-02 isolation école B", async () => {
      await assert.rejects(
        () => store.updateRelation(relationId, { toStudentId: esther.rows[0].id }, SCHOOL_B, auditMeta),
        (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.TENANT_MISMATCH,
      );
      await assert.rejects(
        () => store.archiveRelation(relationId, SCHOOL_B, auditMeta),
        (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.TENANT_MISMATCH,
      );
      const listedB = tenantScope.filterRows((await store.listProjection()).relations, SCHOOL_B);
      assert.equal(listedB.some((row) => String(row.id) === String(relationId)), false);
      const foreign = await pool.query(
        `SELECT COUNT(*)::int AS n
           FROM contact_relations r
           JOIN schools s ON s.id = r.school_id
          WHERE r.id = $1 AND s.school_code = 'BI-2026-0002'`,
        [relationId],
      );
      assert.equal(foreign.rows[0].n, 0);
    });

    await scenario("R03B-PG-03 archive persist sans DELETE", async () => {
      const before = await pool.query(`SELECT COUNT(*)::int AS n FROM contact_relations WHERE id = $1`, [relationId]);
      const archived = await store.archiveRelation(relationId, SCHOOL_A, auditMeta);
      assert.equal(archived.archived, true);
      assert.equal(archived.relation.status, "Archivé");
      const after = await pool.query(
        `SELECT status, COUNT(*) OVER ()::int AS n
           FROM contact_relations
          WHERE id = $1`,
        [relationId],
      );
      assert.equal(after.rowCount, 1);
      assert.equal(after.rows[0].n, before.rows[0].n);
      assert.equal(after.rows[0].status, "archived");
    });

    await scenario("R03B-PG-04 audit_logs sans noms", async () => {
      const audits = await pool.query(
        `SELECT action, old_value, new_value
           FROM audit_logs
          WHERE entity_type = 'relation' AND entity_id = $1
          ORDER BY created_at`,
        [relationId],
      );
      assert.ok(audits.rowCount >= 3, `expected create/update/archive audits, got ${audits.rowCount}`);
      const actions = audits.rows.map((row) => row.action);
      assert.equal(actions.includes("create_relation"), true);
      assert.equal(actions.includes("update_relation"), true);
      assert.equal(actions.includes("archive_relation"), true);
      for (const entry of audits.rows) {
        assertNoPersonNamesInAudit(entry.old_value);
        assertNoPersonNamesInAudit(entry.new_value);
        const payload = entry.new_value ?? {};
        assert.equal(Object.hasOwn(payload, "fromContactName"), false);
        assert.equal(Object.hasOwn(payload, "toStudentName"), false);
        if (entry.action !== "link_parent") {
          assert.ok(payload.fromContactId);
          assert.ok(payload.toStudentId);
        }
      }
    });

    console.log("admin03bRelationsSchoolPersist.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
