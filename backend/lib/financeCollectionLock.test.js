"use strict";

/**
 * FIN-SEC-01 — un encaissement scolaire exige une obligation ouverte
 * et ne peut pas dépasser le solde encore dû.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { studentMatchesClassScope } = require("./financeManagement");
const { F4_ERROR } = require("./financeService");
const { IdempotencyService, withIdempotency } = require("../services/idempotencyService");

const STUDENT = "CD-2026-0001-STU-LOCK";
const admin = {
  role: "Admin School",
  schoolCode: "CD-2026-0001",
  firstName: "Admin",
  lastName: "Lock",
  sub: "USR-LOCK",
  permissions: ["Paiements:UPDATE", "Paiements:CREATE"],
};
const foreign = {
  role: "Admin School",
  schoolCode: "BI-2026-0001",
  firstName: "Foreign",
  lastName: "Admin",
  sub: "USR-LOCK-BI",
  permissions: ["Paiements:UPDATE", "Paiements:CREATE"],
};
const reader = {
  role: "Admin School",
  schoolCode: "CD-2026-0001",
  firstName: "Lecteur",
  lastName: "Lock",
  sub: "USR-LOCK-READ",
  permissions: ["Paiements:READ"],
};

function createStore() {
  const schools = [
    { id: "school-lock", code: "CD-2026-0001", currency: "CDF" },
    { id: "school-bi", code: "BI-2026-0001", currency: "BIF" },
  ];
  const students = [
    {
      id: "student-lock",
      publicId: STUDENT,
      studentCode: STUDENT,
      firstName: "Amina",
      lastName: "Lock",
      schoolCode: "CD-2026-0001",
      classId: "class-lock",
      classCode: "CLS-LOCK",
      className: "6ème A",
      academicYear: "2026-2027",
    },
    {
      id: "student-bi",
      publicId: "BI-2026-0001-STU-LOCK",
      studentCode: "BI-2026-0001-STU-LOCK",
      firstName: "Jean",
      lastName: "Foreign",
      schoolCode: "BI-2026-0001",
      classId: "class-bi",
      classCode: "CLS-BI",
      className: "6ème A",
      academicYear: "2026-2027",
    },
  ];
  return createFinanceMemoryStore({
    getSchoolByCode: async (code) => schools.find((row) => row.code === String(code).trim().toUpperCase()) || null,
    findStudent: async (key, principal) => {
      const scope = String(principal?.schoolCode || "").toUpperCase();
      return (
        students.find((student) => {
          if (scope && scope !== "*" && student.schoolCode !== scope) return false;
          return [student.id, student.publicId, student.studentCode].includes(key);
        }) || null
      );
    },
    listStudentsInClass: async (schoolCode, classRef) =>
      students.filter((student) => student.schoolCode === schoolCode && studentMatchesClassScope(student, classRef)),
    getClassById: async (classId) => {
      if (classId === "class-lock") {
        return { classId, schoolId: "school-lock", classCode: "CLS-LOCK", className: "6ème A", schoolCode: "CD-2026-0001" };
      }
      if (classId === "class-bi") {
        return { classId, schoolId: "school-bi", classCode: "CLS-BI", className: "6ème A", schoolCode: "BI-2026-0001" };
      }
      return null;
    },
  });
}

async function seed(store, { tuition = 30_000, transport = 20_000 } = {}) {
  const grid = await store.upsertFinanceFeeGrid(
    {
      classId: "class-lock",
      className: "6ème A",
      academicYear: "2026-2027",
      currency: "CDF",
      status: "Active",
      items: [
        { feeType: "Scolarité", label: "Scolarité", amount: tuition, periodLabel: "Septembre", status: "Actif" },
        { feeType: "Transport", label: "Transport", amount: transport, periodLabel: "Septembre", status: "Actif" },
      ],
    },
    admin,
  );
  await store.setFinanceFeeGridStatus(grid.id, "Active", admin);
  await store.applyFinanceFeeGrid(grid.id, admin);
  const fees = await store.listFinanceStudentFees(admin);
  return {
    tuition: fees.find((row) => row.feeType === "Scolarité"),
    transport: fees.find((row) => row.feeType === "Transport"),
  };
}

function pay(store, items, principal = admin) {
  return store.createSchoolPayment(
    {
      studentId: STUDENT,
      classId: "class-lock",
      items,
      method: "Espèces",
      date: "2026-11-02",
    },
    principal,
  );
}

describe("FIN-SEC-01 verrouillage des encaissements", () => {
  it("refuse 422 lorsqu'aucune obligation n'est enregistrée", async () => {
    const store = createStore();
    const before = store.tables.studentFees.length;
    await assert.rejects(
      () => pay(store, [{ feeType: "Non imputé", amount: 1_000 }]),
      (error) => error.statusCode === 422 && error.code === F4_ERROR.NO_OPEN_OBLIGATION,
    );
    assert.equal(store.tables.payments.length, 0);
    assert.equal(store.tables.studentFees.length, before, "aucune obligation créée par l'encaissement");
  });

  it("refuse 422 lorsque toutes les obligations sont soldées", async () => {
    const store = createStore();
    const { tuition, transport } = await seed(store, { tuition: 100, transport: 50 });
    await pay(store, [
      { obligationId: tuition.id, amount: 100 },
      { obligationId: transport.id, amount: 50 },
    ]);
    await assert.rejects(
      () => pay(store, [{ obligationId: tuition.id, amount: 1 }]),
      (error) => error.statusCode === 422 && error.code === F4_ERROR.OBLIGATIONS_SETTLED,
    );
    assert.equal(store.tables.payments.length, 1);
  });

  it("accepte le paiement exact et le paiement partiel", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    const partial = await pay(store, [{ obligationId: tuition.id, feeType: "Scolarité", amount: 10_000 }]);
    assert.equal(partial.status, "Partiel");
    assert.equal(partial.allocatedAmount, 10_000);
    assert.equal(partial.unallocatedAmount, 0);
    let fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(fee.balance, 20_000);
    assert.equal(fee.status, "Partiellement payé");

    const exact = await pay(store, [{ obligationId: tuition.id, amount: 20_000 }]);
    assert.equal(exact.status, "Payé");
    assert.equal(exact.unallocatedAmount, 0);
    fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(fee.balance, 0);
    assert.equal(fee.status, "Payé");
  });

  it("refuse un dépassement de 1 CDF et laisse le solde intact", async () => {
    const store = createStore();
    const { tuition } = await seed(store, { tuition: 100, transport: 100 });
    await assert.rejects(
      () => pay(store, [{ obligationId: tuition.id, amount: 101 }]),
      (error) =>
        error.statusCode === 422 &&
        error.code === F4_ERROR.PAYMENT_EXCEEDS_BALANCE &&
        /1 CDF/.test(error.message),
    );
    const fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(fee.balance, 100);
    assert.equal(fee.amountPaid, 0);
    assert.equal(store.tables.payments.length, 0);
  });

  it("affecte plusieurs obligations sans dépasser le plafond de chacune", async () => {
    const store = createStore();
    const { tuition, transport } = await seed(store);
    const beforeCount = (await store.listFinanceStudentFees(admin)).length;
    const payment = await pay(store, [
      { obligationId: tuition.id, amount: 12_000 },
      { obligationId: transport.id, amount: 5_000 },
    ]);
    assert.equal(payment.amount, 17_000);
    assert.equal(payment.allocatedAmount, 17_000);
    assert.equal(payment.unallocatedAmount, 0);
    assert.equal(store.tables.allocations.length, 2);
    const fees = await store.listFinanceStudentFees(admin);
    assert.equal(fees.length, beforeCount, "pas de création d'obligation");
    assert.equal(fees.find((row) => row.id === tuition.id).balance, 18_000);
    assert.equal(fees.find((row) => row.id === transport.id).balance, 15_000);

    await assert.rejects(
      () =>
        pay(store, [
          { obligationId: tuition.id, amount: 10_000 },
          { obligationId: tuition.id, amount: 10_000 },
        ]),
      (error) => error.statusCode === 422 && error.code === F4_ERROR.PAYMENT_EXCEEDS_BALANCE,
    );
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(after.balance, 18_000);
  });

  it("interdit l'avance, le non affecté et le montant nul ou négatif", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    await assert.rejects(
      () => pay(store, [{ feeType: "Non imputé", amount: 500 }]),
      (error) => error.statusCode === 422 && error.code === F4_ERROR.UNALLOCATED_FORBIDDEN,
    );
    await assert.rejects(
      () => pay(store, [{ feeType: "Scolarité", amount: 500 }]),
      (error) => error.statusCode === 400 && error.code === F4_ERROR.OBLIGATION_ID_REQUIRED,
    );
    await assert.rejects(
      () => pay(store, [{ obligationId: tuition.id, amount: 0 }]),
      (error) => error.statusCode === 400,
    );
    await assert.rejects(
      () => pay(store, [{ obligationId: tuition.id, amount: -5 }]),
      (error) => error.statusCode === 400,
    );
    const fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(fee.balance, 30_000);
  });

  it("conserve un reçu historique non affecté et restaure la dette à l'annulation", async () => {
    const store = createStore();
    const { tuition } = await seed(store, { tuition: 80, transport: 20 });
    store.tables.payments.push({
      id: "hist-unallocated",
      payment_code: "HIST-NON-AFFECTE",
      school_id: "school-lock",
      student_id: "student-lock",
      amount: 150,
      currency: "CDF",
      payment_method: "Espèces",
      payment_status: "paid",
      payment_date: "2026-01-01",
      cancelled_at: null,
      profile_payload: {
        status: "Non imputé",
        amount: 150,
        allocatedAmount: 0,
        unallocatedAmount: 150,
        studentId: STUDENT,
        schoolCode: "CD-2026-0001",
      },
    });
    const payment = await pay(store, [{ obligationId: tuition.id, amount: 30 }]);
    await store.cancelSchoolPayment(payment.reference, "Erreur de saisie", admin);
    const fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(fee.balance, 80);
    assert.equal(fee.amountPaid, 0);
    const historical = store.tables.payments.find((row) => row.payment_code === "HIST-NON-AFFECTE");
    assert.equal(Number(historical.amount), 150);
    assert.equal(historical.cancelled_at, null);
    const cancelled = store.tables.payments.find((row) => row.payment_code === payment.reference);
    assert.ok(cancelled, "l'annulation conserve le reçu");
  });

  it("isole l'établissement et exige la permission d'annulation", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: STUDENT,
            items: [{ obligationId: tuition.id, amount: 10 }],
            method: "Espèces",
            date: "2026-11-02",
          },
          foreign,
        ),
      (error) => error.statusCode === 404 || error.statusCode === 403,
    );
    const payment = await pay(store, [{ obligationId: tuition.id, amount: 10 }]);
    await assert.rejects(
      () => store.cancelSchoolPayment(payment.reference, "Sans droit", reader),
      (error) => error.statusCode === 403,
    );
    const fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(fee.balance, 29_990);
  });

  it("rejoue la même clé sans second encaissement et refuse un second paiement qui dépasse", async () => {
    const store = createStore();
    const { tuition } = await seed(store, { tuition: 40, transport: 10 });
    const records = new Map();
    const service = new IdempotencyService({
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
    });
    const body = {
      studentId: STUDENT,
      classId: "class-lock",
      items: [{ obligationId: tuition.id, amount: 40 }],
      method: "Espèces",
      date: "2026-11-02",
    };
    let runs = 0;
    const handler = async () => {
      runs += 1;
      const payment = await pay(store, body.items);
      return { statusCode: 201, body: payment };
    };
    const http = (key, payload) => ({
      req: {
        body: payload,
        get: (header) => (String(header).toLowerCase() === "idempotency-key" ? key : undefined),
        app: { locals: { idempotencyService: service } },
      },
      res: {
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
      },
    });
    const first = http("key-lock-1", body);
    await withIdempotency({
      req: first.req,
      res: first.res,
      routeKey: "POST /api/payments",
      principal: admin,
      handler,
    });
    const replay = http("key-lock-1", body);
    await withIdempotency({
      req: replay.req,
      res: replay.res,
      routeKey: "POST /api/payments",
      principal: admin,
      handler,
    });
    assert.equal(runs, 1);
    assert.equal(replay.res.statusCode, 201);
    assert.equal(replay.res.payload.idempotentReplay, true);
    assert.equal(store.tables.payments.filter((row) => row.payment_code !== "HIST-NON-AFFECTE").length, 1);

    const transport = (await store.listFinanceStudentFees(admin)).find((row) => row.feeType === "Transport");
    await assert.rejects(
      () => pay(store, [{ obligationId: transport.id, amount: 11 }]),
      (error) => error.statusCode === 422 && error.code === F4_ERROR.PAYMENT_EXCEEDS_BALANCE,
    );
  });
});
