import type { CanonicalAnnouncement } from "./canonicalResourceNormalize";

export function mergeFocusedAnnouncement<T extends { id: string }>(
  list: T[],
  focused: T | null,
): T[] {
  if (!focused?.id) return list;
  if (list.some((row) => row.id === focused.id)) {
    return list.map((row) => (row.id === focused.id ? focused : row));
  }
  return [focused, ...list];
}

export async function resolveFocusedAnnouncement<T extends { id: string }>(options: {
  announcementId: string;
  list: T[];
  fetchById: (id: string) => Promise<T | null>;
}): Promise<T | null> {
  const announcementId = String(options.announcementId ?? "").trim();
  if (!announcementId) return null;
  const known = options.list.find((row) => row.id === announcementId);
  if (known) return known;
  return options.fetchById(announcementId);
}

export type { CanonicalAnnouncement };
