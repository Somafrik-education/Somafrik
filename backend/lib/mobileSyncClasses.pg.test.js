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
const { ENSURE_CLASSES_STATUS_CHECK_SQL } = require("./classesUniqueness");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_MOBILE_SYNC_L1_IT_DATABASE ?? "somafrik_mobile_sync_l1_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const ID_D = "44444444-4444-4444-8444-444444444444";
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
  await pool.query("TRUNCATE classes, academic_years, schools, countries CASCADE");

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

function teacherPrincipal(assignments, overrides = {}) {
  return {
    sub: "teacher-1",
    role: "Enseignant",
    schoolCode: "SCH-A",
    permissions: ["Voir classes"],
    assignments,
    ...overrides,
  };
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
    const repository = {
      getSchoolByCode: (code) => adapter.getSchoolByCode(code),
      listSchoolClassesForMobileSync: (code, options) => classesRepo.listForMobileSync(code, options),
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

    // CAS 5 — teacher A uniquement
    const teacherA = teacherPrincipal([{ classId: ID_A, classCode: "CLS-A", status: "active" }]);
    const teacherCold = await sync(teacherA);
    assert.deepEqual(
      teacherCold.body.items.map((item) => item.classCode),
      ["CLS-A"],
    );
    assert.ok(!teacherCold.body.items.some((item) => item.id === ID_C));

    // CAS 6 — grant B → ancien cursor => scope_changed
    const teacherAB = teacherPrincipal([
      { classId: ID_A, classCode: "CLS-A", status: "active" },
      { classId: ID_C, classCode: "CLS-C", status: "active" },
    ]);
    const granted = await sync(teacherAB, { cursor: teacherCold.body.nextCursor });
    assert.equal(granted.httpStatus, 409);
    assert.equal(granted.body.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);
    assert.equal(granted.body.cursorStatus, "scope_changed");
    assert.equal(granted.body.mode, "full_required");

    // CAS 7 — revoke C → scope_changed puis full sans C
    const teacherWithBoth = await sync(teacherAB);
    assert.deepEqual(
      teacherWithBoth.body.items.map((item) => item.classCode).sort(),
      ["CLS-A", "CLS-C"],
    );
    const revoked = await sync(teacherA, { cursor: teacherWithBoth.body.nextCursor });
    assert.equal(revoked.body.cursorStatus, "scope_changed");
    const resync = await sync(teacherA);
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

    // Pas de DELETE physique côté API classes : le CHECK refuse 'deleted'/'archived'
    await assert.rejects(
      () =>
        pool.query(`UPDATE classes SET status = 'deleted' WHERE id = $1`, [ID_C]),
      (error) => String(error.code) === "23514",
    );

    console.log("mobileSyncClasses.pg.test.js: OK CAS 1-10");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
