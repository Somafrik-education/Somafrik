"use strict";

/**
 * Revalidation P0 Planning / Présences / Sync E2E — dual-identity A/B.
 * leftover JWT ≠ login_code du même tenant. Invariants, pas de verdissement.
 *
 * A: school_code=CD-2026-0001 login_code=CD-LAC-26-001
 * B: school_code=BI-2026-0001 login_code=BI-BUJ-26-001
 * A2 (même pays CD): school_code=CD-2026-0002 login_code=CD-LAC-26-002
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_PPS_REVALIDATION_IT_DATABASE ?? "somafrik_pps_revalidation_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_PPS_HTTP_PORT ?? 19892);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";
const LEFTOVER_A2 = "CD-2026-0002";
const LOGIN_A2 = "CD-LAC-26-002";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const USER_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const USER_TEACHER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04";
const USER_TEACHER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05";
const USER_NO_SCHOOL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06";
const USER_NO_LOGIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07";
const USER_SUPER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa08";
const USER_PAYS_CD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09";

const TEACHER_A = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const TEACHER_B = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const TEACHER_A2 = "cccccccc-cccc-4ccc-8ccc-cccccccccc03";
const SUBJECT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const SUBJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";
const SUBJECT_A2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03";
const SLOT_A = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const SLOT_B = "dddddddd-dddd-4ddd-8ddd-dddddddddd02";
const SLOT_A2 = "dddddddd-dddd-4ddd-8ddd-dddddddddd03";
const STUDENT_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const STUDENT_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const STUDENT_A2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";
const PRESENCE_A = "ffffffff-ffff-4fff-8fff-ffffffffff01";
const PRESENCE_B = "ffffffff-ffff-4fff-8fff-ffffffffff02";

const CLASS_A = "CLS-LAC-6A";
const CLASS_B = "CLS-BUJ-6A";
const CLASS_A2 = "CLS-LAC-6B";
const COURSE_A = "CRS-LAC-MATH";
const COURSE_A_FREE = "CRS-LAC-FR";
const COURSE_B = "CRS-BUJ-MATH";
const COURSE_A2 = "CRS-LAC2-MATH";
const TEACHER_CODE_A = "TCH-LAC-01";
const TEACHER_CODE_B = "TCH-BUJ-01";
const TEACHER_CODE_A2 = "TCH-LAC-02";

const PERMS = ["ALL_PRIVILEGES"];
const TEACHER_PERMS = [
  "Planning de cours:READ",
  "Présences:READ",
  "Présences:CREATE",
  "Présences:UPDATE",
  "Classes:READ",
  "Élèves:READ",
  "Affectations:READ",
  "Matières:READ",
];

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function request(pathname, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.rows)) return data.rows;
  return [];
}

function failClosed(status) {
  return status === 401 || status === 403 || status === 400;
}

function sealedOrDenied(status) {
  return status === 200 || status === 201 || failClosed(status);
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
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

async function setLoginCodeTriggers(pool, enabled) {
  const action = enabled ? "ENABLE" : "DISABLE";
  await pool.query(`
    DO $trg$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_schools_login_code_insert') THEN
        EXECUTE 'ALTER TABLE schools ${action} TRIGGER zz_schools_login_code_insert';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_schools_login_code_update') THEN
        EXECUTE 'ALTER TABLE schools ${action} TRIGGER zz_schools_login_code_update';
      END IF;
    END
    $trg$;
  `);
}

async function ensureCountry(pool, name, iso, phone, currency) {
  const existing = await pool.query(`SELECT id FROM countries WHERE iso_code = $1 LIMIT 1`, [iso]);
  if (existing.rowCount) return existing.rows[0];
  const inserted = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, iso, phone, currency],
  );
  return inserted.rows[0];
}

async function grantModule(pool, roleKey, moduleKey, canWrite = false) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = upper($1)
       AND module_key = $2
       AND scope_type = 'global'
       AND status = 'active'
     LIMIT 1`,
    [roleKey, moduleKey],
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_read = TRUE, can_create = $2, can_update = $2, updated_by = 'pps-revalidation', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, canWrite],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', $2, $3, TRUE, $3, FALSE, 'pps-revalidation')`,
    [roleKey, moduleKey, canWrite],
  );
}

async function seed(pool) {
  await setLoginCodeTriggers(pool, false);
  const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
  const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status, profile_payload)
     VALUES ($1, $2, $3, 'LAC', 'Lycée Lac', 'active', '{"timezone":"Africa/Kinshasa"}'::jsonb)
     RETURNING id, school_code, login_code`,
    [cd.id, LEFTOVER_A, LOGIN_A],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status, profile_payload)
     VALUES ($1, $2, $3, 'BUJ', 'Lycée Bujumbura', 'active', '{"timezone":"Africa/Bujumbura"}'::jsonb)
     RETURNING id, school_code, login_code`,
    [bi.id, LEFTOVER_B, LOGIN_B],
  );
  const schoolA2 = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'L2', 'Lycée Lac 2', 'active')
     RETURNING id, school_code, login_code`,
    [cd.id, LEFTOVER_A2, LOGIN_A2],
  );
  await setLoginCodeTriggers(pool, true);

  const schoolAId = schoolA.rows[0].id;
  const schoolBId = schoolB.rows[0].id;
  const schoolA2Id = schoolA2.rows[0].id;
  assert.notEqual(schoolA.rows[0].school_code, schoolA.rows[0].login_code);
  assert.notEqual(schoolB.rows[0].school_code, schoolB.rows[0].login_code);
  assert.notEqual(schoolA2.rows[0].school_code, schoolA2.rows[0].login_code);

  const yearA = await pool.query(
    `INSERT INTO academic_years (school_id, name, is_current, status)
     VALUES ($1, '2026-2027', TRUE, 'open') RETURNING id`,
    [schoolAId],
  );
  const yearB = await pool.query(
    `INSERT INTO academic_years (school_id, name, is_current, status)
     VALUES ($1, '2026-2027', TRUE, 'open') RETURNING id`,
    [schoolBId],
  );
  const yearA2 = await pool.query(
    `INSERT INTO academic_years (school_id, name, is_current, status)
     VALUES ($1, '2026-2027', TRUE, 'open') RETURNING id`,
    [schoolA2Id],
  );

  const classA = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, '6ème A Lac', 'active') RETURNING id`,
    [schoolAId, yearA.rows[0].id, CLASS_A],
  );
  const classB = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, '6ème A Buj', 'active') RETURNING id`,
    [schoolBId, yearB.rows[0].id, CLASS_B],
  );
  const classA2 = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, '6ème B Lac2', 'active') RETURNING id`,
    [schoolA2Id, yearA2.rows[0].id, CLASS_A2],
  );

  await pool.query(
    `INSERT INTO subjects (id, school_id, subject_code, name, coefficient, status)
     VALUES
       ($1, $4, 'SUB-LAC-MATH', 'Mathématiques', 1, 'active'),
       ($2, $5, 'SUB-BUJ-MATH', 'Mathématiques', 1, 'active'),
       ($3, $6, 'SUB-LAC2-MATH', 'Mathématiques', 1, 'active'),
       ($7, $4, 'SUB-LAC-FR', 'Français', 1, 'active')`,
    [SUBJECT_A, SUBJECT_B, SUBJECT_A2, schoolAId, schoolBId, schoolA2Id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04"],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $10, 'ADM-A', 'Aline', 'A', 'a@pps.gp.test', 'Admin School', 'active', FALSE),
       ($2, $11, 'ADM-B', 'Binta', 'B', 'b@pps.gp.test', 'Admin School', 'active', FALSE),
       ($3, $12, 'ADM-A2', 'Awa', 'A2', 'a2@pps.gp.test', 'Admin School', 'active', FALSE),
       ($4, $10, 'TCH-A', 'Tana', 'A', 'ta@pps.gp.test', 'Enseignant', 'active', FALSE),
       ($5, $11, 'TCH-B', 'Tito', 'B', 'tb@pps.gp.test', 'Enseignant', 'active', FALSE),
       ($6, NULL, 'ADM-NS', 'Sans', 'Ecole', 'ns@pps.gp.test', 'Admin School', 'active', FALSE),
       ($7, NULL, 'SUPER', 'Super', 'Admin', 'super@pps.gp.test', 'Super Administrateur Somafrik', 'active', FALSE),
       ($8, NULL, 'PAYS-CD', 'Admin', 'Pays', 'pays@pps.gp.test', 'Admin Pays', 'active', FALSE),
       ($9, $10, 'TCH-A2U', 'Tama', 'A2', 'ta2@pps.gp.test', 'Enseignant', 'active', FALSE)`,
    [
      USER_A,
      USER_B,
      USER_A2,
      USER_TEACHER_A,
      USER_TEACHER_B,
      USER_NO_SCHOOL,
      USER_SUPER,
      USER_PAYS_CD,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0a",
      schoolAId,
      schoolBId,
      schoolA2Id,
    ],
  );
  await pool.query(`UPDATE users SET profile_payload = jsonb_build_object('countryCode', 'CD') WHERE id = $1`, [
    USER_PAYS_CD,
  ]);
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $6, 'SCHOOL_ADMIN', 'active'),
       ($2, $7, 'SCHOOL_ADMIN', 'active'),
       ($3, $8, 'SCHOOL_ADMIN', 'active'),
       ($4, $6, 'TEACHER', 'active'),
       ($5, $7, 'TEACHER', 'active'),
       ($9, NULL, 'SUPER_ADMIN', 'active'),
       ($10, NULL, 'COUNTRY_ADMIN', 'active')`,
    [USER_A, USER_B, USER_A2, USER_TEACHER_A, USER_TEACHER_B, schoolAId, schoolBId, schoolA2Id, USER_SUPER, USER_PAYS_CD],
  );

  await pool.query(
    `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
     VALUES
       ($1, $4, $7, $10, 'active'),
       ($2, $5, $8, $11, 'active'),
       ($3, $6, $9, $12, 'active')`,
    [
      TEACHER_A,
      TEACHER_B,
      TEACHER_A2,
      schoolAId,
      schoolBId,
      schoolA2Id,
      USER_TEACHER_A,
      USER_TEACHER_B,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0a",
      TEACHER_CODE_A,
      TEACHER_CODE_B,
      TEACHER_CODE_A2,
    ],
  );

  const subjectFr = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04";
  const courseA = await pool.query(
    `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
     VALUES ($1, $2, $3, $4, $5, 1, 'active') RETURNING id`,
    [schoolAId, classA.rows[0].id, SUBJECT_A, TEACHER_A, COURSE_A],
  );
  const courseAFree = await pool.query(
    `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
     VALUES ($1, $2, $3, $4, $5, 1, 'active') RETURNING id`,
    [schoolAId, classA.rows[0].id, subjectFr, TEACHER_A, COURSE_A_FREE],
  );
  const courseB = await pool.query(
    `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
     VALUES ($1, $2, $3, $4, $5, 1, 'active') RETURNING id`,
    [schoolBId, classB.rows[0].id, SUBJECT_B, TEACHER_B, COURSE_B],
  );
  const courseA2 = await pool.query(
    `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
     VALUES ($1, $2, $3, $4, $5, 1, 'active') RETURNING id`,
    [schoolA2Id, classA2.rows[0].id, SUBJECT_A2, TEACHER_A2, COURSE_A2],
  );

  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES
       ($1, $4, $7, $10, $13, 'active'),
       ($2, $5, $8, $11, $14, 'active'),
       ($3, $6, $9, $12, $15, 'active'),
       ($1, $4, $7, $16, $13, 'active')`,
    [
      schoolAId,
      schoolBId,
      schoolA2Id,
      TEACHER_A,
      TEACHER_B,
      TEACHER_A2,
      classA.rows[0].id,
      classB.rows[0].id,
      classA2.rows[0].id,
      SUBJECT_A,
      SUBJECT_B,
      SUBJECT_A2,
      yearA.rows[0].id,
      yearB.rows[0].id,
      yearA2.rows[0].id,
      subjectFr,
    ],
  );

  await pool.query(
    `INSERT INTO course_schedule_weekly_slots
       (id, school_id, academic_year_id, school_course_id, class_id, teacher_id,
        day_of_week, start_time, end_time, status)
     VALUES
       ($1, $4, $7, $10, $13, $16, 1, '08:00', '09:00', 'active'),
       ($2, $5, $8, $11, $14, $17, 1, '08:00', '09:00', 'active'),
       ($3, $6, $9, $12, $15, $18, 1, '08:00', '09:00', 'active')`,
    [
      SLOT_A,
      SLOT_B,
      SLOT_A2,
      schoolAId,
      schoolBId,
      schoolA2Id,
      yearA.rows[0].id,
      yearB.rows[0].id,
      yearA2.rows[0].id,
      courseA.rows[0].id,
      courseB.rows[0].id,
      courseA2.rows[0].id,
      classA.rows[0].id,
      classB.rows[0].id,
      classA2.rows[0].id,
      TEACHER_A,
      TEACHER_B,
      TEACHER_A2,
    ],
  );

  await pool.query(
    `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
     VALUES
       ($1, $4, 'STU-A-001', 'Eleve', 'A', 'active'),
       ($2, $5, 'STU-B-001', 'Eleve', 'B', 'active'),
       ($3, $6, 'STU-A2-001', 'Eleve', 'A2', 'active')`,
    [STUDENT_A, STUDENT_B, STUDENT_A2, schoolAId, schoolBId, schoolA2Id],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES
       ($1, $4, $7, $10, 'active'),
       ($2, $5, $8, $11, 'active'),
       ($3, $6, $9, $12, 'active')`,
    [
      schoolAId,
      schoolBId,
      schoolA2Id,
      STUDENT_A,
      STUDENT_B,
      STUDENT_A2,
      classA.rows[0].id,
      classB.rows[0].id,
      classA2.rows[0].id,
      yearA.rows[0].id,
      yearB.rows[0].id,
      yearA2.rows[0].id,
    ],
  );
  await pool.query(
    `INSERT INTO attendance (id, school_id, student_id, class_id, teacher_id, attendance_date, status)
     VALUES
       ($1, $3, $5, $7, $9, '2026-08-31', 'present'),
       ($2, $4, $6, $8, $10, '2026-08-31', 'present')`,
    [PRESENCE_A, PRESENCE_B, schoolAId, schoolBId, STUDENT_A, STUDENT_B, classA.rows[0].id, classB.rows[0].id, TEACHER_A, TEACHER_B],
  );

  for (const role of ["SCHOOL_ADMIN", "TEACHER", "COUNTRY_ADMIN", "SUPER_ADMIN"]) {
    await grantModule(pool, role, "classes", role !== "TEACHER");
    await grantModule(pool, role, "students", role !== "TEACHER");
    await grantModule(pool, role, "assignments", role !== "TEACHER");
    await grantModule(pool, role, "subjects", role !== "TEACHER");
    await grantModule(pool, role, "planning", role === "SCHOOL_ADMIN" || role === "SUPER_ADMIN" || role === "COUNTRY_ADMIN");
    await grantModule(pool, role, "attendance", true);
  }
  await grantModule(pool, "TEACHER", "planning", false);

  return {
    schoolAId,
    schoolBId,
    schoolA2Id,
    courseAId: courseA.rows[0].id,
    courseAFreeId: courseAFree.rows[0].id,
    courseBId: courseB.rows[0].id,
    yearAId: yearA.rows[0].id,
  };
}

function idsOf(rows) {
  return rows.map((row) => String(row.id ?? row.publicId ?? row.classCode ?? "")).filter(Boolean);
}

function mentionsB(rows) {
  return unwrapList(rows).some((row) => {
    const blob = JSON.stringify(row).toUpperCase();
    return (
      blob.includes(LEFTOVER_B) ||
      blob.includes(LOGIN_B) ||
      blob.includes(CLASS_B) ||
      blob.includes("STU-B-001") ||
      blob.includes(SLOT_B.toUpperCase()) ||
      blob.includes(COURSE_B)
    );
  });
}

function mentionsA2(rows) {
  return unwrapList(rows).some((row) => {
    const blob = JSON.stringify(row).toUpperCase();
    return blob.includes(LEFTOVER_A2) || blob.includes(LOGIN_A2) || blob.includes(CLASS_A2) || blob.includes("STU-A2-001");
  });
}

function mentionsA(rows) {
  return unwrapList(rows).some((row) => {
    const blob = JSON.stringify(row).toUpperCase();
    return blob.includes(CLASS_A) || blob.includes("STU-A-001") || blob.includes(SLOT_A.toUpperCase()) || blob.includes(COURSE_A);
  });
}

async function main() {
  if (!DATABASE_URL) {
    console.log("planningPresenceSyncRevalidation.http.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: isolatedUrl });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }

  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const repo = createPostgresRepository(isolatedUrl);
  const tokens = new TokenService({ secret: JWT_SECRET });
  const mint = (payload) => tokens.createAccessToken({ mustChangePassword: false, ...payload });
  const pool = new Pool({ connectionString: isolatedUrl });
  let child = null;

  try {
    await repo.init();
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    const fixture = await seed(repo.pool);

    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(HTTP_PORT),
        DATABASE_URL: isolatedUrl,
        JWT_SECRET,
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        SOMAFRIK_API_ONLY: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrRef = { value: "" };
    child.stderr.on("data", (chunk) => {
      stderrRef.value += String(chunk);
    });
    await waitForHealth(child, stderrRef);

    const tokenA = mint({
      sub: USER_A,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: PERMS,
    });
    const tokenB = mint({
      sub: USER_B,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_B,
      permissions: PERMS,
    });
    const tokenA2 = mint({
      sub: USER_A2,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A2,
      permissions: PERMS,
    });
    const tokenForgedB = mint({
      sub: USER_A,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_B,
      permissions: PERMS,
    });
    const tokenNoSub = mint({
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: PERMS,
    });
    const tokenNoSchool = mint({
      sub: USER_NO_SCHOOL,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: PERMS,
    });
    const tokenTeacherA = mint({
      sub: USER_TEACHER_A,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: TEACHER_PERMS,
    });
    const tokenSuper = mint({
      sub: USER_SUPER,
      role: "Super Administrateur Somafrik",
      roleKeys: ["SUPER_ADMIN"],
      schoolCode: "*",
      permissions: PERMS,
    });
    const tokenPaysCd = mint({
      sub: USER_PAYS_CD,
      role: "Admin Pays",
      roleKeys: ["COUNTRY_ADMIN"],
      schoolCode: "*",
      countryCode: "CD",
      permissions: PERMS,
    });

    const results = [];
    const check = (id, ok, detail) => {
      results.push({ id, ok: Boolean(ok), detail: String(detail ?? "") });
      console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail}`);
    };

    const getSchedulesA = await request("/course-schedules", { token: tokenA });
    const schedulesA = unwrapList(getSchedulesA.data);
    check("PL-01", getSchedulesA.status === 200, `GET schedules A status=${getSchedulesA.status}`);
    check("PL-01", mentionsA(schedulesA) || idsOf(schedulesA).includes(SLOT_A), "user A doit voir le créneau A");
    check("PL-01", !mentionsB(schedulesA), "A ne doit pas voir B");
    check("PL-12", !mentionsA2(schedulesA), "A ne doit pas voir A2 même pays");
    check(
      "PL-14",
      schedulesA.every((row) => !row.schoolCode || row.schoolCode === LOGIN_A),
      `projection schoolCode planning=${schedulesA.map((row) => row.schoolCode).join(",") || "vide"} (désiré ${LOGIN_A})`,
    );

    const getSchedulesForged = await request("/course-schedules", { token: tokenForgedB });
    check("PL-02", sealedOrDenied(getSchedulesForged.status), `status=${getSchedulesForged.status}`);
    check("PL-02", !mentionsB(unwrapList(getSchedulesForged.data)), "JWT leftover B depuis user A ne doit jamais lister B");

    const getSchedulesHeader = await request("/course-schedules", {
      token: tokenA,
      headers: { "X-Somafrik-School-Code": LOGIN_B },
    });
    check("PL-03", !mentionsB(unwrapList(getSchedulesHeader.data)), "header schoolCode B depuis A");
    const getSchedulesQuery = await request(`/course-schedules?schoolCode=${encodeURIComponent(LOGIN_B)}`, {
      token: tokenA,
    });
    check("PL-03", !mentionsB(unwrapList(getSchedulesQuery.data)), "query schoolCode B depuis A");

    const countBSlotsBefore = (
      await pool.query(`SELECT count(*)::int AS c FROM course_schedule_weekly_slots WHERE school_id = $1 AND status = 'active'`, [
        fixture.schoolBId,
      ])
    ).rows[0].c;
    const postBCourse = await request("/course-schedules", {
      method: "POST",
      token: tokenA,
      body: {
        schoolCourseId: fixture.courseBId,
        academicYearId: fixture.yearAId,
        dayOfWeek: 2,
        startTime: "10:00",
        endTime: "11:00",
        schoolCode: LOGIN_B,
      },
    });
    const countBSlotsAfter = (
      await pool.query(`SELECT count(*)::int AS c FROM course_schedule_weekly_slots WHERE school_id = $1 AND status = 'active'`, [
        fixture.schoolBId,
      ])
    ).rows[0].c;
    check("PL-04", postBCourse.status === 403 || postBCourse.status === 404 || postBCourse.status === 400, `POST course B status=${postBCourse.status}`);
    check("PL-04", countBSlotsAfter === countBSlotsBefore, "0 write B");

    const slotBBefore = await pool.query(`SELECT day_of_week, start_time FROM course_schedule_weekly_slots WHERE id = $1`, [SLOT_B]);
    const patchB = await request(`/course-schedules/${SLOT_B}`, {
      method: "PATCH",
      token: tokenA,
      body: { dayOfWeek: 3, startTime: "14:00", endTime: "15:00" },
    });
    const slotBAfter = await pool.query(`SELECT day_of_week, start_time FROM course_schedule_weekly_slots WHERE id = $1`, [SLOT_B]);
    check("PL-05", patchB.status === 403 || patchB.status === 404, `PATCH slot B status=${patchB.status}`);
    check("PL-05", String(slotBAfter.rows[0].day_of_week) === String(slotBBefore.rows[0].day_of_week), "0 mutation B");

    const deleteB = await request(`/course-schedules/${SLOT_B}`, { method: "DELETE", token: tokenA });
    const slotBStill = await pool.query(`SELECT status FROM course_schedule_weekly_slots WHERE id = $1`, [SLOT_B]);
    check("PL-05", deleteB.status === 403 || deleteB.status === 404, `DELETE slot B status=${deleteB.status}`);
    check("PL-05", slotBStill.rows[0].status === "active", "0 cancel B");

    const getNoSubPlanning = await request("/course-schedules", { token: tokenNoSub });
    check("PL-06", failClosed(getNoSubPlanning.status), `sans sub status=${getNoSubPlanning.status}`);
    check("PL-06", !mentionsB(unwrapList(getNoSubPlanning.data)), "sans sub jamais B");

    const getNoSchoolPlanning = await request("/course-schedules", { token: tokenNoSchool });
    check("PL-07", failClosed(getNoSchoolPlanning.status), `sans school_id status=${getNoSchoolPlanning.status}`);

    const getSchedulesB = await request("/course-schedules", { token: tokenB });
    check("PL-09", getSchedulesB.status === 200, `GET B status=${getSchedulesB.status}`);
    check("PL-09", !mentionsA(unwrapList(getSchedulesB.data)), "B ne voit jamais A");
    check(
      "PL-09",
      unwrapList(getSchedulesB.data).every((row) => !row.schoolCode || row.schoolCode === LOGIN_B),
      "projection login_code B",
    );

    const getTeacher = await request("/course-schedules", { token: tokenTeacherA });
    check("PL-13", getTeacher.status === 200 || failClosed(getTeacher.status), `teacher status=${getTeacher.status}`);
    check("PL-13", !mentionsB(unwrapList(getTeacher.data)), "enseignant A jamais B");

    const getSuperPlanning = await request("/course-schedules", { token: tokenSuper });
    check("PL-10", getSuperPlanning.status === 200 || getSuperPlanning.status === 400, `Superadmin status=${getSuperPlanning.status}`);

    const getPaysPlanning = await request("/course-schedules", { token: tokenPaysCd });
    check("PL-11", !mentionsB(unwrapList(getPaysPlanning.data)), "Admin Pays CD ne voit pas BI");

    const getPresencesA = await request("/presences", { token: tokenA });
    const presencesA = unwrapList(getPresencesA.data);
    check("PR-01", getPresencesA.status === 200, `GET presences A status=${getPresencesA.status}`);
    check(
      "PR-01",
      presencesA.some((row) => String(row.studentId ?? "") === "STU-A-001" || String(row.id ?? "") === PRESENCE_A),
      "A doit voir présence A",
    );
    check("PR-01", !mentionsB(presencesA), "A ne doit pas voir B");
    check("PR-01", !mentionsA2(presencesA), "A ne doit pas voir A2");
    check(
      "PR-01",
      presencesA.every((row) => !row.schoolCode || row.schoolCode === LOGIN_A),
      `projection schoolCode=${presencesA.map((row) => row.schoolCode).join(",") || "vide"} (désiré ${LOGIN_A})`,
    );

    const getPresencesForged = await request("/presences", { token: tokenForgedB });
    check("PR-02", sealedOrDenied(getPresencesForged.status), `status=${getPresencesForged.status}`);
    check("PR-02", !mentionsB(unwrapList(getPresencesForged.data)), "JWT leftover B depuis user A ne doit jamais lister B");

    const getPresencesHeader = await request("/presences", {
      token: tokenA,
      headers: { "X-Somafrik-School-Code": LOGIN_B },
    });
    check("PR-03", !mentionsB(unwrapList(getPresencesHeader.data)), "header schoolCode B depuis A");

    const countBAttBefore = (
      await pool.query(`SELECT count(*)::int AS c FROM attendance WHERE school_id = $1`, [fixture.schoolBId])
    ).rows[0].c;
    const postPresenceB = await request("/presences", {
      method: "POST",
      token: tokenA,
      body: {
        classCode: CLASS_B,
        teacherId: TEACHER_CODE_B,
        schoolCode: LOGIN_B,
        items: [{ studentId: "STU-B-001", date: "2026-09-01", status: "Présent", classCode: CLASS_B }],
      },
    });
    const countBAttAfter = (
      await pool.query(`SELECT count(*)::int AS c FROM attendance WHERE school_id = $1`, [fixture.schoolBId])
    ).rows[0].c;
    check(
      "PR-04",
      postPresenceB.status === 403 || postPresenceB.status === 404 || postPresenceB.status === 409,
      `POST présence B status=${postPresenceB.status}`,
    );
    check("PR-04", countBAttAfter === countBAttBefore, "0 write B");

    const postPresenceForged = await request("/presences", {
      method: "POST",
      token: tokenForgedB,
      body: {
        classCode: CLASS_B,
        teacherId: TEACHER_CODE_B,
        items: [{ studentId: "STU-B-001", date: "2026-09-02", status: "Présent", classCode: CLASS_B }],
      },
    });
    const countBAttForged = (
      await pool.query(`SELECT count(*)::int AS c FROM attendance WHERE school_id = $1`, [fixture.schoolBId])
    ).rows[0].c;
    check(
      "PR-05",
      postPresenceForged.status === 403 ||
        postPresenceForged.status === 404 ||
        postPresenceForged.status === 409 ||
        failClosed(postPresenceForged.status),
      `JWT leftover B POST présence B status=${postPresenceForged.status}`,
    );
    check("PR-05", countBAttForged === countBAttBefore, "0 write B via JWT leftover");

    const getNoSubPresence = await request("/presences", { token: tokenNoSub });
    check("PR-06", failClosed(getNoSubPresence.status), `sans sub status=${getNoSubPresence.status}`);
    const getNoSchoolPresence = await request("/presences", { token: tokenNoSchool });
    check("PR-07", failClosed(getNoSchoolPresence.status), `sans school_id status=${getNoSchoolPresence.status}`);

    const getPresencesB = await request("/presences", { token: tokenB });
    check("PR-09", getPresencesB.status === 200, `GET B status=${getPresencesB.status}`);
    check("PR-09", !mentionsA(unwrapList(getPresencesB.data)), "B ne voit jamais A");

    const getPaysPresence = await request("/presences", { token: tokenPaysCd });
    check("PR-10", !mentionsB(unwrapList(getPaysPresence.data)), "Admin Pays CD ne voit pas BI");

    const teacherWriteB = await request("/presences", {
      method: "POST",
      token: tokenTeacherA,
      body: {
        classCode: CLASS_B,
        items: [{ studentId: "STU-B-001", date: "2026-09-03", status: "Présent", classCode: CLASS_B }],
      },
    });
    const countBAttTeacher = (
      await pool.query(`SELECT count(*)::int AS c FROM attendance WHERE school_id = $1`, [fixture.schoolBId])
    ).rows[0].c;
    check(
      "PR-11",
      teacherWriteB.status === 403 || teacherWriteB.status === 404 || failClosed(teacherWriteB.status),
      `teacher POST B status=${teacherWriteB.status}`,
    );
    check("PR-11", countBAttTeacher === countBAttBefore, "enseignant A 0 write B");

    const syncPaths = [
      ["/mobile-sync/l1/classes", "SY-01"],
      ["/mobile-sync/l1/students", "SY-02"],
      ["/mobile-sync/l1/assignments", "SY-03"],
      ["/mobile-sync/l1/school-courses", "SY-04"],
      ["/mobile-sync/l1/course-schedules", "SY-05"],
    ];
    for (const [pathname, id] of syncPaths) {
      const resA = await request(pathname, { token: tokenA });
      check(id, resA.status === 200 || failClosed(resA.status), `GET A status=${resA.status}`);
      check(id, !mentionsB(unwrapList(resA.data)), "A ne doit jamais synchroniser B");
      check(id, !mentionsA2(unwrapList(resA.data)), "A ne doit jamais synchroniser A2");

      const resForged = await request(pathname, { token: tokenForgedB });
      check("SY-06", sealedOrDenied(resForged.status), `${id} JWT leftover B status=${resForged.status}`);
      check("SY-06", !mentionsB(unwrapList(resForged.data)), `${id} JWT leftover B depuis A jamais B`);

      const resHeader = await request(pathname, {
        token: tokenA,
        headers: { "X-Somafrik-School-Code": LOGIN_B },
      });
      check(id, !mentionsB(unwrapList(resHeader.data)), "header B depuis A jamais B");

      const resNoSub = await request(pathname, { token: tokenNoSub });
      check("SY-07", failClosed(resNoSub.status), `${id} sans sub status=${resNoSub.status}`);

      const resPays = await request(pathname, { token: tokenPaysCd });
      check("SY-10", !mentionsB(unwrapList(resPays.data)), `${id} Admin Pays CD jamais BI`);
    }

    const getA2 = await request("/course-schedules", { token: tokenA2 });
    check("PL-12", getA2.status === 200, `GET A2 status=${getA2.status}`);
    check("PL-12", !mentionsA(unwrapList(getA2.data)), "A2 ne voit pas A");
    check("PL-12", !mentionsB(unwrapList(getA2.data)), "A2 jamais B");

    await setLoginCodeTriggers(pool, false);
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    const cdId = (await pool.query(`SELECT id FROM countries WHERE iso_code = 'CD' LIMIT 1`)).rows[0].id;
    const emptySchool = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1, 'CD-2026-0099', NULL, 'SLG', 'École sans login', 'active')
       RETURNING id`,
      [cdId],
    );
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'ADM-NL', 'Sans', 'Login', 'nl@pps.gp.test', 'Admin School', 'active', FALSE)`,
      [USER_NO_LOGIN, emptySchool.rows[0].id],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES ($1, $2, 'SCHOOL_ADMIN', 'active')`,
      [USER_NO_LOGIN, emptySchool.rows[0].id],
    );
    const tokenNoLogin = mint({
      sub: USER_NO_LOGIN,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "CD-2026-0099",
      permissions: PERMS,
    });
    const getNoLoginPlanning = await request("/course-schedules", { token: tokenNoLogin });
    check("PL-08", failClosed(getNoLoginPlanning.status), `login_code vide status=${getNoLoginPlanning.status}`);
    const getNoLoginPresence = await request("/presences", { token: tokenNoLogin });
    check("PR-08", failClosed(getNoLoginPresence.status), `login_code vide status=${getNoLoginPresence.status}`);
    const getNoLoginSync = await request("/mobile-sync/l1/classes", { token: tokenNoLogin });
    check("SY-08", failClosed(getNoLoginSync.status), `login_code vide status=${getNoLoginSync.status}`);

    const getSuperSync = await request("/mobile-sync/l1/classes", { token: tokenSuper });
    check("SY-09", getSuperSync.status === 200 || getSuperSync.status === 400, `Superadmin status=${getSuperSync.status}`);

    const failed = results.filter((row) => !row.ok);
    console.log(`planningPresenceSyncRevalidation matrix: ${results.filter((row) => row.ok).length} PASS / ${failed.length} FAIL / ${results.length} checks`);
    if (failed.length) {
      const summary = failed.map((row) => `${row.id}: ${row.detail}`).join("\n");
      throw new Error(`invariants Planning/Présences/Sync cassés:\n${summary}`);
    }
    console.log("OK planningPresenceSyncRevalidation.http.pg.test.js — PL/PR/SY invariants dual-identity");

  } finally {
    await stopChild(child);
    await pool.end();
    if (typeof repo.close === "function") await repo.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
