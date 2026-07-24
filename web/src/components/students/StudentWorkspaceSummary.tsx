import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { StudentWorkspaceHeader } from "./StudentWorkspaceHeader";

interface StudentWorkspaceSummaryProps {
  workspace: StudentWorkspaceViewModel;
}

/** @deprecated Utiliser StudentWorkspaceHeader — conservé pour compatibilité. */
export function StudentWorkspaceSummary({
  workspace,
}: StudentWorkspaceSummaryProps) {
  return <StudentWorkspaceHeader workspace={workspace} />;
}
