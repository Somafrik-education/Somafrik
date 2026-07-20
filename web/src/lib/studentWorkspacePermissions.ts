import { canReadView, getCurrentRolePermissions, type PermissionContext } from "./permissions";
import type { StudentWorkspaceModule, StudentWorkspacePermission } from "./studentWorkspace";

/**
 * Vérifie l'accès lecture à un module du dossier élève.
 *
 * Décision (C1.1) :
 * - prérequis : lecture de la vue « students » (feature Élèves) ;
 * - si la matrice expose déjà des jetons `student.*.read`, ils sont respectés ;
 * - sinon, Élèves:READ ouvre tous les modules du dossier (bridge temporaire,
 *   sans modification du RBAC global).
 */
export function canReadStudentWorkspaceModule(
  ctx: PermissionContext,
  permission: StudentWorkspacePermission,
): boolean {
  if (!canReadView(ctx, "students")) {
    return false;
  }

  const effectivePermissions = getCurrentRolePermissions(ctx);
  const granularStudentPermissions = effectivePermissions.filter((token) =>
    /^student\.[a-z]+\.read$/i.test(token.trim()),
  );

  if (granularStudentPermissions.length > 0) {
    return granularStudentPermissions.some(
      (token) => token.trim().toLowerCase() === permission.toLowerCase(),
    );
  }

  return true;
}

export function filterAccessibleStudentWorkspaceModules(
  modules: readonly StudentWorkspaceModule[],
  ctx: PermissionContext,
): StudentWorkspaceModule[] {
  return modules.filter((module) =>
    canReadStudentWorkspaceModule(ctx, module.requiredPermission),
  );
}
