"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  IdempotencyService,
  withIdempotency,
  hashPayload,
  IDEMPOTENCY_KEY_REUSED,
} = require("../services/idempotencyService");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");

function createMemoryRepo() {
  const records = new Map();
  return {
    records,
    async findIdempotencyRecord(cacheId) {
      return records.get(String(cacheId)) ?? null;
    },
    async saveIdempotencyRecord(row) {
      records.set(String(row.cacheId), {
        cache_id: String(row.cacheId),
        route_key: row.routeKey,
        principal_id: row.principalId,
        school_scope: row.schoolScope,
        request_hash: row.requestHash,
        status_code: row.statusCode,
        response_body: row.responseBody,
        expires_at: row.expiresAt,
      });
    },
  };
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

test("même clé + même payload rejoue le résultat original sans rerun", async () => {
  const service = new IdempotencyService(createMemoryRepo());
  let runs = 0;
  const handler = async () => {
    runs += 1;
    return { statusCode: 201, body: { id: "note-1", evaluationId: "ev-1" } };
  };
  const first = mockHttp("key-a", { evaluationId: "ev-1", studentId: "s1", value: 12 }, service);
  await withIdempotency({
    req: first.req,
    res: first.res,
    routeKey: "POST /api/notes",
    principal: { sub: "teacher-1", schoolCode: "CD-2026-0001" },
    handler,
  });
  const second = mockHttp("key-a", { evaluationId: "ev-1", studentId: "s1", value: 12 }, service);
  await withIdempotency({
    req: second.req,
    res: second.res,
    routeKey: "POST /api/notes",
    principal: { sub: "teacher-1", schoolCode: "CD-2026-0001" },
    handler,
  });
  assert.equal(runs, 1);
  assert.equal(first.res.statusCode, 201);
  assert.equal(second.res.statusCode, 201);
  assert.equal(second.res.payload.id, "note-1");
  assert.equal(second.res.payload.idempotentReplay, true);
});

test("même clé + payload différent → 409 IDEMPOTENCY_KEY_REUSED", async () => {
  const service = new IdempotencyService(createMemoryRepo());
  const first = mockHttp("key-b", { amount: 541 }, service);
  await withIdempotency({
    req: first.req,
    res: first.res,
    routeKey: "POST /api/payments",
    principal: { sub: "acc-1", schoolCode: "CD-2026-0001" },
    handler: async () => ({ statusCode: 201, body: { id: "pay-1" } }),
  });
  const second = mockHttp("key-b", { amount: 999 }, service);
  await assert.rejects(
    () =>
      withIdempotency({
        req: second.req,
        res: second.res,
        routeKey: "POST /api/payments",
        principal: { sub: "acc-1", schoolCode: "CD-2026-0001" },
        handler: async () => ({ statusCode: 201, body: { id: "pay-2" } }),
      }),
    (error) => error.statusCode === 409 && error.code === IDEMPOTENCY_KEY_REUSED,
  );
});

test("échec métier n'enregistre pas un succès d'idempotence", async () => {
  const repo = createMemoryRepo();
  const service = new IdempotencyService(repo);
  const first = mockHttp("key-fail", { studentId: "s1" }, service);
  await assert.rejects(
    () =>
      withIdempotency({
        req: first.req,
        res: first.res,
        routeKey: "POST /api/presences",
        principal: { sub: "teacher-1", schoolCode: "CD-2026-0001" },
        handler: async () => {
          const error = new Error("validation");
          error.statusCode = 400;
          throw error;
        },
      }),
  );
  assert.equal(repo.records.size, 0);
  let runs = 0;
  const second = mockHttp("key-fail", { studentId: "s1" }, service);
  await withIdempotency({
    req: second.req,
    res: second.res,
    routeKey: "POST /api/presences",
    principal: { sub: "teacher-1", schoolCode: "CD-2026-0001" },
    handler: async () => {
      runs += 1;
      return { statusCode: 201, body: [{ id: "pre-1" }] };
    },
  });
  assert.equal(runs, 1);
  assert.equal(Array.isArray(second.res.payload), true);
});

test("deux requêtes concurrentes même clé → une mutation, deux réponses cohérentes", async () => {
  const service = new IdempotencyService(createMemoryRepo());
  let runs = 0;
  const handler = async () => {
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { statusCode: 201, body: { id: "msg-1", message: "bonjour" } };
  };
  const a = mockHttp("key-conc", { message: "bonjour" }, service);
  const b = mockHttp("key-conc", { message: "bonjour" }, service);
  const principal = { sub: "user-1", schoolCode: "CD-2026-0001" };
  await Promise.all([
    withIdempotency({ req: a.req, res: a.res, routeKey: "POST /api/backoffice/messages", principal, handler }),
    withIdempotency({ req: b.req, res: b.res, routeKey: "POST /api/backoffice/messages", principal, handler }),
  ]);
  assert.equal(runs, 1);
  assert.equal(a.res.payload.id, "msg-1");
  assert.equal(b.res.payload.id, "msg-1");
});

test("Finance : retry même clé → même payment.id / référence, aucun second reçu", async () => {
  const schools = [{ id: "school-a", code: "CD-2026-0001", currency: "CDF" }];
  const students = [
    {
      id: "stu-esther",
      publicId: "CD-2026-0001-STU-ESTHER",
      studentCode: "CD-2026-0001-STU-ESTHER",
      firstName: "Esther",
      lastName: "Okito",
      schoolCode: "CD-2026-0001",
      classId: "class-6a",
      classCode: "CLS-6A",
      className: "6ème A",
    },
  ];
  const store = createFinanceMemoryStore({
    getSchoolByCode: async (code) =>
      schools.find((row) => row.code === String(code).trim().toUpperCase()) ?? null,
    findStudent: async (studentKey) =>
      students.find((student) => [student.id, student.publicId, student.studentCode].includes(studentKey)) ?? null,
    listStudentsInClass: async () => students,
  });
  const admin = {
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    firstName: "Admin",
    lastName: "School",
    sub: "USR-MEM-ADMIN",
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
  const service = new IdempotencyService(createMemoryRepo());
  const handler = async () => {
    const payment = await store.createSchoolPayment(payload, admin);
    return { statusCode: 201, body: payment };
  };

  const first = mockHttp("550e8400-e29b-41d4-a716-446655440000", payload, service);
  await withIdempotency({
    req: first.req,
    res: first.res,
    routeKey: "POST /api/payments",
    principal: admin,
    handler,
  });
  assert.equal(store.tables.payments.length, 1);
  assert.equal(store.tables.paymentItems.length, 3);
  const createdId = first.res.payload.id;
  const createdRef = first.res.payload.reference;

  const lostResponseRetry = mockHttp("550e8400-e29b-41d4-a716-446655440000", payload, service);
  await withIdempotency({
    req: lostResponseRetry.req,
    res: lostResponseRetry.res,
    routeKey: "POST /api/payments",
    principal: admin,
    handler,
  });

  assert.equal(store.tables.payments.length, 1, "aucun second reçu");
  assert.equal(store.tables.paymentItems.length, 3, "aucun second payment_item");
  assert.equal(lostResponseRetry.res.payload.id, createdId);
  assert.equal(lostResponseRetry.res.payload.reference, createdRef);
  assert.equal(lostResponseRetry.res.payload.idempotentReplay, true);
  assert.equal(lostResponseRetry.res.payload.totalAmount, 541);
});

test("TTL : POST /api/presences a un TTL offline >= 35 jours, notes restent 24 h, paiements 7 j", () => {
  const {
    ttlForRoute,
    TTL_DEFAULT_MS,
    TTL_PAYMENTS_MS,
    TTL_OFFLINE_REPLAY_MS,
  } = require("../services/idempotencyService");
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const thirtyFiveDays = 35 * 24 * 60 * 60 * 1000;
  assert.equal(TTL_DEFAULT_MS, 24 * 60 * 60 * 1000);
  assert.equal(TTL_PAYMENTS_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(TTL_OFFLINE_REPLAY_MS, thirtyFiveDays);
  assert.ok(TTL_OFFLINE_REPLAY_MS > thirtyDays);
  assert.equal(ttlForRoute("POST /api/presences"), TTL_OFFLINE_REPLAY_MS);
  assert.equal(ttlForRoute("POST /api/notes"), TTL_DEFAULT_MS);
  assert.equal(ttlForRoute("POST /api/payments"), TTL_PAYMENTS_MS);
  assert.equal(ttlForRoute("POST /api/students"), TTL_DEFAULT_MS);
});

test("hashPayload ignore le scope client forgé (schoolCode/createdBy)", () => {
  assert.equal(
    hashPayload({ amount: 25000, schoolCode: "BI-2026-0001", createdBy: "forged" }),
    hashPayload({ amount: 25000 }),
  );
  assert.notEqual(hashPayload({ amount: 25000 }), hashPayload({ amount: 1 }));
});

test("crash avant stockage : rollback mutation, retry même clé = une seule écriture", async () => {
  const { getIdempotencyTx, runWithIdempotencyTx } = require("./idempotencyTxContext");
  const {
    setIdempotencyBeforeStoreHook,
  } = require("../services/idempotencyService");
  const payments = [];
  const records = new Map();
  let committedPayments = [];
  const repo = {
    async query(sql, params = []) {
      const current = getIdempotencyTx();
      if (!current?.pending) return;
      if (String(sql).includes("INSERT INTO payments")) {
        current.pending.payments.push({ id: "pay-atomic", reference: "PAY-1", items: 3 });
      }
      return { rows: [] };
    },
    async findIdempotencyRecord(cacheId) {
      return records.get(String(cacheId)) ?? null;
    },
    async saveIdempotencyRecord(row) {
      const current = getIdempotencyTx();
      if (current?.pending) {
        current.pending.records.set(String(row.cacheId), {
          cache_id: String(row.cacheId),
          request_hash: row.requestHash,
          status_code: row.statusCode,
          response_body: row.responseBody,
          expires_at: row.expiresAt,
        });
        return;
      }
      records.set(String(row.cacheId), {
        cache_id: String(row.cacheId),
        request_hash: row.requestHash,
        status_code: row.statusCode,
        response_body: row.responseBody,
        expires_at: row.expiresAt,
      });
    },
    async withIdempotencyTransaction(_cacheId, fn) {
      const pending = { payments: [], records: new Map() };
      try {
        const result = await runWithIdempotencyTx({ tx: true, pending }, fn);
        if (pending.payments.length) {
          committedPayments = pending.payments.slice();
          payments.splice(0, payments.length, ...committedPayments);
        }
        for (const [key, value] of pending.records) records.set(key, value);
        return result;
      } catch (error) {
        committedPayments = [];
        throw error;
      }
    },
  };
  const service = new IdempotencyService(repo);
  const handler = async () => {
    await repo.query("INSERT INTO payments");
    return { statusCode: 201, body: { id: "pay-atomic", reference: "PAY-1", totalAmount: 541 } };
  };
  const principal = { sub: "acc-1", schoolCode: "CD-2026-0001" };
  const payload = { studentId: "stu-esther", totalAmount: 541 };

  try {
    setIdempotencyBeforeStoreHook(() => {
      throw new Error("crash after payment insert, before idempotency store");
    });
    const crashed = mockHttp("crash-key", payload, service);
    await assert.rejects(
      () =>
        withIdempotency({
          req: crashed.req,
          res: crashed.res,
          routeKey: "POST /api/payments",
          principal,
          handler,
        }),
      (error) => String(error.message).includes("before idempotency store"),
    );
    setIdempotencyBeforeStoreHook(null);
    assert.equal(payments.length, 0, "rollback : aucun payment");
    assert.equal(records.size, 0, "rollback : aucune clé d'idempotence");

    const retry = mockHttp("crash-key", payload, service);
    await withIdempotency({
      req: retry.req,
      res: retry.res,
      routeKey: "POST /api/payments",
      principal,
      handler,
    });
    assert.equal(retry.res.statusCode, 201);
    assert.equal(payments.length, 1);
    assert.equal(records.size, 1);

    const replay = mockHttp("crash-key", payload, service);
    await withIdempotency({
      req: replay.req,
      res: replay.res,
      routeKey: "POST /api/payments",
      principal,
      handler,
    });
    assert.equal(replay.res.payload.id, "pay-atomic");
    assert.equal(replay.res.payload.idempotentReplay, true);
    assert.equal(payments.length, 1, "retry + replay = 1 payment");
  } finally {
    setIdempotencyBeforeStoreHook(null);
  }
});
