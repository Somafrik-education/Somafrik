"use strict";

/**
 * Contrat Maeva PAY-0007 — paiement 150 FC.
 *   npx node backend/lib/financeUnallocatedMaeva.test.js
 */
const assert = require("node:assert/strict");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { studentMatchesClassScope } = require("./financeManagement");
const { UNALLOCATED_STATUS: CASH_STATUS } = require("./financeUnallocatedCash");

const MAEVA = "CD-2026-0001-STU-MAEVA";
const CLASS_ID = "class-nuru-6a";

function createStore(extraStudents = []) {
  const schools = [{ id: "school-nuru", code: "CD-2026-0001", currency: "CDF" }];
  const students = [
    {
      id: "stu-maeva",
      publicId: MAEVA,
      studentCode: MAEVA,
      firstName: "Maeva",
      lastName: "O'gulgune",
      schoolCode: "CD-2026-0001",
      classId: CLASS_ID,
      classCode: "CLS-6A",
      className: "6ème A",
    },
    ...extraStudents,
  ];
  return createFinanceMemoryStore({
    getSchoolByCode: async (code) =>
      schools.find((row) => row.code === String(code).trim().toUpperCase()) ?? null,
    findStudent: async (studentKey, principal) => {
      const scope = String(principal?.schoolCode ?? "").toUpperCase();
      return (
        students.find((student) => {
          if (scope && scope !== "*" && String(student.schoolCode).toUpperCase() !== scope) return false;
          return [student.id, student.publicId, student.studentCode].includes(studentKey);
        }) ?? null
      );
    },
    listStudentsInClass: async (schoolCode, classRef) =>
      students.filter(
        (student) => student.schoolCode === schoolCode && studentMatchesClassScope(student, classRef),
      ),
    getClassById: async (classId) =>
      classId === CLASS_ID
        ? { classId: CLASS_ID, schoolId: "school-nuru", classCode: "CLS-6A", className: "6ème A", schoolCode: "CD-2026-0001" }
        : null,
  });
}

const admin = {
  role: "Admin School",
  schoolCode: "CD-2026-0001",
  firstName: "Admin",
  lastName: "Nuru",
  sub: "USR-NURU-ADMIN",
  permissions: ["Paiements:UPDATE"],
};

async function seedMensualite(store, amount = 1000) {
  const grid = await store.upsertFinanceFeeGrid(
    {
      classId: CLASS_ID,
      className: "6ème A",
      academicYear: "2025-2026",
      currency: "CDF",
      status: "Active",
      items: [{ feeType: "Mensualité", label: "Mensualité", amount, dueDate: "2026-01-01", status: "Actif" }],
    },
    admin,
  );
  await store.setFinanceFeeGridStatus(grid.id, "Active", admin);
  await store.applyFinanceFeeGrid(grid.id, admin, { studentIds: [MAEVA] });
  return grid;
}

async function main() {
  assert.equal(CASH_STATUS, "Non imputé");

  const withDebt = createStore();
  await seedMensualite(withDebt, 1000);
  const before = (await withDebt.listFinanceStudentFees(admin)).filter((row) => row.studentId === MAEVA);
  const D = before.reduce((sum, row) => sum + Number(row.amountDue) - Number(row.exemption || 0), 0);
  const P = before.reduce((sum, row) => sum + Number(row.amountPaid), 0);
  assert.equal(D, 1000);
  assert.equal(P, 0);
  const obligationId = before[0].id;
  assert.equal(String(before[0].studentId), MAEVA);

  const paid = await withDebt.createSchoolPayment(
    {
      studentId: MAEVA,
      classId: CLASS_ID,
      items: [{ obligationId, feeType: "Scolarité", amount: 150 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  assert.equal(Number(paid.amount), 150);
  assert.equal(Number(paid.allocatedAmount), 150);
  assert.equal(Number(paid.unallocatedAmount), 0);
  assert.equal(paid.status, "Partiel");
  assert.notEqual(paid.status, "Non imputé");

  const after = (await withDebt.listFinanceStudentFees(admin)).filter((row) => row.studentId === MAEVA);
  const paidAfter = after.reduce((sum, row) => sum + Number(row.amountPaid), 0);
  const remaining = after.reduce((sum, row) => sum + Number(row.balance), 0);
  assert.equal(paidAfter, P + 150);
  assert.equal(remaining, D - (P + 150));
  assert.equal(String(after[0].studentId), String(paid.studentId));

  const listed = (await withDebt.listProjection()).payments.find((row) => row.id === paid.id || row.reference === paid.reference);
  assert.equal(Number(listed.allocatedAmount), 150);
  assert.notEqual(listed.status, "Non imputé");

  const none = createStore();
  const orphan = await none.createSchoolPayment(
    {
      studentId: MAEVA,
      classId: CLASS_ID,
      items: [{ feeType: "Scolarité", amount: 150 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  assert.equal(orphan.status, "Non imputé");
  assert.equal(Number(orphan.unallocatedAmount), 150);
  assert.equal(Number(orphan.allocatedAmount), 0);
  const feesNone = await none.listFinanceStudentFees(admin);
  assert.equal(feesNone.reduce((sum, row) => sum + Number(row.amountPaid), 0), 0);
  const cash = (await none.listProjection()).payments.find((row) => row.reference === orphan.reference || row.id === orphan.id);
  assert.equal(cash.status, "Non imputé");
  assert.equal(Number(cash.unallocatedAmount), 150);

  const cancelled = createStore();
  await seedMensualite(cancelled, 1000);
  const first = (await cancelled.listFinanceStudentFees(admin)).find((row) => row.studentId === MAEVA);
  const created = await cancelled.createSchoolPayment(
    {
      studentId: MAEVA,
      classId: CLASS_ID,
      items: [{ obligationId: first.id, amount: 150, feeType: "Scolarité" }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  await cancelled.cancelSchoolPayment(created.reference || created.id, "saisie erronée", admin);
  const afterCancel = (await cancelled.listFinanceStudentFees(admin)).find((row) => row.studentId === MAEVA);
  assert.equal(Number(afterCancel.amountPaid), 0);

  const recon = createStore();
  await seedMensualite(recon, 1000);
  recon.tables.payments.push({
    id: "pay-hist-maeva",
    school_id: "school-nuru",
    school_code: "CD-2026-0001",
    student_id: "stu-maeva",
    student_code: MAEVA,
    payment_code: "CD-2026-0001-2026-PAY-0007",
    amount: 150,
    currency: "CDF",
    payment_method: "Espèces",
    payment_status: "paid",
    payment_date: "2026-08-24",
    fee_type: "Scolarité",
    profile_payload: { studentId: MAEVA, status: "Payé", feeType: "Scolarité", schoolCode: "CD-2026-0001" },
    created_at: new Date().toISOString(),
    cancelled_at: null,
  });
  const beforeRecon = (await recon.listProjection()).payments.find((row) => row.reference === "CD-2026-0001-2026-PAY-0007");
  assert.equal(beforeRecon.status, "Non imputé");
  const firstRecon = await recon.reconcileFinancePaymentAllocations(admin);
  assert.ok(firstRecon.created >= 1);
  const afterReconFee = (await recon.listFinanceStudentFees(admin)).find((row) => row.studentId === MAEVA);
  assert.equal(Number(afterReconFee.amountPaid), 150);
  const secondRecon = await recon.reconcileFinancePaymentAllocations(admin);
  assert.equal(secondRecon.created, 0);
  const afterReconPay = (await recon.listProjection()).payments.find((row) => row.reference === "CD-2026-0001-2026-PAY-0007");
  assert.equal(afterReconPay.status, "Payé");
  assert.notEqual(afterReconPay.status, "Non imputé");
  assert.equal(Number(afterReconPay.unallocatedAmount), 0);

  console.log("OK: Maeva PAY-0007 P→P+150 ; sans obligation = Non imputé ; reconcil idempotente");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
