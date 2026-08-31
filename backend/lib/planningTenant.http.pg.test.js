"use strict";

/**
 * GP-014 — leftover JWT ≠ login_code du même tenant.
 * Dual-identity A/B + fail-closed + Admin Pays borné au pays.
 * GET/POST/PATCH/DELETE /api/course-schedules uniquement.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_PLANNING_TENANT_IT_DATABASE ?? "somafrik_planning_tenant_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_PLANNING_TENANT_HTTP_PORT ?? 19893);
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
const SUBJECT_FR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04";
const SLOT_A = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const SLOT_B = "dddddddd-dddd-4ddd-8ddd-dddddddddd02";
const SLOT_A2 = "dddddddd-dddd-4ddd-8ddd-dddddddddd03";

const PERMS = ["ALL_PRIVILEGES"];
const TEACHER_PERMS = ["Planning de cours:READ", "ALL_PRIVILEGES"];

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

function mentionsSchool(rows, codes) {
  const wanted = new Set(codes.map((code) => String(code).toUpperCase()));
  return unwrapList(rows).some((row) => wanted.has(String(row.schoolCode ?? "").trim().toUpperCase())
    || wanted.has(String(row.id ?? "").trim().toLowerCase()));
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

async function setRoleModuleGrant(pool, roleKey, moduleKey, flags) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = upper($1) AND module_key = $2 AND scope_type = 'global' AND status = 'active'
     LIMIT 1`,
    [roleKey, moduleKey],
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_create = $2, can_read = $3, can_update = $4, can_delete = $5, updated_by = 'gp014', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, flags.create, flags.read, flags.update, flags.delete],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', $2, $3, $4, $5, $6, 'gp014')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update, flags.delete],
  );
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

async function seed(pool) {
  await setLoginCodeTriggers(pool, false);
  const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
  const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'LAC', 'Lycée Lac', 'active')
     RETURNING id, school_code, login_code`,
    [cd.id, LEFTOVER_A, LOGIN_A],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'BUJ', 'Lycée Bujumbura', 'active')
     RETURNING id, school_code, login_code`,
    [bi.id, LEFTOVER_B, LOGIN_B],
  );
  const schoolA2 = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'LC2', 'Lycée Lac 2', 'active')
     RETURNING id, school_code, login_code`,
    [cd.id, LEFTOVER_A2, LOGIN_A2],
  );
  await setLoginCodeTriggers(pool, true);

  assert.notEqual(schoolA.rows[0].school_code, schoolA.rows[0].login_code);
  assert.notEqual(schoolB.rows[0].school_code, schoolB.rows[0].login_code);

  const schoolAId = schoolA.rows[0].id;
  const schoolBId = schoolB.rows[0].id;
  const schoolA2Id = schoolA2.rows[0].id;

  const yearA = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open') RETURNING id`,
    [schoolAId],
  );
  const yearB = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open') RETURNING id`,
    [schoolBId],
  );
  const yearA2 = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open') RETURNING id`,
    [schoolA2Id],
  );

  const classA = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-LAC-6A', '6ème A Lac', 'active') RETURNING id`,
    [schoolAId, yearA.rows[0].id],
  );
  const classB = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-BUJ-6A', '6ème A Buj', 'active') RETURNING id`,
    [schoolBId, yearB.rows[0].id],
  );
  const classA2 = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-LAC-6B', '6ème B Lac2', 'active') RETURNING id`,
    [schoolA2Id, yearA2.rows[0].id],
  );

  await pool.query(
    `INSERT INTO subjects (id, school_id, subject_code, name, coefficient, status)
     VALUES
       ($1, $4, 'SUB-LAC-MATH', 'Mathématiques', 1, 'active'),
       ($2, $5, 'SUB-BUJ-MATH', 'Mathématiques', 1, 'active'),
       ($3, $6, 'SUB-LAC2-MATH', 'Mathématiques', 1, 'active'),
       ($7, $4, 'SUB-LAC-FR', 'Français', 1, 'active')`,
    [SUBJECT_A, SUBJECT_B, SUBJECT_A2, schoolAId, schoolBId, schoolA2Id, SUBJECT_FR],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $7, 'ADM-A', 'Aline', 'A', 'a@planning.gp.test', 'Admin School', 'active', FALSE),
       ($2, $8, 'ADM-B', 'Binta', 'B', 'b@planning.gp.test', 'Admin School', 'active', FALSE),
       ($3, $9, 'ADM-A2', 'Awa', 'A2', 'a2@planning.gp.test', 'Admin School', 'active', FALSE),
       ($4, $7, 'TCH-A', 'Tana', 'A', 'ta@planning.gp.test', 'Enseignant', 'active', FALSE),
       ($5, NULL, 'ADM-NS', 'Sans', 'Ecole', 'ns@planning.gp.test', 'Admin School', 'active', FALSE),
       ($6, NULL, 'SUPER', 'Super', 'Admin', 'super@planning.gp.test', 'Super Administrateur Somafrik', 'active', FALSE),
       ($10, NULL, 'PAYS-CD', 'Admin', 'Pays', 'pays@planning.gp.test', 'Admin Pays', 'active', FALSE)`,
    [USER_A, USER_B, USER_A2, USER_TEACHER_A, USER_NO_SCHOOL, USER_SUPER, schoolAId, schoolBId, schoolA2Id, USER_PAYS_CD],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $5, 'SCHOOL_ADMIN', 'active'),
       ($2, $6, 'SCHOOL_ADMIN', 'active'),
       ($3, $7, 'SCHOOL_ADMIN', 'active'),
       ($4, $5, 'TEACHER', 'active'),
       ($8, NULL, 'SUPER_ADMIN', 'active'),
       ($9, NULL, 'COUNTRY_ADMIN', 'active')`,
    [USER_A, USER_B, USER_A2, USER_TEACHER_A, schoolAId, schoolBId, schoolA2Id, USER_SUPER, USER_PAYS_CD],
  );

  await pool.query(
    `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
     VALUES
       ($1, $4, $7, 'TCH-LAC-01', 'active'),
       ($2, $5, NULL, 'TCH-BUJ-01', 'active'),
       ($3, $6, NULL, 'TCH-LAC-02', 'active')`,
    [TEACHER_A, TEACHER_B, TEACHER_A2, schoolAId, schoolBId, schoolA2Id, USER_TEACHER_A],
  );

  const courseA = await pool.query(
    `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
     VALUES ($1, $2, $3, $4, 'CRS-LAC-MATH', 1, 'active') RETURNING id`,
    [schoolAId, classA.rows[0].id, SUBJECT_A, TEACHER_A],
  );
  const courseAFree = await pool.query(
    `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
     VALUES ($1, $2, $3, $4, 'CRS-LAC-FR', 1, 'active') RETURNING id`,
    [schoolAId, classA.rows[0].id, SUBJECT_FR, TEACHER_A],
  );
  const courseB = await pool.query(
    `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
     VALUES ($1, $2, $3, $4, 'CRS-BUJ-MATH', 1, 'active') RETURNING id`,
    [schoolBId, classB.rows[0].id, SUBJECT_B, TEACHER_B],
  );
  const courseA2 = await pool.query(
    `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
     VALUES ($1, $2, $3, $4, 'CRS-LAC2-MATH', 1, 'active') RETURNING id`,
    [schoolA2Id, classA2.rows[0].id, SUBJECT_A2, TEACHER_A2],
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
      SUBJECT_FR,
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

  await setRoleModuleGrant(pool, "SCHOOL_ADMIN", "planning", {
    create: true,
    read: true,
    update: true,
    delete: true,
  });
  await setRoleModuleGrant(pool, "COUNTRY_ADMIN", "planning", {
    create: true,
    read: true,
    update: true,
    delete: true,
  });
  await setRoleModuleGrant(pool, "SUPER_ADMIN", "planning", {
    create: true,
    read: true,
    update: true,
    delete: true,
  });
  await setRoleModuleGrant(pool, "TEACHER", "planning", {
    create: false,
    read: true,
    update: false,
    delete: false,
  });

  return {
    schoolAId,
    schoolBId,
    schoolA2Id,
    courseAFreeId: courseAFree.rows[0].id,
    courseBId: courseB.rows[0].id,
    yearAId: yearA.rows[0].id,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("planningTenant.http.pg.test.js: SKIP (DATABASE_URL absent)");
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
  const pool = new Pool({ connectionString: isolatedUrl });
  let child = null;

  function mint(payload) {
    return tokens.createAccessToken({ mustChangePassword: false, ...payload });
  }

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

    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    await setLoginCodeTriggers(pool, false);
    const cdId = (await pool.query(`SELECT id FROM countries WHERE iso_code = 'CD' LIMIT 1`)).rows[0].id;
    const emptySchool = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1, 'CD-2026-0099', NULL, 'SLG', 'École sans login', 'active')
       RETURNING id, school_code, login_code`,
      [cdId],
    );
    assert.equal(emptySchool.rows[0].login_code, null, "PL-08 fixture login_code vide");
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'ADM-NL', 'Sans', 'Login', 'nl@planning.gp.test', 'Admin School', 'active', FALSE)`,
      [USER_NO_LOGIN, emptySchool.rows[0].id],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES ($1, $2, 'SCHOOL_ADMIN', 'active')`,
      [USER_NO_LOGIN, emptySchool.rows[0].id],
    );

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
    const tokenTeacherA = mint({
      sub: USER_TEACHER_A,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: TEACHER_PERMS,
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
    const tokenNoLogin = mint({
      sub: USER_NO_LOGIN,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "CD-2026-0099",
      permissions: PERMS,
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
    const tokenForgedB = mint({
      sub: USER_A,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_B,
      permissions: PERMS,
    });

    const getA = await request("/course-schedules", { token: tokenA });
    assert.equal(getA.status, 200, `PL-01 GET A: ${JSON.stringify(getA.data)}`);
    const schedulesA = unwrapList(getA.data);
    assert.ok(schedulesA.some((row) => String(row.id) === SLOT_A), "PL-01: créneau A");
    assert.equal(schedulesA.some((row) => String(row.id) === SLOT_B), false, "PL-01: jamais B");
    assert.equal(schedulesA.some((row) => String(row.id) === SLOT_A2), false, "PL-12: jamais A2");
    assert.ok(
      schedulesA.every((row) => row.schoolCode === LOGIN_A && row.schoolId === fixture.schoolAId),
      `PL-14 projection login_code A, jamais leftover: ${JSON.stringify(schedulesA)}`,
    );
    assert.equal(
      schedulesA.some((row) => row.schoolCode === LEFTOVER_A || row.schoolCode === LOGIN_B),
      false,
      "PL-14: aucun leftover A / login B",
    );

    const getForgedJwt = await request("/course-schedules", { token: tokenForgedB });
    const forgedRows = unwrapList(getForgedJwt.data);
    assert.ok(getForgedJwt.status === 200 || getForgedJwt.status === 403, `PL-02 status=${getForgedJwt.status}`);
    assert.equal(
      forgedRows.some((row) => String(row.id) === SLOT_B || row.schoolCode === LOGIN_B || row.schoolCode === LEFTOVER_B),
      false,
      `PL-02 JWT leftover B ne liste pas B: ${JSON.stringify(getForgedJwt.data)}`,
    );
    assert.ok(
      getForgedJwt.status === 403 || forgedRows.every((row) => row.schoolCode === LOGIN_A || row.schoolId === fixture.schoolAId),
      "PL-02: membership A si 200",
    );

    const getHeader = await request("/course-schedules", {
      token: tokenA,
      headers: { "X-Somafrik-School-Code": LOGIN_B },
    });
    assert.equal(
      unwrapList(getHeader.data).some((row) => String(row.id) === SLOT_B || row.schoolCode === LOGIN_B),
      false,
      "PL-03 header schoolCode B",
    );
    const getQuery = await request(`/course-schedules?schoolCode=${encodeURIComponent(LOGIN_B)}`, { token: tokenA });
    assert.equal(
      unwrapList(getQuery.data).some((row) => String(row.id) === SLOT_B),
      false,
      "PL-03 query schoolCode B",
    );

    const countBBefore = (
      await pool.query(`SELECT count(*)::int AS c FROM course_schedule_weekly_slots WHERE school_id = $1`, [
        fixture.schoolBId,
      ])
    ).rows[0].c;
    const postCross = await request("/course-schedules", {
      method: "POST",
      token: tokenA,
      body: {
        schoolCourseId: fixture.courseBId,
        academicYearId: fixture.yearAId,
        dayOfWeek: 3,
        startTime: "10:00",
        endTime: "11:00",
        schoolCode: LOGIN_B,
      },
    });
    assert.ok(
      postCross.status === 404 || postCross.status === 403,
      `PL-04 POST course B: ${postCross.status} ${JSON.stringify(postCross.data)}`,
    );
    const countBAfterPost = (
      await pool.query(`SELECT count(*)::int AS c FROM course_schedule_weekly_slots WHERE school_id = $1`, [
        fixture.schoolBId,
      ])
    ).rows[0].c;
    assert.equal(countBAfterPost, countBBefore, "PL-04: 0 write B");

    const slotBBefore = await pool.query(
      `SELECT status, start_time, updated_at FROM course_schedule_weekly_slots WHERE id = $1`,
      [SLOT_B],
    );
    const patchB = await request(`/course-schedules/${SLOT_B}`, {
      method: "PATCH",
      token: tokenA,
      body: { startTime: "10:00", endTime: "11:00" },
    });
    assert.ok(patchB.status === 404 || patchB.status === 403, `PL-05 PATCH B: ${patchB.status}`);
    const deleteB = await request(`/course-schedules/${SLOT_B}`, { method: "DELETE", token: tokenA });
    assert.ok(deleteB.status === 404 || deleteB.status === 403, `PL-05 DELETE B: ${deleteB.status}`);
    const slotBAfter = await pool.query(
      `SELECT status, start_time, updated_at FROM course_schedule_weekly_slots WHERE id = $1`,
      [SLOT_B],
    );
    assert.equal(slotBAfter.rows[0].status, slotBBefore.rows[0].status, "PL-05: status B inchangé");
    assert.equal(String(slotBAfter.rows[0].start_time), String(slotBBefore.rows[0].start_time), "PL-05: horaire B inchangé");

    const getNoSub = await request("/course-schedules", { token: tokenNoSub });
    assert.ok(getNoSub.status === 403 || getNoSub.status === 401, `PL-06 sans sub: ${getNoSub.status}`);
    assert.equal(mentionsSchool(getNoSub.data, [LOGIN_B, LEFTOVER_B, SLOT_B]), false, "PL-06: jamais B");

    const getNoSchool = await request("/course-schedules", { token: tokenNoSchool });
    assert.equal(getNoSchool.status, 403, `PL-07 sans school_id: ${JSON.stringify(getNoSchool.data)}`);

    const getNoLogin = await request("/course-schedules", { token: tokenNoLogin });
    assert.equal(getNoLogin.status, 403, `PL-08 login_code vide: ${JSON.stringify(getNoLogin.data)}`);
    assert.equal(
      unwrapList(getNoLogin.data).some((row) => row.schoolCode === "CD-2026-0099"),
      false,
      "PL-08: aucun fallback leftover",
    );

    const getB = await request("/course-schedules", { token: tokenB });
    assert.equal(getB.status, 200, `PL-09 GET B: ${JSON.stringify(getB.data)}`);
    const schedulesB = unwrapList(getB.data);
    assert.ok(schedulesB.every((row) => row.schoolCode === LOGIN_B && row.schoolId === fixture.schoolBId), "PL-09 projection login_code B");
    assert.equal(schedulesB.some((row) => row.schoolCode === LEFTOVER_B || row.schoolCode === LOGIN_A), false);

    const getSuper = await request("/course-schedules", { token: tokenSuper });
    assert.equal(getSuper.status, 200, `PL-10 Superadmin: ${getSuper.status}`);
    const superRows = unwrapList(getSuper.data);
    assert.ok(superRows.some((row) => String(row.id) === SLOT_A));
    assert.ok(superRows.some((row) => String(row.id) === SLOT_B));

    const getPays = await request("/course-schedules", { token: tokenPaysCd });
    assert.equal(getPays.status, 200, `PL-11 Admin Pays: ${JSON.stringify(getPays.data)}`);
    const paysRows = unwrapList(getPays.data);
    assert.equal(
      paysRows.some((row) => String(row.id) === SLOT_B || row.schoolCode === LOGIN_B || row.schoolCode === LEFTOVER_B),
      false,
      "PL-11 Admin Pays CD ne voit pas BI",
    );
    assert.ok(paysRows.some((row) => String(row.id) === SLOT_A || row.schoolCode === LOGIN_A), "PL-11 voit CD");

    const getA2 = await request("/course-schedules", { token: tokenA2 });
    assert.equal(unwrapList(getA2.data).some((row) => String(row.id) === SLOT_A), false, "PL-12 A2 jamais A");

    const getTeacher = await request("/course-schedules", { token: tokenTeacherA });
    assert.equal(getTeacher.status, 200, `PL-13 enseignant: ${getTeacher.status}`);
    assert.equal(
      unwrapList(getTeacher.data).some((row) => String(row.id) === SLOT_B),
      false,
      "PL-13 enseignant A jamais B",
    );

    const postOwn = await request("/course-schedules", {
      method: "POST",
      token: tokenForgedB,
      body: {
        schoolCourseId: fixture.courseAFreeId,
        academicYearId: fixture.yearAId,
        dayOfWeek: 4,
        startTime: "14:00",
        endTime: "15:00",
      },
    });
    assert.equal(postOwn.status, 201, `POST membership A JWT leftover B: ${JSON.stringify(postOwn.data)}`);
    assert.equal(postOwn.data.schoolCode, LOGIN_A, "POST projection login_code A");
    assert.notEqual(postOwn.data.schoolCode, LEFTOVER_A);
    assert.equal(postOwn.data.schoolId, fixture.schoolAId);
    const countBFinal = (
      await pool.query(`SELECT count(*)::int AS c FROM course_schedule_weekly_slots WHERE school_id = $1`, [
        fixture.schoolBId,
      ])
    ).rows[0].c;
    assert.equal(countBFinal, countBBefore, "POST leftover JWT B: toujours 0 write B");

    console.log("OK planningTenant.http.pg.test.js — PL-02/06/07/08/09/11/14 dual-identity");
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
