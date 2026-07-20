import type { StudentWorkspaceModule } from "../../lib/studentWorkspace";
import { Card, SectionHeader } from "../ui/Card";

interface StudentWorkspaceComingSoonTabProps {
  module: StudentWorkspaceModule;
}

export function StudentWorkspaceComingSoonTab({
  module,
}: StudentWorkspaceComingSoonTabProps) {
  return (
    <Card className="p-6">
      <SectionHeader
        title={module.title}
        description="Cette section du dossier élève sera disponible prochainement."
      />
      <p className="mt-6 rounded-xl border border-dashed border-line bg-slate-50 px-4 py-8 text-center text-sm font-medium text-muted">
        Module à venir
      </p>
    </Card>
  );
}
