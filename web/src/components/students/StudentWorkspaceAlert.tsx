import { Link } from "react-router-dom";
import type { StudentWorkspaceAlert as WorkspaceAlert } from "../../lib/studentWorkspaceAlerts";
import { buildStudentWorkspacePath } from "../../lib/studentWorkspaceNavigation";
import { cn } from "../../lib/utils";

interface StudentWorkspaceAlertProps {
  alert: WorkspaceAlert;
  studentId: string;
}

export function StudentWorkspaceAlert({
  alert,
  studentId,
}: StudentWorkspaceAlertProps) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        alert.severity === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-brand/20 bg-brand-50 text-ink",
      )}
    >
      <p className="font-medium">{alert.message}</p>
      <Link
        className="mt-1 inline-flex text-sm font-semibold text-brand underline-offset-2 hover:underline"
        to={buildStudentWorkspacePath(studentId, alert.targetModuleId)}
      >
        Voir la section
      </Link>
    </div>
  );
}
