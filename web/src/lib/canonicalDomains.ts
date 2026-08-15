import type { DomainKey } from "./domainLoaders";

/**
 * P0 SYNC-CANONICAL-STATE — domaines dont un GET réussi est autoritaire (PostgreSQL).
 * Tous les DOMAIN_KEYS ont une API GET canonique ; seuls certains restent offline-capables.
 */
export const CANONICAL_DOMAIN_KEYS = [
  "schools",
  "countries",
  "subscriptions",
  "notifications",
  "rolePermissions",
  "dashboardChartConfig",
  "users",
  "contacts",
  "relations",
  "messages",
  "announcements",
  "students",
  "teachers",
  "classes",
  "courses",
  "courseSchedules",
  "assignments",
  "payments",
  "paymentStatuses",
  "feeGrids",
  "studentFees",
  "notes",
  "presences",
  "academicConfigs",
  "exams",
  "bulletins",
  "documents",
] as const satisfies readonly DomainKey[];

export type CanonicalDomainKey = (typeof CANONICAL_DOMAIN_KEYS)[number];

/** Domaines encore suivis par l'outbox (mutations locales non ACK). */
export const OFFLINE_CAPABLE_DOMAIN_KEYS = [
  "evaluations",
  "notes",
  "presences",
  "exams",
  "payments",
] as const;

export type OfflineCapableDomainKey = (typeof OFFLINE_CAPABLE_DOMAIN_KEYS)[number];

export const SCHOOL_SCOPED_CANONICAL_KEYS = [
  "contacts",
  "relations",
  "students",
  "teachers",
  "classes",
  "courses",
  "assignments",
  "courseSchedules",
  "payments",
  "paymentStatuses",
  "feeGrids",
  "studentFees",
  "presences",
  "notes",
  "exams",
  "bulletins",
  "documents",
  "announcements",
  "messages",
  "users",
] as const;

export const GLOBAL_CANONICAL_LIST_KEYS = [
  "schools",
  "countries",
  "subscriptions",
  "notifications",
] as const;

export const OBJECT_CANONICAL_KEYS = [
  "rolePermissions",
  "dashboardChartConfig",
  "academicConfigs",
] as const;

const canonicalSet = new Set<string>(CANONICAL_DOMAIN_KEYS);
const offlineSet = new Set<string>(OFFLINE_CAPABLE_DOMAIN_KEYS);
const schoolScopedSet = new Set<string>(SCHOOL_SCOPED_CANONICAL_KEYS);

export function isCanonicalDomainKey(key: string): key is CanonicalDomainKey {
  return canonicalSet.has(key);
}

export function isOfflineCapableDomain(key: string): key is OfflineCapableDomainKey {
  return offlineSet.has(key);
}

export function isSchoolScopedCanonicalKey(key: string): boolean {
  return schoolScopedSet.has(key);
}

/** Domaine résiduel : sync via PUT academic-config uniquement (pas de GET merge conservateur). */
export const RESIDUAL_DOMAIN_KEYS = [] as const;
