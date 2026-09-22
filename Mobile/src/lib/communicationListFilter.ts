export type CommunicationSearchable = {
  title?: string;
  excerpt?: string;
  author?: string;
  audience?: string;
  unread?: boolean;
  unreadCount?: number;
};

export function matchesCommunicationQuery(row: CommunicationSearchable, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [row.title, row.excerpt, row.author, row.audience].some((value) =>
    String(value ?? "").toLowerCase().includes(needle),
  );
}

export function isCommunicationUnread(row: CommunicationSearchable): boolean {
  if (typeof row.unreadCount === "number") return row.unreadCount > 0;
  return Boolean(row.unread);
}

export function filterCommunicationRows<T extends CommunicationSearchable>(
  rows: T[],
  query: string,
  unreadOnly: boolean,
): T[] {
  return rows.filter(
    (row) => matchesCommunicationQuery(row, query) && (!unreadOnly || isCommunicationUnread(row)),
  );
}

export function excerptCommunication(text: string, max = 90): string {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
