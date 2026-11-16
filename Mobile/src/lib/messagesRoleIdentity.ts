function normalizeMessagingRole(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

/** Détection métier Messages : roleKey / kind uniquement. Jamais roleLabel. */
export function isStudentMessageTarget(value?: {
  kind?: string;
  roleKey?: string;
  roleLabel?: string;
}): boolean {
  const kind = normalizeMessagingRole(value?.kind);
  const roleKey = normalizeMessagingRole(value?.roleKey);
  return kind === "STUDENT" || roleKey === "STUDENT";
}

export function isTeacherMessagingSession(value?: {
  roleKeys?: Array<string | null | undefined> | null;
  roleKey?: string | null;
}): boolean {
  const keys = [...(value?.roleKeys ?? []), value?.roleKey].map((key) => normalizeMessagingRole(key));
  return keys.includes("TEACHER");
}

export function formatMessageRoleLabel(value?: { roleLabel?: string | null } | null): string {
  return String(value?.roleLabel ?? "").trim();
}
