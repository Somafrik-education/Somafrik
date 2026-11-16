"use strict";

/**
 * PERF-PR2 — GET /api/dashboard/school-kpis, HTTP réel PostgreSQL, JWT figé.
 * Le même jeton porte Élèves:READ et Paiements:READ du début à la fin.
 * Les droits sont retirés puis rendus en base : la réponse doit suivre la base,
 * jamais le JWT.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { mintSessionAccessToken } = require("./testAccessSession");
const {
  assertOwnedDisposable,
  createOwnedDisposableDatabase,
  dropOwnedDisposableDatabase,
} = require("./perfPr1DisposableDatabase");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_PERF_PR2_KPI_RBAC_HTTP_PORT ?? 19943);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";
const STAFF_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const ROLE_KEY = "PERF_PR2_KPI";

async function request(pathname, token) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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

async function setGrant(pool, moduleKey, canRead) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = upper($1) AND module_key = $2 AND scope_type = 'global' AND status = 'active'
     LIMIT 1`,
    [ROLE_KEY, moduleKey],
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_read = $2, can_create = FALSE, can_update = FALSE, can_delete = FALSE,
           updated_by = 'perf-pr2-kpi', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, canRead],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     ) VALUES ($1, 'global', $2, FALSE, $3, FALSE, FALSE, 'perf-pr2-kpi')`,
    [ROLE_KEY, moduleKey, canRead],
  );
}

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('Testland', 'TK', '+000', 'XOF') RETURNING id`,
  );
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'KPI-A', 'École KPI', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  const schoolId = school.rows[0].id;
  const year = await pool.query(
    `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2026-2027', 'open') RETURNING id`,
    [schoolId],
  );
  const klass = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'KPI-6A', '6e A', 'active') RETURNING id`,
    [schoolId, year.rows[0].id],
  );
  // users.role NULL : les droits ne viennent que de user_roles, relus en base.
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES ($1, $2, 'KPI-STAFF', 'Kadi', 'Staff', 'kpi-staff@test.local', NULL, 'active', FALSE)`,
    [STAFF_USER, schoolId],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, $3, 'active')`,
    [STAFF_USER, schoolId, ROLE_KEY],
  );
  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'KPI-S1', 'Ada', 'Moke', 'active') RETURNING id`,
    [schoolId],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [schoolId, student.rows[0].id, klass.rows[0].id, year.rows[0].id],
  );
  await pool.query(
    `INSERT INTO payments (school_id, student_id, payment_code, amount, currency, payment_method, payment_status, payment_date)
     VALUES ($1, $2, 'KPI-PAY-1', 500, 'XOF', 'cash', 'paid', CURRENT_DATE)`,
    [schoolId, student.rows[0].id],
  );
  await setGrant(pool, "students", true);
  await setGrant(pool, "payments", true);
}

async function main() {
  if (!DATABASE_URL) {
    console.log("schoolDashboardKpis.liveRbac.http.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  const owned = await createOwnedDisposableDatabase(DATABASE_URL);
  await assertOwnedDisposable(owned.pool, owned.databaseName, owned.token);
  await owned.pool.end();
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const repo = createPostgresRepository(owned.connectionString);
  const tokens = new TokenService({ secret: JWT_SECRET });
  let child = null;
  try {
    await repo.init();
    await seed(repo.pool);

    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(HTTP_PORT),
        DATABASE_URL: owned.connectionString,
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

    // Jeton figé : les droits du JWT ne changent jamais pendant le test.
    const token = await mintSessionAccessToken({
      tokens,
      repository: repo,
      payload: {
        sub: STAFF_USER,
        schoolCode: "KPI-A",
        role: "Comptable",
        roleKeys: [ROLE_KEY],
        permissions: ["Élèves:READ", "Paiements:READ"],
        mustChangePassword: false,
      },
    });

    const granted = await request("/dashboard/school-kpis?period=monthly", token);
    assert.equal(granted.status, 200, `avant retrait : ${JSON.stringify(granted.data)}`);
    assert.equal(granted.data.cards.students, 1);
    assert.equal(granted.data.cards.revenue?.amount, 500, `recettes avant retrait : ${JSON.stringify(granted.data.cards)}`);
    assert.notEqual(granted.data.series.paymentStatus, null);

    await setGrant(repo.pool, "payments", false);
    const revoked = await request("/dashboard/school-kpis?period=monthly", token);
    assert.equal(revoked.status, 200, `après retrait finance : ${JSON.stringify(revoked.data)}`);
    assert.equal(revoked.data.cards.revenue, null, "recettes encore servies après retrait de Paiements:READ");
    assert.equal(revoked.data.cards.paymentRate, null, "taux de paiement encore servi après retrait");
    assert.equal(revoked.data.series.paymentStatus, null);
    assert.equal(revoked.data.series.paymentAmounts, null);
    assert.equal(revoked.data.cards.students, 1, "le droit Élèves restant est conservé");

    await setGrant(repo.pool, "payments", true);
    const regranted = await request("/dashboard/school-kpis?period=monthly", token);
    assert.equal(regranted.status, 200);
    assert.equal(regranted.data.cards.revenue?.amount, 500, "le droit rendu est relu en base");

    await setGrant(repo.pool, "payments", false);
    await setGrant(repo.pool, "students", false);
    const none = await request("/dashboard/school-kpis?period=monthly", token);
    assert.equal(none.status, 403, `aucun droit restant : ${JSON.stringify(none.data)}`);

    const health = await request("/auth/effective-permissions", token);
    assert.equal(health.status, 200, "le JWT est resté valide pendant tout le test");

    console.log("OK schoolDashboardKpis.liveRbac.http.pg.test.js — retrait, rétablissement et retrait total sur JWT figé");
  } finally {
    await stopChild(child);
    await repo.close().catch(() => {});
    await dropOwnedDisposableDatabase(DATABASE_URL, owned.databaseName, owned.token);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
