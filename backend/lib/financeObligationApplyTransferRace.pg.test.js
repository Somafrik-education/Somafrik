"use strict";

/**
 * F3 P1 — PostgreSQL réel : une application de grille 6A ayant lu une
 * inscription devenue stale ne peut pas recréer une dette 6A après un
 * transfert concurrent 6A→6B.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createFinancePgStore } = require("../db/financePgStore");
const { PostgresRepository } = require("../db/postgresRepository");
const { FINANCE_SCHEMA_SQL } = require("../db/financeSchema");
const { createTxAdapter } = require("../db/txAdapter");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const DATABASE_NAME = String(
  process.env.SOMAFRIK_FINANCE_F3_APPLY_TRANSFER_IT_DATABASE ?? "somafrik_finance_f3_apply_transfer_it",
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
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function createRepo(pool) {
  return {
    query(sql, params = []) {
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

function timeout(ms, label) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
    timer.unref?.();
  });
}

function isoDate(value) {
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value ?? "").slice(0, 10);
}

async function main() {
  if (!DATABASE_URL) {
    console.log("financeObligationApplyTransferRace.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, DATABASE_NAME);
  const pool = new Pool({ connectionString: isolatedUrl });
  let pgRepo = null;
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(FINANCE_SCHEMA_SQL);

    const trigger = await pool.query(
      `SELECT tgname
       FROM pg_trigger
       WHERE tgname = 'trg_student_fee_obligations_active_enrollment_scope'
         AND NOT tgisinternal`,
    );
    assert.equal(trigger.rowCount, 1, "garde DB apply↔transfert absente");

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const leftoverSchool = "CD-2026-0001";
    const school = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, $2, 'CD-F3R-26-001', 'Lycée F3 Race', 'active') RETURNING id, school_code, login_code`,
      [country.rows[0].id, leftoverSchool],
    );
    const schoolLogin = String(school.rows[0].login_code).trim().toUpperCase();
    assert.notEqual(school.rows[0].school_code, schoolLogin);
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2026-2027', 'open') RETURNING id`,
      [school.rows[0].id],
    );
    const classA = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6A-RACE', '6ème A', 'active') RETURNING id`,
      [school.rows[0].id, year.rows[0].id],
    );
    const classB = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6B-RACE', '6ème B', 'active') RETURNING id`,
      [school.rows[0].id, year.rows[0].id],
    );
    const student = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, 'CD-2026-0001-STU-RACE', 'Amina', 'Race') RETURNING id`,
      [school.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (
         school_id, student_id, class_id, academic_year_id,
         status, enrollment_date, class_effective_date
       ) VALUES ($1, $2, $3, $4, 'active', '2026-09-01', '2026-09-01')`,
      [school.rows[0].id, student.rows[0].id, classA.rows[0].id, year.rows[0].id],
    );
    const user = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
       VALUES ($1, 'USR-F3-RACE', 'Admin', 'Race', 'admin-f3-race@somafrik.test', 'SCHOOL_ADMIN', 'active')
       RETURNING id`,
      [school.rows[0].id],
    );

    const repo = createRepo(pool);
    const store = createFinancePgStore(repo);
    const admin = {
      role: "Admin School",
      schoolCode: schoolLogin,
      firstName: "Admin",
      lastName: "Race",
      sub: user.rows[0].id,
      permissions: ["Paiements:UPDATE"],
    };

    const gridA = await store.upsertFinanceFeeGrid(
      {
        classId: classA.rows[0].id,
        className: "6ème A",
        academicYear: "2026-2027",
        currency: "CDF",
        status: "Active",
        items: [
          {
            feeType: "Scolarité",
            label: "Scolarité 6A",
            amount: 30_000,
            monthlyMonths: ["Septembre", "Octobre"],
            status: "Actif",
          },
          {
            feeType: "Transport",
            label: "Transport 6A",
            amount: 5_000,
            dueDate: "2026-10-10",
            status: "Actif",
          },
        ],
      },
      admin,
    );
    await store.setFinanceFeeGridStatus(gridA.id, "Active", admin);

    const gridB = await store.upsertFinanceFeeGrid(
      {
        classId: classB.rows[0].id,
        className: "6ème B",
        academicYear: "2026-2027",
        currency: "CDF",
        status: "Active",
        items: [
          {
            feeType: "Scolarité",
            label: "Scolarité 6B",
            amount: 32_000,
            monthlyMonths: ["Septembre", "Octobre"],
            status: "Actif",
          },
        ],
      },
      admin,
    );
    await store.setFinanceFeeGridStatus(gridB.id, "Active", admin);

    const seeded = await store.applyFinanceFeeGrid(gridA.id, admin);
    assert.equal(seeded.created, 3, "seed 6A incomplet");

    pgRepo = new PostgresRepository(isolatedUrl);
    pgRepo.ready = true;

    // Forcer l'interleaving qui était dangereux : apply 6A lit l'enrollment 6A,
    // puis attend ; le transfert 6A→6B commit ; apply reprend avec son snapshot JS stale.
    const originalWithTransaction = store.withTransaction.bind(store);
    let releaseApply;
    let signalStaleRead;
    const staleRead = new Promise((resolve) => {
      signalStaleRead = resolve;
    });
    const resumeApply = new Promise((resolve) => {
      releaseApply = resolve;
    });
    let pauseOnce = true;

    store.withTransaction = (fn) =>
      originalWithTransaction(async (tx) => {
        const originalList = tx.listActiveEnrollmentsForStudent?.bind(tx);
        if (originalList) {
          tx.listActiveEnrollmentsForStudent = async (...args) => {
            const rows = await originalList(...args);
            if (
              pauseOnce &&
              String(args[0]) === String(student.rows[0].id) &&
              rows.some((row) => String(row.classId) === String(classA.rows[0].id))
            ) {
              pauseOnce = false;
              signalStaleRead();
              await resumeApply;
            }
            return rows;
          };
        }
        return fn(tx);
      });

    const staleApplyPromise = store.applyFinanceFeeGrid(gridA.id, admin);
    await Promise.race([staleRead, timeout(10_000, "apply 6A n'a pas lu l'enrollment stale")]);

    let transferResult;
    try {
      transferResult = await Promise.race([
        pgRepo.ensureActiveEnrollment(school.rows[0].id, student.rows[0].id, classB.rows[0].id, {
          effectiveDate: "2026-09-15",
          principal: admin,
        }),
        timeout(15_000, "transfert 6A→6B"),
      ]);
    } finally {
      releaseApply();
    }
    assert.ok(transferResult?.superseded >= 1, "transfert : anciennes obligations futures non superseded");
    assert.ok(transferResult?.created >= 1, "transfert : obligation future 6B absente");

    const staleApplySettled = await Promise.race([
      Promise.allSettled([staleApplyPromise]),
      timeout(15_000, "reprise apply 6A stale"),
    ]);
    store.withTransaction = originalWithTransaction;
    const staleApply = staleApplySettled[0];
    if (staleApply.status === "fulfilled") {
      assert.equal(staleApply.value.created, 0, "apply stale ne doit recréer aucune dette 6A");
    }

    const enrollment = await pool.query(
      `SELECT class_id, class_effective_date
       FROM enrollments
       WHERE student_id = $1 AND academic_year_id = $2`,
      [student.rows[0].id, year.rows[0].id],
    );
    assert.equal(String(enrollment.rows[0].class_id), String(classB.rows[0].id));
    assert.equal(isoDate(enrollment.rows[0].class_effective_date), "2026-09-15");

    const active = await pool.query(
      `SELECT class_id, fee_type_code, period_key, due_date
       FROM student_fee_obligations
       WHERE student_id = $1 AND archived_at IS NULL
       ORDER BY fee_type_code, period_key`,
      [student.rows[0].id],
    );

    const staleFutureA = active.rows.filter(
      (row) =>
        String(row.class_id) === String(classA.rows[0].id) &&
        (String(row.period_key) === "2026-10" || String(row.fee_type_code) === "TRANSPORT"),
    );
    assert.equal(staleFutureA.length, 0, "apply stale a recréé une obligation future 6A");

    const futureMonthly = active.rows.filter((row) => /^\d{4}-\d{2}$/.test(String(row.period_key)) && String(row.period_key) > "2026-09");
    assert.ok(futureMonthly.length >= 1, "obligation future de la classe finale absente");
    assert.equal(
      futureMonthly.every((row) => String(row.class_id) === String(classB.rows[0].id)),
      true,
      "période future active hors classe finale",
    );

    const duplicateActive = await pool.query(
      `SELECT fee_type_code, period_key, count(*)::int AS n
       FROM student_fee_obligations
       WHERE student_id = $1 AND archived_at IS NULL
       GROUP BY fee_type_code, period_key
       HAVING count(*) > 1`,
      [student.rows[0].id],
    );
    assert.equal(duplicateActive.rowCount, 0, "double débit actif après course apply↔transfert");

    const archivedOld = await pool.query(
      `SELECT fee_type_code, period_key, cancel_reason
       FROM student_fee_obligations
       WHERE student_id = $1
         AND class_id = $2
         AND archived_at IS NOT NULL
         AND cancel_reason = 'CLASS_TRANSFER'`,
      [student.rows[0].id, classA.rows[0].id],
    );
    assert.ok(archivedOld.rowCount >= 2, "historique CLASS_TRANSFER 6A incomplet");
    assert.ok(
      archivedOld.rows.some((row) => String(row.period_key) === "2026-10"),
      "Octobre 6A doit rester dans l'historique superseded",
    );
    assert.ok(
      archivedOld.rows.some((row) => String(row.fee_type_code) === "TRANSPORT"),
      "Transport futur 6A doit rester dans l'historique superseded",
    );

    console.log("financeObligationApplyTransferRace.pg.test.js: OK");
  } finally {
    try {
      if (pgRepo) await pgRepo.close();
    } catch {
      /* ignore */
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
