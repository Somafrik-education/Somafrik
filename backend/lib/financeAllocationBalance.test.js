"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { studentMatchesClassScope } = require("./financeManagement");
const { F4_ERROR } = require("./financeService");

const STUDENT = "CD-2026-0001-STU-F4";
const admin = {
  role: "Admin School",
  schoolCode: "CD-2026-0001",
  firstName: "Admin",
  lastName: "F4",
  sub: "USR-F4",
  permissions: ["Paiements:UPDATE"],
};

function createStore() {
  const schools = [{ id: "school-f4", code: "CD-2026-0001", currency: "CDF" }];
  const students = [
    {
      id: "student-f4",
      publicId: STUDENT,
      studentCode: STUDENT,
      firstName: "Amina",
      lastName: "F4",
      schoolCode: "CD-2026-0001",
      classId: "class-f4",
      classCode: "CLS-F4",
      className: "6ème A",
      academicYear: "2026-2027",
    },
  ];
  return createFinanceMemoryStore({
    getSchoolByCode: async (code) => schools.find((row) => row.code === String(code).trim().toUpperCase()) || null,
    findStudent: async (key, principal) => {
      const scope = String(principal?.schoolCode || "").toUpperCase();
      return students.find((student) => {
        if (scope && scope !== "*" && student.schoolCode !== scope) return false;
        return [student.id, student.publicId, student.studentCode].includes(key);
      }) || null;
    },
    listStudentsInClass: async (schoolCode, classRef) =>
      students.filter((student) => student.schoolCode === schoolCode && studentMatchesClassScope(student, classRef)),
    getClassById: async (classId) =>
      classId === "class-f4"
        ? {
            classId: "class-f4",
            schoolId: "school-f4",
            classCode: "CLS-F4",
            className: "6ème A",
            schoolCode: "CD-2026-0001",
          }
        : null,
  });
}

async function seed(store) {
  const grid = await store.upsertFinanceFeeGrid(
    {
      classId: "class-f4",
      className: "6ème A",
      academicYear: "2026-2027",
      currency: "CDF",
      status: "Active",
      items: [
        { feeType: "Scolarité", label: "Scolarité", amount: 30_000, periodLabel: "Septembre", status: "Actif" },
        { feeType: "Transport", label: "Transport", amount: 20_000, periodLabel: "Septembre", status: "Actif" },
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

describe("Finance F4 — contrat d'allocation", () => {
  it("refuse le matching historique feeType sans obligationId", async () => {
    const store = createStore();
    await seed(store);
    await assert.rejects(
      () =>
        store.createSchoolPayment(
          { studentId: STUDENT, feeType: "Scolarité", amount: 10_000, method: "Espèces", date: "2026-09-05" },
          admin,
        ),
      (error) => error.code === F4_ERROR.OBLIGATION_ID_REQUIRED,
    );
    assert.equal(store.tables.payments.length, 0);
    assert.equal(store.tables.allocations.length, 0);
  });

  it("accepte un encaissement explicitement Non imputé sans toucher aux dettes", async () => {
    const store = createStore();
    const before = await seed(store);
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ feeType: "Non imputé", amount: 7_000 }],
        method: "Espèces",
        date: "2026-09-05",
      },
      admin,
    );
    assert.equal(payment.allocatedAmount, 0);
    assert.equal(payment.unallocatedAmount, 7_000);
    assert.equal(payment.status, "Non imputé");
    assert.equal(store.tables.allocations.length, 0);
    const after = await store.listFinanceStudentFees(admin);
    assert.equal(after.find((row) => row.id === before.tuition.id).balance, 30_000);
    assert.equal(after.find((row) => row.id === before.transport.id).balance, 20_000);
  });

  it("impute partiellement une obligation explicite", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: tuition.id, feeType: "Scolarité", amount: 10_000 }],
        method: "Espèces",
        date: "2026-09-05",
      },
      admin,
    );
    assert.equal(payment.allocatedAmount, 10_000);
    assert.equal(payment.unallocatedAmount, 0);
    const fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(fee.amountPaid, 10_000);
    assert.equal(fee.balance, 20_000);
    assert.equal(fee.status, "Partiellement payé");
  });

  it("transforme le dépassement d'une dette en Non imputé", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: tuition.id, feeType: "Scolarité", amount: 40_000 }],
        method: "Espèces",
        date: "2026-09-05",
      },
      admin,
    );
    assert.equal(payment.allocatedAmount, 30_000);
    assert.equal(payment.unallocatedAmount, 10_000);
    const fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(fee.amountPaid, 30_000);
    assert.equal(fee.balance, 0);
    assert.equal(fee.status, "Payé");
  });

  it("un reçu peut imputer deux obligations explicites", async () => {
    const store = createStore();
    const { tuition, transport } = await seed(store);
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [
          { obligationId: tuition.id, feeType: "Scolarité", amount: 30_000 },
          { obligationId: transport.id, feeType: "Transport", amount: 20_000 },
        ],
        method: "Espèces",
        date: "2026-09-05",
      },
      admin,
    );
    assert.equal(payment.allocatedAmount, 50_000);
    assert.equal(payment.unallocatedAmount, 0);
    assert.equal(store.tables.allocations.length, 2);
    const fees = await store.listFinanceStudentFees(admin);
    assert.equal(fees.every((row) => row.balance === 0), true);
  });

  it("l'annulation inverse les allocations et fait réapparaître la dette", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT,
        items: [{ obligationId: tuition.id, feeType: "Scolarité", amount: 15_000 }],
        method: "Espèces",
        date: "2026-09-05",
      },
      admin,
    );
    let fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(fee.balance, 15_000);
    await store.cancelSchoolPayment(payment.reference, "Erreur", admin);
    fee = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(fee.amountPaid, 0);
    assert.equal(fee.balance, 30_000);
    assert.equal(store.tables.allocations.every((row) => Boolean(row.reversed_at)), true);
  });

  it("la projection ignore une colonne amount_paid falsifiée", async () => {
    const store = createStore();
    const { tuition } = await seed(store);
    const raw = store.tables.studentFees.find((row) => String(row.id) === String(tuition.dbId));
    raw.amount_paid = 29_999;
    raw.balance = 1;
    raw.status = "Payé";
    const projected = (await store.listFinanceStudentFees(admin)).find((row) => row.id === tuition.id);
    assert.equal(projected.amountPaid, 0);
    assert.equal(projected.balance, 30_000);
    assert.notEqual(projected.status, "Payé");
  });

  it("refuse la réconciliation historique automatique par type", async () => {
    const store = createStore();
    await seed(store);
    await assert.rejects(
      () => store.reconcileFinancePaymentAllocations(admin, {}),
      (error) => error.code === F4_ERROR.LEGACY_RECONCILE_DISABLED,
    );
  });
});