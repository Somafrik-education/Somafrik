"use strict";

/**
 * Régression P0 inscription élève après #243 — schéma historique préprod.
 *
 * Fixture : établissement + CD-IN-EL-26-001/002 + users EL + staff
 * CD-IN-OE-26-00001 (Olivier Ekanga) + triggers/CHECK 20260823.
 * Puis boot actuel (ensureStudentGeneralIdentityPg) et inscription ESTHER OKITO.
 */

const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { ensureStudentLifecyclePgSchema } = require("../db/studentLifecyclePg");
const { ensureStudentGeneralIdentityPg } = require("../db/studentGeneralIdentityPg");
const { createClassStudentsRepository } = require("../db/classStudentsRepository");
const { createTxAdapter } = require("../db/txAdapter");
const { studentIdentityInitials } = require("./studentCanonicalIdentifier");
const { PARENT_PHONE_INVALID_MESSAGE } = require("./parentPhone");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const UPGRADE_IT_DATABASE = String(process.env.SOMAFRIK_STUDENT_ENROLL_UPGRADE_IT_DATABASE ?? "somafrik_student_enroll_upgrade_it")
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
    if (existing.rowCount) {
      await pool.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await pool.query(`DROP DATABASE ${databaseName}`);
    }
    await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function seedHistoricalPreprod(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('République Démocratique du Congo', 'CD', '+243', 'CDF')
     RETURNING id`,
  );
  const countryId = country.rows[0].id;
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'CD-2026-0001', 'Institut Nuru', 'active')
     RETURNING id, short_code, login_code`,
    [countryId],
  );
  const schoolId = school.rows[0].id;
  assert.equal(school.rows[0].short_code, "IN");
  assert.match(String(school.rows[0].login_code), /^CD-IN-\d{2}-\d{3}$/);

  const year = await pool.query(
    `INSERT INTO academic_years (school_id, name, is_current, status)
     VALUES ($1, '2025-2026', TRUE, 'open')
     RETURNING id`,
    [schoolId],
  );
  const level = await pool.query(
    `INSERT INTO education_levels (country_id, level_code, name, status)
     VALUES ($1, '6eme', '6ème', 'active')
     RETURNING id`,
    [countryId],
  );
  const group = await pool.query(
    `INSERT INTO education_class_groups (country_id, group_code, name, status)
     VALUES ($1, 'A', 'A', 'active')
     RETURNING id`,
    [countryId],
  );
  await pool.query(
    `INSERT INTO school_levels (school_id, level_id, status) VALUES ($1, $2, 'active')
     ON CONFLICT DO NOTHING`,
    [schoolId, level.rows[0].id],
  );
  await pool.query(
    `INSERT INTO school_class_groups (school_id, group_id, status) VALUES ($1, $2, 'active')
     ON CONFLICT DO NOTHING`,
    [schoolId, group.rows[0].id],
  );
  await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status, level_id, group_id)
     VALUES ($1, $2, 'CLS-6A-REPRO', '6ème A', 'active', $3, $4)`,
    [schoolId, year.rows[0].id, level.rows[0].id, group.rows[0].id],
  );

  await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, gender, status)
     VALUES
       ($1, 'CD-IN-EL-26-001', 'Jean', 'Dupont', 'Masculin', 'active'),
       ($1, 'CD-IN-EL-26-002', 'Marie', 'Martin', 'Féminin', 'active')`,
    [schoolId],
  );
  await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, role, status)
     VALUES
       ($1, 'CD-IN-EL-26-001', 'Jean', 'Dupont', '', '', 'STUDENT', 'active'),
       ($1, 'CD-IN-EL-26-002', 'Marie', 'Martin', '', '', 'STUDENT', 'active')`,
    [schoolId],
  );
  const staff = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, role, status)
     VALUES ($1, 'STAFF-ADMIN', 'Olivier', 'Ekanga', 'admin@nuru.test', '+243820000000', 'SCHOOL_ADMIN', 'active')
     RETURNING identity_code, login_code, identity_initials`,
    [schoolId],
  );
  assert.equal(staff.rows[0].identity_code, "CD-IN-OE-26-00001");
  assert.equal(staff.rows[0].identity_initials, "OE");
  const loginCode = String(school.rows[0].login_code || "").trim();
  assert.match(loginCode, /^CD-IN-\d{2}-\d{3}$/);
  return { schoolId, loginCode, staffIdentity: staff.rows[0].identity_code };
}

function createDbAdapter(pool, repo) {
  return {
    one: (sql, params) => repo.one(sql, params),
    all: (sql, params) => repo.all(sql, params),
    query: (sql, params) => repo.query(sql, params),
    getSchoolByCode: (code) => repo.getSchoolByCode(code),
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

async function counts(pool, schoolId) {
  const students = await pool.query(`SELECT COUNT(*)::int AS n FROM students WHERE school_id = $1`, [schoolId]);
  const users = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE school_id = $1`, [schoolId]);
  const enrollments = await pool.query(`SELECT COUNT(*)::int AS n FROM enrollments WHERE school_id = $1`, [schoolId]);
  return {
    students: students.rows[0].n,
    users: users.rows[0].n,
    enrollments: enrollments.rows[0].n,
  };
}

function requireDatabaseUrl() {
  if (DATABASE_URL) return;
  if (process.env.GITHUB_ACTIONS || process.env.CI) {
    throw new Error("DATABASE_URL obligatoire dans CI/Security — pas de SKIP");
  }
  console.log("SKIP studentEnrollmentUpgrade.pg.test.js: DATABASE_URL absent");
  process.exit(0);
}

async function installLegacyCounterV1(pool, schoolId) {
  await pool.query(`
    CREATE TABLE student_general_code_counters (
      school_id UUID NOT NULL,
      creation_year INTEGER NOT NULL,
      last_value INTEGER NOT NULL,
      PRIMARY KEY (school_id, creation_year)
    )
  `);
  await pool.query(
    `INSERT INTO student_general_code_counters (school_id, creation_year, last_value)
     VALUES ($1, 2025, 18), ($1, 2026, 27)`,
    [schoolId],
  );
}

function pgIdentArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
  }
  return [];
}

async function inspectCounterPk(pool) {
  const pk = await pool.query(`
    SELECT array_agg(a.attname ORDER BY k.n) AS cols
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, n) ON TRUE
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = 'public'
      AND t.relname = 'student_general_code_counters'
      AND c.contype = 'p'
    GROUP BY c.conname
  `);
  const yearCol = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_attribute
      WHERE attrelid = 'public.student_general_code_counters'::regclass
        AND attname = 'creation_year'
        AND attnum > 0
        AND NOT attisdropped
    ) AS present
  `);
  return {
    pk: pgIdentArray(pk.rows[0]?.cols),
    hasCreationYear: yearCol.rows[0].present,
  };
}

async function main() {
  requireDatabaseUrl();

  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, UPGRADE_IT_DATABASE);
  const repo = createPostgresRepository(isolatedUrl);
  const pool = repo.pool;
  try {
    await repo.init();
    const beforeGeneral = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conname = 'students_canonical_identifier_format_check'`,
    );
    assert.match(beforeGeneral.rows[0].def, /EL-\[0-9\]\{2\}-\[0-9\]\{3\}/);
    assert.doesNotMatch(beforeGeneral.rows[0].def, /\[0-9\]\{5\}/);

    const seeded = await seedHistoricalPreprod(pool);
    const legacy = await pool.query(
      `SELECT student_code FROM students ORDER BY student_code`,
    );
    assert.deepEqual(
      legacy.rows.map((row) => row.student_code),
      ["CD-IN-EL-26-001", "CD-IN-EL-26-002"],
    );

    await installLegacyCounterV1(pool, seeded.schoolId);
    const beforeCounter = await inspectCounterPk(pool);
    assert.equal(beforeCounter.hasCreationYear, true, "preuve ancienne colonne creation_year");
    assert.deepEqual(beforeCounter.pk, ["school_id", "creation_year"], "preuve ancienne PK composite");

    await ensureStudentLifecyclePgSchema(repo);
    await ensureStudentGeneralIdentityPg(repo);
    await ensureStudentGeneralIdentityPg(repo);

    const afterCounter = await inspectCounterPk(pool);
    assert.equal(afterCounter.hasCreationYear, false, "creation_year absent après migration");
    assert.deepEqual(afterCounter.pk, ["school_id"], "PK canonique school_id");
    const consolidated = await pool.query(
      `SELECT school_id, last_value FROM student_general_code_counters ORDER BY school_id`,
    );
    assert.equal(consolidated.rowCount, 1, "aucune ligne dupliquée par school_id");
    assert.ok(consolidated.rows[0].last_value >= 27, "MAX(last_value) historique conservé (18/27 → 27)");

    const afterGeneral = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conname = 'students_canonical_identifier_format_check'`,
    );
    assert.match(afterGeneral.rows[0].def, /\[0-9\]\{5\}/);
    assert.match(afterGeneral.rows[0].def, /EL-\[0-9\]\{2\}-\[0-9\]\{3\}/);
    const fn = await pool.query(
      `SELECT pg_get_functiondef('somafrik_assign_permanent_student_identity'::regproc) AS def`,
    );
    assert.match(fn.rows[0].def, /somafrik_student_identity_taken/);
    assert.doesNotMatch(fn.rows[0].def, /identity_initials := 'EL'/);

    const beforePhone = await counts(pool, seeded.schoolId);
    await assert.rejects(
      () =>
        repo.enrollStudentInClass("CLS-6A-REPRO", seeded.loginCode, {
          firstName: "ESTHER",
          lastName: "OKITO",
          parentPhone: "Baudouin OKITO",
        }),
      (error) => error.statusCode === 400 && String(error.message) === PARENT_PHONE_INVALID_MESSAGE,
    );
    assert.deepEqual(await counts(pool, seeded.schoolId), beforePhone, "400 téléphone : aucune donnée partielle");

    const created = await repo.enrollStudentInClass("CLS-6A-REPRO", seeded.loginCode, {
      firstName: "ESTHER",
      lastName: "OKITO",
      gender: "Féminin",
      birthDate: "2010-03-05",
    });
    const studentCode = created.student.studentCode;
    const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
    const expectedInitials = studentIdentityInitials("OKITO", "ESTHER");
    assert.equal(expectedInitials, "OE");
    assert.match(studentCode, new RegExp(`^CD-IN-OE-${yy}-\\d{5}$`));
    assert.notEqual(studentCode, seeded.staffIdentity);
    assert.equal(Number(studentCode.slice(-5)), 28, "séquence continue après MAX historique 27");
    assert.equal(created.credentials.login, studentCode);
    const afterEnroll = await pool.query(
      `SELECT last_value FROM student_general_code_counters WHERE school_id = $1`,
      [seeded.schoolId],
    );
    assert.equal(afterEnroll.rows[0].last_value, 28);

    const aligned = await pool.query(
      `SELECT
         st.student_code, st.login_code, st.identity_code, st.identity_initials,
         u.user_code, u.login_code AS user_login, u.identity_code AS user_identity,
         u.identity_initials AS user_initials, e.status AS enrollment_status
       FROM students st
       JOIN users u ON u.school_id = st.school_id AND u.user_code = st.student_code
       JOIN enrollments e ON e.student_id = st.id AND e.status = 'active'
       WHERE st.student_code = $1`,
      [studentCode],
    );
    assert.equal(aligned.rowCount, 1);
    const row = aligned.rows[0];
    assert.equal(row.student_code, row.login_code);
    assert.equal(row.student_code, row.identity_code);
    assert.equal(row.student_code, row.user_code);
    assert.equal(row.student_code, row.user_login);
    assert.equal(row.student_code, row.user_identity);
    assert.equal(row.identity_initials, "OE");
    assert.equal(row.user_initials, "OE");
    assert.equal(row.enrollment_status, "active");

    const stillLegacy = await pool.query(
      `SELECT COUNT(*)::int AS n FROM students
       WHERE student_code IN ('CD-IN-EL-26-001', 'CD-IN-EL-26-002')`,
    );
    assert.equal(stillLegacy.rows[0].n, 2);

    const diop = await repo.enrollStudentInClass("CLS-6A-REPRO", seeded.loginCode, {
      firstName: "Awa",
      lastName: "Diop",
      parentPhone: "+243 820 000 222",
    });
    assert.match(diop.student.studentCode, new RegExp(`^CD-IN-DA-${yy}-\\d{5}$`));

    const plus33 = await repo.enrollStudentInClass("CLS-6A-REPRO", seeded.loginCode, {
      firstName: "Léa",
      lastName: "Martin",
      parentPhone: "+33 6 12 34 56 78",
    });
    assert.equal(plus33.student.parentPhone, "+33 6 12 34 56 78");

    const emptyPhone = await repo.enrollStudentInClass("CLS-6A-REPRO", seeded.loginCode, {
      firstName: "Nia",
      lastName: "Kone",
    });
    assert.ok(emptyPhone.student.studentCode);

    const beforeRollback = await counts(pool, seeded.schoolId);
    const failing = createClassStudentsRepository({
      ...createDbAdapter(pool, repo),
      async withTransaction(fn) {
        const client = await pool.connect();
        const tx = createTxAdapter(client);
        const wrapped = {
          ...tx,
          async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
            if (normalized.startsWith("INSERT INTO USERS")) {
              const error = new Error("forced users insert failure");
              error.code = "23505";
              error.constraint = "users_identity_code_unique";
              throw error;
            }
            return tx.query(sql, params);
          },
        };
        try {
          await client.query("BEGIN");
          const result = await fn(wrapped);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    });
    await assert.rejects(
      () =>
        failing.enroll("CLS-6A-REPRO", seeded.loginCode, {
          firstName: "Rollback",
          lastName: "Atomique",
        }),
      (error) => error.statusCode === 409,
    );
    assert.deepEqual(
      await counts(pool, seeded.schoolId),
      beforeRollback,
      "rollback : aucun élève/user/enrollment partiel",
    );

    console.log("studentEnrollmentUpgrade.pg.test.js: OK", studentCode);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
