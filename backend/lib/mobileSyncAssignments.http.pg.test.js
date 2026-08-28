"use strict";

/**
 * HTTP réel — Express → JWT → RBAC → live RBAC → tenant → PostgreSQL.
 * Assignments L1 + durcissement GET /api/assignments (P0 JWT stale).
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { MOBILE_SYNC_ERROR } = require("./mobileSyncErrors");
const { PERMISSION_DENIED } = require("../services/rbacService");
const { encodeMobileSyncCursor } = require("./mobileSyncCursor");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(
  process.env.SOMAFRIK_MOBILE_SYNC_L1_ASSIGNMENTS_HTTP_IT_DATABASE ??
    "somafrik_mobile_sync_l1_assignments_http_it",
)
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_MOBILE_SYNC_L1_ASSIGNMENTS_HTTP_PORT ?? 19857);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const CLASS_A = "11111111-1111-4111-8111-111111111111";
const CLASS_B = "22222222-2222-4222-8222-222222222222";
const CLASS_C = "33333333-3333-4333-8333-333333333333";
const CLASS_B_ONLY = "55555555-5555-4555-8555-555555555555";
const ADMIN_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const TEACHER_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ACCOUNTANT_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const DUAL_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const ACC_DUAL_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const CUSTOM_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const PREFET_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
const TEACHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DUAL_TEACHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc10";
const SUBJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DUAL_SUBJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb10";
const ASSIGN_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ASSIGN_B = "dddddddd-dddd-4ddd-8ddd-dddddddddd0b";
const ASSIGN_C = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DUAL_ASSIGN_A = "dddddddd-dddd-4ddd-8ddd-dddddddddd10";
const TEACHER_B_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0b";
const TEACHER_B_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccbb";
const SUBJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb0b";
const TEACHER_ORPHAN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc0d";
const ASSIGN_CROSS_CLASS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const ASSIGN_CROSS_TEACHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const ASSIGN_CROSS_SUBJECT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";
const ASSIGN_CROSS_YEAR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04";
const ASSIGN_CROSS_USER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05";
const ASSIGN_HTTP_DELETE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee07";
const KILOMBO_USER_ID = "c81b0ec1-b8dd-4f09-8357-6775586920ff";
const KILOMBO_TEACHER_ID = "cd866ff1-92f5-4bf6-9086-dce64f903717";
const KILOMBO_ASG_1 = "55ff35d6-c184-4bbb-895a-961eaed08847";
const KILOMBO_ASG_2 = "c115f6c1-ad9a-44f4-bb59-670faddfd1a9";
const KILOMBO_ASG_3 = "c6f6038a-36ab-4530-8888-e829e01163ec";
const KILOMBO_ASG_4 = "eedf6a4c-b465-44a4-8892-d248212cbf97";
const UNMATCHED_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99";
const SUBJECT_GEO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb0e";
const SAME_TS = "2026-08-26T08:00:00.000Z";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  if (!databaseName) throw new Error("SOMAFRIK_MOBILE_SYNC_L1_ASSIGNMENTS_HTTP_IT_DATABASE invalide.");
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

async function grantCustomRoleAssignmentsRead(pool) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = 'CUSTOM_ROLE'
       AND module_key = 'assignments'
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
     VALUES ('CUSTOM_ROLE', 'global', 'assignments', FALSE, TRUE, FALSE, FALSE, 'mobile-sync-http-it')`,
  );
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
  const schoolA = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-A'`)).rows[0];
  const schoolB = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-B'`)).rows[0];
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
       ($1, $4, $5, 'ASG-CLS-A', '6ème A', 'active', $6::timestamptz),
       ($2, $4, $5, 'ASG-CLS-B', '6ème B', 'active', $6::timestamptz),
       ($3, $4, $5, 'ASG-CLS-C', '6ème C', 'active', $6::timestamptz)`,
    [CLASS_A, CLASS_B, CLASS_C, schoolA.id, yearA.id, SAME_TS],
  );
  await pool.query(
    `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status, updated_at)
     VALUES ($1, $2, $3, 'ASG-CLS-B-ONLY', '5ème B', 'active', $4::timestamptz)`,
    [CLASS_B_ONLY, schoolB.id, yearB.id, SAME_TS],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $4, 'ADM-ASG-1', 'Aline', 'Moke', 'admin-asg@test.local', 'Admin School', 'active', FALSE),
       ($2, $4, 'TCH-ASG-1', 'Tana', 'Kabila', 'teacher-asg@test.local', 'Enseignant', 'active', FALSE),
       ($3, $4, 'ACC-ASG-1', 'Carla', 'Ngo', 'accountant-asg@test.local', 'Comptable', 'active', FALSE),
       ($5, $4, 'DUAL-ASG-1', 'Dina', 'Mwamba', 'dual-asg@test.local', 'Enseignant', 'active', FALSE),
       ($6, $4, 'ACC-DUAL-ASG', 'Carla', 'Diallo', 'acc-dual-asg@test.local', 'Comptable', 'active', FALSE)`,
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
       ($1, $3, $4, 'TCH-ASG-1', 'active'),
       ($2, $3, $5, 'TCH-DUAL-ASG', 'active')`,
    [TEACHER_ID, DUAL_TEACHER_ID, schoolA.id, TEACHER_USER_ID, DUAL_USER_ID],
  );
  await pool.query(
    `INSERT INTO subjects (id, school_id, subject_code, name, status)
     VALUES
       ($1, $3, 'SUB-ASG-1', 'Maths', 'active'),
       ($2, $3, 'SUB-DUAL-ASG', 'Physique', 'active')`,
    [SUBJECT_ID, DUAL_SUBJECT_ID, schoolA.id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (
       id, school_id, teacher_id, class_id, subject_id, academic_year_id, status, updated_at
     )
     VALUES
       ($1, $5, $8, $6, $10, $12, 'active', $13::timestamptz),
       ($2, $5, $8, $7, $10, $12, 'active', $13::timestamptz),
       ($3, $5, $9, $6, $11, $12, 'active', $13::timestamptz),
       ($4, $5, $8, $14, $10, $12, 'active', $13::timestamptz)`,
    [
      ASSIGN_A,
      ASSIGN_C,
      DUAL_ASSIGN_A,
      ASSIGN_B,
      schoolA.id,
      CLASS_A,
      CLASS_C,
      TEACHER_ID,
      DUAL_TEACHER_ID,
      SUBJECT_ID,
      DUAL_SUBJECT_ID,
      yearA.id,
      SAME_TS,
      CLASS_B,
    ],
  );

  await grantCustomRoleAssignmentsRead(pool);
  return { schoolA: schoolA.id, schoolB: schoolB.id };
}

function activeIds(payload) {
  if (Array.isArray(payload)) {
    return payload.map((row) => String(row.id)).sort();
  }
  return (payload?.items ?? [])
    .filter((item) => !item.tombstone)
    .map((item) => String(item.id))
    .sort();
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP mobileSyncAssignments.http.pg.test.js: DATABASE_URL absent");
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

    const adminToken = mintAccess(tokens, {
      sub: ADMIN_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Affectations:READ", "Enseignants:READ", "ALL_PRIVILEGES"],
    });
    const teacherToken = mintAccess(tokens, {
      sub: TEACHER_USER_ID,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: "SCH-A",
      permissions: ["Affectations:READ"],
      teacherCode: "JWT-CODE",
      teacherId: "JWT-CODE",
    });
    const accountantToken = mintAccess(tokens, {
      sub: ACCOUNTANT_USER_ID,
      role: "Comptable",
      roleKeys: ["ACCOUNTANT"],
      schoolCode: "SCH-A",
      permissions: ["Gérer paiements", "Voir rapports financiers"],
    });
    const staleAdminOnTeacher = mintAccess(tokens, {
      sub: TEACHER_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Affectations:READ", "ALL_PRIVILEGES"],
      teacherCode: "JWT-ADMIN",
    });
    const staleTeacherOnAdmin = mintAccess(tokens, {
      sub: ADMIN_USER_ID,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: "SCH-A",
      permissions: ["Affectations:READ"],
      teacherCode: "JWT-TEACHER",
      teacherId: "JWT-TEACHER",
    });

    const admin = await request("/mobile-sync/l1/assignments", { token: adminToken });
    assert.equal(admin.status, 200, `Admin L1 200: ${JSON.stringify(admin.data)}`);
    assert.equal(admin.data.mode, "full");
    assert.deepEqual(activeIds(admin.data), [ASSIGN_A, ASSIGN_B, ASSIGN_C, DUAL_ASSIGN_A].sort());

    const adminGet = await request("/assignments", { token: adminToken });
    assert.equal(adminGet.status, 200, `Admin GET 200: ${JSON.stringify(adminGet.data)}`);
    assert.deepEqual(activeIds(adminGet.data), activeIds(admin.data));

    const teacher = await request("/mobile-sync/l1/assignments", { token: teacherToken });
    assert.equal(teacher.status, 200, `Teacher L1 200: ${JSON.stringify(teacher.data)}`);
    assert.deepEqual(activeIds(teacher.data), [ASSIGN_A, ASSIGN_B, ASSIGN_C].sort());
    assert.ok((teacher.data.items ?? []).every((item) => item.teacherId === TEACHER_ID));
    assert.ok(!(teacher.data.items ?? []).some((item) => item.id === DUAL_ASSIGN_A));

    const teacherGet = await request("/assignments", { token: teacherToken });
    assert.equal(teacherGet.status, 200, `Teacher GET 200: ${JSON.stringify(teacherGet.data)}`);
    assert.deepEqual(activeIds(teacherGet.data), activeIds(teacher.data));

    const accountant = await request("/mobile-sync/l1/assignments", { token: accountantToken });
    assert.equal(accountant.status, 403, `Comptable 403: ${JSON.stringify(accountant.data)}`);
    assert.equal(accountant.data?.code, PERMISSION_DENIED);

    const staleAdminL1 = await request("/mobile-sync/l1/assignments", { token: staleAdminOnTeacher });
    assert.equal(staleAdminL1.status, 200, `JWT Admin stale L1: ${JSON.stringify(staleAdminL1.data)}`);
    assert.deepEqual(activeIds(staleAdminL1.data), [ASSIGN_A, ASSIGN_B, ASSIGN_C].sort());
    const staleAdminGet = await request("/assignments", { token: staleAdminOnTeacher });
    assert.equal(staleAdminGet.status, 200, `JWT Admin stale GET: ${JSON.stringify(staleAdminGet.data)}`);
    assert.deepEqual(activeIds(staleAdminGet.data), activeIds(staleAdminL1.data));

    const staleTeacherL1 = await request("/mobile-sync/l1/assignments", { token: staleTeacherOnAdmin });
    assert.equal(staleTeacherL1.status, 200, `JWT Teacher stale L1: ${JSON.stringify(staleTeacherL1.data)}`);
    assert.deepEqual(activeIds(staleTeacherL1.data), activeIds(admin.data));
    const staleTeacherGet = await request("/assignments", { token: staleTeacherOnAdmin });
    assert.equal(staleTeacherGet.status, 200, `JWT Teacher stale GET: ${JSON.stringify(staleTeacherGet.data)}`);
    assert.deepEqual(activeIds(staleTeacherGet.data), activeIds(adminGet.data));

    const classesCursor = encodeMobileSyncCursor(
      {
        resource: "classes",
        schoolCode: "SCH-A",
        schoolId: fixture.schoolA,
        principalId: ADMIN_USER_ID,
        scopeHash: admin.data.scopeHash,
        lastUpdatedAt: SAME_TS,
        lastId: ASSIGN_A,
      },
      tokens,
    );
    const classesOnAssignments = await request(
      `/mobile-sync/l1/assignments?cursor=${encodeURIComponent(classesCursor)}`,
      { token: adminToken },
    );
    assert.equal(classesOnAssignments.status, 400, `classes cursor: ${JSON.stringify(classesOnAssignments.data)}`);
    assert.equal(classesOnAssignments.data?.code, MOBILE_SYNC_ERROR.CURSOR_INVALID);

    const studentsCursor = encodeMobileSyncCursor(
      {
        resource: "students",
        schoolCode: "SCH-A",
        schoolId: fixture.schoolA,
        principalId: ADMIN_USER_ID,
        scopeHash: admin.data.scopeHash,
        lastUpdatedAt: SAME_TS,
        lastId: ASSIGN_A,
      },
      tokens,
    );
    const studentsOnAssignments = await request(
      `/mobile-sync/l1/assignments?cursor=${encodeURIComponent(studentsCursor)}`,
      { token: adminToken },
    );
    assert.equal(studentsOnAssignments.status, 400, `students cursor: ${JSON.stringify(studentsOnAssignments.data)}`);
    assert.equal(studentsOnAssignments.data?.code, MOBILE_SYNC_ERROR.CURSOR_INVALID);

    const tampered = `${admin.data.nextCursor.slice(0, -4)}xxxx`;
    const tamper = await request(`/mobile-sync/l1/assignments?cursor=${encodeURIComponent(tampered)}`, {
      token: adminToken,
    });
    assert.equal(tamper.status, 400, `tamper 400: ${JSON.stringify(tamper.data)}`);
    assert.equal(tamper.data?.code, MOBILE_SYNC_ERROR.CURSOR_INVALID);

    const tenantToken = mintAccess(tokens, {
      sub: ADMIN_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-B",
      permissions: ["Affectations:READ", "ALL_PRIVILEGES"],
    });
    const tenant = await request(
      `/mobile-sync/l1/assignments?cursor=${encodeURIComponent(admin.data.nextCursor)}`,
      { token: tenantToken },
    );
    assert.equal(tenant.status, 403, `tenant 403: ${JSON.stringify(tenant.data)}`);
    assert.equal(tenant.data?.code, PERMISSION_DENIED);

    const dualToken = mintAccess(tokens, {
      sub: DUAL_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Affectations:READ", "ALL_PRIVILEGES"],
    });
    const dual = await request("/mobile-sync/l1/assignments", { token: dualToken });
    assert.equal(dual.status, 200, `Dual tenant A assigned: ${JSON.stringify(dual.data)}`);
    assert.deepEqual(activeIds(dual.data), [DUAL_ASSIGN_A]);
    assert.ok(!(dual.data.items ?? []).some((item) => item.id === ASSIGN_A));

    const accountantDualToken = mintAccess(tokens, {
      sub: ACC_DUAL_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Affectations:READ", "ALL_PRIVILEGES"],
    });
    const accountantDual = await request("/mobile-sync/l1/assignments", { token: accountantDualToken });
    assert.equal(accountantDual.status, 403, `ACCOUNTANT@A dual 403: ${JSON.stringify(accountantDual.data)}`);
    assert.equal(accountantDual.data?.code, PERMISSION_DENIED);

    await repo.pool.query(
      `UPDATE teacher_assignments SET status = 'deleted', updated_at = NOW() WHERE id = $1`,
      [ASSIGN_C],
    );
    const scopeChanged = await request(
      `/mobile-sync/l1/assignments?cursor=${encodeURIComponent(teacher.data.nextCursor)}`,
      { token: teacherToken },
    );
    assert.equal(scopeChanged.status, 409, `scope_changed 409: ${JSON.stringify(scopeChanged.data)}`);
    assert.equal(scopeChanged.data?.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);
    assert.equal(scopeChanged.data?.mode, "full_required");

    const resync = await request("/mobile-sync/l1/assignments", { token: teacherToken });
    assert.equal(resync.status, 200);
    assert.ok(!(resync.data.items ?? []).some((item) => item.id === ASSIGN_C));
    const resyncGet = await request("/assignments", { token: teacherToken });
    assert.deepEqual(activeIds(resyncGet.data), activeIds(resync.data));

    const adminTombstone = await request("/mobile-sync/l1/assignments", { token: adminToken });
    const tombstoned = (adminTombstone.data.items ?? []).find((item) => item.id === ASSIGN_C);
    assert.equal(tombstoned?.tombstone, true);
    assert.equal(tombstoned?.status, "deleted");

    const yearA = (
      await repo.pool.query(
        `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-A' LIMIT 1`,
      )
    ).rows[0].id;
    const yearB = (
      await repo.pool.query(
        `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-B' LIMIT 1`,
      )
    ).rows[0].id;
    await repo.pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'TCH-ASG-B', 'Benoit', 'Kanza', 'teacher-b-asg@test.local', 'Enseignant', 'active', FALSE)`,
      [TEACHER_B_USER_ID, fixture.schoolB],
    );
    await repo.pool.query(
      `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
       VALUES
         ($1, $3, $4, 'TCH-ASG-B', 'active'),
         ($2, $5, $4, 'TCH-ASG-ORPHAN', 'active')`,
      [TEACHER_B_ID, TEACHER_ORPHAN_ID, fixture.schoolB, TEACHER_B_USER_ID, fixture.schoolA],
    );
    await repo.pool.query(
      `INSERT INTO subjects (id, school_id, subject_code, name, status)
       VALUES ($1, $2, 'SUB-ASG-B', 'Physique B', 'active')`,
      [SUBJECT_B, fixture.schoolB],
    );
    await repo.pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status, updated_at
       ) VALUES
         ($1, $6, $7, $8, $9, $10, 'cross-class', 'active', NOW()),
         ($2, $6, $11, $12, $9, $10, 'cross-teacher', 'active', NOW()),
         ($3, $6, $7, $12, $13, $10, 'cross-subject', 'active', NOW()),
         ($4, $6, $7, $12, $9, $14, 'cross-year', 'active', NOW()),
         ($5, $6, $15, $16, $17, $10, 'cross-user', 'active', NOW())`,
      [
        ASSIGN_CROSS_CLASS,
        ASSIGN_CROSS_TEACHER,
        ASSIGN_CROSS_SUBJECT,
        ASSIGN_CROSS_YEAR,
        ASSIGN_CROSS_USER,
        fixture.schoolA,
        TEACHER_ID,
        CLASS_B_ONLY,
        SUBJECT_ID,
        yearA,
        TEACHER_B_ID,
        CLASS_A,
        SUBJECT_B,
        yearB,
        TEACHER_ORPHAN_ID,
        CLASS_C,
        DUAL_SUBJECT_ID,
      ],
    );

    const leakL1 = await request("/mobile-sync/l1/assignments", { token: adminToken });
    assert.equal(leakL1.status, 200, `leak L1: ${JSON.stringify(leakL1.data)}`);
    const leakItems = leakL1.data.items ?? [];
    assert.ok(!leakItems.some((item) => item.id === ASSIGN_CROSS_CLASS));
    assert.ok(!leakItems.some((item) => item.id === ASSIGN_CROSS_TEACHER));
    assert.ok(!leakItems.some((item) => item.id === ASSIGN_CROSS_SUBJECT));
    assert.ok(!leakItems.some((item) => item.id === ASSIGN_CROSS_YEAR));
    assert.ok(!leakItems.some((item) => item.classCode === "ASG-CLS-B-ONLY" || item.classId === CLASS_B_ONLY));
    assert.ok(!leakItems.some((item) => item.teacherCode === "TCH-ASG-B" || item.teacherId === TEACHER_B_ID));
    assert.ok(!leakItems.some((item) => item.subjectCode === "SUB-ASG-B" || item.subjectId === SUBJECT_B));
    assert.ok(!leakItems.some((item) => item.academicYearId === yearB));
    const orphanL1 = leakItems.find((item) => item.id === ASSIGN_CROSS_USER);
    assert.ok(orphanL1);
    assert.equal(orphanL1.teacherUserId, TEACHER_B_USER_ID);

    const leakGet = await request("/assignments", { token: adminToken });
    assert.equal(leakGet.status, 200, `leak GET: ${JSON.stringify(leakGet.data)}`);
    const leakHist = Array.isArray(leakGet.data) ? leakGet.data : [];
    assert.ok(!leakHist.some((row) => row.id === ASSIGN_CROSS_CLASS));
    assert.ok(!leakHist.some((row) => row.id === ASSIGN_CROSS_TEACHER));
    assert.ok(!leakHist.some((row) => row.id === ASSIGN_CROSS_SUBJECT));
    assert.ok(!leakHist.some((row) => row.id === ASSIGN_CROSS_YEAR));
    assert.ok(!leakHist.some((row) => row.classCode === "ASG-CLS-B-ONLY"));
    assert.ok(!leakHist.some((row) => row.teacherCode === "TCH-ASG-B" || row.teacherId === "TCH-ASG-B"));
    assert.ok(!leakHist.some((row) => row.subjectCode === "SUB-ASG-B"));
    assert.ok(!JSON.stringify(leakHist).includes(TEACHER_B_USER_ID));
    assert.ok(!JSON.stringify(leakHist).toLowerCase().includes("benoit"));
    const orphanGet = leakHist.find((row) => row.id === ASSIGN_CROSS_USER);
    assert.ok(orphanGet);
    assert.equal(String(orphanGet.teacherName ?? "").trim(), "");

    await repo.pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'PRF-ASG-1', 'Paul', 'Prefet', 'prefet-asg@test.local', 'Préfet des études', 'active', FALSE)`,
      [PREFET_USER_ID, fixture.schoolA],
    );
    await repo.pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES ($1, $2, 'PREFET_ETUDES', 'active')`,
      [PREFET_USER_ID, fixture.schoolA],
    );
    const prefetToken = mintAccess(tokens, {
      sub: PREFET_USER_ID,
      role: "Préfet des études",
      roleKeys: ["PREFET_ETUDES"],
      schoolCode: "SCH-A",
      permissions: ["Affectations:DELETE", "Affectations:READ", "ALL_PRIVILEGES"],
    });
    await repo.pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, assignment_role, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'http-delete', 'active', NOW())`,
      [ASSIGN_HTTP_DELETE, fixture.schoolA, TEACHER_ID, CLASS_C, DUAL_SUBJECT_ID, yearA],
    );
    const beforeHttpDeleteGet = await request("/assignments", { token: adminToken });
    assert.ok(
      (Array.isArray(beforeHttpDeleteGet.data) ? beforeHttpDeleteGet.data : []).some(
        (row) => row.id === ASSIGN_HTTP_DELETE,
      ),
      "GET historique doit lister l'affectation active avant DELETE HTTP",
    );
    const httpDelete = await request(`/assignments/${ASSIGN_HTTP_DELETE}`, {
      method: "DELETE",
      token: prefetToken,
    });
    assert.equal(httpDelete.status, 200, `DELETE HTTP 200: ${JSON.stringify(httpDelete.data)}`);
    const pgDeleted = await repo.pool.query(
      `SELECT status FROM teacher_assignments WHERE id = $1`,
      [ASSIGN_HTTP_DELETE],
    );
    assert.equal(pgDeleted.rows[0]?.status, "deleted");
    const l1AfterDelete = await request("/mobile-sync/l1/assignments", { token: adminToken });
    const l1Deleted = (l1AfterDelete.data.items ?? []).find((item) => item.id === ASSIGN_HTTP_DELETE);
    assert.ok(l1Deleted, "L1 school-wide doit émettre le tombstone");
    assert.equal(l1Deleted.tombstone, true);
    assert.equal(l1Deleted.status, "deleted");
    const getAfterDelete = await request("/assignments", { token: adminToken });
    const histAfterDelete = Array.isArray(getAfterDelete.data) ? getAfterDelete.data : [];
    assert.ok(!histAfterDelete.some((row) => row.id === ASSIGN_HTTP_DELETE));

    await repo.pool.query(
      `UPDATE role_module_permissions
       SET can_read = FALSE, updated_at = NOW()
       WHERE upper(role_key) = 'TEACHER'
         AND module_key = 'assignments'
         AND status = 'active'`,
    );
    const permRevoked = await request("/mobile-sync/l1/assignments", { token: teacherToken });
    assert.equal(permRevoked.status, 403, `permission live 403: ${JSON.stringify(permRevoked.data)}`);
    assert.equal(permRevoked.data?.code, PERMISSION_DENIED);
    const permRevokedGet = await request("/assignments", { token: teacherToken });
    assert.equal(permRevokedGet.status, 403, `GET permission live 403: ${JSON.stringify(permRevokedGet.data)}`);
    assert.equal(permRevokedGet.data?.code, PERMISSION_DENIED);

    await repo.pool.query(
      `UPDATE role_module_permissions
       SET can_read = TRUE, updated_at = NOW()
       WHERE upper(role_key) = 'TEACHER'
         AND module_key = 'assignments'
         AND status = 'active'`,
    );

    await repo.pool.query(
      `UPDATE user_roles
       SET status = 'revoked', revoked_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [TEACHER_USER_ID],
    );
    const teacherRoleRevoked = await request("/mobile-sync/l1/assignments", { token: teacherToken });
    assert.equal(teacherRoleRevoked.status, 403, `Teacher rôle révoqué: ${JSON.stringify(teacherRoleRevoked.data)}`);
    assert.equal(teacherRoleRevoked.data?.code, PERMISSION_DENIED);
    const teacherRoleRevokedGet = await request("/assignments", { token: teacherToken });
    assert.equal(teacherRoleRevokedGet.status, 403, `GET rôle révoqué: ${JSON.stringify(teacherRoleRevokedGet.data)}`);
    assert.equal(teacherRoleRevokedGet.data?.code, PERMISSION_DENIED);

    await repo.pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'CUS-ASG-1', 'Cyrus', 'Ndala', 'custom-asg@test.local', NULL, 'active', FALSE)`,
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
      schoolCode: "SCH-A",
      permissions: ["Affectations:READ", "ALL_PRIVILEGES"],
    });
    const customRole = await request("/mobile-sync/l1/assignments", { token: customToken });
    assert.equal(customRole.status, 200, `CUSTOM_ROLE 200 vide: ${JSON.stringify(customRole.data)}`);
    assert.deepEqual(customRole.data.items ?? [], []);
    const customGet = await request("/assignments", { token: customToken });
    assert.deepEqual(customGet.data ?? [], []);

    await repo.pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES
         ($1, $3, 'USR-2026-00007', 'Kilombo', 'Seke', 'kilombo-asg@test.local', 'Enseignant', 'active', FALSE),
         ($2, $3, 'USR-UNMATCHED', 'Sans', 'Fiche', 'unmatched-asg@test.local', 'Enseignant', 'active', FALSE)`,
      [KILOMBO_USER_ID, UNMATCHED_USER_ID, fixture.schoolA],
    );
    await repo.pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES
         ($1, $3, 'TEACHER', 'active'),
         ($2, $3, 'TEACHER', 'active')`,
      [KILOMBO_USER_ID, UNMATCHED_USER_ID, fixture.schoolA],
    );
    await repo.pool.query(
      `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
       VALUES ($1, $2, $3, 'CD-2026-0001-ENS-0001', 'active')`,
      [KILOMBO_TEACHER_ID, fixture.schoolA, KILOMBO_USER_ID],
    );
    await repo.pool.query(
      `INSERT INTO subjects (id, school_id, subject_code, name, status)
       VALUES ($1, $2, 'SUB-GEO-K', 'Géographie', 'active')`,
      [SUBJECT_GEO, fixture.schoolA],
    );
    const kilomboYearA = (
      await repo.pool.query(
        `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-A' LIMIT 1`,
      )
    ).rows[0];
    await repo.pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, status, updated_at
       ) VALUES
         ($1, $5, $9, $6, $10, $12, 'active', $13::timestamptz),
         ($2, $5, $9, $7, $11, $12, 'active', $13::timestamptz),
         ($3, $5, $9, $7, $10, $12, 'active', $13::timestamptz),
         ($4, $5, $9, $8, $10, $12, 'active', $13::timestamptz)`,
      [
        KILOMBO_ASG_1,
        KILOMBO_ASG_2,
        KILOMBO_ASG_3,
        KILOMBO_ASG_4,
        fixture.schoolA,
        CLASS_A,
        CLASS_B,
        CLASS_C,
        KILOMBO_TEACHER_ID,
        SUBJECT_ID,
        SUBJECT_GEO,
        kilomboYearA.id,
        SAME_TS,
      ],
    );

    const kilomboCanonical = mintAccess(tokens, {
      sub: KILOMBO_USER_ID,
      userId: KILOMBO_USER_ID,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: "SCH-A",
      permissions: ["Affectations:READ"],
      teacherCode: "JWT-ENS-0001",
    });
    const kilomboGet = await request("/assignments", { token: kilomboCanonical });
    assert.equal(kilomboGet.status, 200, `KILOMBO canonical GET: ${JSON.stringify(kilomboGet.data)}`);
    assert.deepEqual(activeIds(kilomboGet.data), [KILOMBO_ASG_1, KILOMBO_ASG_2, KILOMBO_ASG_3, KILOMBO_ASG_4].sort());
    assert.equal(activeIds(kilomboGet.data).length, 4);
    assert.ok(!(Array.isArray(kilomboGet.data) ? kilomboGet.data : []).some((row) => row.id === ASSIGN_A));
    assert.ok(!(Array.isArray(kilomboGet.data) ? kilomboGet.data : []).some((row) => row.id === DUAL_ASSIGN_A));

    const kilomboOverlay = mintAccess(tokens, {
      sub: KILOMBO_TEACHER_ID,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: "SCH-A",
      permissions: ["Affectations:READ"],
      teacherCode: "JWT-ENS-0001",
    });
    const overlayGet = await request("/assignments", { token: kilomboOverlay });
    assert.equal(overlayGet.status, 200, `KILOMBO overlay teachers.id GET: ${JSON.stringify(overlayGet.data)}`);
    assert.deepEqual(activeIds(overlayGet.data), activeIds(kilomboGet.data));

    const unmatchedToken = mintAccess(tokens, {
      sub: UNMATCHED_USER_ID,
      userId: UNMATCHED_USER_ID,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: "SCH-A",
      permissions: ["Affectations:READ"],
    });
    const unmatchedGet = await request("/assignments", { token: unmatchedToken });
    assert.equal(unmatchedGet.status, 200, `unmatched GET: ${JSON.stringify(unmatchedGet.data)}`);
    assert.deepEqual(activeIds(unmatchedGet.data), []);
    assert.ok(!(Array.isArray(unmatchedGet.data) ? unmatchedGet.data : []).some((row) => row.id === KILOMBO_ASG_1));
    assert.ok(!(Array.isArray(unmatchedGet.data) ? unmatchedGet.data : []).some((row) => row.id === ASSIGN_A));

    console.log("mobileSyncAssignments.http.pg.test.js: OK Express/JWT/RBAC/live/tenant/PG");
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
