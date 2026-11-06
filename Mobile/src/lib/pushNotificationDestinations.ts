import { isLinkedParentStudent } from "./canonicalStudentIdentity";

/**
 * NOTIF-MOBILE-NAV — résolveur unique des destinations de notification Mobile.
 *
 * Une seule table traduit une cible de notification en écran existant. Elle sert
 * au Push (nouveau contrat canonique #1090 et anciennes clés `somafrik*`) et au
 * centre de notifications in-app. Une cible désigne une ressource ; elle ne vaut
 * jamais autorisation : l'écran recharge la ressource via son API protégée.
 *
 * Fail-closed : type inconnu, identifiant absent ou malformé → aucune ressource.
 */

export const SOMAFRIK_PUSH_CHANNEL_ID = "somafrik-default-v2";
export const ALLOWED_PUSH_DESTINATIONS = [
  "Home",
  "StudentPayments",
  "StudentNotes",
  "StudentPresences",
  "Messages",
  "Announcements",
  "ReportCards",
  "Timetable",
  "InternalNotifications",
] as const;
export type AllowedPushDestination = (typeof ALLOWED_PUSH_DESTINATIONS)[number];
export type AllowedPushNavigationParams = {
  studentId?: string;
  conversationId?: string;
  announcementId?: string;
};

/** Contexte de la notification ouverte : jamais une autorisation. */
export type NotificationNavigationMeta = {
  notificationId?: string;
  schoolCode?: string;
};

export type ResolvedNotificationNavigation = {
  destination: AllowedPushDestination;
  params?: AllowedPushNavigationParams;
  /** `true` seulement si la cible désigne une ressource précise et valide. */
  resolved: boolean;
  meta: NotificationNavigationMeta;
};

type ParamKey = keyof AllowedPushNavigationParams;

/**
 * Contrat cible → écran. Les clés reprennent `TARGET_RESOURCES` du backend
 * (`backend/lib/communicationsNavigationTargets.js`). Les écrans sans paramètre
 * (`Timetable`) s'ouvrent sans focus : limite documentée dans la PR.
 */
const TARGET_DESTINATIONS: Readonly<
  Record<string, { destination: AllowedPushDestination; param?: ParamKey }>
> = Object.freeze({
  conversation: { destination: "Messages", param: "conversationId" },
  announcement: { destination: "Announcements", param: "announcementId" },
  attendance: { destination: "StudentPresences", param: "studentId" },
  grade: { destination: "StudentNotes", param: "studentId" },
  payment: { destination: "StudentPayments", param: "studentId" },
  finance_obligation: { destination: "StudentPayments", param: "studentId" },
  report_card: { destination: "ReportCards", param: "studentId" },
  timetable: { destination: "Timetable" },
  teacher_replacement: { destination: "Timetable" },
});

/** Anciennes clés Push (avant #1090), toujours émises par le backend. */
const LEGACY_DESTINATION_PARAMS: Readonly<Partial<Record<AllowedPushDestination, { param: ParamKey; key: string }>>> =
  Object.freeze({
    StudentPayments: { param: "studentId", key: "somafrikStudentId" },
    Messages: { param: "conversationId", key: "somafrikConversationId" },
    Announcements: { param: "announcementId", key: "somafrikAnnouncementId" },
  });

const SAFE_RESOURCE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHOOL_CODE = /^[A-Za-z0-9_-]{1,80}$/;

export function readSafeResourceId(value: unknown): string {
  const id = String(value ?? "").trim();
  return SAFE_RESOURCE_ID.test(id) ? id : "";
}

/** Les identifiants serveur sont des UUID : toute autre forme est refusée. */
export function readResourceUuid(value: unknown): string {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return UUID.test(id) ? id.toLowerCase() : "";
}

function readSchoolCode(value: unknown): string {
  if (typeof value !== "string") return "";
  const code = value.trim();
  return SCHOOL_CODE.test(code) ? code.toUpperCase() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readMeta(record: Record<string, unknown>, notificationIdKey = "notificationId"): NotificationNavigationMeta {
  const meta: NotificationNavigationMeta = {};
  const notificationId = readResourceUuid(record[notificationIdKey]);
  if (notificationId) meta.notificationId = notificationId;
  const schoolCode = readSchoolCode(record.schoolCode);
  if (schoolCode) meta.schoolCode = schoolCode;
  return meta;
}

function fallback(meta: NotificationNavigationMeta): ResolvedNotificationNavigation {
  return { destination: "Home", resolved: false, meta };
}

/** Traduit une cible `{ type, …ids }` en écran. `null` si elle n'est pas ouvrable. */
function resolveTarget(target: Record<string, unknown>): Pick<ResolvedNotificationNavigation, "destination" | "params"> | null {
  const type = typeof target.type === "string" ? target.type.trim() : "";
  if (!type || !Object.prototype.hasOwnProperty.call(TARGET_DESTINATIONS, type)) return null;
  const spec = TARGET_DESTINATIONS[type];
  if (!spec.param) return { destination: spec.destination };
  const id = readResourceUuid(target[spec.param]);
  if (!id) return null;
  return { destination: spec.destination, params: { [spec.param]: id } };
}

export function resolvePushDestination(value: unknown): AllowedPushDestination {
  const destination = String(value ?? "").trim();
  if ((ALLOWED_PUSH_DESTINATIONS as readonly string[]).includes(destination)) {
    return destination as AllowedPushDestination;
  }
  return "Home";
}

/** La donnée revendique-t-elle une ressource (type canonique ou ancienne destination non accueil) ? */
function claimsTarget(record: Record<string, unknown>): boolean {
  const type = typeof record.type === "string" ? record.type.trim() : "";
  if (type || record.resourceType != null || record.resourceId != null) return true;
  return resolvePushDestination(record.somafrikDestination) !== "Home";
}

function resolveLegacyPush(record: Record<string, unknown>): Pick<ResolvedNotificationNavigation, "destination" | "params"> | null {
  const destination = resolvePushDestination(record.somafrikDestination);
  if (destination === "InternalNotifications") return { destination };
  const legacy = LEGACY_DESTINATION_PARAMS[destination];
  if (!legacy) return null;
  const id = readResourceUuid(record[legacy.key]);
  if (!id) return null;
  return { destination, params: { [legacy.param]: id } };
}

/**
 * Données Push → destination. Contrat canonique (`type` + identifiants) en
 * priorité ; à défaut, anciennes clés `somafrikDestination` / `somafrik*Id`.
 * Une notification sans ressource mais identifiée ouvre le centre de notifications.
 */
export function resolveNotificationPushData(data: unknown): ResolvedNotificationNavigation {
  const record = asRecord(data);
  const meta = readMeta(record);
  const target = resolveTarget(record) ?? resolveLegacyPush(record);
  if (target) return { ...target, resolved: true, meta };
  // Centre de notifications seulement pour une notification sans aucune cible
  // (notification manuelle). Une cible présente mais invalide reste fail-closed.
  if (meta.notificationId && !claimsTarget(record)) {
    return { destination: "InternalNotifications", resolved: true, meta };
  }
  return fallback(meta);
}

/** Notification du centre in-app (`GET /internal-notifications`) → destination. */
export function resolveNotificationRecord(row: unknown): ResolvedNotificationNavigation {
  const record = asRecord(row);
  const meta = readMeta(record, "id");
  const target = resolveTarget(asRecord(record.navigationTarget));
  if (target) return { ...target, resolved: true, meta };
  return fallback(meta);
}

/** Compatibilité : forme historique `{ destination, params }` des données Push. */
export function resolvePushNavigationData(data: unknown): {
  destination: AllowedPushDestination;
  params?: AllowedPushNavigationParams;
} {
  const { destination, params } = resolveNotificationPushData(data);
  return params ? { destination, params } : { destination };
}

/** Compatibilité : cible in-app → `{ destination, params }`, ou `null` si non ouvrable. */
export function resolveInternalNotificationNavigationTarget(target: unknown): {
  destination: AllowedPushDestination;
  params?: AllowedPushNavigationParams;
} | null {
  const resolved = resolveTarget(asRecord(target));
  if (!resolved) return null;
  return resolved.params ? { destination: resolved.destination, params: resolved.params } : { destination: resolved.destination };
}

export function constrainParentPushNavigation<
  T extends { destination: AllowedPushDestination; params?: AllowedPushNavigationParams },
>(
  target: T,
  session: { role?: string | null; user?: { children?: unknown } | null } | null | undefined,
): T | { destination: AllowedPushDestination; params?: undefined } {
  const studentId = String(target.params?.studentId ?? "").trim();
  if (!studentId) return target;
  if (session?.role !== "parent_student") return target;
  if (isLinkedParentStudent({ user: session.user as never, selectedStudentId: studentId })) {
    return target;
  }
  return { destination: "Home" };
}

export function isAllowlistedPushDestination(value: unknown): boolean {
  return (ALLOWED_PUSH_DESTINATIONS as readonly string[]).includes(String(value ?? "").trim());
}
