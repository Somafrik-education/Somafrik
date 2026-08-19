"use strict";

/**
 * Idempotence PostgreSQL : transaction unique (claim + mutation + résultat),
 * crash avant stockage, concurrence, 409 hash.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, test } = require("node:test");
const {
  IdempotencyService,
  withIdempotency,
  lockInt,
  IDEMPOTENCY_KEY_REUSED,
  setIdempotencyBeforeStoreHook,
} = require("../services/idempotencyService");
const { getIdempotencyTx, runWithIdempotencyTx } = require("./idempotencyTxContext");
const { createTxAdapter } = require("../db/txAdapter");
const { createFinancePgStore } = require("../db/financePgStore");
const { FINANCE_SCHEMA_SQL } = require("../db/financeSchema");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
let Pool = null;
try {
  ({ Pool } = require("pg"));
} catch {
  Pool = null;
}
const shouldRun = Boolean(DATABASE_URL && Pool);
if (process.env.CI && !shouldRun) {
  throw new Error("DATABASE_URL + pg requis en CI pour l'idempotence PostgreSQL atomique");
}
const IT_DATABASE = String(process.env.SOMAFRIK_IDEMPOTENCY_IT_DATABASE ?? "somafrik_idempotency_it")
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

function mockHttp(key, body, service) {
  const res = {
    statusCode: 0,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  const req = {
    body,
    get(header) {
      return String(header).toLowerCase() === "idempotency-key" ? key : undefined;
    },
    app: { locals: { idempotencyService: service } },
  };
  return { req, res };
}

function createAtomicRepo(pool) {
  const repo = {
    async query(sql, params = []) {
      const current = getIdempotencyTx();
      if (current?.tx) return current.tx.query(sql, params);
      return pool.query(sql, params);
    },
    async one(sql, params = []) {
      const result = await this.query(sql, params);
      return result.rows[0] ?? null;
    },
    async all(sql, params = []) {
      const result = await this.query(sql, params);
      return result.rows;
    },
    createTxScope(tx) {
      return {
        query: (sql, params) => tx.query(sql, params),
        one: (sql, params) => tx.one(sql, params),
        all: (sql, params) => tx.all(sql, params),
        withTransaction: async (fn) => fn(tx),
      };
    },
    async withTransaction(fn) {
      const current = getIdempotencyTx();
      if (current?.tx) return fn(current.tx);
      const client = await pool.connect();
      const tx = createTxAdapter(client);
      try {
        await client.query("BEGIN");
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
    async findIdempotencyRecord(cacheId) {
      const result = await this.query(
        `SELECT cache_id, request_hash, status_code, response_body, expires_at
         FROM idempotency_keys WHERE cache_id = $1 LIMIT 1`,
        [String(cacheId)],
      );
      return result.rows[0] ?? null;
    },
    async saveIdempotencyRecord(row) {
      await this.query(
        `INSERT INTO idempotency_keys (
           cache_id, route_key, principal_id, school_scope, request_hash, status_code, response_body, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         ON CONFLICT (cache_id) DO UPDATE SET
           status_code = EXCLUDED.status_code,
           response_body = EXCLUDED.response_body,
           expires_at = EXCLUDED.expires_at,
           request_hash = EXCLUDED.request_hash
         WHERE idempotency_keys.request_hash = ''
            OR idempotency_keys.request_hash = EXCLUDED.request_hash`,
        [
          row.cacheId,
          row.routeKey,
          row.principalId,
          row.schoolScope,
          row.requestHash,
          row.statusCode,
          JSON.stringify(row.responseBody ?? {}),
          row.expiresAt,
        ],
      );
    },
    async withIdempotencyTransaction(cacheId, fn) {
      const client = await pool.connect();
      const tx = createTxAdapter(client);
      const lockKey = lockInt(cacheId);
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);
        const result = await runWithIdempotencyTx({ tx, client }, fn);
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
  };
  return repo;
}

describe("idempotency PostgreSQL atomique", { concurrency: false, skip: !shouldRun }, () => {
test("PG idempotency lock + replay + 409 hash + concurrence", async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        cache_id TEXT PRIMARY KEY,
        route_key TEXT NOT NULL,
        principal_id TEXT NOT NULL DEFAULT '',
        school_scope TEXT NOT NULL DEFAULT '',
        request_hash TEXT NOT NULL DEFAULT '',
        status_code INTEGER NOT NULL,
        response_body JSONB NOT NULL DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS school_scope TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS request_hash TEXT NOT NULL DEFAULT ''`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS idempotency_payment_probe (
        id TEXT PRIMARY KEY,
        reference TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`DELETE FROM idempotency_payment_probe WHERE id LIKE 'LOT5-%'`);
    await pool.query(`DELETE FROM idempotency_keys WHERE cache_id LIKE '%lot5-pg%'`);

    const repo = createAtomicRepo(pool);
    const service = new IdempotencyService(repo);
    const payload = { studentId: "stu-esther", items: [{ feeType: "Minerval", amount: 541 }], totalAmount: 541 };
    const key = "lot5-pg-payment-key";
    let handlerRuns = 0;
    const handler = async () => {
      handlerRuns += 1;
      const q = getIdempotencyTx()?.tx?.query?.bind(getIdempotencyTx().tx) ?? pool.query.bind(pool);
      const inserted = await q(
        `INSERT INTO idempotency_payment_probe (id, reference)
         VALUES ($1, $2)
         RETURNING id, reference`,
        [`LOT5-${key}`, "PAY-LOT5-0001"],
      );
      return { statusCode: 201, body: inserted.rows[0] };
    };

    const first = mockHttp(key, payload, service);
    const second = mockHttp(key, payload, service);
    const principal = { sub: "acc-pg", schoolCode: "CD-2026-0001" };
    await Promise.all([
      withIdempotency({ req: first.req, res: first.res, routeKey: "POST /api/payments", principal, handler }),
      withIdempotency({ req: second.req, res: second.res, routeKey: "POST /api/payments", principal, handler }),
    ]);

    const probe = await pool.query(`SELECT id, reference FROM idempotency_payment_probe WHERE id = $1`, [`LOT5-${key}`]);
    assert.equal(probe.rowCount, 1, "une seule ligne payment probe");
    assert.equal(handlerRuns, 1, "une seule mutation exécutée");
    assert.equal(first.res.payload.id, second.res.payload.id);
    assert.equal(first.res.payload.reference, "PAY-LOT5-0001");
    assert.equal(second.res.payload.reference, "PAY-LOT5-0001");

    const mismatch = mockHttp(key, { ...payload, totalAmount: 999 }, service);
    await assert.rejects(
      () =>
        withIdempotency({
          req: mismatch.req,
          res: mismatch.res,
          routeKey: "POST /api/payments",
          principal,
          handler,
        }),
      (error) => error.statusCode === 409 && error.code === IDEMPOTENCY_KEY_REUSED,
    );
  } finally {
    await pool.end();
  }
});

test("PG Finance : crash avant stockage idempotence rollback le paiement", async () => {
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
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const school = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'Lycée A', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [school.rows[0].id],
    );
    const klass = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6A', '6ème A', 'active') RETURNING id`,
      [school.rows[0].id, year.rows[0].id],
    );
    const student = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, 'CD-2026-0001-STU-ESTHER', 'Esther', 'Okito') RETURNING id`,
      [school.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [school.rows[0].id, student.rows[0].id, klass.rows[0].id, year.rows[0].id],
    );
    const user = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
       VALUES ($1, 'USR-IDEM-IT-ADMIN', 'Admin', 'A', 'admin-idem-it@somafrik.test', 'SCHOOL_ADMIN', 'active')
       RETURNING id`,
      [school.rows[0].id],
    );

    const repo = createAtomicRepo(pool);
    const store = createFinancePgStore(repo);
    const service = new IdempotencyService(repo);
    const admin = {
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      firstName: "Admin",
      lastName: "A",
      sub: user.rows[0].id,
    };
    const payload = {
      studentId: "CD-2026-0001-STU-ESTHER",
      items: [
        { feeType: "Minerval / scolarité", amount: 500 },
        { feeType: "Frais d'examen", amount: 1 },
        { feeType: "Frais de cantine", amount: 40 },
      ],
      paymentMethod: "cash",
      paidAt: "2026-08-19",
      totalAmount: 541,
    };
    const key = "550e8400-e29b-41d4-a716-446655440000";
    const handler = async () => {
      const payment = await store.createSchoolPayment(payload, admin);
      return { statusCode: 201, body: payment };
    };

    setIdempotencyBeforeStoreHook(() => {
      throw new Error("crash after payment insert, before idempotency store");
    });
    const crashed = mockHttp(key, payload, service);
    await assert.rejects(
      () =>
        withIdempotency({
          req: crashed.req,
          res: crashed.res,
          routeKey: "POST /api/payments",
          principal: admin,
          handler,
        }),
      (error) => String(error.message).includes("before idempotency store"),
    );
    setIdempotencyBeforeStoreHook(null);

    const paymentsAfterCrash = await pool.query("SELECT * FROM payments");
    const itemsAfterCrash = await pool.query("SELECT * FROM payment_items");
    assert.equal(paymentsAfterCrash.rowCount, 0, "rollback : aucun payment");
    assert.equal(itemsAfterCrash.rowCount, 0, "rollback : aucun payment_item");

    const retry = mockHttp(key, payload, service);
    await withIdempotency({
      req: retry.req,
      res: retry.res,
      routeKey: "POST /api/payments",
      principal: admin,
      handler,
    });
    assert.equal(retry.res.statusCode, 201);
    const createdId = retry.res.payload.id;
    const createdRef = retry.res.payload.reference;
    assert.match(String(createdRef), /PAY-/);
    assert.equal(retry.res.payload.totalAmount, 541);

    const payments = await pool.query("SELECT * FROM payments");
    const items = await pool.query("SELECT * FROM payment_items");
    assert.equal(payments.rowCount, 1, "1 payment");
    assert.equal(items.rowCount, 3, "3 payment_items");
    const refs = new Set(payments.rows.map((row) => row.payment_code));
    assert.equal(refs.size, 1, "1 référence");

    const replay = mockHttp(key, payload, service);
    await withIdempotency({
      req: replay.req,
      res: replay.res,
      routeKey: "POST /api/payments",
      principal: admin,
      handler,
    });
    assert.equal(replay.res.payload.id, createdId);
    assert.equal(replay.res.payload.reference, createdRef);
    const paymentsAfterReplay = await pool.query("SELECT * FROM payments");
    const itemsAfterReplay = await pool.query("SELECT * FROM payment_items");
    assert.equal(paymentsAfterReplay.rowCount, 1);
    assert.equal(itemsAfterReplay.rowCount, 3);
  } finally {
    setIdempotencyBeforeStoreHook(null);
    await pool.end();
  }
});
});
