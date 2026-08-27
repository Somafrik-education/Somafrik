"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { FINANCE_ERROR, studentMatchesClassScope } = require("./financeManagement");
const {
  UNALLOCATED_STATUS,
  PARTIAL_STATUS,
  resolvePaymentStatus,
  projectPaymentCash,
  projectPaymentsWithAllocations,
  cashBucketsFromPayments,
} = require("./financeUnallocatedCash");

function createGridCompatibilityStore({ ambiguous = false } = {}) {
  const school = { id: "school-compat", code: "CD-COMPAT-26-001", currency: "CDF" };
  const students = [
    {
      id: "stu-compat-a",
      publicId: "STU-COMPAT-A",
      studentCode: "STU-COMPAT-A",
      firstName: "Awa",
      lastName: "Compat",
      schoolId: school.id,
      schoolCode: school.code,
      classId: "class-compat-a",
      classCode: "CLS-COMPAT-A",
      className: "Compat Zeta",
      academicYear: "2025-2026",
    },
    ...(ambiguous
      ? [
          {
            id: "stu-compat-b",
            publicId: "STU-COMPAT-B",
            studentCode: "STU-COMPAT-B",
            firstName: "Binta",
            lastName: "Compat",
            schoolId: school.id,
            schoolCode: school.code,
            classId: "class-compat-b",
            classCode: "CLS-COMPAT-B",
            className: "Compat Zeta",
      academicYear: "2025-2026",
          },
        ]
      : []),
  ];

  const store = createFinanceMemoryStore({
    getSchoolByCode: async (code) =>
      String(code ?? "").trim().toUpperCase() === school.code ? school : null,
    findStudent: async (studentKey, principal) => {
      const scope = String(principal?.schoolCode ?? "").trim().toUpperCase();
      return (
        students.find((student) => {
          if (scope && scope !== "*" && student.schoolCode !== scope) return false;
          return [student.id, student.publicId, student.studentCode].includes(String(studentKey));
        }) ?? null
      );
    },
    listStudentsInClass: async (schoolCode, classRef) =>
      students.filter(
        (student) =>
          (!schoolCode || schoolCode === "*" || student.schoolCode === String(schoolCode).toUpperCase()) &&
          studentMatchesClassScope(student, classRef),
      ),
  });

  return { store, school };
}

const compatibilityAdmin = {
  role: "Admin School",
  schoolCode: "CD-COMPAT-26-001",
  sub: "USR-COMPAT-ADMIN",
  permissions: ["Paiements:UPDATE"],
};

async function createCompatibilityGrid(store, overrides = {}) {
  return store.upsertFinanceFeeGrid(
    {
      classId: "class-compat-a",
      classCode: "CLS-COMPAT-A",
      className: "Compat Zeta",
      academicYear: "2025-2026",
      currency: "CDF",
      status: "Active",
      items: [
        {
          feeType: "Inscription",
          label: "Inscription compatibilité",
          amount: 100,
          status: "Actif",
        },
      ],
      ...overrides,
    },
    compatibilityAdmin,
  );
}

describe("financeUnallocatedCash", () => {
  it("leftover === amount is Non imputé, never Payé", () => {
    assert.equal(resolvePaymentStatus(150, 0, "Espèces", 150), UNALLOCATED_STATUS);
    assert.equal(resolvePaymentStatus(150, 0, "Espèces"), UNALLOCATED_STATUS);
    assert.equal(resolvePaymentStatus(150, 1000, "Espèces", 0), PARTIAL_STATUS);
    assert.equal(resolvePaymentStatus(150, 150, "Espèces", 0), "Payé");
  });

  it("0 < allocated < amount is Partiel, never Payé", () => {
    assert.equal(resolvePaymentStatus(150, 100, "Espèces", 50), PARTIAL_STATUS);
    assert.notEqual(resolvePaymentStatus(150, 100, "Espèces", 50), "Payé");
    assert.equal(resolvePaymentStatus(150, 1000, "Espèces", 50), PARTIAL_STATUS);
  });

  it("leftover === 0 follows remaining debt", () => {
    assert.equal(resolvePaymentStatus(150, 150, "Espèces", 0), "Payé");
    assert.equal(resolvePaymentStatus(150, 1000, "Espèces", 0), PARTIAL_STATUS);
  });

  it("GET presentation overrides stored Payé when nothing is allocated", () => {
    const projected = projectPaymentCash(
      { amount: 150, status: "Payé", overpaymentAmount: 150 },
      [],
    );
    assert.equal(projected.status, UNALLOCATED_STATUS);
    assert.equal(projected.allocatedAmount, 0);
    assert.equal(projected.unallocatedAmount, 150);
  });

  it("projects Partiel when a receipt is only partially allocated", () => {
    const projected = projectPaymentCash(
      { dbId: "pay-partial", amount: 150, status: "Payé" },
      [{ paymentId: "pay-partial", amount: 100, reversedAt: null }],
    );
    assert.equal(projected.status, PARTIAL_STATUS);
    assert.notEqual(projected.status, "Payé");
    assert.equal(projected.allocatedAmount, 100);
    assert.equal(projected.unallocatedAmount, 50);
  });

  it("keeps Payé when allocations cover the receipt", () => {
    const projected = projectPaymentCash(
      { dbId: "pay-1", amount: 150, status: "Payé" },
      [{ paymentId: "pay-1", amount: 150, reversedAt: null }],
    );
    assert.equal(projected.status, "Payé");
    assert.equal(projected.unallocatedAmount, 0);
  });

  it("splits Encaissé / Imputé / Non imputé", () => {
    const payments = projectPaymentsWithAllocations(
      [
        { dbId: "a", amount: 150, status: "Payé" },
        { dbId: "b", amount: 200, status: "Payé" },
      ],
      [{ payment_id: "b", amount: 200 }],
    );
    const buckets = cashBucketsFromPayments(payments);
    assert.equal(buckets.collectedAmount, 350);
    assert.equal(buckets.allocatedAmount, 200);
    assert.equal(buckets.unallocatedAmount, 150);
  });
});

describe("finance fee-grid canonical compatibility", () => {
  it("falls back from a stale classId to a server-validated classCode", async () => {
    const { store } = createGridCompatibilityStore();
    const grid = await createCompatibilityGrid(store, { classId: "stale-class-id" });
    assert.equal(grid.classId, "class-compat-a");
    assert.equal(grid.classCode, "CLS-COMPAT-A");
  });

  it("applies a historical grid without class_id/class_code only when name+year is unique", async () => {
    const { store } = createGridCompatibilityStore();
    const grid = await createCompatibilityGrid(store);
    const raw = store.tables.feeGrids.find((row) => row.grid_code === grid.id);
    assert.ok(raw);
    raw.class_id = null;
    raw.class_code = "";
    raw.profile_payload = {
      ...(raw.profile_payload ?? {}),
      classId: undefined,
      classCode: undefined,
    };

    const applied = await store.applyFinanceFeeGrid(grid.id, compatibilityAdmin);
    assert.equal(applied.created, 1);
    assert.equal(applied.grid.classId, "class-compat-a");
    assert.equal(applied.grid.classCode, "CLS-COMPAT-A");
  });

  it("refuses an ambiguous historical className instead of guessing", async () => {
    const { store } = createGridCompatibilityStore({ ambiguous: true });
    const grid = await createCompatibilityGrid(store);
    const raw = store.tables.feeGrids.find((row) => row.grid_code === grid.id);
    assert.ok(raw);
    raw.class_id = null;
    raw.class_code = "";
    raw.profile_payload = {
      ...(raw.profile_payload ?? {}),
      classId: undefined,
      classCode: undefined,
    };

    await assert.rejects(
      () => store.applyFinanceFeeGrid(grid.id, compatibilityAdmin),
      (error) => error?.code === FINANCE_ERROR.CLASS_REQUIRED,
    );
  });
});
