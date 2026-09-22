import { normalize } from "./format";

const C18_MUTATION_TOKENS = ["Élèves:UPDATE", "Gérer élèves", "ALL_PRIVILEGES"];

const PARENT_STUDENT_ROLES = new Set(["parent_student", "parent", "eleve / etudiant", "student", "eleve"]);

export const C18_VALIDATE_SOURCE = ["PRE_REGISTERED", "PENDING_REVIEW", "INCOMPLETE"] as const;
export const C18_ASSIGN_SOURCE = ["APPROVED", "ENROLLED"] as const;
export const C18_TRANSFER_SOURCE = ["ENROLLED"] as const;
export const C18_CLOSE_SOURCE = ["ENROLLED", "APPROVED"] as const;

type SessionLike = {
  role?: string | null;
  permissions?: unknown[];
  user?: { permissions?: unknown[]; role?: string | null };
} | null;

function sessionTokens(session: SessionLike) {
  const raw = [
    ...((session?.permissions as unknown[]) ?? []),
    ...((session?.user?.permissions as unknown[]) ?? []),
  ];
  return raw.map((item) => normalize(String(item ?? "")));
}

function sessionRole(session: SessionLike) {
  return normalize(session?.role ?? session?.user?.role ?? "");
}

/** Parent / élève : aucune mutation C18 côté UI. */
export function canMutateC18Mobile(session: SessionLike): boolean {
  if (!session) return false;
  if (PARENT_STUDENT_ROLES.has(sessionRole(session))) return false;
  const tokens = sessionTokens(session);
  return C18_MUTATION_TOKENS.some((token) => tokens.includes(normalize(token)));
}

function statusKey(status: string | null | undefined) {
  return String(status ?? "").trim().toUpperCase();
}

export type C18MobileAction = "validate" | "assign-class" | "transfer" | "close";

/**
 * Affichage uniquement. Le backend reste l'autorité de transition :
 * aucun nextStatus, aucune persistance locale.
 */
export function isC18ActionAvailable(action: C18MobileAction, status: string | null | undefined): boolean {
  const key = statusKey(status);
  if (action === "validate") return (C18_VALIDATE_SOURCE as readonly string[]).includes(key);
  if (action === "assign-class") return (C18_ASSIGN_SOURCE as readonly string[]).includes(key);
  if (action === "transfer") return (C18_TRANSFER_SOURCE as readonly string[]).includes(key);
  if (action === "close") return (C18_CLOSE_SOURCE as readonly string[]).includes(key);
  return false;
}
