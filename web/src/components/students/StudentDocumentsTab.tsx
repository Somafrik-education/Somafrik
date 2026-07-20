import { getStudentWorkspaceModule } from "../../lib/studentWorkspace";
import { StudentWorkspaceComingSoonTab } from "./StudentWorkspaceComingSoonTab";

export function StudentDocumentsTab() {
  return (
    <StudentWorkspaceComingSoonTab
      module={getStudentWorkspaceModule("documents")}
    />
  );
}
