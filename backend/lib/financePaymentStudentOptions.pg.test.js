"use strict";

/**
 * P1 — GET payment-student-options doit suivre le roster canonique
 * `active` + `enrolled` (ROSTER_ENROLLMENT_SQL), pas seulement `active`.
 *
 * Reproduction préprod : Esther OKITO visible en Présences (inscription
 * `enrolled`) mais absente du sélecteur d'encaissement.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createFinancePgStore } = require("../db/financePgStore");
const { createClassStudentsRepository } = require("../db/classStudentsRepository");
const { createTxAdapter } = require("../db/txAdapter");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(
  process.env.SOMAFRIK_FINANCE_PAYMENT_OPTIONS_IT_DATABASE ?? "somafrik_finance_payment_options_it",
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

function createRepo(pool) {
  return {
    async query(sql, params = []) {
      return pool.query(sql, params);
    },
    async one(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows[0] ?? null;
    },
    async all(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows;
    },
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(createTxAdapter(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw error;
      } finally {
        client.release();
      }
    },
    createTxScope(tx) {
      return {
        query: (sql, params) => tx.query(sql, params),
        one: (sql, params) => tx.one(sql, params),
        all: (sql, params) => tx.all(sql, params),
      };
    },
    async getSchoolByCode(code) {
      const result = await pool.query(
        `SELECT id, school_code, login_code, country_id, name
         FROM schools
         WHERE school_code = $1 OR upper(btrim(login_code)) = $1
         LIMIT 1`,
        [String(code ?? "").trim().toUpperCase()],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        code: row.school_code,
        loginCode: row.login_code,
        country_id: row.country_id,
        name: row.name,
      };
    },
  };
}

function codesOf(options) {
  return options.map((row) => row.studentCode);
}

async function insertStudent(pool, { schoolId, studentCode, firstName, lastName, status = "active" }) {
  const result = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [schoolId, studentCode, firstName, lastName, status],
  );
  return result.rows[0].id;
}

async function insertEnrollment(pool, { schoolId, studentId, classId, yearId, status }) {
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [schoolId, studentId, classId, yearId, status],
  );
}

async function main() {
  const pgStoreSrc = fs.readFileSync(path.join(__dirname, "../db/financePgStore.js"), "utf8");
  const listFn = pgStoreSrc.slice(
    pgStoreSrc.indexOf("async listPaymentStudentOptions"),
    pgStoreSrc.indexOf("async listSchoolPaymentMethods"),
  );
  assert.match(
    listFn,
    /ROSTER_ENROLLMENT_SQL/,
    "listPaymentStudentOptions doit réutiliser ROSTER_ENROLLMENT_SQL",
  );
  assert.doesNotMatch(
    listFn,
    /lower\(btrim\(e\.status\)\) = 'active'/,
    "listPaymentStudentOptions ne doit plus filtrer uniquement active",
  );

  if (!DATABASE_URL) {
    console.log("financePaymentStudentOptions.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'CD-2026-0001', 'Lycée A', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, 'BI-2026-0001', 'BI-2026-0001', 'Lycée B', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const yearA = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const yearA2 = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2026-2027', 'open') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const yearB = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [schoolB.rows[0].id],
    );
    const class6A = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6A', '6ème A', 'active') RETURNING id`,
      [schoolA.rows[0].id, yearA.rows[0].id],
    );
    const class1PA = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, '1PA', '1ère Primaire A', 'active') RETURNING id`,
      [schoolA.rows[0].id, yearA.rows[0].id],
    );
    const class5B = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-5B', '5ème B', 'active') RETURNING id`,
      [schoolA.rows[0].id, yearA2.rows[0].id],
    );
    const classB1 = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-B1', '1ère B', 'active') RETURNING id`,
      [schoolB.rows[0].id, yearB.rows[0].id],
    );

    const awaId = await insertStudent(pool, {
      schoolId: schoolA.rows[0].id,
      studentCode: "CD-2026-0001-STU-AWA",
      firstName: "Awa",
      lastName: "Diop",
    });
    await insertEnrollment(pool, {
      schoolId: schoolA.rows[0].id,
      studentId: awaId,
      classId: class6A.rows[0].id,
      yearId: yearA.rows[0].id,
      status: "active",
    });

    const estherId = await insertStudent(pool, {
      schoolId: schoolA.rows[0].id,
      studentCode: "CD-2026-0001-STU-ESTHER",
      firstName: "Esther",
      lastName: "OKITO",
    });
    await insertEnrollment(pool, {
      schoolId: schoolA.rows[0].id,
      studentId: estherId,
      classId: class1PA.rows[0].id,
      yearId: yearA.rows[0].id,
      status: "enrolled",
    });

    const enrolledUpperId = await insertStudent(pool, {
      schoolId: schoolA.rows[0].id,
      studentCode: "CD-2026-0001-STU-ENROLLED",
      firstName: "Noah",
      lastName: "Upper",
    });
    await insertEnrollment(pool, {
      schoolId: schoolA.rows[0].id,
      studentId: enrolledUpperId,
      classId: class6A.rows[0].id,
      yearId: yearA.rows[0].id,
      status: "ENROLLED",
    });

    for (const [code, firstName, lastName, status] of [
      ["CD-2026-0001-STU-INACTIVE", "Lina", "Inactive", "inactive"],
      ["CD-2026-0001-STU-ARCHIVED", "Marc", "Archived", "archived"],
      ["CD-2026-0001-STU-DELETED", "Dora", "Deleted", "deleted"],
      ["CD-2026-0001-STU-APPROVED", "Paul", "Approved", "approved"],
    ]) {
      const studentId = await insertStudent(pool, {
        schoolId: schoolA.rows[0].id,
        studentCode: code,
        firstName,
        lastName,
      });
      await insertEnrollment(pool, {
        schoolId: schoolA.rows[0].id,
        studentId,
        classId: class6A.rows[0].id,
        yearId: yearA.rows[0].id,
        status,
      });
    }

    const koffiId = await insertStudent(pool, {
      schoolId: schoolA.rows[0].id,
      studentCode: "CD-2026-0001-STU-KOFFI",
      firstName: "Koffi",
      lastName: "Multi",
    });
    await insertEnrollment(pool, {
      schoolId: schoolA.rows[0].id,
      studentId: koffiId,
      classId: class6A.rows[0].id,
      yearId: yearA.rows[0].id,
      status: "transferred",
    });
    await insertEnrollment(pool, {
      schoolId: schoolA.rows[0].id,
      studentId: koffiId,
      classId: class5B.rows[0].id,
      yearId: yearA2.rows[0].id,
      status: "enrolled",
    });

    const jeanId = await insertStudent(pool, {
      schoolId: schoolB.rows[0].id,
      studentCode: "BI-2026-0001-STU-JEAN",
      firstName: "Jean",
      lastName: "Other",
    });
    await insertEnrollment(pool, {
      schoolId: schoolB.rows[0].id,
      studentId: jeanId,
      classId: classB1.rows[0].id,
      yearId: yearB.rows[0].id,
      status: "active",
    });

    const repo = createRepo(pool);
    const store = createFinancePgStore(repo);
    const studentsRepo = createClassStudentsRepository(repo);
    const adminA = {
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      financeLoginCode: "CD-2026-0001",
      schoolId: schoolA.rows[0].id,
      firstName: "Admin",
      lastName: "A",
      sub: "USR-FIN-OPTIONS-A",
    };
    const adminB = {
      role: "Admin School",
      schoolCode: "BI-2026-0001",
      financeLoginCode: "BI-2026-0001",
      schoolId: schoolB.rows[0].id,
      firstName: "Admin",
      lastName: "B",
      sub: "USR-FIN-OPTIONS-B",
    };

    const optionsA = await store.listPaymentStudentOptions(adminA);
    const codesA = codesOf(optionsA);

    assert.equal(
      optionsA.filter((row) => row.studentCode === "CD-2026-0001-STU-AWA").length,
      1,
      "inscription active → élève présent une fois",
    );
    assert.equal(
      optionsA.filter((row) => row.studentCode === "CD-2026-0001-STU-ESTHER").length,
      1,
      "inscription enrolled → élève présent une fois (P1 Esther)",
    );
    assert.equal(
      optionsA.filter((row) => row.studentCode === "CD-2026-0001-STU-ENROLLED").length,
      1,
      "inscription ENROLLED → élève présent",
    );

    const esther = optionsA.find((row) => row.studentCode === "CD-2026-0001-STU-ESTHER");
    assert.equal(esther.firstName, "Esther");
    assert.equal(esther.lastName, "OKITO");
    assert.equal(esther.classCode, "1PA");
    assert.equal(esther.className, "1ère Primaire A");
    assert.equal(esther.classes.length, 1);

    for (const excluded of [
      "CD-2026-0001-STU-INACTIVE",
      "CD-2026-0001-STU-ARCHIVED",
      "CD-2026-0001-STU-DELETED",
      "CD-2026-0001-STU-APPROVED",
      "BI-2026-0001-STU-JEAN",
    ]) {
      assert.equal(codesA.includes(excluded), false, `${excluded} doit être exclu du roster Finance A`);
    }

    const koffiHits = optionsA.filter((row) => row.studentCode === "CD-2026-0001-STU-KOFFI");
    assert.equal(koffiHits.length, 1, "historique + enrolled courant → un seul option métier");
    assert.equal(koffiHits[0].classCode, "CLS-5B");
    assert.equal(koffiHits[0].classes.length, 1);
    assert.equal(
      koffiHits[0].classes.some((klass) => klass.classCode === "CLS-6A"),
      false,
      "l'inscription transferred historique n'apparaît pas",
    );

    const optionsB = await store.listPaymentStudentOptions(adminB);
    assert.equal(optionsB.length, 1);
    assert.equal(optionsB[0].studentCode, "BI-2026-0001-STU-JEAN");
    assert.equal(optionsB.some((row) => String(row.studentCode).startsWith("CD-2026-0001")), false);

    const presenceRoster = await studentsRepo.listByClassCode("1PA", "CD-2026-0001");
    assert.equal(
      presenceRoster.some((row) => row.studentCode === "CD-2026-0001-STU-ESTHER" && row.lastName === "OKITO"),
      true,
      "Esther visible dans la projection classe / présence",
    );
    assert.equal(
      optionsA.some((row) => row.studentCode === "CD-2026-0001-STU-ESTHER"),
      true,
      "Esther aussi retournée par payment-student-options",
    );

    console.log("financePaymentStudentOptions.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
