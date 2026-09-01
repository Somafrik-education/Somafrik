import { unwrapList } from "../lib/dataTruth";
import { withCommunicationSchoolPayload, withCommunicationSchoolScope, hasCommunicationSchoolScope } from "../lib/communicationSchoolScope";
import { getRequestSchoolScope } from "../lib/requestSchoolScope";
import {
  normalizeAnnouncement,
  normalizeCountry,
  normalizeMessage,
  normalizePlatformNotification,
  normalizeSchool,
  normalizeSubscription,
  normalizeTeacher,
  normalizeUser,
  type CanonicalAnnouncement,
  type CanonicalSchoolMessage,
  type CanonicalTeacher,
  type CanonicalUserAccount,
} from "../lib/canonicalResourceNormalize";
import type { CanonicalMessageContact, CanonicalMessageRelation } from "../lib/mobileCtaRbacAlignment";
import type { CountryProfile, SchoolProfile, SubscriptionItem } from "../data/catalog";
import type { PlatformNotification } from "../lib/scope";
import { httpRequest } from "./httpClient";

export type {
  CanonicalAnnouncement,
  CanonicalSchoolMessage,
  CanonicalTeacher,
  CanonicalUserAccount,
} from "../lib/canonicalResourceNormalize";
export {
  normalizeAnnouncement,
  normalizeMessage,
  normalizeSchool,
  normalizeTeacher,
  readTenantScopeFields,
} from "../lib/canonicalResourceNormalize";

export async function getCanonicalTeachers(): Promise<CanonicalTeacher[]> {
  const payload = await httpRequest<unknown>("/teachers");
  return unwrapList(payload).map(normalizeTeacher).filter((row): row is CanonicalTeacher => Boolean(row));
}

export async function getCanonicalUsers(): Promise<CanonicalUserAccount[]> {
  const payload = await httpRequest<unknown>("/backoffice/users");
  return unwrapList(payload).map(normalizeUser).filter((row): row is CanonicalUserAccount => Boolean(row));
}

export async function getCanonicalAnnouncements(schoolCode?: string): Promise<CanonicalAnnouncement[]> {
  const scope = schoolCode || getRequestSchoolScope();
  const [platformPayload, schoolPayload] = await Promise.all([
    httpRequest<unknown>("/backoffice/platform-announcements"),
    hasCommunicationSchoolScope(scope)
      ? httpRequest<unknown>(withCommunicationSchoolScope("/backoffice/announcements", scope))
      : Promise.resolve([]),
  ]);
  const platform = unwrapList(platformPayload)
    .map(normalizeAnnouncement)
    .filter((row): row is CanonicalAnnouncement => Boolean(row))
    .map((row) => ({ ...row, source: "platform" as const }));
  const school = unwrapList(schoolPayload)
    .map(normalizeAnnouncement)
    .filter((row): row is CanonicalAnnouncement => Boolean(row))
    .map((row) => ({ ...row, source: "school" as const }));
  return [...platform, ...school].sort((left, right) => {
    const a = Date.parse(String(left.publishedAt || left.createdAt || left.date || "")) || 0;
    const b = Date.parse(String(right.publishedAt || right.createdAt || right.date || "")) || 0;
    return b - a;
  });
}

function scopedMessagesPath(path: string, schoolCode?: string | null): string {
  return withCommunicationSchoolScope(path, schoolCode || getRequestSchoolScope());
}

export async function getCanonicalMessages(schoolCode?: string): Promise<CanonicalSchoolMessage[]> {
  const payload = await httpRequest<unknown>(scopedMessagesPath("/backoffice/messages", schoolCode));
  return unwrapList(payload)
    .map(normalizeMessage)
    .filter((row): row is CanonicalSchoolMessage => Boolean(row));
}

function asTrimmedField(value: unknown): string {
  return String(value ?? "").trim();
}

function mapCanonicalContact(row: unknown): CanonicalMessageContact | null {
  if (!row || typeof row !== "object") return null;
  const item = row as Record<string, unknown>;
  const id = asTrimmedField(item.id);
  if (!id) return null;
  const mapped: CanonicalMessageContact = { id };
  const userId = asTrimmedField(item.userId);
  const schoolCode = asTrimmedField(item.schoolCode);
  const status = asTrimmedField(item.status);
  const firstName = asTrimmedField(item.firstName);
  const lastName = asTrimmedField(item.lastName);
  if (userId) mapped.userId = userId;
  if (schoolCode) mapped.schoolCode = schoolCode;
  if (status) mapped.status = status;
  if (firstName) mapped.firstName = firstName;
  if (lastName) mapped.lastName = lastName;
  return mapped;
}

function mapCanonicalRelation(row: unknown): CanonicalMessageRelation | null {
  if (!row || typeof row !== "object") return null;
  const item = row as Record<string, unknown>;
  const id = asTrimmedField(item.id);
  const fromContactId = asTrimmedField(item.fromContactId);
  const toStudentId = asTrimmedField(item.toStudentId);
  if (!id || !fromContactId || !toStudentId) return null;
  const mapped: CanonicalMessageRelation = { id, fromContactId, toStudentId };
  const toStudentName = asTrimmedField(item.toStudentName);
  const fromContactName = asTrimmedField(item.fromContactName);
  const schoolCode = asTrimmedField(item.schoolCode);
  const status = asTrimmedField(item.status);
  if (toStudentName) mapped.toStudentName = toStudentName;
  if (fromContactName) mapped.fromContactName = fromContactName;
  if (schoolCode) mapped.schoolCode = schoolCode;
  if (status) mapped.status = status;
  return mapped;
}

export async function getCanonicalContacts(): Promise<CanonicalMessageContact[]> {
  const payload = await httpRequest<unknown>("/backoffice/contacts");
  return unwrapList(payload)
    .map(mapCanonicalContact)
    .filter((row): row is CanonicalMessageContact => Boolean(row));
}

export async function getCanonicalRelations(): Promise<CanonicalMessageRelation[]> {
  const payload = await httpRequest<unknown>("/backoffice/relations");
  return unwrapList(payload)
    .map(mapCanonicalRelation)
    .filter((row): row is CanonicalMessageRelation => Boolean(row));
}

function usesPlatformSchoolCatalog(session?: { role?: string; user?: { role?: string; schoolCode?: string } }) {
  const role = String(session?.role ?? session?.user?.role ?? "").toLowerCase();
  return (
    role === "super_admin" ||
    role.includes("super administrateur") ||
    role === "country_admin" ||
    role === "admin pays"
  );
}

export async function getCanonicalSchools(session?: {
  role?: string;
  user?: { schoolCode?: string; role?: string };
}): Promise<SchoolProfile[]> {
  const membership = String(session?.user?.schoolCode ?? "").trim();
  if (!usesPlatformSchoolCatalog(session) && membership && membership !== "*") {
    const row = await httpRequest<unknown>(`/backoffice/establishments/${encodeURIComponent(membership)}`);
    const mapped = normalizeSchool(row);
    return mapped ? [mapped] : [];
  }
  const payload = await httpRequest<unknown>("/backoffice/establishments");
  return unwrapList(payload).map(normalizeSchool).filter((row): row is SchoolProfile => Boolean(row));
}

export async function getCanonicalCountries(): Promise<CountryProfile[]> {
  const payload = await httpRequest<unknown>("/backoffice/countries");
  return unwrapList(payload).map(normalizeCountry).filter((row): row is CountryProfile => Boolean(row));
}

export async function getCanonicalSubscriptions(): Promise<SubscriptionItem[]> {
  const payload = await httpRequest<unknown>("/backoffice/subscriptions");
  return unwrapList(payload)
    .map(normalizeSubscription)
    .filter((row): row is SubscriptionItem => Boolean(row));
}

export async function getCanonicalNotifications(): Promise<PlatformNotification[]> {
  const payload = await httpRequest<unknown>("/backoffice/notifications");
  return unwrapList(payload)
    .map(normalizePlatformNotification)
    .filter((row): row is PlatformNotification => Boolean(row));
}

export async function archiveCanonicalAnnouncement(
  announcementId: string,
  schoolCode?: string,
  source?: string,
): Promise<CanonicalAnnouncement | null> {
  const platform = source === "platform";
  const payload = await httpRequest<unknown>(
    platform
      ? `/backoffice/platform-announcements/${encodeURIComponent(announcementId)}/archive`
      : withCommunicationSchoolScope(
          `/backoffice/announcements/${encodeURIComponent(announcementId)}/archive`,
          schoolCode || getRequestSchoolScope(),
        ),
    {
      method: "POST",
      body: JSON.stringify(
        platform ? {} : withCommunicationSchoolPayload({}, schoolCode || getRequestSchoolScope()),
      ),
    },
  );
  return normalizeAnnouncement(payload);
}

export async function markCanonicalAnnouncementRead(
  announcementId: string,
  schoolCode?: string,
  source?: string,
): Promise<CanonicalAnnouncement | null> {
  const platform = source === "platform";
  const payload = await httpRequest<unknown>(
    platform
      ? `/backoffice/platform-announcements/${encodeURIComponent(announcementId)}/read`
      : withCommunicationSchoolScope(
          `/backoffice/announcements/${encodeURIComponent(announcementId)}/read`,
          schoolCode || getRequestSchoolScope(),
        ),
    { method: "PATCH" },
  );
  return normalizeAnnouncement(payload);
}

export async function getAnnouncementsUnreadCount(schoolCode?: string): Promise<number> {
  const scope = schoolCode || getRequestSchoolScope();
  const [school, platform] = await Promise.all([
    hasCommunicationSchoolScope(scope)
      ? httpRequest<{ count?: number }>(
          withCommunicationSchoolScope("/backoffice/announcements/unread-count", scope),
        )
      : Promise.resolve({ count: 0 }),
    httpRequest<{ count?: number }>("/backoffice/platform-announcements/unread-count"),
  ]);
  return (Number(school?.count) || 0) + (Number(platform?.count) || 0);
}

export async function markCanonicalMessageRead(
  messageId: string,
  schoolCode?: string,
): Promise<CanonicalSchoolMessage | null> {
  const payload = await httpRequest<unknown>(
    scopedMessagesPath(`/backoffice/messages/${encodeURIComponent(messageId)}/read`, schoolCode),
    {
      method: "PATCH",
    },
  );
  return normalizeMessage(payload);
}
