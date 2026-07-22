import type { StudentDocumentItemViewModel } from "../../lib/studentDocumentsViewModel";
import { Card, SectionHeader, EmptyState } from "../../design-system";
import { StudentDocumentBadges } from "./StudentDocumentBadges";
import { cn } from "../../lib/utils";

interface StudentDocumentsListProps {
  documents: readonly StudentDocumentItemViewModel[];
}

export function StudentDocumentsList({ documents }: StudentDocumentsListProps) {
  return (
    <Card className="p-6" data-testid="student-documents-list">
      <SectionHeader
        title="Liste des documents"
        description="Pièces du dossier administratif, triées par priorité de traitement."
      />

      {documents.length === 0 ? (
        <EmptyState className="mt-6" title="Aucun document" />
      ) : (
        <ul className="mt-6 divide-y divide-line">
          {documents.map((document) => (
            <li
              key={document.id}
              className={cn(
                "flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between",
                (document.status === "EXPIRED" ||
                  document.status === "MISSING" ||
                  document.status === "REJECTED") &&
                  "sm:bg-transparent",
              )}
            >
              <div>
                <p className="text-sm font-semibold text-ink">
                  {document.status === "VERIFIED" ? "✔ " : ""}
                  {document.label}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {document.statusLabel}
                  {document.fileNameLabel !== "Non renseigné"
                    ? ` · ${document.fileNameLabel}`
                    : ""}
                </p>
              </div>
              <StudentDocumentBadges badges={document.badges} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
