import { Link } from "react-router-dom";
import type {
  StudentWorkspaceModule,
  StudentWorkspaceModuleId,
} from "../../lib/studentWorkspace";
import { buildStudentWorkspacePath } from "../../lib/studentWorkspaceNavigation";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { Card } from "../ui/Card";
import { StudentDocumentsTab } from "./StudentDocumentsTab";
import { StudentEnrollmentTab } from "./StudentEnrollmentTab";
import { StudentGuardiansTab } from "./StudentGuardiansTab";
import { StudentHistoryTab } from "./StudentHistoryTab";
import { StudentIdentityTab } from "./StudentIdentityTab";
import { StudentMedicalTab } from "./StudentMedicalTab";
import { StudentOverviewTab } from "./StudentOverviewTab";
import { StudentWorkspaceComingSoonTab } from "./StudentWorkspaceComingSoonTab";
import { StudentWorkspaceNavigation } from "./StudentWorkspaceNavigation";

interface StudentWorkspaceTabsProps {
  workspace: StudentWorkspaceViewModel;
  modules: readonly StudentWorkspaceModule[];
  activeModuleId: StudentWorkspaceModuleId;
  accessDenied?: boolean;
}

function renderActiveTab(
  moduleId: StudentWorkspaceModuleId,
  workspace: StudentWorkspaceViewModel,
  module: StudentWorkspaceModule | undefined,
) {
  switch (moduleId) {
    case "overview":
      return <StudentOverviewTab workspace={workspace} />;
    case "identity":
      return <StudentIdentityTab workspace={workspace} />;
    case "enrollments":
      return <StudentEnrollmentTab workspace={workspace} />;
    case "guardians":
      return <StudentGuardiansTab workspace={workspace} />;
    case "health":
      return <StudentMedicalTab workspace={workspace} />;
    case "documents":
      return <StudentDocumentsTab workspace={workspace} />;
    case "history":
      return <StudentHistoryTab workspace={workspace} />;
    default:
      return module ? (
        <StudentWorkspaceComingSoonTab module={module} />
      ) : null;
  }
}

export function StudentWorkspaceTabs({
  workspace,
  modules,
  activeModuleId,
  accessDenied = false,
}: StudentWorkspaceTabsProps) {
  const activeModule = modules.find((module) => module.id === activeModuleId);

  return (
    <div className="space-y-6">
      <StudentWorkspaceNavigation
        studentId={workspace.studentId}
        modules={modules}
      />

      {accessDenied ? (
        <Card className="p-6">
          <p className="font-semibold text-danger">Accès non autorisé</p>
          <p className="mt-2 text-sm text-muted">
            Vous n&apos;avez pas la permission de consulter cette section du
            dossier élève.
          </p>
          <Link
            className="mt-4 inline-flex text-sm font-semibold text-brand"
            to={buildStudentWorkspacePath(workspace.studentId, "overview")}
          >
            Retour à la vue d&apos;ensemble
          </Link>
        </Card>
      ) : (
        renderActiveTab(activeModuleId, workspace, activeModule)
      )}
    </div>
  );
}
