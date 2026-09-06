"use strict";

/**
 * student-user-canonical-link.regression — PostgreSQL
 *
 * Fail-closed : aucune création de base, aucun DROP SCHEMA public tant que
 * mayDropPublicSchema() n'a pas prouvé la destination effective :
 *   - aucun override host/hostname/hostaddr dans DATABASE_URL
 *   - host URL loopback
 *   - current_database() = base IT autorisée
 *   - inet_server_addr() ∈ {127.0.0.1, ::1}
 *
 * Pas de création de base. Pas de réécriture d'URL vers une base générique.
 * SKIP sinon (y compris DATABASE_URL=.../somafrik ou .../postgres).
 */
const assert = require("node:assert/strict");
const {
  SELECT_ACTIVE_STUDENT_FOR_USER_SQL,
  SELECT_STUDENT_PROFILES_FOR_USERS_SQL,
} = require("./businessProfileIntegrity");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_CANONICAL_LINK_IT_DATABASE ?? "somafrik_canonical_link_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const FORBIDDEN_DATABASES = new Set(["", "postgres", "template0", "template1"]);
const URL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const EFFECTIVE_LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const CONNECTION_HOST_KEYS = ["host", "hostname", "hostaddr"];
const CODE_A = "CD-ITS-MR-26-00099";
const CODE_B = "CD-ITS-MR-26-00003";
const SELECT_ACTIVE_STUDENT_FOR_USER_UNBOUNDED_SQL = SELECT_ACTIVE_STUDENT_FOR_USER_SQL.replace(
  /\s*LIMIT\s+1\s*;?\s*$/i,
  "",
);

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

function isLoopbackServerAddr(addr) {
  const value = normalizeHost(addr);
  if (!value) return false;
  if (EFFECTIVE_LOOPBACK_ADDRS.has(value)) return true;
  if (value.startsWith("::ffff:") && EFFECTIVE_LOOPBACK_ADDRS.has(value.slice("::ffff:".length))) return true;
  return false;
}

function connectionOverrideRefusal(databaseUrl) {
  const parsed = new URL(databaseUrl);
  for (const key of CONNECTION_HOST_KEYS) {
    if (parsed.searchParams.has(key)) {
      return `DATABASE_URL contains ${key} connection-destination override — refusing DROP`;
    }
  }
  return null;
}

function environmentOverrideRefusal(env = process.env) {
  for (const key of ["PGHOST", "PGHOSTADDR"]) {
    const value = String(env[key] ?? "").trim();
    if (!value) continue;
    if (value.startsWith("/")) continue;
    if (!isLoopbackUrlHost(value)) {
      return `${key} overrides connection destination (${value}) — refusing DROP`;
    }
  }
  return null;
}

function hostFromUrl(databaseUrl) {
  return normalizeHost(new URL(databaseUrl).hostname);
}

function isolationRefusal({ itDb, sourceDb, host, databaseUrl, env } = {}) {
  if (!itDb) return "IT database name empty after sanitization";
  if (FORBIDDEN_DATABASES.has(itDb)) return `IT database name forbidden (${itDb})`;
  if (!/^[a-z][a-z0-9_]*_it$/.test(itDb)) return `IT database must match *_it (got ${itDb})`;
  if (!sourceDb) return "DATABASE_URL database empty";
  if (FORBIDDEN_DATABASES.has(sourceDb)) return `DATABASE_URL database forbidden (${sourceDb})`;
  if (!/^[a-z][a-z0-9_]*_it$/.test(sourceDb)) {
    return `DATABASE_URL database is not an authorized *_it test database (got ${sourceDb})`;
  }
  if (sourceDb !== itDb) {
    return `DATABASE_URL database ${sourceDb} is not the authorized IT database ${itDb}`;
  }
  if (databaseUrl) {
    const overrideRefusal = connectionOverrideRefusal(databaseUrl);
    if (overrideRefusal) return overrideRefusal;
  }
  const envRefusal = environmentOverrideRefusal(env);
  if (envRefusal) return envRefusal;
  if (!isLoopbackUrlHost(host)) {
    return `DATABASE_URL host is not a loopback test host (${host || "empty"})`;
  }
  return null;
}

/**
 * Autorise DROP SCHEMA public uniquement après preuve de la destination effective.
 * Retourne { allowed: true } seulement si URL + current_database + inet_server_addr
 * sont l'environnement IT loopback autorisé.
 */
function mayDropPublicSchema({
  itDb,
  sourceDb,
  host,
  databaseUrl,
  currentDatabase,
  inetServerAddr,
  env,
} = {}) {
  const urlRefusal = isolationRefusal({ itDb, sourceDb, host, databaseUrl, env });
  if (urlRefusal) return { allowed: false, reason: urlRefusal };
  const current = String(currentDatabase ?? "").trim();
  if (!current || current !== itDb || current !== sourceDb) {
    return {
      allowed: false,
      reason: `current_database=${current || "empty"} is not authorized IT ${itDb}`,
    };
  }
  if (!isLoopbackServerAddr(inetServerAddr)) {
    return {
      allowed: false,
      reason: `inet_server_addr=${inetServerAddr || "empty"} is not loopback`,
    };
  }
  return { allowed: true, reason: null };
}

async function assertConnectedToIsolatedItDatabase(pool, { itDb, sourceDb, host, databaseUrl }) {
  const { rows } = await pool.query(`
    SELECT
      current_database() AS name,
      inet_server_addr()::text AS addr,
      inet_server_port() AS port
  `);
  const decision = mayDropPublicSchema({
    itDb,
    sourceDb,
    host,
    databaseUrl,
    currentDatabase: rows[0]?.name,
    inetServerAddr: rows[0]?.addr,
    env: process.env,
  });
  if (!decision.allowed) {
    throw new Error(
      `Refusing DROP SCHEMA public: ${decision.reason} (port=${rows[0]?.port ?? "unknown"}).`,
    );
  }
}

async function main() {
  if (!DATABASE_URL) {
    console.log("student-user-canonical-link.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  let sourceDb;
  let host;
  try {
    sourceDb = databaseNameFromUrl(DATABASE_URL);
    host = hostFromUrl(DATABASE_URL);
  } catch {
    console.log("student-user-canonical-link.pg.test.js SKIP (DATABASE_URL unparseable)");
    return;
  }

  const refusal = isolationRefusal({
    itDb: IT_DB,
    sourceDb,
    host,
    databaseUrl: DATABASE_URL,
    env: process.env,
  });
  if (refusal) {
    console.log(`student-user-canonical-link.pg.test.js SKIP (${refusal})`);
    return;
  }

  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch {
    console.log("student-user-canonical-link.pg.test.js SKIP (module pg absent)");
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await assertConnectedToIsolatedItDatabase(pool, {
      itDb: IT_DB,
      sourceDb,
      host,
      databaseUrl: DATABASE_URL,
    });
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await pool.query(`
      CREATE TABLE schools (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_code TEXT NOT NULL
      );
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        user_code TEXT NOT NULL,
        identity_code TEXT,
        login_code TEXT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE students (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        student_code TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        user_id UUID
      );
    `);

    const schoolA = await pool.query(
      `INSERT INTO schools (school_code) VALUES ('CD-2026-0001') RETURNING id`,
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (school_code) VALUES ('BI-2026-0001') RETURNING id`,
    );
    const sidA = schoolA.rows[0].id;
    const sidB = schoolB.rows[0].id;

    const user = await pool.query(
      `INSERT INTO users (school_id, user_code, identity_code, login_code, first_name, last_name)
       VALUES ($1, $2, $3, $4, 'Marc', 'Rumba') RETURNING id`,
      [sidA, CODE_A, CODE_A, "LOGIN-X"],
    );
    const u1 = user.rows[0].id;

    const s1 = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, user_id)
       VALUES ($1, $2, 'Marc', 'Rumba', $3) RETURNING id`,
      [sidA, CODE_B, u1],
    );
    const student1 = s1.rows[0].id;

    await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, $2, 'Autre', 'Collision')`,
      [sidA, CODE_A],
    );
    await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, $2, 'Marc', 'Rumba')`,
      [sidB, CODE_A],
    );

    const matches = await pool.query(SELECT_ACTIVE_STUDENT_FOR_USER_UNBOUNDED_SQL, [u1, sidA]);
    const matchIds = matches.rows.map((row) => String(row.id));
    assert.ok(matchIds.includes(String(student1)), "B1 : S1 (FK) est parmi les matchs");
    const limited = await pool.query(SELECT_ACTIVE_STUDENT_FOR_USER_SQL, [u1, sidA]);
    assert.equal(limited.rowCount, 1, "SQL production LIMIT 1 renvoie une ligne");
    assert.equal(String(limited.rows[0].id), String(student1), "LIMIT 1 priorise le FK");
    assert.equal(limited.rows[0].student_code, CODE_B);
    assert.ok(
      matchIds.includes(String(limited.rows[0].id)),
      "LIMIT 1 reste dans l'ensemble unbounded",
    );

    const batch = await pool.query(SELECT_STUDENT_PROFILES_FOR_USERS_SQL, [[u1]]);
    const linked = batch.rows.filter((row) => String(row.user_id) === String(u1));
    assert.ok(linked.some((row) => String(row.student_id) === String(student1)), "B9 batch contient S1");

    const cross = await pool.query(SELECT_ACTIVE_STUDENT_FOR_USER_SQL, [u1, sidB]);
    assert.equal(cross.rowCount, 0, "B7 : pas de fuite cross-school");

    const selfSql = `
      SELECT st.id::text AS student_id
      FROM students st
      JOIN users u ON u.school_id = st.school_id
       AND (
         st.user_id::text = u.id::text
         OR (
           st.user_id IS NULL
           AND u.user_code = st.student_code
         )
       )
      WHERE u.id::text = $1
        AND st.school_id::text = $2
        AND u.school_id::text = $2
      ORDER BY CASE WHEN st.user_id IS NOT NULL THEN 0 ELSE 1 END, st.id::text
      LIMIT 1
    `;
    const selfByCode = await pool.query(selfSql, [u1, sidA]);
    assert.equal(selfByCode.rowCount, 1, "self-student via FK même si codes divergents");
    assert.equal(String(selfByCode.rows[0].student_id), String(student1));

    const selfByFk = await pool.query(
      `SELECT st.id::text AS student_id
       FROM students st
       JOIN users u ON u.school_id = st.school_id AND st.user_id = u.id
       WHERE u.id = $1 AND st.school_id = $2
       LIMIT 1`,
      [u1, sidA],
    );
    assert.equal(selfByFk.rowCount, 1);
    assert.equal(String(selfByFk.rows[0].student_id), String(student1));

    console.log("student-user-canonical-link.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

module.exports = {
  databaseNameFromUrl,
  hostFromUrl,
  normalizeHost,
  isLoopbackUrlHost,
  isLoopbackServerAddr,
  connectionOverrideRefusal,
  environmentOverrideRefusal,
  isolationRefusal,
  mayDropPublicSchema,
  FORBIDDEN_DATABASES,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
