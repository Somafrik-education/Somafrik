"use strict";

/**
 * Repository mémoire — paiements atomiques, annulation, grilles, reminders.
 */
const assert = require("node:assert/strict");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { FINANCE_ERROR } = require("./financeManagement");

function createStore() {
  const schools = [{ id: "school-a", code: "CD-2026-0001", currency: "CDF" }];
  const students = [
    {
      id: "stu-1",
      publicId: "CD-2026-0001-STU-0001",
      studentCode: "CD-2026-0001-STU-0001",
      firstName: "Awa",
      lastName: "Diop",
      schoolCode: "CD-2026-0001",
      className: "6ème A",
    },
    {
      id: "stu-other",
      publicId: "BI-2026-0001-STU-0001",
      studentCode: "BI-2026-0001-STU-0001",
      firstName: "Jean",
      lastName: "Nkurunziza",
      schoolCode: "BI-2026-0001",
      className: "6ème A",
    },
  ];
  return createFinanceMemoryStore({
    getSchoolByCode: async (code) =>
      schools.find((row) => row.code === String(code).trim().toUpperCase()) ?? null,
    findStudent: async (studentKey, principal) => {
      const scope = String(principal?.schoolCode ?? "").toUpperCase();
      return (
        students.find((student) => {
          if (scope && scope !== "*" && String(student.schoolCode).toUpperCase() !== scope) {
            return false;
          }
          return [student.id, student.publicId, student.studentCode].includes(studentKey);
        }) ?? null
      );
    },
    listStudentsInClass: async (schoolCode, className) =>
      students.filter(
        (student) =>
          student.schoolCode === schoolCode &&
          student.className.toLowerCase() === String(className).toLowerCase(),
      ),
  });
}

const admin = {
  role: "Admin School",
  schoolCode: "CD-2026-0001",
  firstName: "Admin",
  lastName: "School",
  sub: "USR-MEM-ADMIN",
};
const accountant = { role: "Comptable", schoolCode: "CD-2026-0001", firstName: "Compta", lastName: "Able" };
const otherSchool = { role: "Admin School", schoolCode: "BI-2026-0001" };

function failAuditWrites(store) {
  const original = store.withTransaction.bind(store);
  store.withTransaction = (fn) =>
    original(async (tx) => {
      tx.recordFinanceAudit = async () => {
        throw new Error("audit write failed");
      };
      return fn(tx);
    });
  return () => {
    store.withTransaction = original;
  };
}

async function seedGrid(store) {
  const grid = await store.upsertFinanceFeeGrid(
    {
      className: "6ème A",
      academicYear: "2025-2026",
      currency: "CDF",
      status: "Active",
      items: [
        { feeType: "Inscription", label: "Inscription", amount: 50_000, dueDate: "2026-01-01", status: "Actif" },
        { feeType: "Annexe", label: "Transport", amount: 20_000, periodLabel: "Janvier", dueDate: "2026-01-01", status: "Actif" },
      ],
    },
    admin,
  );
  await store.setFinanceFeeGridStatus(grid.id, "Active", admin);
  await store.applyFinanceFeeGrid(grid.id, admin);
  return grid;
}

async function main() {
  const store = createStore();
  const grid = await seedGrid(store);

  const fees = await store.listFinanceStudentFees();
  assert.equal(fees.length, 2);
  const inscription = fees.find((row) => row.feeType === "Inscription");
  assert.equal(inscription.balance, 50_000);

  const appliedAgain = await store.applyFinanceFeeGrid(grid.id, admin);
  assert.equal(appliedAgain.created, 0);
  assert.equal((await store.listFinanceStudentFees()).length, 2);

  const payment = await store.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      feeType: "Inscription",
      amount: 50_000,
      method: "Espèces",
      date: "2026-08-13",
      schoolCode: "HACK",
      createdBy: "forged",
    },
    admin,
  );
  assert.match(payment.reference, /^CD-2026-0001-\d{4}-PAY-0001$/);
  assert.equal(payment.overpaymentAmount, 0);
  const afterPay = (await store.listFinanceStudentFees()).find((row) => row.feeType === "Inscription");
  assert.equal(afterPay.balance, 0);
  assert.equal(afterPay.status, "Payé");

  const overpay = await store.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      feeType: "Annexe",
      amount: 30_000,
      method: "Espèces",
      date: "2026-08-13",
    },
    accountant,
  );
  assert.equal(overpay.overpaymentAmount, 10_000);
  const annex = (await store.listFinanceStudentFees()).find((row) => row.feeType === "Annexe");
  assert.equal(annex.balance, 0);

  await assert.rejects(
    () =>
      store.createSchoolPayment(
        { studentId: "CD-2026-0001-STU-0001", feeType: "Inscription", amount: 1, method: "Espèces", date: "2026-08-13" },
        otherSchool,
      ),
    (error) => error.code === FINANCE_ERROR.STUDENT_NOT_FOUND || error.code === FINANCE_ERROR.TENANT_MISMATCH,
  );

  const createAudits = store.tables.auditLogs.filter((row) => row.action === "create_payment");
  assert.equal(createAudits.length, 2);
  assert.equal(createAudits[0].entityId, payment.reference);

  const cancelled = await store.cancelSchoolPayment(payment.reference, "Erreur de saisie", admin);
  assert.equal(cancelled.status, "Annulé");
  assert.equal(cancelled.cancelledBy, admin.sub);
  const restored = (await store.listFinanceStudentFees()).find((row) => row.feeType === "Inscription");
  assert.equal(restored.balance, 50_000);
  assert.equal(store.tables.auditLogs.filter((row) => row.action === "cancel_payment").length, 1);
  const cancelledAgain = await store.cancelSchoolPayment(payment.reference, "Erreur de saisie", admin);
  assert.equal(cancelledAgain.status, "Annulé");
  assert.equal(store.tables.auditLogs.filter((row) => row.action === "cancel_payment").length, 1);

  await assert.rejects(
    () => store.cancelSchoolPayment(payment.reference, "  ", admin),
    (error) => error.code === FINANCE_ERROR.CANCEL_REASON_REQUIRED,
  );

  await assert.rejects(
    () =>
      store.upsertFinanceFeeGrid(
        {
          className: "6ème A",
          academicYear: "2025-2026",
          currency: "CDF",
          items: [{ feeType: "Inscription", label: "Dup", amount: 10, status: "Actif" }],
        },
        admin,
      ),
    (error) => error.code === FINANCE_ERROR.FEE_GRID_DUPLICATE,
  );

  const reminder = await store.createFinanceReminder(
    "CD-2026-0001-STU-0001",
    { channel: "notification", recipient: "Parent", triggeredBy: "forged" },
    admin,
  );
  assert.equal(reminder.channel, "notification");
  await assert.rejects(
    () => store.createFinanceReminder("CD-2026-0001-STU-0001", { channel: "notification" }, admin),
    (error) => error.code === FINANCE_ERROR.REMINDER_COOLDOWN,
  );
  await assert.rejects(
    () =>
      store.createFinanceReminder(
        "CD-2026-0001-STU-0001",
        { channel: "notification" },
        accountant,
        { force: true },
      ),
    (error) => error.code === FINANCE_ERROR.REMINDER_FORCE_FORBIDDEN,
  );

  const projection = await store.listProjection();
  assert.ok(Array.isArray(projection.payments));
  assert.equal(projection.payments.some((row) => row.reference === payment.reference), true);

  const rollbackStore = createStore();
  await seedGrid(rollbackStore);
  const feesBefore = await rollbackStore.listFinanceStudentFees();
  const inscriptionBefore = feesBefore.find((row) => row.feeType === "Inscription");
  failAuditWrites(rollbackStore);
  await assert.rejects(
    () =>
      rollbackStore.createSchoolPayment(
        {
          studentId: "CD-2026-0001-STU-0001",
          feeType: "Inscription",
          amount: 50_000,
          method: "Espèces",
          date: "2026-08-13",
        },
        admin,
      ),
    (error) => String(error.message).includes("audit write failed"),
  );
  assert.equal(rollbackStore.tables.payments.length, 0);
  assert.equal(rollbackStore.tables.auditLogs.length, 0);
  const inscriptionAfterFailedPay = (await rollbackStore.listFinanceStudentFees()).find(
    (row) => row.feeType === "Inscription",
  );
  assert.equal(inscriptionAfterFailedPay.balance, inscriptionBefore.balance);
  assert.equal(inscriptionAfterFailedPay.amountPaid, inscriptionBefore.amountPaid);

  const cancelRollbackStore = createStore();
  await seedGrid(cancelRollbackStore);
  const persisted = await cancelRollbackStore.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      feeType: "Inscription",
      amount: 50_000,
      method: "Espèces",
      date: "2026-08-13",
    },
    admin,
  );
  assert.equal(cancelRollbackStore.tables.auditLogs.filter((row) => row.action === "create_payment").length, 1);
  failAuditWrites(cancelRollbackStore);
  await assert.rejects(
    () => cancelRollbackStore.cancelSchoolPayment(persisted.reference, "Audit KO", admin),
    (error) => String(error.message).includes("audit write failed"),
  );
  const stillActive = await cancelRollbackStore.getSchoolPayment(persisted.reference, admin);
  assert.equal(stillActive.status, "Payé");
  assert.equal(stillActive.cancelledBy, null);
  const inscriptionStillPaid = (await cancelRollbackStore.listFinanceStudentFees()).find(
    (row) => row.feeType === "Inscription",
  );
  assert.equal(inscriptionStillPaid.balance, 0);
  assert.equal(cancelRollbackStore.tables.auditLogs.filter((row) => row.action === "cancel_payment").length, 0);
  assert.equal(
    cancelRollbackStore.tables.allocations.every((row) => !row.reversed_at),
    true,
  );

  console.log("financeRepository.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
