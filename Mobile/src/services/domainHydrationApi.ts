import { unwrapList } from "../lib/dataTruth";
import {
  normalizeAnnouncement,
  normalizeMessage,
  normalizeTeacher,
  normalizeUser,
  type CanonicalAnnouncement,
  type CanonicalSchoolMessage,
  type CanonicalTeacher,
  type CanonicalUserAccount,
} from "../lib/canonicalResourceNormalize";
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
