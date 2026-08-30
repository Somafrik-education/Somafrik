"use strict";

/**
 * F6 P1-D — HTTP réel PostgreSQL, JWT stale.
 * Le même access token est réutilisé après grant / revoke / changement de rôle.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { PERMISSION_DENIED } = require("../services/rbacService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_FINANCE_F6_RBAC_IT_DATABASE ?? "somafrik_finance_f6_rbac_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_FINANCE_F6_RBAC_HTTP_PORT ?? 19871);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const ACCOUNTANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const LIVE_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const ZERO_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const NAMED_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04";
const DUAL_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05";
const CLASS_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CLASS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const SAME_TS = "2026-08-28T08:00:00.000Z";

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

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

function mintAccess(tokens, payload) {
  return tokens.createAccessToken({ mustChangePassword: false, ...payload });
}

function staleClaims(overrides) {
  return {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN", "ACCOUNTANT"],
    permissions: ["ALL_PRIVILEGES", "Paiements:UPDATE", "Paiements:CREATE", "Paiements:READ"],
    ...overrides,
  };
}

function paymentBody(studentCode) {
  return {
    studentId: studentCode,
    items: [{ feeType: "Non imputé", amount: 1 }],
    method: "Espèces",
    date: "2026-08-28",
  };
}

async function setRolePaymentsGrant(pool, roleKey, flags) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = upper($1) AND module_key = 'payments' AND scope_type = 'global' AND status = 'active'
     LIMIT 1`,
    [roleKey],
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_create = $2, can_read = $3, can_update = $4, can_delete = FALSE, updated_by = 'f6-http', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, flags.create, flags.read, flags.update],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', 'payments', $2, $3, $4, FALSE, 'f6-http')`,
    [roleKey, flags.create, flags.read, flags.update],
  );
}

async function countPayments(pool, schoolCode) {
  const result = await pool.query(
    `SELECT count(*)::int AS c
     FROM payments p
     JOIN schools s ON s.id = p.school_id
     WHERE s.school_code = $1`,
    [schoolCode],
  );
  return result.rows[0].c;
}

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('Testland', 'TT', '+000', 'XOF') RETURNING id`,
  );
  await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'SCH-A', 'École A', 'active'), ($1, 'SCH-B', 'École B', 'active')`,
    [country.rows[0].id],
  );
  const schoolA = (
    await pool.query(`SELECT id, login_code, school_code FROM schools WHERE school_code = 'SCH-A'`)
  ).rows[0];
  const schoolB = (
    await pool.query(`SELECT id, login_code, school_code FROM schools WHERE school_code = 'SCH-B'`)
  ).rows[0];
  const loginA = String(schoolA.login_code ?? "").trim().toUpperCase();
  const loginB = String(schoolB.login_code ?? "").trim().toUpperCase();
  if (!loginA || !loginB) {
    throw new Error("login_code F6 manquant après INSERT schools");
  }
  if (loginA === String(schoolA.school_code).trim().toUpperCase()) {
    throw new Error("leftover school_code F6 A ne doit pas égaler login_code");
  }
  if (loginB === String(schoolB.school_code).trim().toUpperCase()) {
    throw new Error("leftover school_code F6 B ne doit pas égaler login_code");
  }
  await pool.query(
    `INSERT INTO academic_years (school_id, name, status)
     SELECT id, '2025-2026', 'open' FROM schools WHERE school_code IN ('SCH-A', 'SCH-B')`,
  );
  const yearA = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-A' LIMIT 1`,
    )
  ).rows[0];

  const yearB = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-B' LIMIT 1`,
    )
  ).rows[0];

  await pool.query(
    `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status, updated_at)
     VALUES
       ($1, $3, $5, 'F6-CLS-A', '6ème A', 'active', $7::timestamptz),
       ($2, $4, $6, 'F6-CLS-B', '6ème B', 'active', $7::timestamptz)`,
    [CLASS_A, CLASS_B, schoolA.id, schoolB.id, yearA.id, yearB.id, SAME_TS],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $6, 'ACC-F6-A', 'Carla', 'A', 'acc-f6-a@test.local', 'Comptable', 'active', FALSE),
       ($2, $6, 'LIVE-F6', 'Live', 'Pay', 'live-f6@test.local', NULL, 'active', FALSE),
       ($3, $6, 'ZERO-F6', 'Zero', 'Role', 'zero-f6@test.local', NULL, 'active', FALSE),
       ($4, $6, 'NAMED-F6', 'Named', 'Only', 'named-f6@test.local', NULL, 'active', FALSE),
       ($5, $7, 'DUAL-F6', 'Dual', 'Tenant', 'dual-f6@test.local', 'Comptable', 'active', FALSE)`,
    [ACCOUNTANT_A, LIVE_USER, ZERO_USER, NAMED_USER, DUAL_USER, schoolA.id, schoolB.id],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $5, 'ACCOUNTANT', 'active'),
       ($2, $5, 'F6_PAY', 'active'),
       ($3, $5, 'NAMED_ONLY', 'active'),
       ($4, $5, 'TEACHER', 'active'),
       ($4, $6, 'ACCOUNTANT', 'active')`,
    [ACCOUNTANT_A, LIVE_USER, NAMED_USER, DUAL_USER, schoolA.id, schoolB.id],
  );

  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, 'F6-STU-A', 'Ada', 'Moke', 'active', $2::timestamptz)
     RETURNING id, student_code`,
    [schoolA.id, SAME_TS],
  );
  const studentB = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, 'F6-STU-B', 'Beno', 'Kala', 'active', $2::timestamptz)
     RETURNING id, student_code`,
    [schoolB.id, SAME_TS],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, enrollment_date, status)
     VALUES
       ($1, $2, $3, $4, '2025-09-01', 'active'),
       ($5, $6, $7, $8, '2025-09-01', 'active')`,
    [schoolA.id, student.rows[0].id, CLASS_A, yearA.id, schoolB.id, studentB.rows[0].id, CLASS_B, yearB.id],
  );

  await setRolePaymentsGrant(pool, "F6_PAY", { create: true, read: true, update: true });
  return {
    schoolA: schoolA.id,
    schoolB: schoolB.id,
    studentCodeA: student.rows[0].student_code,
    studentCodeB: studentB.rows[0].student_code,
    loginA,
    loginB,
  };
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL requis pour financeLiveRbac.http.pg.test.js");
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

  try {
    await repo.init();
    const fixture = await seed(repo.pool);
    assert.match(fixture.loginA, /^[A-Z]{2}-[A-Z0-9]{2,5}-\d{2}-\d{3}$/, `login A alloué: ${fixture.loginA}`);
    assert.match(fixture.loginB, /^[A-Z]{2}-[A-Z0-9]{2,5}-\d{2}-\d{3}$/, `login B alloué: ${fixture.loginB}`);
    assert.notEqual(fixture.loginA, fixture.loginB);

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
    child.stdout.on("data", () => {});
    await waitForHealth(child, stderrRef);

    const liveToken = mintAccess(
      tokens,
      staleClaims({ sub: LIVE_USER, schoolCode: fixture.loginA, role: "Comptable", roleKeys: ["ACCOUNTANT"] }),
    );
    const accountantToken = mintAccess(
      tokens,
      staleClaims({ sub: ACCOUNTANT_A, schoolCode: fixture.loginA, role: "Comptable", roleKeys: ["ACCOUNTANT"] }),
    );
    const zeroToken = mintAccess(
      tokens,
      staleClaims({ sub: ZERO_USER, schoolCode: fixture.loginA }),
    );
    const namedToken = mintAccess(
      tokens,
      staleClaims({
        sub: NAMED_USER,
        schoolCode: fixture.loginA,
        role: "Admin School",
        roleKeys: ["SCHOOL_ADMIN"],
      }),
    );
    const dualOnA = mintAccess(
      tokens,
      staleClaims({ sub: DUAL_USER, schoolCode: fixture.loginA, role: "Comptable", roleKeys: ["ACCOUNTANT"] }),
    );
    const dualOnB = mintAccess(
      tokens,
      staleClaims({ sub: DUAL_USER, schoolCode: fixture.loginB, role: "Comptable", roleKeys: ["ACCOUNTANT"] }),
    );

    const authorized = await request("/payments", {
      method: "POST",
      token: liveToken,
      body: paymentBody(fixture.studentCodeA),
    });
    assert.equal(authorized.status, 201, `scénario 1 avant revoke: ${JSON.stringify(authorized.data)}`);
    const liveBefore = await request("/auth/effective-permissions", { token: liveToken });
    assert.equal(liveBefore.status, 200, `effective-permissions avant: ${JSON.stringify(liveBefore.data)}`);
    assert.ok(
      (liveBefore.data?.permissions ?? []).includes("Paiements:CREATE"),
      `live avant revoke doit contenir Paiements:CREATE: ${JSON.stringify(liveBefore.data)}`,
    );
    assert.deepEqual(
      liveBefore.data?.roleKeys ?? [],
      ["F6_PAY"],
      `LIVE_USER ne doit pas hériter d'ACCOUNTANT via users.role: ${JSON.stringify(liveBefore.data?.roleKeys)}`,
    );
    const beforeRevoke = await countPayments(pool, "SCH-A");

    await setRolePaymentsGrant(pool, "F6_PAY", { create: false, read: false, update: false });
    const grantAfter = await pool.query(
      `SELECT can_create, can_read, can_update, can_delete, status
       FROM role_module_permissions
       WHERE upper(role_key) = 'F6_PAY' AND module_key = 'payments' AND status = 'active'`,
    );
    assert.equal(grantAfter.rowCount, 1, `grant F6_PAY introuvable après revoke: ${JSON.stringify(grantAfter.rows)}`);
    assert.equal(grantAfter.rows[0].can_create, false, `can_create encore vrai: ${JSON.stringify(grantAfter.rows[0])}`);

    const liveAfter = await request("/auth/effective-permissions", { token: liveToken });
    assert.equal(liveAfter.status, 200, `effective-permissions après: ${JSON.stringify(liveAfter.data)}`);
    assert.equal(
      (liveAfter.data?.permissions ?? []).includes("Paiements:CREATE"),
      false,
      `live après revoke conserve Paiements:CREATE: ${JSON.stringify(liveAfter.data)}`,
    );

    const revoked = await request("/payments", {
      method: "POST",
      token: liveToken,
      body: paymentBody(fixture.studentCodeA),
    });
    assert.equal(revoked.status, 403, `scénario 1 revoke: ${JSON.stringify(revoked.data)}`);
    assert.equal(revoked.data?.code, PERMISSION_DENIED);
    assert.equal(await countPayments(pool, "SCH-A"), beforeRevoke, "aucune mutation DB après revoke");

    await setRolePaymentsGrant(pool, "F6_PAY", { create: true, read: true, update: true });
    const granted = await request("/payments", {
      method: "POST",
      token: liveToken,
      body: paymentBody(fixture.studentCodeA),
    });
    assert.equal(granted.status, 201, `scénario 2 grant: ${JSON.stringify(granted.data)}`);

    const zeroPay = await request("/payments", {
      method: "POST",
      token: zeroToken,
      body: paymentBody(fixture.studentCodeA),
    });
    assert.equal(zeroPay.status, 403, `scénario 3 zéro rôle: ${JSON.stringify(zeroPay.data)}`);
    assert.equal(zeroPay.data?.code, PERMISSION_DENIED);
    const zeroRead = await request("/payments", { token: zeroToken });
    assert.equal(zeroRead.status, 403, `scénario 3 lecture: ${JSON.stringify(zeroRead.data)}`);

    const beforeRoleChange = await countPayments(pool, "SCH-A");
    const accPay = await request("/payments", {
      method: "POST",
      token: accountantToken,
      body: paymentBody(fixture.studentCodeA),
    });
    assert.equal(accPay.status, 201, `scénario 4 avant changement: ${JSON.stringify(accPay.data)}`);
    await pool.query(
      `UPDATE user_roles SET status = 'revoked', revoked_at = NOW()
       WHERE user_id = $1 AND role_key = 'ACCOUNTANT' AND school_id = $2`,
      [ACCOUNTANT_A, fixture.schoolA],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES ($1, $2, 'TEACHER', 'active')`,
      [ACCOUNTANT_A, fixture.schoolA],
    );
    const afterRoleChange = await request("/payments", {
      method: "POST",
      token: accountantToken,
      body: paymentBody(fixture.studentCodeA),
    });
    assert.equal(afterRoleChange.status, 403, `scénario 4 rôle B: ${JSON.stringify(afterRoleChange.data)}`);
    assert.equal(await countPayments(pool, "SCH-A"), beforeRoleChange + 1, "TEACHER n'écrit pas un paiement");

    const dualReadA = await request("/payments", { token: dualOnA });
    const dualPayA = await request("/payments", {
      method: "POST",
      token: dualOnA,
      body: paymentBody(fixture.studentCodeA),
    });
    assert.equal(dualReadA.status, 403, `scénario 5 lecture A: ${JSON.stringify(dualReadA.data)}`);
    assert.equal(dualReadA.data?.code, PERMISSION_DENIED);
    assert.equal(dualPayA.status, 403, `scénario 5 mutation A: ${JSON.stringify(dualPayA.data)}`);
    assert.equal(dualPayA.data?.code, PERMISSION_DENIED);
    const dualReadB = await request("/payments", { token: dualOnB });
    assert.equal(dualReadB.status, 200, `scénario 5 lecture B: ${JSON.stringify(dualReadB.data)}`);
    const dualPayB = await request("/payments", {
      method: "POST",
      token: dualOnB,
      body: paymentBody(fixture.studentCodeB),
    });
    assert.equal(dualPayB.status, 201, `scénario 5 mutation B: ${JSON.stringify(dualPayB.data)}`);

    const namedPay = await request("/payments", {
      method: "POST",
      token: namedToken,
      body: paymentBody(fixture.studentCodeA),
    });
    const namedGrid = await request("/finance/fee-grids", {
      method: "POST",
      token: namedToken,
      body: {
        className: "6ème A",
        academicYear: "2025-2026",
        currency: "CDF",
        items: [{ feeType: "Inscription", label: "Inscription", amount: 1000, status: "Actif" }],
      },
    });
    assert.equal(namedPay.status, 403, `scénario 6 paiement: ${JSON.stringify(namedPay.data)}`);
    assert.equal(namedGrid.status, 403, `scénario 6 grille: ${JSON.stringify(namedGrid.data)}`);

    const options = await request("/finance/payment-student-options", { token: liveToken });
    assert.equal(options.status, 200, `scénario 7 options: ${JSON.stringify(options.data)}`);
    const optionRows = Array.isArray(options.data) ? options.data : options.data?.items ?? [];
    assert.ok(optionRows.length >= 1, "Comptable lit payment-student-options");
    const students = await request("/students", { token: liveToken });
    assert.equal(students.status, 403, `scénario 7 /students: ${JSON.stringify(students.data)}`);

    console.log("OK financeLiveRbac.http.pg.test.js — stale-JWT grant/revoke, zéro rôle, tenant, Comptable");
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    await stopChild(child);
    await pool.end();
    await repo.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
