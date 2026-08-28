"use strict";

/**
 * HTTP réel — Express → JWT → RBAC live → tenant → PostgreSQL.
 * SchoolCourses L1.
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
  process.env.SOMAFRIK_MOBILE_SYNC_L1_SCHOOL_COURSES_HTTP_IT_DATABASE ??
    "somafrik_mobile_sync_l1_school_courses_http_it",
)
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_MOBILE_SYNC_L1_SCHOOL_COURSES_HTTP_PORT ?? 19867);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const CLASS_A = "11111111-1111-4111-8111-111111111111";
const CLASS_B = "22222222-2222-4222-8222-222222222222";
const CLASS_B_ONLY = "55555555-5555-4555-8555-555555555555";
const ADMIN_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const TEACHER_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ACCOUNTANT_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const CUSTOM_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const TEACHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEACHER_B_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0b";
const TEACHER_B_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccbb";
const TEACHER_ORPHAN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc0d";
const SUBJECT_MATH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT_FR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb0f";
const SUBJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb0b";
const COURSE_MATH = "dddddddd-dddd-4ddd-8ddd-dddddddddd0a";
const COURSE_FR = "dddddddd-dddd-4ddd-8ddd-dddddddddd0b";
const COURSE_B_MATH = "dddddddd-dddd-4ddd-8ddd-dddddddddd0c";
const ASSIGN_MATH = "ffffffff-ffff-4fff-8fff-ffffffffff0a";
const ASSIGN_FR = "ffffffff-ffff-4fff-8fff-ffffffffff0b";
const COURSE_CROSS_CLASS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const COURSE_CROSS_SUBJECT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const SAME_TS = "2026-08-26T08:00:00.000Z";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  if (!databaseName) throw new Error("SOMAFRIK_MOBILE_SYNC_L1_SCHOOL_COURSES_HTTP_IT_DATABASE invalide.");
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

async function grantRoleSubjectsRead(pool, roleKey) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = $1
       AND module_key = 'subjects'
       AND scope_type = 'global'
       AND status = 'active'
     LIMIT 1`,
    [String(roleKey).toUpperCase()],
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
     VALUES ($1, 'global', 'subjects', FALSE, TRUE, FALSE, FALSE, 'mobile-sync-http-it')`,
    [String(roleKey).toUpperCase()],
  );
}

function activeIds(payload) {
  return (payload?.items ?? [])
    .filter((item) => !item.tombstone)
    .map((item) => String(item.id))
    .sort();
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
       ($1, $3, $4, 'CRS-HTTP-A', '6ème A', 'active', $5::timestamptz),
       ($2, $3, $4, 'CRS-HTTP-B', '6ème B', 'active', $5::timestamptz)`,
    [CLASS_A, CLASS_B, schoolA.id, yearA.id, SAME_TS],
  );
  await pool.query(
    `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status, updated_at)
     VALUES ($1, $2, $3, 'CRS-HTTP-B-ONLY', '5ème B', 'active', $4::timestamptz)`,
    [CLASS_B_ONLY, schoolB.id, yearB.id, SAME_TS],
  );
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $4, 'ADM-CRS-1', 'Aline', 'Moke', 'admin-crs@test.local', 'Admin School', 'active', FALSE),
       ($2, $4, 'TCH-CRS-1', 'Tana', 'Kabila', 'teacher-crs@test.local', 'Enseignant', 'active', FALSE),
       ($3, $4, 'ACC-CRS-1', 'Carla', 'Ngo', 'accountant-crs@test.local', 'Comptable', 'active', FALSE)`,
    [ADMIN_USER_ID, TEACHER_USER_ID, ACCOUNTANT_USER_ID, schoolA.id],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $4, 'SCHOOL_ADMIN', 'active'),
       ($2, $4, 'TEACHER', 'active'),
       ($3, $4, 'ACCOUNTANT', 'active')`,
    [ADMIN_USER_ID, TEACHER_USER_ID, ACCOUNTANT_USER_ID, schoolA.id],
  );
  await pool.query(
    `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
     VALUES ($1, $2, $3, 'TCH-CRS-1', 'active')`,
    [TEACHER_ID, schoolA.id, TEACHER_USER_ID],
  );
  await pool.query(
    `INSERT INTO subjects (id, school_id, subject_code, name, status)
     VALUES
       ($1, $3, 'SUB-CRS-MATH', 'Maths', 'active'),
       ($2, $3, 'SUB-CRS-FR', 'Français', 'active')`,
    [SUBJECT_MATH, SUBJECT_FR, schoolA.id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (
       id, school_id, teacher_id, class_id, subject_id, academic_year_id, status, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7::timestamptz)`,
    [ASSIGN_MATH, schoolA.id, TEACHER_ID, CLASS_A, SUBJECT_MATH, yearA.id, SAME_TS],
  );
  await pool.query(
    `INSERT INTO school_courses (
       id, school_id, class_id, subject_id, teacher_id, course_code, coefficient, status, updated_at
     ) VALUES
       ($1, $4, $5, $7, $9, 'CRS-HTTP-MATH', 1, 'active', $10::timestamptz),
       ($2, $4, $5, $8, $9, 'CRS-HTTP-FR', 1, 'active', $10::timestamptz),
       ($3, $4, $6, $7, $9, 'CRS-HTTP-B-MATH', 1, 'active', $10::timestamptz)`,
    [
      COURSE_MATH,
      COURSE_FR,
      COURSE_B_MATH,
      schoolA.id,
      CLASS_A,
      CLASS_B,
      SUBJECT_MATH,
      SUBJECT_FR,
      TEACHER_ID,
      SAME_TS,
    ],
  );
  return { schoolA: schoolA.id, schoolB: schoolB.id, yearA: yearA.id, yearB: yearB.id };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP mobileSyncSchoolCourses.http.pg.test.js: DATABASE_URL absent");
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
    await grantRoleSubjectsRead(repo.pool, "TEACHER");
    await grantRoleSubjectsRead(repo.pool, "CUSTOM_ROLE");
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
      permissions: ["Matières:READ", "Voir classes", "ALL_PRIVILEGES"],
    });
    const teacherToken = mintAccess(tokens, {
      sub: TEACHER_USER_ID,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: "SCH-A",
      permissions: ["Matières:READ", "Voir classes"],
      teacherCode: "JWT-CODE",
      teacherId: "JWT-CODE",
    });
    const accountantToken = mintAccess(tokens, {
      sub: ACCOUNTANT_USER_ID,
      role: "Comptable",
      roleKeys: ["ACCOUNTANT"],
      schoolCode: "SCH-A",
      permissions: ["Gérer paiements"],
    });
    const staleAdminOnTeacher = mintAccess(tokens, {
      sub: TEACHER_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Matières:READ", "ALL_PRIVILEGES"],
    });

    const admin = await request("/mobile-sync/l1/school-courses", { token: adminToken });
    assert.equal(admin.status, 200, `Admin L1: ${JSON.stringify(admin.data)}`);
    assert.equal(admin.data.mode, "full");
    assert.deepEqual(activeIds(admin.data), [COURSE_MATH, COURSE_FR, COURSE_B_MATH].sort());

    const teacher = await request("/mobile-sync/l1/school-courses", { token: teacherToken });
    assert.equal(teacher.status, 200, `Teacher L1: ${JSON.stringify(teacher.data)}`);
    assert.deepEqual(activeIds(teacher.data), [COURSE_MATH]);
    assert.ok(!(teacher.data.items ?? []).some((item) => item.id === COURSE_FR || item.id === COURSE_B_MATH));

    const accountant = await request("/mobile-sync/l1/school-courses", { token: accountantToken });
    assert.equal(accountant.status, 403);
    assert.equal(accountant.data?.code, PERMISSION_DENIED);

    const stale = await request("/mobile-sync/l1/school-courses", { token: staleAdminOnTeacher });
    assert.deepEqual(activeIds(stale.data), [COURSE_MATH]);

    await repo.pool.query(
      `INSERT INTO teacher_assignments (
         id, school_id, teacher_id, class_id, subject_id, academic_year_id, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())`,
      [ASSIGN_FR, fixture.schoolA, TEACHER_ID, CLASS_A, SUBJECT_FR, fixture.yearA],
    );
    const scopeChanged = await request(
      `/mobile-sync/l1/school-courses?cursor=${encodeURIComponent(teacher.data.nextCursor)}`,
      { token: teacherToken },
    );
    assert.equal(scopeChanged.status, 409, `scope_changed 409: ${JSON.stringify(scopeChanged.data)}`);
    assert.equal(scopeChanged.data?.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);
    assert.equal(scopeChanged.data?.mode, "full_required");
    assert.equal(scopeChanged.data?.cursorStatus, "scope_changed");

    const classesCursor = encodeMobileSyncCursor(
      {
        resource: "classes",
        schoolCode: "SCH-A",
        schoolId: fixture.schoolA,
        principalId: ADMIN_USER_ID,
        scopeHash: admin.data.scopeHash,
        lastUpdatedAt: SAME_TS,
        lastId: COURSE_MATH,
      },
      tokens,
    );
    const classesOnCourses = await request(
      `/mobile-sync/l1/school-courses?cursor=${encodeURIComponent(classesCursor)}`,
      { token: adminToken },
    );
    assert.equal(classesOnCourses.status, 400);
    assert.equal(classesOnCourses.data?.code, MOBILE_SYNC_ERROR.CURSOR_INVALID);

    const tampered = `${admin.data.nextCursor.slice(0, -4)}xxxx`;
    const tamper = await request(`/mobile-sync/l1/school-courses?cursor=${encodeURIComponent(tampered)}`, {
      token: adminToken,
    });
    assert.equal(tamper.status, 400);
    assert.equal(tamper.data?.code, MOBILE_SYNC_ERROR.CURSOR_INVALID);

    const tenantToken = mintAccess(tokens, {
      sub: ADMIN_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-B",
      permissions: ["Matières:READ", "ALL_PRIVILEGES"],
    });
    const tenant = await request(
      `/mobile-sync/l1/school-courses?cursor=${encodeURIComponent(admin.data.nextCursor)}`,
      { token: tenantToken },
    );
    assert.equal(tenant.status, 403);
    assert.equal(tenant.data?.code, PERMISSION_DENIED);

    await repo.pool.query(
      `UPDATE school_courses SET status = 'archived', updated_at = NOW() WHERE id = $1`,
      [COURSE_FR],
    );
    const afterArchive = await request("/mobile-sync/l1/school-courses", { token: adminToken });
    const tombstoned = (afterArchive.data.items ?? []).find((item) => item.id === COURSE_FR);
    assert.equal(tombstoned?.tombstone, true);
    assert.equal(tombstoned?.status, "archived");

    await repo.pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'TCH-CRS-B', 'Benoit', 'Kanza', 'teacher-b-crs@test.local', 'Enseignant', 'active', FALSE)`,
      [TEACHER_B_USER_ID, fixture.schoolB],
    );
    await repo.pool.query(
      `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
       VALUES
         ($1, $3, $4, 'TCH-CRS-B', 'active'),
         ($2, $5, $4, 'TCH-CRS-ORPHAN', 'active')`,
      [TEACHER_B_ID, TEACHER_ORPHAN_ID, fixture.schoolB, TEACHER_B_USER_ID, fixture.schoolA],
    );
    await repo.pool.query(
      `INSERT INTO subjects (id, school_id, subject_code, name, status)
       VALUES ($1, $2, 'SUB-CRS-B', 'Physique B', 'active')`,
      [SUBJECT_B, fixture.schoolB],
    );
    await repo.pool.query(
      `INSERT INTO school_courses (
         id, school_id, class_id, subject_id, teacher_id, course_code, status, updated_at
       ) VALUES
         ($1, $3, $4, $6, $8, 'CRS-X-CLASS', 'active', NOW()),
         ($2, $3, $5, $7, $8, 'CRS-X-SUB', 'active', NOW())`,
      [
        COURSE_CROSS_CLASS,
        COURSE_CROSS_SUBJECT,
        fixture.schoolA,
        CLASS_B_ONLY,
        CLASS_A,
        SUBJECT_MATH,
        SUBJECT_B,
        TEACHER_ID,
      ],
    );
    await repo.pool.query(`UPDATE school_courses SET teacher_id = $1 WHERE id = $2`, [
      TEACHER_B_ID,
      COURSE_B_MATH,
    ]);
    const leak = await request("/mobile-sync/l1/school-courses", { token: adminToken });
    assert.equal(leak.status, 200);
    const leakItems = leak.data.items ?? [];
    assert.ok(!leakItems.some((item) => item.id === COURSE_CROSS_CLASS));
    assert.ok(!leakItems.some((item) => item.id === COURSE_CROSS_SUBJECT));
    const teacherBCourse = leakItems.find((item) => item.id === COURSE_B_MATH);
    assert.ok(teacherBCourse);
    assert.equal(teacherBCourse.teacherId, null);
    assert.ok(!JSON.stringify(leakItems).includes(TEACHER_B_ID));
    assert.ok(!JSON.stringify(leakItems).includes(TEACHER_B_USER_ID));

    await repo.pool.query(
      `UPDATE role_module_permissions
       SET can_read = FALSE, updated_at = NOW()
       WHERE upper(role_key) = 'TEACHER'
         AND module_key = 'subjects'
         AND status = 'active'`,
    );
    const permRevoked = await request("/mobile-sync/l1/school-courses", { token: teacherToken });
    assert.equal(permRevoked.status, 403, `permission live 403: ${JSON.stringify(permRevoked.data)}`);
    assert.equal(permRevoked.data?.code, PERMISSION_DENIED);

    await repo.pool.query(
      `UPDATE role_module_permissions
       SET can_read = TRUE, updated_at = NOW()
       WHERE upper(role_key) = 'TEACHER'
         AND module_key = 'subjects'
         AND status = 'active'`,
    );

    await repo.pool.query(
      `UPDATE user_roles
       SET status = 'revoked', revoked_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [TEACHER_USER_ID],
    );
    const teacherRoleRevoked = await request("/mobile-sync/l1/school-courses", { token: teacherToken });
    assert.equal(teacherRoleRevoked.status, 403, `Teacher rôle révoqué: ${JSON.stringify(teacherRoleRevoked.data)}`);
    assert.equal(teacherRoleRevoked.data?.code, PERMISSION_DENIED);

    await repo.pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'CUS-CRS-1', 'Cyrus', 'Ndala', 'custom-crs@test.local', NULL, 'active', FALSE)`,
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
      permissions: ["Matières:READ", "ALL_PRIVILEGES"],
    });
    const customRole = await request("/mobile-sync/l1/school-courses", { token: customToken });
    assert.equal(customRole.status, 200);
    assert.deepEqual(customRole.data.items ?? [], []);

    console.log("mobileSyncSchoolCourses.http.pg.test.js: OK Express/JWT/RBAC/live/tenant/PG");
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
