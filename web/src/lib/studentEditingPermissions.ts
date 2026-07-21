import {
  canReadView,
  getCurrentRolePermissions,
  type PermissionContext,
} from "./permissions";
import type { StudentEditAuthorizationContext } from "./studentEditing";
import type { StudentWorkspaceCommand } from "./studentEditingCommands";

export type StudentEditingPermission =
  | "student.identity.update"
  | "student.guardians.update"
  | "student.administrative.update"
  | "student.medical.update"
  | "student.medical.validate"
  | "student.documents.upload"
  | "student.documents.verify"
  | "student.enrollments.update"
  | "student.archive";

/** Permissions C1.7 actives. */
export const STUDENT_EDITING_PERMISSIONS = [
  "student.identity.update",
  "student.guardians.update",
  "student.administrative.update",
] as const satisfies readonly StudentEditingPermission[];

/** Permissions futures — non accordées par le bridge Élèves:UPDATE. */
export const FUTURE_STUDENT_EDITING_PERMISSIONS = [
  "student.medical.update",
  "student.medical.validate",
  "student.documents.upload",
  "student.documents.verify",
  "student.enrollments.update",
  "student.archive",
] as const satisfies readonly StudentEditingPermission[];

const BRIDGE_UPDATE_PERMISSION = "Élèves:UPDATE";

const BRIDGE_GRANTED: ReadonlySet<string> = new Set([
  "student.identity.update",
  "student.guardians.update",
  "student.administrative.update",
]);

function hasToken(permissions: readonly string[], token: string): boolean {
  const expected = token.trim().toLowerCase();
  return permissions.some((item) => item.trim().toLowerCase() === expected);
}

function hasBridgeUpdate(permissions: readonly string[]): boolean {
  return permissions.some(
    (item) => item.trim().toLowerCase() === BRIDGE_UPDATE_PERMISSION.toLowerCase(),
  );
}

/**
 * Permission d'édition dossier.
 *
 * - jetons granulaires `student.*.update` respectés lorsqu'ils sont présents ;
 * - bridge temporaire `Élèves:UPDATE` → uniquement identity / guardians / administrative ;
 * - jamais medical.update, documents.verify, archive via le bridge.
 */
export function canUpdateStudentWorkspace(
  ctx: PermissionContext | StudentEditAuthorizationContext,
  permission: StudentEditingPermission,
): boolean {
  const permissions =
    "user" in ctx
      ? getCurrentRolePermissions(ctx as PermissionContext)
      : (ctx as StudentEditAuthorizationContext).permissions;

  if ("user" in ctx) {
    if (!canReadView(ctx as PermissionContext, "students")) {
      return false;
    }
  }

  if (hasToken(permissions, permission)) {
    return true;
  }

  if (
    hasBridgeUpdate(permissions) &&
    BRIDGE_GRANTED.has(permission)
  ) {
    return true;
  }

  return false;
}

export function permissionForCommand(
  command: StudentWorkspaceCommand,
): StudentEditingPermission {
  switch (command.type) {
    case "UPDATE_STUDENT_IDENTITY":
      return "student.identity.update";
    case "UPDATE_GUARDIAN_CONTACT":
      return "student.guardians.update";
    case "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS":
      return "student.administrative.update";
  }
}

export function assertSameSchool(
  contextSchoolCode: string,
  aggregateSchoolCode: string,
): boolean {
  return (
    contextSchoolCode.trim().toLowerCase() ===
    aggregateSchoolCode.trim().toLowerCase()
  );
}

export function toEditAuthorizationContext(
  ctx: PermissionContext,
  schoolCode: string,
): StudentEditAuthorizationContext {
  const user = ctx.user;
  return {
    userId: String(user?.id ?? "").trim() || "unknown",
    role: String(user?.role ?? "").trim() || "unknown",
    schoolCode: schoolCode.trim(),
    permissions: getCurrentRolePermissions(ctx),
  };
}
