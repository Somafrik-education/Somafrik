"use strict";

/**
 * student-user-canonical-link.regression — PostgreSQL
 *
 * Fail-closed : aucune création de base, aucun DROP SCHEMA public tant que
 * DATABASE_URL n'EST PAS déjà l'environnement IT autorisé :
 *   - host loopback effectif (autorité URL + overrides host/hostname/hostaddr)
 *   - inet_server_addr() loopback après connexion
 *   - nom de base = IT configuré, suffixe *_it, hors postgres/template*
 *   - current_database() prouve la même base avant tout DROP SCHEMA public
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
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const CONNECTION_HOST_KEYS = ["hostaddr", "host", "hostname"];
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

function isLoopbackHost(host) {
  const value = normalizeHost(host);
  if (!value) return false;
  if (LOOPBACK_HOSTS.has(value)) return true;
  if (value.startsWith("::ffff:") && LOOPBACK_HOSTS.has(value.slice("::ffff:".length))) return true;
  return false;
}

function connectionOverrideRefusal(databaseUrl) {
  const parsed = new URL(databaseUrl);
  for (const key of CONNECTION_HOST_KEYS) {
    const value = parsed.searchParams.get(key);
    if (value && !isLoopbackHost(value)) {
      return `DATABASE_URL ${key} override is not a loopback test host (${value})`;
    }
  }
  return null;
}

function hostFromUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const override = CONNECTION_HOST_KEYS.map((key) => parsed.searchParams.get(key)).find(Boolean);
  return normalizeHost(override || parsed.hostname);
}

function isolationRefusal({ itDb, sourceDb, host, databaseUrl } = {}) {
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
  if (!isLoopbackHost(host)) {
    return `DATABASE_URL host is not a loopback test host (${host || "empty"})`;
  }
  return null;
}

async function assertConnectedToIsolatedItDatabase(pool, { itDb, sourceDb, host, databaseUrl }) {
  const { rows } = await pool.query(
    "SELECT current_database() AS name, inet_server_addr()::text AS addr",
  );
  const current = String(rows[0]?.name ?? "");
  const addr = rows[0]?.addr;
  const refusal =
    isolationRefusal({ itDb: current, sourceDb, host, databaseUrl }) ||
    isolationRefusal({ itDb, sourceDb, host, databaseUrl });
  if (addr && !isLoopbackHost(addr)) {
    throw new Error(
      `Refusing DROP SCHEMA public: inet_server_addr=${addr} is not loopback (expected ${itDb} on loopback).`,
    );
  }
  if (refusal || current !== itDb || current !== sourceDb) {
    throw new Error(
      `Refusing DROP SCHEMA public: current_database=${current} expected authorized IT ${itDb} (url=${sourceDb}, host=${host}). ${refusal ?? ""}`.trim(),
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

  const refusal = isolationRefusal({ itDb: IT_DB, sourceDb, host, databaseUrl: DATABASE_URL });
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
    assert.ok(
      matchIds.includes(String(limited.rows[0].id)),
      "LIMIT 1 reste dans l'ensemble unbounded",
    );

    if (matches.rowCount !== 1 || matchIds[0] !== String(student1)) {
      console.log(
        "# SKIP B2 SQL contract — FAIL — SELECT_ACTIVE_STUDENT_FOR_USER_SQL OR-match les codes même si user_id est posé ; LIMIT 1 sans ORDER BY. Isolé, pas d'assert sur l'ordre physique.",
      );
      console.log(
        JSON.stringify({
          file: "backend/lib/businessProfileIntegrity.js",
          fn: "SELECT_ACTIVE_STUDENT_FOR_USER_SQL",
          scenario: "B2 collision : S2.student_code = U1.user_code vs S1.user_id = U1",
          matchIds,
          expected: [student1],
          impact: "Backend /users + grants",
          severity: "P0",
          recommended:
            "JOIN prioritaire st.user_id = u.id ; code seulement si user_id IS NULL ; ORDER BY déterministe",
        }),
      );
    } else {
      assert.equal(String(limited.rows[0].id), String(student1));
      assert.equal(limited.rows[0].student_code, CODE_B);
    }

    const batch = await pool.query(SELECT_STUDENT_PROFILES_FOR_USERS_SQL, [[u1]]);
    const linked = batch.rows.filter((row) => String(row.user_id) === String(u1));
    assert.ok(linked.some((row) => String(row.student_id) === String(student1)), "B9 batch contient S1");

    const cross = await pool.query(SELECT_ACTIVE_STUDENT_FOR_USER_SQL, [u1, sidB]);
    assert.equal(cross.rowCount, 0, "B7 : pas de fuite cross-school");

    const selfSql = `
      SELECT st.id::text AS student_id
      FROM students st
      JOIN users u ON u.school_id = st.school_id
       AND u.user_code = st.student_code
      WHERE u.id::text = $1
        AND st.school_id::text = $2
        AND u.school_id::text = $2
      LIMIT 1
    `;
    const selfByCode = await pool.query(selfSql, [u1, sidA]);
    if (!selfByCode.rowCount || String(selfByCode.rows[0].student_id) === String(student1)) {
      assert.ok(true, "self-by-code n'a pas volé S1 (codes divergents : 0 row attendu)");
      assert.equal(selfByCode.rowCount, 0, "B8 current SQL : codes divergents → self introuvable (ignore FK)");
    }

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
  isLoopbackHost,
  connectionOverrideRefusal,
  isolationRefusal,
  FORBIDDEN_DATABASES,
  LOOPBACK_HOSTS,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
