import type { StudentFee, StudentUnpaidRow } from "../types";

export type StudentIntegrityCategory = NonNullable<StudentUnpaidRow["integrityCategory"]>;

const ARCHIVED = new Set(["archived", "inactive", "deleted", "transferred", "sorti"]);
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canonicalStudentUuid(value: unknown): string {
  const text = String(value ?? "").trim();
  return CANONICAL_UUID.test(text) ? text : "";
}

export function unpaidCollectionBlockMessage(category: StudentIntegrityCategory | undefined): string {
  if (category === "archived") {
    return "Élève archivé : l'historique reste consultable, sans nouvel encaissement.";
  }
  if (category === "orphan_finance") {
    return "Écriture sans élève du référentiel : le solde est conservé, l'encaissement est désactivé.";
  }
  if (category === "school_mismatch") {
    return "Élève d'un autre établissement : l'encaissement est désactivé.";
  }
  if (category === "missing") {
    return "Élève introuvable dans le référentiel : l'encaissement est désactivé.";
  }
  if (category === "unverified_identity") {
    return "Matricule sans UUID canonique vérifié : l'encaissement est désactivé. Le solde reste consultable.";
  }
  return "Inscription inactive : l'encaissement d'une nouvelle opération est désactivé. Le solde reste consultable.";
}

function enrollmentActive(fees: StudentFee[]): boolean {
  const flags = fees.map((fee) => fee.hasActiveEnrollment);
  if (flags.some((value) => value === true)) return true;
  if (flags.some((value) => value === false || value === null)) return false;
  const status = String(fees[0]?.enrollmentStatus ?? "").trim().toLowerCase();
  return status === "active" || status === "enrolled";
}

export function integrityFromFees(fees: StudentFee[], displayedStudentId: string): {
  canonicalStudentId: string;
  matricule?: string;
  collectionEligible: boolean;
  integrityCategory: StudentIntegrityCategory;
} {
  const primary = fees[0];
  const canonicalStudentId = canonicalStudentUuid(primary?.canonicalStudentId) || canonicalStudentUuid(primary?.studentDbId);
  const matricule = String(primary?.studentCode || "").trim() || undefined;
  const displayed = displayedStudentId.trim();
  const explicitOrphan = fees.some(
    (fee) => fee.orphanFinance === true || fee.studentDbId === "" || fee.canonicalStudentId === "",
  );
  const explicitMissing = fees.some((fee) => fee.studentExists === false);
  const verifiedIdentity = Boolean(canonicalStudentId || matricule);
  const archived = fees.some((fee) => ARCHIVED.has(String(fee.studentStatus ?? "").trim().toLowerCase()));
  const schoolMismatch = fees.some((fee) => fee.schoolMismatch === true);
  const identityMismatch = Boolean(
    verifiedIdentity &&
      displayed &&
      displayed !== canonicalStudentId &&
      displayed !== matricule,
  );

  if (explicitOrphan || explicitMissing || !verifiedIdentity) {
    return {
      canonicalStudentId: "",
      matricule,
      collectionEligible: false,
      integrityCategory: fees.length ? "orphan_finance" : "missing",
    };
  }
  if (schoolMismatch) {
    return { canonicalStudentId, matricule, collectionEligible: false, integrityCategory: "school_mismatch" };
  }
  if (archived) {
    return { canonicalStudentId, matricule, collectionEligible: false, integrityCategory: "archived" };
  }
  if (!enrollmentActive(fees)) {
    return { canonicalStudentId, matricule, collectionEligible: false, integrityCategory: "no_active_enrollment" };
  }
  if (!canonicalStudentId) {
    return { canonicalStudentId: "", matricule, collectionEligible: false, integrityCategory: "unverified_identity" };
  }
  if (identityMismatch) {
    return { canonicalStudentId, matricule, collectionEligible: true, integrityCategory: "identity_mismatch" };
  }
  return { canonicalStudentId, matricule, collectionEligible: true, integrityCategory: "active" };
}
