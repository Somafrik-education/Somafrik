import { normalize } from "./format";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "./orgHierarchy";

type SessionLike = {
  role?: string;
  roleKey?: string;
  permissions?: unknown[];
  user?: { role?: string; roleKey?: string; permissions?: unknown[] };
} | null;

function hasRight(tokens: readonly string[], permission: string) {
  return tokens.includes(normalize(permission));
}

/** Les pièces administratives sont réservées au personnel explicitement habilité. */
export function studentDocumentsAccess(session: SessionLike) {
  const roles = [
    session?.user?.roleKey, session?.roleKey,
    session?.user?.role, session?.role,
  ].filter(Boolean).map((value) => String(value));
  const forbidden = !session || roles.some((role) => {
    const normalizedRole = normalize(role);
    return isSuperAdminRole(role) || role === COUNTRY_ADMIN_ROLE ||
      normalizedRole.includes("parent") || normalizedRole.includes("eleve") ||
      normalizedRole.includes("etudiant") || normalizedRole === "student" ||
      normalizedRole.includes("admin pays") ||
      normalizedRole.includes("country admin");
  });
  if (forbidden) return { canRead: false, canCreate: false, canUpdate: false };

  const tokens = [
    ...(Array.isArray(session?.permissions) ? session.permissions : []),
    ...(Array.isArray(session?.user?.permissions) ? session.user.permissions : []),
  ].map((value) => normalize(String(value ?? "")));

  const canRead = hasRight(tokens, "Documents:READ");
  return {
    canRead,
    canCreate: canRead && hasRight(tokens, "Documents:CREATE"),
    canUpdate: canRead && hasRight(tokens, "Documents:UPDATE"),
  };
}
