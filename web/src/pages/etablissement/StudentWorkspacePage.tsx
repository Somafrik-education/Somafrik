import { Link, Navigate, useParams } from "react-router-dom";
import { StudentWorkspaceHeader } from "../../components/students/StudentWorkspaceHeader";
import { StudentWorkspaceTabs } from "../../components/students/StudentWorkspaceTabs";
import { Card } from "../../components/ui/Card";
import { useStudentWorkspace } from "../../hooks/useStudentWorkspace";
import { usePermissionContext } from "../../lib/usePermissionContext";
import {
  getStudentWorkspaceNavigationModules,
  resolveStudentWorkspaceModuleIdFromSection,
} from "../../lib/studentWorkspaceNavigation";
import {
  canReadStudentWorkspaceModule,
  filterAccessibleStudentWorkspaceModules,
} from "../../lib/studentWorkspacePermissions";
import { getStudentWorkspaceModule } from "../../lib/studentWorkspace";

export function StudentWorkspacePage() {
  const { studentId = "", section } = useParams();
  const normalizedStudentId = studentId.trim();
  const { workspace, loading, error } = useStudentWorkspace(normalizedStudentId);
  const permissionCtx = usePermissionContext();

  if (!normalizedStudentId) {
    return <Navigate to="/etablissement/eleves" replace />;
  }

  const resolvedModuleId = resolveStudentWorkspaceModuleIdFromSection(section);

  if (resolvedModuleId === null) {
    return (
      <Navigate to={`/etablissement/eleves/${encodeURIComponent(normalizedStudentId)}`} replace />
    );
  }

  if (loading) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted">Chargement de la fiche élève…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="font-semibold text-danger">
          Impossible de charger la fiche élève.
        </p>
        <p className="mt-2 text-sm text-muted">{error}</p>
      </Card>
    );
  }

  if (!workspace) {
    return (
      <Card className="p-6">
        <p className="font-semibold">Élève introuvable</p>
        <Link
          className="mt-3 inline-flex text-sm font-semibold text-brand"
          to="/etablissement/eleves"
        >
          Retour à la liste des élèves
        </Link>
      </Card>
    );
  }

  const navigationModules = filterAccessibleStudentWorkspaceModules(
    getStudentWorkspaceNavigationModules(),
    permissionCtx,
  );

  const requestedModule = getStudentWorkspaceModule(resolvedModuleId);
  const canAccessRequestedModule = canReadStudentWorkspaceModule(
    permissionCtx,
    requestedModule.requiredPermission,
  );

  const visibleModules =
    navigationModules.length > 0
      ? navigationModules
      : getStudentWorkspaceNavigationModules().filter(
          (module) => module.id === "overview",
        );

  return (
    <div className="space-y-6">
      <StudentWorkspaceHeader workspace={workspace} />
      <StudentWorkspaceTabs
        workspace={workspace}
        modules={visibleModules}
        activeModuleId={resolvedModuleId}
        accessDenied={!canAccessRequestedModule}
      />
    </div>
  );
}
