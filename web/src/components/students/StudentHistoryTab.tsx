import { getStudentWorkspaceModule } from "../../lib/studentWorkspace";
import { StudentWorkspaceComingSoonTab } from "./StudentWorkspaceComingSoonTab";

export function StudentHistoryTab() {
  return (
    <StudentWorkspaceComingSoonTab
      module={getStudentWorkspaceModule("history")}
    />
  );
}
