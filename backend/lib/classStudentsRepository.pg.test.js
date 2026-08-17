"use strict";

/**
 * Intégration PostgreSQL réelle — inscription élève depuis une classe :
 * création + relecture, isolation inter-établissements, classe inactive,
 * année fermée, rollback transactionnel, concurrence matricules.
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createClassesRepository } = require("../db/classesRepository");
const { createClassStudentsRepository } = require("../db/classStudentsRepository");
const { createTxAdapter } = require("../db/txAdapter");
const {
  CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL,
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
  `);

  await pool.query(
    "TRUNCATE enrollments, students, classes, academic_years, schools, countries CASCADE",
  );
  await pool.query(NORMALIZE_CLASSES_STATUS_SQL);
  await pool.query(CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL);
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
    `INSERT INTO schools (country_id, school_code, name)
     VALUES
       ($1, 'CD-2026-0001', 'Institut Nuru'),
       ($1, 'CD-2026-0002', 'Lycée Lumumba'),
       ($2, 'BI-2026-0001', 'Lycée Bujumbura')`,
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
        `SELECT id, school_code, name FROM schools WHERE school_code = $1 LIMIT 1`,
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

function createRollbackTestRepository(baseDb) {
  return createClassStudentsRepository({
    ...baseDb,
    withTransaction: async (fn) =>
      baseDb.withTransaction(async (tx) => fn(wrapTxFailingEnrollment(tx))),
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

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP classStudentsRepository.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, ENROLLMENT_IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await setupFixture(pool);
    const db = createDbAdapter(pool);
    const classesRepo = createClassesRepository(db);
    const studentsRepo = createClassStudentsRepository(db);

    const activeClass = await classesRepo.create(
      {
        name: "6ème A",
        academicYearName: "2025-2026",
        status: "active",
      },
      "CD-2026-0001",
    );
    const activeClassOtherSchool = await classesRepo.create(
      {
        name: "5ème B",
        academicYearName: "2025-2026",
        status: "active",
      },
      "CD-2026-0002",
    );
    const inactiveClass = await classesRepo.create(
      {
        name: "6ème Inactive",
        academicYearName: "2025-2026",
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

    const rollbackRepo = createRollbackTestRepository(db);
    const beforeRollback = await countStudents(pool, "CD-2026-0001");
    await assert.rejects(
      () =>
        rollbackRepo.enroll(activeClass.classCode, "CD-2026-0001", {
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

    const enrolled = await studentsRepo.enroll(activeClass.classCode, "CD-2026-0001", {
      firstName: "Awa",
      lastName: "Diop",
      gender: "Féminin",
      birthDate: "2012-04-12",
    });
    assert.match(enrolled.studentCode, /^CD-IN-EL-\d{2}-\d{3}$/);
    assert.equal(enrolled.matricule, enrolled.studentCode);
    assert.equal(enrolled.loginCode, enrolled.studentCode);

    const listed = await studentsRepo.listByClassCode(activeClass.classCode, "CD-2026-0001");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].studentCode, enrolled.studentCode);

    const reread = await studentsRepo.getByStudentCode(enrolled.studentCode, "CD-2026-0001");
    assert.equal(reread.classCode, activeClass.classCode);

    const enrolledOtherSchool = await studentsRepo.enroll(
      activeClassOtherSchool.classCode,
      "CD-2026-0002",
      { firstName: "Ibra", lastName: "Fall" },
    );
    assert.match(enrolledOtherSchool.studentCode, /^CD-LL-EL-\d{2}-\d{3}$/);
    assert.notEqual(enrolled.studentCode, enrolledOtherSchool.studentCode);

    const activeClassBiSameNumber = await classesRepo.create(
      {
        name: "6ème A BI",
        academicYearName: "2025-2026",
        status: "active",
      },
      "BI-2026-0001",
    );
    const enrolledBiSameEstablishment = await studentsRepo.enroll(
      activeClassBiSameNumber.classCode,
      "BI-2026-0001",
      { firstName: "Grace", lastName: "Nkurunziza" },
    );
    assert.match(enrolledBiSameEstablishment.studentCode, /^BI-LB-EL-\d{2}-\d{3}$/);
    assert.notEqual(
      enrolled.studentCode,
      enrolledBiSameEstablishment.studentCode,
      "CD-2026-0001 et BI-2026-0001 ne doivent pas partager le même matricule",
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
    const codes = new Set(concurrent.map((row) => row.studentCode));
    assert.equal(codes.size, 4);

    await assert.rejects(
      () =>
        studentsRepo.enroll(activeClass.classCode, "CD-2026-0001", {
          firstName: "Hack",
          lastName: "Scope",
          classCode: activeClassOtherSchool.classCode,
        }),
      (error) => error.statusCode === 400,
    );

    console.log("classStudentsRepository.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
