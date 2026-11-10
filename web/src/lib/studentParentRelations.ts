/** Contrat de lecture des relations parent-élève PostgreSQL, partagé par l'écran Web. */
export interface LinkedParent {
  id: string;
  name: string;
  phone: string;
  email: string;
  isPrincipal: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Aucun fallback parentPhone : sans relation active réelle, la liste est vide. */
export function activeLinkedParents(value: unknown): LinkedParent[] {
  if (!Array.isArray(value)) return [];
  const result: LinkedParent[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const row = record(entry);
    if (!row) continue;
    const id = string(row.id);
    const status = string(row.status).toLowerCase();
    if (!id || seen.has(id) || (status !== "actif" && status !== "active")) continue;
    seen.add(id);
    const fullName = [string(row.firstName), string(row.lastName)].filter(Boolean).join(" ");
    result.push({
      id,
      name: string(row.name) || fullName || string(row.fromContactName) || "Parent",
      phone: string(row.phone),
      email: string(row.email),
      isPrincipal: row.isPrincipal === true || string(row.isPrincipal).toLowerCase() === "oui",
    });
  }
  return result.sort((a, b) => Number(b.isPrincipal) - Number(a.isPrincipal)
    || a.name.localeCompare(b.name, "fr"));
}

export type ParentLinkResponse = {
  created?: boolean;
  createdUser?: boolean;
  reusedUser?: boolean;
  temporaryPassword?: string;
  user?: {
    identifier?: string;
    userCode?: string;
    loginCode?: string;
  } | null;
};
