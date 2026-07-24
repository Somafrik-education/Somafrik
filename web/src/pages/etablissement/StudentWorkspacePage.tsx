import { Link, Navigate, useParams } from "react-router-dom";
import { StudentWorkspaceHeader } from "../../components/students/StudentWorkspaceHeader";
import { StudentWorkspaceTabs } from "../../components/students/StudentWorkspaceTabs";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  RecordLayout,
} from "../../design-system";
import { useStudentEditingContext } from "../../hooks/useStudentEditingContext";
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

/**
 * Fiche élève — workspace (D3.1).
 * Layout RecordLayout + feedback DS ; logique métier inchangée.
 */
export function StudentWorkspacePage() {
  const { studentId = "", section } = useParams();
  const normalizedStudentId = studentId.trim();
  const editing = useStudentEditingContext(normalizedStudentId);
  const { workspace, loading, error } = useStudentWorkspace(normalizedStudentId, {
    enrollmentOverride: editing.enrollmentRecords,
  });
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
    return <LoadingState message="Chargement de la fiche élève…" />;
  }

  if (error) {
    return (
      <ErrorState
        title="Impossible de charger la fiche élève."
        message={error}
        action={
          <Link className="text-sm font-semibold text-brand" to="/etablissement/eleves">
            Retour à la liste des élèves
          </Link>
        }
      />
    );
  }

  if (!workspace) {
    return (
      <EmptyState
        title="Élève introuvable"
        action={
          <Link className="text-sm font-semibold text-brand" to="/etablissement/eleves">
            Retour à la liste des élèves
          </Link>
        }
      />
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
    <RecordLayout>
      <RecordLayout.Header>
        <StudentWorkspaceHeader workspace={workspace} />
      </RecordLayout.Header>
      <RecordLayout.Content>
        <StudentWorkspaceTabs
          workspace={workspace}
          modules={visibleModules}
          activeModuleId={resolvedModuleId}
          accessDenied={!canAccessRequestedModule}
        />
      </RecordLayout.Content>
    </RecordLayout>
  );
}
