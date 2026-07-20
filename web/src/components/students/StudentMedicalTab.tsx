import { getStudentWorkspaceModule } from "../../lib/studentWorkspace";
import { StudentWorkspaceComingSoonTab } from "./StudentWorkspaceComingSoonTab";

export function StudentMedicalTab() {
  return (
    <StudentWorkspaceComingSoonTab
      module={getStudentWorkspaceModule("health")}
    />
  );
}
