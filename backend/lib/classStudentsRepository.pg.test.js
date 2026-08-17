"use strict";

/**
 * Intégration PostgreSQL réelle — inscription élève depuis une classe :
 * création + relecture, isolation inter-établissements, classe inactive,
 * année fermée, rollback transactionnel, concurrence matricules.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createClassesRepository } = require("../db/classesRepository");
const { createClassStudentsRepository } = require("../db/classStudentsRepository");
const { createTxAdapter } = require("../db/txAdapter");
const { hashSecret, verifySecret } = require("../services/credentialService");
const {
  CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL,
  CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL,
  DROP_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL,
  ENSURE_CLASSES_STATUS_CHECK_SQL,
  NORMALIZE_CLASSES_STATUS_SQL,
} = require("./classesUniqueness");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const ENROLLMENT_IT_DATABASE = String(
  process.env.SOMAFRIK_CLASS_STUDENTS_IT_DATABASE ?? "somafrik_class_students_it",
)
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const maintenanceUrl = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenanceUrl });
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
      iso_code VARCHAR(8) NOT NULL UNIQUE,
      phone_code VARCHAR(16) NOT NULL DEFAULT '+000',
      currency VARCHAR(16) NOT NULL DEFAULT 'XOF',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      school_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS academic_years (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL,
      start_date DATE,
      end_date DATE,
      is_current BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (school_id, name)
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

    CREATE TABLE IF NOT EXISTS students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      student_code VARCHAR(64) NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      gender TEXT,
      birth_date DATE,
      birth_place TEXT,
      photo_url TEXT,
      parent_phone TEXT,
      parent_email TEXT,
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
      email TEXT,
      phone TEXT,
      password_hash TEXT,
      pin_hash TEXT,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      role TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS login_code TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS short_code TEXT;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS identity_code TEXT;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS login_code TEXT;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS identity_initials TEXT;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS identity_year SMALLINT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_code TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS login_code TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_initials TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_year SMALLINT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE TABLE IF NOT EXISTS identity_counters (
      school_id UUID NOT NULL REFERENCES schools(id),
      creation_year SMALLINT NOT NULL,
      last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (school_id, creation_year)
    );
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION somafrik_ascii_upper(value TEXT)
    RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
      SELECT upper(translate(coalesce(value, ''),
        'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝŸýÿŒœÆæ',
        'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYYyyOoAa'))
    $$;
    CREATE OR REPLACE FUNCTION somafrik_school_short_code(name_value TEXT)
    RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
    DECLARE token TEXT; result TEXT := ''; normalized TEXT;
    BEGIN
      normalized := trim(regexp_replace(somafrik_ascii_upper(name_value), '[^A-Z0-9]+', ' ', 'g'));
      FOR token IN SELECT part FROM regexp_split_to_table(normalized, '\\s+') AS part WHERE part <> '' LOOP
        IF token IN ('DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'D', 'ET') THEN
          CONTINUE;
        END IF;
        result := result || left(token, 1);
        EXIT WHEN length(result) >= 5;
      END LOOP;
      IF length(result) < 2 THEN
        result := left(regexp_replace(normalized, '\\s+', '', 'g'), 5);
      END IF;
      IF result = '' THEN
        RAISE EXCEPTION 'SCHOOL_SHORT_CODE_REQUIRED';
      END IF;
      RETURN left(result, 5);
    END
    $$;
  `);

  const canonicalSql = fs.readFileSync(
    path.join(__dirname, "../db/migrations/20260823_student_canonical_identifier.sql"),
    "utf8",
  );
  await pool.query(canonicalSql);
  const { STUDENT_GENERAL_IDENTITY_SQL } = require("../db/studentGeneralIdentityPg");
  await pool.query(STUDENT_GENERAL_IDENTITY_SQL);

  await pool.query(`
    DROP TRIGGER IF EXISTS users_permanent_identity_insert ON users;
    CREATE TRIGGER users_permanent_identity_insert
    BEFORE INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION somafrik_assign_permanent_user_identity();

    DROP TRIGGER IF EXISTS users_permanent_identity_immutable ON users;
    CREATE TRIGGER users_permanent_identity_immutable
    BEFORE UPDATE OF identity_code, login_code, identity_initials, identity_year ON users
    FOR EACH ROW EXECUTE FUNCTION somafrik_assign_permanent_user_identity();
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      student_id UUID NOT NULL REFERENCES students(id),
      class_id UUID NOT NULL REFERENCES classes(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id),
      enrollment_date DATE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (student_id, academic_year_id)
    );

    CREATE TABLE IF NOT EXISTS education_levels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      level_code TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS education_streams (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      level_id UUID REFERENCES education_levels(id),
      stream_code TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS school_levels (
      school_id UUID NOT NULL REFERENCES schools(id),
      level_id UUID NOT NULL REFERENCES education_levels(id),
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (school_id, level_id)
    );
    CREATE TABLE IF NOT EXISTS school_streams (
      school_id UUID NOT NULL REFERENCES schools(id),
      stream_id UUID NOT NULL REFERENCES education_streams(id),
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (school_id, stream_id)
    );
    CREATE TABLE IF NOT EXISTS education_class_groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      group_code TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS school_class_groups (
      school_id UUID NOT NULL REFERENCES schools(id),
      group_id UUID NOT NULL REFERENCES education_class_groups(id),
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (school_id, group_id)
    );
  `);

  await pool.query(`
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS level_id UUID REFERENCES education_levels(id);
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS stream_id UUID REFERENCES education_streams(id);
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES education_class_groups(id);
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS group_code TEXT;
  `);

  await pool.query(
    "TRUNCATE enrollments, users, students, classes, school_class_groups, school_streams, school_levels, education_class_groups, education_streams, education_levels, academic_years, schools, countries CASCADE",
  );
  await pool.query(NORMALIZE_CLASSES_STATUS_SQL);
  await pool.query(CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL);
  await pool.query(DROP_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL);
  await pool.query(CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL);
  await pool.query(ENSURE_CLASSES_STATUS_CHECK_SQL);

  await pool.query(
    `INSERT INTO countries (name, iso_code) VALUES ('Congo', 'CD'), ('Burundi', 'BI')
     ON CONFLICT (iso_code) DO NOTHING`,
  );
  const cd = await pool.query(`SELECT id FROM countries WHERE iso_code = 'CD'`);
  const bi = await pool.query(`SELECT id FROM countries WHERE iso_code = 'BI'`);
  const cdId = cd.rows[0].id;
  const biId = bi.rows[0].id;

  await pool.query(
    `INSERT INTO schools (country_id, school_code, name, short_code)
     VALUES
       ($1, 'CD-2026-0001', 'Institut Nuru', 'IN'),
       ($1, 'CD-2026-0002', 'Lycée Lumumba', 'LL'),
       ($2, 'BI-2026-0001', 'Lycée Bujumbura', 'LB')`,
    [cdId, biId],
  );

  await pool.query(
    `INSERT INTO academic_years (school_id, name, is_current, status)
     SELECT id, '2025-2026', TRUE, 'open' FROM schools
     WHERE school_code IN ('CD-2026-0001', 'CD-2026-0002', 'BI-2026-0001')`,
  );

  await pool.query(
    `INSERT INTO academic_years (school_id, name, is_current, status)
     SELECT id, '2024-2025', FALSE, 'closed' FROM schools WHERE school_code = 'CD-2026-0001'`,
  );

  const levelCd6 = await pool.query(
    `INSERT INTO education_levels (country_id, level_code, name, status)
     VALUES ($1, '6eme', '6ème', 'active') RETURNING id`,
    [cdId],
  );
  const levelCd5 = await pool.query(
    `INSERT INTO education_levels (country_id, level_code, name, status)
     VALUES ($1, '5eme', '5ème', 'active') RETURNING id`,
    [cdId],
  );
  const levelBi6 = await pool.query(
    `INSERT INTO education_levels (country_id, level_code, name, status)
     VALUES ($1, '6eme', '6ème', 'active') RETURNING id`,
    [biId],
  );
  await pool.query(
    `INSERT INTO school_levels (school_id, level_id, status)
     SELECT id, $1, 'active' FROM schools WHERE school_code IN ('CD-2026-0001', 'CD-2026-0002')`,
    [levelCd6.rows[0].id],
  );
  await pool.query(
    `INSERT INTO school_levels (school_id, level_id, status)
     SELECT id, $1, 'active' FROM schools WHERE school_code = 'CD-2026-0002'`,
    [levelCd5.rows[0].id],
  );
  await pool.query(
    `INSERT INTO school_levels (school_id, level_id, status)
     SELECT id, $1, 'active' FROM schools WHERE school_code = 'CD-2026-0001'`,
    [levelCd5.rows[0].id],
  );
  await pool.query(
    `INSERT INTO school_levels (school_id, level_id, status)
     SELECT id, $1, 'active' FROM schools WHERE school_code = 'BI-2026-0001'`,
    [levelBi6.rows[0].id],
  );

  const groupCdA = await pool.query(
    `INSERT INTO education_class_groups (country_id, group_code, name, status)
     VALUES ($1, 'A', 'A', 'active') RETURNING id`,
    [cdId],
  );
  const groupCdB = await pool.query(
    `INSERT INTO education_class_groups (country_id, group_code, name, status)
     VALUES ($1, 'B', 'B', 'active') RETURNING id`,
    [cdId],
  );
  const groupCdI = await pool.query(
    `INSERT INTO education_class_groups (country_id, group_code, name, status)
     VALUES ($1, 'I', 'I', 'active') RETURNING id`,
    [cdId],
  );
  const groupBiA = await pool.query(
    `INSERT INTO education_class_groups (country_id, group_code, name, status)
     VALUES ($1, 'A', 'A', 'active') RETURNING id`,
    [biId],
  );
  await pool.query(
    `INSERT INTO school_class_groups (school_id, group_id, status)
     SELECT id, unnest($1::uuid[]), 'active' FROM schools WHERE school_code IN ('CD-2026-0001', 'CD-2026-0002')`,
    [[groupCdA.rows[0].id, groupCdB.rows[0].id, groupCdI.rows[0].id]],
  );
  await pool.query(
    `INSERT INTO school_class_groups (school_id, group_id, status)
     SELECT id, $1, 'active' FROM schools WHERE school_code = 'BI-2026-0001'`,
    [groupBiA.rows[0].id],
  );

  const year = async (schoolCode, name = "2025-2026") =>
    (
      await pool.query(
        `SELECT ay.id FROM academic_years ay JOIN schools s ON s.id = ay.school_id
         WHERE s.school_code = $1 AND ay.name = $2`,
        [schoolCode, name],
      )
    ).rows[0].id;

  return {
    yearCd1: await year("CD-2026-0001"),
    yearCd2: await year("CD-2026-0002"),
    yearBi: await year("BI-2026-0001"),
    levelCd6: levelCd6.rows[0].id,
    levelCd5: levelCd5.rows[0].id,
    levelBi6: levelBi6.rows[0].id,
    groupCdA: groupCdA.rows[0].id,
    groupCdB: groupCdB.rows[0].id,
    groupCdI: groupCdI.rows[0].id,
    groupBiA: groupBiA.rows[0].id,
  };
}

function createDbAdapter(pool) {
  return {
    async one(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows[0] ?? null;
    },
    async all(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows;
    },
    async query(sql, params = []) {
      return pool.query(sql, params);
    },
    async getSchoolByCode(code) {
      const result = await pool.query(
        `SELECT id, school_code, country_id, name FROM schools WHERE school_code = $1 LIMIT 1`,
        [String(code ?? "").trim().toUpperCase()],
      );
      return result.rows[0] ?? null;
    },
    async withTransaction(fn) {
      const client = await pool.connect();
      const tx = createTxAdapter(client);
      try {
        await client.query("BEGIN");
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Force l'échec de l'INSERT enrollments après un INSERT students réussi.
 * @param {ReturnType<typeof createTxAdapter>} tx
 */
function wrapTxFailingEnrollment(tx) {
  return {
    ...tx,
    async one(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (normalized.startsWith("INSERT INTO ENROLLMENTS")) {
        const error = new Error(
          'duplicate key value violates unique constraint "enrollments_student_id_academic_year_id_key"',
        );
        error.code = "23505";
        throw error;
      }
      return tx.one(sql, params);
    },
  };
}

function wrapTxFailingUsers(tx) {
  return {
    ...tx,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (normalized.startsWith("INSERT INTO USERS")) {
        const error = new Error("forced users insert failure");
        error.code = "23505";
        throw error;
      }
      return tx.query(sql, params);
    },
  };
}

function createRollbackTestRepository(baseDb, wrapTx) {
  return createClassStudentsRepository({
    ...baseDb,
    withTransaction: async (fn) =>
      baseDb.withTransaction(async (tx) => fn(wrapTx(tx))),
  });
}

async function countStudents(pool, schoolCode) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM students st
     JOIN schools s ON s.id = st.school_id
     WHERE s.school_code = $1`,
    [schoolCode],
  );
  return result.rows[0].count;
}

async function countEnrollments(pool, schoolCode) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM enrollments e
     JOIN schools s ON s.id = e.school_id
     WHERE s.school_code = $1`,
    [schoolCode],
  );
  return result.rows[0].count;
}

async function countUsers(pool, schoolCode) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM users u
     JOIN schools s ON s.id = u.school_id
     WHERE s.school_code = $1`,
    [schoolCode],
  );
  return result.rows[0].count;
}

async function assertCanonicalStudentLogin(pool, studentCode, schoolCode) {
  const result = await pool.query(
    `SELECT
       st.student_code,
       st.login_code AS student_login,
       st.identity_code AS student_identity,
       st.school_id AS student_school_id,
       u.user_code,
       u.login_code AS user_login,
       u.identity_code AS user_identity,
       u.role,
       u.school_id AS user_school_id,
       u.password_hash,
       u.pin_hash,
       u.must_change_password
     FROM students st
     JOIN users u ON u.user_code = st.student_code AND u.school_id = st.school_id
     JOIN schools s ON s.id = st.school_id
     WHERE st.student_code = $1 AND s.school_code = $2`,
    [studentCode, schoolCode],
  );
  assert.equal(result.rowCount, 1, `compte users manquant pour ${studentCode}`);
  const row = result.rows[0];
  assert.equal(row.student_login, row.student_code);
  assert.equal(row.student_identity, row.student_code);
  assert.equal(row.user_code, row.student_code);
  assert.equal(row.user_login, row.student_code);
  assert.equal(row.user_identity, row.student_code);
  assert.equal(row.role, "STUDENT");
  assert.equal(row.user_school_id, row.student_school_id);
  assert.equal(row.must_change_password, true);
  assert.match(String(row.password_hash), /^scrypt\$/);
  assert.equal(row.pin_hash, row.password_hash);
  assert.equal(verifySecret("1234", row.password_hash), false);
  assert.equal(verifySecret(row.student_code, row.password_hash), false);
  assert.doesNotMatch(String(row.password_hash), /1234/);
}

function assertEnrollmentProjectionHasNoSecret(row) {
  const serialized = JSON.stringify(row);
  assert.equal(row.pin, undefined);
  assert.equal(row.password, undefined);
  assert.equal(row.temporaryPassword, undefined);
  assert.equal(row.temporarySecret, undefined);
  assert.equal(row.credentials, undefined);
  assert.equal(row.pinHash, undefined);
  assert.equal(row.passwordHash, undefined);
  assert.doesNotMatch(serialized, /"1234"/);
  assert.doesNotMatch(serialized, /Tmp-/i);
  assert.doesNotMatch(serialized, /temporarySecret/i);
}

function assertCreateEnvelope(result) {
  assert.ok(result.student && typeof result.student === "object");
  assert.ok(result.credentials && typeof result.credentials === "object");
  assert.match(result.student.studentCode, /^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-\d{2}-\d{5}$/);
  assert.equal(result.credentials.login, result.student.studentCode);
  assert.match(result.credentials.temporarySecret, /^Tmp-[0-9a-f]{32}$/);
  assert.notEqual(result.credentials.temporarySecret, "1234");
  assert.notEqual(result.credentials.temporarySecret, result.student.studentCode);
  assertEnrollmentProjectionHasNoSecret(result.student);
  return result;
}

async function peekNextStudentCanonicalCode(pool, schoolCode, lastName, firstName) {
  const result = await pool.query(
    `SELECT
       s.id AS school_id,
       upper(btrim(c.iso_code))
         || '-' || coalesce(nullif(upper(btrim(s.short_code)), ''), somafrik_school_short_code(s.name))
         || '-' || somafrik_student_person_initials($2, $3)
         || '-' || lpad((extract(year FROM NOW())::integer % 100)::text, 2, '0')
         || '-' || lpad((coalesce(ctr.last_value, 0) + 1)::text, 5, '0') AS next_code
     FROM schools s
     JOIN countries c ON c.id = s.country_id
     LEFT JOIN student_general_code_counters ctr ON ctr.school_id = s.id
     WHERE s.school_code = $1`,
    [schoolCode, lastName, firstName],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP classStudentsRepository.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, ENROLLMENT_IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    const ids = await setupFixture(pool);
    const db = createDbAdapter(pool);
    const classesRepo = createClassesRepository(db);
    const studentsRepo = createClassStudentsRepository(db);

    const activeClass = await classesRepo.create(
      {
        academicYearId: ids.yearCd1,
        levelId: ids.levelCd6,
        groupId: ids.groupCdA,
        status: "active",
      },
      "CD-2026-0001",
    );
    const activeClassOtherSchool = await classesRepo.create(
      {
        academicYearId: ids.yearCd2,
        levelId: ids.levelCd5,
        groupId: ids.groupCdB,
        status: "active",
      },
      "CD-2026-0002",
    );
    const inactiveClass = await classesRepo.create(
      {
        academicYearId: ids.yearCd1,
        levelId: ids.levelCd6,
        groupId: ids.groupCdI,
        status: "inactive",
      },
      "CD-2026-0001",
    );

    const closedYearClassCode = `CLS-CLOSED-${Date.now()}`;
    const closedYear = await pool.query(
      `SELECT ay.id, s.id AS school_id
       FROM academic_years ay
       JOIN schools s ON s.id = ay.school_id
       WHERE s.school_code = 'CD-2026-0001' AND ay.name = '2024-2025'
       LIMIT 1`,
    );
    await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, $3, 'Classe année fermée', 'active')`,
      [closedYear.rows[0].school_id, closedYear.rows[0].id, closedYearClassCode],
    );

    const beforeFailed = await countStudents(pool, "CD-2026-0001");
    await assert.rejects(
      () =>
        studentsRepo.enroll(inactiveClass.classCode, "CD-2026-0001", {
          firstName: "Refus",
          lastName: "Inactive",
        }),
      (error) => error.statusCode === 409,
    );
    assert.equal(await countStudents(pool, "CD-2026-0001"), beforeFailed);

    await assert.rejects(
      () =>
        studentsRepo.enroll(closedYearClassCode, "CD-2026-0001", {
          firstName: "Refus",
          lastName: "ClosedYear",
        }),
      (error) => error.statusCode === 409,
    );
    assert.equal(await countStudents(pool, "CD-2026-0001"), beforeFailed);

    const rollbackEnrollmentRepo = createRollbackTestRepository(db, wrapTxFailingEnrollment);
    const beforeRollback = await countStudents(pool, "CD-2026-0001");
    const beforeRollbackUsers = await countUsers(pool, "CD-2026-0001");
    const beforeRollbackEnrollments = await countEnrollments(pool, "CD-2026-0001");
    await assert.rejects(
      () =>
        rollbackEnrollmentRepo.enroll(activeClass.classCode, "CD-2026-0001", {
          firstName: "Rollback",
          lastName: "Test",
        }),
      (error) => String(error.code) === "23505",
    );
    assert.equal(
      await countStudents(pool, "CD-2026-0001"),
      beforeRollback,
      "l'élève doit être annulé si l'inscription échoue",
    );
    assert.equal(await countUsers(pool, "CD-2026-0001"), beforeRollbackUsers);
    assert.equal(await countEnrollments(pool, "CD-2026-0001"), beforeRollbackEnrollments);

    const rollbackUsersRepo = createRollbackTestRepository(db, wrapTxFailingUsers);
    const beforeUsersFail = {
      students: await countStudents(pool, "CD-2026-0001"),
      users: await countUsers(pool, "CD-2026-0001"),
      enrollments: await countEnrollments(pool, "CD-2026-0001"),
    };
    await assert.rejects(
      () =>
        rollbackUsersRepo.enroll(activeClass.classCode, "CD-2026-0001", {
          firstName: "Sans",
          lastName: "Compte",
        }),
      (error) => String(error.code) === "23505",
    );
    assert.equal(
      await countStudents(pool, "CD-2026-0001"),
      beforeUsersFail.students,
      "aucun élève sans compte de connexion",
    );
    assert.equal(await countUsers(pool, "CD-2026-0001"), beforeUsersFail.users);
    assert.equal(
      await countEnrollments(pool, "CD-2026-0001"),
      beforeUsersFail.enrollments,
      "aucune inscription si le compte users échoue",
    );

    const enrolled = assertCreateEnvelope(
      await studentsRepo.enroll(activeClass.classCode, "CD-2026-0001", {
        firstName: "Awa",
        lastName: "Diop",
        gender: "Féminin",
        birthDate: "2012-04-12",
      }),
    );
    assert.match(enrolled.student.studentCode, /^CD-IN-[A-Z0-9]{1,5}-\d{2}-\d{5}$/);
    assert.equal(enrolled.student.matricule, enrolled.student.studentCode);
    assert.equal(enrolled.student.loginCode, enrolled.student.studentCode);
    await assertCanonicalStudentLogin(pool, enrolled.student.studentCode, "CD-2026-0001");
    assertEnrollmentProjectionHasNoSecret(enrolled.student);

    const listed = await studentsRepo.listByClassCode(activeClass.classCode, "CD-2026-0001");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].studentCode, enrolled.student.studentCode);
    listed.forEach(assertEnrollmentProjectionHasNoSecret);

    const reread = await studentsRepo.getByStudentCode(enrolled.student.studentCode, "CD-2026-0001");
    assert.equal(reread.classCode, activeClass.classCode);
    assertEnrollmentProjectionHasNoSecret(reread);

    const enrolledOtherSchool = assertCreateEnvelope(
      await studentsRepo.enroll(
        activeClassOtherSchool.classCode,
        "CD-2026-0002",
        { firstName: "Ibra", lastName: "Fall" },
      ),
    );
    assert.match(enrolledOtherSchool.student.studentCode, /^CD-LL-[A-Z0-9]{1,5}-\d{2}-\d{5}$/);
    assert.notEqual(enrolled.student.studentCode, enrolledOtherSchool.student.studentCode);
    await assertCanonicalStudentLogin(pool, enrolledOtherSchool.student.studentCode, "CD-2026-0002");
    assertEnrollmentProjectionHasNoSecret(enrolledOtherSchool.student);
    assert.notEqual(
      enrolled.credentials.temporarySecret,
      enrolledOtherSchool.credentials.temporarySecret,
      "deux inscriptions doivent produire des secrets distincts",
    );

    const secretRows = await pool.query(
      `SELECT user_code, password_hash, pin_hash
       FROM users WHERE user_code IN ($1, $2)
       ORDER BY user_code`,
      [enrolled.student.studentCode, enrolledOtherSchool.student.studentCode],
    );
    assert.equal(secretRows.rowCount, 2);
    assert.notEqual(
      secretRows.rows[0].password_hash,
      secretRows.rows[1].password_hash,
      "deux élèves ne partagent pas le même hash de secret",
    );
    const hashByCode = Object.fromEntries(
      secretRows.rows.map((row) => [row.user_code, row.password_hash]),
    );
    assert.equal(
      verifySecret(enrolled.credentials.temporarySecret, hashByCode[enrolled.student.studentCode]),
      true,
    );
    assert.equal(
      verifySecret(
        enrolledOtherSchool.credentials.temporarySecret,
        hashByCode[enrolledOtherSchool.student.studentCode],
      ),
      true,
    );
    assert.equal(
      verifySecret(enrolled.student.studentCode, hashByCode[enrolled.student.studentCode]),
      false,
    );
    assert.equal(verifySecret("1234", hashByCode[enrolled.student.studentCode]), false);

    const activeClassBiSameNumber = await classesRepo.create(
      {
        academicYearId: ids.yearBi,
        levelId: ids.levelBi6,
        groupId: ids.groupBiA,
        status: "active",
      },
      "BI-2026-0001",
    );
    const enrolledBiSameEstablishment = assertCreateEnvelope(
      await studentsRepo.enroll(
        activeClassBiSameNumber.classCode,
        "BI-2026-0001",
        { firstName: "Grace", lastName: "Nkurunziza" },
      ),
    );
    assert.match(enrolledBiSameEstablishment.student.studentCode, /^BI-LB-[A-Z0-9]{1,5}-\d{2}-\d{5}$/);
    assert.notEqual(
      enrolled.student.studentCode,
      enrolledBiSameEstablishment.student.studentCode,
      "CD-2026-0001 et BI-2026-0001 ne doivent pas partager le même matricule",
    );
    await assertCanonicalStudentLogin(
      pool,
      enrolledBiSameEstablishment.student.studentCode,
      "BI-2026-0001",
    );

    await assert.rejects(
      () => studentsRepo.listByClassCode(activeClass.classCode, "CD-2026-0002"),
      (error) => error.statusCode === 404,
    );

    const concurrent = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        studentsRepo.enroll(activeClass.classCode, "CD-2026-0001", {
          firstName: `Eleve${index}`,
          lastName: "Concurrent",
        }),
      ),
    );
    const codes = new Set(concurrent.map((row) => row.student.studentCode));
    assert.equal(codes.size, 4);
    const concurrentSecrets = concurrent.map((row) => {
      assertCreateEnvelope(row);
      return row.credentials.temporarySecret;
    });
    assert.equal(new Set(concurrentSecrets).size, 4);
    for (const row of concurrent) {
      assert.match(row.student.studentCode, /^CD-IN-[A-Z0-9]{1,5}-\d{2}-\d{5}$/);
      await assertCanonicalStudentLogin(pool, row.student.studentCode, "CD-2026-0001");
    }

    await assert.rejects(
      () =>
        studentsRepo.enroll(activeClass.classCode, "CD-2026-0001", {
          firstName: "Hack",
          lastName: "Scope",
          classCode: activeClassOtherSchool.classCode,
        }),
      (error) => error.statusCode === 400,
    );

    const colliding = await peekNextStudentCanonicalCode(pool, "CD-2026-0001", "Eleve", "Collision");
    const reservedHash = hashSecret("reserved-occupant-not-student");
    await pool.query("ALTER TABLE users DISABLE TRIGGER USER");
    await pool.query(
      `INSERT INTO users (
         school_id, user_code, first_name, last_name, email, phone,
         password_hash, pin_hash, must_change_password, role, status
       ) VALUES ($1, $2, 'Occupant', 'Existant', 'occupant@test.local', '', $3, $3, FALSE, 'SECRETARY', 'active')`,
      [colliding.school_id, colliding.next_code, reservedHash],
    );
    await pool.query("ALTER TABLE users ENABLE TRIGGER USER");
    const reservedBefore = await pool.query(
      `SELECT id, user_code, first_name, last_name, email, role, password_hash, pin_hash,
              must_change_password, school_id, updated_at
       FROM users WHERE user_code = $1`,
      [colliding.next_code],
    );
    assert.equal(reservedBefore.rowCount, 1);
    assert.equal(reservedBefore.rows[0].role, "SECRETARY");

    const beforeCollision = {
      students: await countStudents(pool, "CD-2026-0001"),
      enrollments: await countEnrollments(pool, "CD-2026-0001"),
      users: await countUsers(pool, "CD-2026-0001"),
    };
    await assert.rejects(
      () =>
        studentsRepo.enroll(activeClass.classCode, "CD-2026-0001", {
          firstName: "Collision",
          lastName: "Eleve",
        }),
      (error) => String(error.code) === "23505",
    );
    assert.equal(await countStudents(pool, "CD-2026-0001"), beforeCollision.students);
    assert.equal(await countEnrollments(pool, "CD-2026-0001"), beforeCollision.enrollments);
    assert.equal(await countUsers(pool, "CD-2026-0001"), beforeCollision.users);

    const reservedAfter = await pool.query(
      `SELECT id, user_code, first_name, last_name, email, role, password_hash, pin_hash,
              must_change_password, school_id, updated_at
       FROM users WHERE user_code = $1`,
      [colliding.next_code],
    );
    assert.deepEqual(reservedAfter.rows[0], reservedBefore.rows[0], "user préexistant inchangé");
    const linkedStudent = await pool.query(
      `SELECT id FROM students WHERE student_code = $1`,
      [colliding.next_code],
    );
    assert.equal(linkedStudent.rowCount, 0, "aucun élève lié implicitement au compte préexistant");

    console.log("classStudentsRepository.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
