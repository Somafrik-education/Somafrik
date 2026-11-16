"use strict";

/**
 * STUDENT-INTEGRITY-01 — PostgreSQL jetable.
 * DATABASE_URL=postgres://... node backend/lib/studentIntegrity.pg.test.js
 *
 * N'utilise que la base isolée somafrik_student_integrity_it.
 * Aucune donnée réelle n'est lue ni modifiée.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createFinancePgStore } = require("../db/financePgStore");
const { FINANCE_SCHEMA_SQL } = require("../db/financeSchema");
const { createTxAdapter } = require("../db/txAdapter");
const { FINANCE_ERROR } = require("./financeManagement");
const {
  INTEGRITY_COUNT_SQL,
  ORPHAN_OBLIGATION_SQL,
  assertReadOnlySql,
  projectOrphanObligations,
  summarizeIntegrityCounts,
} = require("./studentIntegrity");

const DATABASE_URL = String(process.env.DATABASE_URL || process.env.SOMAFRIK_TEST_PG_URL || "").trim();
const DB_NAME = String(process.env.SOMAFRIK_STUDENT_INTEGRITY_IT_DATABASE || "somafrik_student_integrity_it")
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
    console.log("studentIntegrity.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  assertReadOnlySql(INTEGRITY_COUNT_SQL);
  assertReadOnlySql(ORPHAN_OBLIGATION_SQL);
  const isolatedUrl = await ensureDb(DATABASE_URL, DB_NAME);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
    await pool.query(FINANCE_SCHEMA_SQL);
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/migrations/20261102_finance_collection_lock.sql"), "utf8"));

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC','CD','+243','CDF') RETURNING id`,
    );
    const school = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1,'CD-IN-26-001','CD-IN-26-001','École intégrité','active') RETURNING id`,
      [country.rows[0].id],
    );
    const other = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1,'CD-XX-OTH-26','CD-XX-OTH-26','Autre établissement','active') RETURNING id`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status, is_current)
       VALUES ($1,'2026-2027','open',true) RETURNING id`,
      [school.rows[0].id],
    );
    const otherYear = await pool.query(
      `INSERT INTO academic_years (school_id, name, status, is_current)
       VALUES ($1,'2026-2027','open',true) RETURNING id`,
      [other.rows[0].id],
    );
    const klass = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1,$2,'CLS-4A','4ème A','active') RETURNING id`,
      [other.rows[0].id, otherYear.rows[0].id],
    );
    const bare = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1,'CD-IN-BARE-26','Sans','Inscription','active') RETURNING id`,
      [school.rows[0].id],
    );
    const unknown = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1,'CD-IN-UNK-26','Statut','Inconnu','active') RETURNING id`,
      [school.rows[0].id],
    );
    const foreign = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1,'CD-XX-FOR-26','Autre','École','active') RETURNING id`,
      [school.rows[0].id],
    );
    const orphanStudent = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1,'CD-IN-ORP-26','Ligne','Orpheline','active') RETURNING id`,
      [school.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, enrollment_date, status)
       VALUES ($1,$2,$3,$4,'2026-09-01','unknown')`,
      [school.rows[0].id, unknown.rows[0].id, null, year.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, enrollment_date, status)
       VALUES ($1,$2,$3,$4,'2026-09-01','active')`,
      [other.rows[0].id, foreign.rows[0].id, klass.rows[0].id, otherYear.rows[0].id],
    );

    async function openObligation(studentId, amount) {
      const inserted = await pool.query(
        `INSERT INTO student_fee_obligations (
           school_id, student_id, fee_type, label, currency, amount_due, amount_paid, balance, status, profile_payload
         ) VALUES ($1,$2,'Scolarité','Minerval','CDF',$3,0,$3,'En retard','{}'::jsonb)
         RETURNING id, balance`,
        [school.rows[0].id, studentId, amount],
      );
      return inserted.rows[0];
    }

    const bareFee = await openObligation(bare.rows[0].id, 320000);
    const unknownFee = await openObligation(unknown.rows[0].id, 150000);
    const foreignFee = await openObligation(foreign.rows[0].id, 80000);
    const orphanFee = await openObligation(orphanStudent.rows[0].id, 50000);
    const user = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
       VALUES ($1,'USR-INT','Ada','Compta','integrity@somafrik.test','SCHOOL_ADMIN','active') RETURNING id`,
      [school.rows[0].id],
    );
    const store = createFinancePgStore(createRepo(pool));
    const admin = {
      role: "Comptable",
      schoolCode: "CD-IN-26-001",
      financeLoginCode: "CD-IN-26-001",
      schoolId: school.rows[0].id,
      effectiveSchoolId: school.rows[0].id,
      firstName: "Ada",
      lastName: "Compta",
      sub: user.rows[0].id,
      permissions: ["Paiements:CREATE", "Paiements:READ", "Impayés:READ"],
    };

    async function snapshot() {
      const payments = await pool.query(`SELECT count(*)::int AS n FROM payments`);
      const items = await pool.query(`SELECT count(*)::int AS n FROM payment_items`);
      const allocations = await pool.query(`SELECT count(*)::int AS n FROM payment_allocations`);
      const balances = await pool.query(
        `SELECT id::text, balance::float8 AS balance FROM student_fee_obligations ORDER BY created_at, id`,
      );
      return {
        payments: payments.rows[0].n,
        items: items.rows[0].n,
        allocations: allocations.rows[0].n,
        balances: balances.rows,
      };
    }

    const before = await snapshot();
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "CD-IN-BARE-26",
            items: [{ obligationId: bareFee.id, amount: 1000 }],
            method: "Espèces",
            date: "2026-11-03",
          },
          admin,
        ),
      (error) => error.statusCode === 400 && error.code === FINANCE_ERROR.ENROLLMENT_REQUIRED,
    );
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "CD-IN-UNK-26",
            items: [{ obligationId: unknownFee.id, amount: 1000 }],
            method: "Espèces",
            date: "2026-11-03",
          },
          admin,
        ),
      (error) => error.statusCode === 400 && error.code === FINANCE_ERROR.ENROLLMENT_REQUIRED,
    );
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "CD-XX-FOR-26",
            items: [{ obligationId: foreignFee.id, amount: 1000 }],
            method: "Espèces",
            date: "2026-11-03",
          },
          admin,
        ),
      (error) => error.statusCode === 400 && error.code === FINANCE_ERROR.ENROLLMENT_REQUIRED,
    );
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "profile-legacy-not-a-uuid",
            items: [{ obligationId: bareFee.id, amount: 1000 }],
            method: "Espèces",
            date: "2026-11-03",
          },
          admin,
        ),
      (error) => error.statusCode === 404 && error.code === FINANCE_ERROR.STUDENT_NOT_FOUND,
    );
    const afterAttempts = await snapshot();
    assert.deepEqual(afterAttempts, before, "aucun paiement, reçu ou solde n'est modifié");

    await pool.query(`ALTER TABLE student_fee_obligations DROP CONSTRAINT IF EXISTS student_fee_obligations_student_id_fkey`);
    await pool.query(`DELETE FROM students WHERE id = $1`, [orphanStudent.rows[0].id]);
    const orphanBalance = await pool.query(`SELECT balance::float8 AS balance FROM student_fee_obligations WHERE id = $1`, [
      orphanFee.id,
    ]);
    assert.equal(Number(orphanBalance.rows[0].balance), 50000);

    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const counts = await client.query(INTEGRITY_COUNT_SQL);
      const orphans = await client.query(ORPHAN_OBLIGATION_SQL);
      const summary = summarizeIntegrityCounts(counts.rows);
      const projected = projectOrphanObligations(orphans.rows);
      assert.ok(summary.totals.orphan_finance >= 1);
      assert.equal(projected.length, 1);
      assert.equal(projected[0].obligationId, orphanFee.id);
      assert.equal(projected[0].balance, 50000);
      assert.equal(projected[0].schoolCode, "CD-IN-26-001");
      assert.equal(JSON.stringify(projected).includes("Ligne"), false);
      assert.equal(JSON.stringify(projected).includes("Orpheline"), false);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const stillThere = await pool.query(`SELECT balance::float8 AS balance FROM student_fee_obligations WHERE id = $1`, [
      orphanFee.id,
    ]);
    assert.equal(Number(stillThere.rows[0].balance), 50000);
    const payments = await pool.query(`SELECT count(*)::int AS n FROM payments`);
    assert.equal(payments.rows[0].n, 0);
    console.log("studentIntegrity.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
