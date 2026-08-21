/**
 * Alignement CTA Mobile ↔ contrat RBAC backend (lot L9b).
 *
 * Règle : un bouton / écran n’est exposé que si l’endpoint correspondant
 * accepterait la requête. Aucun grant par `role === PARENT/TEACHER`.
 *
 * Contrats backend (`backend/services/rbacService.js`) :
 * - GET /api/backoffice/messages
 *     Messages:READ | Gérer messages | COUNTRY_PRIVILEGES | ALL_PRIVILEGES
 * - POST /api/backoffice/messages
 *     Messages:CREATE | Gérer messages | COUNTRY_PRIVILEGES | ALL_PRIVILEGES
 *     CREATE n'accorde pas READ ; READ n'accorde pas CREATE.
 * - POST /api/backoffice/announcements/:id/archive
 *     Notifications:UPDATE | Gérer notifications | COUNTRY_PRIVILEGES | ALL_PRIVILEGES
 * - GET/POST/PATCH /api/backoffice/notifications
 *     ALL_PRIVILEGES | COUNTRY_PRIVILEGES uniquement
 *     (Notifications:READ établissement n’ouvre PAS la plateforme)
 *
 * Conversation canonique : `sendMessage()` n’ajoute des destinataires que via
 * `participantUserIds`. Le chemin Parent/Enseignant existant n’envoie que des
 * métadonnées (`studentId` / `parentPhone`). Le composer staff réutilise ce
 * contrat, sans lookup d’utilisateur parent inventé, et sans destinataire
 * implicite.
 */
import { normalize } from "./format";
import {
  hasPlatformBackofficePrivilege,
  hasSecurityPermission,
  getEffectivePermissionsForSession,
} from "../domain/security/permissions";

export type MessagesRouteAccess = {
  canAccessRoute: boolean;
  canReadList: boolean;
  canCompose: boolean;
};

function hasLivePlatformToken(session: any): boolean {
  if (!session) return false;
  const live = getEffectivePermissionsForSession(session);
  return live.includes("ALL_PRIVILEGES") || live.includes("COUNTRY_PRIVILEGES");
}

function liveAllowsMessagesRead(live: string[]): boolean {
  return live.some((permission) => {
    if (permission === "ALL_PRIVILEGES" || permission === "COUNTRY_PRIVILEGES") return true;
    if (permission === "Gérer messages" || permission === "Messages:CRUD") return true;
    if (permission === "Messages:READ" || permission === "Messages:R") return true;
    const normalized = normalize(permission);
    if (!normalized.includes("messages")) return false;
    if (
      normalized.includes("create") &&
      !normalized.includes("read") &&
      !normalized.includes("voir") &&
      !normalized.includes("lire") &&
      !normalized.includes("gerer") &&
      !normalized.includes("crud")
    ) {
      return false;
    }
    return (
      normalized.includes("voir") ||
      normalized.includes("lire") ||
      normalized.includes("gerer") ||
      normalized.includes("read") ||
      normalized.includes("crud")
    );
  });
}

export function canReadBackofficeMessagesList(session: any): boolean {
  if (!session) return false;
  if (hasLivePlatformToken(session)) return true;
  return liveAllowsMessagesRead(getEffectivePermissionsForSession(session));
}

export function canAccessBackofficeMessagesComposer(session: any): boolean {
  if (!session) return false;
  if (hasLivePlatformToken(session)) return true;
  return hasSecurityPermission(session, "Messages", "CREATE");
}

export function resolveMessagesRouteAccess(session: any): MessagesRouteAccess {
  const canReadList = canReadBackofficeMessagesList(session);
  const canCompose = canAccessBackofficeMessagesComposer(session);
  return {
    canAccessRoute: canReadList || canCompose,
    canReadList,
    canCompose,
  };
}

export function canAccessMessagesRoute(session: any): boolean {
  return resolveMessagesRouteAccess(session).canAccessRoute;
}

export function canArchiveAnnouncement(session: any): boolean {
  if (!session) return false;
  if (hasLivePlatformToken(session)) return true;
  return hasSecurityPermission(session, "Notifications", "UPDATE");
}

export function canAccessPlatformNotifications(session: any): boolean {
  return hasPlatformBackofficePrivilege(session);
}

export type StaffMessageStudent = {
  id: string;
  parentPhone?: string;
};

export type StaffMessageDraft = {
  selectedStudentId: string;
  students: StaffMessageStudent[];
  theme: string;
  message: string;
  attachmentUrl?: string;
  priority: string;
};

export type StaffMessagePayloadResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; code: "missing_recipient" | "unknown_recipient" | "empty_message" };

/**
 * Payload staff « École vers parent ». Aucun fallback sur students[0].
 * Le destinataire doit être l'élève explicitement choisi.
 */
export function buildStaffSchoolToParentMessagePayload(
  draft: StaffMessageDraft,
): StaffMessagePayloadResult {
  const body = String(draft.message ?? "").trim();
  if (!body) return { ok: false, code: "empty_message" };

  const selectedId = String(draft.selectedStudentId ?? "").trim();
  if (!selectedId) return { ok: false, code: "missing_recipient" };

  const student = draft.students.find((row) => String(row.id) === selectedId);
  if (!student) return { ok: false, code: "unknown_recipient" };

  const attachmentUrl = String(draft.attachmentUrl ?? "").trim();
  return {
    ok: true,
    payload: {
      parentPhone: student.parentPhone ?? "",
      studentId: student.id,
      theme: draft.theme,
      direction: "École vers parent",
      message: body,
      ...(attachmentUrl ? { attachmentUrl } : {}),
      priority: draft.priority,
    },
  };
}
