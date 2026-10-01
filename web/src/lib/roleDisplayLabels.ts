/** ADMIN-02B — résolution unique d'affichage. Ne pas utiliser en RBAC. */

export function normalizeDisplayLabel(value?: string | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

export function resolveEffectiveRoleLabel(input: {
  defaultLabel?: string | null;
  displayLabel?: string | null;
  roleName?: string | null;
}): string {
  const fallback = String(input.defaultLabel ?? input.roleName ?? "").trim();
  return normalizeDisplayLabel(input.displayLabel) || fallback;
}

export function visibleRoleLabel(user?: {
  effectiveRoleLabel?: string | null;
  defaultLabel?: string | null;
  role?: string | null;
  displayLabel?: string | null;
} | null): string {
  if (!user) return "";
  return resolveEffectiveRoleLabel({
    defaultLabel: user.defaultLabel || user.role,
    displayLabel: user.effectiveRoleLabel || user.displayLabel,
  });
}
