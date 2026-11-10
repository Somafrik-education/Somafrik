/** ADMIN-02B / #872 — résolution unique d'affichage. Ne pas utiliser en RBAC. */

export type RoleDisplayContract = {
  roleKey: string;
  defaultLabel: string;
  displayLabel?: string | null;
  effectiveLabel: string;
};

/** 12 rôles seed ADMIN-02B. ADJOINT n'en fait pas partie. */
export const CANONICAL_SYSTEM_ROLE_KEYS = [
  "SUPER_ADMIN",
  "COUNTRY_ADMIN",
  "SCHOOL_ADMIN",
  "PROVISEUR",
  "PREFET_ETUDES",
  "PRINCIPAL",
  "SECRETARY",
  "TEACHER",
  "PARENT",
  "STUDENT",
  "ACCOUNTANT",
  "SUPERVISOR",
] as const;

const DEFAULT_LABEL_BY_ROLE_KEY: Record<string, string> = {
  SUPER_ADMIN: "Super Administrateur Somafrik",
  COUNTRY_ADMIN: "Admin Pays",
  SCHOOL_ADMIN: "Admin School",
  TEACHER: "Enseignant",
  STUDENT: "Élève / Étudiant",
  PARENT: "Parent",
  PRINCIPAL: "Directeur",
  PREFET_ETUDES: "Préfet des études",
  ACCOUNTANT: "Comptable",
  SECRETARY: "Secrétaire",
  SUPERVISOR: "Surveillant",
  PROVISEUR: "Proviseur",
};

function normalizeIdentity(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function asRoleKey(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function isCanonicalSystemRoleKey(roleKey?: string | null): boolean {
  return (CANONICAL_SYSTEM_ROLE_KEYS as readonly string[]).includes(asRoleKey(roleKey));
}

/** roleKey serveur (RESP_PED). Rejette un libellé (Directeur, Coordinateur pédagogique). */
export function isServerProvidedRoleKey(roleKey?: string | null): boolean {
  const raw = String(roleKey ?? "").trim();
  return /^[A-Z][A-Z0-9_]*$/.test(raw);
}

export function defaultLabelForRoleKey(roleKey?: string | null): string {
  const key = asRoleKey(roleKey);
  return DEFAULT_LABEL_BY_ROLE_KEY[key] || "";
}

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

function isEmptyAccessLabel(value?: string | null): boolean {
  const status = String(value ?? "").trim().toLowerCase();
  return !status || status === "sans affectation";
}

export function visibleRoleLabel(user?: {
  effectiveRoleLabel?: string | null;
  effectiveRoleLabels?: RoleDisplayContract[] | null;
  defaultLabel?: string | null;
  role?: string | null;
  roleKey?: string | null;
  displayLabel?: string | null;
} | null): string {
  if (!user) return "";
  const roleKey = asRoleKey(user.roleKey);
  const contracts = Array.isArray(user.effectiveRoleLabels) ? user.effectiveRoleLabels : [];
  if (roleKey && contracts.length) {
    const matched = contracts.find((row) => asRoleKey(row.roleKey) === roleKey);
    if (matched) {
      return matched.effectiveLabel || matched.defaultLabel || "";
    }
  }
  const fallback = [user.defaultLabel, user.role, defaultLabelForRoleKey(user.roleKey)].find(
    (value) => !isEmptyAccessLabel(value),
  );
  return resolveEffectiveRoleLabel({
    defaultLabel: fallback,
    displayLabel: user.effectiveRoleLabel || user.displayLabel,
  });
}

function uniqueRoleKeys(roleKeys?: Array<string | null | undefined> | null): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of roleKeys ?? []) {
    const key = asRoleKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  return ordered;
}

export function visibleRoleLabels(user?: {
  role?: string | null;
  roles?: string[] | null;
  roleKey?: string | null;
  roleKeys?: Array<string | null | undefined> | null;
  effectiveRoleLabel?: string | null;
  effectiveRoleLabels?: RoleDisplayContract[] | null;
  defaultLabel?: string | null;
  displayLabel?: string | null;
} | null): string[] {
  if (!user) return [];
  const orderedKeys = uniqueRoleKeys(
    Array.isArray(user.roleKeys) && user.roleKeys.length ? user.roleKeys : [user.roleKey],
  );
  if (Array.isArray(user.effectiveRoleLabels) && user.effectiveRoleLabels.length) {
    const byKey = new Map(user.effectiveRoleLabels.map((row) => [asRoleKey(row.roleKey), row] as const));
    if (orderedKeys.length) {
      return orderedKeys.map((roleKey) => {
        const contract = byKey.get(roleKey);
        return (
          contract?.effectiveLabel ||
          (roleKey === asRoleKey(user.roleKey) ? visibleRoleLabel(user) : "") ||
          contract?.defaultLabel ||
          defaultLabelForRoleKey(roleKey) ||
          roleKey
        );
      });
    }
    return user.effectiveRoleLabels.map((row) => row.effectiveLabel).filter(Boolean);
  }
  if (orderedKeys.length) {
    const primaryKey = asRoleKey(user.roleKey) || orderedKeys[0];
    return orderedKeys.map((roleKey) => {
      if (roleKey === primaryKey) {
        const primary = visibleRoleLabel({ ...user, roleKey });
        if (primary) return primary;
      }
      return defaultLabelForRoleKey(roleKey) || roleKey;
    });
  }
  const primary = visibleRoleLabel(user);
  if (primary) return [primary];
  return (user.roles ?? []).map((label) => String(label ?? "").trim()).filter(Boolean);
}

export function formatVisibleRoleLabels(user?: Parameters<typeof visibleRoleLabels>[0]): string {
  return visibleRoleLabels(user).join(" · ");
}

export function indexRoleDisplayCatalog(rows: RoleDisplayContract[] = []): Map<string, RoleDisplayContract> {
  const map = new Map<string, RoleDisplayContract>();
  for (const row of rows) {
    const roleKey = asRoleKey(row.roleKey);
    if (!isServerProvidedRoleKey(row.roleKey)) continue;
    map.set(roleKey, {
      roleKey,
      defaultLabel: String(row.defaultLabel ?? "").trim(),
      displayLabel: row.displayLabel ?? null,
      effectiveLabel: String(row.effectiveLabel ?? "").trim(),
    });
  }
  return map;
}

export function uniqueRolesByRoleKey<T extends { roleKey?: string | null }>(roles: T[]): T[] {
  const seen = new Set<string>();
  return roles.filter((role) => {
    const key = asRoleKey(role.roleKey);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type DecoratedAssignableRole = {
  roleKey: string;
  roleName: string;
  defaultLabel: string;
  effectiveLabel: string;
  optionLabel: string;
};

export function decorateAssignableRoles(
  roles: Array<{ roleKey: string; roleName: string }>,
  catalog: Map<string, RoleDisplayContract> = new Map(),
): DecoratedAssignableRole[] {
  const decorated = uniqueRolesByRoleKey(roles).map((role) => {
    const roleKey = asRoleKey(role.roleKey);
    const contract = catalog.get(roleKey);
    const defaultLabel = contract?.defaultLabel || role.roleName || defaultLabelForRoleKey(roleKey);
    const effectiveLabel = contract?.effectiveLabel || defaultLabel;
    return {
      roleKey,
      roleName: role.roleName,
      defaultLabel,
      effectiveLabel,
      optionLabel: effectiveLabel,
    };
  });
  const counts = new Map<string, number>();
  for (const row of decorated) {
    counts.set(row.effectiveLabel, (counts.get(row.effectiveLabel) ?? 0) + 1);
  }
  return decorated.map((row) => ({
    ...row,
    optionLabel: (counts.get(row.effectiveLabel) ?? 0) > 1 ? `${row.effectiveLabel} — ${row.defaultLabel}` : row.effectiveLabel,
  }));
}

export function grantIdentityForRoleKey(roleKey?: string | null): string {
  if (!isServerProvidedRoleKey(roleKey)) return "";
  return asRoleKey(roleKey);
}

export function parseRoleDisplayContracts(value: unknown): RoleDisplayContract[] {
  if (!Array.isArray(value)) return [];
  const rows: RoleDisplayContract[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const roleKey = String(row.roleKey ?? "").trim();
    if (!isServerProvidedRoleKey(roleKey)) continue;
    const effectiveLabel = String(row.effectiveLabel ?? "").trim();
    const defaultLabel = String(row.defaultLabel ?? "").trim();
    if (!effectiveLabel && !defaultLabel) continue;
    rows.push({
      roleKey: asRoleKey(roleKey),
      defaultLabel,
      displayLabel: row.displayLabel == null ? null : String(row.displayLabel),
      effectiveLabel: effectiveLabel || defaultLabel,
    });
  }
  return rows;
}

export function normalizeIdentityLabel(value: unknown): string {
  return normalizeIdentity(value);
}
