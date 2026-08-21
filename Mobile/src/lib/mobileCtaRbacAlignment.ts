/**
 * Alignement CTA Mobile ↔ contrat RBAC backend (lot L9b).
 *
 * Règle : un bouton / écran n’est exposé que si l’endpoint correspondant
 * accepterait la requête. Aucun grant par `role === PARENT/TEACHER`.
 *
 * Contrats backend (`backend/services/rbacService.js`) :
 * - POST /api/backoffice/messages
 *     Messages:CREATE | Gérer messages | COUNTRY_PRIVILEGES | ALL_PRIVILEGES
 * - POST /api/backoffice/announcements/:id/archive
 *     Notifications:UPDATE | Gérer notifications | COUNTRY_PRIVILEGES | ALL_PRIVILEGES
 * - GET/POST/PATCH /api/backoffice/notifications
 *     ALL_PRIVILEGES | COUNTRY_PRIVILEGES uniquement
 *     (Notifications:READ établissement n’ouvre PAS la plateforme)
 */
import {
  hasPlatformBackofficePrivilege,
  hasSecurityPermission,
  getEffectivePermissionsForSession,
} from "../domain/security/permissions";

export function canAccessBackofficeMessagesComposer(session: any): boolean {
  if (!session) return false;
  const live = getEffectivePermissionsForSession(session);
  if (live.includes("ALL_PRIVILEGES") || live.includes("COUNTRY_PRIVILEGES")) {
    return true;
  }
  return hasSecurityPermission(session, "Messages", "CREATE");
}

export function canArchiveAnnouncement(session: any): boolean {
  if (!session) return false;
  const live = getEffectivePermissionsForSession(session);
  if (live.includes("ALL_PRIVILEGES") || live.includes("COUNTRY_PRIVILEGES")) {
    return true;
  }
  return hasSecurityPermission(session, "Notifications", "UPDATE");
}

export function canAccessPlatformNotifications(session: any): boolean {
  return hasPlatformBackofficePrivilege(session);
}
