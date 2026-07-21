import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { Card } from "../ui/Card";
import { StudentDocumentsList } from "./StudentDocumentsList";
import { StudentDocumentsSummary } from "./StudentDocumentsSummary";

interface StudentDocumentsTabProps {
  workspace: StudentWorkspaceViewModel;
}

export function StudentDocumentsTab({ workspace }: StudentDocumentsTabProps) {
  const documents = workspace.documentsModule;

  return (
    <div className="space-y-6" data-testid="student-documents-tab">
      <StudentDocumentsSummary documents={documents} />
      <StudentDocumentsList documents={documents.documents} />

      <Card className="p-5">
        <p className="text-sm font-semibold text-ink">
          Actions documentaires à venir
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {["Téléverser", "Vérifier", "Supprimer"].map((label) => (
            <button
              key={label}
              type="button"
              disabled
              className="inline-flex min-h-10 items-center rounded-lg border border-line bg-slate-50 px-3 text-sm font-semibold text-muted opacity-60"
            >
              {label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
