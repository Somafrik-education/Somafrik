"use strict";

/**
 * HTTP réel — Express → requireAuth → requirePermission → route → PostgreSQL.
 * Admin 200, Teacher scoped 200, Comptable 403, tamper 400,
 * scope_changed 409 (revoke PG, même JWT), tenant mismatch 403.
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { MOBILE_SYNC_ERROR } = require("./mobileSyncErrors");
const { PERMISSION_DENIED } = require("../services/rbacService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_MOBILE_SYNC_L1_HTTP_IT_DATABASE ?? "somafrik_mobile_sync_l1_http_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_MOBILE_SYNC_L1_HTTP_PORT ?? 19855);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const ADMIN_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const TEACHER_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ACCOUNTANT_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const DUAL_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const ACC_DUAL_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const CUSTOM_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const TEACHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DUAL_TEACHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc10";
const SUBJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DUAL_SUBJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb10";
const ASSIGN_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ASSIGN_C = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DUAL_ASSIGN_A = "dddddddd-dddd-4ddd-8ddd-dddddddddd10";
const ID_B_ONLY = "55555555-5555-4555-8555-555555555555";
const SAME_TS = "2026-08-26T08:00:00.000Z";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  if (!databaseName) throw new Error("SOMAFRIK_MOBILE_SYNC_L1_HTTP_IT_DATABASE invalide.");
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) {
      await pool.query(`CREATE DATABASE ${databaseName}`);
    }
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function request(pathname, { method = "GET", token } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Backend health timeout");
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
  return tokens.createAccessToken({
    mustChangePassword: false,
    ...payload,
  });
}

async function grantTeacherClassesRead(pool) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = 'TEACHER'
       AND module_key = 'classes'
       AND scope_type = 'global'
       AND status = 'active'
     LIMIT 1`,
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_read = TRUE, updated_by = 'mobile-sync-http-it', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ('TEACHER', 'global', 'classes', FALSE, TRUE, FALSE, FALSE, 'mobile-sync-http-it')`,
  );
}

async function grantCustomRoleClassesRead(pool) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = 'CUSTOM_ROLE'
       AND module_key = 'classes'
       AND scope_type = 'global'
       AND status = 'active'
     LIMIT 1`,
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_read = TRUE, updated_by = 'mobile-sync-http-it', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ('CUSTOM_ROLE', 'global', 'classes', FALSE, TRUE, FALSE, FALSE, 'mobile-sync-http-it')`,
  );
}

async function readAllocatedSchool(pool, schoolCode, fallbackLogin) {
  const row = (
    await pool.query(`SELECT id, login_code FROM schools WHERE school_code = $1`, [schoolCode])
  ).rows[0];
  let login = String(row?.login_code || "").trim();
  if (!login) {
    await pool.query(`UPDATE schools SET login_code = $1 WHERE school_code = $2`, [fallbackLogin, schoolCode]);
    login = fallbackLogin;
  }
  return { id: row.id, login };
}

async function seedHttpFixture(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('Testland', 'TT', '+000', 'XOF') RETURNING id`,
  );
  const countryId = country.rows[0].id;
  await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'SCH-A', 'École A', 'active'), ($1, 'SCH-B', 'École B', 'active')`,
    [countryId],
  );
  const schoolA = await readAllocatedSchool(pool, "SCH-A", "CI-LYA-26-001");
  const schoolB = await readAllocatedSchool(pool, "SCH-B", "CI-LYB-26-001");
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
       ($1, $4, $5, 'MS-CLS-A', '6ème A', 'active', $6::timestamptz),
       ($2, $4, $5, 'MS-CLS-B', '6ème B', 'active', $6::timestamptz),
       ($3, $4, $5, 'MS-CLS-C', '6ème C', 'active', $6::timestamptz)`,
    [ID_A, ID_B, ID_C, schoolA.id, yearA.id, SAME_TS],
  );
  await pool.query(
    `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status, updated_at)
     VALUES ($1, $2, $3, 'MS-CLS-B-ONLY', '5ème B', 'active', $4::timestamptz)`,
    [ID_B_ONLY, schoolB.id, yearB.id, SAME_TS],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $4, 'ADM-MSYNC-1', 'Aline', 'Moke', 'admin-msync@test.local', 'Admin School', 'active', FALSE),
       ($2, $4, 'TCH-MSYNC-1', 'Tana', 'Kabila', 'teacher-msync@test.local', 'Enseignant', 'active', FALSE),
       ($3, $4, 'ACC-MSYNC-1', 'Carla', 'Ngo', 'accountant-msync@test.local', 'Comptable', 'active', FALSE),
       ($5, $4, 'DUAL-MSYNC-1', 'Dina', 'Mwamba', 'dual-msync@test.local', 'Enseignant', 'active', FALSE),
       ($6, $4, 'ACC-DUAL-1', 'Carla', 'Diallo', 'acc-dual-msync@test.local', 'Comptable', 'active', FALSE)`,
    [ADMIN_USER_ID, TEACHER_USER_ID, ACCOUNTANT_USER_ID, schoolA.id, DUAL_USER_ID, ACC_DUAL_USER_ID],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $4, 'SCHOOL_ADMIN', 'active'),
       ($2, $4, 'TEACHER', 'active'),
       ($3, $4, 'ACCOUNTANT', 'active'),
       ($5, $4, 'TEACHER', 'active'),
       ($5, $6, 'SCHOOL_ADMIN', 'active'),
       ($7, $4, 'ACCOUNTANT', 'active'),
       ($7, $6, 'SCHOOL_ADMIN', 'active')`,
    [ADMIN_USER_ID, TEACHER_USER_ID, ACCOUNTANT_USER_ID, schoolA.id, DUAL_USER_ID, schoolB.id, ACC_DUAL_USER_ID],
  );

  await pool.query(
    `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
     VALUES
       ($1, $3, $4, 'TCH-MSYNC-1', 'active'),
       ($2, $3, $5, 'TCH-DUAL-1', 'active')`,
    [TEACHER_ID, DUAL_TEACHER_ID, schoolA.id, TEACHER_USER_ID, DUAL_USER_ID],
  );
  await pool.query(
    `INSERT INTO subjects (id, school_id, subject_code, name, status)
     VALUES
       ($1, $3, 'SUB-MSYNC-1', 'Maths', 'active'),
       ($2, $3, 'SUB-DUAL-1', 'Physique', 'active')`,
    [SUBJECT_ID, DUAL_SUBJECT_ID, schoolA.id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (
       id, school_id, teacher_id, class_id, subject_id, academic_year_id, status
     )
     VALUES
       ($1, $4, $5, $6, $8, $10, 'active'),
       ($2, $4, $5, $7, $8, $10, 'active'),
       ($3, $4, $11, $6, $9, $10, 'active')`,
    [ASSIGN_A, ASSIGN_C, DUAL_ASSIGN_A, schoolA.id, TEACHER_ID, ID_A, ID_C, SUBJECT_ID, DUAL_SUBJECT_ID, yearA.id, DUAL_TEACHER_ID],
  );

  await grantTeacherClassesRead(pool);
  await grantCustomRoleClassesRead(pool);
  return { schoolA: schoolA.id, schoolB: schoolB.id, loginA: schoolA.login, loginB: schoolB.login };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP mobileSyncClasses.http.pg.test.js: DATABASE_URL absent");
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
  let child = null;
  let stderr = "";

  try {
    await repo.init();
    const fixture = await seedHttpFixture(repo.pool);

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
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on("data", () => {});

    await waitForHealth(child);

    const staleTeacherAssignments = [
      { classId: ID_A, classCode: "MS-CLS-A", status: "active" },
      { classId: ID_C, classCode: "MS-CLS-C", status: "active" },
    ];
    const adminToken = mintAccess(tokens, {
      sub: ADMIN_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: fixture.loginA,
      permissions: ["Voir classes", "Gérer classes"],
    });
    const teacherToken = mintAccess(tokens, {
      sub: TEACHER_USER_ID,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: fixture.loginA,
      permissions: ["Voir classes"],
      assignments: staleTeacherAssignments,
    });
    const accountantToken = mintAccess(tokens, {
      sub: ACCOUNTANT_USER_ID,
      role: "Comptable",
      roleKeys: ["ACCOUNTANT"],
      schoolCode: fixture.loginA,
      permissions: ["Gérer paiements", "Voir rapports financiers"],
    });

    const admin = await request("/mobile-sync/l1/classes", { token: adminToken });
    assert.equal(admin.status, 200, `Admin 200: ${JSON.stringify(admin.data)}`);
    assert.equal(admin.data.mode, "full");
    assert.equal(admin.data.cursorStatus, "ok");
    assert.deepEqual(
      (admin.data.items ?? []).map((item) => item.classCode).sort(),
      ["MS-CLS-A", "MS-CLS-B", "MS-CLS-C"],
    );

    const teacher = await request("/mobile-sync/l1/classes", { token: teacherToken });
    assert.equal(teacher.status, 200, `Teacher 200: ${JSON.stringify(teacher.data)}`);
    assert.deepEqual(
      (teacher.data.items ?? []).map((item) => item.classCode).sort(),
      ["MS-CLS-A", "MS-CLS-C"],
    );
    assert.ok(!(teacher.data.items ?? []).some((item) => item.classCode === "MS-CLS-B"));

    const accountant = await request("/mobile-sync/l1/classes", { token: accountantToken });
    assert.equal(accountant.status, 403, `Comptable 403: ${JSON.stringify(accountant.data)}`);
    assert.equal(accountant.data?.code, PERMISSION_DENIED);

    const tampered = `${admin.data.nextCursor.slice(0, -4)}xxxx`;
    const tamper = await request(`/mobile-sync/l1/classes?cursor=${encodeURIComponent(tampered)}`, {
      token: adminToken,
    });
    assert.equal(tamper.status, 400, `tamper 400: ${JSON.stringify(tamper.data)}`);
    assert.equal(tamper.data?.code, MOBILE_SYNC_ERROR.CURSOR_INVALID);

    const tenantToken = mintAccess(tokens, {
      sub: ADMIN_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: fixture.loginB,
      permissions: ["Voir classes", "Gérer classes"],
    });
    const tenant = await request(
      `/mobile-sync/l1/classes?cursor=${encodeURIComponent(admin.data.nextCursor)}`,
      { token: tenantToken },
    );
    assert.equal(tenant.status, 403, `tenant 403: ${JSON.stringify(tenant.data)}`);
    assert.equal(tenant.data?.code, MOBILE_SYNC_ERROR.CURSOR_INVALID);

    const dualToken = mintAccess(tokens, {
      sub: DUAL_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: fixture.loginA,
      permissions: ["Voir classes", "Gérer classes"],
    });
    const dual = await request("/mobile-sync/l1/classes", { token: dualToken });
    assert.equal(dual.status, 200, `Dual tenant A assigned: ${JSON.stringify(dual.data)}`);
    assert.deepEqual(
      (dual.data.items ?? []).map((item) => item.classCode),
      ["MS-CLS-A"],
    );
    assert.ok(!(dual.data.items ?? []).some((item) => item.classCode === "MS-CLS-B"));
    assert.ok(!(dual.data.items ?? []).some((item) => item.classCode === "MS-CLS-C"));
    assert.ok(!(dual.data.items ?? []).some((item) => item.classCode === "MS-CLS-B-ONLY"));

    const accountantDualToken = mintAccess(tokens, {
      sub: ACC_DUAL_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: fixture.loginA,
      permissions: ["Voir classes", "Gérer classes"],
    });
    const accountantDual = await request("/mobile-sync/l1/classes", { token: accountantDualToken });
    assert.equal(accountantDual.status, 403, `ACCOUNTANT@A dual 403: ${JSON.stringify(accountantDual.data)}`);
    assert.equal(accountantDual.data?.code, PERMISSION_DENIED);
    assert.equal(accountantDual.data?.items, undefined);
    assert.ok(!(accountantDual.data?.items ?? []).length);

    await repo.pool.query(
      `UPDATE teacher_assignments SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
      [ASSIGN_C],
    );
    const scopeChanged = await request(
      `/mobile-sync/l1/classes?cursor=${encodeURIComponent(teacher.data.nextCursor)}`,
      { token: teacherToken },
    );
    assert.equal(scopeChanged.status, 409, `scope_changed 409: ${JSON.stringify(scopeChanged.data)}`);
    assert.equal(scopeChanged.data?.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);
    assert.equal(scopeChanged.data?.cursorStatus, "scope_changed");
    assert.equal(scopeChanged.data?.mode, "full_required");

    const resync = await request("/mobile-sync/l1/classes", { token: teacherToken });
    assert.equal(resync.status, 200, `resync 200: ${JSON.stringify(resync.data)}`);
    assert.equal(resync.data.mode, "full");
    assert.deepEqual(
      (resync.data.items ?? []).map((item) => item.classCode),
      ["MS-CLS-A"],
    );
    assert.ok(!(resync.data.items ?? []).some((item) => item.id === ID_C));

    await repo.pool.query(
      `UPDATE user_roles
       SET status = 'revoked', revoked_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [TEACHER_USER_ID],
    );
    const teacherRoleRevoked = await request("/mobile-sync/l1/classes", { token: teacherToken });
    assert.equal(teacherRoleRevoked.status, 200, `Teacher rôle révoqué: ${JSON.stringify(teacherRoleRevoked.data)}`);
    assert.deepEqual(teacherRoleRevoked.data.items ?? [], []);

    await repo.pool.query(
      `UPDATE user_roles
       SET status = 'revoked', revoked_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [ADMIN_USER_ID],
    );
    const adminRoleRevoked = await request("/mobile-sync/l1/classes", { token: adminToken });
    assert.equal(adminRoleRevoked.status, 200, `Admin rôles live []: ${JSON.stringify(adminRoleRevoked.data)}`);
    assert.deepEqual(adminRoleRevoked.data.items ?? [], []);

    await repo.pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'CUS-MSYNC-1', 'Cyrus', 'Ndala', 'custom-msync@test.local', NULL, 'active', FALSE)`,
      [CUSTOM_USER_ID, fixture.schoolA],
    );
    await repo.pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES ($1, $2, 'CUSTOM_ROLE', 'active')`,
      [CUSTOM_USER_ID, fixture.schoolA],
    );
    const customToken = mintAccess(tokens, {
      sub: CUSTOM_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: fixture.loginA,
      permissions: ["Voir classes", "Gérer classes", "Classes:READ"],
    });
    const customRole = await request("/mobile-sync/l1/classes", { token: customToken });
    assert.equal(customRole.status, 200, `CUSTOM_ROLE 200 vide: ${JSON.stringify(customRole.data)}`);
    assert.deepEqual(customRole.data.items ?? [], []);

    console.log("mobileSyncClasses.http.pg.test.js: OK Admin/Teacher/Comptable/tamper/scope/tenant/roles-live/dual-school/accountant-dual");
  } catch (error) {
    if (stderr) {
      console.error(stderr.slice(-4000));
    }
    throw error;
  } finally {
    await stopChild(child);
    if (repo?.pool) {
      await repo.pool.end();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
