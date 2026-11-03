import type { StudentFee, StudentUnpaidRow } from "../types";

export type StudentIntegrityCategory = NonNullable<StudentUnpaidRow["integrityCategory"]>;

const ARCHIVED = new Set(["archived", "inactive", "deleted", "transferred", "sorti"]);

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
  return "Inscription inactive : l'encaissement d'une nouvelle opération est désactivé. Le solde reste consultable.";
}

export function integrityFromFees(fees: StudentFee[], displayedStudentId: string): {
  canonicalStudentId: string;
  matricule?: string;
  collectionEligible: boolean;
  integrityCategory: StudentIntegrityCategory;
} {
  const primary = fees[0];
  const markedMissing = fees.some((fee) => fee.studentDbId === "" || fee.canonicalStudentId === "");
  const canonicalStudentId = String(primary?.canonicalStudentId || primary?.studentDbId || displayedStudentId).trim();
  const matricule = String(primary?.studentCode || "").trim() || undefined;
  const flags = fees.map((fee) => fee.hasActiveEnrollment).filter((value) => value === true || value === false);
  const hasActiveEnrollment = flags.length ? flags.some(Boolean) : undefined;
  const archived = fees.some((fee) => ARCHIVED.has(String(fee.studentStatus ?? "").trim().toLowerCase()));
  const displayed = displayedStudentId.trim();
  const identityMismatch = Boolean(
    (canonicalStudentId || matricule) &&
      displayed &&
      displayed !== canonicalStudentId &&
      displayed !== matricule,
  );

  if (markedMissing) {
    return { canonicalStudentId: displayed, matricule, collectionEligible: false, integrityCategory: "orphan_finance" };
  }
  if (archived) {
    return { canonicalStudentId, matricule, collectionEligible: false, integrityCategory: "archived" };
  }
  if (hasActiveEnrollment === false) {
    return { canonicalStudentId, matricule, collectionEligible: false, integrityCategory: "no_active_enrollment" };
  }
  if (identityMismatch && canonicalStudentId !== displayed) {
    return { canonicalStudentId, matricule, collectionEligible: true, integrityCategory: "identity_mismatch" };
  }
  return { canonicalStudentId, matricule, collectionEligible: true, integrityCategory: "active" };
}
