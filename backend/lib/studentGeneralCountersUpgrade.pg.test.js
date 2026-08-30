"use strict";

/**
 * HOTFIX P0 — migration idempotente student_general_code_counters V1 → V2.
 *
 * Fixture historique exacte :
 *   PRIMARY KEY (school_id, creation_year)
 * CREATE TABLE IF NOT EXISTS ne convertit pas une table existante ; le boot
 * actuel doit migrer avant le premier ON CONFLICT (school_id) (sinon 42P10).
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { ensureStudentLifecyclePgSchema } = require("../db/studentLifecyclePg");
const { ensureStudentGeneralIdentityPg } = require("../db/studentGeneralIdentityPg");
const { hashSecret } = require("../services/credentialService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const BACKEND_ROOT = path.join(__dirname, "..");
const HTTP_PORT = Number(process.env.SOMAFRIK_COUNTERS_UPGRADE_HTTP_PORT ?? 19661);
const ADMIN_PASSWORD = "PrefetPass12";

function dbName(envKey, fallback) {
  return String(process.env[envKey] ?? fallback).trim().replace(/[^a-zA-Z0-9_]/g, "");
}

function requireDatabaseUrl() {
  if (DATABASE_URL) return;
  if (process.env.GITHUB_ACTIONS || process.env.CI) {
    throw new Error("DATABASE_URL obligatoire dans CI/Security — pas de SKIP");
  }
  console.log("SKIP studentGeneralCountersUpgrade.pg.test.js: DATABASE_URL absent");
  process.exit(0);
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function pgIdentArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
  }
  return [];
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const maintenanceUrl = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenanceUrl });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (existing.rowCount) {
      await pool.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await pool.query(`DROP DATABASE ${databaseName}`);
    }
    await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function createLegacyCounterTableSql() {
  return `
    CREATE TABLE student_general_code_counters (
      school_id UUID NOT NULL,
      creation_year INTEGER NOT NULL,
      last_value INTEGER NOT NULL,
      PRIMARY KEY (school_id, creation_year)
    )
  `;
}

async function inspectCounterSchema(pool) {
  const exists = await pool.query(
    `SELECT to_regclass('public.student_general_code_counters') IS NOT NULL AS present`,
  );
  if (!exists.rows[0].present) {
    return { present: false, columns: [], pk: [], rows: [] };
  }
  const cols = await pool.query(`
    SELECT a.attname
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'student_general_code_counters'
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `);
  const pk = await pool.query(`
    SELECT array_agg(a.attname ORDER BY k.n) AS cols
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, n) ON TRUE
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = 'public'
      AND t.relname = 'student_general_code_counters'
      AND c.contype = 'p'
    GROUP BY c.conname
  `);
  const rows = await pool.query(
    `SELECT school_id, last_value FROM student_general_code_counters ORDER BY school_id`,
  );
  const duplicates = await pool.query(`
    SELECT school_id, COUNT(*)::int AS n
    FROM student_general_code_counters
    GROUP BY school_id
    HAVING COUNT(*) > 1
  `);
  return {
    present: true,
    columns: cols.rows.map((row) => row.attname),
    pk: pgIdentArray(pk.rows[0]?.cols),
    rows: rows.rows,
    duplicateSchoolIds: duplicates.rows,
  };
}

function assertCanonicalCounter(schema, { lastValueBySchool = {} } = {}) {
  assert.equal(schema.present, true);
  assert.ok(!schema.columns.includes("creation_year"), "creation_year doit être absent");
  assert.deepEqual(schema.pk, ["school_id"], "PK canonique = school_id");
  assert.deepEqual(schema.duplicateSchoolIds, [], "aucune ligne dupliquée par school_id");
  for (const [schoolId, expectedMin] of Object.entries(lastValueBySchool)) {
    const row = schema.rows.find((item) => item.school_id === schoolId);
    assert.ok(row, `compteur manquant pour ${schoolId}`);
    assert.ok(
      Number(row.last_value) >= expectedMin,
      `last_value ${row.last_value} < ${expectedMin} pour ${schoolId}`,
    );
  }
}

async function seedSchoolClass(pool, { schoolCode = "CD-2026-0001", schoolName = "Institut Nuru" } = {}) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('République Démocratique du Congo', 'CD', '+243', 'CDF')
     ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  const countryId = country.rows[0].id;
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, $2, $3, 'active')
     RETURNING id, short_code, login_code`,
    [countryId, schoolCode, schoolName],
  );
  const schoolId = school.rows[0].id;
  const year = await pool.query(
    `INSERT INTO academic_years (school_id, name, is_current, status)
     VALUES ($1, '2025-2026', TRUE, 'open')
     RETURNING id`,
    [schoolId],
  );
  const level = await pool.query(
    `INSERT INTO education_levels (country_id, level_code, name, status)
     VALUES ($1, '6eme', '6ème', 'active')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [countryId],
  );
  let levelId = level.rows[0]?.id;
  if (!levelId) {
    const existing = await pool.query(
      `SELECT id FROM education_levels WHERE country_id = $1 AND level_code = '6eme'`,
      [countryId],
    );
    levelId = existing.rows[0].id;
  }
  const group = await pool.query(
    `INSERT INTO education_class_groups (country_id, group_code, name, status)
     VALUES ($1, 'A', 'A', 'active')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [countryId],
  );
  let groupId = group.rows[0]?.id;
  if (!groupId) {
    const existing = await pool.query(
      `SELECT id FROM education_class_groups WHERE country_id = $1 AND group_code = 'A'`,
      [countryId],
    );
    groupId = existing.rows[0].id;
  }
  await pool.query(
    `INSERT INTO school_levels (school_id, level_id, status) VALUES ($1, $2, 'active')
     ON CONFLICT DO NOTHING`,
    [schoolId, levelId],
  );
  await pool.query(
    `INSERT INTO school_class_groups (school_id, group_id, status) VALUES ($1, $2, 'active')
     ON CONFLICT DO NOTHING`,
    [schoolId, groupId],
  );
  const classCode = schoolCode === "CD-2026-0001" ? "CLS-6A-REPRO" : `CLS-${schoolCode.slice(-4)}`;
  await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status, level_id, group_id)
     VALUES ($1, $2, $3, '6ème A', 'active', $4, $5)`,
    [schoolId, year.rows[0].id, classCode, levelId, groupId],
  );
  const loginCode = String(school.rows[0].login_code || "").trim();
  assert.ok(loginCode, "login_code école manquant");
  return { countryId, schoolId, shortCode: school.rows[0].short_code, classCode, schoolCode: loginCode };
}

async function seedLegacyStudentsAndStaff(pool, schoolId) {
  await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, gender, status)
     VALUES
       ($1, 'CD-IN-EL-26-001', 'Jean', 'Dupont', 'Masculin', 'active'),
       ($1, 'CD-IN-EL-26-002', 'Marie', 'Martin', 'Féminin', 'active')`,
    [schoolId],
  );
  await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, role, status)
     VALUES
       ($1, 'CD-IN-EL-26-001', 'Jean', 'Dupont', '', '', 'STUDENT', 'active'),
       ($1, 'CD-IN-EL-26-002', 'Marie', 'Martin', '', '', 'STUDENT', 'active')`,
    [schoolId],
  );
  const staff = await pool.query(
    `INSERT INTO users (
       school_id, user_code, first_name, last_name, email, phone, role, status,
       password_hash, pin_hash, must_change_password
     )
     VALUES (
       $1, 'STAFF-ADMIN', 'Olivier', 'Ekanga', 'admin@nuru.test', '+243820000000',
       'SCHOOL_ADMIN', 'active', $2, $2, FALSE
     )
     RETURNING identity_code, login_code, identity_initials`,
    [schoolId, hashSecret(ADMIN_PASSWORD)],
  );
  assert.equal(staff.rows[0].identity_code, "CD-IN-OE-26-00001");
  return { staffIdentity: staff.rows[0].identity_code };
}

async function insertExistingSeq5(pool, schoolId, seq) {
  const code = `CD-IN-XX-26-${String(seq).padStart(5, "0")}`;
  await pool.query(`ALTER TABLE students DROP CONSTRAINT IF EXISTS students_canonical_identifier_format_check`);
  await pool.query(`ALTER TABLE students DISABLE TRIGGER USER`);
  await pool.query(
    `INSERT INTO students (
       school_id, student_code, login_code, identity_code, identity_initials, identity_year,
       first_name, last_name, gender, status
     )
     VALUES ($1, $2, $3, $4, $5, 2026, 'Xena', 'Xavier', 'Féminin', 'active')`,
    [schoolId, code, code, code, "XX"],
  );
  await pool.query(`ALTER TABLE students ENABLE TRIGGER USER`);
  return code;
}

function httpRequest(pathname, { method = "GET", token, body } = {}) {
  const payload = body == null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: HTTP_PORT,
        path: `/api${pathname}`,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 20000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = text;
          }
          resolve({ status: res.statusCode, data, text });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout ${method} ${pathname}`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealth(child, attempts = 80) {
  for (let i = 0; i < attempts; i += 1) {
    if (child.exitCode != null) {
      throw new Error(`Serveur arrêté prématurément (code ${child.exitCode})`);
    }
    try {
      const health = await httpRequest("/health");
      if (health.status === 200) return health;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Backend non healthy à temps");
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function bootCurrentIdentity(repo) {
  await ensureStudentLifecyclePgSchema(repo);
  await ensureStudentGeneralIdentityPg(repo);
}

async function scenarioMultiYearAndIdempotent() {
  const isolatedUrl = await ensureIsolatedDatabase(
    DATABASE_URL,
    dbName("SOMAFRIK_STUDENT_COUNTERS_UPGRADE_IT_DATABASE", "somafrik_student_counters_upgrade_it"),
  );
  const repo = createPostgresRepository(isolatedUrl);
  const pool = repo.pool;
  try {
    process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
    await repo.init();
    const schoolA = await seedSchoolClass(pool);
    const schoolB = await seedSchoolClass(pool, {
      schoolCode: "CD-2026-0002",
      schoolName: "Academie Lumiere",
    });
    await pool.query(createLegacyCounterTableSql());
    await pool.query(
      `INSERT INTO student_general_code_counters (school_id, creation_year, last_value)
       VALUES ($1, 2025, 18), ($1, 2026, 27), ($2, 2024, 3), ($2, 2026, 9)`,
      [schoolA.schoolId, schoolB.schoolId],
    );
    const before = await inspectCounterSchema(pool);
    assert.equal(before.columns.includes("creation_year"), true, "preuve ancienne PK détectée (colonne)");
    assert.deepEqual(before.pk, ["school_id", "creation_year"], "preuve ancienne PK composite");
    assert.equal(before.rows.length, 4);

    await bootCurrentIdentity(repo);
    await bootCurrentIdentity(repo);

    const after = await inspectCounterSchema(pool);
    assertCanonicalCounter(after, {
      lastValueBySchool: {
        [schoolA.schoolId]: 27,
        [schoolB.schoolId]: 9,
      },
    });
    const exactA = after.rows.find((row) => row.school_id === schoolA.schoolId);
    assert.equal(Number(exactA.last_value), 27, "conservation MAX(last_value) 18/27 → 27");

    const created = await repo.enrollStudentInClass(schoolA.classCode, schoolA.schoolCode, {
      firstName: "Awa",
      lastName: "Diop",
    });
    const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
    assert.match(created.student.studentCode, new RegExp(`^CD-IN-DA-${yy}-\\d{5}$`));
    assert.equal(Number(created.student.studentCode.slice(-5)), 28, "séquence continue après upgrade");
    const continued = await pool.query(
      `SELECT last_value FROM student_general_code_counters WHERE school_id = $1`,
      [schoolA.schoolId],
    );
    assert.equal(Number(continued.rows[0].last_value), 28);
    console.log("studentGeneralCountersUpgrade: multi-year + boot x2 + enroll OK");
  } finally {
    await pool.end();
  }
}

async function scenarioSeq5AboveHistorical() {
  const isolatedUrl = await ensureIsolatedDatabase(
    DATABASE_URL,
    dbName("SOMAFRIK_STUDENT_COUNTERS_SEQ5_IT_DATABASE", "somafrik_student_counters_seq5_it"),
  );
  const repo = createPostgresRepository(isolatedUrl);
  const pool = repo.pool;
  try {
    process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
    await repo.init();
    const school = await seedSchoolClass(pool);
    await pool.query(createLegacyCounterTableSql());
    await pool.query(
      `INSERT INTO student_general_code_counters (school_id, creation_year, last_value)
       VALUES ($1, 2025, 18), ($1, 2026, 27)`,
      [school.schoolId],
    );
    await insertExistingSeq5(pool, school.schoolId, 40);
    await bootCurrentIdentity(repo);
    const after = await inspectCounterSchema(pool);
    assertCanonicalCounter(after, { lastValueBySchool: { [school.schoolId]: 40 } });
    const created = await repo.enrollStudentInClass(school.classCode, school.schoolCode, {
      firstName: "Léa",
      lastName: "Martin",
    });
    assert.equal(Number(created.student.studentCode.slice(-5)), 41);
    console.log("studentGeneralCountersUpgrade: SEQ5 existant > MAX historique OK");
  } finally {
    await pool.end();
  }
}

async function scenarioAbsentV2Empty() {
  const isolatedUrl = await ensureIsolatedDatabase(
    DATABASE_URL,
    dbName("SOMAFRIK_STUDENT_COUNTERS_SHAPES_IT_DATABASE", "somafrik_student_counters_shapes_it"),
  );
  const repo = createPostgresRepository(isolatedUrl);
  const pool = repo.pool;
  try {
    process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
    await repo.init();
    const school = await seedSchoolClass(pool);

    const absent = await inspectCounterSchema(pool);
    assert.equal(absent.present, false, "table absente avant boot");
    await bootCurrentIdentity(repo);
    await bootCurrentIdentity(repo);
    assertCanonicalCounter(await inspectCounterSchema(pool));

    await pool.query(`DROP TABLE student_general_code_counters`);
    await pool.query(createLegacyCounterTableSql());
    await bootCurrentIdentity(repo);
    const empty = await inspectCounterSchema(pool);
    assertCanonicalCounter(empty);
    assert.equal(empty.rows.length, 0, "table V1 vide → V2 vide");

    const created = await repo.enrollStudentInClass(school.classCode, school.schoolCode, {
      firstName: "Nia",
      lastName: "Kone",
    });
    assert.equal(Number(created.student.studentCode.slice(-5)), 1);
    console.log("studentGeneralCountersUpgrade: table absente / V2 / V1 vide OK");
  } finally {
    await pool.end();
  }
}

async function scenarioProductionLikeHttp() {
  const isolatedUrl = await ensureIsolatedDatabase(
    DATABASE_URL,
    dbName("SOMAFRIK_STUDENT_COUNTERS_HTTP_IT_DATABASE", "somafrik_student_counters_http_it"),
  );
  const repo = createPostgresRepository(isolatedUrl);
  const pool = repo.pool;
  let child;
  let stderr = "";
  try {
    process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
    await repo.init();
    const school = await seedSchoolClass(pool);
    const seeded = await seedLegacyStudentsAndStaff(pool, school.schoolId);
    await pool.query(createLegacyCounterTableSql());
    await pool.query(
      `INSERT INTO student_general_code_counters (school_id, creation_year, last_value)
       VALUES ($1, 2025, 18), ($1, 2026, 27)`,
      [school.schoolId],
    );
    const before = await inspectCounterSchema(pool);
    assert.deepEqual(before.pk, ["school_id", "creation_year"]);

    child = spawn(process.execPath, ["server.js"], {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(HTTP_PORT),
        DATABASE_URL: isolatedUrl,
        JWT_SECRET: process.env.JWT_SECRET || "ci-counters-upgrade-jwt-secret-32chars",
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        SOMAFRIK_API_ONLY: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on("data", () => {});

    await waitForHealth(child);
    assert.doesNotMatch(stderr, /42P10/);
    assert.doesNotMatch(stderr, /no unique or exclusion constraint matching the ON CONFLICT/i);

    const login = await httpRequest("/backoffice/login", {
      method: "POST",
      body: {
        identifier: "admin@nuru.test",
        password: ADMIN_PASSWORD,
        schoolCode: school.schoolCode,
      },
    });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const token = login.data.accessToken || login.data.token;
    assert.ok(token, "token login admin");

    const enrolled = await httpRequest(`/classes/${encodeURIComponent(school.classCode)}/students`, {
      method: "POST",
      token,
      body: { firstName: "ESTHER", lastName: "OKITO", gender: "Féminin", birthDate: "2010-03-05" },
    });
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data));
    const studentCode = String(enrolled.data?.student?.studentCode ?? "");
    const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
    assert.match(studentCode, new RegExp(`^CD-IN-OE-${yy}-\\d{5}$`));
    assert.notEqual(studentCode, seeded.staffIdentity);
    assert.equal(Number(studentCode.slice(-5)), 28);
    assert.equal(enrolled.data.credentials.login, studentCode);

    const aligned = await pool.query(
      `SELECT
         st.student_code, st.login_code, st.identity_code,
         u.user_code, u.identity_code AS user_identity,
         e.status AS enrollment_status
       FROM students st
       JOIN users u ON u.school_id = st.school_id AND u.user_code = st.student_code
       JOIN enrollments e ON e.student_id = st.id AND e.status = 'active'
       WHERE st.student_code = $1`,
      [studentCode],
    );
    assert.equal(aligned.rowCount, 1, "student/user/enrollment atomiques");
    const stillLegacy = await pool.query(
      `SELECT COUNT(*)::int AS n FROM students
       WHERE student_code IN ('CD-IN-EL-26-001', 'CD-IN-EL-26-002')`,
    );
    assert.equal(stillLegacy.rows[0].n, 2);

    await stopChild(child);
    child = null;
    await bootCurrentIdentity(repo);
    const after = await inspectCounterSchema(pool);
    assertCanonicalCounter(after, { lastValueBySchool: { [school.schoolId]: 28 } });
    console.log("studentGeneralCountersUpgrade: production-like HTTP 201 OK", studentCode);
  } catch (error) {
    if (stderr) {
      console.error(stderr.slice(-4000));
    }
    throw error;
  } finally {
    await stopChild(child);
    await pool.end();
  }
}

async function main() {
  requireDatabaseUrl();
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  await scenarioMultiYearAndIdempotent();
  await scenarioSeq5AboveHistorical();
  await scenarioAbsentV2Empty();
  await scenarioProductionLikeHttp();
  console.log("studentGeneralCountersUpgrade.pg.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
