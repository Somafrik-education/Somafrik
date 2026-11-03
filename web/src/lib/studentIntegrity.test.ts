import { describe, expect, it } from "vitest";
import { integrityFromFees, unpaidCollectionBlockMessage } from "./studentIntegrity";
import type { StudentFee } from "../types";

const UUID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const MATRICULE = "CD-IN-ME-26-00010";

function fee(overrides: Partial<StudentFee> = {}): StudentFee {
  return {
    id: "fee-1",
    studentId: MATRICULE,
    schoolCode: "CD-IN-26-001",
    className: "4ème A",
    schoolFeeItemId: "item",
    feeGridId: "grid",
    feeType: "Scolarité",
    label: "Minerval",
    currency: "CDF",
    academicYear: "2026-2027",
    initialAmount: 320000,
    discount: 0,
    exemption: 0,
    amountDue: 320000,
    amountPaid: 0,
    balance: 320000,
    status: "En retard",
    ...overrides,
  };
}

describe("STUDENT-INTEGRITY-01", () => {
  it("laisse encaisser un élève actif inscrit, que l'identifiant soit l'UUID ou le matricule", () => {
    const byCode = integrityFromFees([fee({ studentDbId: UUID, studentCode: MATRICULE, hasActiveEnrollment: true })], MATRICULE);
    const byUuid = integrityFromFees([fee({ studentId: UUID, studentDbId: UUID, studentCode: MATRICULE, hasActiveEnrollment: true })], UUID);
    expect(byCode.collectionEligible).toBe(true);
    expect(byCode.integrityCategory).toBe("active");
    expect(byUuid.collectionEligible).toBe(true);
  });

  it("conserve le solde visible et bloque l'encaissement sans inscription active", () => {
    const result = integrityFromFees(
      [fee({ studentDbId: UUID, studentCode: MATRICULE, hasActiveEnrollment: false, balance: 320000 })],
      MATRICULE,
    );
    expect(result.collectionEligible).toBe(false);
    expect(result.integrityCategory).toBe("no_active_enrollment");
    expect(unpaidCollectionBlockMessage(result.integrityCategory)).toMatch(/solde reste consultable/i);
  });

  it("conserve l'historique d'un élève archivé sans nouvel encaissement", () => {
    const result = integrityFromFees(
      [fee({ studentDbId: UUID, studentCode: MATRICULE, studentStatus: "archived", hasActiveEnrollment: false })],
      MATRICULE,
    );
    expect(result.integrityCategory).toBe("archived");
    expect(result.collectionEligible).toBe(false);
  });

  it("encaise via l'UUID quand l'identifiant affiché n'est ni l'UUID ni le matricule", () => {
    const result = integrityFromFees(
      [fee({ studentId: "profile-legacy", studentDbId: UUID, studentCode: MATRICULE, hasActiveEnrollment: true })],
      "profile-legacy",
    );
    expect(result.integrityCategory).toBe("identity_mismatch");
    expect(result.collectionEligible).toBe(true);
    expect(result.canonicalStudentId).toBe(UUID);
    expect(result.matricule).toBe(MATRICULE);
  });

  it("ne propose pas d'encaissement pour un élève absent du référentiel", () => {
    const result = integrityFromFees([fee({ studentDbId: "", canonicalStudentId: "", hasActiveEnrollment: false })], "inconnu");
    expect(result.collectionEligible).toBe(false);
    expect(result.integrityCategory).toBe("orphan_finance");
    expect(result.canonicalStudentId).toBe("");
  });

  it("fail-closed pour une inscription undefined, nulle ou inconnue", () => {
    const missing = integrityFromFees(
      [fee({ studentDbId: UUID, studentCode: MATRICULE, hasActiveEnrollment: undefined })],
      MATRICULE,
    );
    const absent = integrityFromFees([fee({ studentDbId: UUID, studentCode: MATRICULE })], MATRICULE);
    const nulled = integrityFromFees(
      [fee({ studentDbId: UUID, studentCode: MATRICULE, hasActiveEnrollment: null })],
      MATRICULE,
    );
    const unknown = integrityFromFees(
      [fee({ studentDbId: UUID, studentCode: MATRICULE, enrollmentStatus: "unknown" })],
      MATRICULE,
    );
    for (const result of [missing, absent, nulled, unknown]) {
      expect(result.collectionEligible).toBe(false);
      expect(result.integrityCategory).toBe("no_active_enrollment");
      expect(result.canonicalStudentId).toBe(UUID);
    }
  });

  it("ne transforme pas un identifiant de profil en UUID canonique", () => {
    const result = integrityFromFees(
      [fee({ studentId: "profile-legacy", studentDbId: "profile-legacy", canonicalStudentId: "profile-legacy", hasActiveEnrollment: true })],
      "profile-legacy",
    );
    expect(result.canonicalStudentId).toBe("");
    expect(result.canonicalStudentId).not.toBe("profile-legacy");
    expect(result.collectionEligible).toBe(false);
    expect(result.integrityCategory).toBe("orphan_finance");
  });

  it("refuse l'encaissement quand l'établissement diverge", () => {
    const result = integrityFromFees(
      [fee({ studentDbId: UUID, studentCode: MATRICULE, hasActiveEnrollment: true, schoolMismatch: true, balance: 320000 })],
      MATRICULE,
    );
    expect(result.collectionEligible).toBe(false);
    expect(result.integrityCategory).toBe("school_mismatch");
    expect(result.canonicalStudentId).toBe(UUID);
    expect(unpaidCollectionBlockMessage(result.integrityCategory)).toMatch(/autre établissement/i);
  });
});
