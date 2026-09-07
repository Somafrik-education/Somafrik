"use strict";

/**
 * FIN-CALC-RED — contrat métier Oscar / trop-perçu.
 * Aucune mutation du runtime. Les assertions décrivent le résultat métier attendu,
 * pas le comportement actuel (Partiel / Partiellement payé).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { studentMatchesClassScope, money } = require("./financeManagement");
const {
  assertPaymentConservation,
  computeObligationBalance,
  obligationStatusFromBalance,
  toMoney,
} = require("./financeDomainInvariants");
const {
  presentPaymentStatus,
  projectPaymentCash,
  PARTIAL_STATUS,
} = require("./financeUnallocatedCash");
const { withIdempotency, IdempotencyService } = require("../services/idempotencyService");

const STUDENT = "CD-IN-26-001-STU-OSCAR";
const SCHOOL_CODE = "CD-IN-26-001";
const CLASS_ID = "class-oscar";

const admin = {
  role: "Admin School",
  schoolCode: SCHOOL_CODE,
  firstName: "Admin",
  lastName: "School",
  sub: "USR-OSCAR-ADMIN",
  permissions: ["Paiements:UPDATE", "Paiements:CREATE", "Impayés:READ"],
};

function createStore({ currency = "CDF" } = {}) {
  const schools = [{ id: "school-oscar", code: SCHOOL_CODE, currency }];
  const students = [
    {
      id: "stu-oscar",
      publicId: STUDENT,
      studentCode: STUDENT,
      firstName: "Oscar",
      lastName: "Mukwege",
      schoolCode: SCHOOL_CODE,
      classId: CLASS_ID,
      classCode: "CLS-OSC",
      className: "6ème A",
      academicYear: "2025-2026",
    },
  ];
  return createFinanceMemoryStore({
    getSchoolByCode: async (code) =>
      schools.find((row) => row.code === String(code).trim().toUpperCase()) || null,
    findStudent: async (key, principal) => {
      const scope = String(principal?.schoolCode || "").toUpperCase();
      return (
        students.find((student) => {
          if (scope && scope !== "*" && student.schoolCode !== scope) return false;
          return [student.id, student.publicId, student.studentCode].includes(String(key));
        }) || null
      );
    },
    listStudentsInClass: async (schoolCode, classRef) =>
      students.filter(
        (student) => student.schoolCode === schoolCode && studentMatchesClassScope(student, classRef),
      ),
    getClassById: async (classId) =>
      classId === CLASS_ID
        ? {
            classId: CLASS_ID,
            schoolId: "school-oscar",
            classCode: "CLS-OSC",
            className: "6ème A",
            schoolCode: SCHOOL_CODE,
          }
        : null,
  });
}

async function seedObligation(store, { amount = 1, label = "Frais scolaire — Septembre", feeType = "Scolarité" } = {}) {
  const grid = await store.upsertFinanceFeeGrid(
    {
      classId: CLASS_ID,
      className: "6ème A",
      academicYear: "2025-2026",
      currency: "CDF",
      status: "Active",
      items: [{ feeType, label, amount, periodLabel: "Septembre", dueDate: "2026-09-01", status: "Actif" }],
    },
    admin,
  );
  await store.setFinanceFeeGridStatus(grid.id, "Active", admin);
  await store.applyFinanceFeeGrid(grid.id, admin);
  const fees = await store.listFinanceStudentFees(admin);
  const fee = fees.find((row) => row.studentId === STUDENT || row.studentCode === STUDENT) || fees[0];
  assert.ok(fee, "obligation Oscar absente après apply grille");
  return fee;
}

function activeAllocations(store, obligationId) {
  return store.tables.allocations.filter(
    (row) => String(row.obligation_id) === String(obligationId) && !row.reversed_at,
  );
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

function assertCashIdentity(payment, { received, allocated, unallocated }) {
  assert.equal(money(payment.amount), money(received), "encaissé");
  assert.equal(money(payment.allocatedAmount), money(allocated), "imputé");
  assert.equal(money(payment.unallocatedAmount), money(unallocated), "non imputé");
  assert.equal(
    money(payment.allocatedAmount) + money(payment.unallocatedAmount),
    money(payment.amount),
    "ENCAISSÉ = IMPUTÉ + NON IMPUTÉ",
  );
  const conserved = assertPaymentConservation({
    amount: payment.amount,
    allocations: [{ amount: payment.allocatedAmount, reversedAt: null }],
    unallocatedAmount: payment.unallocatedAmount,
  });
  assert.equal(conserved.amount, money(received));
}

describe("FIN-CALC-RED — trop-perçu / imputation / statuts", () => {
  it("FIN-CALC-RED-001 overpayment 1 CDF settles obligation and preserves 1 CDF unallocated", async () => {
    const store = createStore();
    const before = await seedObligation(store, { amount: 1 });
    assert.equal(money(before.balance), 1);

    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: before.id, feeType: "Scolarité", amount: 2 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );

    assertCashIdentity(payment, { received: 2, allocated: 1, unallocated: 1 });

    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    assert.equal(money(after.amountDue), money(before.amountDue), "amountDue historique inchangé");
    assert.equal(money(after.balance), 0);
    assert.equal(after.status, "Payé");

    const allocs = activeAllocations(store, after.dbId || after.id);
    assert.equal(allocs.length, 1);
    assert.equal(money(allocs[0].amount), 1, "allocation.amount = 1 CDF");
    assert.notEqual(money(allocs[0].amount), 2, "jamais 2 CDF imputés");

    const raw = store.tables.studentFees.find((row) => String(row.id) === String(after.dbId || after.id));
    const sumAlloc = allocs.reduce((sum, row) => sum + money(row.amount), 0);
    assert.equal(money(raw.amount_paid), sumAlloc, "amount_paid persisté = SUM(allocations actives)");

    const projected = projectPaymentCash(payment, allocs.map((row) => ({ amount: row.amount, reversedAt: null })));
    assert.equal(money(projected.unallocatedAmount), 1);

    // Incident Oscar : le trop-perçu ne doit pas présenter la créance comme « Partiellement payé ».
    assert.equal(after.status, "Payé");
    assert.notEqual(payment.status, PARTIAL_STATUS, "statut paiement ne doit pas être Partiel si la dette est soldée");
    assert.notEqual(
      presentPaymentStatus(payment, allocs.map((row) => ({ amount: row.amount }))),
      PARTIAL_STATUS,
    );
    assert.notMatch(String(payment.status), /partiel/i);
  });

  it("FIN-CALC-RED-002 paiement exact 100/100", async () => {
    const store = createStore();
    const before = await seedObligation(store, { amount: 100 });
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: before.id, amount: 100 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    assertCashIdentity(payment, { received: 100, allocated: 100, unallocated: 0 });
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    assert.equal(money(after.balance), 0);
    assert.equal(after.status, "Payé");
  });

  it("FIN-CALC-RED-003 paiement partiel réel 40/100", async () => {
    const store = createStore();
    const before = await seedObligation(store, { amount: 100 });
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: before.id, amount: 40 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    assertCashIdentity(payment, { received: 40, allocated: 40, unallocated: 0 });
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    assert.equal(money(after.balance), 60);
    assert.equal(after.status, "Partiellement payé");
  });

  it("FIN-CALC-RED-004 surpaiement 101/100", async () => {
    const store = createStore();
    const before = await seedObligation(store, { amount: 100 });
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: before.id, amount: 101 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    assertCashIdentity(payment, { received: 101, allocated: 100, unallocated: 1 });
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    assert.equal(money(after.balance), 0);
    assert.equal(after.status, "Payé");
    assert.notEqual(payment.status, PARTIAL_STATUS);
  });

  it("FIN-CALC-RED-005 gros surpaiement 150/100", async () => {
    const store = createStore();
    const before = await seedObligation(store, { amount: 100 });
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: before.id, amount: 150 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    assertCashIdentity(payment, { received: 150, allocated: 100, unallocated: 50 });
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    assert.equal(money(after.balance), 0);
    assert.equal(after.status, "Payé");
    assert.notEqual(payment.status, PARTIAL_STATUS);
  });

  // Contrat RED actuel : attend un encaissement Non imputé. Décision métier CTO
  // 2026-09-07 : conserver 409 si obligationId cible une dette déjà soldée.
  // Ne pas rendre ce cas GREEN avec l'assertion ci-dessous ; l'ajuster
  // séparément du bug Oscar (statut « Partiellement payé »).
  it("FIN-CALC-RED-006 obligation déjà soldée → imputé 0, non imputé 10, amountPaid inchangé", async () => {
    const store = createStore();
    const before = await seedObligation(store, { amount: 10 });
    await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: before.id, amount: 10 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    const settled = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    const paidBefore = money(settled.amountPaid);
    assert.equal(money(settled.balance), 0);

    const extra = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: before.id, amount: 10 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    assertCashIdentity(extra, { received: 10, allocated: 0, unallocated: 10 });
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    assert.equal(money(after.amountPaid), paidBefore, "aucune modification artificielle de amountPaid");
    assert.equal(money(after.balance), 0);
  });

  it("FIN-CALC-RED-007 plusieurs obligations : pas de FIFO, cap 100, non imputé 10", async () => {
    const store = createStore();
    const grid = await store.upsertFinanceFeeGrid(
      {
        classId: CLASS_ID,
        className: "6ème A",
        academicYear: "2025-2026",
        currency: "CDF",
        status: "Active",
        items: [
          { feeType: "Scolarité", label: "Frais A", amount: 30, periodLabel: "T1", status: "Actif" },
          { feeType: "Transport", label: "Frais B", amount: 70, periodLabel: "T1", status: "Actif" },
        ],
      },
      admin,
    );
    await store.setFinanceFeeGridStatus(grid.id, "Active", admin);
    await store.applyFinanceFeeGrid(grid.id, admin);
    const fees = await store.listFinanceStudentFees(admin);
    const feeA = fees.find((row) => row.feeType === "Scolarité") || fees.find((row) => /Frais A/i.test(String(row.label)));
    const feeB = fees.find((row) => row.feeType === "Transport") || fees.find((row) => /Frais B/i.test(String(row.label)));
    assert.ok(feeA && feeB, `obligations A/B introuvables: ${fees.map((row) => `${row.feeType}:${row.label}`).join("|")}`);

    const onlyA = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: feeA.id, amount: 110 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    assertCashIdentity(onlyA, { received: 110, allocated: 30, unallocated: 80 });
    const afterOnlyA = await store.listFinanceStudentFees(admin);
    assert.equal(money(afterOnlyA.find((row) => row.id === feeB.id).balance), 70, "B intacte sans obligationId B");

    const store2 = createStore();
    const grid2 = await store2.upsertFinanceFeeGrid(
      {
        classId: CLASS_ID,
        className: "6ème A",
        academicYear: "2025-2026",
        currency: "CDF",
        status: "Active",
        items: [
          { feeType: "Scolarité", label: "Frais A", amount: 30, periodLabel: "T1", status: "Actif" },
          { feeType: "Transport", label: "Frais B", amount: 70, periodLabel: "T1", status: "Actif" },
        ],
      },
      admin,
    );
    await store2.setFinanceFeeGridStatus(grid2.id, "Active", admin);
    await store2.applyFinanceFeeGrid(grid2.id, admin);
    const fees2 = await store2.listFinanceStudentFees(admin);
    const a = fees2.find((row) => row.feeType === "Scolarité") || fees2.find((row) => /Frais A/i.test(String(row.label)));
    const b = fees2.find((row) => row.feeType === "Transport") || fees2.find((row) => /Frais B/i.test(String(row.label)));
    assert.ok(a && b);
    const split = await store2.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [
          { obligationId: a.id, amount: 40 },
          { obligationId: b.id, amount: 70 },
        ],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    assertCashIdentity(split, { received: 110, allocated: 100, unallocated: 10 });
    const afterSplit = await store2.listFinanceStudentFees(admin);
    assert.ok(afterSplit.every((row) => money(row.balance) >= 0), "aucune obligation négative");
    assert.equal(money(afterSplit.find((row) => row.id === a.id).balance), 0);
    assert.equal(money(afterSplit.find((row) => row.id === b.id).balance), 0);
  });

  it("FIN-CALC-RED-008 allocated + unallocated === payment.amount (create, GET, cancel)", async () => {
    const store = createStore();
    const before = await seedObligation(store, { amount: 100 });
    const created = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: before.id, amount: 101 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    assert.equal(money(created.allocatedAmount + created.unallocatedAmount), money(created.amount));

    const read = await store.getSchoolPayment(created.reference || created.id, admin);
    assert.equal(money(read.allocatedAmount + read.unallocatedAmount), money(read.amount));

    const cancelled = await store.cancelSchoolPayment(created.reference || created.id, "Erreur de saisie", admin);
    assert.equal(String(cancelled.status).toLowerCase().includes("annul"), true);
    const restored = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    assert.equal(money(restored.balance), 100);
    const countedAlloc = store.tables.allocations.filter(
      (row) => String(row.payment_id) === String(created.dbId || created.id) && !row.reversed_at,
    );
    assert.equal(countedAlloc.length, 0, "allocations actives = 0 après annulation");
  });

  it("FIN-CALC-RED-009 allocation cannot exceed open obligation balance", async () => {
    const store = createStore();
    const before = await seedObligation(store, { amount: 1 });
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: before.id, amount: 2 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    const allocs = activeAllocations(store, after.dbId || after.id);
    assert.ok(allocs.every((row) => money(row.amount) <= 1));
    assert.equal(money(payment.allocatedAmount), 1);
  });

  it("FIN-CALC-RED-010 projected paid amount cannot create negative business balance", async () => {
    const store = createStore();
    const before = await seedObligation(store, { amount: 1 });
    await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: before.id, amount: 2 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    assert.ok(money(after.balance) >= 0);
    const formula = computeObligationBalance({
      amountDue: after.amountDue,
      paidAmount: after.amountPaid,
      exemptionAmount: after.exemption,
    });
    assert.equal(formula, 0);
    assert.equal(obligationStatusFromBalance({
      amountDue: after.amountDue,
      paidAmount: after.amountPaid,
      exemptionAmount: after.exemption,
    }).status, "Payé");
  });

  it("FIN-CALC-RED-011 cancellation restores debt and neutralizes allocated/unallocated cash exactly once", async () => {
    const store = createStore();
    const before = await seedObligation(store, { amount: 100 });
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: before.id, amount: 101 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    assertCashIdentity(payment, { received: 101, allocated: 100, unallocated: 1 });
    await store.cancelSchoolPayment(payment.reference || payment.id, "Annulation test", admin);
    const again = await store.cancelSchoolPayment(payment.reference || payment.id, "Annulation test", admin);
    assert.ok(String(again.status).toLowerCase().includes("annul"));
    const restored = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    assert.equal(money(restored.balance), 100);
    assert.match(String(restored.status), /À payer|En retard/);
    const active = store.tables.allocations.filter((row) => !row.reversed_at);
    assert.equal(active.length, 0);
    const cancelAudits = store.tables.auditLogs.filter((row) => row.action === "cancel_payment");
    assert.equal(cancelAudits.length, 1, "annulation idempotente : un seul audit");
  });

  it("FIN-CALC-RED-012 retry does not double allocation or cash", async () => {
    const store = createStore();
    const before = await seedObligation(store, { amount: 1 });
    const service = new IdempotencyService({});
    const payload = {
      studentId: STUDENT,
      items: [{ obligationId: before.id, amount: 2 }],
      method: "Espèces",
      date: "2026-09-07",
    };
    const handler = async () => {
      const payment = await store.createSchoolPayment(payload, admin);
      return { statusCode: 201, body: payment };
    };
    const first = mockHttp("oscar-pay-0006", payload, service);
    const second = mockHttp("oscar-pay-0006", payload, service);
    await withIdempotency({
      req: first.req,
      res: first.res,
      routeKey: "POST /api/payments",
      principal: admin,
      handler,
    });
    await withIdempotency({
      req: second.req,
      res: second.res,
      routeKey: "POST /api/payments",
      principal: admin,
      handler,
    });
    assert.equal(store.tables.payments.length, 1, "1 paiement");
    assert.equal(store.tables.allocations.filter((row) => !row.reversed_at).length, 1, "1 allocation");
    assert.equal(first.res.payload.id, second.res.payload.id);
    const fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    assert.equal(money(fee.amountPaid), 1);
    assert.equal(money(fee.balance), 0);
  });

  it("FIN-CALC-RED-013 money conservation remains exact at supported precision", () => {
    for (const value of [0.01, 0.1, 0.99, 1, 1.01, 100.01]) {
      assert.equal(toMoney(value), Math.round(value * 100) / 100);
      const conserved = assertPaymentConservation({
        amount: value,
        allocations: [{ amount: Math.min(value, 1), reversedAt: null }],
        unallocatedAmount: Math.max(0, value - Math.min(value, 1)),
      });
      assert.equal(conserved.amount, toMoney(value));
      assert.equal(toMoney(conserved.allocated + conserved.unallocated), toMoney(value));
    }
  });

  it("FIN-CALC-RED-014 exemption changes allocatable balance without swallowing overpayment", async () => {
    const store = createStore();
    const before = await seedObligation(store, { amount: 100 });
    await store.adjustFinanceStudentFee(before.id, { exemption: 20 }, admin);
    const open = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    assert.equal(money(open.balance), 80);
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: before.id, amount: 81 }],
        method: "Espèces",
        date: "2026-09-07",
      },
      admin,
    );
    assertCashIdentity(payment, { received: 81, allocated: 80, unallocated: 1 });
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === before.id);
    assert.equal(money(after.balance), 0);
    assert.equal(after.status, "Payé");
    assert.notEqual(payment.status, PARTIAL_STATUS);
  });
});
