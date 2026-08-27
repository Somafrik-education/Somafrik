"use strict";

/**
 * P1 — le KPI Accueil et Finance partagent la même assiette obligations.
 * Avant : POST { feeType: "Scolarité" } n'allouait pas les Mensualités
 * → GET /finance/student-fees.amountPaid = 0 (Accueil 0 %) alors que le reçu existe (Finance ~20 %).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { studentMatchesClassScope } = require("./financeManagement");

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
          if (scope && scope !== "*" && String(student.schoolCode).toUpperCase() !== scope) {
            return false;
          }
          return [student.id, student.publicId, student.studentCode].includes(studentKey);
        }) ?? null
      );
    },
    listStudentsInClass: async (schoolCode, classRef) =>
      students.filter(
        (student) => student.schoolCode === schoolCode && studentMatchesClassScope(student, classRef),
      ),
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

function assertSourceGuards() {
  const pgStore = fs.readFileSync(path.join(ROOT, "backend/db/financePgStore.js"), "utf8");
  assert.match(pgStore, /projectObligationPaidAmounts/);
  assert.match(pgStore, /listFinanceStudentFees: async \(principal\)/);
  assert.match(pgStore, /sqlSchoolPredicate/);
  assert.match(pgStore, /reconcileFinancePaymentAllocations/);
  assert.match(pgStore, /lockPayment/);
  assert.match(pgStore, /FOR UPDATE/);
  assert.doesNotMatch(
    pgStore.slice(pgStore.indexOf("listFinanceStudentFees")),
    /FROM payments p/,
    "GET student-fees ne charge plus tous les paiements avant scope",
  );
  const memoryStore = fs.readFileSync(path.join(ROOT, "backend/db/financeMemoryStore.js"), "utf8");
  assert.match(memoryStore, /projectObligationPaidAmounts/);
  assert.match(memoryStore, /listFinanceStudentFees: async \(principal\)/);
  assert.match(memoryStore, /lockPayment/);
  const api = fs.readFileSync(path.join(ROOT, "Mobile/src/services/api.ts"), "utf8");
  assert.match(api, /function reconcilePaymentAllocations/);
  assert.match(api, /\/finance\/reconcile-payment-allocations/);
  const reconcileClient = fs.readFileSync(
    path.join(ROOT, "Mobile/src/lib/financeAllocationReconcile.ts"),
    "utf8",
  );
  assert.match(reconcileClient, /isSoftPaymentAllocationReconcileFailure/);
  assert.match(reconcileClient, /throw error/);
  assert.doesNotMatch(reconcileClient, /catch\s*\{/);
  assert.doesNotMatch(reconcileClient, /paymentsData/);
  assert.doesNotMatch(reconcileClient, /from ["']\.\.\/services\/api["']/);
  const adminCtx = fs.readFileSync(path.join(ROOT, "Mobile/src/context/AdminDataContext.tsx"), "utf8");
  assert.match(adminCtx, /getStudentFees/);
  assert.match(adminCtx, /loadStudentFees/);
  assert.doesNotMatch(
    adminCtx,
    /withCanonicalPaymentAllocations/,
    "GET student-fees ne doit plus muter via reconcile",
  );
  const obligationPaid = fs.readFileSync(path.join(ROOT, "backend/lib/financeObligationPaid.js"), "utf8");
  assert.doesNotMatch(obligationPaid, /allocateOntoMatchingOpen/);
  assert.doesNotMatch(obligationPaid, /isPaymentCounted/);
  const service = fs.readFileSync(path.join(ROOT, "backend/lib/financeService.js"), "utf8");
  assert.match(service, /obligationMatchesPaymentFeeType/);
  assert.match(service, /OBLIGATION_FEE_TYPE_MISMATCH/);
  assert.match(service, /OBLIGATION_STUDENT_MISMATCH/);
  assert.match(service, /OBLIGATION_TENANT_MISMATCH/);
  assert.match(service, /reconcileHistoricalPaymentAllocations/);
  assert.match(service, /reconcile_payment_allocation/);
  const reconFn = service.slice(service.indexOf("async function reconcileUnallocatedPaymentsInTx"));
  const lockIdx = reconFn.indexOf("lockPayment");
  const allocIdx = reconFn.indexOf("listAllocations");
  assert.ok(lockIdx >= 0 && allocIdx > lockIdx, "lockPayment avant listAllocations");
  assert.doesNotMatch(
    service,
    /normalizeKey\(fee\.feeType\) === normalizeKey\(item\.feeType\)/,
    "createPayment ne doit plus exiger une égalité stricte de libellé",
  );
  const matcher = fs.readFileSync(path.join(ROOT, "backend/lib/financeFeeTypeMatch.js"), "utf8");
  assert.doesNotMatch(matcher, /autre frais/);
  assert.doesNotMatch(matcher, /reinscription/);
  assert.doesNotMatch(matcher, /examen/);
  assert.doesNotMatch(matcher, /bulletin/);
  assert.doesNotMatch(matcher, /transport/);
  const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  assert.match(server, /listFinanceStudentFees\(req\.principal\)/);
  assert.match(server, /reconcileFinancePaymentAllocations/);

  const paymentsScreen = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/PaymentsScreen.tsx"), "utf8");
  assert.match(paymentsScreen, /getPaymentRateKpi|formatPaymentRateKpi/);
  assert.match(paymentsScreen, /getPaymentCashKpi/);
  assert.match(paymentsScreen, /loadStudentFees/);
  assert.doesNotMatch(paymentsScreen, /paymentStats\.rate/);
  assert.doesNotMatch(paymentsScreen, /des paiements réglés/);
  assert.doesNotMatch(paymentsScreen, /paymentStats\.paidAmount/);
  assert.doesNotMatch(paymentsScreen, /paymentsData\.reduce/);

  const studentsScreen = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/StudentsScreen.tsx"), "utf8");
  assert.match(studentsScreen, /formatPaymentRateKpi|getPaymentRateKpi/);
  assert.match(studentsScreen, /loadStudentFees/);
  assert.doesNotMatch(studentsScreen, /paymentStats\.rate/);

  const homeScreen = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/HomeScreen.tsx"), "utf8");
  assert.match(homeScreen, /loadStudentFees/);

  const studentPayments = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/StudentPaymentsScreen.tsx"), "utf8");
  assert.match(studentPayments, /getPaymentRateKpi|formatPaymentRateKpi/);
  assert.match(studentPayments, /loadStudentFees/);

  const outbox = fs.readFileSync(path.join(ROOT, "Mobile/src/components/OutboxRuntime.tsx"), "utf8");
  assert.match(outbox, /loadStudentFees/);
}

async function main() {
  assertSourceGuards();

  const emptyStore = createStore();
  assert.equal(canonicalRate(await emptyStore.listFinanceStudentFees()), null, "aucune assiette → —");

  const nonePaid = createStore();
  await seedMensualites(nonePaid, { studentIds: ["CD-2026-0001-STU-0001"] });
  const nonePaidFees = scopedCd(await nonePaid.listFinanceStudentFees());
  assert.equal(nonePaidFees.length, 5);
  assert.equal(canonicalRate(nonePaidFees), 0, "0 payé / 500 attendu → 0 %");

  const twenty = createStore();
  await seedMensualites(twenty, { studentIds: ["CD-2026-0001-STU-0001"] });
  const paid = await twenty.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Scolarité", amount: 100 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  assert.equal(paid.overpaymentAmount, 0, "Scolarité doit allouer une Mensualité, pas rester en trop-perçu");
  assert.equal(twenty.tables.allocations.filter((row) => !row.reversed_at).length, 1);
  const twentyFees = scopedCd(await twenty.listFinanceStudentFees());
  assert.equal(
    twentyFees.reduce((sum, fee) => sum + Number(fee.amountPaid), 0),
    100,
  );
  assert.equal(canonicalRate(twentyFees), 20, "100 encaissé / 500 attendu → 20 %");

  const full = createStore();
  await seedMensualites(full, { studentIds: ["CD-2026-0001-STU-0001"] });
  await full.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Scolarité", amount: 500 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  assert.equal(canonicalRate(scopedCd(await full.listFinanceStudentFees())), 100);

  const partial = createStore();
  await seedMensualites(partial, { studentIds: ["CD-2026-0001-STU-0001"], months: 1, amount: 100 });
  await partial.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Scolarité", amount: 20 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  assert.equal(canonicalRate(scopedCd(await partial.listFinanceStudentFees())), 20, "20 / 100 → 20 %");

  const multiStudent = createStore();
  await seedMensualites(multiStudent, {
    studentIds: ["CD-2026-0001-STU-0001", "CD-2026-0001-STU-0002"],
    months: 1,
    amount: 100,
  });
  await multiStudent.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Scolarité", amount: 100 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  assert.equal(canonicalRate(scopedCd(await multiStudent.listFinanceStudentFees())), 50, "1 élève soldé / 2");

  const exempted = createStore();
  await seedMensualites(exempted, { studentIds: ["CD-2026-0001-STU-0001"], months: 1, amount: 100 });
  const [due] = scopedCd(await exempted.listFinanceStudentFees());
  await exempted.adjustFinanceStudentFee(due.id, { exemption: 20 }, admin);
  await exempted.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Scolarité", amount: 16 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  assert.equal(canonicalRate(scopedCd(await exempted.listFinanceStudentFees())), 20, "16 / (100-20) → 20 %");

  const cancelledPay = createStore();
  await seedMensualites(cancelledPay, { studentIds: ["CD-2026-0001-STU-0001"] });
  const receipt = await cancelledPay.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Scolarité", amount: 100 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  assert.equal(canonicalRate(scopedCd(await cancelledPay.listFinanceStudentFees())), 20);
  await cancelledPay.cancelSchoolPayment(receipt.reference, "Saisie erronée", admin);
  assert.equal(
    canonicalRate(scopedCd(await cancelledPay.listFinanceStudentFees())),
    0,
    "paiement annulé → allocations reversées, taux 0 %",
  );

  const cancelledFee = createStore();
  await seedMensualites(cancelledFee, { studentIds: ["CD-2026-0001-STU-0001"] });
  const openFees = scopedCd(await cancelledFee.listFinanceStudentFees());
  await cancelledFee.adjustFinanceStudentFee(openFees[0].id, { cancel: true }, admin);
  await cancelledFee.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Scolarité", amount: 100 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  assert.equal(
    canonicalRate(scopedCd(await cancelledFee.listFinanceStudentFees())),
    25,
    "obligation annulée hors assiette : 100 / 400",
  );

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
  assert.equal(
    stale.tables.studentFees.every((row) => Number(row.amount_paid) === 0),
    true,
    "colonne amount_paid encore à 0 (paiement historique non alloué)",
  );
  assert.equal(
    canonicalRate(scopedCd(await stale.listFinanceStudentFees(admin))),
    0,
    "GET ne masque pas une file non allouée : 0 % tant que la réconciliation n'a pas persisté",
  );

  const reconA = await stale.reconcileFinancePaymentAllocations(admin);
  assert.equal(reconA.created, 1);
  assert.equal(stale.tables.allocations.filter((row) => !row.reversed_at).length, 1, "A. allocation canonique 100");
  assert.equal(
    stale.tables.studentFees.reduce((sum, row) => sum + Number(row.amount_paid), 0),
    100,
    "A. amount_paid PostgreSQL/mémoire = 100",
  );
  assert.equal(canonicalRate(scopedCd(await stale.listFinanceStudentFees(admin))), 20, "A. taux 20 %");
  assert.equal(
    stale.tables.auditLogs.some((row) => row.action === "reconcile_payment_allocation"),
    true,
    "A. audit de la réparation",
  );

  const reconAgain = await stale.reconcileFinancePaymentAllocations(admin);
  assert.equal(reconAgain.created, 0, "E. deuxième exécution = aucun changement");
  assert.equal(stale.tables.allocations.filter((row) => !row.reversed_at).length, 1, "E. aucune allocation dupliquée");

  const payB = await stale.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Scolarité", amount: 400 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  assert.equal(payB.overpaymentAmount, 0);
  assert.equal(
    scopedCd(await stale.listFinanceStudentFees(admin)).reduce((sum, fee) => sum + Number(fee.amountPaid), 0),
    500,
    "B. total encaissé 500",
  );
  assert.equal(canonicalRate(scopedCd(await stale.listFinanceStudentFees(admin))), 100, "B. taux 100 %");
  assert.equal(
    stale.tables.allocations.filter((row) => !row.reversed_at).reduce((sum, row) => sum + Number(row.amount), 0),
    500,
    "B. aucune allocation au-delà de 500",
  );

  const over = createStore();
  await seedMensualites(over, { studentIds: ["CD-2026-0001-STU-0001"] });
  over.tables.payments.push({
    id: randomUUID(),
    school_id: "school-a",
    school_code: "CD-2026-0001",
    student_id: "stu-1",
    student_code: "CD-2026-0001-STU-0001",
    payment_code: "CD-2026-0001-2026-PAY-HIST",
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
  await over.reconcileFinancePaymentAllocations(admin);
  const payC = await over.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Scolarité", amount: 500 }],
      method: "Espèces",
      date: "2026-08-24",
      overpaymentAction: "À confirmer",
    },
    admin,
  );
  assert.equal(payC.overpaymentAmount, 100, "C. 100 trop-perçu selon contrat");
  assert.equal(
    over.tables.allocations.filter((row) => !row.reversed_at).reduce((sum, row) => sum + Number(row.amount), 0),
    500,
    "C. jamais 600 imputés sur une dette 500",
  );
  assert.equal(
    scopedCd(await over.listFinanceStudentFees(admin)).reduce((sum, fee) => sum + Number(fee.amountPaid), 0),
    500,
  );

  const cancelHist = createStore();
  await seedMensualites(cancelHist, { studentIds: ["CD-2026-0001-STU-0001"] });
  const histId = randomUUID();
  cancelHist.tables.payments.push({
    id: histId,
    school_id: "school-a",
    school_code: "CD-2026-0001",
    student_id: "stu-1",
    student_code: "CD-2026-0001-STU-0001",
    payment_code: "CD-2026-0001-2026-PAY-CANCEL",
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
  await cancelHist.reconcileFinancePaymentAllocations(admin);
  assert.equal(canonicalRate(scopedCd(await cancelHist.listFinanceStudentFees(admin))), 20);
  await cancelHist.cancelSchoolPayment("CD-2026-0001-2026-PAY-CANCEL", "Saisie erronée", admin);
  assert.equal(
    cancelHist.tables.allocations.filter((row) => !row.reversed_at).length,
    0,
    "D. allocation historique reversée",
  );
  assert.equal(
    scopedCd(await cancelHist.listFinanceStudentFees(admin)).reduce((sum, fee) => sum + Number(fee.amountPaid), 0),
    0,
  );
  assert.equal(canonicalRate(scopedCd(await cancelHist.listFinanceStudentFees(admin))), 0, "D. taux recalculé");

  const isolated = createStore();
  await seedMensualites(isolated, { studentIds: ["CD-2026-0001-STU-0001"], months: 1, amount: 100 });
  isolated.tables.studentFees.push({
    id: randomUUID(),
    school_id: "school-b",
    school_code: "BI-2026-0001",
    student_id: "stu-other",
    student_code: "BI-2026-0001-STU-0001",
    fee_type: "Mensualité",
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
  await isolated.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Scolarité", amount: 100 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  const allFees = await isolated.listFinanceStudentFees({
    role: "Super Administrateur Somafrik",
    schoolCode: "*",
  });
  const biFee = allFees.find((fee) => fee.schoolCode === "BI-2026-0001");
  assert.equal(Number(biFee.amountPaid), 0, "paiement CD n'alimente pas l'assiette BI");
  assert.equal(canonicalRate(scopedCd(allFees)), 100);
  const scopedOnly = await isolated.listFinanceStudentFees(admin);
  assert.equal(scopedOnly.every((fee) => fee.schoolCode === "CD-2026-0001"), true);
  assert.equal(scopedOnly.some((fee) => fee.schoolCode === "BI-2026-0001"), false);

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
  await cantine.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Cantine", amount: 40 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  const annexFees = scopedCd(await cantine.listFinanceStudentFees());
  const cantineFee = annexFees.find((fee) => /cantine/i.test(fee.label));
  const transportFee = annexFees.find((fee) => /transport/i.test(fee.label));
  assert.equal(Number(cantineFee.amountPaid), 40);
  assert.equal(Number(transportFee.amountPaid), 0, "Cantine n'impute pas Transport");

  const postMinerval = createStore();
  await seedMensualites(postMinerval, { studentIds: ["CD-2026-0001-STU-0001"], months: 1, amount: 2100 });
  const postPay = await postMinerval.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Minerval", amount: 200 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  assert.equal(postPay.overpaymentAmount, 0, "POST Minerval après matcher → Mensualité, pas un trop-perçu");
  const postFees = scopedCd(await postMinerval.listFinanceStudentFees(admin));
  assert.equal(
    postFees.reduce((sum, fee) => sum + Number(fee.amountPaid), 0),
    200,
    "paiement confirmé 200 / assiette 2100 → amountPaid = 200",
  );
  assert.equal(canonicalRate(postFees), 10, "200 / 2100 → 10 %");

  const cancel200 = createStore();
  await seedMensualites(cancel200, { studentIds: ["CD-2026-0001-STU-0001"], months: 1, amount: 2100 });
  const cancelReceipt = await cancel200.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-0001",
      items: [{ feeType: "Minerval", amount: 200 }],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  await cancel200.cancelSchoolPayment(cancelReceipt.reference, "Saisie erronée", admin);
  const cancelFees = scopedCd(await cancel200.listFinanceStudentFees(admin));
  assert.equal(
    cancelFees.reduce((sum, fee) => sum + Number(fee.amountPaid), 0),
    0,
    "paiement annulé 200 → 0 FC encaissé",
  );
  assert.equal(canonicalRate(cancelFees), 0);

  const hist200 = createStore();
  await seedMensualites(hist200, { studentIds: ["CD-2026-0001-STU-0001"], months: 1, amount: 2100 });
  hist200.tables.payments.push({
    id: randomUUID(),
    school_id: "school-a",
    school_code: "CD-2026-0001",
    student_id: "stu-1",
    student_code: "CD-2026-0001-STU-0001",
    payment_code: "CD-2026-0001-2026-PAY-MINERVAL-200",
    amount: 200,
    currency: "CDF",
    payment_method: "Espèces",
    payment_status: "paid",
    payment_date: "2026-08-01",
    fee_type: "Minerval",
    profile_payload: { studentId: "CD-2026-0001-STU-0001", status: "Payé", feeType: "Minerval" },
    created_at: new Date().toISOString(),
    cancelled_at: null,
  });
  assert.equal(
    hist200.tables.studentFees.reduce((sum, row) => sum + Number(row.amount_paid), 0),
    0,
    "historique non alloué : colonne amount_paid = 0",
  );
  assert.equal(
    canonicalRate(scopedCd(await hist200.listFinanceStudentFees(admin))),
    0,
    "GET ne projette pas le reçu 200 tant que la réconciliation n'a pas persisté",
  );
  const recon200 = await hist200.reconcileFinancePaymentAllocations(admin);
  assert.equal(recon200.created, 1);
  assert.equal(
    hist200.tables.allocations.filter((row) => !row.reversed_at).reduce((sum, row) => sum + Number(row.amount), 0),
    200,
    "payment_allocations contient 200 FC actifs",
  );
  assert.equal(
    hist200.tables.studentFees.reduce((sum, row) => sum + Number(row.amount_paid), 0),
    200,
    "student_fee_obligations.amount_paid = 200",
  );
  const histFees = scopedCd(await hist200.listFinanceStudentFees(admin));
  assert.equal(
    histFees.reduce((sum, fee) => sum + Number(fee.amountPaid), 0),
    200,
    "GET /finance/student-fees renvoie 200",
  );
  assert.equal(canonicalRate(histFees), 10, "200 / 2100 → 10 %");
  const recon200Again = await hist200.reconcileFinancePaymentAllocations(admin);
  assert.equal(recon200Again.created, 0, "deuxième réconciliation = no-op");
  assert.equal(
    hist200.tables.allocations.filter((row) => !row.reversed_at).length,
    1,
    "réconciliation idempotente : pas de doublon",
  );

  console.log("financePaymentRateConsistency.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
