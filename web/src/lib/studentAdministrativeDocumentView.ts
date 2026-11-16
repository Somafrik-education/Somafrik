import type { StudentDocument } from "./studentDomain";
import {
  buildStudentDocumentSummary,
  collectStudentDocumentRecord,
} from "./studentDocuments";
import { buildStudentDocumentViewModel } from "./studentDocumentsViewModel";
import type { StudentStoredDocument } from "./studentAdministrativeDocumentsApi";

/** La liste réelle PostgreSQL gouverne la vue ; une erreur réseau ne devient jamais "zéro document". */
export function buildCanonicalStudentDocumentsView(
  studentId: string,
  uploaded: readonly StudentStoredDocument[],
) {
  const live = uploaded.filter((entry) =>
    (entry.status === "submitted" || entry.status === "verified") && Boolean(entry.id),
  );
  const input: StudentDocument[] = live.map((doc) => ({
    id: doc.id,
    studentId,
    documentType: doc.documentType,
    // Le nom affichable signale un document physique sans révéler une storage_key.
    fileUrl: doc.fileName || "document",
    status: "En attente",
    verifiedAt: doc.verifiedAt || undefined,
    createdAt: doc.createdAt,
  }));
  const record = collectStudentDocumentRecord({ studentId, documents: input });
  const documents = record.documents.map((item) => {
    const source = live.find((doc) => doc.id === item.id);
    return source?.status === "verified"
      ? { ...item, status: "VERIFIED" as const }
      : item;
  });
  const updated = {
    ...record,
    source: "STRUCTURED" as const,
    documents,
    summary: buildStudentDocumentSummary(documents, record.requirements),
  };
  return buildStudentDocumentViewModel(updated, {
    allowedVisibility: ["STAFF", "ADMIN"],
  });
}
