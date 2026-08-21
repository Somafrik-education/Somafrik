import { unwrapList } from "../lib/dataTruth";
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

export async function getCanonicalAnnouncements(): Promise<CanonicalAnnouncement[]> {
  const payload = await httpRequest<unknown>("/backoffice/announcements");
  return unwrapList(payload)
    .map(normalizeAnnouncement)
    .filter((row): row is CanonicalAnnouncement => Boolean(row));
}

export async function getCanonicalMessages(): Promise<CanonicalSchoolMessage[]> {
  const payload = await httpRequest<unknown>("/backoffice/messages");
  return unwrapList(payload)
    .map(normalizeMessage)
    .filter((row): row is CanonicalSchoolMessage => Boolean(row));
}

function asTrimmedField(value: unknown): string {
  return String(value ?? "").trim();
}

export async function getCanonicalContacts(): Promise<CanonicalMessageContact[]> {
  const payload = await httpRequest<unknown>("/backoffice/contacts");
  return unwrapList(payload)
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const id = asTrimmedField(item.id);
      if (!id) return null;
      return {
        id,
        userId: asTrimmedField(item.userId) || undefined,
        schoolCode: asTrimmedField(item.schoolCode) || undefined,
        status: asTrimmedField(item.status) || undefined,
        firstName: asTrimmedField(item.firstName) || undefined,
        lastName: asTrimmedField(item.lastName) || undefined,
      } satisfies CanonicalMessageContact;
    })
    .filter((row): row is CanonicalMessageContact => Boolean(row));
}

export async function getCanonicalRelations(): Promise<CanonicalMessageRelation[]> {
  const payload = await httpRequest<unknown>("/backoffice/relations");
  return unwrapList(payload)
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const id = asTrimmedField(item.id);
      const fromContactId = asTrimmedField(item.fromContactId);
      const toStudentId = asTrimmedField(item.toStudentId);
      if (!id || !fromContactId || !toStudentId) return null;
      return {
        id,
        fromContactId,
        toStudentId,
        toStudentName: asTrimmedField(item.toStudentName) || undefined,
        fromContactName: asTrimmedField(item.fromContactName) || undefined,
        schoolCode: asTrimmedField(item.schoolCode) || undefined,
        status: asTrimmedField(item.status) || undefined,
      } satisfies CanonicalMessageRelation;
    })
    .filter((row): row is CanonicalMessageRelation => Boolean(row));
}

export async function getCanonicalSchools(): Promise<SchoolProfile[]> {
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

export async function archiveCanonicalAnnouncement(announcementId: string): Promise<CanonicalAnnouncement | null> {
  const payload = await httpRequest<unknown>(
    `/backoffice/announcements/${encodeURIComponent(announcementId)}/archive`,
    { method: "POST" },
  );
  return normalizeAnnouncement(payload);
}

export async function markCanonicalMessageRead(messageId: string): Promise<CanonicalSchoolMessage | null> {
  const payload = await httpRequest<unknown>(`/backoffice/messages/${encodeURIComponent(messageId)}/read`, {
    method: "PATCH",
  });
  return normalizeMessage(payload);
}
