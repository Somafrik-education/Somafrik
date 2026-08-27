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
  const pgStoreSrc = fs.readFileSync(path.join(__dirname, "../db/financePgStore.js"), "utf8");
  assert.match(pgStoreSrc, /async lockPayment/);
  assert.match(pgStoreSrc, /FOR UPDATE/);
  const serviceSrc = fs.readFileSync(path.join(__dirname, "financeService.js"), "utf8");
  const reconFn = serviceSrc.slice(serviceSrc.indexOf("async function reconcileUnallocatedPaymentsInTx"));
  assert.ok(
    reconFn.indexOf("lockPayment") < reconFn.indexOf("listAllocations"),
    "lockPayment avant listAllocations",
  );

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

    const user = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
       VALUES ($1, 'USR-FIN-IT-ADMIN', 'Admin', 'A', 'admin-finance-it@somafrik.test', 'SCHOOL_ADMIN', 'active')
       RETURNING id`,
      [schoolA.rows[0].id],
    );
    const repo = createRepo(pool);
    const store = createFinancePgStore(repo);
    const admin = {
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      firstName: "Admin",
      lastName: "A",
      sub: user.rows[0].id,
      permissions: ["Paiements:UPDATE"],
    };

    function failAuditWrites() {
      const original = store.withTransaction.bind(store);
      store.withTransaction = (fn) =>
        original(async (tx) => {
          tx.recordFinanceAudit = async () => {
            throw new Error("audit write failed");
          };
          return fn(tx);
        });
      return () => {
        store.withTransaction = original;
      };
    }

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
    assert.equal(String(cancelled.cancelledBy), String(admin.sub));
    const restored = (await store.listFinanceStudentFees())[0];
    assert.equal(Number(restored.balance), 40_000);
    const cancelAudit = await pool.query(
      `SELECT * FROM audit_logs WHERE action = 'cancel_payment' AND entity_id = $1`,
      [payment.reference],
    );
    assert.equal(cancelAudit.rowCount, 1);

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

    const restoreAudit = failAuditWrites();
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "CD-2026-0001-STU-0001",
            feeType: "Inscription",
            amount: 40_000,
            method: "Espèces",
            date: "2026-08-13",
          },
          admin,
        ),
      (error) => String(error.message).includes("audit write failed"),
    );
    restoreAudit();
    const paymentsAfterFailedCreate = await pool.query("SELECT * FROM payments WHERE cancelled_at IS NULL");
    assert.equal(paymentsAfterFailedCreate.rowCount, 0);
    const createAudits = await pool.query(`SELECT * FROM audit_logs WHERE action = 'create_payment'`);
    assert.equal(createAudits.rowCount, 1);
    const obligationAfterFailedCreate = (await store.listFinanceStudentFees())[0];
    assert.equal(Number(obligationAfterFailedCreate.balance), 40_000);

    const concurrentPayment = await store.createSchoolPayment(
      {
        studentId: "CD-2026-0001-STU-0001",
        feeType: "Inscription",
        amount: 40_000,
        method: "Espèces",
        date: "2026-08-13",
      },
      admin,
    );
    const restoreCancelAudit = failAuditWrites();
    await assert.rejects(
      () => store.cancelSchoolPayment(concurrentPayment.reference, "Audit KO", admin),
      (error) => String(error.message).includes("audit write failed"),
    );
    restoreCancelAudit();
    const stillOpen = await store.getSchoolPayment(concurrentPayment.reference, admin);
    assert.notEqual(stillOpen.status, "Annulé");
    assert.equal(Number((await store.listFinanceStudentFees())[0].balance), 0);
    const cancelAuditsAfterFailed = await pool.query(
      `SELECT * FROM audit_logs WHERE action = 'cancel_payment' AND entity_id = $1`,
      [concurrentPayment.reference],
    );
    assert.equal(cancelAuditsAfterFailed.rowCount, 0);

    const [firstCancel, secondCancel] = await Promise.all([
      store.cancelSchoolPayment(concurrentPayment.reference, "Concurrent A", admin),
      store.cancelSchoolPayment(concurrentPayment.reference, "Concurrent B", admin),
    ]);
    assert.equal(firstCancel.status, "Annulé");
    assert.equal(secondCancel.status, "Annulé");
    const concurrentCancelAudits = await pool.query(
      `SELECT * FROM audit_logs WHERE action = 'cancel_payment' AND entity_id = $1`,
      [concurrentPayment.reference],
    );
    assert.equal(concurrentCancelAudits.rowCount, 1);
    const openAllocations = await pool.query(
      `SELECT * FROM payment_allocations WHERE payment_id = $1 AND reversed_at IS NULL`,
      [concurrentPayment.dbId],
    );
    assert.equal(openAllocations.rowCount, 0);
    const reversedOnce = (await store.listFinanceStudentFees())[0];
    assert.equal(Number(reversedOnce.balance), 40_000);
    const cancelledRow = await pool.query("SELECT cancelled_by FROM payments WHERE payment_code = $1", [
      concurrentPayment.reference,
    ]);
    assert.equal(String(cancelledRow.rows[0].cancelled_by), String(admin.sub));

    const esther = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, 'CD-2026-0001-STU-ESTHER', 'Esther', 'Okito') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [schoolA.rows[0].id, esther.rows[0].id, klass.rows[0].id, year.rows[0].id],
    );
    const paymentsBefore = (await pool.query(`SELECT count(*)::int AS c FROM payments`)).rows[0].c;
    const itemsBefore = (await pool.query(`SELECT count(*)::int AS c FROM payment_items`)).rows[0].c;
    const multi = await store.createSchoolPayment(
      {
        studentId: "CD-2026-0001-STU-ESTHER",
        items: [
          { feeType: "Minerval / scolarité", amount: 500 },
          { feeType: "Frais d'examen", amount: 1 },
          { feeType: "Frais de cantine", amount: 40 },
        ],
        paymentMethod: "cash",
        paidAt: "2026-08-19",
        totalAmount: 1,
      },
      admin,
    );
    assert.equal(multi.totalAmount, 541);
    assert.equal(multi.items.length, 3);
    assert.equal((await pool.query(`SELECT count(*)::int AS c FROM payments`)).rows[0].c, paymentsBefore + 1);
    assert.equal((await pool.query(`SELECT count(*)::int AS c FROM payment_items`)).rows[0].c, itemsBefore + 3);
    const refs = await pool.query(`SELECT DISTINCT payment_code FROM payments WHERE student_id = (SELECT id FROM students WHERE student_code = 'CD-2026-0001-STU-ESTHER')`);
    assert.equal(refs.rowCount, 1);

    await assert.rejects(
      () =>
        store.createSchoolPayment(
          { studentId: "CD-2026-0001-STU-ESTHER", items: [], paymentMethod: "Espèces", paidAt: "2026-08-19" },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.PAYMENT_ITEMS_REQUIRED,
    );
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "CD-2026-0001-STU-ESTHER",
            items: [{ feeType: "Minerval / scolarité", amount: -5 }],
            paymentMethod: "Espèces",
            paidAt: "2026-08-19",
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.PAYMENT_ITEM_AMOUNT_INVALID,
    );

    const gridB = await pool.query(
      `INSERT INTO fee_grids (school_id, grid_code, name, class_name, academic_year, currency, status)
       VALUES ($1, 'GRID-B', 'B', '6ème A', '2025-2026', 'CDF', 'Active') RETURNING id`,
      [schoolB.rows[0].id],
    );
    const itemB = await pool.query(
      `INSERT INTO school_fee_items (school_id, fee_grid_id, item_code, fee_type, label, amount)
       VALUES ($1, $2, 'FEE-B', 'Inscription', 'Inscription B', 10) RETURNING id`,
      [schoolB.rows[0].id, gridB.rows[0].id],
    );
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "CD-2026-0001-STU-ESTHER",
            items: [{ feeTypeId: itemB.rows[0].id, amount: 10 }],
            paymentMethod: "Espèces",
            paidAt: "2026-08-19",
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.FEE_ITEM_TENANT_MISMATCH,
    );

    const cancelledMulti = await store.cancelSchoolPayment(multi.reference, "Annulation reçu complet", admin);
    assert.equal(cancelledMulti.status, "Annulé");
    assert.equal(cancelledMulti.itemCount, 3);

    const sameDayA = await store.createSchoolPayment(
      {
        studentId: "CD-2026-0001-STU-0001",
        feeType: "Frais de cantine",
        amount: 10,
        method: "Espèces",
        date: "2026-08-21",
      },
      admin,
    );
    const sameDayB = await store.createSchoolPayment(
      {
        studentId: "CD-2026-0001-STU-0001",
        feeType: "Frais de transport",
        amount: 11,
        method: "Espèces",
        date: "2026-08-21",
      },
      admin,
    );
    assert.notEqual(sameDayA.reference, sameDayB.reference);
    const sameDayCount = await pool.query(
      `SELECT count(*)::int AS c FROM payments p
       JOIN students st ON st.id = p.student_id
       WHERE st.student_code = 'CD-2026-0001-STU-0001' AND p.payment_date = '2026-08-21'`,
    );
    assert.equal(sameDayCount.rows[0].c, 2, "pas de fusion automatique même élève + même date");

    const orphan = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, 'CD-2026-0001-STU-ORPHAN', 'Sans', 'Classe') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "CD-2026-0001-STU-ORPHAN",
            feeType: "Inscription",
            amount: 10,
            method: "Espèces",
            date: "2026-08-28",
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.ENROLLMENT_REQUIRED,
    );
    assert.ok(orphan.rows[0].id);

    const yearB = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2026-2027', 'open') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const klassB = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-5B', '5ème B', 'active') RETURNING id`,
      [schoolA.rows[0].id, yearB.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [schoolA.rows[0].id, student.rows[0].id, klassB.rows[0].id, yearB.rows[0].id],
    );
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "CD-2026-0001-STU-0001",
            feeType: "Inscription",
            amount: 12,
            method: "Espèces",
            date: "2026-08-29",
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.CLASS_REQUIRED,
    );
    const picked = await store.createSchoolPayment(
      {
        studentId: "CD-2026-0001-STU-0001",
        classId: klassB.rows[0].id,
        feeType: "Inscription",
        amount: 13,
        method: "Espèces",
        date: "2026-08-29",
      },
      admin,
    );
    assert.equal(picked.className, "5ème B");
    assert.equal(String(picked.classId), String(klassB.rows[0].id));

    const foreignClass = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [schoolB.rows[0].id],
    );
    const foreignKlass = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-BI', '6ème A', 'active') RETURNING id`,
      [schoolB.rows[0].id, foreignClass.rows[0].id],
    );
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "CD-2026-0001-STU-0001",
            classId: foreignKlass.rows[0].id,
            feeType: "Inscription",
            amount: 14,
            method: "Espèces",
            date: "2026-08-30",
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.CLASS_TENANT_MISMATCH,
    );

    const rateStudent = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, 'CD-2026-0001-STU-RATE', 'Awa', 'Rate') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [schoolA.rows[0].id, rateStudent.rows[0].id, klass.rows[0].id, year.rows[0].id],
    );
    const monthGrid = await store.upsertFinanceFeeGrid(
      {
        className: "6ème A",
        academicYear: "2025-2026",
        currency: "CDF",
        status: "Active",
        periodName: "Taux",
        items: [{ feeType: "Mensualité", label: "Mensualité", amount: 500, dueDate: "2026-01-01", status: "Actif" }],
      },
      admin,
    );
    await store.setFinanceFeeGridStatus(monthGrid.id, "Active", admin);
    await store.applyFinanceFeeGrid(monthGrid.id, admin, { studentIds: ["CD-2026-0001-STU-RATE"] });

    const histPay = await pool.query(
      `INSERT INTO payments (
         school_id, student_id, payment_code, amount, currency, payment_method, payment_status,
         payment_date, fee_type, profile_payload
       ) VALUES ($1,$2,'CD-2026-0001-2026-PAY-HIST',100,'CDF','cash','paid','2026-08-01','Scolarité',$3::jsonb)
       RETURNING id`,
      [
        schoolA.rows[0].id,
        rateStudent.rows[0].id,
        JSON.stringify({ studentId: "CD-2026-0001-STU-RATE", status: "Payé", feeType: "Scolarité", schoolCode: "CD-2026-0001" }),
      ],
    );
    const beforeRecon = (await store.listFinanceStudentFees(admin)).find(
      (row) => row.studentId === "CD-2026-0001-STU-RATE" || row.studentId === rateStudent.rows[0].id,
    );
    assert.equal(Number(beforeRecon.amountPaid), 0, "GET sans réconciliation ne invente pas l'allocation");
    const recon = await store.reconcileFinancePaymentAllocations(admin);
    assert.ok(recon.created >= 1);
    const allocs = await pool.query(
      `SELECT * FROM payment_allocations WHERE payment_id = $1 AND reversed_at IS NULL`,
      [histPay.rows[0].id],
    );
    assert.equal(allocs.rowCount, 1);
    assert.equal(Number(allocs.rows[0].amount), 100);
    const afterRecon = (await store.listFinanceStudentFees(admin)).find(
      (row) => String(row.dbId) === String(beforeRecon.dbId) || row.studentId === "CD-2026-0001-STU-RATE",
    );
    assert.equal(Number(afterRecon.amountPaid), 100);
    const recon2 = await store.reconcileFinancePaymentAllocations(admin);
    assert.equal(recon2.created, 0);
    const allocs2 = await pool.query(
      `SELECT * FROM payment_allocations WHERE payment_id = $1 AND reversed_at IS NULL`,
      [histPay.rows[0].id],
    );
    assert.equal(allocs2.rowCount, 1, "réconciliation idempotente");
    const reconAudit = await pool.query(
      `SELECT * FROM audit_logs WHERE action = 'reconcile_payment_allocation' AND entity_id = 'CD-2026-0001-2026-PAY-HIST'`,
    );
    assert.ok(reconAudit.rowCount >= 1);

    const concStudent = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, 'CD-2026-0001-STU-CONC', 'Awa', 'Conc') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [schoolA.rows[0].id, concStudent.rows[0].id, klass.rows[0].id, year.rows[0].id],
    );
    const concGrid = await store.upsertFinanceFeeGrid(
      {
        className: "6ème A",
        academicYear: "2025-2026",
        currency: "CDF",
        status: "Active",
        periodName: "Concurrence",
        items: [{ feeType: "Mensualité", label: "Mensualité", amount: 2100, dueDate: "2026-01-01", status: "Actif" }],
      },
      admin,
    );
    await store.setFinanceFeeGridStatus(concGrid.id, "Active", admin);
    await store.applyFinanceFeeGrid(concGrid.id, admin, { studentIds: ["CD-2026-0001-STU-CONC"] });
    const concPay = await pool.query(
      `INSERT INTO payments (
         school_id, student_id, payment_code, amount, currency, payment_method, payment_status,
         payment_date, fee_type, profile_payload
       ) VALUES ($1,$2,'CD-2026-0001-2026-PAY-CONC',200,'CDF','cash','paid','2026-08-01','Minerval',$3::jsonb)
       RETURNING id`,
      [
        schoolA.rows[0].id,
        concStudent.rows[0].id,
        JSON.stringify({
          studentId: "CD-2026-0001-STU-CONC",
          status: "Payé",
          feeType: "Minerval",
          schoolCode: "CD-2026-0001",
        }),
      ],
    );
    const storeB = createFinancePgStore(repo);
    await Promise.all([
      store.reconcileFinancePaymentAllocations(admin),
      storeB.reconcileFinancePaymentAllocations(admin),
    ]);
    const concAllocs = await pool.query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS total, COUNT(*)::int AS n
       FROM payment_allocations
       WHERE payment_id = $1 AND reversed_at IS NULL`,
      [concPay.rows[0].id],
    );
    assert.equal(Number(concAllocs.rows[0].n), 1, "deux réconciliations concurrentes → une seule allocation");
    assert.equal(Number(concAllocs.rows[0].total), 200, "reçu 200 → allocations actives = 200, pas 400");
    const concFee = (await store.listFinanceStudentFees(admin)).find(
      (row) => row.studentId === "CD-2026-0001-STU-CONC" || row.studentId === concStudent.rows[0].id,
    );
    assert.equal(Number(concFee.amountPaid), 200, "amount_paid = 200 sous concurrence");

    const payOver = await store.createSchoolPayment(
      {
        studentId: "CD-2026-0001-STU-RATE",
        items: [{ feeType: "Scolarité", amount: 500 }],
        method: "Espèces",
        date: "2026-08-24",
      },
      admin,
    );
    assert.equal(Number(payOver.overpaymentAmount), 100);
    const paidTotal = await pool.query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS total
       FROM payment_allocations
       WHERE reversed_at IS NULL AND school_id = $1 AND obligation_id = $2`,
      [schoolA.rows[0].id, afterRecon.dbId],
    );
    assert.equal(Number(paidTotal.rows[0].total), 500, "jamais 600 sur une dette 500");

    const studentB = await pool.query(`SELECT id FROM students WHERE student_code = 'BI-2026-0001-STU-0001'`);
    const collide = await pool.query(
      `INSERT INTO student_fee_obligations (
         school_id, student_id, fee_type, label, currency, initial_amount, amount_due, amount_paid, balance, status, profile_payload
       ) VALUES ($1,$2,'Mensualité','Mensualité','CDF',500,500,0,500,'À payer',$3::jsonb)
       RETURNING id`,
      [
        schoolB.rows[0].id,
        studentB.rows[0].id,
        JSON.stringify({ studentId: "CD-2026-0001-STU-RATE", schoolCode: "BI-2026-0001" }),
      ],
    );
    const listedA = await store.listFinanceStudentFees(admin);
    assert.equal(listedA.some((row) => String(row.dbId) === String(collide.rows[0].id)), false);
    assert.equal(listedA.every((row) => row.schoolCode === "CD-2026-0001"), true);
    const platform = await store.listFinanceStudentFees({
      role: "Super Administrateur Somafrik",
      schoolCode: "*",
    });
    const collided = platform.find((row) => String(row.dbId) === String(collide.rows[0].id));
    assert.ok(collided);
    assert.equal(Number(collided.amountPaid), 0, "allocation A jamais projetée sur B malgré identifiant collisionné");

    const yearTenantB = await pool.query(
      `SELECT id FROM academic_years WHERE school_id = $1 AND name = '2025-2026'`,
      [schoolB.rows[0].id],
    );
    const classTenantB = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-B1', '1ère B', 'active') RETURNING id`,
      [schoolB.rows[0].id, yearTenantB.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [schoolB.rows[0].id, studentB.rows[0].id, classTenantB.rows[0].id, yearTenantB.rows[0].id],
    );
    await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, 'CD-2026-0001-STU-NOENR', 'Lina', 'Orpheline', 'active')`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO fee_grids (school_id, grid_code, name, class_name, academic_year, currency, status)
       VALUES ($1, 'GRID-B-ISO', 'Grille B isolée', '1ère B', '2025-2026', 'BIF', 'Active')`,
      [schoolB.rows[0].id],
    );

    const optionsA = await store.listPaymentStudentOptions(admin);
    assert.ok(optionsA.some((row) => row.studentCode === "CD-2026-0001-STU-0001"));
    const awaOption = optionsA.find((row) => row.studentCode === "CD-2026-0001-STU-0001");
    assert.equal(awaOption.firstName, "Awa");
    assert.ok(["CLS-6A", "CLS-5B"].includes(awaOption.classCode));
    assert.equal(optionsA.every((row) => String(row.studentCode).startsWith("CD-2026-0001")), true);
    assert.equal(optionsA.some((row) => row.studentCode.includes("BI-")), false);
    assert.equal(optionsA.some((row) => row.studentCode.includes("NOENR")), false);
    assert.equal(optionsA.some((row) => row.studentCode.includes("ORPHAN")), false);

    const optionsB = await store.listPaymentStudentOptions({
      role: "Comptable",
      schoolCode: "BI-2026-0001",
    });
    assert.equal(optionsB.length, 1);
    assert.equal(optionsB[0].studentCode, "BI-2026-0001-STU-0001");
    assert.equal(optionsB[0].lastName, "Other");
    assert.equal(optionsB[0].classCode, "CLS-B1");

    const gridsA = await store.listFinanceFeeGrids(admin);
    assert.equal(gridsA.every((row) => row.schoolCode === "CD-2026-0001"), true);
    assert.equal(
      gridsA.some((row) => row.id === "GRID-B" || row.id === "GRID-B-ISO" || row.className === "1ère B"),
      false,
    );

    const methodsA = await store.replaceSchoolPaymentMethods(
      [
        { methodCode: "cash", label: "Espèces", active: true },
        { methodCode: "mobile_money", label: "Mobile money", active: false },
      ],
      admin,
    );
    assert.equal(methodsA.find((row) => row.methodCode === "cash")?.active, true);
    assert.equal(methodsA.find((row) => row.methodCode === "mobile_money")?.active, false);

    const methodsB = await store.listSchoolPaymentMethods({ role: "Admin School", schoolCode: "BI-2026-0001" });
    assert.equal(methodsB.every((row) => row.persisted === false), true, "B n'hérite pas des moyens A");

    const catalogA = await store.getFinanceCatalog(admin);
    assert.equal(catalogA.currency, "CDF");
    assert.equal(catalogA.discountsDeferred, true);
    assert.equal(catalogA.penaltiesDeferred, true);

    console.log("financeRepository.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
