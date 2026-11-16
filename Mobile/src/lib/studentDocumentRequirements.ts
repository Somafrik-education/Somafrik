import type { StudentDocRecord, StudentDocType } from "../services/studentAdministrativeDocumentsApi";

export type RequiredStudentDocStatus = "missing" | "submitted" | "verified";

export const REQUIRED_STUDENT_DOCUMENTS: readonly {
  key: string; label: string; acceptedTypes: readonly StudentDocType[];
}[] = [
  { key: "BIRTH_CERTIFICATE", label: "Acte de naissance", acceptedTypes: ["BIRTH_CERTIFICATE"] },
  { key: "MEDICAL_CERTIFICATE", label: "Certificat médical", acceptedTypes: ["MEDICAL_CERTIFICATE"] },
  { key: "IDENTITY", label: "Pièce d'identité", acceptedTypes: ["IDENTITY_CARD", "PASSPORT"] },
  { key: "PHOTO", label: "Photo", acceptedTypes: ["PHOTO"] },
];

export function activeStudentDocuments(rows: readonly StudentDocRecord[]) {
  return rows.filter((item) =>
    item.status === "submitted" || item.status === "verified",
  );
}

/** La conformité dépend uniquement des fichiers effectivement vérifiés. */
export function requiredStudentDocumentStatuses(rows: readonly StudentDocRecord[]) {
  const active = activeStudentDocuments(rows);
  return REQUIRED_STUDENT_DOCUMENTS.map((req) => {
    const matching = active.filter((row) => req.acceptedTypes.includes(row.documentType));
    const status: RequiredStudentDocStatus = matching.some((item) => item.status === "verified")
      ? "verified" : matching.length > 0 ? "submitted" : "missing";
    return { ...req, status };
  });
}
