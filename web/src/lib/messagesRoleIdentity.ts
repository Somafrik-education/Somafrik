/** Identité Messages : roleKey / kind uniquement. Jamais un libellé display. */

function asRoleKey(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function asKind(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isTeacherMessagingSession(user?: {
  roleKey?: string | null;
  roleKeys?: Array<string | null | undefined> | null;
} | null): boolean {
  if (asRoleKey(user?.roleKey) === "TEACHER") return true;
  return (user?.roleKeys ?? []).some((key) => asRoleKey(key) === "TEACHER");
}

export function isStudentMessageTarget(value?: {
  kind?: string | null;
  roleKey?: string | null;
  roleLabel?: string | null;
} | null): boolean {
  if (!value) return false;
  if (asKind(value.kind) === "student") return true;
  return asRoleKey(value.roleKey) === "STUDENT";
}

export function hasStudentParticipant(
  participants?: Array<{ kind?: string | null; roleKey?: string | null; roleLabel?: string | null }> | null,
): boolean {
  return (participants ?? []).some((participant) => isStudentMessageTarget(participant));
}

export function formatMessageRoleLabel(value?: { roleLabel?: string | null } | null): string {
  return String(value?.roleLabel ?? "").trim();
}
