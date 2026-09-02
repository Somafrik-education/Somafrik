"use strict";

/**
 * P0 — contrat élève → inscription → classe → établissement pour POST /payments.
 *
 * Reproduction avant correction :
 * payload Mobile historique { studentId, method, date, items } sans classId.
 * Backend dérivait className via LEFT JOIN LIMIT 1, sans exiger d'inscription.
 * Un élève sans classe active produisait un 201 avec className vide,
 * ou un 404 STUDENT_NOT_FOUND si l'identité ne matchait pas.
 * Mobile affichait alors « Enregistrement refusé. » sans le message API.
 *
 * F4 : ce test porte sur le scope inscription/classe, pas sur l'imputation.
 * Son paiement valide est donc explicitement Non imputé.
 */
const assert = require("node:assert/strict");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { FINANCE_ERROR } = require("./financeManagement");

const CLASS_AWA = "11111111-1111-4111-8111-111111111111";
const CLASS_AWA_B = "22222222-2222-4222-8222-222222222222";
const CLASS_JEAN = "33333333-3333-4333-8333-333333333333";
const CLASS_FOREIGN = "44444444-4444-4444-8444-444444444444";

function createStore() {
  const schools = [
    { id: "school-a", code: "CD-2026-0001", currency: "CDF" },
    { id: "school-b", code: "BI-2026-0001", currency: "CDF" },
  ];
  const classes = [
    { classId: CLASS_AWA, schoolId: "school-a", schoolCode: "CD-2026-0001", classCode: "CLS-6A", className: "6ème A" },
    { classId: CLASS_AWA_B, schoolId: "school-a", schoolCode: "CD-2026-0001", classCode: "CLS-5B", className: "5ème B" },
    { classId: CLASS_JEAN, schoolId: "school-a", schoolCode: "CD-2026-0001", classCode: "CLS-4C", className: "4ème C" },
    { classId: CLASS_FOREIGN, schoolId: "school-b", schoolCode: "BI-2026-0001", classCode: "CLS-BI", className: "6ème A" },
  ];
  const students = [
    {
      id: "stu-awa",
      publicId: "CD-2026-0001-STU-0001",
      studentCode: "CD-2026-0001-STU-0001",
      firstName: "Awa",
      lastName: "Diop",
      schoolCode: "CD-2026-0001",
      classId: CLASS_AWA,
      classCode: "CLS-6A",
      className: "6ème A",
      enrollments: [
        { status: "active", classId: CLASS_AWA, classCode: "CLS-6A", className: "6ème A", schoolId: "school-a" },
        { status: "active", classId: CLASS_AWA_B, classCode: "CLS-5B", className: "5ème B", schoolId: "school-a" },
      ],
    },
    {
      id: "stu-solo",
      publicId: "CD-2026-0001-STU-SOLO",
      studentCode: "CD-2026-0001-STU-SOLO",
      firstName: "Solo",
      lastName: "Kase",
      schoolCode: "CD-2026-0001",
      classId: CLASS_JEAN,
      classCode: "CLS-4C",
      className: "4ème C",
    },
    {
      id: "stu-orphan",
      publicId: "CD-2026-0001-STU-ORPHAN",
      studentCode: "CD-2026-0001-STU-ORPHAN",
      firstName: "Sans",
      lastName: "Classe",
      schoolCode: "CD-2026-0001",
    },
    {
      id: "stu-bi",
      publicId: "BI-2026-0001-STU-0001",
      studentCode: "BI-2026-0001-STU-0001",
      firstName: "Jean",
      lastName: "Other",
      schoolCode: "BI-2026-0001",
      classId: CLASS_FOREIGN,
      classCode: "CLS-BI",
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
    listStudentsInClass: async () => students,
    getClassById: async (classId) => classes.find((row) => row.classId === classId) ?? null,
  });
}

const admin = {
  role: "Admin School",
  schoolCode: "CD-2026-0001",
  firstName: "Admin",
  lastName: "School",
  sub: "USR-ENROLL-ADMIN",
};

function paymentBody(overrides = {}) {
  return {
    studentId: "CD-2026-0001-STU-SOLO",
    method: "Espèces",
    date: "2026-08-22",
    items: [{ feeType: "Non imputé", amount: 25000 }],
    ...overrides,
  };
}

async function main() {
  const store = createStore();

  await assert.rejects(
    () => store.createSchoolPayment(paymentBody({ studentId: "CD-2026-0001-STU-ORPHAN" }), admin),
    (error) => error.statusCode === 400 && error.code === FINANCE_ERROR.ENROLLMENT_REQUIRED,
  );

  await assert.rejects(
    () => store.createSchoolPayment(paymentBody({ studentId: "CD-2026-0001-STU-0001" }), admin),
    (error) => error.statusCode === 400 && error.code === FINANCE_ERROR.CLASS_REQUIRED,
  );

  const solo = await store.createSchoolPayment(paymentBody(), admin);
  assert.equal(solo.classId, CLASS_JEAN);
  assert.equal(solo.className, "4ème C");
  assert.equal(solo.status, "Non imputé");
  assert.equal(solo.unallocatedAmount, 25000);
  assert.equal(store.tables.allocations.length, 0);
  assert.equal(store.tables.payments.length, 1);

  const chosen = await store.createSchoolPayment(
    paymentBody({
      studentId: "CD-2026-0001-STU-0001",
      classId: CLASS_AWA_B,
      date: "2026-08-23",
    }),
    admin,
  );
  assert.equal(chosen.classId, CLASS_AWA_B);
  assert.equal(chosen.className, "5ème B");
  assert.equal(chosen.status, "Non imputé");
  assert.equal(chosen.unallocatedAmount, 25000);
  assert.equal(store.tables.allocations.length, 0);

  await assert.rejects(
    () =>
      store.createSchoolPayment(
        paymentBody({
          studentId: "CD-2026-0001-STU-0001",
          classId: CLASS_JEAN,
          date: "2026-08-24",
        }),
        admin,
      ),
    (error) => error.statusCode === 403 && error.code === FINANCE_ERROR.CLASS_STUDENT_MISMATCH,
  );

  await assert.rejects(
    () =>
      store.createSchoolPayment(
        paymentBody({
          studentId: "CD-2026-0001-STU-SOLO",
          classId: CLASS_FOREIGN,
          date: "2026-08-25",
        }),
        admin,
      ),
    (error) => error.statusCode === 403 && error.code === FINANCE_ERROR.CLASS_TENANT_MISMATCH,
  );

  await assert.rejects(
    () =>
      store.createSchoolPayment(
        paymentBody({
          studentId: "CD-2026-0001-STU-SOLO",
          classId: "00000000-0000-4000-8000-000000000000",
          date: "2026-08-26",
        }),
        admin,
      ),
    (error) => error.statusCode === 404 && error.code === FINANCE_ERROR.CLASS_NOT_FOUND,
  );

  await assert.rejects(
    () =>
      store.createSchoolPayment(paymentBody({ studentId: "BI-2026-0001-STU-0001", date: "2026-08-27" }), admin),
    (error) => error.code === FINANCE_ERROR.STUDENT_NOT_FOUND || error.code === FINANCE_ERROR.TENANT_MISMATCH,
  );

  assert.equal(store.tables.payments.length, 2, "seuls les paiements valides sont persistés");
  assert.equal(store.tables.allocations.length, 0, "test enrollment : aucune imputation implicite");

  console.log("financePaymentEnrollment.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
