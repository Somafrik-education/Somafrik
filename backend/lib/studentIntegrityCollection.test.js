"use strict";

/**
 * STUDENT-INTEGRITY-01 — l'API d'encaissement vérifie l'éligibilité canonique
 * dans la transaction. Une inscription absente, nulle, inconnue ou un
 * établissement divergent n'écrit ni paiement, ni ligne, ni allocation.
 */
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { createPayment } = require("./financeService");
const { FINANCE_ERROR } = require("./financeManagement");

const UUID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const MATRICULE = "CD-IN-ME-26-00010";
const PROFILE = "profile-legacy-not-a-uuid";
const SCHOOL = "CD-IN-26-001";

const admin = {
  role: "Comptable",
  schoolCode: SCHOOL,
  financeLoginCode: SCHOOL,
  schoolId: "school-1",
  effectiveSchoolId: "school-1",
  firstName: "Ada",
  lastName: "Compta",
  sub: "USR-INTEGRITY",
  permissions: ["Paiements:CREATE", "Impayés:READ"],
};

function payload(studentId) {
  return {
    studentId,
    method: "Espèces",
    date: "2026-11-03",
    items: [{ obligationId: "obl-1", feeType: "Scolarité", amount: 1000 }],
  };
}

function createHarness({ enrollments, acceptKeys = [UUID, MATRICULE] } = {}) {
  const writes = { payments: 0, items: 0, allocations: 0, obligations: 0 };
  const balance = { value: 320000 };
  let queriedStudentId = "";
  const store = {
    async withTransaction(fn) {
      const tx = {
        async findStudent(key) {
          if (!acceptKeys.includes(key)) return null;
          return {
            id: PROFILE,
            dbId: UUID,
            publicId: MATRICULE,
            studentCode: MATRICULE,
            schoolCode: SCHOOL,
            loginCode: SCHOOL,
            firstName: "Elie",
            lastName: "Muco",
          };
        },
        async getSchoolByCode() {
          return { id: "school-1", code: SCHOOL, loginCode: SCHOOL, currency: "CDF" };
        },
        async listActiveEnrollmentsForStudent(studentDbId) {
          queriedStudentId = studentDbId;
          return enrollments;
        },
        async listObligationsByStudent() {
          throw new Error("les obligations ne doivent pas être lues après un refus d'inscription");
        },
        async insertPayment() {
          writes.payments += 1;
        },
        async insertPaymentItem() {
          writes.items += 1;
        },
        async insertAllocation() {
          writes.allocations += 1;
        },
        async updateObligation() {
          writes.obligations += 1;
          balance.value = 0;
        },
      };
      return fn(tx);
    },
  };
  return { store, writes, balance, queried: () => queriedStudentId };
}

async function assertRefusal(enrollments, code) {
  const harness = createHarness({ enrollments });
  await assert.rejects(
    () => createPayment(harness.store, payload(MATRICULE), admin),
    (error) => error.statusCode && error.code === code,
  );
  assert.equal(harness.queried(), UUID);
  assert.equal(harness.writes.payments, 0);
  assert.equal(harness.writes.items, 0);
  assert.equal(harness.writes.allocations, 0);
  assert.equal(harness.writes.obligations, 0);
  assert.equal(harness.balance.value, 320000);
}

describe("encaissement API — éligibilité canonique au moment de la transaction", () => {
  it("refuse une inscription absente et n'écrit rien", async () => {
    await assertRefusal([], FINANCE_ERROR.ENROLLMENT_REQUIRED);
  });

  it("refuse une liste d'inscription nulle ou non tableau", async () => {
    await assertRefusal(null, FINANCE_ERROR.ENROLLMENT_REQUIRED);
    await assertRefusal(undefined, FINANCE_ERROR.ENROLLMENT_REQUIRED);
  });

  it("refuse une inscription au statut inconnu", async () => {
    await assertRefusal(
      [{ classId: "class-1", schoolId: "school-1", status: "unknown" }],
      FINANCE_ERROR.ENROLLMENT_REQUIRED,
    );
  });

  it("refuse un établissement divergent", async () => {
    await assertRefusal(
      [{ classId: "class-b", schoolId: "school-other", status: "active" }],
      FINANCE_ERROR.CLASS_TENANT_MISMATCH,
    );
  });

  it("une tentative directe avec un identifiant de profil ne fabrique pas d'UUID", async () => {
    const harness = createHarness({ enrollments: [{ classId: "class-1", schoolId: "school-1", status: "active" }] });
    await assert.rejects(
      () => createPayment(harness.store, payload(PROFILE), admin),
      (error) => error.statusCode === 404 && error.code === FINANCE_ERROR.STUDENT_NOT_FOUND,
    );
    assert.equal(harness.queried(), "");
    assert.equal(harness.writes.payments, 0);
    assert.equal(harness.writes.items, 0);
    assert.equal(harness.writes.allocations, 0);
    assert.equal(harness.balance.value, 320000);
  });

  it("sans fonction d'inscription, l'encaissement est refusé", async () => {
    const harness = createHarness({ enrollments: [] });
    delete harness.store.withTransaction;
    const writes = { payments: 0 };
    const store = {
      async withTransaction(fn) {
        return fn({
          async findStudent(key) {
            if (key !== MATRICULE) return null;
            return {
              id: MATRICULE,
              dbId: UUID,
              publicId: MATRICULE,
              studentCode: MATRICULE,
              schoolCode: SCHOOL,
              loginCode: SCHOOL,
            };
          },
          async getSchoolByCode() {
            return { id: "school-1", code: SCHOOL, loginCode: SCHOOL, currency: "CDF" };
          },
          async insertPayment() {
            writes.payments += 1;
          },
        });
      },
    };
    await assert.rejects(
      () => createPayment(store, payload(MATRICULE), admin),
      (error) => error.code === FINANCE_ERROR.ENROLLMENT_REQUIRED,
    );
    assert.equal(writes.payments, 0);
  });
});
