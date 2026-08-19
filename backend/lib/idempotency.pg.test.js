"use strict";

/**
 * Idempotence PostgreSQL : verrou advisory, UNIQUE cache_id, hash mismatch, concurrence.
 */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  IdempotencyService,
  withIdempotency,
  lockInt,
  IDEMPOTENCY_KEY_REUSED,
} = require("../services/idempotencyService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
let Pool = null;
try {
  ({ Pool } = require("pg"));
} catch {
  Pool = null;
}
const shouldRun = Boolean(DATABASE_URL && Pool);

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

test("PG idempotency lock + replay + 409 hash + concurrence finance-like", { skip: !shouldRun }, async () => {
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

    const repo = {
      async findIdempotencyRecord(cacheId) {
        const result = await pool.query(
          `SELECT cache_id, request_hash, status_code, response_body, expires_at
           FROM idempotency_keys WHERE cache_id = $1 LIMIT 1`,
          [String(cacheId)],
        );
        return result.rows[0] ?? null;
      },
      async saveIdempotencyRecord(row) {
        await pool.query(
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
      async withIdempotencyLock(cacheId, fn) {
        const client = await pool.connect();
        const lockKey = lockInt(cacheId);
        try {
          await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
          return await fn();
        } finally {
          try {
            await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
          } catch {
            /* ignore */
          }
          client.release();
        }
      },
    };

    const service = new IdempotencyService(repo);
    const payload = { studentId: "stu-esther", items: [{ feeType: "Minerval", amount: 541 }], totalAmount: 541 };
    const key = "lot5-pg-payment-key";
    let handlerRuns = 0;
    const handler = async () => {
      handlerRuns += 1;
      const inserted = await pool.query(
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
    const probeAfter = await pool.query(`SELECT count(*)::int AS n FROM idempotency_payment_probe WHERE id = $1`, [
      `LOT5-${key}`,
    ]);
    assert.equal(probeAfter.rows[0].n, 1);
  } finally {
    await pool.end();
  }
});
