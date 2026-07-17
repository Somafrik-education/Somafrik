import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { StudentIdentityTab } from "./StudentIdentityTab";

interface StudentWorkspaceTabsProps {
  workspace: StudentWorkspaceViewModel;
}

export function StudentWorkspaceTabs({
  workspace,
}: StudentWorkspaceTabsProps) {
  return <StudentIdentityTab workspace={workspace} />;
}