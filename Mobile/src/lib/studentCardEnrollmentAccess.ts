import { normalize } from "./format";
import { isSuperAdminRole, COUNTRY_ADMIN_ROLE } from "./orgHierarchy";

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
  const tokens = [
    ...(Array.isArray(session.permissions) ? session.permissions : []),
    ...(Array.isArray(session.user?.permissions) ? session.user.permissions : []),
  ].map((token) => normalize(String(token)));
  const canRead = ["Élèves:READ", "Voir élèves"].some((token) => tokens.includes(normalize(token)));
  return { canRead, canUpdate: canRead && ["Élèves:UPDATE", "Gérer élèves"].some((token) => tokens.includes(normalize(token))) };
}
