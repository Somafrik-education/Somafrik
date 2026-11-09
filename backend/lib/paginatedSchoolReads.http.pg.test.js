"use strict";

/**
 * PERF-PR3 — /api/v2/presences, /api/v2/payments, /api/v2/notes en HTTP réel PostgreSQL.
 * Même JWT figé pendant tout le test : les droits sont relus en base.
 * Les routes historiques restent des tableaux complets (compatibilité Web non migré et Mobile).
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
const HTTP_PORT = Number(process.env.SOMAFRIK_PERF_PR3_HTTP_PORT ?? 19951);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";
const STAFF = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const NO_RIGHTS = "dddddddd-dddd-4ddd-8ddd-dddddddddd02";
const ROLE = "PERF_PR3_STAFF";
const EMPTY_ROLE = "PERF_PR3_NONE";

async function request(pathname, token) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = body;
  }
  return { status: response.status, data };
}

async function waitForHealth(child, stderr) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Backend exited early: ${child.exitCode}\n${stderr.value}`);
    try {
      if ((await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderr.value}`);
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

async function grant(pool, moduleKey, canRead) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = upper($1) AND module_key = $2 AND scope_type = 'global' AND status = 'active' LIMIT 1`,
    [ROLE, moduleKey],
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions SET can_read = $2, updated_by = 'perf-pr3', updated_at = NOW() WHERE id = $1`,
      [existing.rows[0].id, canRead],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by)
     VALUES ($1, 'global', $2, FALSE, $3, FALSE, FALSE, 'perf-pr3')`,
    [ROLE, moduleKey, canRead],
  );
}

async function seed(pool) {
  const country = (
    await pool.query(`INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Testland', 'TL', '+000', 'XOF') RETURNING id`)
  ).rows[0].id;
  const school = (
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, 'PR3-A', 'École PR3', 'active') RETURNING id`,
      [country],
    )
  ).rows[0].id;
  const year = (
    await pool.query(`INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2026-2027', 'open') RETURNING id`, [school])
  ).rows[0].id;
  const klass = (
    await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1, $2, 'PR3-6A', '6e A', 'active') RETURNING id`,
      [school, year],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES ($1, $3, 'PR3-STAFF', 'Sara', 'Staff', 'pr3-staff@test.local', NULL, 'active', FALSE),
            ($2, $3, 'PR3-NONE', 'Nina', 'None', 'pr3-none@test.local', NULL, 'active', FALSE)`,
    [STAFF, NO_RIGHTS, school],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $3, $4, 'active'), ($2, $3, $5, 'active')`,
    [STAFF, NO_RIGHTS, school, ROLE, EMPTY_ROLE],
  );
  for (let i = 0; i < 12; i += 1) {
    const student = (
      await pool.query(
        `INSERT INTO students (school_id, student_code, first_name, last_name, status) VALUES ($1, $2, 'Eleve', $3, 'active') RETURNING id`,
        [school, `PR3-S${i}`, `N${i}`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1, $2, $3, $4, 'enrolled')`,
      [school, student, klass, year],
    );
    for (const day of ["2025-10-01", "2026-11-03", "2026-11-04"]) {
      await pool.query(
        `INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status) VALUES ($1, $2, $3, $4, 'present')`,
        [school, student, klass, day],
      );
    }
    await pool.query(
      `INSERT INTO payments (school_id, student_id, payment_code, amount, currency, payment_method, payment_status, payment_date)
       VALUES ($1, $2, $3, 100, 'XOF', 'cash', 'paid', '2026-11-03')`,
      [school, student, `PR3-PAY-${i}`],
    );
  }
  for (const moduleKey of ["attendance", "payments", "grades", "students"]) await grant(pool, moduleKey, true);
}

async function main() {
  if (!DATABASE_URL) {
    console.log("paginatedSchoolReads.http.pg.test.js: SKIP (DATABASE_URL absent)");
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
    const stderr = { value: "" };
    child.stderr.on("data", (chunk) => {
      stderr.value += String(chunk);
    });
    child.stdout.on("data", () => {});
    await waitForHealth(child, stderr);

    const claims = (sub, roleKey) => ({
      sub,
      schoolCode: "PR3-A",
      role: "Secrétaire",
      roleKeys: [roleKey],
      // Droits figés dans le JWT : jamais utilisés comme autorité.
      permissions: ["Présences:READ", "Paiements:READ", "Notes:READ", "Élèves:READ"],
      mustChangePassword: false,
    });
    const staff = await mintSessionAccessToken({ tokens, repository: repo, payload: claims(STAFF, ROLE) });
    const none = await mintSessionAccessToken({ tokens, repository: repo, payload: claims(NO_RIGHTS, EMPTY_ROLE) });

    const first = await request("/v2/presences?limit=10", staff);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.items.length, 10);
    assert.equal(first.data.hasMore, true);
    const second = await request(`/v2/presences?limit=10&cursor=${encodeURIComponent(first.data.nextCursor)}`, staff);
    assert.equal(second.status, 200);
    const ids = [...first.data.items, ...second.data.items].map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length, "pas de doublon entre pages HTTP");
    const today = await request("/v2/presences?date=2026-11-04&limit=200", staff);
    assert.equal(today.data.items.length, 12);
    assert.equal(today.data.hasMore, false);

    // Compatibilité : la route historique reste un tableau complet.
    const historic = await request("/presences", staff);
    assert.equal(historic.status, 200);
    assert.ok(Array.isArray(historic.data), "GET /api/presences reste un tableau");
    assert.equal(historic.data.length, 36);
    const historicPayments = await request("/payments", staff);
    assert.ok(Array.isArray(historicPayments.data), "GET /api/payments reste un tableau");
    assert.equal(historicPayments.data.length, 12);

    const payments = await request("/v2/payments?limit=5&q=N1", staff);
    assert.equal(payments.status, 200, JSON.stringify(payments.data));
    assert.equal(payments.data.items.length, 3, "N1, N10, N11");
    assert.ok(payments.data.items.every((row) => /N1/.test(row.studentName)));
    const notes = await request("/v2/notes", staff);
    assert.equal(notes.status, 200, JSON.stringify(notes.data));
    assert.deepEqual(notes.data, { items: [], nextCursor: null, hasMore: false });

    // Paramètres invalides : refus explicite.
    for (const bad of ["limit=0", "limit=500", "limit=abc", "date=2026-02-30", "cursor=xyz", "sort=nom", "status=Inconnu"]) {
      const response = await request(`/v2/presences?${bad}`, staff);
      assert.equal(response.status, 400, `${bad} : ${JSON.stringify(response.data)}`);
    }

    // Aucun droit en base, malgré le JWT : refus.
    for (const route of ["/v2/presences", "/v2/payments", "/v2/notes"]) {
      assert.equal((await request(route, none)).status, 403, `${route} sans droit`);
    }

    // Retrait live du droit finance sur un JWT figé.
    await grant(repo.pool, "payments", false);
    assert.equal((await request("/v2/payments", staff)).status, 403, "Paiements:READ retiré en base");
    assert.equal((await request("/v2/presences?limit=1", staff)).status, 200, "les autres droits restent");
    await grant(repo.pool, "attendance", false);
    assert.equal((await request("/v2/presences", staff)).status, 403, "Présences:READ retiré en base");

    console.log("OK paginatedSchoolReads.http.pg.test.js — pagination HTTP, compatibilité, RBAC live");
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
