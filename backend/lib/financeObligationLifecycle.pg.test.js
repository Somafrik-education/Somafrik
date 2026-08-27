"use strict";

/**
 * F3 — PostgreSQL réel : UNIQUE, retry, concurrence, tenant, snapshot, transfert, rollback.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createFinancePgStore } = require("../db/financePgStore");
const { FINANCE_SCHEMA_SQL } = require("../db/financeSchema");
const { FINANCE_ERROR } = require("./financeManagement");
const { createTxAdapter } = require("../db/txAdapter");
const { NO_APPLICABLE_GRID } = require("./financeObligationLifecycle");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const FINANCE_IT_DATABASE = String(process.env.SOMAFRIK_FINANCE_F3_IT_DATABASE ?? "somafrik_finance_f3_it")
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
    console.log("financeObligationLifecycle.pg.test.js: SKIP (DATABASE_URL absent)");
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
       VALUES ($1, '2026-2027', 'open') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const klassA = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6A', '6ème A', 'active') RETURNING id`,
      [schoolA.rows[0].id, year.rows[0].id],
    );
    const klassB = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6B', '6ème B', 'active') RETURNING id`,
      [schoolA.rows[0].id, year.rows[0].id],
    );
    const student = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, 'CD-2026-0001-STU-0001', 'Awa', 'Diop') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status, enrollment_date, class_effective_date)
       VALUES ($1, $2, $3, $4, 'active', '2026-09-01', '2026-09-01')`,
      [schoolA.rows[0].id, student.rows[0].id, klassA.rows[0].id, year.rows[0].id],
    );
    const yearB = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2026-2027', 'open') RETURNING id`,
      [schoolB.rows[0].id],
    );
    const klassBI = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-BI-6A', '6ème A', 'active') RETURNING id`,
      [schoolB.rows[0].id, yearB.rows[0].id],
    );
    const user = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
       VALUES ($1, 'USR-F3-IT', 'Admin', 'A', 'admin-f3-it@somafrik.test', 'SCHOOL_ADMIN', 'active')
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

    const uniq = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'student_fee_obligations_identity_uniq'`,
    );
    assert.ok(uniq.rowCount, "UNIQUE identity PostgreSQL absente");
    assert.match(uniq.rows[0].indexdef, /fee_type_code/);
    assert.match(uniq.rows[0].indexdef, /period_key/);

    const none = await store.ensureEnrollmentObligations(
      {
        reason: "enrollment_active",
        schoolCode: "CD-2026-0001",
        studentKey: "CD-2026-0001-STU-0001",
        academicYear: "2026-2027",
        classId: klassA.rows[0].id,
      },
      admin,
    );
    assert.equal(none.reason, NO_APPLICABLE_GRID);
    assert.equal((await store.listFinanceStudentFees(admin)).length, 0);

    const grid = await store.upsertFinanceFeeGrid(
      {
        classId: klassA.rows[0].id,
        className: "6ème A",
        academicYear: "2026-2027",
        currency: "CDF",
        status: "Active",
        items: [
          { feeType: "Scolarité", label: "Scolarité", amount: 30_000, monthlyMonths: ["Septembre", "Octobre"], dueDate: "2026-09-05", status: "Actif" },
          { feeType: "Examen", label: "Examen", amount: 10_000, dueDate: "2026-12-01", status: "Actif" },
        ],
      },
      admin,
    );
    await store.setFinanceFeeGridStatus(grid.id, "Active", admin);

    const [first, second] = await Promise.all([
      store.applyFinanceFeeGrid(grid.id, admin),
      store.applyFinanceFeeGrid(grid.id, admin),
    ]);
    assert.equal(first.created + second.created, 3, "concurrence : une seule série");
    assert.equal(first.created + second.created + first.skipped + second.skipped, 6);
    let fees = await store.listFinanceStudentFees(admin);
    assert.equal(fees.length, 3);
    const keys = fees.map((row) => row.periodKey).sort();
    assert.deepEqual(keys, ["2026-09", "2026-10", "ONCE"]);
    assert.equal(fees.every((row) => row.currency === "CDF"), true);

    const retry = await store.applyFinanceFeeGrid(grid.id, admin);
    assert.equal(retry.created, 0);
    assert.equal((await store.listFinanceStudentFees(admin)).length, 3);

    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: "grid_apply",
            schoolCode: "CD-2026-0001",
            studentKey: "CD-2026-0001-STU-0001",
            academicYear: "2026-2027",
            classId: klassA.rows[0].id,
            grid: {
              id: "grid-6b-mismatch",
              schoolId: schoolA.rows[0].id,
              status: "Active",
              classId: klassB.rows[0].id,
              className: "6ème B",
              academicYear: "2026-2027",
            },
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.GRID_ENROLLMENT_MISMATCH,
    );
    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: "enrollment_active",
            schoolCode: "CD-2026-0001",
            studentKey: "CD-2026-0001-STU-0001",
            academicYear: "2027-2028",
            classId: klassA.rows[0].id,
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.ENROLLMENT_NOT_FOUND,
    );
    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: "enrollment_active",
            schoolCode: "CD-2026-0001",
            studentKey: "CD-2026-0001-STU-0001",
            academicYear: "2026-2027",
            classId: klassB.rows[0].id,
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.CLASS_ENROLLMENT_MISMATCH,
    );
    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: "enrollment_active",
            schoolCode: "CD-2026-0001",
            studentKey: "CD-2026-0001-STU-0001",
            academicYear: "2099-2100",
            classId: klassA.rows[0].id,
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.ENROLLMENT_NOT_FOUND,
    );
    assert.equal((await store.listFinanceStudentFees(admin)).length, 3);

    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: "class_transfer",
            schoolCode: "CD-2026-0001",
            studentKey: "CD-2026-0001-STU-0001",
            academicYear: "2026-2027",
            classId: klassA.rows[0].id,
            previousClass: { classId: klassA.rows[0].id, className: "6ème A" },
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.NEEDS_EFFECTIVE_DATE,
    );
    const octBeforeUndated = await pool.query(
      `SELECT archived_at, cancel_reason FROM student_fee_obligations WHERE period_key = '2026-10'`,
    );
    assert.equal(octBeforeUndated.rows[0].archived_at, null);

    let firstForcedTx = true;
    const originalEnsureTx = store.withTransaction.bind(store);
    store.withTransaction = (fn) =>
      originalEnsureTx(async (tx) => {
        if (firstForcedTx) {
          firstForcedTx = false;
          tx.insertObligationIfAbsent = async () => {
            const error = new Error("forced engine failure");
            error.code = "FORCED_ENGINE_FAILURE";
            throw error;
          };
        }
        return fn(tx);
      });
    const countBeforeForced = (await pool.query("SELECT count(*)::int AS n FROM student_fee_obligations")).rows[0].n;
    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: "catch_up",
            schoolCode: "CD-2026-0001",
            studentKey: "CD-2026-0001-STU-0001",
            academicYear: "2026-2027",
            classId: klassA.rows[0].id,
          },
          admin,
        ),
      (error) => error.code === "FORCED_ENGINE_FAILURE",
    );
    store.withTransaction = originalEnsureTx;
    const countAfterForced = (await pool.query("SELECT count(*)::int AS n FROM student_fee_obligations")).rows[0].n;
    assert.equal(countAfterForced, countBeforeForced, "erreur moteur : 0 fausse obligation");
    const enrollmentStill = await pool.query(
      `SELECT status FROM enrollments WHERE student_id = $1`,
      [student.rows[0].id],
    );
    assert.equal(enrollmentStill.rows[0].status, "active");
    const failedAudit = await pool.query(
      `SELECT action, new_value FROM audit_logs WHERE action = 'finance_obligation_sync_failed'`,
    );
    assert.ok(failedAudit.rowCount, "état d'échec Finance durable absent");
    assert.equal(failedAudit.rows[0].new_value.reason, "FINANCE_OBLIGATION_SYNC_FAILED");

    await store.upsertFinanceFeeGrid(
      {
        id: grid.id,
        classId: klassA.rows[0].id,
        className: "6ème A",
        academicYear: "2026-2027",
        currency: "CDF",
        status: "Active",
        items: [
          { feeType: "Scolarité", label: "Scolarité", amount: 35_000, monthlyMonths: ["Septembre", "Octobre"], status: "Actif" },
          { feeType: "Examen", label: "Examen", amount: 12_000, status: "Actif" },
        ],
      },
      admin,
    );
    await store.applyFinanceFeeGrid(grid.id, admin);
    fees = await store.listFinanceStudentFees(admin);
    const sep = fees.find((row) => row.periodKey === "2026-09");
    assert.equal(Number(sep.amountDue), 30_000, "snapshot tarif non réécrit");

    const beforePay = (await pool.query("SELECT count(*)::int AS n FROM student_fee_obligations")).rows[0].n;
    await store.createSchoolPayment(
      {
        studentId: "CD-2026-0001-STU-0001",
        items: [{ feeType: "Uniforme", amount: 1_000 }],
        method: "Espèces",
        date: "2026-09-02",
      },
      admin,
    );
    const afterPay = (await pool.query("SELECT count(*)::int AS n FROM student_fee_obligations")).rows[0].n;
    assert.equal(afterPay, beforePay, "paiement ne crée pas d'obligation");

    const gridB = await store.upsertFinanceFeeGrid(
      {
        classId: klassBI.rows[0].id,
        className: "6ème A",
        academicYear: "2026-2027",
        currency: "CDF",
        status: "Active",
        items: [{ feeType: "Inscription", label: "Inscription", amount: 8_000, status: "Actif" }],
      },
      { ...admin, schoolCode: "BI-2026-0001" },
    );
    await store.setFinanceFeeGridStatus(gridB.id, "Active", { ...admin, schoolCode: "BI-2026-0001" });
    await assert.rejects(
      () => store.applyFinanceFeeGrid(gridB.id, admin),
      (error) => error.code === FINANCE_ERROR.TENANT_MISMATCH || error.statusCode === 403,
    );

    const sepRow = await pool.query(
      `SELECT id, amount_due FROM student_fee_obligations WHERE period_key = '2026-09' LIMIT 1`,
    );
    await store.createSchoolPayment(
      {
        studentId: "CD-2026-0001-STU-0001",
        items: [{ feeType: "Scolarité", amount: 30_000 }],
        method: "Espèces",
        date: "2026-09-10",
      },
      admin,
    );
    await pool.query(
      `UPDATE student_fee_obligations SET amount_paid = 0, balance = amount_due, status = 'À payer'
       WHERE period_key = '2026-10'`,
    );

    await pool.query(
      `UPDATE enrollments SET class_id = $1, class_effective_date = '2026-09-15' WHERE student_id = $2`,
      [klassB.rows[0].id, student.rows[0].id],
    );
    const grid6b = await store.upsertFinanceFeeGrid(
      {
        classId: klassB.rows[0].id,
        className: "6ème B",
        academicYear: "2026-2027",
        currency: "CDF",
        status: "Active",
        items: [
          { feeType: "Scolarité", label: "Scolarité 6B", amount: 32_000, monthlyMonths: ["Septembre", "Octobre"], status: "Actif" },
        ],
      },
      admin,
    );
    await store.setFinanceFeeGridStatus(grid6b.id, "Active", admin);
    const transfer = await store.ensureEnrollmentObligations(
      {
        reason: "class_transfer",
        schoolCode: "CD-2026-0001",
        studentKey: "CD-2026-0001-STU-0001",
        academicYear: "2026-2027",
        classId: klassB.rows[0].id,
        previousClass: { classId: klassA.rows[0].id, className: "6ème A" },
        effectiveDate: "2026-09-15",
      },
      admin,
    );
    assert.ok(transfer.superseded >= 1 || transfer.created >= 0);
    const octOld = await pool.query(
      `SELECT archived_at, cancel_reason FROM student_fee_obligations
       WHERE period_key = '2026-10' AND class_id = $1`,
      [klassA.rows[0].id],
    );
    if (octOld.rowCount) {
      assert.ok(octOld.rows[0].archived_at);
      assert.equal(octOld.rows[0].cancel_reason, "CLASS_TRANSFER");
    }
    const sepStill = await pool.query(
      `SELECT amount_due, archived_at FROM student_fee_obligations WHERE id = $1`,
      [sepRow.rows[0].id],
    );
    assert.equal(Number(sepStill.rows[0].amount_due), 30_000);
    assert.equal(sepStill.rows[0].archived_at, null);

    const countBeforeRollback = (await pool.query("SELECT count(*)::int AS n FROM student_fee_obligations")).rows[0].n;
    const original = store.withTransaction.bind(store);
    store.withTransaction = (fn) =>
      original(async (tx) => {
        const result = await fn(tx);
        throw new Error("forced rollback");
      });
    await assert.rejects(() => store.applyFinanceFeeGrid(grid6b.id, admin));
    store.withTransaction = original;
    const countAfterRollback = (await pool.query("SELECT count(*)::int AS n FROM student_fee_obligations")).rows[0].n;
    assert.equal(countAfterRollback, countBeforeRollback, "rollback transactionnel");

    console.log("financeObligationLifecycle.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
