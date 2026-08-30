"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createFinancePgStore } = require("../db/financePgStore");
const { FINANCE_SCHEMA_SQL } = require("../db/financeSchema");
const { createTxAdapter } = require("../db/txAdapter");
const { F4_ERROR } = require("./financeService");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const DB_NAME = String(process.env.SOMAFRIK_FINANCE_F4_IT_DATABASE || "somafrik_finance_f4_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function ensureDb(url, name) {
  const pool = new Pool({ connectionString: withDatabaseName(url, "postgres") });
  try {
    const found = await pool.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]);
    if (!found.rowCount) await pool.query(`CREATE DATABASE ${name}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(url, name);
}

function createRepo(pool) {
  return {
    query: (sql, params = []) => pool.query(sql, params),
    async one(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows[0] || null;
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
        await client.query("ROLLBACK").catch(() => {});
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
    console.log("financeAllocationBalance.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureDb(DATABASE_URL, DB_NAME);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    const migration = fs.readFileSync(
      path.join(__dirname, "../db/migrations/20260828_finance_f4_allocation_balance.sql"),
      "utf8",
    );
    await pool.query(schema);
    await pool.query(FINANCE_SCHEMA_SQL);
    await pool.query(migration);

    const triggerRows = await pool.query(
      `SELECT tgname FROM pg_trigger
       WHERE tgname IN ('trg_payment_allocations_canonical_guard','trg_student_fee_obligations_project_allocations','trg_payment_allocations_refresh_obligation')
         AND NOT tgisinternal`,
    );
    assert.equal(triggerRows.rowCount, 3, "triggers F4 incomplets");

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC','CD','+243','CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1,'CD-2026-F4A','École F4 A','active') RETURNING id, login_code`,
      [country.rows[0].id],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1,'CD-2026-F4B','École F4 B','active') RETURNING id, login_code`,
      [country.rows[0].id],
    );
    const schoolALogin = String(schoolA.rows[0].login_code ?? "").trim().toUpperCase();
    assert.ok(schoolALogin, "login_code école F4 A manquant");
    const yearA = await pool.query(
      `INSERT INTO academic_years (school_id,name,status,is_current)
       VALUES ($1,'2026-2027','open',true) RETURNING id`,
      [schoolA.rows[0].id],
    );
    const yearB = await pool.query(
      `INSERT INTO academic_years (school_id,name,status,is_current)
       VALUES ($1,'2026-2027','open',true) RETURNING id`,
      [schoolB.rows[0].id],
    );
    const classA = await pool.query(
      `INSERT INTO classes (school_id,academic_year_id,class_code,name,status)
       VALUES ($1,$2,'CLS-F4-A','6ème A','active') RETURNING id`,
      [schoolA.rows[0].id, yearA.rows[0].id],
    );
    const classB = await pool.query(
      `INSERT INTO classes (school_id,academic_year_id,class_code,name,status)
       VALUES ($1,$2,'CLS-F4-B','6ème A','active') RETURNING id`,
      [schoolB.rows[0].id, yearB.rows[0].id],
    );
    const student1 = await pool.query(
      `INSERT INTO students (school_id,student_code,first_name,last_name)
       VALUES ($1,'CD-F4-STU-1','Amina','Un') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const student2 = await pool.query(
      `INSERT INTO students (school_id,student_code,first_name,last_name)
       VALUES ($1,'CD-F4-STU-2','Amina','Deux') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const studentB = await pool.query(
      `INSERT INTO students (school_id,student_code,first_name,last_name)
       VALUES ($1,'CD-F4-STU-B','Amina','B') RETURNING id`,
      [schoolB.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id,student_id,class_id,academic_year_id,enrollment_date,class_effective_date,status)
       VALUES ($1,$2,$3,$4,'2026-09-01','2026-09-01','active'),
              ($1,$5,$3,$4,'2026-09-01','2026-09-01','active')`,
      [schoolA.rows[0].id, student1.rows[0].id, classA.rows[0].id, yearA.rows[0].id, student2.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id,student_id,class_id,academic_year_id,enrollment_date,class_effective_date,status)
       VALUES ($1,$2,$3,$4,'2026-09-01','2026-09-01','active')`,
      [schoolB.rows[0].id, studentB.rows[0].id, classB.rows[0].id, yearB.rows[0].id],
    );
    const user = await pool.query(
      `INSERT INTO users (school_id,user_code,first_name,last_name,email,role,status)
       VALUES ($1,'USR-F4','Admin','F4','admin-f4@somafrik.test','SCHOOL_ADMIN','active') RETURNING id`,
      [schoolA.rows[0].id],
    );

    const store = createFinancePgStore(createRepo(pool));
    const admin = {
      role: "Admin School",
      schoolCode: schoolALogin,
      firstName: "Admin",
      lastName: "F4",
      sub: user.rows[0].id,
      permissions: ["Paiements:UPDATE"],
    };

    const grid = await store.upsertFinanceFeeGrid(
      {
        classId: classA.rows[0].id,
        className: "6ème A",
        academicYear: "2026-2027",
        currency: "CDF",
        status: "Active",
        items: [{ feeType: "Scolarité", label: "Scolarité", amount: 30_000, periodLabel: "Septembre", status: "Actif" }],
      },
      admin,
    );
    await store.setFinanceFeeGridStatus(grid.id, "Active", admin);
    const applied = await store.applyFinanceFeeGrid(grid.id, admin);
    assert.equal(applied.created, 2, "une obligation attendue par élève A");

    const fees = await store.listFinanceStudentFees(admin);
    const fee1 = fees.find((row) => row.studentId === "CD-F4-STU-1");
    const fee2 = fees.find((row) => row.studentId === "CD-F4-STU-2");
    assert.ok(fee1 && fee2);

    await assert.rejects(
      () =>
        store.createSchoolPayment(
          { studentId: "CD-F4-STU-1", feeType: "Scolarité", amount: 10_000, method: "Espèces", date: "2026-09-05" },
          admin,
        ),
      (error) => error.code === F4_ERROR.OBLIGATION_ID_REQUIRED,
    );

    const partial = await store.createSchoolPayment(
      {
        studentId: "CD-F4-STU-1",
        items: [{ obligationId: fee1.id, feeType: "Scolarité", amount: 10_000 }],
        method: "Espèces",
        date: "2026-09-05",
      },
      admin,
    );
    assert.equal(partial.allocatedAmount, 10_000);
    assert.equal(partial.unallocatedAmount, 0);

    let persisted = await pool.query(
      `SELECT amount_paid,balance,status FROM student_fee_obligations WHERE id=$1`,
      [fee1.dbId],
    );
    assert.equal(Number(persisted.rows[0].amount_paid), 10_000);
    assert.equal(Number(persisted.rows[0].balance), 20_000);
    assert.equal(persisted.rows[0].status, "Partiellement payé");

    // La colonne amount_paid ne peut plus devenir une seconde autorité.
    await pool.query(
      `UPDATE student_fee_obligations SET amount_paid=29999,balance=1,status='Payé' WHERE id=$1`,
      [fee1.dbId],
    );
    persisted = await pool.query(
      `SELECT amount_paid,balance,status FROM student_fee_obligations WHERE id=$1`,
      [fee1.dbId],
    );
    assert.equal(Number(persisted.rows[0].amount_paid), 10_000);
    assert.equal(Number(persisted.rows[0].balance), 20_000);
    assert.equal(persisted.rows[0].status, "Partiellement payé");

    // Paiement pending : aucune allocation active n'est autorisée.
    const pendingPayment = await pool.query(
      `INSERT INTO payments (school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date)
       VALUES ($1,$2,'PAY-F4-PENDING',5000,'CDF','Mobile money','pending','2026-09-05') RETURNING id`,
      [schoolA.rows[0].id, student1.rows[0].id],
    );
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO payment_allocations (school_id,payment_id,obligation_id,amount) VALUES ($1,$2,$3,5000)`,
          [schoolA.rows[0].id, pendingPayment.rows[0].id, fee1.dbId],
        ),
      (error) => String(error.message).includes("FINANCE_PAYMENT_NOT_SETTLED"),
    );

    // Mauvais élève : même tenant ne suffit pas.
    const wrongStudentPayment = await pool.query(
      `INSERT INTO payments (school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date)
       VALUES ($1,$2,'PAY-F4-STUDENT',5000,'CDF','Espèces','paid','2026-09-05') RETURNING id`,
      [schoolA.rows[0].id, student1.rows[0].id],
    );
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO payment_allocations (school_id,payment_id,obligation_id,amount) VALUES ($1,$2,$3,5000)`,
          [schoolA.rows[0].id, wrongStudentPayment.rows[0].id, fee2.dbId],
        ),
      (error) => String(error.message).includes("FINANCE_ALLOCATION_STUDENT_MISMATCH"),
    );

    // Mauvais tenant : DB fail-closed même hors service.
    const foreignPayment = await pool.query(
      `INSERT INTO payments (school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date)
       VALUES ($1,$2,'PAY-F4-TENANT',5000,'CDF','Espèces','paid','2026-09-05') RETURNING id`,
      [schoolB.rows[0].id, studentB.rows[0].id],
    );
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO payment_allocations (school_id,payment_id,obligation_id,amount) VALUES ($1,$2,$3,5000)`,
          [schoolA.rows[0].id, foreignPayment.rows[0].id, fee1.dbId],
        ),
      (error) => String(error.message).includes("FINANCE_ALLOCATION_TENANT_MISMATCH"),
    );

    // Un paiement ne peut jamais être sur-alloué.
    const smallPayment = await pool.query(
      `INSERT INTO payments (school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date)
       VALUES ($1,$2,'PAY-F4-SMALL',5000,'CDF','Espèces','paid','2026-09-05') RETURNING id`,
      [schoolA.rows[0].id, student1.rows[0].id],
    );
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO payment_allocations (school_id,payment_id,obligation_id,amount) VALUES ($1,$2,$3,6000)`,
          [schoolA.rows[0].id, smallPayment.rows[0].id, fee1.dbId],
        ),
      (error) => String(error.message).includes("FINANCE_PAYMENT_OVERALLOCATED"),
    );

    // Une obligation ne peut jamais recevoir plus que son solde disponible.
    const largePayment = await pool.query(
      `INSERT INTO payments (school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date)
       VALUES ($1,$2,'PAY-F4-LARGE',50000,'CDF','Espèces','paid','2026-09-05') RETURNING id`,
      [schoolA.rows[0].id, student1.rows[0].id],
    );
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO payment_allocations (school_id,payment_id,obligation_id,amount) VALUES ($1,$2,$3,25000)`,
          [schoolA.rows[0].id, largePayment.rows[0].id, fee1.dbId],
        ),
      (error) => String(error.message).includes("FINANCE_OBLIGATION_OVERALLOCATED"),
    );

    // Annulation : reverse allocation, dette restaurée.
    await store.cancelSchoolPayment(partial.reference, "Erreur F4", admin);
    persisted = await pool.query(
      `SELECT amount_paid,balance,status FROM student_fee_obligations WHERE id=$1`,
      [fee1.dbId],
    );
    assert.equal(Number(persisted.rows[0].amount_paid), 0);
    assert.equal(Number(persisted.rows[0].balance), 30_000);

    // Concurrence : deux paiements de 20k sur une dette de 30k => un seul peut passer entièrement.
    const racePayment1 = await pool.query(
      `INSERT INTO payments (school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date)
       VALUES ($1,$2,'PAY-F4-RACE-1',20000,'CDF','Espèces','paid','2026-09-06') RETURNING id`,
      [schoolA.rows[0].id, student1.rows[0].id],
    );
    const racePayment2 = await pool.query(
      `INSERT INTO payments (school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date)
       VALUES ($1,$2,'PAY-F4-RACE-2',20000,'CDF','Espèces','paid','2026-09-06') RETURNING id`,
      [schoolA.rows[0].id, student1.rows[0].id],
    );
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query("BEGIN");
      await c2.query("BEGIN");
      const firstInsert = await c1.query(
        `INSERT INTO payment_allocations (school_id,payment_id,obligation_id,amount) VALUES ($1,$2,$3,20000) RETURNING id`,
        [schoolA.rows[0].id, racePayment1.rows[0].id, fee1.dbId],
      );
      assert.equal(firstInsert.rowCount, 1);
      const secondPromise = c2.query(
        `INSERT INTO payment_allocations (school_id,payment_id,obligation_id,amount) VALUES ($1,$2,$3,20000) RETURNING id`,
        [schoolA.rows[0].id, racePayment2.rows[0].id, fee1.dbId],
      );
      await c1.query("COMMIT");
      await assert.rejects(
        () => secondPromise,
        (error) => String(error.message).includes("FINANCE_OBLIGATION_OVERALLOCATED"),
      );
      await c2.query("ROLLBACK");
    } finally {
      c1.release();
      c2.release();
    }

    persisted = await pool.query(
      `SELECT amount_paid,balance FROM student_fee_obligations WHERE id=$1`,
      [fee1.dbId],
    );
    assert.equal(Number(persisted.rows[0].amount_paid), 20_000);
    assert.equal(Number(persisted.rows[0].balance), 10_000);

    console.log("financeAllocationBalance.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});