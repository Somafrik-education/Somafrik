/**
 * Alignement CTA Mobile ↔ contrat RBAC backend (lot L9b).
 *
 * Un bouton / écran n’est exposé que si l’endpoint correspondant accepterait
 * la requête. Aucun grant par `role === PARENT/TEACHER`.
 *
 * Contrats backend (`backend/services/rbacService.js`) — allowlists exactes :
 * - GET /api/backoffice/messages
 *     Messages:READ | Gérer messages | COUNTRY_PRIVILEGES | ALL_PRIVILEGES
 * - POST /api/backoffice/messages
 *     Messages:CREATE | Gérer messages | COUNTRY_PRIVILEGES | ALL_PRIVILEGES
 * - GET /api/backoffice/contacts
 *     Contacts:READ | Gérer utilisateurs | COUNTRY_PRIVILEGES | ALL_PRIVILEGES
 * - GET /api/backoffice/relations
 *     Relations:READ | Gérer utilisateurs | COUNTRY_PRIVILEGES | ALL_PRIVILEGES
 *
 * Composer staff : Messages:CREATE suffit. Les destinataires viennent de
 * GET /api/backoffice/messages/recipients — pas de Contacts:READ / Relations:READ.
 *
 * Conversation : `sendMessage()` n’ajoute des destinataires que via
 * `participantUserIds`. Un POST staff sans userId parent canonique est interdit.
 */
import { normalize } from "./format";
import { getEffectivePermissionsForSession, hasPlatformBackofficePrivilege, hasSecurityPermission } from "../domain/security/permissions";

export const MESSAGES_READ_ALLOWLIST = [
  "Messages:READ",
  "Gérer messages",
  "COUNTRY_PRIVILEGES",
  "ALL_PRIVILEGES",
] as const;

export const MESSAGES_CREATE_ALLOWLIST = [
  "Messages:CREATE",
  "Gérer messages",
  "COUNTRY_PRIVILEGES",
  "ALL_PRIVILEGES",
] as const;

export const CONTACTS_READ_ALLOWLIST = [
  "Contacts:READ",
  "Gérer utilisateurs",
  "COUNTRY_PRIVILEGES",
  "ALL_PRIVILEGES",
] as const;

export const RELATIONS_READ_ALLOWLIST = [
  "Relations:READ",
  "Gérer utilisateurs",
  "COUNTRY_PRIVILEGES",
  "ALL_PRIVILEGES",
] as const;

export type MessagesRouteAccess = {
  canAccessRoute: boolean;
  canReadList: boolean;
  canCompose: boolean;
};

function liveHasExact(live: string[], allowlist: readonly string[]): boolean {
  return allowlist.some((token) => live.includes(token));
}

function hasLivePlatformToken(session: any): boolean {
  if (!session) return false;
  const live = getEffectivePermissionsForSession(session);
  return live.includes("ALL_PRIVILEGES") || live.includes("COUNTRY_PRIVILEGES");
}

export function canReadBackofficeMessagesList(session: any): boolean {
  if (!session) return false;
  return liveHasExact(getEffectivePermissionsForSession(session), MESSAGES_READ_ALLOWLIST);
}

export function canAccessBackofficeMessagesComposer(session: any): boolean {
  if (!session) return false;
  return liveHasExact(getEffectivePermissionsForSession(session), MESSAGES_CREATE_ALLOWLIST);
}

export function canAccessCanonicalMessageRecipients(session: any): boolean {
  if (!session) return false;
  const live = getEffectivePermissionsForSession(session);
  return liveHasExact(live, CONTACTS_READ_ALLOWLIST) && liveHasExact(live, RELATIONS_READ_ALLOWLIST);
}

export function canShowStaffMessagesComposer(session: any): boolean {
  const role = session?.role;
  if (role === "parent_student" || role === "teacher") return false;
  return canAccessBackofficeMessagesComposer(session);
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
  return hasSecurityPermission(session, "Announcements", "UPDATE");
}

export function canAccessPlatformNotifications(session: any): boolean {
  return hasPlatformBackofficePrivilege(session);
}

export type CanonicalMessageContact = {
  id: string;
  userId?: string;
  schoolCode?: string;
  status?: string;
  firstName?: string;
  lastName?: string;
};

export type CanonicalMessageRelation = {
  id: string;
  fromContactId: string;
  toStudentId: string;
  toStudentName?: string;
  fromContactName?: string;
  schoolCode?: string;
  status?: string;
};

export type CanonicalStaffRecipient = {
  key: string;
  studentId: string;
  studentName: string;
  parentUserId: string;
  parentName: string;
  schoolCode: string;
};

function isActiveStatus(status?: string): boolean {
  const value = normalize(status);
  return !value || value === "actif" || value === "active";
}

export function resolveCanonicalStaffRecipients(input: {
  relations: CanonicalMessageRelation[];
  contacts: CanonicalMessageContact[];
  schoolCode?: string;
}): CanonicalStaffRecipient[] {
  const expectedSchool = normalize(input.schoolCode ?? "");
  const contactsById = new Map(input.contacts.map((contact) => [String(contact.id), contact]));
  const recipients: CanonicalStaffRecipient[] = [];

  for (const relation of input.relations) {
    if (!isActiveStatus(relation.status)) continue;
    const contact = contactsById.get(String(relation.fromContactId));
    if (!contact || !isActiveStatus(contact.status)) continue;
    const parentUserId = String(contact.userId ?? "").trim();
    if (!parentUserId) continue;
    const relationSchool = String(relation.schoolCode ?? "").trim();
    const contactSchool = String(contact.schoolCode ?? "").trim();
    if (!relationSchool || !contactSchool) continue;
    if (normalize(relationSchool) !== normalize(contactSchool)) continue;
    if (expectedSchool && expectedSchool !== "*" && normalize(relationSchool) !== expectedSchool) continue;
    const studentId = String(relation.toStudentId ?? "").trim();
    if (!studentId) continue;
    recipients.push({
      key: String(relation.id),
      studentId,
      studentName: String(relation.toStudentName ?? "").trim(),
      parentUserId,
      parentName:
        String(relation.fromContactName ?? "").trim() ||
        [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim(),
      schoolCode: relationSchool,
    });
  }
  return recipients;
}

export type StaffMessageDraft = {
  selectedRecipientKey: string;
  recipients: CanonicalStaffRecipient[];
  schoolCode?: string;
  theme: string;
  message: string;
  attachmentIds?: string[];
  attachmentUrl?: string;
  priority: string;
};

export type StaffMessagePayloadResult =
  | { ok: true; payload: Record<string, unknown> }
  | {
      ok: false;
      code:
        | "missing_recipient"
        | "unknown_recipient"
        | "empty_message"
        | "no_canonical_parent"
        | "cross_tenant"
        | "client_attachment_url_forbidden";
    };

export function buildStaffSchoolToParentMessagePayload(draft: StaffMessageDraft): StaffMessagePayloadResult {
  const body = String(draft.message ?? "").trim();
  if (!body) return { ok: false, code: "empty_message" };

  const selectedKey = String(draft.selectedRecipientKey ?? "").trim();
  if (!selectedKey) return { ok: false, code: "missing_recipient" };

  const recipient = draft.recipients.find((row) => String(row.key) === selectedKey);
  if (!recipient) return { ok: false, code: "unknown_recipient" };

  const parentUserId = String(recipient.parentUserId ?? "").trim();
  if (!parentUserId) return { ok: false, code: "no_canonical_parent" };

  const expectedSchool = normalize(draft.schoolCode ?? "");
  if (expectedSchool && expectedSchool !== "*" && normalize(recipient.schoolCode) !== expectedSchool) {
    return { ok: false, code: "cross_tenant" };
  }

  const attachmentIds = (draft.attachmentIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean);
  if (String(draft.attachmentUrl ?? "").trim()) {
    return { ok: false, code: "client_attachment_url_forbidden" };
  }
  return {
    ok: true,
    payload: {
      studentId: recipient.studentId,
      participantUserIds: [parentUserId],
      theme: draft.theme,
      direction: "École vers parent",
      message: body,
      ...(attachmentIds.length ? { attachmentIds } : {}),
      priority: draft.priority,
    },
  };
}
