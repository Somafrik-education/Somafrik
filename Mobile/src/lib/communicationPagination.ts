/**
 * Lot C — pagination Communication Mobile (Messages + Annonces).
 * Curseur serveur, déduplication, scope établissement conservé.
 */

export function readNextCursor(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as { nextCursor?: unknown }).nextCursor;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

export function withListCursor(path: string, cursor?: string | null): string {
  const value = String(cursor ?? "").trim();
  if (!value) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}cursor=${encodeURIComponent(value)}`;
}

export function mergeRowsById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const known = new Set(current.map((row) => row.id));
  return [...current, ...incoming.filter((row) => !known.has(row.id))];
}

export function announcementRowKey(row: { id: string; source?: string }): string {
  return `${row.source ?? "row"}-${row.id}`;
}

export function mergeAnnouncementsByKey<T extends { id: string; source?: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const known = new Set(current.map(announcementRowKey));
  return [...current, ...incoming.filter((row) => !known.has(announcementRowKey(row)))];
}

export function sortAnnouncementsByPublishedAt<T extends {
  publishedAt?: string;
  createdAt?: string;
  date?: string;
}>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const a = Date.parse(String(left.publishedAt || left.createdAt || left.date || "")) || 0;
    const b = Date.parse(String(right.publishedAt || right.createdAt || right.date || "")) || 0;
    return b - a;
  });
}
