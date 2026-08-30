"use strict";

/**
 * F8 — parcours canonique PostgreSQL réel (école → grille → obligation →
 * encaissement → solde → annulation → impayé → relance → revoke → tenant).
 */

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { PERMISSION_DENIED } = require("../services/rbacService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_FINANCE_F8_IT_DATABASE ?? "somafrik_finance_f8_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_FINANCE_F8_HTTP_PORT ?? 19872);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const ACCOUNTANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81";
const ACCOUNTANT_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa83";
const LIVE_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa82";
const CLASS_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb81";
const CLASS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb82";
const CLASS_TRAP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb83";
const CLASS_A2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb84";
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
    role: "Comptable",
    roleKeys: ["ACCOUNTANT"],
    permissions: ["ALL_PRIVILEGES", "Paiements:UPDATE", "Paiements:CREATE", "Paiements:READ"],
    ...overrides,
  };
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
       SET can_create = $2, can_read = $3, can_update = $4, can_delete = FALSE, updated_by = 'f8-http', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, flags.create, flags.read, flags.update],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', $2, $3, $4, $5, FALSE, 'f8-http')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update],
  );
}

async function grantFinance(pool, roleKey, enabled) {
  const flags = enabled
    ? { create: true, read: true, update: true }
    : { create: false, read: false, update: false };
  await setRoleModuleGrant(pool, roleKey, "payments", flags);
  await setRoleModuleGrant(pool, roleKey, "fees", flags);
  await setRoleModuleGrant(pool, roleKey, "unpaid", flags);
}

async function countRows(pool, sql, params) {
  const result = await pool.query(sql, params);
  return result.rows[0].c;
}

async function seed(pool) {
  const ci = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('F8 Côte test', 'CI', '+225', 'XOF') RETURNING id`,
  );
  const fr = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('F8 France test', 'FR', '+33', 'EUR') RETURNING id`,
  );
  await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'SCH-F8-A', 'École F8 A', 'active'), ($2, 'SCH-F8-B', 'École F8 B', 'active')`,
    [ci.rows[0].id, fr.rows[0].id],
  );
  const schoolA = (
    await pool.query(`SELECT id, login_code, school_code FROM schools WHERE school_code = 'SCH-F8-A'`)
  ).rows[0];
  const schoolB = (
    await pool.query(`SELECT id, login_code, school_code FROM schools WHERE school_code = 'SCH-F8-B'`)
  ).rows[0];
  const loginA = String(schoolA.login_code ?? "").trim().toUpperCase();
  const loginB = String(schoolB.login_code ?? "").trim().toUpperCase();
  if (!loginA || !loginB) {
    throw new Error("login_code F8 A/B manquant après INSERT leftover");
  }
  if (loginA === "SCH-F8-A" || loginB === "SCH-F8-B") {
    throw new Error("login_code F8 ne doit pas égaler le leftover school_code");
  }
  await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'CI-TRAP-26-001', 'École piège FR préfixe CI', 'active')`,
    [fr.rows[0].id],
  );
  const schoolTrap = (
    await pool.query(`SELECT id, login_code, school_code FROM schools WHERE school_code = 'CI-TRAP-26-001'`)
  ).rows[0];
  const loginTrap = String(schoolTrap.login_code ?? "").trim().toUpperCase();
  if (!loginTrap) {
    throw new Error("login_code piège manquant après INSERT leftover");
  }
  if (loginTrap === "CI-TRAP-26-001") {
    throw new Error("login_code piège ne doit pas égaler le leftover school_code");
  }
  await pool.query(
    `INSERT INTO academic_years (school_id, name, status)
     SELECT id, '2025-2026', 'open' FROM schools WHERE school_code IN ('SCH-F8-A', 'SCH-F8-B', 'CI-TRAP-26-001')`,
  );
  const yearA = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-F8-A' LIMIT 1`,
    )
  ).rows[0];
  const yearB = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-F8-B' LIMIT 1`,
    )
  ).rows[0];
  const yearTrap = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'CI-TRAP-26-001' LIMIT 1`,
    )
  ).rows[0];

  await pool.query(
    `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status, updated_at)
     VALUES
       ($1, $5, $8, 'F8-CLS-A', '6ème A', 'active', $11::timestamptz),
       ($2, $6, $9, 'F8-CLS-B', '6ème B', 'active', $11::timestamptz),
       ($3, $5, $8, 'F8-CLS-A2', '6ème A2', 'active', $11::timestamptz),
       ($4, $7, $10, 'F8-CLS-TRAP', '6ème Piège', 'active', $11::timestamptz)`,
    [
      CLASS_A,
      CLASS_B,
      CLASS_A2,
      CLASS_TRAP,
      schoolA.id,
      schoolB.id,
      schoolTrap.id,
      yearA.id,
      yearB.id,
      yearTrap.id,
      SAME_TS,
    ],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $4, 'ACC-F8-A', 'Carla', 'A', 'acc-f8-a@test.local', 'Comptable', 'active', FALSE),
       ($2, $4, 'LIVE-F8', 'Live', 'Pay', 'live-f8@test.local', NULL, 'active', FALSE),
       ($3, $5, 'ACC-F8-B', 'Bruno', 'B', 'acc-f8-b@test.local', 'Comptable', 'active', FALSE)`,
    [ACCOUNTANT_A, LIVE_USER, ACCOUNTANT_B, schoolA.id, schoolB.id],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $3, 'ACCOUNTANT', 'active'),
       ($2, $3, 'F8_PAY', 'active'),
       ($4, $5, 'ACCOUNTANT', 'active')`,
    [ACCOUNTANT_A, LIVE_USER, schoolA.id, ACCOUNTANT_B, schoolB.id],
  );

  const studentA1 = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, 'F8-STU-A1', 'Ada', 'Koffi', 'active', $2::timestamptz)
     RETURNING id, student_code`,
    [schoolA.id, SAME_TS],
  );
  const studentA2 = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, 'F8-STU-A2', 'Binta', 'Yao', 'active', $2::timestamptz)
     RETURNING id, student_code`,
    [schoolA.id, SAME_TS],
  );
  const studentB = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, 'F8-STU-B1', 'Chloé', 'Martin', 'active', $2::timestamptz)
     RETURNING id, student_code`,
    [schoolB.id, SAME_TS],
  );
  const studentTrap = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status, updated_at)
     VALUES ($1, 'F8-STU-TRAP', 'Léo', 'Dupont', 'active', $2::timestamptz)
     RETURNING id, student_code`,
    [schoolTrap.id, SAME_TS],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, enrollment_date, status)
     VALUES
       ($1, $2, $3, $4, '2025-09-01', 'active'),
       ($1, $5, $3, $4, '2025-09-01', 'active'),
       ($6, $7, $8, $9, '2025-09-01', 'active'),
       ($10, $11, $12, $13, '2025-09-01', 'active')`,
    [
      schoolA.id,
      studentA1.rows[0].id,
      CLASS_A,
      yearA.id,
      studentA2.rows[0].id,
      schoolB.id,
      studentB.rows[0].id,
      CLASS_B,
      yearB.id,
      schoolTrap.id,
      studentTrap.rows[0].id,
      CLASS_TRAP,
      yearTrap.id,
    ],
  );

  await grantFinance(pool, "ACCOUNTANT", true);
  await grantFinance(pool, "F8_PAY", true);
  await grantFinance(pool, "COUNTRY_ADMIN", true);

  return {
    schoolA: schoolA.id,
    schoolB: schoolB.id,
    studentCodeA1: studentA1.rows[0].student_code,
    studentCodeA2: studentA2.rows[0].student_code,
    studentCodeB: studentB.rows[0].student_code,
    studentCodeTrap: studentTrap.rows[0].student_code,
    loginA,
    loginB,
    loginTrap,
  };
}

function gridBody(classId, className, currency) {
  return {
    classId,
    className,
    academicYear: "2025-2026",
    currency,
    items: [
      {
        feeType: "Inscription",
        label: "Inscription F8",
        amount: 100,
        status: "Actif",
        dueDate: "2026-01-01",
      },
      {
        feeType: "Scolarité",
        label: "Scolarité F8",
        amount: 200,
        status: "Actif",
        dueDate: "2026-01-01",
      },
    ],
  };
}

function obligationOf(fees, studentCode, feeType) {
  const wanted = String(feeType).toLowerCase();
  return fees.find((row) => {
    const student = String(row.studentId ?? row.studentCode ?? "").toUpperCase();
    const type = String(row.feeType ?? row.label ?? "").toLowerCase();
    return student === String(studentCode).toUpperCase() && type.includes(wanted);
  });
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL requis pour financeReadiness.http.pg.test.js");
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

    const accountantA = mintAccess(
      tokens,
      staleClaims({
        sub: ACCOUNTANT_A,
        schoolCode: fixture.loginA,
        role: "Comptable",
        roleKeys: ["ACCOUNTANT"],
      }),
    );
    const accountantB = mintAccess(
      tokens,
      staleClaims({
        sub: ACCOUNTANT_B,
        schoolCode: fixture.loginB,
        role: "Comptable",
        roleKeys: ["ACCOUNTANT"],
      }),
    );
    const liveToken = mintAccess(
      tokens,
      staleClaims({
        sub: LIVE_USER,
        schoolCode: fixture.loginA,
        role: "Comptable",
        roleKeys: ["ACCOUNTANT"],
      }),
    );

    const leftoverAToken = mintAccess(
      tokens,
      staleClaims({
        sub: ACCOUNTANT_A,
        schoolCode: "SCH-F8-A",
        role: "Comptable",
        roleKeys: ["ACCOUNTANT"],
      }),
    );
    const leftoverPay = await request("/payments", {
      method: "POST",
      token: leftoverAToken,
      headers: { "Idempotency-Key": "f8-leftover-refused" },
      body: {
        studentId: fixture.studentCodeA1,
        items: [{ feeType: "Non imputé", amount: 1 }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.ok(
      [403, 404].includes(leftoverPay.status),
      `principal leftover SCH-F8-A refusé: ${JSON.stringify(leftoverPay.data)}`,
    );

    const catalog = await request("/finance/catalog", { token: accountantA });
    assert.equal(catalog.status, 200, `catalogue A: ${JSON.stringify(catalog.data)}`);
    assert.equal(catalog.data?.currency, "XOF", `devise A doit être XOF, pas un repli: ${JSON.stringify(catalog.data)}`);

    const createdGrid = await request("/finance/fee-grids", {
      method: "POST",
      token: accountantA,
      body: gridBody(CLASS_A, "6ème A", "XOF"),
    });
    assert.equal(createdGrid.status, 201, `création grille A: ${JSON.stringify(createdGrid.data)}`);
    const gridId = createdGrid.data?.id || createdGrid.data?.grid?.id;
    assert.ok(gridId, "id grille A");
    assert.equal(createdGrid.data?.currency || createdGrid.data?.grid?.currency, "XOF");

    const activate = await request(`/finance/fee-grids/${encodeURIComponent(gridId)}/activate`, {
      method: "POST",
      token: accountantA,
    });
    assert.equal(activate.status, 200, `activation: ${JSON.stringify(activate.data)}`);

    const apply1 = await request(`/finance/fee-grids/${encodeURIComponent(gridId)}/apply`, {
      method: "POST",
      token: accountantA,
      headers: { "Idempotency-Key": "f8-apply-a-1" },
    });
    assert.equal(apply1.status, 200, `application 1: ${JSON.stringify(apply1.data)}`);
    assert.equal(apply1.data?.created, 4, `2 élèves × 2 frais: ${JSON.stringify(apply1.data)}`);

    const apply2 = await request(`/finance/fee-grids/${encodeURIComponent(gridId)}/apply`, {
      method: "POST",
      token: accountantA,
      headers: { "Idempotency-Key": "f8-apply-a-2" },
    });
    assert.equal(apply2.status, 200, `application 2: ${JSON.stringify(apply2.data)}`);
    assert.equal(apply2.data?.created, 0, "seconde application sans obligation dupliquée");
    const obligationCount = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM student_fee_obligations o
       JOIN schools s ON s.id = o.school_id
       WHERE s.school_code = 'SCH-F8-A' AND o.archived_at IS NULL`,
    );
    assert.equal(obligationCount, 4, "unicité obligations après rejeu apply");

    const feesA = unwrapList((await request("/finance/student-fees", { token: accountantA })).data);
    assert.equal(feesA.length, 4, `obligations A: ${JSON.stringify(feesA)}`);
    assert.ok(feesA.every((row) => String(row.currency).toUpperCase() === "XOF"), "obligations en XOF");
    assert.ok(feesA.every((row) => Number(row.balance) > 0));

    const insA1 = obligationOf(feesA, fixture.studentCodeA1, "inscription");
    const scoA1 = obligationOf(feesA, fixture.studentCodeA1, "scolar");
    const insA2 = obligationOf(feesA, fixture.studentCodeA2, "inscription");
    const scoA2 = obligationOf(feesA, fixture.studentCodeA2, "scolar");
    assert.ok(insA1 && scoA1 && insA2 && scoA2, "quatre obligations ciblées");

    const foreignFee = await request(`/finance/student-fees/${encodeURIComponent(insA1.id)}`, {
      token: accountantB,
    });
    assert.ok([403, 404].includes(foreignFee.status), `GET obligation étrangère: ${JSON.stringify(foreignFee.data)}`);

    const zeroPay = await request("/payments", {
      method: "POST",
      token: accountantA,
      body: {
        studentId: fixture.studentCodeA1,
        items: [{ obligationId: insA1.id, amount: 0, feeType: "Inscription" }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.equal(zeroPay.status, 400, `paiement 0: ${JSON.stringify(zeroPay.data)}`);

    const negativePay = await request("/payments", {
      method: "POST",
      token: accountantA,
      body: {
        studentId: fixture.studentCodeA1,
        items: [{ obligationId: insA1.id, amount: -10, feeType: "Inscription" }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.equal(negativePay.status, 400, `paiement négatif: ${JSON.stringify(negativePay.data)}`);

    const partial = await request("/payments", {
      method: "POST",
      token: accountantA,
      headers: { "Idempotency-Key": "f8-pay-partial-a1" },
      body: {
        studentId: fixture.studentCodeA1,
        schoolId: fixture.schoolB,
        items: [{ obligationId: insA1.id, amount: 40, feeType: "Inscription" }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.equal(partial.status, 201, `paiement partiel: ${JSON.stringify(partial.data)}`);
    assert.equal(partial.data?.currency, "XOF");
    assert.equal(Number(partial.data?.amount ?? partial.data?.totalAmount), 40);
    assert.equal(Number(partial.data?.allocatedAmount), 40);
    assert.equal(Number(partial.data?.unallocatedAmount ?? 0), 0);

    const afterPartial = unwrapList((await request("/finance/student-fees", { token: accountantA })).data);
    const insA1After = obligationOf(afterPartial, fixture.studentCodeA1, "inscription");
    assert.equal(Number(insA1After.balance), 60, `solde après 40: ${JSON.stringify(insA1After)}`);
    assert.ok(["Partiellement payé", "En retard"].includes(insA1After.status), insA1After.status);

    const rest = await request("/payments", {
      method: "POST",
      token: accountantA,
      headers: { "Idempotency-Key": "f8-pay-rest-a1" },
      body: {
        studentId: fixture.studentCodeA1,
        items: [{ obligationId: insA1.id, amount: 60, feeType: "Inscription" }],
        method: "Mobile money",
        date: "2026-08-28",
      },
    });
    assert.equal(rest.status, 201, `Mobile money 60: ${JSON.stringify(rest.data)}`);
    assert.equal(Number(rest.data?.allocatedAmount), 60, "Mobile money doit être imputé (paid), pas pending");
    const afterFullIns = unwrapList((await request("/finance/student-fees", { token: accountantA })).data);
    const insA1Paid = obligationOf(afterFullIns, fixture.studentCodeA1, "inscription");
    assert.equal(Number(insA1Paid.balance), 0);
    assert.equal(insA1Paid.status, "Payé");

    const cancelRest = await request(`/payments/${encodeURIComponent(rest.data.id)}/cancel`, {
      method: "POST",
      token: accountantA,
      headers: { "Idempotency-Key": "f8-cancel-rest" },
      body: { reason: "F8 annulation test solde restauré" },
    });
    assert.equal(cancelRest.status, 200, `annulation: ${JSON.stringify(cancelRest.data)}`);
    assert.ok(["Annulé", "cancelled"].includes(String(cancelRest.data?.status)), cancelRest.data?.status);
    const afterCancel = unwrapList((await request("/finance/student-fees", { token: accountantA })).data);
    const insA1Restored = obligationOf(afterCancel, fixture.studentCodeA1, "inscription");
    assert.equal(Number(insA1Restored.balance), 60, "annulation restaure le solde 60");
    const reversed = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE p.payment_code = $1 AND pa.reversed_at IS NOT NULL`,
      [rest.data.id],
    );
    assert.ok(reversed >= 1, "allocations invalidées, pas de DELETE paiement");
    const paymentStillThere = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM payments WHERE payment_code = $1`,
      [rest.data.id],
    );
    assert.equal(paymentStillThere, 1, "annulation = soft cancel");

    const doubleCancel = await request(`/payments/${encodeURIComponent(rest.data.id)}/cancel`, {
      method: "POST",
      token: accountantA,
      headers: { "Idempotency-Key": "f8-cancel-rest-2" },
      body: { reason: "seconde annulation" },
    });
    assert.ok([200, 409].includes(doubleCancel.status), `double annulation: ${JSON.stringify(doubleCancel.data)}`);

    const multi = await request("/payments", {
      method: "POST",
      token: accountantA,
      headers: { "Idempotency-Key": "f8-pay-multi-a2" },
      body: {
        studentId: fixture.studentCodeA2,
        items: [
          { obligationId: insA2.id, amount: 100, feeType: "Inscription" },
          { obligationId: scoA2.id, amount: 200, feeType: "Scolarité" },
        ],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.equal(multi.status, 201, `multi-item: ${JSON.stringify(multi.data)}`);
    assert.equal(Number(multi.data?.amount ?? multi.data?.totalAmount), 300);
    const afterMulti = unwrapList((await request("/finance/student-fees", { token: accountantA })).data);
    assert.equal(Number(obligationOf(afterMulti, fixture.studentCodeA2, "inscription").balance), 0);
    assert.equal(Number(obligationOf(afterMulti, fixture.studentCodeA2, "scolar").balance), 0);

    const sameIntention = "f8-idem-same";
    const unallocatedBody = {
      studentId: fixture.studentCodeA1,
      items: [{ feeType: "Non imputé", amount: 15 }],
      method: "Espèces",
      date: "2026-08-28",
    };
    const unalloc1 = await request("/payments", {
      method: "POST",
      token: accountantA,
      headers: { "Idempotency-Key": sameIntention },
      body: unallocatedBody,
    });
    const unalloc2 = await request("/payments", {
      method: "POST",
      token: accountantA,
      headers: { "Idempotency-Key": sameIntention },
      body: unallocatedBody,
    });
    assert.equal(unalloc1.status, 201, `non imputé: ${JSON.stringify(unalloc1.data)}`);
    assert.equal(unalloc2.status, 201, `replay idempotent: ${JSON.stringify(unalloc2.data)}`);
    assert.equal(unalloc1.data?.id, unalloc2.data?.id, "même intention = un seul encaissement");
    assert.equal(Number(unalloc1.data?.unallocatedAmount ?? unalloc1.data?.overpaymentAmount), 15);

    const distinct = await request("/payments", {
      method: "POST",
      token: accountantA,
      headers: { "Idempotency-Key": "f8-idem-other" },
      body: unallocatedBody,
    });
    assert.equal(distinct.status, 201);
    assert.notEqual(distinct.data?.id, unalloc1.data?.id, "nouvelle intention = nouvel encaissement");

    const paymentsA = unwrapList((await request("/payments", { token: accountantA })).data);
    assert.ok(paymentsA.every((row) => String(row.currency).toUpperCase() === "XOF"));

    const unpaid = await request("/backoffice/finance/unpaid", { token: accountantA });
    assert.equal(unpaid.status, 200, `impayés: ${JSON.stringify(unpaid.data)}`);
    const unpaidRows = unwrapList(unpaid.data);
    const unpaidStudents = unpaidRows.map((row) => String(row.studentId ?? row.studentCode ?? "").toUpperCase());
    assert.equal(
      unpaidStudents.includes(fixture.studentCodeA2.toUpperCase()),
      false,
      "élève B soldé absent des impayés",
    );

    const reminder = await request(`/backoffice/finance/unpaid/${encodeURIComponent(fixture.studentCodeA1)}/reminders`, {
      method: "POST",
      token: accountantA,
      headers: { "Idempotency-Key": "f8-reminder-a1" },
      body: { channel: "notification", recipient: "Parent", message: "Relance F8" },
    });
    assert.equal(reminder.status, 201, `relance: ${JSON.stringify(reminder.data)}`);
    const reminderReplay = await request(
      `/backoffice/finance/unpaid/${encodeURIComponent(fixture.studentCodeA1)}/reminders`,
      {
        method: "POST",
        token: accountantA,
        headers: { "Idempotency-Key": "f8-reminder-a1" },
        body: { channel: "notification", recipient: "Parent", message: "Relance F8" },
      },
    );
    assert.equal(reminderReplay.status, 201);
    const reminderCount = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM payment_reminders r
       JOIN schools s ON s.id = r.school_id
       WHERE s.school_code = 'SCH-F8-A'`,
    );
    assert.equal(reminderCount, 1, "relance idempotente");

    const catalogB = await request("/finance/catalog", { token: accountantB });
    assert.equal(catalogB.status, 200, `catalogue B: ${JSON.stringify(catalogB.data)}`);
    assert.equal(catalogB.data?.currency, "EUR", `devise B EUR: ${JSON.stringify(catalogB.data)}`);

    const createdGridB = await request("/finance/fee-grids", {
      method: "POST",
      token: accountantB,
      body: gridBody(CLASS_B, "6ème B", "EUR"),
    });
    assert.equal(createdGridB.status, 201, `grille B: ${JSON.stringify(createdGridB.data)}`);
    const gridBId = createdGridB.data?.id;
    await request(`/finance/fee-grids/${encodeURIComponent(gridBId)}/activate`, {
      method: "POST",
      token: accountantB,
    });
    const applyB = await request(`/finance/fee-grids/${encodeURIComponent(gridBId)}/apply`, {
      method: "POST",
      token: accountantB,
    });
    assert.equal(applyB.status, 200, `apply B: ${JSON.stringify(applyB.data)}`);
    const feesB = unwrapList((await request("/finance/student-fees", { token: accountantB })).data);
    assert.ok(feesB.length >= 2, "obligations B");
    assert.ok(feesB.every((row) => String(row.currency).toUpperCase() === "EUR"));

    const getGridBFromA = await request(`/finance/fee-grids/${encodeURIComponent(gridBId)}`, {
      token: accountantA,
    });
    assert.ok([403, 404].includes(getGridBFromA.status), `grille B depuis A: ${JSON.stringify(getGridBFromA.data)}`);
    const getOblBFromA = await request(`/finance/student-fees/${encodeURIComponent(feesB[0].id)}`, {
      token: accountantA,
    });
    assert.ok([403, 404].includes(getOblBFromA.status), `obligation B depuis A: ${JSON.stringify(getOblBFromA.data)}`);

    const payB = await request("/payments", {
      method: "POST",
      token: accountantA,
      body: {
        studentId: fixture.studentCodeB,
        items: [{ feeType: "Non imputé", amount: 10 }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.ok([403, 404].includes(payB.status), `paiement élève B depuis A: ${JSON.stringify(payB.data)}`);

    const getPayB = await request(`/payments/${encodeURIComponent(unalloc1.data.id)}`, { token: accountantB });
    assert.ok([403, 404].includes(getPayB.status), `lecture paiement A depuis B: ${JSON.stringify(getPayB.data)}`);
    const listB = unwrapList((await request("/payments", { token: accountantB })).data);
    assert.equal(
      listB.some((row) => String(row.id ?? row.reference) === String(unalloc1.data.id)),
      false,
      `liste B ne doit pas contenir le paiement A: ${JSON.stringify(listB.map((row) => row.id))}`,
    );

    const cancelB = await request(`/payments/${encodeURIComponent(partial.data.id)}/cancel`, {
      method: "POST",
      token: accountantB,
      body: { reason: "tentative étrangère" },
    });
    assert.ok([403, 404].includes(cancelB.status), `annulation A depuis B: ${JSON.stringify(cancelB.data)}`);

    const applyForeign = await request(`/finance/fee-grids/${encodeURIComponent(gridId)}/apply`, {
      method: "POST",
      token: accountantB,
    });
    assert.ok([403, 404].includes(applyForeign.status), `apply grille A depuis B: ${JSON.stringify(applyForeign.data)}`);

    const reminderForeign = await request(
      `/backoffice/finance/unpaid/${encodeURIComponent(fixture.studentCodeA1)}/reminders`,
      {
        method: "POST",
        token: accountantB,
        body: { channel: "notification", recipient: "Parent", message: "x" },
      },
    );
    assert.ok(
      [403, 404].includes(reminderForeign.status),
      `relance A depuis B: ${JSON.stringify(reminderForeign.data)}`,
    );

    const payBSeed = await request("/payments", {
      method: "POST",
      token: accountantB,
      headers: { "Idempotency-Key": "f8-p0-004-seed-b" },
      body: {
        studentId: fixture.studentCodeB,
        items: [{ feeType: "Non imputé", amount: 5 }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.equal(payBSeed.status, 201, `seed paiement B: ${JSON.stringify(payBSeed.data)}`);
    const paymentBId = payBSeed.data?.id;
    assert.ok(paymentBId, "id paiement B");

    const paymentsBBefore = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM payments p JOIN schools s ON s.id = p.school_id WHERE s.school_code = 'SCH-F8-B'`,
    );
    const remindersBBefore = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM payment_reminders r JOIN schools s ON s.id = r.school_id WHERE s.school_code = 'SCH-F8-B'`,
    );
    const obligationsBBefore = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM student_fee_obligations o JOIN schools s ON s.id = o.school_id WHERE s.school_code = 'SCH-F8-B' AND o.archived_at IS NULL`,
    );

    const emptySchoolToken = mintAccess(
      tokens,
      staleClaims({
        sub: ACCOUNTANT_A,
        schoolCode: "",
        effectiveSchoolCode: fixture.loginA,
        effectiveSchoolInternalCode: fixture.loginA,
        schoolScopeSource: "request",
        role: "Comptable",
        roleKeys: ["ACCOUNTANT"],
      }),
    );
    const blankNoScopeToken = mintAccess(
      tokens,
      staleClaims({
        sub: ACCOUNTANT_A,
        schoolCode: "",
        role: "Comptable",
        roleKeys: ["ACCOUNTANT"],
      }),
    );

    const getPayAEmpty = await request(`/payments/${encodeURIComponent(unalloc1.data.id)}`, {
      token: emptySchoolToken,
    });
    assert.equal(
      getPayAEmpty.status,
      200,
      `F8-P0-004 GET paiement A schoolCode vide: ${JSON.stringify(getPayAEmpty.data)}`,
    );
    const getPayBEmpty = await request(`/payments/${encodeURIComponent(paymentBId)}`, { token: emptySchoolToken });
    assert.ok(
      [403, 404].includes(getPayBEmpty.status),
      `F8-P0-004 GET paiement B schoolCode vide: ${JSON.stringify(getPayBEmpty.data)}`,
    );

    const payAEmpty = await request("/payments", {
      method: "POST",
      token: emptySchoolToken,
      headers: { "Idempotency-Key": "f8-p0-004-pay-a" },
      body: {
        studentId: fixture.studentCodeA1,
        items: [{ feeType: "Non imputé", amount: 1 }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.equal(payAEmpty.status, 201, `F8-P0-004 POST A schoolCode vide: ${JSON.stringify(payAEmpty.data)}`);

    const payBEmpty = await request("/payments", {
      method: "POST",
      token: emptySchoolToken,
      headers: { "Idempotency-Key": "f8-p0-004-pay-b" },
      body: {
        studentId: fixture.studentCodeB,
        items: [{ feeType: "Non imputé", amount: 10 }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.ok(
      [403, 404].includes(payBEmpty.status),
      `F8-P0-004 POST paiement élève B schoolCode vide: ${JSON.stringify(payBEmpty.data)}`,
    );
    assert.equal(
      await countRows(
        pool,
        `SELECT count(*)::int AS c FROM payments p JOIN schools s ON s.id = p.school_id WHERE s.school_code = 'SCH-F8-B'`,
      ),
      paymentsBBefore,
      "F8-P0-004 compteur paiements B inchangé",
    );

    const reminderBEmpty = await request(
      `/backoffice/finance/unpaid/${encodeURIComponent(fixture.studentCodeB)}/reminders`,
      {
        method: "POST",
        token: emptySchoolToken,
        body: { channel: "notification", recipient: "Parent", message: "F8-P0-004" },
      },
    );
    assert.ok(
      [403, 404].includes(reminderBEmpty.status),
      `F8-P0-004 relance B schoolCode vide: ${JSON.stringify(reminderBEmpty.data)}`,
    );
    assert.equal(
      await countRows(
        pool,
        `SELECT count(*)::int AS c FROM payment_reminders r JOIN schools s ON s.id = r.school_id WHERE s.school_code = 'SCH-F8-B'`,
      ),
      remindersBBefore,
      "F8-P0-004 aucune payment_reminders B créée",
    );

    const getGridBEmpty = await request(`/finance/fee-grids/${encodeURIComponent(gridBId)}`, {
      token: emptySchoolToken,
    });
    assert.ok(
      [403, 404].includes(getGridBEmpty.status),
      `F8-P0-004 GET grille B schoolCode vide: ${JSON.stringify(getGridBEmpty.data)}`,
    );
    const activateBEmpty = await request(`/finance/fee-grids/${encodeURIComponent(gridBId)}/activate`, {
      method: "POST",
      token: emptySchoolToken,
    });
    assert.ok(
      [403, 404].includes(activateBEmpty.status),
      `F8-P0-004 activate B: ${JSON.stringify(activateBEmpty.data)}`,
    );
    const deactivateBEmpty = await request(`/finance/fee-grids/${encodeURIComponent(gridBId)}/deactivate`, {
      method: "POST",
      token: emptySchoolToken,
    });
    assert.ok(
      [403, 404].includes(deactivateBEmpty.status),
      `F8-P0-004 deactivate B: ${JSON.stringify(deactivateBEmpty.data)}`,
    );
    const applyBEmpty = await request(`/finance/fee-grids/${encodeURIComponent(gridBId)}/apply`, {
      method: "POST",
      token: emptySchoolToken,
    });
    assert.ok(
      [403, 404].includes(applyBEmpty.status),
      `F8-P0-004 apply B schoolCode vide: ${JSON.stringify(applyBEmpty.data)}`,
    );
    assert.equal(
      await countRows(
        pool,
        `SELECT count(*)::int AS c FROM student_fee_obligations o JOIN schools s ON s.id = o.school_id WHERE s.school_code = 'SCH-F8-B' AND o.archived_at IS NULL`,
      ),
      obligationsBBefore,
      "F8-P0-004 aucune obligation B créée/modifiée",
    );

    const blankNoScopePay = await request("/payments", {
      method: "POST",
      token: blankNoScopeToken,
      body: {
        studentId: fixture.studentCodeA1,
        items: [{ feeType: "Non imputé", amount: 1 }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.ok(
      [403, 404].includes(blankNoScopePay.status),
      `F8-P0-004 schoolCode vide sans scope effectif: ${JSON.stringify(blankNoScopePay.data)}`,
    );

    const scopedSuperToken = mintAccess(
      tokens,
      staleClaims({
        sub: ACCOUNTANT_A,
        schoolCode: "",
        effectiveSchoolCode: fixture.loginA,
        effectiveSchoolInternalCode: fixture.loginA,
        schoolScopeSource: "request",
        role: "Super Administrateur Somafrik",
        roleKeys: ["SUPER_ADMIN"],
      }),
    );
    const scopedSuperPayB = await request("/payments", {
      method: "POST",
      token: scopedSuperToken,
      body: {
        studentId: fixture.studentCodeB,
        items: [{ feeType: "Non imputé", amount: 10 }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.ok(
      [403, 404].includes(scopedSuperPayB.status),
      `F8-P0-004 Superadmin request-scoped A ne paie pas B: ${JSON.stringify(scopedSuperPayB.data)}`,
    );
    assert.equal(
      await countRows(
        pool,
        `SELECT count(*)::int AS c FROM payments p JOIN schools s ON s.id = p.school_id WHERE s.school_code = 'SCH-F8-B'`,
      ),
      paymentsBBefore,
      "F8-P0-004 Superadmin scoped: compteur B inchangé",
    );
    const scopedSuperGetA = await request(`/payments/${encodeURIComponent(unalloc1.data.id)}`, {
      token: scopedSuperToken,
    });
    assert.equal(
      scopedSuperGetA.status,
      200,
      `F8-P0-004 Superadmin scoped lit A: ${JSON.stringify(scopedSuperGetA.data)}`,
    );

    const countryAdminToken = mintAccess(
      tokens,
      staleClaims({
        sub: ACCOUNTANT_A,
        schoolCode: "",
        countryCode: "CI",
        role: "Admin Pays",
        roleKeys: ["COUNTRY_ADMIN"],
        permissions: [
          "ALL_PRIVILEGES",
          "Paiements:UPDATE",
          "Paiements:CREATE",
          "Paiements:READ",
          "Frais & tarifs:CREATE",
          "Frais & tarifs:UPDATE",
        ],
      }),
    );
    const countryGetA = await request(`/payments/${encodeURIComponent(unalloc1.data.id)}`, {
      token: countryAdminToken,
    });
    assert.equal(countryGetA.status, 200, `F8-P0-004 Admin Pays CI lit A: ${JSON.stringify(countryGetA.data)}`);
    const countryPayB = await request("/payments", {
      method: "POST",
      token: countryAdminToken,
      body: {
        studentId: fixture.studentCodeB,
        items: [{ feeType: "Non imputé", amount: 10 }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.ok(
      [403, 404].includes(countryPayB.status),
      `F8-P0-004 Admin Pays CI refuse FR/B: ${JSON.stringify(countryPayB.data)}`,
    );

    const countryPayA = await request("/payments", {
      method: "POST",
      token: countryAdminToken,
      body: {
        studentId: fixture.studentCodeA1,
        items: [{ feeType: "Non imputé", amount: 5 }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.equal(
      countryPayA.status,
      201,
      `F8-P1-006 Admin Pays CI paie A (school_code sans préfixe CI): ${JSON.stringify(countryPayA.data)}`,
    );

    const countryGridA = await request("/finance/fee-grids", {
      method: "POST",
      token: countryAdminToken,
      body: { ...gridBody(CLASS_A2, "6ème A2", "XOF"), schoolCode: fixture.loginA },
    });
    assert.equal(
      countryGridA.status,
      201,
      `F8-P1-006 Admin Pays CI crée grille A: ${JSON.stringify(countryGridA.data)}`,
    );

    const countryGridB = await request("/finance/fee-grids", {
      method: "POST",
      token: countryAdminToken,
      body: { ...gridBody(CLASS_B, "6ème B", "EUR"), schoolCode: fixture.loginB },
    });
    assert.ok(
      [403, 404].includes(countryGridB.status),
      `F8-P1-006 Admin Pays CI refuse grille B: ${JSON.stringify(countryGridB.data)}`,
    );

    const countryPayTrap = await request("/payments", {
      method: "POST",
      token: countryAdminToken,
      body: {
        studentId: fixture.studentCodeTrap,
        items: [{ feeType: "Non imputé", amount: 10 }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.ok(
      [403, 404].includes(countryPayTrap.status),
      `F8-P1-006 Admin Pays CI refuse paiement piège préfixe CI: ${JSON.stringify(countryPayTrap.data)}`,
    );

    const countryGridTrap = await request("/finance/fee-grids", {
      method: "POST",
      token: countryAdminToken,
      body: { ...gridBody(CLASS_TRAP, "6ème Piège", "EUR"), schoolCode: fixture.loginTrap },
    });
    assert.ok(
      [403, 404].includes(countryGridTrap.status),
      `F8-P1-006 Admin Pays CI refuse grille piège préfixe CI: ${JSON.stringify(countryGridTrap.data)}`,
    );
    assert.equal(
      await countRows(
        pool,
        `SELECT count(*)::int AS c FROM payments p JOIN schools s ON s.id = p.school_id WHERE s.school_code = 'CI-TRAP-26-001'`,
      ),
      0,
      "F8-P1-006 aucune paiement créé sur l'école piège FR préfixe CI",
    );

    const globalSuperToken = mintAccess(
      tokens,
      staleClaims({
        sub: ACCOUNTANT_A,
        schoolCode: "",
        role: "Super Administrateur Somafrik",
        roleKeys: ["SUPER_ADMIN"],
      }),
    );
    const globalGetB = await request(`/payments/${encodeURIComponent(paymentBId)}`, { token: globalSuperToken });
    assert.equal(
      globalGetB.status,
      200,
      `F8-P0-004 Superadmin global conserve l'accès B: ${JSON.stringify(globalGetB.data)}`,
    );

    const raceBody = {
      studentId: fixture.studentCodeA1,
      items: [{ obligationId: scoA1.id, amount: 150, feeType: "Scolarité" }],
      method: "Espèces",
      date: "2026-08-28",
    };
    const [race1, race2] = await Promise.all([
      request("/payments", {
        method: "POST",
        token: accountantA,
        headers: { "Idempotency-Key": randomUUID() },
        body: raceBody,
      }),
      request("/payments", {
        method: "POST",
        token: accountantA,
        headers: { "Idempotency-Key": randomUUID() },
        body: raceBody,
      }),
    ]);
    const raceOk = [race1, race2].filter((row) => row.status === 201);
    assert.ok(raceOk.length >= 1, `concurrence: ${JSON.stringify([race1.status, race2.status, race1.data, race2.data])}`);
    const scoAfterRace = obligationOf(
      unwrapList((await request("/finance/student-fees", { token: accountantA })).data),
      fixture.studentCodeA1,
      "scolar",
    );
    assert.ok(Number(scoAfterRace.balance) >= 0, "solde jamais négatif");
    const allocatedSco = await countRows(
      pool,
      `SELECT COALESCE(SUM(pa.amount),0)::int AS c
       FROM payment_allocations pa
       JOIN student_fee_obligations o ON o.id = pa.obligation_id
       JOIN students st ON st.id = o.student_id
       WHERE st.student_code = $1 AND o.fee_type ILIKE '%Scolarité%' AND pa.reversed_at IS NULL`,
      [fixture.studentCodeA1],
    );
    assert.ok(allocatedSco <= 200, `jamais over-alloué: ${allocatedSco}`);

    const livePay = await request("/payments", {
      method: "POST",
      token: liveToken,
      body: {
        studentId: fixture.studentCodeA1,
        items: [{ feeType: "Non imputé", amount: 1 }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.equal(livePay.status, 201, `live grant avant revoke: ${JSON.stringify(livePay.data)}`);

    await grantFinance(pool, "F8_PAY", false);
    const beforeRevoke = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM payments p JOIN schools s ON s.id = p.school_id WHERE s.school_code = 'SCH-F8-A'`,
    );
    const revoked = await request("/payments", {
      method: "POST",
      token: liveToken,
      body: {
        studentId: fixture.studentCodeA1,
        items: [{ feeType: "Non imputé", amount: 1 }],
        method: "Espèces",
        date: "2026-08-28",
      },
    });
    assert.equal(revoked.status, 403, `revoke stale JWT: ${JSON.stringify(revoked.data)}`);
    assert.equal(revoked.data?.code, PERMISSION_DENIED);
    assert.equal(
      await countRows(
        pool,
        `SELECT count(*)::int AS c FROM payments p JOIN schools s ON s.id = p.school_id WHERE s.school_code = 'SCH-F8-A'`,
      ),
      beforeRevoke,
      "aucune mutation après revoke",
    );

    const audits = await countRows(
      pool,
      `SELECT count(*)::int AS c FROM audit_logs WHERE action IN ('create_payment', 'cancel_payment')`,
    );
    assert.ok(audits >= 2, `audit create/cancel: ${audits}`);

    console.log("OK financeReadiness.http.pg.test.js — parcours F8 PostgreSQL réel");
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
