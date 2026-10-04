/** ADMIN-02B / #872 — résolution unique d'affichage. Ne pas utiliser en RBAC. */

export type RoleDisplayContract = {
  roleKey: string;
  defaultLabel: string;
  displayLabel?: string | null;
  effectiveLabel: string;
};

/** 12 rôles seed ADMIN-02B. Jamais un rôle custom inventé. */
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

const ROLE_KEY_BY_DEFAULT_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(DEFAULT_LABEL_BY_ROLE_KEY).map(([roleKey, label]) => [normalizeIdentity(label), roleKey]),
);

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

/**
 * Identité canonique uniquement (roleKey ou defaultLabel).
 * Ne jamais appeler avec displayLabel / effectiveRoleLabel / roleLabel décoré.
 */
export function canonicalAccessRoleKey(roleOrKey?: string | null): string {
  const raw = String(roleOrKey ?? "").trim();
  if (!raw) return "";
  const asKey = raw.toUpperCase();
  if (DEFAULT_LABEL_BY_ROLE_KEY[asKey]) return asKey;
  return ROLE_KEY_BY_DEFAULT_LABEL[normalizeIdentity(raw)] || "";
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
  defaultLabel?: string | null;
  role?: string | null;
  roleKey?: string | null;
  displayLabel?: string | null;
} | null): string {
  if (!user) return "";
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
    const byKey = new Map(
      user.effectiveRoleLabels.map((row) => [asRoleKey(row.roleKey), row] as const),
    );
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
      const fromRoles = (user.roles ?? []).find((label) => canonicalAccessRoleKey(label) === roleKey);
      return fromRoles || defaultLabelForRoleKey(roleKey) || roleKey;
    });
  }
  const primary = visibleRoleLabel(user);
  if (primary) return [primary];
  return (user.roles ?? []).map((label) => String(label ?? "").trim()).filter(Boolean);
}

export function formatVisibleRoleLabels(user?: Parameters<typeof visibleRoleLabels>[0]): string {
  return visibleRoleLabels(user).join(" · ");
}

export function userHasAccessRoleKey(
  user: { roleKeys?: Array<string | null | undefined> | null; roleKey?: string | null; role?: string | null } | null | undefined,
  roleKey: string,
): boolean {
  const wanted = asRoleKey(roleKey);
  if (!wanted) return false;
  const keys = uniqueRoleKeys([...(user?.roleKeys ?? []), user?.roleKey]);
  if (keys.includes(wanted)) return true;
  return canonicalAccessRoleKey(user?.role) === wanted;
}

export function indexRoleDisplayCatalog(rows: RoleDisplayContract[] = []): Map<string, RoleDisplayContract> {
  const map = new Map<string, RoleDisplayContract>();
  for (const row of rows) {
    const roleKey = asRoleKey(row.roleKey);
    if (!roleKey) continue;
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

/**
 * Création / attribution : roleKey API uniquement.
 * Fail-closed pour un libellé custom sans identité serveur.
 */
export function resolveCreatableRolesFromApi(input: {
  apiRoles?: Array<{ roleKey?: string | null; roleName?: string | null }> | null;
  allowlistLabels?: string[] | null;
  apiAvailable: boolean;
  platformOnly?: boolean;
}): Array<{ roleKey: string; roleName: string }> {
  const allowlist = (input.allowlistLabels ?? []).filter(
    (label) => typeof label === "string" && label.trim() && label !== "Sans affectation",
  );
  const systemFromAllowlist = uniqueRolesByRoleKey(
    allowlist
      .map((label) => {
        const roleKey = canonicalAccessRoleKey(label);
        if (!roleKey || !isCanonicalSystemRoleKey(roleKey)) return null;
        return { roleKey, roleName: defaultLabelForRoleKey(roleKey) || label };
      })
      .filter((row): row is { roleKey: string; roleName: string } => Boolean(row)),
  );
  const fromApi = uniqueRolesByRoleKey(
    (input.apiRoles ?? [])
      .filter(
        (role): role is { roleKey: string; roleName: string } =>
          isServerProvidedRoleKey(role.roleKey) && Boolean(String(role.roleName ?? "").trim()),
      )
      .map((role) => ({
        roleKey: asRoleKey(role.roleKey),
        roleName: String(role.roleName).trim(),
      }))
      .filter((role) => role.roleKey !== "PARENT" && role.roleKey !== "STUDENT"),
  );
  if (input.apiAvailable && fromApi.length) {
    if (input.platformOnly) {
      const allowed = new Set(systemFromAllowlist.map((row) => row.roleKey));
      return fromApi.filter((role) => allowed.has(role.roleKey));
    }
    return fromApi;
  }
  return systemFromAllowlist;
}
