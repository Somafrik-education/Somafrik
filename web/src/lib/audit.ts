import type { BackOfficeState, SessionUser } from "../types";

/** Entrée du journal d'audit (SEC-004). */
export interface AuditEntry {
  id: string;
  at: string;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityLabel?: string;
  schoolCode?: string;
  details?: string;
}

const MAX_AUDIT = 200;

/** Décrit l'auteur d'une action à partir de l'utilisateur courant. */
export function auditActor(user: SessionUser | null): Pick<AuditEntry, "actorId" | "actorName" | "actorRole"> {
  if (!user) return {};
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return {
    actorId: user.id ?? user.identifier,
    actorName: name || user.identifier || undefined,
    actorRole: user.role,
  };
}

export function makeAuditEntry(input: Omit<AuditEntry, "id" | "at">): AuditEntry {
  return {
    id: `AUDIT-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 7)
      .toUpperCase()}`,
    at: new Date().toISOString(),
    ...input,
  };
}

/** Ajoute des entrées en tête du journal existant en le plafonnant. */
export function appendAuditLog(
  existing: BackOfficeState["auditLog"],
  ...entries: AuditEntry[]
): AuditEntry[] {
  const prior = Array.isArray(existing) ? (existing as AuditEntry[]) : [];
  return [...entries, ...prior].slice(0, MAX_AUDIT);
}
