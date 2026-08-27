"use strict";

/**
 * F5 — contrat Web ↔ Mobile : un seul moteur Finance.
 * Les deux clients produisent le même payload ; PostgreSQL/F4 calcule.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { studentMatchesClassScope } = require("./financeManagement");
const {
  UNALLOCATED_FEE_TYPE,
  UNALLOCATED_TARGET,
  buildFinancePaymentItems,
  buildFinancePaymentWritePayload,
  collectOpenObligationsFromProjection,
  isOpenObligationFromProjection,
  isPendingPaymentStatus,
  presentPaymentCashFromProjection,
  assertNoFeeTypeOnlyImputation,
} = require("./financeWebMobileWriteContract");

const STUDENT = "CD-2026-0001-STU-F5";
const admin = {
  role: "Admin School",
  schoolCode: "CD-2026-0001",
  firstName: "Admin",
  lastName: "F5",
  sub: "USR-F5",
  permissions: ["Paiements:UPDATE"],
};
const foreign = {
  role: "Admin School",
  schoolCode: "BI-2026-0001",
  firstName: "Foreign",
  lastName: "Admin",
  sub: "USR-F5-BI",
  permissions: ["Paiements:UPDATE"],
};

function createStore() {
  const schools = [
    { id: "school-f5", code: "CD-2026-0001", currency: "CDF" },
    { id: "school-bi", code: "BI-2026-0001", currency: "BIF" },
  ];
  const students = [
    {
      id: "student-f5",
      publicId: STUDENT,
      studentCode: STUDENT,
      firstName: "Amina",
      lastName: "F5",
      schoolCode: "CD-2026-0001",
      classId: "class-f5",
      classCode: "CLS-F5",
      className: "6ème A",
      academicYear: "2026-2027",
    },
    {
      id: "student-bi",
      publicId: "BI-2026-0001-STU-F5",
      studentCode: "BI-2026-0001-STU-F5",
      firstName: "Jean",
      lastName: "Foreign",
      schoolCode: "BI-2026-0001",
      classId: "class-bi",
      classCode: "CLS-BI",
      className: "6ème A",
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
      if (classId === "class-f5") {
        return {
          classId: "class-f5",
          schoolId: "school-f5",
          classCode: "CLS-F5",
          className: "6ème A",
          schoolCode: "CD-2026-0001",
        };
      }
      if (classId === "class-bi") {
        return {
          classId: "class-bi",
          schoolId: "school-bi",
          classCode: "CLS-BI",
          className: "6ème A",
          schoolCode: "BI-2026-0001",
        };
      }
      return null;
    },
  });
}

async function seed(store) {
  const grid = await store.upsertFinanceFeeGrid(
    {
      classId: "class-f5",
      className: "6ème A",
      academicYear: "2026-2027",
      currency: "CDF",
      status: "Active",
      items: [
        { feeType: "Inscription", label: "Inscription", amount: 10_000, periodLabel: "Année", status: "Actif" },
        { feeType: "Scolarité", label: "Scolarité", amount: 15_000, periodLabel: "Septembre", status: "Actif" },
        { feeType: "Transport", label: "Transport", amount: 3_000, periodLabel: "Septembre", status: "Actif" },
        { feeType: "Examen", label: "Examen", amount: 100, periodLabel: "Session", status: "Actif" },
      ],
    },
    admin,
  );
  await store.setFinanceFeeGridStatus(grid.id, "Active", admin);
  await store.applyFinanceFeeGrid(grid.id, admin);
  const fees = await store.listFinanceStudentFees(admin);
  return {
    inscription: fees.find((row) => row.feeType === "Inscription"),
    tuition: fees.find((row) => row.feeType === "Scolarité"),
    transport: fees.find((row) => row.feeType === "Transport"),
    exam: fees.find((row) => row.feeType === "Examen"),
  };
}

function webPayload(lines, extras = {}) {
  return buildFinancePaymentWritePayload({
    studentId: STUDENT,
    classId: "class-f5",
    paymentMethod: extras.method || "Espèces",
    paidAt: extras.date || "2026-09-05",
    lines,
  });
}

function mobilePayload(lines, extras = {}) {
  return buildFinancePaymentWritePayload({
    studentId: STUDENT,
    classId: "class-f5",
    method: extras.method || "Espèces",
    date: extras.date || "2026-09-05",
    lines,
  });
}

describe("Finance F5 — convergence Web ↔ Mobile", () => {
  it("1. même obligation → même balance Web/Mobile", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    const web = webPayload([{ obligationId: tuition.id, amount: 40, feeType: "Scolarité" }]);
    const mobile = mobilePayload([{ obligationId: tuition.id, amount: 40, feeType: "Scolarité" }]);
    assert.deepEqual(web.items, mobile.items);
    const payment = await store.createSchoolPayment(web, admin);
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(after.balance, 14_960);
    assert.equal(after.amountPaid, 40);
    assert.equal(payment.allocatedAmount, 40);
    assert.equal(presentPaymentCashFromProjection(payment).allocated, 40);
  });

  it("2. paiement partiel due 100 / allocation 40 / balance 60", async () => {
    const store = createStore();
    const { exam } = await seed(store);
    const payload = webPayload([{ obligationId: exam.id, amount: 40, feeType: "Examen" }], { date: "2026-09-06" });
    await store.createSchoolPayment(payload, admin);
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === exam.id);
    assert.equal(after.amountDue, 100);
    assert.equal(after.amountPaid, 40);
    assert.equal(after.balance, 60);
    assert.equal(after.status, "Partiellement payé");
  });

  it("3. paiement complet → balance 0 / Payé", async () => {
    const store = createStore();
    const { transport } = await seed(store);
    await store.createSchoolPayment(
      mobilePayload([{ obligationId: transport.id, amount: 3_000, feeType: "Transport" }]),
      admin,
    );
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === transport.id);
    assert.equal(after.balance, 0);
    assert.equal(after.status, "Payé");
  });

  it("4. multi-obligations : mêmes obligationIds", async () => {
    const store = createStore();
    const { inscription, tuition, transport } = await seed(store);
    const lines = [
      { obligationId: inscription.id, amount: 10_000, feeType: "Inscription" },
      { obligationId: tuition.id, amount: 15_000, feeType: "Scolarité" },
      { obligationId: transport.id, amount: 3_000, feeType: "Transport" },
      { obligationId: UNALLOCATED_TARGET, amount: 2_000 },
    ];
    const web = webPayload(lines);
    const mobile = mobilePayload(lines);
    assert.deepEqual(web.items, mobile.items);
    assert.equal(web.items[0].obligationId, inscription.id);
    assert.equal(web.items[3].feeType, UNALLOCATED_FEE_TYPE);
    const payment = await store.createSchoolPayment(web, admin);
    assert.equal(payment.amount, 30_000);
    assert.equal(payment.allocatedAmount, 28_000);
    assert.equal(payment.unallocatedAmount, 2_000);
    assert.equal(store.tables.allocations.length, 3);
    const ids = store.tables.allocations.map((row) => String(row.obligation_id)).sort();
    assert.deepEqual(
      ids,
      [inscription.dbId || inscription.id, tuition.dbId || tuition.id, transport.dbId || transport.id]
        .map(String)
        .sort(),
    );
  });

  it("5. Non imputé : allocated=0 unallocated=montant", async () => {
    const store = createStore();
    await seed(store);
    const payload = webPayload([{ obligationId: UNALLOCATED_TARGET, amount: 7_000 }]);
    assert.deepEqual(payload.items, [{ feeType: UNALLOCATED_FEE_TYPE, amount: 7_000 }]);
    const payment = await store.createSchoolPayment(payload, admin);
    const cash = presentPaymentCashFromProjection(payment);
    assert.equal(cash.allocated, 0);
    assert.equal(cash.unallocated, 7_000);
    assert.equal(payment.status, UNALLOCATED_FEE_TYPE);
    assert.equal(store.tables.allocations.length, 0);
  });

  it("6. mixte : allocation + unallocated = paiement", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    const payment = await store.createSchoolPayment(
      mobilePayload([
        { obligationId: tuition.id, amount: 10_000, feeType: "Scolarité" },
        { obligationId: UNALLOCATED_TARGET, amount: 5_000 },
      ]),
      admin,
    );
    assert.equal(payment.allocatedAmount + payment.unallocatedAmount, payment.amount);
    assert.equal(payment.allocatedAmount, 10_000);
    assert.equal(payment.unallocatedAmount, 5_000);
  });

  it("7. annulation : même dette restaurée", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    const before = tuition.balance;
    const payment = await store.createSchoolPayment(
      webPayload([{ obligationId: tuition.id, amount: 4_000, feeType: "Scolarité" }]),
      admin,
    );
    let fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(fee.balance, before - 4_000);
    await store.cancelSchoolPayment(payment.reference, "Erreur de saisie", admin);
    fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(fee.balance, before);
    assert.equal(fee.amountPaid, 0);
    const listed = store.tables.payments.find(
      (row) => String(row.payment_code || row.reference) === String(payment.reference),
    );
    assert.ok(listed, "le reçu reste dans l'historique");
    assert.match(String(listed.payment_status || listed.status || ""), /cancel|annul/i);
  });

  it("8. pending : dette inchangée côté projection client", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    const before = tuition.balance;
    assert.equal(isPendingPaymentStatus("En attente de confirmation"), true);
    assert.equal(isPendingPaymentStatus("pending"), true);
    assert.equal(isPendingPaymentStatus("Payé"), false);
    const pending = {
      amount: 15_000,
      allocatedAmount: 0,
      unallocatedAmount: 15_000,
      status: "En attente de confirmation",
    };
    const cash = presentPaymentCashFromProjection(pending);
    assert.equal(cash.allocated, 0);
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(after.balance, before);
  });

  it("10. feeType sans obligationId : aucun client ne produit cette écriture", () => {
    assert.throws(
      () => assertNoFeeTypeOnlyImputation([{ feeType: "Scolarité", amount: 100 }]),
      (error) => error.code === "FINANCE_OBLIGATION_ID_REQUIRED",
    );
    const coerced = buildFinancePaymentItems([{ feeType: "Scolarité", amount: 100 }]);
    assert.deepEqual(coerced, [{ feeType: UNALLOCATED_FEE_TYPE, amount: 100 }]);
    const explicit = buildFinancePaymentItems([
      { obligationId: "obl-1", amount: 40, feeType: "Scolarité" },
    ]);
    assert.equal(explicit[0].obligationId, "obl-1");
    assert.equal(explicit[0].feeType, "Scolarité");
  });

  it("11. cross-tenant : aucune obligation étrangère visible", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    const local = await store.listFinanceStudentFees(admin);
    const open = collectOpenObligationsFromProjection(STUDENT, local);
    assert.ok(open.some((row) => row.obligationId === tuition.id));
    const foreignFees = await store.listFinanceStudentFees(foreign);
    assert.equal(collectOpenObligationsFromProjection(STUDENT, foreignFees).length, 0);
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          {
            studentId: "BI-2026-0001-STU-F5",
            items: [{ feeType: UNALLOCATED_FEE_TYPE, amount: 1 }],
            method: "Espèces",
            date: "2026-09-07",
          },
          admin,
        ),
      (error) => error.statusCode === 404 || error.statusCode === 403,
    );
  });

  it("surpaiement : le serveur tronque, le client n'invente pas la répartition", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    const payment = await store.createSchoolPayment(
      webPayload([{ obligationId: tuition.id, amount: 20_000, feeType: "Scolarité" }], { date: "2026-09-08" }),
      admin,
    );
    assert.equal(payment.allocatedAmount, 15_000);
    assert.equal(payment.unallocatedAmount, 5_000);
    const after = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(after.balance, 0);
    assert.equal(isOpenObligationFromProjection(after), false);
  });
});
