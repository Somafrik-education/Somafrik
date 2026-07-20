import { getStudentWorkspaceModule } from "../../lib/studentWorkspace";
import { StudentWorkspaceComingSoonTab } from "./StudentWorkspaceComingSoonTab";

export function StudentGuardiansTab() {
  return (
    <StudentWorkspaceComingSoonTab
      module={getStudentWorkspaceModule("guardians")}
    />
  );
}
