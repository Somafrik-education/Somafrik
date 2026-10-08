"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { STUDENT_CARD_ERROR } = require("./studentAccessCardsManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_STUDENT_CARDS_SCAN_HTTP_IT_DATABASE ?? "somafrik_student_cards_scan_http_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_STUDENT_CARDS_SCAN_HTTP_PORT ?? 19889);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const LEFTOVER_A = "CD-2026-0001";
const LEFTOVER_B = "BI-2026-0001";
const USER_ADMIN = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const USER_TEACHER = "dddddddd-dddd-4ddd-8ddd-dddddddddd02";
const USER_PARENT = "dddddddd-dddd-4ddd-8ddd-dddddddddd03";
const USER_STUDENT = "dddddddd-dddd-4ddd-8ddd-dddddddddd04";
const USER_SUPER = "dddddddd-dddd-4ddd-8ddd-dddddddddd05";
const USER_PAYS = "dddddddd-dddd-4ddd-8ddd-dddddddddd06";
const USER_ADMIN_B = "dddddddd-dddd-4ddd-8ddd-dddddddddd07";
const USER_TEACHER_B = "dddddddd-dddd-4ddd-8ddd-dddddddddd08";
const USER_ACCOUNTANT = "dddddddd-dddd-4ddd-8ddd-dddddddddd09";
const STUDENT_A = "dddddddd-dddd-4ddd-8ddd-dddddddddd11";
const STUDENT_B = "dddddddd-dddd-4ddd-8ddd-dddddddddd12";

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
     VALUES ($1, 'global', $2, $3, $4, $5, FALSE, 'carte-pr3')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update],
  );
}

async function countIfExists(pool, table) {
  const reg = await pool.query(`SELECT to_regclass($1) AS ref`, [`public.${table}`]);
  if (!reg.rows[0].ref) return null;
  return (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentAccessCards.scan.http.pg.test.js SKIP (DATABASE_URL absent)");
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
         ($1,$8,'ADM-A','Aline','A','aline@scan.gp.test','Admin School','active', FALSE),
         ($2,$8,'ENS-A','Chidi','T','chidi@scan.gp.test','Enseignant','active', FALSE),
         ($3,$8,'PAR-A','Paule','P','paule@scan.gp.test','Parent','active', FALSE),
         ($4,$8,'ELV-A','Enzo','E','enzo@scan.gp.test','Élève / Étudiant','active', FALSE),
         ($5,NULL,'SUPER','Super','Admin','super@scan.gp.test','Super Administrateur Somafrik','active', FALSE),
         ($6,NULL,'PAYS','Admin','Pays','pays@scan.gp.test','Admin Pays','active', FALSE),
         ($7,$9,'ADM-B','Binta','B','binta@scan.gp.test','Admin School','active', FALSE),
         ($10,$9,'ENS-B','Theo','B','theo@scan.gp.test','Enseignant','active', FALSE),
         ($11,$8,'CPT-A','Dora','C','dora@scan.gp.test','Comptable','active', FALSE)`,
      [USER_ADMIN, USER_TEACHER, USER_PARENT, USER_STUDENT, USER_SUPER, USER_PAYS, USER_ADMIN_B, schoolA.id, schoolB.id, USER_TEACHER_B, USER_ACCOUNTANT],
    );
    await pool.query(`ALTER TABLE users ENABLE TRIGGER users_permanent_identity_insert`);
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES
         ($1,$7,'SCHOOL_ADMIN','active'),
         ($2,$7,'TEACHER','active'),
         ($3,$7,'PARENT','active'),
         ($4,$7,'STUDENT','active'),
         ($5,NULL,'SUPER_ADMIN','active'),
         ($6,NULL,'COUNTRY_ADMIN','active'),
         ($8,$9,'SCHOOL_ADMIN','active'),
         ($10,$9,'TEACHER','active'),
         ($11,$7,'ACCOUNTANT','active')`,
      [USER_ADMIN, USER_TEACHER, USER_PARENT, USER_STUDENT, USER_SUPER, USER_PAYS, schoolA.id, USER_ADMIN_B, schoolB.id, USER_TEACHER_B, USER_ACCOUNTANT],
    );
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: true, read: true, update: true });
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
       VALUES ($1,$3,'STU-A','Amina','K','active'), ($2,$4,'STU-B','Chika','M','active')`,
      [STUDENT_A, STUDENT_B, schoolA.id, schoolB.id],
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
       VALUES ($1,$2,'CL-SCAN-A','6e A','active') RETURNING id`,
      [schoolA.id, yearA.id],
    )).rows[0];
    const classB = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1,$2,'CL-SCAN-B','6e B','active') RETURNING id`,
      [schoolB.id, yearB.id],
    )).rows[0];
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,'ENROLLED'), ($5,$6,$7,$8,'ENROLLED')`,
      [schoolA.id, STUDENT_A, classA.id, yearA.id, schoolB.id, STUDENT_B, classB.id, yearB.id],
    );
    await pool.query(
      `INSERT INTO school_settings (
         school_id, student_card_enabled, student_card_qr_enabled,
         student_card_attendance_enabled, student_card_finance_check_enabled
       )
       VALUES ($1, TRUE, TRUE, TRUE, FALSE), ($2, TRUE, TRUE, FALSE, FALSE)
       ON CONFLICT (school_id) DO UPDATE SET
         student_card_enabled = EXCLUDED.student_card_enabled,
         student_card_qr_enabled = EXCLUDED.student_card_qr_enabled,
         student_card_attendance_enabled = EXCLUDED.student_card_attendance_enabled,
         student_card_finance_check_enabled = EXCLUDED.student_card_finance_check_enabled`,
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
      permissions: ["Élèves:UPDATE", "Gérer élèves"],
    });
    const tokenAccountant = mint({
      sub: USER_ACCOUNTANT,
      role: "Comptable",
      roleKeys: ["ACCOUNTANT"],
      schoolCode: LEFTOVER_A,
      permissions: ["Paiements:READ", "Paiements:CREATE"],
    });
    const tokenTeacher = mint({
      sub: USER_TEACHER,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: ["Présences:CREATE", "Présences:UPDATE"],
    });
    const tokenParent = mint({
      sub: USER_PARENT,
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: LEFTOVER_A,
      permissions: ["Présences:READ", "Voir présences"],
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
    const tokenAdminB = mint({
      sub: USER_ADMIN_B,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_B,
      permissions: ["Élèves:UPDATE", "Gérer élèves", "Présences:CREATE"],
    });

    const tokenTeacherUpdate = mint({
      sub: USER_TEACHER,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: ["Présences:UPDATE"],
    });
    const tokenTeacherCreate = mint({
      sub: USER_TEACHER,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: ["Présences:CREATE"],
    });

    const capAnon = await request("/student-cards/capabilities");
    assert.equal(capAnon.status, 401);
    const capUpdate = await request("/student-cards/capabilities", { token: tokenTeacherUpdate });
    assert.equal(capUpdate.status, 200, JSON.stringify(capUpdate.data));
    assert.deepEqual(Object.keys(capUpdate.data).sort(), [
      "studentCardAttendanceEnabled",
      "studentCardEnabled",
      "studentCardFinanceCheckEnabled",
      "studentCardNfcEnabled",
      "studentCardQrEnabled",
    ]);
    assert.equal(capUpdate.data.studentCardEnabled, true);
    assert.equal(capUpdate.data.studentCardQrEnabled, true);
    assert.equal(capUpdate.data.studentCardNfcEnabled, false);
    assert.equal(capUpdate.data.studentCardAttendanceEnabled, true);
    assert.equal(capUpdate.data.studentCardFinanceCheckEnabled, false);
    assert.equal(JSON.stringify(capUpdate.data).includes(LOGIN_A), false);
    assert.equal(JSON.stringify(capUpdate.data).includes("Lycée"), false);
    const capCreate = await request("/student-cards/capabilities", { token: tokenTeacherCreate });
    assert.equal(capCreate.status, 200, JSON.stringify(capCreate.data));
    const capAccountant = await request("/student-cards/capabilities", { token: tokenAccountant });
    assert.equal(capAccountant.status, 403);
    const capParent = await request("/student-cards/capabilities", { token: tokenParent });
    assert.equal(capParent.status, 403);
    const capStudent = await request("/student-cards/capabilities", { token: tokenStudent });
    assert.equal(capStudent.status, 403);
    const capSuper = await request("/student-cards/capabilities", {
      token: tokenSuper,
      headers: { "X-Somafrik-School-Code": LOGIN_A },
    });
    assert.equal(capSuper.status, 403);
    assert.equal(capSuper.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    const capPays = await request("/student-cards/capabilities", { token: tokenPays });
    assert.equal(capPays.status, 403);
    assert.equal(capPays.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    const capQuerySpoof = await request(
      `/student-cards/capabilities?schoolCode=${encodeURIComponent(LEFTOVER_B)}`,
      { token: tokenTeacher },
    );
    assert.equal(capQuerySpoof.status, 200, JSON.stringify(capQuerySpoof.data));
    assert.equal(capQuerySpoof.data.studentCardEnabled, true, "query schoolCode ignoré, scope membership A");
    const capHeaderSpoof = await request("/student-cards/capabilities", {
      token: tokenTeacher,
      headers: { "X-Somafrik-School-Code": LOGIN_B },
    });
    assert.equal(capHeaderSpoof.status, 403, JSON.stringify(capHeaderSpoof.data));
    assert.equal(capHeaderSpoof.data?.code, "SCHOOL_SCOPE_OVERRIDE_FORBIDDEN");
    const capTeacherB = await request("/student-cards/capabilities", {
      token: mint({
        sub: USER_TEACHER_B,
        role: "Enseignant",
        roleKeys: ["TEACHER"],
        schoolCode: LEFTOVER_B,
        permissions: ["Présences:CREATE"],
      }),
    });
    assert.equal(capTeacherB.status, 200, JSON.stringify(capTeacherB.data));
    assert.equal(capTeacherB.data.studentCardEnabled, true);
    assert.equal(capTeacherB.data.studentCardAttendanceEnabled, false, "scope B, pas les flags A");

    const anonymous = await request("/student-cards/scan", { method: "POST", body: { cardToken: "abc.def" } });
    assert.equal(anonymous.status, 401);

    const issued = await request("/student-cards", {
      method: "POST",
      token: tokenAdmin,
      body: { studentId: STUDENT_A, medium: "nfc_qr" },
    });
    assert.equal(issued.status, 201, JSON.stringify(issued.data));
    const cardToken = issued.data.cardToken;

    const attendanceBefore = await countIfExists(pool, "attendance");
    const paymentsBefore = await countIfExists(pool, "payments");
    const feesBefore = await countIfExists(pool, "student_fee_obligations");
    const allocBefore = await countIfExists(pool, "payment_allocations");

    const scanned = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      body: { cardToken },
    });
    assert.equal(scanned.status, 200, JSON.stringify(scanned.data));
    assert.equal(scanned.cacheControl, "no-store");
    assert.equal(scanned.data.student.id, STUDENT_A);
    assert.equal(scanned.data.class.classCode, "CL-SCAN-A");
    assert.equal(scanned.data.card.cardToken, undefined);
    assert.equal(JSON.stringify(scanned.data).includes(cardToken.split(".")[1]), false);

    const deniedScan = await request("/student-cards/scan", { method: "POST", token: tokenAccountant, body: { cardToken } });
    assert.equal(deniedScan.status, 403, JSON.stringify(deniedScan.data));
    const parentScan = await request("/student-cards/scan", { method: "POST", token: tokenParent, body: { cardToken } });
    assert.equal(parentScan.status, 403, JSON.stringify(parentScan.data));
    const studentScan = await request("/student-cards/scan", { method: "POST", token: tokenStudent, body: { cardToken } });
    assert.equal(studentScan.status, 403, JSON.stringify(studentScan.data));

    const superScan = await request("/student-cards/scan", {
      method: "POST",
      token: tokenSuper,
      body: { cardToken },
      headers: { "X-Somafrik-School-Code": LOGIN_A },
    });
    assert.equal(superScan.status, 403);
    assert.equal(superScan.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    const paysScan = await request("/student-cards/scan", { method: "POST", token: tokenPays, body: { cardToken } });
    assert.equal(paysScan.status, 403);
    assert.equal(paysScan.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");

    const cross = await request("/student-cards/scan", { method: "POST", token: tokenAdminB, body: { cardToken } });
    assert.equal(cross.status, 404, JSON.stringify(cross.data));
    assert.equal(cross.data?.code, STUDENT_CARD_ERROR.NOT_FOUND);
    assert.equal(JSON.stringify(cross.data).includes(STUDENT_A), false);
    const teacherB = mint({
      sub: USER_TEACHER_B,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_B,
      permissions: ["Présences:CREATE"],
    });
    const crossTeacher = await request("/student-cards/scan", { method: "POST", token: teacherB, body: { cardToken } });
    assert.equal(crossTeacher.status, 404, JSON.stringify(crossTeacher.data));
    assert.equal(crossTeacher.data?.code, STUDENT_CARD_ERROR.NOT_FOUND);
    assert.equal(JSON.stringify(crossTeacher.data).includes(STUDENT_A), false);

    const queryOnly = await request(`/student-cards/scan?cardToken=${encodeURIComponent(cardToken)}`, {
      method: "POST",
      token: tokenTeacher,
      body: {},
    });
    assert.equal(queryOnly.status, 400);
    assert.equal(queryOnly.data?.code, STUDENT_CARD_ERROR.TOKEN_INVALID);
    assert.equal(JSON.stringify(queryOnly.data).includes(cardToken), false);

    await pool.query(`UPDATE school_settings SET student_card_enabled = FALSE WHERE school_id = $1`, [schoolA.id]);
    const disabled = await request("/student-cards/scan", { method: "POST", token: tokenTeacher, body: { cardToken } });
    assert.equal(disabled.status, 404);
    assert.equal(disabled.data?.code, STUDENT_CARD_ERROR.DISABLED);

    assert.equal(await countIfExists(pool, "attendance"), attendanceBefore);
    assert.equal(await countIfExists(pool, "payments"), paymentsBefore);
    assert.equal(await countIfExists(pool, "student_fee_obligations"), feesBefore);
    assert.equal(await countIfExists(pool, "payment_allocations"), allocBefore);
    const scanAt = await pool.query(`SELECT last_scan_at FROM student_access_cards WHERE public_id = $1`, [issued.data.publicId]);
    assert.equal(scanAt.rows[0].last_scan_at, null);
    console.log("studentAccessCards.scan.http.pg.test.js OK");
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
