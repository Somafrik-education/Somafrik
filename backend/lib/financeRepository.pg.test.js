"use strict";

/**
 * Intégration PostgreSQL — paiements atomiques, rollback, isolation, concurrence grilles.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createFinancePgStore } = require("../db/financePgStore");
const { FINANCE_SCHEMA_SQL } = require("../db/financeSchema");
const { FINANCE_ERROR } = require("./financeManagement");
const { createTxAdapter } = require("../db/txAdapter");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const FINANCE_IT_DATABASE = String(process.env.SOMAFRIK_FINANCE_IT_DATABASE ?? "somafrik_finance_it")
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
        const tx = createTxAdapter(client);
        const result = await fn(tx);
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
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("financeRepository.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, FINANCE_IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(FINANCE_SCHEMA_SQL);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'Lycée A', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'BI-2026-0001', 'Lycée B', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const klass = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6A', '6ème A', 'active') RETURNING id`,
      [schoolA.rows[0].id, year.rows[0].id],
    );
    const student = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, 'CD-2026-0001-STU-0001', 'Awa', 'Diop') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [schoolA.rows[0].id, student.rows[0].id, klass.rows[0].id, year.rows[0].id],
    );
    await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, 'BI-2026-0001-STU-0001', 'Jean', 'Other')`,
      [schoolB.rows[0].id],
    );

    const repo = createRepo(pool);
    const store = createFinancePgStore(repo);
    const admin = { role: "Admin School", schoolCode: "CD-2026-0001", firstName: "Admin", lastName: "A" };

    const grid = await store.upsertFinanceFeeGrid(
      {
        className: "6ème A",
        academicYear: "2025-2026",
        currency: "CDF",
        status: "Active",
        items: [{ feeType: "Inscription", label: "Inscription", amount: 40_000, dueDate: "2026-01-01", status: "Actif" }],
      },
      admin,
    );
    await store.setFinanceFeeGridStatus(grid.id, "Active", admin);

    const [first, second] = await Promise.all([
      store.applyFinanceFeeGrid(grid.id, admin),
      store.applyFinanceFeeGrid(grid.id, admin),
    ]);
    const createdTotal = first.created + second.created;
    const skippedTotal = first.skipped + second.skipped;
    assert.equal(createdTotal, 1);
    assert.equal(skippedTotal, 1);
    const fees = await store.listFinanceStudentFees();
    assert.equal(fees.length, 1);

    const payment = await store.createSchoolPayment(
      {
        studentId: "CD-2026-0001-STU-0001",
        feeType: "Inscription",
        amount: 40_000,
        method: "Espèces",
        date: "2026-08-13",
        schoolCode: "BI-2026-0001",
      },
      admin,
    );
    assert.match(payment.reference, /^CD-2026-0001-\d{4}-PAY-/);
    const paid = (await store.listFinanceStudentFees())[0];
    assert.equal(Number(paid.balance), 0);

    const cancelled = await store.cancelSchoolPayment(payment.reference, "Saisie erronée", admin);
    assert.equal(cancelled.status, "Annulé");
    const restored = (await store.listFinanceStudentFees())[0];
    assert.equal(Number(restored.balance), 40_000);

    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "CD-2026-0001-STU-0001",
            feeType: "Inscription",
            amount: 10,
            method: "Espèces",
            date: "2026-08-13",
          },
          { role: "Admin School", schoolCode: "BI-2026-0001" },
        ),
      (error) => error.code === FINANCE_ERROR.STUDENT_NOT_FOUND || error.code === FINANCE_ERROR.TENANT_MISMATCH,
    );

    console.log("financeRepository.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
