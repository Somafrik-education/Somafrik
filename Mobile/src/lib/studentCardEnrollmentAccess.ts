import { normalize } from "./format";
import { isSuperAdminRole, COUNTRY_ADMIN_ROLE } from "./orgHierarchy";
import { hasSecurityPermission } from "../domain/security/permissions";

type SessionLike = {
  role?: string; roleKey?: string; permissions?: unknown[];
  user?: { role?: string; roleKey?: string; permissions?: unknown[] };
} | null;
export function studentCardEnrollmentAccess(session: SessionLike) {
  if (!session) return { canRead: false, canUpdate: false };
  const roles = [session.roleKey, session.user?.roleKey, session.role, session.user?.role].filter(Boolean).map(String);
  if (!roles.length || roles.some((role) => {
    const key = normalize(role).replace(/_/g, " ");
    return isSuperAdminRole(role) || role === COUNTRY_ADMIN_ROLE ||
      ["country admin", "admin pays", "super admin", "parent", "parent student", "parent guardian", "student", "eleve", "eleve / etudiant"].includes(key);
  })) return { canRead: false, canUpdate: false };

  // Align with the canonical Mobile RBAC used to open the student detail route.
  // Exact token checks hid NFC from authorized school staff when the live rights
  // were expressed as Élèves:CRUD or other equivalent grants.
  // This does not grant rights: the server remains authoritative for NFC writes.
  const canRead = hasSecurityPermission(session, "Élèves", "READ");
  return {
    canRead,
    canUpdate: canRead && hasSecurityPermission(session, "Élèves", "UPDATE"),
  };
}
