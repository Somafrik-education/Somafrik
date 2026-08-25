"use strict";

/**
 * P1 — obligationId ne peut pas contredire feeTypeId / élève / tenant.
 *   npx node backend/lib/financeObligationPaymentMatch.test.js
 */
const assert = require("node:assert/strict");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { FINANCE_ERROR, studentMatchesClassScope } = require("./financeManagement");

const CLASS_ID = "class-nuru-6a";
const CLASS_BI = "class-bi-6a";
const MAEVA = "CD-2026-0001-STU-MAEVA";
const BINTA = "CD-2026-0001-STU-BINTA";
const JEAN = "BI-2026-0001-STU-JEAN";

function createStore() {
  const schools = [
    { id: "school-nuru", code: "CD-2026-0001", currency: "CDF" },
    { id: "school-bi", code: "BI-2026-0001", currency: "CDF" },
  ];
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
    {
      id: "stu-binta",
      publicId: BINTA,
      studentCode: BINTA,
      firstName: "Binta",
      lastName: "Sow",
      schoolCode: "CD-2026-0001",
      classId: CLASS_ID,
      classCode: "CLS-6A",
      className: "6ème A",
    },
    {
      id: "stu-jean",
      publicId: JEAN,
      studentCode: JEAN,
      firstName: "Jean",
      lastName: "Nkurunziza",
      schoolCode: "BI-2026-0001",
      classId: CLASS_BI,
      classCode: "CLS-BI-6A",
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
          if (scope && scope !== "*" && String(student.schoolCode).toUpperCase() !== scope) return false;
          return [student.id, student.publicId, student.studentCode].includes(studentKey);
        }) ?? null
      );
    },
    listStudentsInClass: async (schoolCode, classRef) =>
      students.filter(
        (student) => student.schoolCode === schoolCode && studentMatchesClassScope(student, classRef),
      ),
    getClassById: async (classId) => {
      if (classId === CLASS_ID) {
        return {
          classId: CLASS_ID,
          schoolId: "school-nuru",
          classCode: "CLS-6A",
          className: "6ème A",
          schoolCode: "CD-2026-0001",
        };
      }
      if (classId === CLASS_BI) {
        return {
          classId: CLASS_BI,
          schoolId: "school-bi",
          classCode: "CLS-BI-6A",
          className: "6ème A",
          schoolCode: "BI-2026-0001",
        };
      }
      return null;
    },
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

const biAdmin = {
  role: "Admin School",
  schoolCode: "BI-2026-0001",
  firstName: "Admin",
  lastName: "Bujumbura",
  sub: "USR-BI-ADMIN",
  permissions: ["Paiements:UPDATE"],
};

async function seedInscriptionAndMensualite(store, { studentIds, actor = admin, classId = CLASS_ID } = {}) {
  const grid = await store.upsertFinanceFeeGrid(
    {
      classId,
      className: "6ème A",
      academicYear: "2025-2026",
      currency: "CDF",
      status: "Active",
      items: [
        { feeType: "Inscription", label: "Inscription", amount: 200, status: "Actif" },
        { feeType: "Mensualité", label: "Mensualité", amount: 150, dueDate: "2026-01-01", status: "Actif" },
      ],
    },
    actor,
  );
  await store.setFinanceFeeGridStatus(grid.id, "Active", actor);
  await store.applyFinanceFeeGrid(grid.id, actor, studentIds ? { studentIds } : undefined);
  return grid;
}

function feesFor(store, studentId) {
  return store.tables.studentFees
    .map((row) => ({
      id: row.profile_payload?.publicId || row.id,
      dbId: row.id,
      studentId: row.profile_payload?.studentId || row.student_code,
      feeType: row.fee_type,
      schoolFeeItemId: row.school_fee_item_id,
      schoolCode: row.school_code,
    }))
    .filter((row) => String(row.studentId) === String(studentId));
}

function catalogItem(store, feeType) {
  return store.tables.schoolFeeItems.find((row) => row.fee_type === feeType);
}

async function main() {
  const mismatch = createStore();
  await seedInscriptionAndMensualite(mismatch, { studentIds: [MAEVA] });
  const maevaFees = feesFor(mismatch, MAEVA);
  const inscription = maevaFees.find((row) => row.feeType === "Inscription");
  const mensualiteCatalog = catalogItem(mismatch, "Mensualité");
  assert.ok(inscription);
  assert.ok(mensualiteCatalog);

  const paymentsBefore = mismatch.tables.payments.length;
  const allocationsBefore = mismatch.tables.allocations.length;
  await assert.rejects(
    () =>
      mismatch.createSchoolPayment(
        {
          studentId: MAEVA,
          classId: CLASS_ID,
          items: [
            {
              obligationId: inscription.id,
              feeTypeId: mensualiteCatalog.id,
              amount: 150,
            },
          ],
          method: "Espèces",
          date: "2026-08-24",
        },
        admin,
      ),
    (error) => error.statusCode === 409 && error.code === FINANCE_ERROR.OBLIGATION_FEE_TYPE_MISMATCH,
  );
  assert.equal(mismatch.tables.payments.length, paymentsBefore, "aucune création si obligation/type incohérents");
  assert.equal(mismatch.tables.allocations.length, allocationsBefore, "aucune allocation si obligation/type incohérents");

  const otherStudent = createStore();
  await seedInscriptionAndMensualite(otherStudent, { studentIds: [MAEVA, BINTA] });
  const bintaInscription = feesFor(otherStudent, BINTA).find((row) => row.feeType === "Inscription");
  assert.ok(bintaInscription);
  const otherStudentPayments = otherStudent.tables.payments.length;
  await assert.rejects(
    () =>
      otherStudent.createSchoolPayment(
        {
          studentId: MAEVA,
          classId: CLASS_ID,
          items: [{ obligationId: bintaInscription.id, feeType: "Inscription", amount: 150 }],
          method: "Espèces",
          date: "2026-08-24",
        },
        admin,
      ),
    (error) => error.statusCode === 409 && error.code === FINANCE_ERROR.OBLIGATION_STUDENT_MISMATCH,
  );
  assert.equal(otherStudent.tables.payments.length, otherStudentPayments);

  const otherTenant = createStore();
  await seedInscriptionAndMensualite(otherTenant, { studentIds: [MAEVA] });
  await seedInscriptionAndMensualite(otherTenant, {
    studentIds: [JEAN],
    actor: biAdmin,
    classId: CLASS_BI,
  });
  const jeanFee = feesFor(otherTenant, JEAN).find((row) => row.feeType === "Mensualité");
  assert.ok(jeanFee);
  const otherTenantPayments = otherTenant.tables.payments.length;
  await assert.rejects(
    () =>
      otherTenant.createSchoolPayment(
        {
          studentId: MAEVA,
          classId: CLASS_ID,
          items: [{ obligationId: jeanFee.id, feeType: "Mensualité", amount: 150 }],
          method: "Espèces",
          date: "2026-08-24",
        },
        admin,
      ),
    (error) => error.statusCode === 409 && error.code === FINANCE_ERROR.OBLIGATION_TENANT_MISMATCH,
  );
  assert.equal(otherTenant.tables.payments.length, otherTenantPayments);

  const coherent = createStore();
  await seedInscriptionAndMensualite(coherent, { studentIds: [MAEVA] });
  const coherentFees = feesFor(coherent, MAEVA);
  const mensualite = coherentFees.find((row) => row.feeType === "Mensualité");
  const coherentCatalog = catalogItem(coherent, "Mensualité");
  assert.ok(mensualite);
  assert.ok(coherentCatalog);
  const paid = await coherent.createSchoolPayment(
    {
      studentId: MAEVA,
      classId: CLASS_ID,
      items: [
        {
          obligationId: mensualite.id,
          feeTypeId: coherentCatalog.id,
          amount: 150,
        },
      ],
      method: "Espèces",
      date: "2026-08-24",
    },
    admin,
  );
  assert.equal(Number(paid.amount), 150);
  assert.equal(Number(paid.allocatedAmount), 150);
  assert.equal(Number(paid.unallocatedAmount), 0);
  assert.equal(paid.status, "Payé");
  assert.equal(coherent.tables.allocations.length, 1);
  assert.equal(String(coherent.tables.allocations[0].obligation_id), String(mensualite.dbId));

  console.log("OK: obligationId refuse Inscription+Mensualité, autre élève, autre tenant ; cohérent → succès");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
