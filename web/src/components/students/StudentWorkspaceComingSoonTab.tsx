import type { StudentWorkspaceModule } from "../../lib/studentWorkspace";
import { ComingSoonState } from "../../design-system";

interface StudentWorkspaceComingSoonTabProps {
  module: StudentWorkspaceModule;
}

export function StudentWorkspaceComingSoonTab({
  module,
}: StudentWorkspaceComingSoonTabProps) {
  return (
    <ComingSoonState
      title={module.title}
      description="Cette section du dossier élève sera disponible prochainement."
      badge="Module à venir"
    />
  );
}
