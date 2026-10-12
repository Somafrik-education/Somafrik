import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
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

    </div>
  );
}
