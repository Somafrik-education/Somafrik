"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { STUDENT_CARD_ERROR } = require("./studentAccessCardsManagement");
const { STUDENT_CARD_ATTENDANCE_ERROR } = require("./studentCardAttendance");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_STUDENT_CARDS_ATTENDANCE_IT_DATABASE ?? "somafrik_student_cards_attendance_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_STUDENT_CARDS_ATTENDANCE_HTTP_PORT ?? 19890);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const LEFTOVER_A = "CD-2026-0001";
const LEFTOVER_B = "BI-2026-0001";
const USER_ADMIN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const USER_TEACHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const USER_TEACHER_FREE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";
const USER_PARENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04";
const USER_STUDENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05";
const USER_SUPER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee06";
const USER_PAYS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee07";
const USER_TEACHER_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee08";
const STUDENT_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11";
const STUDENT_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee12";
const STUDENT_BARE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee13";
const STUDENT_LOST = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee14";
const STUDENT_REVOKED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee15";
const STUDENT_REPLACED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee16";
const STUDENT_APPROVED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee17";
const STUDENT_TRANSFERRED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee18";
const STUDENT_CLOSED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee19";
const STUDENT_OLD_YEAR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee20";
const STUDENT_INCOHERENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee21";

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
  return { status: response.status, data, cacheControl: response.headers.get("cache-control") };
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
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
  return (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ($1,$2,$3,$4) RETURNING id`,
    [name, iso, phone, currency],
  )).rows[0];
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
       SET can_create = $2, can_read = $3, can_update = $4, can_delete = FALSE, updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, flags.create, flags.read, flags.update],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', $2, $3, $4, $5, FALSE, 'carte-pr4')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update],
  );
}

async function countTable(pool, table) {
  const reg = await pool.query(`SELECT to_regclass($1) AS ref`, [`public.${table}`]);
  if (!reg.rows[0].ref) return null;
  return (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
}

async function attendanceCount(pool, studentId) {
  const params = studentId ? [studentId] : [];
  const where = studentId ? "WHERE student_id = $1" : "";
  return (await pool.query(`SELECT count(*)::int AS n FROM attendance ${where}`, params)).rows[0].n;
}

function assertNoSecret(value, cardToken) {
  const secret = cardToken.split(".")[1];
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  assert.equal(text.includes(cardToken), false);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("token_hash"), false);
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentAccessCards.attendance.pg.test.js SKIP (DATABASE_URL absent)");
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
    await setLoginCodeTriggers(pool, false);
    const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
    const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
    const schoolA = (await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1,$2,$3,'LAC','Lycée Lac','active') RETURNING id`,
      [cd.id, LEFTOVER_A, LOGIN_A],
    )).rows[0];
    const schoolB = (await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1,$2,$3,'BUJ','Lycée Buj','active') RETURNING id`,
      [bi.id, LEFTOVER_B, LOGIN_B],
    )).rows[0];
    await setLoginCodeTriggers(pool, true);
    await pool.query(`ALTER TABLE users DISABLE TRIGGER users_permanent_identity_insert`);
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES
         ($1,$9,'ADM-A','Aline','A','aline@att.gp.test','Admin School','active', FALSE),
         ($2,$9,'ENS-A','Chidi','T','chidi@att.gp.test','Enseignant','active', FALSE),
         ($3,$9,'ENS-FREE','Nia','F','nia@att.gp.test','Enseignant','active', FALSE),
         ($4,$9,'PAR-A','Paule','P','paule@att.gp.test','Parent','active', FALSE),
         ($5,$9,'ELV-A','Enzo','E','enzo@att.gp.test','Élève / Étudiant','active', FALSE),
         ($6,NULL,'SUPER','Super','Admin','super@att.gp.test','Super Administrateur Somafrik','active', FALSE),
         ($7,NULL,'PAYS','Admin','Pays','pays@att.gp.test','Admin Pays','active', FALSE),
         ($8,$10,'ENS-B','Theo','B','theo@att.gp.test','Enseignant','active', FALSE)`,
      [USER_ADMIN, USER_TEACHER, USER_TEACHER_FREE, USER_PARENT, USER_STUDENT, USER_SUPER, USER_PAYS, USER_TEACHER_B, schoolA.id, schoolB.id],
    );
    await pool.query(`ALTER TABLE users ENABLE TRIGGER users_permanent_identity_insert`);
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES
         ($1,$8,'SCHOOL_ADMIN','active'),
         ($2,$8,'TEACHER','active'),
         ($3,$8,'TEACHER','active'),
         ($4,$8,'PARENT','active'),
         ($5,$8,'STUDENT','active'),
         ($6,NULL,'SUPER_ADMIN','active'),
         ($7,NULL,'COUNTRY_ADMIN','active'),
         ($9,$10,'TEACHER','active')`,
      [USER_ADMIN, USER_TEACHER, USER_TEACHER_FREE, USER_PARENT, USER_STUDENT, USER_SUPER, USER_PAYS, schoolA.id, USER_TEACHER_B, schoolB.id],
    );
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: true, read: true, update: true });
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
       VALUES
         ($1,$12,'STU-A','Amina','K','active'),
         ($2,$13,'STU-B','Chika','M','active'),
         ($3,$12,'STU-BARE','Bare','B','active'),
         ($4,$12,'STU-LOST','Lost','L','active'),
         ($5,$12,'STU-REV','Revoked','R','active'),
         ($6,$12,'STU-REP','Replaced','P','active'),
         ($7,$12,'STU-APP','Approved','A','active'),
         ($8,$12,'STU-TRF','Transfer','T','active'),
         ($9,$12,'STU-CLS','Closed','C','active'),
         ($10,$12,'STU-OLD','OldYear','O','active'),
         ($11,$12,'STU-INC','Incoherent','I','active')`,
      [
        STUDENT_A, STUDENT_B, STUDENT_BARE, STUDENT_LOST, STUDENT_REVOKED, STUDENT_REPLACED,
        STUDENT_APPROVED, STUDENT_TRANSFERRED, STUDENT_CLOSED, STUDENT_OLD_YEAR, STUDENT_INCOHERENT,
        schoolA.id, schoolB.id,
      ],
    );
    const yearA = (await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027', TRUE, 'open') RETURNING id`,
      [schoolA.id],
    )).rows[0];
    const yearB = (await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027', TRUE, 'open') RETURNING id`,
      [schoolB.id],
    )).rows[0];
    const classA = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1,$2,'CL-A','6e A','active') RETURNING id`,
      [schoolA.id, yearA.id],
    )).rows[0];
    const classB = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1,$2,'CL-B','5e B','active') RETURNING id`,
      [schoolA.id, yearA.id],
    )).rows[0];
    const classForeign = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1,$2,'CL-BUJ','6e Buj','active') RETURNING id`,
      [schoolB.id, yearB.id],
    )).rows[0];
    const yearOld = (await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2024-2025', FALSE, 'closed') RETURNING id`,
      [schoolA.id],
    )).rows[0];
    const classOld = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1,$2,'CL-OLD','Ancienne','active') RETURNING id`,
      [schoolA.id, yearOld.id],
    )).rows[0];
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES
         ($1,$2,$3,$4,'ENROLLED'),
         ($5,$6,$7,$8,'ENROLLED'),
         ($1,$9,$3,$4,'APPROVED'),
         ($1,$10,$3,$4,'TRANSFERRED'),
         ($1,$11,$3,$4,'CLOSED'),
         ($1,$12,$13,$14,'ENROLLED'),
         ($1,$15,$16,$4,'ENROLLED')`,
      [
        schoolA.id, STUDENT_A, classA.id, yearA.id,
        schoolB.id, STUDENT_B, classForeign.id, yearB.id,
        STUDENT_APPROVED, STUDENT_TRANSFERRED, STUDENT_CLOSED,
        STUDENT_OLD_YEAR, classOld.id, yearOld.id,
        STUDENT_INCOHERENT, classForeign.id,
      ],
    );
    await pool.query(`UPDATE enrollments SET class_id = NULL WHERE student_id = $1`, [STUDENT_APPROVED]);
    const subject = (await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,'MATH','Maths','active') RETURNING id`,
      [schoolA.id],
    )).rows[0];
    const teacher = (await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,'TCH-A','active') RETURNING id`,
      [schoolA.id, USER_TEACHER],
    )).rows[0];
    const teacherFree = (await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,'TCH-FREE','active') RETURNING id`,
      [schoolA.id, USER_TEACHER_FREE],
    )).rows[0];
    await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,'TCH-B','active')`,
      [schoolB.id, USER_TEACHER_B],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,$5,'active'), ($1,$2,$6,$4,$5,'active')`,
      [schoolA.id, teacher.id, classA.id, subject.id, yearA.id, classB.id],
    );
    await pool.query(
      `INSERT INTO school_settings (school_id, student_card_enabled, student_card_attendance_enabled)
       VALUES ($1, TRUE, FALSE), ($2, TRUE, TRUE)
       ON CONFLICT (school_id) DO UPDATE
         SET student_card_enabled = EXCLUDED.student_card_enabled,
             student_card_attendance_enabled = EXCLUDED.student_card_attendance_enabled`,
      [schoolA.id, schoolB.id],
    );

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

    const tokenAdmin = mint({
      sub: USER_ADMIN,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: ["Élèves:UPDATE", "Présences:UPDATE"],
    });
    const tokenTeacher = mint({
      sub: USER_TEACHER,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: ["Présences:CREATE", "Présences:UPDATE"],
    });
    const tokenTeacherFree = mint({
      sub: USER_TEACHER_FREE,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: ["Présences:CREATE"],
    });
    const tokenParent = mint({
      sub: USER_PARENT,
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: LEFTOVER_A,
      permissions: ["Présences:READ"],
    });
    const tokenStudent = mint({
      sub: USER_STUDENT,
      role: "Élève / Étudiant",
      roleKeys: ["STUDENT"],
      schoolCode: LEFTOVER_A,
      permissions: ["Présences:READ"],
    });
    const tokenSuper = mint({
      sub: USER_SUPER,
      role: "Super Administrateur Somafrik",
      roleKeys: ["SUPER_ADMIN"],
      schoolCode: LOGIN_A,
      permissions: ["ALL_PRIVILEGES", "Présences:CREATE"],
    });
    const tokenPays = mint({
      sub: USER_PAYS,
      role: "Admin Pays",
      roleKeys: ["COUNTRY_ADMIN"],
      schoolCode: LOGIN_A,
      countryCode: "CD",
      permissions: ["COUNTRY_PRIVILEGES", "Présences:UPDATE"],
    });
    const tokenTeacherB = mint({
      sub: USER_TEACHER_B,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_B,
      permissions: ["Présences:CREATE"],
    });

    const issued = await request("/student-cards", {
      method: "POST",
      token: tokenAdmin,
      body: { studentId: STUDENT_A, medium: "nfc_qr" },
    });
    assert.equal(issued.status, 201, JSON.stringify(issued.data));
    const cardToken = issued.data.cardToken;
    const cardBefore = (await pool.query(
      `SELECT token_hash, status, last_scan_at, updated_at FROM student_access_cards WHERE id = $1`,
      [issued.data.id],
    )).rows[0];

    const paymentsBefore = await countTable(pool, "payments");
    const feesBefore = await countTable(pool, "student_fee_obligations");
    const allocBefore = await countTable(pool, "payment_allocations");

    const resolvedOnly = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken },
    });
    assert.equal(resolvedOnly.status, 200, JSON.stringify(resolvedOnly.data));
    assert.equal(resolvedOnly.cacheControl, "no-store");
    assert.equal(resolvedOnly.data.attendance, undefined);
    assert.equal(resolvedOnly.data.student.id, STUDENT_A);
    assert.equal(resolvedOnly.data.class.classCode, "CL-A");
    assertNoSecret(resolvedOnly.data, cardToken);
    assert.equal(await attendanceCount(pool, STUDENT_A), 0);

    const blocked = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken, attendance: { date: "2026-10-06", status: "present" } },
    });
    assert.equal(blocked.status, 404, JSON.stringify(blocked.data));
    assert.equal(blocked.data?.code, STUDENT_CARD_ATTENDANCE_ERROR.DISABLED);
    assert.equal(await attendanceCount(pool, STUDENT_A), 0);

    await pool.query(
      `UPDATE school_settings SET student_card_attendance_enabled = TRUE WHERE school_id = $1`,
      [schoolA.id],
    );

    const presentBody = {
      cardToken,
      attendance: {
        studentId: STUDENT_B,
        classId: classForeign.id,
        classCode: "FORGED",
        schoolId: schoolB.id,
        schoolCode: LOGIN_B,
        countryCode: "BI",
        date: "2026-10-06",
        status: "present",
      },
    };
    const marked = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      headers: { "Idempotency-Key": "scan-present-1" },
      body: presentBody,
    });
    assert.equal(marked.status, 201, JSON.stringify(marked.data));
    assert.equal(marked.cacheControl, "no-store");
    assert.equal(marked.data.student.id, STUDENT_A);
    assert.equal(marked.data.class.classCode, "CL-A");
    assert.equal(marked.data.attendance.status, "Présent");
    assert.equal(marked.data.attendance.classCode, "CL-A");
    assertNoSecret(marked.data, cardToken);
    assert.equal(await attendanceCount(pool, STUDENT_A), 1);
    assert.equal(await attendanceCount(pool, STUDENT_B), 0);
    const rowA = (await pool.query(
      `SELECT student_id, class_id, status, attendance_date::text AS day FROM attendance WHERE student_id = $1`,
      [STUDENT_A],
    )).rows[0];
    assert.equal(rowA.student_id, STUDENT_A);
    assert.equal(rowA.class_id, classA.id);
    assert.equal(rowA.status, "present");
    assert.equal(rowA.day, "2026-10-06");

    const again = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      headers: { "Idempotency-Key": "scan-present-2" },
      body: presentBody,
    });
    assert.equal(again.status, 201, JSON.stringify(again.data));
    assert.equal(await attendanceCount(pool, STUDENT_A), 1);

    const replay = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      headers: { "Idempotency-Key": "scan-present-1" },
      body: presentBody,
    });
    assert.equal(replay.status, 201, JSON.stringify(replay.data));
    assert.equal(replay.data.idempotentReplay, true);
    assert.equal(await attendanceCount(pool, STUDENT_A), 1);

    const reused = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      headers: { "Idempotency-Key": "scan-present-1" },
      body: { ...presentBody, attendance: { ...presentBody.attendance, date: "2026-10-07" } },
    });
    assert.equal(reused.status, 409, JSON.stringify(reused.data));
    assert.equal(reused.data?.code, "IDEMPOTENCY_KEY_REUSED");
    assert.equal(await attendanceCount(pool, STUDENT_A), 1);

    const reusedStatus = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      headers: { "Idempotency-Key": "scan-present-1" },
      body: { ...presentBody, attendance: { ...presentBody.attendance, status: "late" } },
    });
    assert.equal(reusedStatus.status, 409, JSON.stringify(reusedStatus.data));
    assert.equal(reusedStatus.data?.code, "IDEMPOTENCY_KEY_REUSED");
    assert.equal(await attendanceCount(pool, STUDENT_A), 1);

    const late = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      headers: { "Idempotency-Key": "scan-late" },
      body: { cardToken, attendance: { date: "2026-10-06", status: "late" } },
    });
    assert.equal(late.status, 201, JSON.stringify(late.data));
    assert.equal(late.data.attendance.status, "Retard");
    assert.equal(await attendanceCount(pool, STUDENT_A), 1);
    assert.equal((await pool.query(`SELECT status FROM attendance WHERE student_id = $1`, [STUDENT_A])).rows[0].status, "late");

    for (const status of ["absent", "excused", "unknown"]) {
      const rejected = await request("/student-cards/scan", {
        method: "POST",
        token: tokenTeacher,
        body: { cardToken, attendance: { date: "2026-10-06", status } },
      });
      assert.equal(rejected.status, 400, `${status} ${JSON.stringify(rejected.data)}`);
      assert.equal(rejected.data?.code, STUDENT_CARD_ATTENDANCE_ERROR.STATUS_INVALID);
      assertNoSecret(rejected.data, cardToken);
    }
    assert.equal(await attendanceCount(pool, STUDENT_A), 1);

    const unassigned = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacherFree,
      body: { cardToken, attendance: { date: "2026-10-11", status: "present" } },
    });
    assert.equal(unassigned.status, 403, JSON.stringify(unassigned.data));
    assert.equal(await attendanceCount(pool, STUDENT_A), 1);

    const adminMissingTeacher = await request("/student-cards/scan", {
      method: "POST",
      token: tokenAdmin,
      body: { cardToken, attendance: { date: "2026-10-08", status: "present" } },
    });
    assert.equal(adminMissingTeacher.status, 409, JSON.stringify(adminMissingTeacher.data));
    assert.equal(adminMissingTeacher.data?.code, "ATTENDANCE_TEACHER_UNRESOLVED");
    const adminForeignTeacher = await request("/student-cards/scan", {
      method: "POST",
      token: tokenAdmin,
      body: { cardToken, attendance: { date: "2026-10-08", status: "present", teacherId: "TCH-FREE" } },
    });
    assert.equal(adminForeignTeacher.status, 409, JSON.stringify(adminForeignTeacher.data));
    assert.equal(adminForeignTeacher.data?.code, "ATTENDANCE_TEACHER_UNRESOLVED");
    const adminOk = await request("/student-cards/scan", {
      method: "POST",
      token: tokenAdmin,
      body: { cardToken, attendance: { date: "2026-10-08", status: "present", teacherId: "TCH-A" } },
    });
    assert.equal(adminOk.status, 201, JSON.stringify(adminOk.data));
    assert.equal(adminOk.data.attendance.classCode, "CL-A");
    assert.equal(await attendanceCount(pool, STUDENT_A), 2);

    const manual = await request("/presences", {
      method: "POST",
      token: tokenTeacher,
      body: {
        classId: classA.id,
        classCode: "CL-A",
        items: [{ studentId: STUDENT_A, classId: classA.id, classCode: "CL-A", date: "2026-10-10", status: "Présent" }],
      },
    });
    assert.equal(manual.status, 201, JSON.stringify(manual.data));
    assert.equal(await attendanceCount(pool, STUDENT_A), 3);

    assert.equal((await request("/student-cards/scan", { method: "POST", token: tokenParent, body: presentBody })).status, 403);
    assert.equal((await request("/student-cards/scan", { method: "POST", token: tokenStudent, body: presentBody })).status, 403);
    const superScan = await request("/student-cards/scan", {
      method: "POST",
      token: tokenSuper,
      headers: { "X-Somafrik-School-Code": LOGIN_A },
      body: presentBody,
    });
    assert.equal(superScan.status, 403);
    assert.equal(superScan.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    const paysScan = await request("/student-cards/scan", { method: "POST", token: tokenPays, body: presentBody });
    assert.equal(paysScan.status, 403);
    assert.equal(paysScan.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");

    const cross = await request("/student-cards/scan", { method: "POST", token: tokenTeacherB, body: presentBody });
    assert.equal(cross.status, 404, JSON.stringify(cross.data));
    assert.equal(cross.data?.code, STUDENT_CARD_ERROR.NOT_FOUND);
    assertNoSecret(cross.data, cardToken);

    const lostIssued = await request("/student-cards", {
      method: "POST",
      token: tokenAdmin,
      body: { studentId: STUDENT_LOST, medium: "qr" },
    });
    assert.equal(lostIssued.status, 201, JSON.stringify(lostIssued.data));
    await pool.query(
      `UPDATE student_access_cards SET status = 'lost', revoked_at = NOW(), revoke_reason = 'lost' WHERE id = $1`,
      [lostIssued.data.id],
    );
    const lostScan = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken: lostIssued.data.cardToken, attendance: { date: "2026-10-06", status: "present" } },
    });
    assert.equal(lostScan.status, 409, JSON.stringify(lostScan.data));
    assert.equal(lostScan.data?.code, STUDENT_CARD_ERROR.INVALID_STATE);
    assert.equal(await attendanceCount(pool, STUDENT_LOST), 0);

    const bareIssued = await request("/student-cards", {
      method: "POST",
      token: tokenAdmin,
      body: { studentId: STUDENT_BARE, medium: "qr" },
    });
    assert.equal(bareIssued.status, 201, JSON.stringify(bareIssued.data));
    const bareScan = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken: bareIssued.data.cardToken, attendance: { date: "2026-10-06", status: "present" } },
    });
    assert.equal(bareScan.status, 409, JSON.stringify(bareScan.data));
    assert.equal(bareScan.data?.code, STUDENT_CARD_ERROR.ENROLLMENT_UNRESOLVED);
    assert.equal(await attendanceCount(pool, STUDENT_BARE), 0);

    const enrollmentCases = [
      [STUDENT_APPROVED, "approved-sans-classe"],
      [STUDENT_TRANSFERRED, "transferred"],
      [STUDENT_CLOSED, "closed"],
      [STUDENT_OLD_YEAR, "annee-non-courante"],
      [STUDENT_INCOHERENT, "classe-incoherente"],
    ];
    for (const [studentId, label] of enrollmentCases) {
      const issuedCase = await request("/student-cards", {
        method: "POST",
        token: tokenAdmin,
        body: { studentId, medium: "qr" },
      });
      assert.equal(issuedCase.status, 201, `${label} ${JSON.stringify(issuedCase.data)}`);
      const scannedCase = await request("/student-cards/scan", {
        method: "POST",
        token: tokenTeacher,
        body: {
          cardToken: issuedCase.data.cardToken,
          attendance: { date: "2026-10-06", status: "present" },
        },
      });
      assert.equal(scannedCase.status, 409, `${label} ${JSON.stringify(scannedCase.data)}`);
      assert.equal(scannedCase.data?.code, STUDENT_CARD_ERROR.ENROLLMENT_UNRESOLVED);
      assertNoSecret(scannedCase.data, issuedCase.data.cardToken);
      assert.equal(await attendanceCount(pool, studentId), 0);
    }

    const revokedIssued = await request("/student-cards", {
      method: "POST",
      token: tokenAdmin,
      body: { studentId: STUDENT_REVOKED, medium: "qr" },
    });
    assert.equal(revokedIssued.status, 201, JSON.stringify(revokedIssued.data));
    await pool.query(
      `UPDATE student_access_cards SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'revoked' WHERE id = $1`,
      [revokedIssued.data.id],
    );
    const revokedScan = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken: revokedIssued.data.cardToken, attendance: { date: "2026-10-06", status: "present" } },
    });
    assert.equal(revokedScan.status, 409, JSON.stringify(revokedScan.data));
    assert.equal(revokedScan.data?.code, STUDENT_CARD_ERROR.INVALID_STATE);
    assert.equal(await attendanceCount(pool, STUDENT_REVOKED), 0);

    const replacedIssued = await request("/student-cards", {
      method: "POST",
      token: tokenAdmin,
      body: { studentId: STUDENT_REPLACED, medium: "qr" },
    });
    assert.equal(replacedIssued.status, 201, JSON.stringify(replacedIssued.data));
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,'ENROLLED')`,
      [schoolA.id, STUDENT_REPLACED, classA.id, yearA.id],
    );
    const replaced = await request(`/student-cards/${replacedIssued.data.id}/replace`, {
      method: "POST",
      token: tokenAdmin,
      body: {},
    });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.data));
    const replacedScan = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken: replacedIssued.data.cardToken, attendance: { date: "2026-10-06", status: "present" } },
    });
    assert.equal(replacedScan.status, 409, JSON.stringify(replacedScan.data));
    assert.equal(replacedScan.data?.code, STUDENT_CARD_ERROR.INVALID_STATE);
    assert.equal(await attendanceCount(pool, STUDENT_REPLACED), 0);

    const unknown = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken: "unknownpublic.notasecretvalue", attendance: { date: "2026-10-06", status: "present" } },
    });
    assert.equal(unknown.status, 404, JSON.stringify(unknown.data));
    assert.equal(unknown.data?.code, STUDENT_CARD_ERROR.NOT_FOUND);
    assertNoSecret(unknown.data, "unknownpublic.notasecretvalue");

    await pool.query(`UPDATE enrollments SET class_id = $1 WHERE student_id = $2`, [classB.id, STUDENT_A]);
    const moved = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken, attendance: { date: "2026-10-09", status: "present" } },
    });
    assert.equal(moved.status, 201, JSON.stringify(moved.data));
    assert.equal(moved.data.class.classCode, "CL-B");
    assert.equal(moved.data.attendance.classCode, "CL-B");
    const movedRow = (await pool.query(
      `SELECT class_id FROM attendance WHERE student_id = $1 AND attendance_date = '2026-10-09'`,
      [STUDENT_A],
    )).rows[0];
    assert.equal(movedRow.class_id, classB.id);

    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: false, read: true, update: false });
    const deniedTeacher = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken, attendance: { date: "2026-10-12", status: "present" } },
    });
    assert.equal(deniedTeacher.status, 403, JSON.stringify(deniedTeacher.data));
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: true, read: true, update: true });

    const wrongSecret = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken: `${issued.data.publicId}.wrongSecretValue12`, attendance: { date: "2026-10-13", status: "present" } },
    });
    assert.equal(wrongSecret.status, 404);
    assert.equal(wrongSecret.data?.code, STUDENT_CARD_ERROR.NOT_FOUND);

    await pool.query(`UPDATE school_settings SET student_card_enabled = FALSE WHERE school_id = $1`, [schoolA.id]);
    const masterOff = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken, attendance: { date: "2026-10-14", status: "present" } },
    });
    assert.equal(masterOff.status, 404);
    assert.equal(masterOff.data?.code, STUDENT_CARD_ERROR.DISABLED);
    const masterResolver = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken },
    });
    assert.equal(masterResolver.status, 404);
    assert.equal(masterResolver.data?.code, STUDENT_CARD_ERROR.DISABLED);

    const cardAfter = (await pool.query(
      `SELECT token_hash, status, last_scan_at, updated_at FROM student_access_cards WHERE id = $1`,
      [issued.data.id],
    )).rows[0];
    assert.equal(cardAfter.token_hash, cardBefore.token_hash);
    assert.equal(cardAfter.status, "active");
    assert.equal(cardAfter.last_scan_at, null);
    assert.equal(String(cardAfter.updated_at), String(cardBefore.updated_at));
    assert.equal(await countTable(pool, "payments"), paymentsBefore);
    assert.equal(await countTable(pool, "student_fee_obligations"), feesBefore);
    assert.equal(await countTable(pool, "payment_allocations"), allocBefore);

    const idemRows = await pool.query(
      `SELECT route_key, request_hash, response_body::text AS body, school_scope, principal_id
       FROM idempotency_keys WHERE route_key = 'POST /api/student-cards/scan'`,
    );
    assert.ok(idemRows.rowCount >= 1);
    for (const row of idemRows.rows) {
      assertNoSecret(row, cardToken);
      assert.equal(String(row.body).includes("cardToken"), false);
    }
    const scanAudit = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'student_card_scanned'`);
    assert.equal(scanAudit.rows[0].n, 0);
    const presenceAudit = await pool.query(
      `SELECT new_value::text AS payload FROM audit_logs WHERE action = 'upsert_attendance_batch'`,
    );
    for (const row of presenceAudit.rows) assertNoSecret(row.payload, cardToken);

    console.log("studentAccessCards.attendance.pg.test.js OK");
  } finally {
    await stopChild(child);
    await pool.end();
    if (typeof repo.close === "function") await repo.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
