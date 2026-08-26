"use strict";

/**
 * Vérifier PostgreSQL réel — GET /api/mobile-sync/l1/classes (CAS 1–10).
 * Prérequis : DATABASE_URL (CI). Base isolée, aucun secret en dur.
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createClassesRepository } = require("../db/classesRepository");
const { TokenService } = require("../services/tokenService");
const { TenantScopeService } = require("../services/tenantScopeService");
const { handleMobileSyncL1Classes } = require("./mobileSyncClasses");
const { encodeMobileSyncCursor } = require("./mobileSyncCursor");
const { computeClassesScopeHash } = require("./mobileSyncScope");
const { MOBILE_SYNC_ERROR, SENTINEL_UPDATED_AT, SENTINEL_ID } = require("./mobileSyncErrors");
const { PERMISSION_DENIED } = require("../services/rbacService");
const { ENSURE_CLASSES_STATUS_CHECK_SQL } = require("./classesUniqueness");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_MOBILE_SYNC_L1_IT_DATABASE ?? "somafrik_mobile_sync_l1_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const ID_D = "44444444-4444-4444-8444-444444444444";
const TEACHER_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DUAL_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10";
const ACC_DUAL_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20";
const SUBJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEACHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DUAL_TEACHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc10";
const ASSIGN_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ASSIGN_C = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DUAL_ASSIGN_A = "dddddddd-dddd-4ddd-8ddd-dddddddddd10";
const SAME_TS = "2026-08-26T08:00:00.000Z";
const LATER_TS = "2026-08-26T09:00:00.000Z";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  if (!databaseName) throw new Error("SOMAFRIK_MOBILE_SYNC_L1_IT_DATABASE invalide.");
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

async function setupFixture(pool) {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS countries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      iso_code VARCHAR(8) NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      school_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS academic_years (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE TABLE IF NOT EXISTS classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id),
      class_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      level TEXT,
      section TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES schools(id),
      user_code VARCHAR(64) NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS teachers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      user_id UUID REFERENCES users(id),
      teacher_code VARCHAR(64) NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      subject_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS teacher_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      teacher_id UUID NOT NULL REFERENCES teachers(id),
      class_id UUID NOT NULL REFERENCES classes(id),
      subject_id UUID NOT NULL REFERENCES subjects(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id),
      assignment_role TEXT NOT NULL DEFAULT 'primary',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      school_id UUID REFERENCES schools(id),
      role_key TEXT NOT NULL,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);
  await pool.query(`
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS level_id UUID;
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS stream_id UUID;
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS group_id UUID;
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS group_code TEXT;
  `);
  await pool.query(ENSURE_CLASSES_STATUS_CHECK_SQL);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_classes_school_updated_at_id
      ON classes (school_id, updated_at, id);
  `);
  await pool.query("TRUNCATE teacher_assignments, teachers, user_roles, users, subjects, classes, academic_years, schools, countries CASCADE");

  const country = await pool.query(
    `INSERT INTO countries (name, iso_code) VALUES ('Testland', 'TT') RETURNING id`,
  );
  await pool.query(
    `INSERT INTO schools (country_id, school_code, name)
     VALUES ($1, 'SCH-A', 'École A'), ($1, 'SCH-B', 'École B')`,
    [country.rows[0].id],
  );
  await pool.query(
    `INSERT INTO academic_years (school_id, name, status)
     SELECT id, '2025-2026', 'open' FROM schools WHERE school_code IN ('SCH-A', 'SCH-B')`,
  );

  const schoolA = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-A'`)).rows[0];
  const schoolB = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-B'`)).rows[0];
  const yearA = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-A'`,
    )
  ).rows[0];
  const yearB = (
    await pool.query(
      `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id WHERE s.school_code = 'SCH-B'`,
    )
  ).rows[0];
  return { schoolA: schoolA.id, schoolB: schoolB.id, yearA: yearA.id, yearB: yearB.id };
}

function createDbAdapter(pool) {
  return {
    async one(sql, params = []) {
      return (await pool.query(sql, params)).rows[0] ?? null;
    },
    async all(sql, params = []) {
      return (await pool.query(sql, params)).rows;
    },
    async query(sql, params = []) {
      return pool.query(sql, params);
    },
    async getSchoolByCode(code) {
      const result = await pool.query(
        `SELECT id, school_code FROM schools WHERE school_code = $1 LIMIT 1`,
        [String(code ?? "").trim().toUpperCase()],
      );
      return result.rows[0] ?? null;
    },
  };
}

async function insertClass(pool, { id, schoolId, yearId, classCode, name, status = "active", updatedAt }) {
  await pool.query(
    `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
    [id, schoolId, yearId, classCode, name, status, updatedAt],
  );
}

function adminPrincipal(overrides = {}) {
  return {
    sub: "admin-1",
    role: "Admin School",
    schoolCode: "SCH-A",
    permissions: ["Voir classes", "Gérer classes"],
    ...overrides,
  };
}

function teacherPrincipal(overrides = {}) {
  return {
    sub: TEACHER_USER_ID,
    role: "Enseignant",
    roleKeys: ["TEACHER"],
    schoolCode: "SCH-A",
    permissions: ["Voir classes"],
    assignments: [
      { classId: ID_A, classCode: "CLS-A", status: "active" },
      { classId: ID_C, classCode: "CLS-C", status: "active" },
    ],
    ...overrides,
  };
}

async function seedTeacherFixture(pool, ids) {
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, role, status)
     VALUES ($1, $2, 'TEACH-SYNC-1', 'Tana', 'Kabila', 'Enseignant', 'active')`,
    [TEACHER_USER_ID, ids.schoolA],
  );
  await pool.query(
    `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
     VALUES ($1, $2, $3, 'TCH-SYNC-1', 'active')`,
    [TEACHER_ID, ids.schoolA, TEACHER_USER_ID],
  );
  await pool.query(
    `INSERT INTO subjects (id, school_id, subject_code, name, status)
     VALUES ($1, $2, 'SUB-SYNC-1', 'Maths', 'active')`,
    [SUBJECT_ID, ids.schoolA],
  );
}

async function seedDualSchoolUser(pool, ids) {
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, role, status)
     VALUES ($1, $2, 'DUAL-SYNC-1', 'Dina', 'Mwamba', 'Enseignant', 'active')`,
    [DUAL_USER_ID, ids.schoolA],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $2, 'TEACHER', 'active'),
       ($1, $3, 'SCHOOL_ADMIN', 'active')`,
    [DUAL_USER_ID, ids.schoolA, ids.schoolB],
  );
  await pool.query(
    `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
     VALUES ($1, $2, $3, 'TCH-DUAL-1', 'active')`,
    [DUAL_TEACHER_ID, ids.schoolA, DUAL_USER_ID],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (
       id, school_id, teacher_id, class_id, subject_id, academic_year_id, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
    [DUAL_ASSIGN_A, ids.schoolA, DUAL_TEACHER_ID, ID_A, SUBJECT_ID, ids.yearA],
  );
}

async function seedAccountantDualSchoolUser(pool, ids) {
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, role, status)
     VALUES ($1, $2, 'ACC-DUAL-1', 'Carla', 'Diallo', 'Comptable', 'active')`,
    [ACC_DUAL_USER_ID, ids.schoolA],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $2, 'ACCOUNTANT', 'active'),
       ($1, $3, 'SCHOOL_ADMIN', 'active')`,
    [ACC_DUAL_USER_ID, ids.schoolA, ids.schoolB],
  );
}

async function upsertTeacherAssignment(pool, { id, schoolId, yearId, classId, status = "active" }) {
  await pool.query(
    `INSERT INTO teacher_assignments (
       id, school_id, teacher_id, class_id, subject_id, academic_year_id, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
    [id, schoolId, TEACHER_ID, classId, SUBJECT_ID, yearId, status],
  );
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP mobileSyncClasses.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const tokens = new TokenService({ secret: "ci-test-secret-with-enough-length-for-production-checks" });
  const tenantScopeService = new TenantScopeService();

  try {
    const ids = await setupFixture(pool);
    const adapter = createDbAdapter(pool);
    const classesRepo = createClassesRepository(adapter);
    const liveRoleKeysByUser = new Map([
      ["admin-1", ["SCHOOL_ADMIN"]],
      [TEACHER_USER_ID, ["TEACHER"]],
    ]);
    let failLiveRoles = false;
    let classSqlCalls = 0;
    const repository = {
      getSchoolByCode: (code) => adapter.getSchoolByCode(code),
      listSchoolClassesForMobileSync: (code, options) => {
        classSqlCalls += 1;
        return classesRepo.listForMobileSync(code, options);
      },
      listLiveTeacherClassAssignmentsForSync: (userId, schoolId) =>
        classesRepo.listLiveTeacherClassAssignmentsForSync(userId, schoolId),
      async listActiveUserRoleKeys() {
        throw new Error("listActiveUserRoleKeys unscoped ne doit pas être appelé par mobile-sync");
      },
      async listActiveUserRoleKeysForSchool(userId, schoolId) {
        if (failLiveRoles) throw new Error("pg roles unavailable");
        const uid = String(userId ?? "").trim();
        const sid = String(schoolId ?? "").trim();
        if (!uid || !sid) return [];
        if (liveRoleKeysByUser.has(uid)) {
          return liveRoleKeysByUser.get(uid) ?? [];
        }
        const rows = await pool.query(
          `SELECT role_key
           FROM user_roles
           WHERE user_id::text = $1
             AND school_id::text = $2
             AND status = 'active'
             AND revoked_at IS NULL
           ORDER BY granted_at ASC`,
          [uid, sid],
        );
        return rows.rows.map((row) => row.role_key);
      },
      async resolveEffectivePermissions(principal) {
        const keys = new Set(principal.roleKeys ?? []);
        if (keys.has("SCHOOL_ADMIN")) {
          return { permissions: ["Voir classes", "Gérer classes"] };
        }
        if (keys.has("TEACHER")) {
          return { permissions: ["Voir classes"] };
        }
        return { permissions: [] };
      },
    };

    async function sync(principal, { cursor, limit } = {}) {
      return handleMobileSyncL1Classes({
        principal,
        cursor,
        limit,
        tokenService: tokens,
        repository,
        tenantScopeService,
      });
    }

    await insertClass(pool, {
      id: ID_A,
      schoolId: ids.schoolA,
      yearId: ids.yearA,
      classCode: "CLS-A",
      name: "6ème A",
      updatedAt: SAME_TS,
    });
    await insertClass(pool, {
      id: ID_B,
      schoolId: ids.schoolA,
      yearId: ids.yearA,
      classCode: "CLS-B",
      name: "6ème B",
      updatedAt: SAME_TS,
    });
    await insertClass(pool, {
      id: ID_C,
      schoolId: ids.schoolA,
      yearId: ids.yearA,
      classCode: "CLS-C",
      name: "6ème C",
      updatedAt: SAME_TS,
    });
    await insertClass(pool, {
      id: ID_D,
      schoolId: ids.schoolB,
      yearId: ids.yearB,
      classCode: "CLS-B-ONLY",
      name: "5ème B",
      updatedAt: SAME_TS,
    });

    await seedTeacherFixture(pool, ids);
    await seedDualSchoolUser(pool, ids);
    await seedAccountantDualSchoolUser(pool, ids);
    await upsertTeacherAssignment(pool, {
      id: ASSIGN_A,
      schoolId: ids.schoolA,
      yearId: ids.yearA,
      classId: ID_A,
    });

    const staleTeacherJwt = teacherPrincipal();

    // CAS 1 — cold sync : 3 classes actives school A, zéro fuite school B
    const cold = await sync(adminPrincipal());
    assert.equal(cold.httpStatus, 200, "CAS1 status");
    assert.equal(cold.body.mode, "full");
    assert.equal(cold.body.cursorStatus, "ok");
    assert.equal(cold.body.hasMore, false);
    assert.equal(cold.body.items.length, 3);
    assert.deepEqual(
      cold.body.items.map((item) => item.classCode).sort(),
      ["CLS-A", "CLS-B", "CLS-C"],
    );
    assert.ok(!cold.body.items.some((item) => item.classCode === "CLS-B-ONLY"));
    for (const item of cold.body.items) {
      assert.equal(item.tombstone, false);
      assert.equal(item.status, "active");
    }

    // Index justification : le plan peut utiliser idx_classes_school_updated_at_id
    await pool.query("SET enable_seqscan = off");
    const explained = await pool.query(
      `EXPLAIN (FORMAT JSON)
       SELECT cl.id FROM classes cl
       WHERE cl.school_id = $1
         AND (cl.updated_at > $2::timestamptz OR (cl.updated_at = $2::timestamptz AND cl.id > $3::uuid))
       ORDER BY cl.updated_at ASC, cl.id ASC`,
      [ids.schoolA, SAME_TS, ID_A],
    );
    await pool.query("SET enable_seqscan = on");
    const planText = JSON.stringify(explained.rows[0]);
    assert.match(planText, /idx_classes_school_updated_at_id/, "index keyset utilisable (enable_seqscan=off)");

    // CAS 3 — pagination same timestamps, aucune perte
    const page1 = await sync(adminPrincipal(), { limit: 2 });
    assert.equal(page1.body.items.length, 2);
    assert.equal(page1.body.hasMore, true);
    assert.deepEqual(
      page1.body.items.map((item) => item.id),
      [ID_A, ID_B],
    );
    const page2 = await sync(adminPrincipal(), { cursor: page1.body.nextCursor, limit: 2 });
    assert.equal(page2.body.mode, "delta");
    assert.deepEqual(
      page2.body.items.map((item) => item.id),
      [ID_C],
    );
    assert.equal(new Set([...page1.body.items, ...page2.body.items].map((item) => item.id)).size, 3);

    // CAS 2 — warm delta : update une classe → seulement cette ligne
    await pool.query(`UPDATE classes SET name = '6ème A*', updated_at = $2::timestamptz WHERE id = $1`, [
      ID_A,
      LATER_TS,
    ]);
    const warm = await sync(adminPrincipal(), { cursor: cold.body.nextCursor });
    assert.equal(warm.body.mode, "delta");
    assert.equal(warm.body.items.length, 1);
    assert.equal(warm.body.items[0].id, ID_A);
    assert.equal(warm.body.items[0].name, "6ème A*");

    // CAS 4 — archive → tombstone inactive dans le delta
    await pool.query(`UPDATE classes SET status = 'inactive', updated_at = NOW() WHERE id = $1`, [ID_B]);
    const archived = await sync(adminPrincipal(), { cursor: warm.body.nextCursor });
    assert.ok(
      archived.body.items.some((item) => item.id === ID_B && item.status === "inactive" && item.tombstone === true),
      "CAS4 tombstone inactive",
    );

    // CAS 5 — JWT stale A+C, live PG A uniquement → seulement A (pas de fuite JWT)
    const teacherCold = await sync(staleTeacherJwt);
    assert.deepEqual(
      teacherCold.body.items.map((item) => item.classCode),
      ["CLS-A"],
    );
    assert.ok(!teacherCold.body.items.some((item) => item.id === ID_C));

    // CAS 6 — grant C dans PostgreSQL, même JWT → 409 puis full A+C
    await upsertTeacherAssignment(pool, {
      id: ASSIGN_C,
      schoolId: ids.schoolA,
      yearId: ids.yearA,
      classId: ID_C,
    });
    const granted = await sync(staleTeacherJwt, { cursor: teacherCold.body.nextCursor });
    assert.equal(granted.httpStatus, 409);
    assert.equal(granted.body.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);
    assert.equal(granted.body.cursorStatus, "scope_changed");
    assert.equal(granted.body.mode, "full_required");
    const teacherWithBoth = await sync(staleTeacherJwt);
    assert.equal(teacherWithBoth.httpStatus, 200);
    assert.equal(teacherWithBoth.body.mode, "full");
    assert.deepEqual(
      teacherWithBoth.body.items.map((item) => item.classCode).sort(),
      ["CLS-A", "CLS-C"],
    );

    // CAS 7 — revoke C dans PostgreSQL, même JWT → 409 puis full sans C
    await pool.query(`UPDATE teacher_assignments SET status = 'inactive', updated_at = NOW() WHERE id = $1`, [
      ASSIGN_C,
    ]);
    const revoked = await sync(staleTeacherJwt, { cursor: teacherWithBoth.body.nextCursor });
    assert.equal(revoked.httpStatus, 409);
    assert.equal(revoked.body.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);
    assert.equal(revoked.body.cursorStatus, "scope_changed");
    const resync = await sync(staleTeacherJwt);
    assert.deepEqual(
      resync.body.items.map((item) => item.classCode),
      ["CLS-A"],
    );
    assert.ok(!resync.body.items.some((item) => item.id === ID_C));

    // CAS 8 — cursor school A utilisé school B
    await assert.rejects(
      () =>
        sync(adminPrincipal({ schoolCode: "SCH-B", effectiveSchoolId: ids.schoolB }), {
          cursor: cold.body.nextCursor,
        }),
      (error) => error.statusCode === 403 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
    );

    // CAS 9 — tamper
    const tampered = `${cold.body.nextCursor.slice(0, -4)}xxxx`;
    await assert.rejects(
      () => sync(adminPrincipal(), { cursor: tampered }),
      (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
    );

    // CAS 10 — expiry
    const { scopeHash } = computeClassesScopeHash(adminPrincipal(), {
      schoolCode: "SCH-A",
      schoolId: ids.schoolA,
    });
    const expired = encodeMobileSyncCursor(
      {
        resource: "classes",
        schoolCode: "SCH-A",
        schoolId: ids.schoolA,
        principalId: "admin-1",
        scopeHash,
        lastUpdatedAt: SENTINEL_UPDATED_AT,
        lastId: SENTINEL_ID,
      },
      tokens,
      { ttlSeconds: -120 },
    );
    const expiredResult = await sync(adminPrincipal({ effectiveSchoolId: ids.schoolA }), { cursor: expired });
    assert.equal(expiredResult.httpStatus, 409);
    assert.equal(expiredResult.body.code, MOBILE_SYNC_ERROR.CURSOR_EXPIRED);
    assert.equal(expiredResult.body.cursorStatus, "expired");
    assert.equal(expiredResult.body.mode, "full_required");

    // JWT Admin stale + rôles live [] → zéro classe (pas de fallback JWT)
    liveRoleKeysByUser.set("admin-1", []);
    const adminEmptyRoles = await sync(adminPrincipal({ effectiveSchoolId: ids.schoolA }));
    assert.equal(adminEmptyRoles.httpStatus, 200);
    assert.deepEqual(adminEmptyRoles.body.items, []);
    liveRoleKeysByUser.set("admin-1", ["SCHOOL_ADMIN"]);

    // JWT Teacher stale + rôle live révoqué → zéro classe
    liveRoleKeysByUser.set(TEACHER_USER_ID, []);
    const teacherRevokedRole = await sync(staleTeacherJwt);
    assert.equal(teacherRevokedRole.httpStatus, 200);
    assert.deepEqual(teacherRevokedRole.body.items, []);
    liveRoleKeysByUser.set(TEACHER_USER_ID, ["TEACHER"]);

    // P0 — même user TEACHER@A + SCHOOL_ADMIN@B ; sync A reste assigned
    const dualJwt = adminPrincipal({
      sub: DUAL_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Voir classes", "Gérer classes"],
      effectiveSchoolId: ids.schoolA,
    });
    const dualSync = await sync(dualJwt);
    assert.equal(dualSync.httpStatus, 200, "dual-school status");
    assert.deepEqual(
      dualSync.body.items.map((item) => item.classCode),
      ["CLS-A"],
    );
    assert.ok(!dualSync.body.items.some((item) => item.classCode === "CLS-B"));
    assert.ok(!dualSync.body.items.some((item) => item.classCode === "CLS-C"));
    assert.ok(!dualSync.body.items.some((item) => item.classCode === "CLS-B-ONLY"));

    // P0 — ACCOUNTANT@A + SCHOOL_ADMIN@B + JWT Admin stale@A → 403, aucune classe
    const sqlBeforeAccountant = classSqlCalls;
    const accountantDualJwt = adminPrincipal({
      sub: ACC_DUAL_USER_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Voir classes", "Gérer classes"],
      effectiveSchoolId: ids.schoolA,
    });
    const accountantDenied = await sync(accountantDualJwt);
    assert.equal(accountantDenied.httpStatus, 403, "accountant dual 403");
    assert.equal(accountantDenied.body.code, PERMISSION_DENIED);
    assert.equal(accountantDenied.body.items, undefined);
    assert.equal(classSqlCalls, sqlBeforeAccountant, "403 n'interroge pas classes");

    // Erreur lecture rôles live → 503, zéro donnée
    failLiveRoles = true;
    const rolesError = await sync(adminPrincipal({ effectiveSchoolId: ids.schoolA }));
    assert.equal(rolesError.httpStatus, 503);
    assert.equal(rolesError.body.code, MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE);
    assert.equal(rolesError.body.items, undefined);
    failLiveRoles = false;

    // Pas de DELETE physique côté API classes : le CHECK refuse 'deleted'/'archived'
    await assert.rejects(
      () =>
        pool.query(`UPDATE classes SET status = 'deleted' WHERE id = $1`, [ID_C]),
      (error) => String(error.code) === "23514",
    );

    console.log("mobileSyncClasses.pg.test.js: OK CAS 1-10 + tenant-scoped roles + accountant dual 403");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
