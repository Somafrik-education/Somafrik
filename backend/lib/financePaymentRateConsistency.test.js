"use strict";

/**
 * F4 — le KPI Accueil/Finance est dérivé des obligations et allocations canoniques.
 * Aucun reçu n'alimente le taux sans payment_allocation explicite.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { studentMatchesClassScope } = require("./financeManagement");
const { F4_ERROR } = require("./financeService");

const ROOT = path.resolve(__dirname, "../..");

function createStore(extraStudents = []) {
  const schools = [
    { id: "school-a", code: "CD-2026-0001", currency: "CDF" },
    { id: "school-b", code: "BI-2026-0001", currency: "CDF" },
  ];
  const students = [
    {
      id: "stu-1",
      publicId: "CD-2026-0001-STU-0001",
      studentCode: "CD-2026-0001-STU-0001",
      firstName: "Awa",
      lastName: "Diop",
      schoolCode: "CD-2026-0001",
      classId: "class-6a",
      classCode: "CLS-6A",
      className: "6ème A",
      academicYear: "2025-2026",
    },
    {
      id: "stu-2",
      publicId: "CD-2026-0001-STU-0002",
      studentCode: "CD-2026-0001-STU-0002",
      firstName: "Binta",
      lastName: "Sow",
      schoolCode: "CD-2026-0001",
      classId: "class-6a",
      classCode: "CLS-6A",
      className: "6ème A",
      academicYear: "2025-2026",
    },
    {
      id: "stu-other",
      publicId: "BI-2026-0001-STU-0001",
      studentCode: "BI-2026-0001-STU-0001",
      firstName: "Jean",
      lastName: "Nkurunziza",
      schoolCode: "BI-2026-0001",
      classId: "class-bi-6a",
      classCode: "CLS-BI-6A",
      className: "6ème A",
      academicYear: "2025-2026",
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
      students.filter((student) => student.schoolCode === schoolCode && studentMatchesClassScope(student, classRef)),
  });
}

const admin = {
  role: "Admin School",
  schoolCode: "CD-2026-0001",
  firstName: "Admin",
  lastName: "School",
  sub: "USR-RATE-ADMIN",
  permissions: ["Paiements:UPDATE"],
};

function canonicalRate(fees) {
  const active = fees.filter((fee) => String(fee.status) !== "Annulé");
  if (!active.length) return null;
  let expected = 0;
  let collected = 0;
  for (const fee of active) {
    const due = Number(fee.amountDue);
    const paid = Number(fee.amountPaid);
    if (!Number.isFinite(due) || !Number.isFinite(paid)) return null;
    expected += Math.max(0, due - Number(fee.exemption || 0));
    collected += Math.max(0, paid);
  }
  if (expected <= 0) return null;
  return Math.round((Math.min(collected, expected) / expected) * 100);
}

async function seedMensualites(store, { studentIds, amount = 100, months = 5 } = {}) {
  const monthlyMonths = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin"].slice(0, months);
  const grid = await store.upsertFinanceFeeGrid(
    {
      className: "6ème A",
      academicYear: "2025-2026",
      currency: "CDF",
      status: "Active",
      items: [
        {
          feeType: "Mensualité",
          label: "Mensualité",
          amount,
          monthlyMonths,
          dueDate: "2026-01-01",
          status: "Actif",
        },
      ],
    },
    admin,
  );
  await store.setFinanceFeeGridStatus(grid.id, "Active", admin);
  await store.applyFinanceFeeGrid(grid.id, admin, studentIds ? { studentIds } : undefined);
  return grid;
}

function scopedCd(fees) {
  return fees.filter((fee) => String(fee.schoolCode).toUpperCase() === "CD-2026-0001");
}

async function studentFees(store, studentId = "CD-2026-0001-STU-0001") {
  return scopedCd(await store.listFinanceStudentFees(admin)).filter((fee) => String(fee.studentId) === studentId);
}

async function payExplicit(store, obligationAmounts, { studentId = "CD-2026-0001-STU-0001", feeType = "Scolarité" } = {}) {
  return store.createSchoolPayment(
    {
      studentId,
      items: obligationAmounts.map(({ obligationId, amount, type = feeType }) => ({
        obligationId,
        feeType: type,
        amount,
      })),
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
}

function assertSourceGuards() {
  const pgStore = fs.readFileSync(path.join(ROOT, "backend/db/financePgStore.js"), "utf8");
  assert.match(pgStore, /projectObligationPaidAmounts/);
  assert.match(pgStore, /listFinanceStudentFees: async \(principal\)/);
  assert.match(pgStore, /sqlSchoolPredicate/);
  assert.doesNotMatch(
    pgStore.slice(pgStore.indexOf("listFinanceStudentFees")),
    /FROM payments p/,
    "GET student-fees ne doit pas reconstruire le taux depuis les reçus",
  );

  const obligationPaid = fs.readFileSync(path.join(ROOT, "backend/lib/financeObligationPaid.js"), "utf8");
  assert.match(obligationPaid, /withPaidAmount\(fee, fromAlloc\)/);
  assert.doesNotMatch(obligationPaid, /Math\.max\(money\(fee\.amountPaid\),\s*fromAlloc\)/);
  assert.doesNotMatch(obligationPaid, /allocateOntoMatchingOpen/);

  const service = fs.readFileSync(path.join(ROOT, "backend/lib/financeService.js"), "utf8");
  assert.match(service, /FINANCE_OBLIGATION_ID_REQUIRED/);
  assert.match(service, /FINANCE_LEGACY_RECONCILE_DISABLED/);
  assert.match(service, /obligationMatchesPaymentFeeType/);
  const createStart = service.indexOf("async function createPayment");
  const cancelStart = service.indexOf("async function cancelPayment", createStart);
  const createPayment = service.slice(createStart, cancelStart);
  assert.doesNotMatch(createPayment, /reconcileUnallocatedPaymentsInTx/);
  assert.match(createPayment, /obligationId est requis pour imputer un paiement/);

  const adminCtx = fs.readFileSync(path.join(ROOT, "Mobile/src/context/AdminDataContext.tsx"), "utf8");
  assert.match(adminCtx, /getStudentFees/);
  assert.match(adminCtx, /loadStudentFees/);
  assert.doesNotMatch(adminCtx, /withCanonicalPaymentAllocations/);

  const paymentsScreen = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/PaymentsScreen.tsx"), "utf8");
  assert.match(paymentsScreen, /getPaymentRateKpi|formatPaymentRateKpi/);
  assert.match(paymentsScreen, /loadStudentFees/);
  assert.doesNotMatch(paymentsScreen, /paymentStats\.rate/);
}

async function main() {
  assertSourceGuards();

  const emptyStore = createStore();
  assert.equal(canonicalRate(await emptyStore.listFinanceStudentFees()), null, "aucune assiette → —");

  const nonePaid = createStore();
  await seedMensualites(nonePaid, { studentIds: ["CD-2026-0001-STU-0001"] });
  const nonePaidFees = await studentFees(nonePaid);
  assert.equal(nonePaidFees.length, 5);
  assert.equal(canonicalRate(nonePaidFees), 0, "0 payé / 500 attendu → 0 %");

  const twenty = createStore();
  await seedMensualites(twenty, { studentIds: ["CD-2026-0001-STU-0001"] });
  const twentyTargets = await studentFees(twenty);
  const paid = await payExplicit(twenty, [{ obligationId: twentyTargets[0].id, amount: 100 }]);
  assert.equal(paid.unallocatedAmount, 0);
  assert.equal(canonicalRate(await studentFees(twenty)), 20, "100 / 500 → 20 %");

  const full = createStore();
  await seedMensualites(full, { studentIds: ["CD-2026-0001-STU-0001"] });
  const fullTargets = await studentFees(full);
  await payExplicit(
    full,
    fullTargets.map((fee) => ({ obligationId: fee.id, amount: 100 })),
  );
  assert.equal(canonicalRate(await studentFees(full)), 100);

  const partial = createStore();
  await seedMensualites(partial, { studentIds: ["CD-2026-0001-STU-0001"], months: 1, amount: 100 });
  const [partialFee] = await studentFees(partial);
  await payExplicit(partial, [{ obligationId: partialFee.id, amount: 20 }]);
  assert.equal(canonicalRate(await studentFees(partial)), 20, "20 / 100 → 20 %");

  const multiStudent = createStore();
  await seedMensualites(multiStudent, {
    studentIds: ["CD-2026-0001-STU-0001", "CD-2026-0001-STU-0002"],
    months: 1,
    amount: 100,
  });
  const [student1Fee] = await studentFees(multiStudent);
  await payExplicit(multiStudent, [{ obligationId: student1Fee.id, amount: 100 }]);
  assert.equal(canonicalRate(scopedCd(await multiStudent.listFinanceStudentFees(admin))), 50, "1 élève soldé / 2");

  const exempted = createStore();
  await seedMensualites(exempted, { studentIds: ["CD-2026-0001-STU-0001"], months: 1, amount: 100 });
  let [due] = await studentFees(exempted);
  await exempted.adjustFinanceStudentFee(due.id, { exemption: 20 }, admin);
  [due] = await studentFees(exempted);
  await payExplicit(exempted, [{ obligationId: due.id, amount: 16 }]);
  assert.equal(canonicalRate(await studentFees(exempted)), 20, "16 / (100-20) → 20 %");

  const cancelledPay = createStore();
  await seedMensualites(cancelledPay, { studentIds: ["CD-2026-0001-STU-0001"] });
  const cancelTargets = await studentFees(cancelledPay);
  const receipt = await payExplicit(cancelledPay, [{ obligationId: cancelTargets[0].id, amount: 100 }]);
  assert.equal(canonicalRate(await studentFees(cancelledPay)), 20);
  await cancelledPay.cancelSchoolPayment(receipt.reference, "Saisie erronée", admin);
  assert.equal(canonicalRate(await studentFees(cancelledPay)), 0, "annulation → allocation inversée");

  const cancelledFee = createStore();
  await seedMensualites(cancelledFee, { studentIds: ["CD-2026-0001-STU-0001"] });
  const openFees = await studentFees(cancelledFee);
  await cancelledFee.adjustFinanceStudentFee(openFees[0].id, { cancel: true }, admin);
  const stillOpen = (await studentFees(cancelledFee)).find((fee) => fee.status !== "Annulé");
  await payExplicit(cancelledFee, [{ obligationId: stillOpen.id, amount: 100 }]);
  assert.equal(canonicalRate(await studentFees(cancelledFee)), 25, "obligation annulée hors assiette : 100 / 400");

  const stale = createStore();
  await seedMensualites(stale, { studentIds: ["CD-2026-0001-STU-0001"] });
  stale.tables.payments.push({
    id: randomUUID(),
    school_id: "school-a",
    school_code: "CD-2026-0001",
    student_id: "stu-1",
    student_code: "CD-2026-0001-STU-0001",
    payment_code: "CD-2026-0001-2026-PAY-STALE",
    amount: 100,
    currency: "CDF",
    payment_method: "Espèces",
    payment_status: "paid",
    payment_date: "2026-08-01",
    fee_type: "Scolarité",
    profile_payload: { studentId: "CD-2026-0001-STU-0001", status: "Payé", feeType: "Scolarité" },
    created_at: new Date().toISOString(),
    cancelled_at: null,
  });
  assert.equal(canonicalRate(await studentFees(stale)), 0, "reçu historique non imputé → taux 0 %");
  await assert.rejects(
    () => stale.reconcileFinancePaymentAllocations(admin),
    (error) => error.code === F4_ERROR.LEGACY_RECONCILE_DISABLED,
  );
  assert.equal(canonicalRate(await studentFees(stale)), 0, "F4 ne devine jamais la dette cible");

  const isolated = createStore();
  await seedMensualites(isolated, { studentIds: ["CD-2026-0001-STU-0001"], months: 1, amount: 100 });
  isolated.tables.studentFees.push({
    id: randomUUID(),
    school_id: "school-b",
    school_code: "BI-2026-0001",
    student_id: "stu-other",
    student_code: "BI-2026-0001-STU-0001",
    fee_type: "Scolarité",
    label: "Mensualité",
    currency: "CDF",
    initial_amount: 100,
    discount: 0,
    exemption: 0,
    amount_due: 100,
    amount_paid: 0,
    balance: 100,
    status: "À payer",
    due_date: "2026-01-01",
    profile_payload: { studentId: "BI-2026-0001-STU-0001", schoolCode: "BI-2026-0001" },
  });
  const [isolatedTarget] = await studentFees(isolated);
  await payExplicit(isolated, [{ obligationId: isolatedTarget.id, amount: 100 }]);
  const allFees = await isolated.listFinanceStudentFees({ role: "Super Administrateur Somafrik", schoolCode: "*" });
  const biFee = allFees.find((fee) => fee.schoolCode === "BI-2026-0001");
  assert.equal(Number(biFee.amountPaid), 0, "allocation CD n'alimente pas BI");
  assert.equal(canonicalRate(scopedCd(allFees)), 100);

  const cantine = createStore();
  const annexGrid = await cantine.upsertFinanceFeeGrid(
    {
      className: "6ème A",
      academicYear: "2025-2026",
      currency: "CDF",
      status: "Active",
      items: [
        { feeType: "Cantine", label: "Cantine", amount: 40, dueDate: "2026-01-01", status: "Actif" },
        { feeType: "Transport", label: "Transport", amount: 60, dueDate: "2026-01-01", status: "Actif" },
      ],
    },
    admin,
  );
  await cantine.setFinanceFeeGridStatus(annexGrid.id, "Active", admin);
  await cantine.applyFinanceFeeGrid(annexGrid.id, admin, { studentIds: ["CD-2026-0001-STU-0001"] });
  const annexFees = await studentFees(cantine);
  const cantineFee = annexFees.find((fee) => /cantine/i.test(fee.label));
  const transportFee = annexFees.find((fee) => /transport/i.test(fee.label));
  await payExplicit(cantine, [{ obligationId: cantineFee.id, type: "Cantine", amount: 40 }]);
  const annexAfter = await studentFees(cantine);
  assert.equal(Number(annexAfter.find((fee) => fee.id === cantineFee.id).amountPaid), 40);
  assert.equal(Number(annexAfter.find((fee) => fee.id === transportFee.id).amountPaid), 0);

  const postMinerval = createStore();
  await seedMensualites(postMinerval, { studentIds: ["CD-2026-0001-STU-0001"], months: 1, amount: 2100 });
  const [minervalFee] = await studentFees(postMinerval);
  const postPay = await payExplicit(
    postMinerval,
    [{ obligationId: minervalFee.id, type: "Minerval", amount: 200 }],
  );
  assert.equal(postPay.unallocatedAmount, 0);
  assert.equal(canonicalRate(await studentFees(postMinerval)), 10, "200 / 2100 → 10 %");

  const cancel200 = createStore();
  await seedMensualites(cancel200, { studentIds: ["CD-2026-0001-STU-0001"], months: 1, amount: 2100 });
  const [cancelFee] = await studentFees(cancel200);
  const cancelReceipt = await payExplicit(
    cancel200,
    [{ obligationId: cancelFee.id, type: "Minerval", amount: 200 }],
  );
  await cancel200.cancelSchoolPayment(cancelReceipt.reference, "Saisie erronée", admin);
  assert.equal(canonicalRate(await studentFees(cancel200)), 0);

  console.log("financePaymentRateConsistency.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});