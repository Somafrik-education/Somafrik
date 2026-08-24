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
  const service = fs.readFileSync(path.join(ROOT, "backend/lib/financeService.js"), "utf8");
  assert.match(service, /obligationMatchesPaymentFeeType/);
  assert.doesNotMatch(
    service,
    /normalizeKey\(fee\.feeType\) === normalizeKey\(item\.feeType\)/,
    "createPayment ne doit plus exiger une égalité stricte de libellé",
  );
  const pgStore = fs.readFileSync(path.join(ROOT, "backend/db/financePgStore.js"), "utf8");
  assert.match(pgStore, /projectObligationPaidAmounts/);
  assert.match(pgStore, /allocated_paid/);
  const memoryStore = fs.readFileSync(path.join(ROOT, "backend/db/financeMemoryStore.js"), "utf8");
  assert.match(memoryStore, /projectObligationPaidAmounts/);

  const paymentsScreen = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/PaymentsScreen.tsx"), "utf8");
  assert.match(paymentsScreen, /getPaymentRateKpi|formatPaymentRateKpi/);
  assert.match(paymentsScreen, /loadStudentFees/);
  assert.doesNotMatch(paymentsScreen, /paymentStats\.rate/);
  assert.doesNotMatch(paymentsScreen, /des paiements réglés/);

  const studentsScreen = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/StudentsScreen.tsx"), "utf8");
  assert.match(studentsScreen, /formatPaymentRateKpi|getPaymentRateKpi/);
  assert.match(studentsScreen, /loadStudentFees/);
  assert.doesNotMatch(studentsScreen, /paymentStats\.rate/);

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
    canonicalRate(scopedCd(await stale.listFinanceStudentFees())),
    20,
    "GET projette le paiement Scolarité non alloué sur les Mensualités",
  );

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
  const allFees = await isolated.listFinanceStudentFees();
  const biFee = allFees.find((fee) => fee.schoolCode === "BI-2026-0001");
  assert.equal(Number(biFee.amountPaid), 0, "paiement CD n'alimente pas l'assiette BI");
  assert.equal(canonicalRate(scopedCd(allFees)), 100);

  const cantine = createStore();
  const annexGrid = await cantine.upsertFinanceFeeGrid(
    {
      className: "6ème A",
      academicYear: "2025-2026",
      currency: "CDF",
      status: "Active",
      items: [
        { feeType: "Annexe", label: "Cantine", amount: 40, dueDate: "2026-01-01", status: "Actif" },
        { feeType: "Annexe", label: "Transport", amount: 60, dueDate: "2026-01-01", status: "Actif" },
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

  console.log("financePaymentRateConsistency.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
