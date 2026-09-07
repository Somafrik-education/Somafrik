"use strict";

/**
 * Parité PostgreSQL de FIN-CALC-RED-001 (Oscar 1+1).
 * Si DATABASE_URL est absent : SKIP explicite (pas un vert artificiel du scénario).
 * La CI Finance qui possède DATABASE_URL doit exécuter ce fichier.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createFinancePgStore } = require("../db/financePgStore");
const { FINANCE_SCHEMA_SQL } = require("../db/financeSchema");
const { createTxAdapter } = require("../db/txAdapter");
const { money } = require("./financeManagement");
const { PARTIAL_STATUS } = require("./financeUnallocatedCash");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_FINANCE_CALC_RED_IT_DATABASE ?? "somafrik_finance_calc_red_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
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

describe("FIN-CALC-RED PostgreSQL", { skip: !DATABASE_URL }, () => {
  it("FIN-CALC-RED-001 PG overpayment 1 CDF settles obligation and preserves 1 CDF unallocated", async () => {
    const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
    const pool = new Pool({ connectionString: isolatedUrl });
    try {
      await pool.query("DROP SCHEMA public CASCADE");
      await pool.query("CREATE SCHEMA public");
      const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
      await pool.query(schema);
      await pool.query(FINANCE_SCHEMA_SQL);

      const country = await pool.query(
        `INSERT INTO countries (name, iso_code, phone_code, currency)
         VALUES ('RDC','CD','+243','CDF') RETURNING id`,
      );
      const school = await pool.query(
        `INSERT INTO schools (country_id, school_code, login_code, name, status)
         VALUES ($1,'CD-IN-26-001','CD-IN-26-001','Oscar School','active') RETURNING id`,
        [country.rows[0].id],
      );
      const year = await pool.query(
        `INSERT INTO academic_years (school_id,name,status,is_current)
         VALUES ($1,'2025-2026','open',true) RETURNING id`,
        [school.rows[0].id],
      );
      const klass = await pool.query(
        `INSERT INTO classes (school_id,academic_year_id,class_code,name,status)
         VALUES ($1,$2,'CLS-OSC','6ème A','active') RETURNING id`,
        [school.rows[0].id, year.rows[0].id],
      );
      const student = await pool.query(
        `INSERT INTO students (school_id,student_code,first_name,last_name)
         VALUES ($1,'CD-IN-26-001-STU-OSCAR','Oscar','Mukwege') RETURNING id`,
        [school.rows[0].id],
      );
      await pool.query(
        `INSERT INTO enrollments (school_id,student_id,class_id,academic_year_id,enrollment_date,class_effective_date,status)
         VALUES ($1,$2,$3,$4,'2026-09-01','2026-09-01','active')`,
        [school.rows[0].id, student.rows[0].id, klass.rows[0].id, year.rows[0].id],
      );
      const user = await pool.query(
        `INSERT INTO users (school_id,user_code,first_name,last_name,email,role,status)
         VALUES ($1,'USR-OSC','Admin','Oscar','admin-oscar@somafrik.test','SCHOOL_ADMIN','active') RETURNING id`,
        [school.rows[0].id],
      );

      const store = createFinancePgStore(createRepo(pool));
      const admin = {
        role: "Admin School",
        schoolCode: "CD-IN-26-001",
        firstName: "Admin",
        lastName: "Oscar",
        sub: user.rows[0].id,
        permissions: ["Paiements:UPDATE"],
      };

      const grid = await store.upsertFinanceFeeGrid(
        {
          classId: klass.rows[0].id,
          className: "6ème A",
          academicYear: "2025-2026",
          currency: "CDF",
          status: "Active",
          items: [
            {
              feeType: "Scolarité",
              label: "Frais scolaire — Septembre",
              amount: 1,
              periodLabel: "Septembre",
              status: "Actif",
            },
          ],
        },
        admin,
      );
      await store.setFinanceFeeGridStatus(grid.id, "Active", admin);
      await store.applyFinanceFeeGrid(grid.id, admin);
      const fees = await store.listFinanceStudentFees(admin);
      const fee = fees.find((row) => String(row.studentId).includes("OSCAR")) || fees[0];
      assert.equal(money(fee.balance), 1);

      const payment = await store.createSchoolPayment(
        {
          studentId: "CD-IN-26-001-STU-OSCAR",
          items: [{ obligationId: fee.id, amount: 2 }],
          method: "Espèces",
          date: "2026-09-07",
        },
        admin,
      );

      assert.equal(money(payment.amount), 2);
      assert.equal(money(payment.allocatedAmount), 1);
      assert.equal(money(payment.unallocatedAmount), 1);
      assert.equal(money(payment.allocatedAmount) + money(payment.unallocatedAmount), money(payment.amount));

      const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === fee.id);
      assert.equal(money(after.balance), 0);
      assert.equal(after.status, "Payé");

      const persisted = await pool.query(
        `SELECT amount_paid, balance, status FROM student_fee_obligations WHERE id = $1`,
        [after.dbId || after.id],
      );
      const summed = await pool.query(
        `SELECT COALESCE(SUM(amount),0)::numeric AS allocated
         FROM payment_allocations WHERE obligation_id = $1 AND reversed_at IS NULL`,
        [after.dbId || after.id],
      );
      assert.equal(Number(persisted.rows[0].amount_paid), Number(summed.rows[0].allocated));
      assert.equal(Number(persisted.rows[0].balance), 0);
      assert.equal(String(persisted.rows[0].status), "Payé");

      assert.notEqual(payment.status, PARTIAL_STATUS);
      assert.notMatch(String(payment.status), /partiel/i);
    } finally {
      await pool.end();
    }
  });
});
