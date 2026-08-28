"use strict";

/**
 * COM-C4 — compatibilité bootstrap Payments.
 *
 * CAS A : table payments legacy/minimale SANS cancelled_at (colonne Finance).
 * CAS B : même base après ALTER Finance cancelled_at, sans exécuter toute la
 *         migration Finance depuis le bootstrap Clients.
 *
 * cancelled_at reste propriété Finance. C4 ne la redéfinit pas.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const {
  applyCommunicationsC4Schema,
  ensureClientsCanonicalBootstrap,
} = require("./clientsCanonicalBootstrap");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_COM_C4_BOOTSTRAP_IT_DATABASE ?? "somafrik_com_c4_bootstrap_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const QUIET = { info() {}, error() {} };

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function paymentColumnExists(pool, columnName) {
  const row = await pool.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payments'
        AND column_name = $1
      LIMIT 1`,
    [columnName],
  );
  return row.rowCount > 0;
}

async function paymentTriggerDef(pool) {
  const row = await pool.query(
    `SELECT pg_get_triggerdef(oid) AS def
       FROM pg_trigger
      WHERE tgname = 'trg_c4_payment_event'
      LIMIT 1`,
  );
  assert.ok(row.rowCount, "trigger C4 payments installé");
  return String(row.rows[0].def);
}

async function outboxForPayment(pool, paymentId) {
  const rows = await pool.query(
    `SELECT event_key, event_type
       FROM communication_event_outbox
      WHERE source_entity_id = $1
        AND event_type = 'finance.payment.recorded'
      ORDER BY occurred_at, id`,
    [paymentId],
  );
  return rows.rows;
}

async function seedSchool(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'CD-C4-BOOT', 'C4 Bootstrap', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  const user = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, role, status)
     VALUES ($1, 'USR-C4-BOOT', 'Ada', 'Admin', 'admin', 'active') RETURNING id`,
    [school.rows[0].id],
  );
  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'STU-C4-BOOT', 'Lea', 'Eleve', 'active') RETURNING id`,
    [school.rows[0].id],
  );
  return {
    schoolId: school.rows[0].id,
    userId: user.rows[0].id,
    studentId: student.rows[0].id,
  };
}

async function insertPayment(pool, { id, schoolId, studentId, userId, paymentCode, paymentStatus, cancelledAt }) {
  if (cancelledAt === undefined) {
    await pool.query(
      `INSERT INTO payments (id, school_id, student_id, payment_code, payment_status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, schoolId, studentId, paymentCode, paymentStatus, userId],
    );
    return;
  }
  await pool.query(
    `INSERT INTO payments (id, school_id, student_id, payment_code, payment_status, created_by, cancelled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, schoolId, studentId, paymentCode, paymentStatus, userId, cancelledAt],
  );
}

async function main() {
  if (!DATABASE_URL) {
    console.log("communicationsC4.bootstrap.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(schema);

    await pool.query("DROP TABLE IF EXISTS payments CASCADE");
    await pool.query(`
      CREATE TABLE payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        student_id UUID NOT NULL REFERENCES students(id),
        payment_code VARCHAR(64) NOT NULL UNIQUE,
        payment_status TEXT NOT NULL,
        created_by UUID REFERENCES users(id)
      )
    `);
    assert.equal(await paymentColumnExists(pool, "cancelled_at"), false, "CAS A payments sans cancelled_at");

    await ensureClientsCanonicalBootstrap(pool, QUIET);

    const triggerA = await paymentTriggerDef(pool);
    assert.match(triggerA, /UPDATE OF payment_status ON/, "CAS A trigger payment_status");
    assert.doesNotMatch(triggerA, /cancelled_at/, "CAS A trigger sans cancelled_at");

    const { schoolId, userId, studentId } = await seedSchool(pool);

    const pendingId = randomUUID();
    await insertPayment(pool, {
      id: pendingId,
      schoolId,
      studentId,
      userId,
      paymentCode: "PAY-C4-PEND",
      paymentStatus: "pending",
    });
    assert.equal((await outboxForPayment(pool, pendingId)).length, 0, "CAS A pending sans event");

    await pool.query(`UPDATE payments SET payment_status = 'paid' WHERE id = $1`, [pendingId]);
    const pendingEvents = await outboxForPayment(pool, pendingId);
    assert.equal(pendingEvents.length, 1, "CAS A pending → paid produit exactement 1 outbox event");
    assert.equal(pendingEvents[0].event_key, `finance.payment.recorded:${pendingId}`);
    assert.equal(pendingEvents[0].event_type, "finance.payment.recorded");

    await pool.query(`UPDATE payments SET payment_status = 'paid' WHERE id = $1`, [pendingId]);
    assert.equal((await outboxForPayment(pool, pendingId)).length, 1, "CAS A UPDATE déjà paid sans doublon");

    // CAS B — colonne Finance, pas une redéfinition C4.
    await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`);
    assert.equal(await paymentColumnExists(pool, "cancelled_at"), true, "CAS B cancelled_at présent (Finance)");

    await applyCommunicationsC4Schema(pool);
    await ensureClientsCanonicalBootstrap(pool, QUIET);

    const triggerB = await paymentTriggerDef(pool);
    assert.match(triggerB, /UPDATE OF payment_status, cancelled_at ON/, "CAS B trigger payment_status, cancelled_at");

    const paidId = randomUUID();
    await insertPayment(pool, {
      id: paidId,
      schoolId,
      studentId,
      userId,
      paymentCode: "PAY-C4-PAID",
      paymentStatus: "paid",
      cancelledAt: null,
    });
    const paidEvents = await outboxForPayment(pool, paidId);
    assert.equal(paidEvents.length, 1, "CAS B paid non cancelled = event");
    assert.equal(paidEvents[0].event_key, `finance.payment.recorded:${paidId}`);

    await pool.query(`UPDATE payments SET payment_status = 'paid' WHERE id = $1`, [paidId]);
    assert.equal((await outboxForPayment(pool, paidId)).length, 1, "CAS B update déjà paid = aucun doublon");

    const cancelledId = randomUUID();
    await insertPayment(pool, {
      id: cancelledId,
      schoolId,
      studentId,
      userId,
      paymentCode: "PAY-C4-CANC",
      paymentStatus: "paid",
      cancelledAt: new Date().toISOString(),
    });
    assert.equal((await outboxForPayment(pool, cancelledId)).length, 0, "CAS B cancelled = pas d'event parasite");

    await pool.query(`UPDATE payments SET cancelled_at = NOW() WHERE id = $1`, [paidId]);
    assert.equal((await outboxForPayment(pool, paidId)).length, 1, "CAS B cancel d'un paid déjà émis sans nouvel event");
  } finally {
    await pool.end();
  }

  console.log("communicationsC4.bootstrap.pg.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
