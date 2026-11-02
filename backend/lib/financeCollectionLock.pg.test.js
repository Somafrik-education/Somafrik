"use strict";

/**
 * FIN-SEC-01 — verrou PostgreSQL : solde atomique, écriture historique, couverture.
 *   DATABASE_URL=... node backend/lib/financeCollectionLock.pg.test.js
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createFinancePgStore } = require("../db/financePgStore");
const { FINANCE_SCHEMA_SQL } = require("../db/financeSchema");
const { createTxAdapter } = require("../db/txAdapter");
const { F4_ERROR } = require("./financeService");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const DB_NAME = String(process.env.SOMAFRIK_FINANCE_SEC_IT_DATABASE || "somafrik_finance_sec_it")
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
    console.log("financeCollectionLock.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureDb(DATABASE_URL, DB_NAME);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
    await pool.query(FINANCE_SCHEMA_SQL);
    await pool.query(
      fs.readFileSync(path.join(__dirname, "../db/migrations/20261102_finance_collection_lock.sql"), "utf8"),
    );

    const trigger = await pool.query(
      `SELECT tgname, tgdeferrable, tginitdeferred
       FROM pg_trigger
       WHERE tgname = 'trg_payments_collection_covered' AND NOT tgisinternal`,
    );
    assert.equal(trigger.rowCount, 1, "trigger de couverture absent");
    assert.equal(trigger.rows[0].tgdeferrable, true);
    assert.equal(trigger.rows[0].tginitdeferred, true);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC','CD','+243','CDF') RETURNING id`,
    );
    const school = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1,'CD-2026-SEC','CD-2026-SEC','École SEC','active') RETURNING id`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status, is_current)
       VALUES ($1,'2026-2027','open',true) RETURNING id`,
      [school.rows[0].id],
    );
    const klass = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1,$2,'CLS-SEC','6ème A','active') RETURNING id`,
      [school.rows[0].id, year.rows[0].id],
    );
    const student = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1,'CD-SEC-STU-1','Amina','Sec') RETURNING id`,
      [school.rows[0].id],
    );
    const bare = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1,'CD-SEC-STU-0','Sans','Dette') RETURNING id`,
      [school.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, enrollment_date, status)
       VALUES ($1,$2,$3,$4,'2026-09-01','active'), ($1,$5,$3,$4,'2026-09-01','active')`,
      [school.rows[0].id, student.rows[0].id, klass.rows[0].id, year.rows[0].id, bare.rows[0].id],
    );
    const user = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
       VALUES ($1,'USR-SEC','Admin','Sec','admin-sec@somafrik.test','SCHOOL_ADMIN','active') RETURNING id`,
      [school.rows[0].id],
    );
    const store = createFinancePgStore(createRepo(pool));
    const admin = {
      role: "Admin School",
      schoolCode: "CD-2026-SEC",
      firstName: "Admin",
      lastName: "Sec",
      sub: user.rows[0].id,
      permissions: ["Paiements:UPDATE", "Paiements:CREATE"],
    };

    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "CD-SEC-STU-0",
            items: [{ feeType: "Scolarité", amount: 1 }],
            method: "Espèces",
            date: "2026-09-01",
          },
          admin,
        ),
      (error) => error.statusCode === 422 && error.code === F4_ERROR.NO_OPEN_OBLIGATION,
    );

    const grid = await store.upsertFinanceFeeGrid(
      {
        classId: klass.rows[0].id,
        className: "6ème A",
        academicYear: "2026-2027",
        currency: "CDF",
        status: "Active",
        items: [{ feeType: "Scolarité", label: "Scolarité", amount: 100, periodLabel: "Septembre", status: "Actif" }],
      },
      admin,
    );
    await store.setFinanceFeeGridStatus(grid.id, "Active", admin);
    await store.applyFinanceFeeGrid(grid.id, admin, { studentIds: ["CD-SEC-STU-1"] });
    const fee = (await store.listFinanceStudentFees(admin)).find((row) => row.studentId === "CD-SEC-STU-1");
    assert.ok(fee);

    const exact = await store.createSchoolPayment(
      {
        studentId: "CD-SEC-STU-1",
        items: [{ obligationId: fee.id, amount: 40 }],
        method: "Espèces",
        date: "2026-09-02",
      },
      admin,
    );
    assert.equal(Number(exact.allocatedAmount), 40);
    assert.equal(Number(exact.unallocatedAmount), 0);

    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "CD-SEC-STU-1",
            items: [{ obligationId: fee.id, amount: 61 }],
            method: "Espèces",
            date: "2026-09-03",
          },
          admin,
        ),
      (error) => error.statusCode === 422 && error.code === F4_ERROR.PAYMENT_EXCEEDS_BALANCE && /1 CDF/.test(error.message),
    );

    const historical = await pool.query(
      `INSERT INTO payments (
         school_id, student_id, payment_code, amount, currency, payment_method, payment_status, payment_date, fee_type, profile_payload
       ) VALUES ($1,$2,'PAY-SEC-HIST',150,'CDF','Espèces','paid','2026-01-01','Non imputé',$3::jsonb)
       RETURNING id, amount`,
      [school.rows[0].id, student.rows[0].id, JSON.stringify({ status: "Non imputé", unallocatedAmount: 150 })],
    );
    assert.equal(Number(historical.rows[0].amount), 150);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('somafrik.enforce_collection_cover', 'on', true)");
      await client.query(
        `INSERT INTO payments (
           school_id, student_id, payment_code, amount, currency, payment_method, payment_status, payment_date
         ) VALUES ($1,$2,'PAY-SEC-NAKED',10,'CDF','Espèces','paid','2026-09-04')`,
        [school.rows[0].id, student.rows[0].id],
      );
      await assert.rejects(
        () => client.query("COMMIT"),
        (error) => String(error.message).includes("FINANCE_PAYMENT_NOT_COVERED"),
      );
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    const naked = await pool.query(`SELECT count(*)::int AS n FROM payments WHERE payment_code = 'PAY-SEC-NAKED'`);
    assert.equal(naked.rows[0].n, 0);

    const race = await Promise.allSettled([
      store.createSchoolPayment(
        {
          studentId: "CD-SEC-STU-1",
          items: [{ obligationId: fee.id, amount: 60 }],
          method: "Espèces",
          date: "2026-09-05",
        },
        admin,
      ),
      store.createSchoolPayment(
        {
          studentId: "CD-SEC-STU-1",
          items: [{ obligationId: fee.id, amount: 60 }],
          method: "Espèces",
          date: "2026-09-05",
        },
        admin,
      ),
    ]);
    const won = race.filter((row) => row.status === "fulfilled");
    const lost = race.filter((row) => row.status === "rejected");
    assert.equal(won.length, 1, "un seul encaissement concurrent doit passer");
    assert.equal(lost.length, 1);
    assert.equal(lost[0].reason.statusCode, 422);
    const balance = await pool.query(`SELECT balance FROM student_fee_obligations WHERE id = $1`, [fee.dbId]);
    assert.equal(Number(balance.rows[0].balance), 0);

    console.log("financeCollectionLock.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
