"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { STUDENT_CARD_ERROR } = require("./studentAccessCardsManagement");
const { STUDENT_CARD_FINANCE_ERROR } = require("./studentCardFinance");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_STUDENT_CARDS_FINANCE_IT_DATABASE ?? "somafrik_student_cards_finance_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_STUDENT_CARDS_FINANCE_HTTP_PORT ?? 19891);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LOGIN_A = "CD-FIN-26-001";
const LOGIN_B = "BI-FIN-26-001";
const CODE_A = "CD-2026-9101";
const CODE_B = "BI-2026-9101";
const USER_ADMIN = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const USER_ADMIN_B = "ffffffff-ffff-4fff-8fff-fffffffffff2";
const USER_TEACHER = "ffffffff-ffff-4fff-8fff-fffffffffff3";
const USER_PARENT = "ffffffff-ffff-4fff-8fff-fffffffffff4";
const USER_STUDENT_ACCOUNT = "ffffffff-ffff-4fff-8fff-fffffffffff5";
const USER_SUPER = "ffffffff-ffff-4fff-8fff-fffffffffff6";
const USER_PAYS = "ffffffff-ffff-4fff-8fff-fffffffffff7";
const USER_TEACHER_B = "ffffffff-ffff-4fff-8fff-fffffffffff8";
const STUDENT_A = "ffffffff-ffff-4fff-8fff-ffffffffff11";
const STUDENT_B = "ffffffff-ffff-4fff-8fff-ffffffffff12";
const STUDENT_FOREIGN = "ffffffff-ffff-4fff-8fff-ffffffffff13";
const STUDENT_GRID = "ffffffff-ffff-4fff-8fff-ffffffffff14";
const STUDENT_EMPTY = "ffffffff-ffff-4fff-8fff-ffffffffff15";
const STUDENT_LOST = "ffffffff-ffff-4fff-8fff-ffffffffff16";
const STUDENT_REVOKED = "ffffffff-ffff-4fff-8fff-ffffffffff17";
const STUDENT_REPLACED = "ffffffff-ffff-4fff-8fff-ffffffffff18";
const STUDENT_BARE = "ffffffff-ffff-4fff-8fff-ffffffffff19";

const FORBIDDEN_KEYS = [
  "amountDue",
  "amountPaid",
  "balance",
  "currency",
  "obligationId",
  "paymentId",
  "dueDate",
  "parentPhone",
  "parentEmail",
  "address",
  "birthDate",
  "dateOfBirth",
  "cardToken",
  "secret",
  "token_hash",
  "tokenHash",
  "candidateHash",
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

function isoShift(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
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
     VALUES ($1, 'global', $2, $3, $4, $5, FALSE, 'carte-pr5')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update],
  );
}

async function countTable(pool, table) {
  const reg = await pool.query(`SELECT to_regclass($1) AS ref`, [`public.${table}`]);
  if (!reg.rows[0].ref) return null;
  return (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
}

async function financeSnapshot(pool) {
  const audits = await pool.query(
    `SELECT count(*)::int AS n FROM audit_logs
     WHERE action IN ('student_card_finance_checked', 'student_card_scanned')`,
  );
  return {
    payments: await countTable(pool, "payments"),
    allocations: await countTable(pool, "payment_allocations"),
    fees: await countTable(pool, "student_fee_obligations"),
    grids: await countTable(pool, "fee_grids"),
    reminders: await countTable(pool, "payment_reminders"),
    attendance: await countTable(pool, "attendance"),
    idempotency: await countTable(pool, "idempotency_keys"),
    audits: audits.rows[0].n,
  };
}

function assertNoLeak(value, cardToken) {
  const secret = String(cardToken || "").split(".")[1] || "";
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  if (cardToken) assert.equal(text.includes(cardToken), false);
  if (secret) assert.equal(text.includes(secret), false);
  assert.equal(text.includes("token_hash"), false);
  walk(value);
}

function walk(value) {
  if (Array.isArray(value)) {
    value.forEach(walk);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    assert.equal(FORBIDDEN_KEYS.includes(key), false, key);
    walk(value[key]);
  }
}

async function insertFee(pool, {
  schoolId,
  studentId,
  classId,
  academicYear,
  label,
  feeType = "Scolarité",
  currency = "CDF",
  dueDate,
  amountDue,
  archived = false,
}) {
  const row = await pool.query(
    `INSERT INTO student_fee_obligations (
       school_id, student_id, class_id, fee_type, label, currency, academic_year,
       initial_amount, amount_due, amount_paid, exemption, balance, due_date, status, archived_at,
       profile_payload
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$8,0,$9,$8,$10,'À payer',$11,$12::jsonb
     ) RETURNING id`,
    [
      schoolId,
      studentId,
      classId,
      feeType,
      label,
      currency,
      academicYear,
      amountDue,
      archived ? amountDue : 0,
      dueDate,
      archived ? new Date().toISOString() : null,
      JSON.stringify({ studentId }),
    ],
  );
  return row.rows[0].id;
}

async function clearStudentFinance(pool, studentId) {
  await pool.query(
    `DELETE FROM payment_allocations
     WHERE payment_id IN (SELECT id FROM payments WHERE student_id = $1)
        OR obligation_id IN (SELECT id FROM student_fee_obligations WHERE student_id = $1)`,
    [studentId],
  );
  await pool.query(
    `DELETE FROM payment_items WHERE payment_id IN (SELECT id FROM payments WHERE student_id = $1)`,
    [studentId],
  );
  await pool.query(`DELETE FROM payments WHERE student_id = $1`, [studentId]);
  await pool.query(`DELETE FROM payment_reminders WHERE student_id = $1`, [studentId]);
  await pool.query(`DELETE FROM student_fee_obligations WHERE student_id = $1`, [studentId]);
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentAccessCards.finance.pg.test.js SKIP (DATABASE_URL absent)");
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
  const future = isoShift(30);
  const past = isoShift(-30);
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
       VALUES ($1,$2,$3,'FLC','Lycée Finance','active') RETURNING id`,
      [cd.id, CODE_A, LOGIN_A],
    )).rows[0];
    const schoolB = (await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1,$2,$3,'FBU','Lycée Finance B','active') RETURNING id`,
      [bi.id, CODE_B, LOGIN_B],
    )).rows[0];
    await setLoginCodeTriggers(pool, true);
    await pool.query(`ALTER TABLE users DISABLE TRIGGER users_permanent_identity_insert`);
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES
         ($1,$9,'ADM-FA','Aline','A','aline@fin.gp.test','Admin School','active', FALSE),
         ($2,$10,'ADM-FB','Boris','B','boris@fin.gp.test','Admin School','active', FALSE),
         ($3,$9,'ENS-FA','Chidi','T','chidi@fin.gp.test','Enseignant','active', FALSE),
         ($4,$9,'PAR-FA','Paule','P','paule@fin.gp.test','Parent','active', FALSE),
         ($5,$9,'ELV-FA','Enzo','E','enzo@fin.gp.test','Élève / Étudiant','active', FALSE),
         ($6,NULL,'SUPER-F','Super','Admin','super@fin.gp.test','Super Administrateur Somafrik','active', FALSE),
         ($7,NULL,'PAYS-F','Admin','Pays','pays@fin.gp.test','Admin Pays','active', FALSE),
         ($8,$10,'ENS-FB','Theo','B','theo@fin.gp.test','Enseignant','active', FALSE)`,
      [USER_ADMIN, USER_ADMIN_B, USER_TEACHER, USER_PARENT, USER_STUDENT_ACCOUNT, USER_SUPER, USER_PAYS, USER_TEACHER_B, schoolA.id, schoolB.id],
    );
    await pool.query(`ALTER TABLE users ENABLE TRIGGER users_permanent_identity_insert`);
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES
         ($1,$8,'SCHOOL_ADMIN','active'),
         ($2,$9,'SCHOOL_ADMIN','active'),
         ($3,$8,'TEACHER','active'),
         ($4,$8,'PARENT','active'),
         ($5,$8,'STUDENT','active'),
         ($6,NULL,'SUPER_ADMIN','active'),
         ($7,NULL,'COUNTRY_ADMIN','active'),
         ($10,$9,'TEACHER','active')`,
      [USER_ADMIN, USER_ADMIN_B, USER_TEACHER, USER_PARENT, USER_STUDENT_ACCOUNT, USER_SUPER, USER_PAYS, schoolA.id, schoolB.id, USER_TEACHER_B],
    );
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: true, read: true, update: true });
    for (const moduleKey of ["unpaid", "payments", "fees"]) {
      await setRoleModuleGrant(pool, "SCHOOL_ADMIN", moduleKey, { create: true, read: true, update: true });
      await setRoleModuleGrant(pool, "TEACHER", moduleKey, { create: false, read: false, update: false });
    }
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
       VALUES
         ($1,$10,'STU-FA','Amina','K','active'),
         ($2,$10,'STU-FB','Chika','M','active'),
         ($3,$11,'STU-FX','Foreign','X','active'),
         ($4,$10,'STU-FG','Grid','G','active'),
         ($5,$10,'STU-FE','Empty','E','active'),
         ($6,$10,'STU-FL','Lost','L','active'),
         ($7,$10,'STU-FR','Revoked','R','active'),
         ($8,$10,'STU-FP','Replaced','P','active'),
         ($9,$10,'STU-FN','Bare','N','active')`,
      [
        STUDENT_A, STUDENT_B, STUDENT_FOREIGN, STUDENT_GRID, STUDENT_EMPTY,
        STUDENT_LOST, STUDENT_REVOKED, STUDENT_REPLACED, STUDENT_BARE,
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
       VALUES ($1,$2,'FIN-A','6e A','active') RETURNING id`,
      [schoolA.id, yearA.id],
    )).rows[0];
    const classGrid = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1,$2,'FIN-G','6e G','active') RETURNING id`,
      [schoolA.id, yearA.id],
    )).rows[0];
    const classForeign = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1,$2,'FIN-BUJ','6e Buj','active') RETURNING id`,
      [schoolB.id, yearB.id],
    )).rows[0];
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES
         ($1,$2,$3,$4,'ENROLLED'),
         ($1,$5,$3,$4,'ENROLLED'),
         ($1,$6,$7,$4,'ENROLLED'),
         ($1,$8,$3,$4,'ENROLLED'),
         ($9,$10,$11,$12,'ENROLLED')`,
      [
        schoolA.id, STUDENT_A, classA.id, yearA.id,
        STUDENT_B, STUDENT_GRID, classGrid.id, STUDENT_EMPTY,
        schoolB.id, STUDENT_FOREIGN, classForeign.id, yearB.id,
      ],
    );
    const subject = (await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,'MATH-F','Maths','active') RETURNING id`,
      [schoolA.id],
    )).rows[0];
    const teacher = (await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,'TCH-FA','active') RETURNING id`,
      [schoolA.id, USER_TEACHER],
    )).rows[0];
    await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,'TCH-FB','active')`,
      [schoolB.id, USER_TEACHER_B],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [schoolA.id, teacher.id, classA.id, subject.id, yearA.id],
    );
    await pool.query(
      `INSERT INTO school_settings (
         school_id, student_card_enabled, student_card_attendance_enabled, student_card_finance_check_enabled
       ) VALUES ($1, TRUE, TRUE, TRUE), ($2, TRUE, TRUE, TRUE)
       ON CONFLICT (school_id) DO UPDATE
         SET student_card_enabled = EXCLUDED.student_card_enabled,
             student_card_attendance_enabled = EXCLUDED.student_card_attendance_enabled,
             student_card_finance_check_enabled = EXCLUDED.student_card_finance_check_enabled`,
      [schoolA.id, schoolB.id],
    );

    const feeContext = { schoolId: schoolA.id, classId: classA.id, academicYear: "2026-2027" };
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "Frais A", dueDate: future, amountDue: 10000 });
    await insertFee(pool, { ...feeContext, studentId: STUDENT_B, label: "Frais B", dueDate: past, amountDue: 8000 });
    await insertFee(pool, {
      schoolId: schoolB.id,
      studentId: STUDENT_FOREIGN,
      classId: classForeign.id,
      academicYear: "2026-2027",
      label: "Frais étranger",
      currency: "BIF",
      dueDate: past,
      amountDue: 5000,
    });

    const principalA = { sub: USER_ADMIN, role: "Admin School", schoolCode: LOGIN_A };
    const principalB = { sub: USER_ADMIN_B, role: "Admin School", schoolCode: LOGIN_B };
    const onlyA = await repo.listFinanceStudentFees(principalA, { studentId: STUDENT_A });
    assert.ok(onlyA.length >= 1);
    assert.ok(onlyA.every((row) => String(row.studentDbId) === STUDENT_A));
    assert.equal(onlyA.some((row) => row.label === "Frais B"), false);
    const prioritized = await repo.listFinanceStudentFees(
      { ...principalA, financeStudentKey: STUDENT_B },
      { studentId: STUDENT_A },
    );
    assert.ok(prioritized.every((row) => String(row.studentDbId) === STUDENT_A));
    assert.equal(prioritized.some((row) => row.label === "Frais B"), false);
    const onlyB = await repo.listFinanceStudentFees(principalA, { studentKey: STUDENT_B });
    assert.ok(onlyB.length >= 1);
    assert.ok(onlyB.every((row) => String(row.studentDbId) === STUDENT_B));
    const foreign = await repo.listFinanceStudentFees(principalB, { studentId: STUDENT_A });
    assert.equal(foreign.length, 0);
    const legacy = await repo.listFinanceStudentFees({ ...principalA, financeStudentKey: STUDENT_A });
    assert.ok(legacy.every((row) => String(row.studentDbId) === STUDENT_A));

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
      schoolCode: CODE_A,
      permissions: ["Élèves:UPDATE", "Présences:UPDATE", "Impayés:READ", "Paiements:READ", "Frais & tarifs:READ"],
    });
    const tokenTeacher = mint({
      sub: USER_TEACHER,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: CODE_A,
      permissions: ["Présences:CREATE", "Présences:UPDATE"],
    });
    const tokenParent = mint({
      sub: USER_PARENT,
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: CODE_A,
      permissions: ["Présences:READ"],
    });
    const tokenStudent = mint({
      sub: USER_STUDENT_ACCOUNT,
      role: "Élève / Étudiant",
      roleKeys: ["STUDENT"],
      schoolCode: CODE_A,
      permissions: ["Présences:READ"],
    });
    const tokenSuper = mint({
      sub: USER_SUPER,
      role: "Super Administrateur Somafrik",
      roleKeys: ["SUPER_ADMIN"],
      schoolCode: LOGIN_A,
      permissions: ["ALL_PRIVILEGES", "Présences:CREATE", "Impayés:READ"],
    });
    const tokenPays = mint({
      sub: USER_PAYS,
      role: "Admin Pays",
      roleKeys: ["COUNTRY_ADMIN"],
      schoolCode: LOGIN_A,
      countryCode: "CD",
      permissions: ["COUNTRY_PRIVILEGES", "Présences:UPDATE", "Impayés:READ"],
    });
    const tokenTeacherB = mint({
      sub: USER_TEACHER_B,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: CODE_B,
      permissions: ["Présences:CREATE", "Impayés:READ", "Paiements:READ", "Frais & tarifs:READ"],
    });

    const listed = await request(`/finance/student-fees?studentId=${STUDENT_A}`, { token: tokenAdmin });
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    assert.ok(Array.isArray(listed.data));
    assert.ok(listed.data.length >= 1);
    assert.ok(listed.data.every((row) => String(row.studentDbId) === STUDENT_A));
    assert.equal(listed.data.some((row) => row.label === "Frais B"), false);
    assert.equal(listed.data[0].amountDue != null, true);
    const listedB = await request(`/finance/student-fees?studentId=${STUDENT_B}`, { token: tokenAdmin });
    assert.ok(listedB.data.every((row) => String(row.studentDbId) === STUDENT_B));

    async function issue(studentId) {
      const issued = await request("/student-cards", {
        method: "POST",
        token: tokenAdmin,
        body: { studentId, medium: "nfc_qr" },
      });
      assert.equal(issued.status, 201, JSON.stringify(issued.data));
      return issued.data;
    }

    const cardA = await issue(STUDENT_A);
    const cardBefore = (await pool.query(
      `SELECT token_hash, status, last_scan_at FROM student_access_cards WHERE id = $1`,
      [cardA.id],
    )).rows[0];

    async function scan(body, token = tokenAdmin) {
      return request("/student-cards/scan", { method: "POST", token, body });
    }

    async function expectBadge(code, label) {
      const before = await financeSnapshot(pool);
      const response = await scan({ cardToken: cardA.cardToken, finance: true });
      const after = await financeSnapshot(pool);
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.equal(response.cacheControl, "no-store");
      assert.equal(response.data.finance.code, code, JSON.stringify(response.data));
      assert.equal(response.data.finance.label, label);
      assert.deepEqual(Object.keys(response.data.finance).sort(), ["code", "label"]);
      assert.equal(response.data.attendance, undefined);
      assert.equal(response.data.student.id, STUDENT_A);
      assert.equal(response.data.class.classCode, "FIN-A");
      assertNoLeak(response.data, cardA.cardToken);
      assert.deepEqual(after, before);
      return response;
    }

    const resolver = await scan({ cardToken: cardA.cardToken });
    assert.equal(resolver.status, 200, JSON.stringify(resolver.data));
    assert.equal(resolver.data.finance, undefined);
    assert.equal(resolver.data.attendance, undefined);
    assert.equal(resolver.data.student.id, STUDENT_A);
    assertNoLeak(resolver.data, cardA.cardToken);

    const financeFalse = await scan({ cardToken: cardA.cardToken, finance: false });
    assert.equal(financeFalse.status, 200);
    assert.equal(financeFalse.data.finance, undefined);
    const financeNull = await scan({ cardToken: cardA.cardToken, finance: null });
    assert.equal(financeNull.status, 200);
    assert.equal(financeNull.data.finance, undefined);

    await expectBadge("UP_TO_DATE", "À jour");

    const teacherDenied = await scan({ cardToken: cardA.cardToken, finance: true }, tokenTeacher);
    assert.equal(teacherDenied.status, 403, JSON.stringify(teacherDenied.data));
    assert.equal(teacherDenied.data?.code, "PERMISSION_DENIED");
    assert.equal(teacherDenied.data?.finance, undefined);
    assertNoLeak(teacherDenied.data, cardA.cardToken);

    const marked = await scan({
      cardToken: cardA.cardToken,
      attendance: { date: "2026-10-06", status: "present" },
    }, tokenTeacher);
    assert.equal(marked.status, 201, JSON.stringify(marked.data));
    assert.equal(marked.data.attendance?.status, "present");
    assert.equal(marked.data.finance, undefined);
    assert.equal(await countTable(pool, "attendance"), 1);

    const conflictBefore = await financeSnapshot(pool);
    const conflict = await scan({
      cardToken: cardA.cardToken,
      attendance: { date: "2026-10-07", status: "present" },
      finance: true,
    });
    assert.equal(conflict.status, 400, JSON.stringify(conflict.data));
    assert.equal(conflict.data?.code, STUDENT_CARD_FINANCE_ERROR.INTENTS_CONFLICT);
    assert.equal(conflict.data?.finance, undefined);
    assert.deepEqual(await financeSnapshot(pool), conflictBefore);
    assert.equal(await countTable(pool, "attendance"), 1);

    const forged = await scan({
      cardToken: cardA.cardToken,
      finance: { studentId: STUDENT_B, schoolId: schoolB.id },
    });
    assert.equal(forged.status, 400, JSON.stringify(forged.data));
    assert.equal(forged.data?.code, STUDENT_CARD_FINANCE_ERROR.INTENT_INVALID);

    await clearStudentFinance(pool, STUDENT_A);
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "Payé", dueDate: past, amountDue: 1000 });
    const paidId = (await repo.listFinanceStudentFees(principalA, { studentId: STUDENT_A }))[0].id;
    await repo.createSchoolPayment({
      studentId: STUDENT_A,
      items: [{ obligationId: paidId, feeType: "Scolarité", amount: 1000 }],
      method: "Espèces",
      date: "2026-10-01",
    }, principalA);
    await expectBadge("UP_TO_DATE", "À jour");

    await clearStudentFinance(pool, STUDENT_A);
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "Exonéré", dueDate: past, amountDue: 1000, archived: false });
    await pool.query(
      `UPDATE student_fee_obligations SET exemption = amount_due, balance = 0 WHERE student_id = $1`,
      [STUDENT_A],
    );
    await expectBadge("UP_TO_DATE", "À jour");

    await clearStudentFinance(pool, STUDENT_A);
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "Annulé", dueDate: past, amountDue: 1000, archived: true });
    await expectBadge("UP_TO_DATE", "À jour");

    await clearStudentFinance(pool, STUDENT_A);
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "Futur", dueDate: future, amountDue: 4000 });
    await expectBadge("UP_TO_DATE", "À jour");

    await clearStudentFinance(pool, STUDENT_A);
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "Partiel futur", dueDate: future, amountDue: 4000 });
    const partialId = (await repo.listFinanceStudentFees(principalA, { studentId: STUDENT_A }))[0].id;
    await repo.createSchoolPayment({
      studentId: STUDENT_A,
      items: [{ obligationId: partialId, feeType: "Scolarité", amount: 1500 }],
      method: "Espèces",
      date: "2026-10-01",
    }, principalA);
    await expectBadge("PARTIAL", "Paiement partiel");

    await clearStudentFinance(pool, STUDENT_A);
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "Échu", dueDate: past, amountDue: 4000 });
    await expectBadge("OVERDUE", "Échéance impayée");

    await clearStudentFinance(pool, STUDENT_A);
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "Partiel échu", dueDate: past, amountDue: 4000 });
    const partialLateId = (await repo.listFinanceStudentFees(principalA, { studentId: STUDENT_A }))[0].id;
    await repo.createSchoolPayment({
      studentId: STUDENT_A,
      items: [{ obligationId: partialLateId, feeType: "Scolarité", amount: 1000 }],
      method: "Espèces",
      date: "2026-09-01",
    }, principalA);
    await expectBadge("OVERDUE", "Échéance impayée");

    await clearStudentFinance(pool, STUDENT_A);
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "À jour ligne", dueDate: future, amountDue: 1000 });
    const linePaid = (await repo.listFinanceStudentFees(principalA, { studentId: STUDENT_A }))[0];
    await repo.createSchoolPayment({
      studentId: STUDENT_A,
      items: [{ obligationId: linePaid.id, feeType: "Scolarité", amount: 1000 }],
      method: "Espèces",
      date: "2026-10-01",
    }, principalA);
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "Partiel ligne", dueDate: future, amountDue: 2000 });
    const linePartial = (await repo.listFinanceStudentFees(principalA, { studentId: STUDENT_A })).find((row) => row.label === "Partiel ligne");
    await repo.createSchoolPayment({
      studentId: STUDENT_A,
      items: [{ obligationId: linePartial.id, feeType: "Scolarité", amount: 500 }],
      method: "Espèces",
      date: "2026-10-01",
    }, principalA);
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "Échu ligne", dueDate: past, amountDue: 3000 });
    await expectBadge("OVERDUE", "Échéance impayée");

    await repo.createSchoolPayment({
      studentId: STUDENT_A,
      items: [{ feeType: "Non imputé", amount: 750 }],
      method: "Espèces",
      date: "2026-10-02",
    }, principalA);
    await expectBadge("REVIEW", "Situation à vérifier");

    await clearStudentFinance(pool, STUDENT_A);
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "CDF", currency: "CDF", dueDate: future, amountDue: 1000 });
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "USD", currency: "USD", dueDate: future, amountDue: 1000 });
    await expectBadge("REVIEW", "Situation à vérifier");

    await clearStudentFinance(pool, STUDENT_A);
    await expectBadge("UP_TO_DATE", "À jour");

    const cardGrid = await issue(STUDENT_GRID);
    const grid = (await pool.query(
      `INSERT INTO fee_grids (school_id, grid_code, name, class_name, class_id, academic_year, currency, status)
       VALUES ($1,'GRID-FIN','Grille G','6e G',$2,'2026-2027','CDF','Active') RETURNING id`,
      [schoolA.id, classGrid.id],
    )).rows[0];
    await pool.query(
      `INSERT INTO school_fee_items (school_id, fee_grid_id, item_code, fee_type, label, amount, status)
       VALUES ($1,$2,'ITEM-G','Scolarité','Scolarité',12000,'Actif')`,
      [schoolA.id, grid.id],
    );
    const gridScan = await scan({ cardToken: cardGrid.cardToken, finance: true });
    assert.equal(gridScan.status, 200, JSON.stringify(gridScan.data));
    assert.equal(gridScan.data.finance.code, "REVIEW");
    assert.equal(gridScan.data.finance.label, "Situation à vérifier");
    assertNoLeak(gridScan.data, cardGrid.cardToken);

    const cardEmpty = await issue(STUDENT_EMPTY);
    const emptyScan = await scan({ cardToken: cardEmpty.cardToken, finance: true });
    assert.equal(emptyScan.data.finance.code, "UP_TO_DATE");

    await clearStudentFinance(pool, STUDENT_A);
    await insertFee(pool, { ...feeContext, studentId: STUDENT_A, label: "Fraîcheur", dueDate: past, amountDue: 6400 });
    await expectBadge("OVERDUE", "Échéance impayée");
    const freshId = (await repo.listFinanceStudentFees(principalA, { studentId: STUDENT_A }))[0].id;
    await repo.createSchoolPayment({
      studentId: STUDENT_A,
      items: [{ obligationId: freshId, feeType: "Scolarité", amount: 6400 }],
      method: "Espèces",
      date: "2026-10-03",
    }, principalA);
    await expectBadge("UP_TO_DATE", "À jour");

    const cardAfter = (await pool.query(
      `SELECT token_hash, status, last_scan_at FROM student_access_cards WHERE id = $1`,
      [cardA.id],
    )).rows[0];
    assert.equal(cardAfter.last_scan_at, cardBefore.last_scan_at);
    assert.equal(cardAfter.status, cardBefore.status);
    assert.equal(cardAfter.token_hash, cardBefore.token_hash);

    const cross = await scan({ cardToken: cardA.cardToken, finance: true }, tokenTeacherB);
    assert.equal(cross.status, 404, JSON.stringify(cross.data));
    assert.equal(cross.data?.code, STUDENT_CARD_ERROR.NOT_FOUND);
    assert.equal(cross.data?.finance, undefined);

    const unknown = await scan({ cardToken: "missing-card.not-the-secret", finance: true });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.data?.code, STUDENT_CARD_ERROR.NOT_FOUND);
    const wrong = await scan({ cardToken: `${cardA.publicId}.not-the-secret`, finance: true });
    assert.equal(wrong.status, 404);
    assert.equal(wrong.data?.code, STUDENT_CARD_ERROR.NOT_FOUND);
    assert.equal(wrong.data?.finance, undefined);

    const lost = await issue(STUDENT_LOST);
    assert.equal((await request(`/student-cards/${lost.id}/lost`, { method: "POST", token: tokenAdmin, body: { reason: "perdue" } })).status, 200);
    const lostScan = await scan({ cardToken: lost.cardToken, finance: true });
    assert.equal(lostScan.status, 409);
    assert.equal(lostScan.data?.code, STUDENT_CARD_ERROR.INVALID_STATE);
    assert.equal(lostScan.data?.finance, undefined);

    const revoked = await issue(STUDENT_REVOKED);
    assert.equal((await request(`/student-cards/${revoked.id}/revoke`, { method: "POST", token: tokenAdmin, body: { reason: "retirée" } })).status, 200);
    const revokedScan = await scan({ cardToken: revoked.cardToken, finance: true });
    assert.equal(revokedScan.status, 409);
    assert.equal(revokedScan.data?.code, STUDENT_CARD_ERROR.INVALID_STATE);

    const replaced = await issue(STUDENT_REPLACED);
    assert.equal((await request(`/student-cards/${replaced.id}/replace`, { method: "POST", token: tokenAdmin, body: {} })).status, 200);
    const replacedScan = await scan({ cardToken: replaced.cardToken, finance: true });
    assert.equal(replacedScan.status, 409);
    assert.equal(replacedScan.data?.code, STUDENT_CARD_ERROR.INVALID_STATE);

    const bare = await issue(STUDENT_BARE);
    const bareScan = await scan({ cardToken: bare.cardToken, finance: true });
    assert.equal(bareScan.status, 409, JSON.stringify(bareScan.data));
    assert.equal(bareScan.data?.code, STUDENT_CARD_ERROR.ENROLLMENT_UNRESOLVED);
    assert.equal(bareScan.data?.finance, undefined);

    assert.equal((await scan({ cardToken: cardA.cardToken, finance: true }, tokenParent)).status, 403);
    assert.equal((await scan({ cardToken: cardA.cardToken, finance: true }, tokenStudent)).status, 403);
    const superScan = await scan({ cardToken: cardA.cardToken, finance: true }, tokenSuper);
    assert.equal(superScan.status, 403);
    assert.equal(superScan.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    const paysScan = await scan({ cardToken: cardA.cardToken, finance: true }, tokenPays);
    assert.equal(paysScan.status, 403);
    assert.equal(paysScan.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");

    await pool.query(
      `UPDATE school_settings SET student_card_finance_check_enabled = FALSE WHERE school_id = $1`,
      [schoolA.id],
    );
    const flagOff = await scan({ cardToken: cardA.cardToken, finance: true });
    assert.equal(flagOff.status, 404, JSON.stringify(flagOff.data));
    assert.equal(flagOff.data?.code, STUDENT_CARD_FINANCE_ERROR.DISABLED);
    assert.equal(flagOff.data?.finance, undefined);
    const resolverStill = await scan({ cardToken: cardA.cardToken });
    assert.equal(resolverStill.status, 200);
    assert.equal(resolverStill.data.finance, undefined);
    const attendanceStill = await scan({
      cardToken: cardA.cardToken,
      attendance: { date: "2026-10-08", status: "late" },
    }, tokenTeacher);
    assert.equal(attendanceStill.status, 201, JSON.stringify(attendanceStill.data));
    assert.equal(attendanceStill.data.finance, undefined);

    await pool.query(`UPDATE school_settings SET student_card_enabled = FALSE WHERE school_id = $1`, [schoolA.id]);
    const masterOff = await scan({ cardToken: cardA.cardToken, finance: true });
    assert.equal(masterOff.status, 404, JSON.stringify(masterOff.data));
    assert.equal(masterOff.data?.code, STUDENT_CARD_ERROR.DISABLED);
    assert.equal(masterOff.data?.finance, undefined);

    assert.equal(stderrRef.value.includes(cardA.cardToken), false);
    assert.equal(stderrRef.value.includes(cardA.cardToken.split(".")[1]), false);
    console.log("studentAccessCards.finance.pg.test.js OK");
  } finally {
    await stopChild(child);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
