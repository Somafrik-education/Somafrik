import { Link } from "react-router-dom";
import type { StudentWorkspaceAlert as WorkspaceAlert } from "../../lib/studentWorkspaceAlerts";
import { buildStudentWorkspacePath } from "../../lib/studentWorkspaceNavigation";
import { InlineAlert } from "../../design-system";

interface StudentWorkspaceAlertProps {
  alert: WorkspaceAlert;
  studentId: string;
}

export function StudentWorkspaceAlert({
  alert,
  studentId,
}: StudentWorkspaceAlertProps) {
  const tone = alert.severity === "warning" ? "warning" : "info";

  return (
    <InlineAlert
      tone={tone}
      action={
        <Link
          className="text-sm font-semibold text-brand underline-offset-2 hover:underline"
          to={buildStudentWorkspacePath(studentId, alert.targetModuleId)}
        >
          Voir la section
        </Link>
      }
    >
      {alert.message}
    </InlineAlert>
  );
}
