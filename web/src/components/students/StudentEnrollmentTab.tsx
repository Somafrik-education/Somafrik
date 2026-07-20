import { getStudentWorkspaceModule } from "../../lib/studentWorkspace";
import { StudentWorkspaceComingSoonTab } from "./StudentWorkspaceComingSoonTab";

export function StudentEnrollmentTab() {
  return (
    <StudentWorkspaceComingSoonTab
      module={getStudentWorkspaceModule("enrollments")}
    />
  );
}
