import { normalize } from "./format";
import { sessionRoleToPlatformRole } from "./orgHierarchy";

/**
 * L1 — identité de rôle Mobile.
 * A. roleKey / roleKeys : identité canonique backend (PostgreSQL)
 * B. roleLabel : libellé d’affichage
 * C. permissions : tableau live uniquement (jamais dérivé d’une matrice locale)
 *
 * Le rôle ne crée pas de permissions et ne doit jamais être recalé
 * vers school_admin / prefet / secretary pour ouvrir des fonctionnalités.
 */

export type CanonicalRoleIdentity = {
  roleKey: string;
  roleKeys: string[];
  roleLabel: string;
  sessionRole: string;
  permissions: string[];
};

/** État backend `displayRoles([])` : aucun rôle actif, fail-closed. */
export const UNAFFECTED_ROLE_LABEL = "Sans affectation";
export const UNAFFECTED_SESSION_ROLE = "unassigned";

const ROLE_KEY_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Administrateur Somafrik",
  COUNTRY_ADMIN: "Admin Pays",
  SCHOOL_ADMIN: "Admin School",
  PROVISEUR: "Proviseur",
  PRINCIPAL: "Directeur",
  PREFET_ETUDES: "Préfet des études",
  SECRETARY: "Secrétaire",
  ACCOUNTANT: "Comptable",
  ADJOINT: "Directeur adjoint",
  SUPERVISOR: "Surveillant",
  TEACHER: "Enseignant",
  PARENT: "Parent",
  STUDENT: "Élève / Étudiant",
};

const LABEL_TO_ROLE_KEY: Record<string, string> = {
  "super administrateur somafrik": "SUPER_ADMIN",
  "super administrateur okafrik": "SUPER_ADMIN",
  "super administrateur": "SUPER_ADMIN",
  "admin pays": "COUNTRY_ADMIN",
  "admin school": "SCHOOL_ADMIN",
  "administrateur ecole": "SCHOOL_ADMIN",
  "administrateur etablissement": "SCHOOL_ADMIN",
  "admin etablissement": "SCHOOL_ADMIN",
  proviseur: "PROVISEUR",
  directeur: "PRINCIPAL",
  "directeur adjoint": "ADJOINT",
  adjoint: "ADJOINT",
  "prefet des etudes": "PREFET_ETUDES",
  "prefet des etude": "PREFET_ETUDES",
  prefet: "PREFET_ETUDES",
  secretaire: "SECRETARY",
  comptable: "ACCOUNTANT",
  surveillant: "SUPERVISOR",
  enseignant: "TEACHER",
  parent: "PARENT",
  "eleve / etudiant": "STUDENT",
  eleve: "STUDENT",
  etudiant: "STUDENT",
};

const SESSION_ALIAS_TO_ROLE_KEY: Record<string, string> = {
  super_admin: "SUPER_ADMIN",
  country_admin: "COUNTRY_ADMIN",
  school_admin: "SCHOOL_ADMIN",
  principal: "PRINCIPAL",
  proviseur: "PROVISEUR",
  prefet: "PREFET_ETUDES",
  secretary: "SECRETARY",
  accountant: "ACCOUNTANT",
  adjoint: "ADJOINT",
  supervisor: "SUPERVISOR",
  teacher: "TEACHER",
  parent_student: "PARENT",
  student: "STUDENT",
};

const ROLE_KEY_TO_SESSION_ALIAS: Record<string, string> = {
  SUPER_ADMIN: "super_admin",
  COUNTRY_ADMIN: "country_admin",
  SCHOOL_ADMIN: "school_admin",
  PRINCIPAL: "principal",
  PROVISEUR: "proviseur",
  PREFET_ETUDES: "prefet",
  SECRETARY: "secretary",
  ACCOUNTANT: "accountant",
  ADJOINT: "adjoint",
  SUPERVISOR: "supervisor",
  TEACHER: "teacher",
  PARENT: "parent_student",
  STUDENT: "student",
};

const ROLE_PRIVILEGE_ORDER = [
  "SUPER_ADMIN",
  "COUNTRY_ADMIN",
  "SCHOOL_ADMIN",
  "PROVISEUR",
  "PRINCIPAL",
  "PREFET_ETUDES",
  "ACCOUNTANT",
  "SECRETARY",
  "ADJOINT",
  "SUPERVISOR",
  "TEACHER",
  "PARENT",
  "STUDENT",
];

const CODE_ALIASES: Record<string, string> = {
  DIRECTEUR: "PRINCIPAL",
  PREFET: "PREFET_ETUDES",
  PREFET_DES_ETUDES: "PREFET_ETUDES",
  ENSEIGNANT: "TEACHER",
  SECRETAIRE: "SECRETARY",
  COMPTABLE: "ACCOUNTANT",
  SURVEILLANT: "SUPERVISOR",
  ELEVE: "STUDENT",
  ETUDIANT: "STUDENT",
  ELEVE_ETUDIANT: "STUDENT",
  DIRECTEUR_ADJOINT: "ADJOINT",
};

export function canonicalizeRoleKey(value?: string | null): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const fromLabel = LABEL_TO_ROLE_KEY[normalize(trimmed)];
  if (fromLabel) return fromLabel;
  const fromAlias = SESSION_ALIAS_TO_ROLE_KEY[normalize(trimmed).replace(/\s+/g, "_")];
  if (fromAlias) return fromAlias;
  const upper = trimmed.toUpperCase().replace(/\s+/g, "_");
  if (CODE_ALIASES[upper]) return CODE_ALIASES[upper];
  if (ROLE_KEY_LABELS[upper] || ROLE_KEY_TO_SESSION_ALIAS[upper]) return upper;
  return upper;
}

export function roleLabelFromRoleKey(roleKey?: string | null): string {
  const key = canonicalizeRoleKey(roleKey);
  if (!key) return "";
  return ROLE_KEY_LABELS[key] ?? key;
}

function privilegeRank(roleKey: string) {
  const index = ROLE_PRIVILEGE_ORDER.indexOf(roleKey);
  return index < 0 ? ROLE_PRIVILEGE_ORDER.length + 1 : index;
}

export function sortRoleKeysByPrivilege(roleKeys: string[] = []): string[] {
  return [...new Set(roleKeys.map(canonicalizeRoleKey).filter(Boolean))].sort(
    (left, right) => privilegeRank(left) - privilegeRank(right) || left.localeCompare(right),
  );
}

export function sessionRoleFromRoleKey(roleKey?: string | null, fallback?: string | null): string {
  const key = canonicalizeRoleKey(roleKey);
  if (key && ROLE_KEY_TO_SESSION_ALIAS[key]) return ROLE_KEY_TO_SESSION_ALIAS[key];
  const fallbackValue = String(fallback ?? "").trim();
  return fallbackValue;
}

export function hasAuthoritativeRoleKeys(session: any): boolean {
  return Array.isArray(session?.roleKeys) || Array.isArray(session?.user?.roleKeys);
}

function collectRoleKeys(session: any): string[] {
  if (hasAuthoritativeRoleKeys(session)) {
    const raw: string[] = [];
    if (Array.isArray(session?.user?.roleKeys)) raw.push(...session.user.roleKeys);
    if (Array.isArray(session?.roleKeys)) raw.push(...session.roleKeys);
    return sortRoleKeysByPrivilege(raw);
  }

  const raw: string[] = [];
  if (session?.user?.roleKey) raw.push(session.user.roleKey);
  if (session?.roleKey) raw.push(session.roleKey);
  const fromKeys = sortRoleKeysByPrivilege(raw);
  if (fromKeys.length) return fromKeys;

  const fromUserRole = canonicalizeRoleKey(session?.user?.role);
  if (fromUserRole) return [fromUserRole];
  const fromRoleLabel = canonicalizeRoleKey(session?.roleLabel);
  if (fromRoleLabel) return [fromRoleLabel];
  const fromSessionAlias = canonicalizeRoleKey(session?.role);
  return fromSessionAlias ? [fromSessionAlias] : [];
}

function livePermissions(session: any): string[] | undefined {
  if (Array.isArray(session?.permissions)) return session.permissions;
  if (Array.isArray(session?.user?.permissions)) return session.user.permissions;
  return undefined;
}

export function resolveCanonicalRoleIdentity(session: any): CanonicalRoleIdentity {
  const authoritative = hasAuthoritativeRoleKeys(session);
  const roleKeys = collectRoleKeys(session);
  const permissions = livePermissions(session) ?? [];

  if (authoritative && roleKeys.length === 0) {
    return {
      roleKey: "",
      roleKeys: [],
      roleLabel: UNAFFECTED_ROLE_LABEL,
      sessionRole: UNAFFECTED_SESSION_ROLE,
      permissions,
    };
  }

  const roleKey = roleKeys[0] ?? "";
  const explicitLabel = String(session?.user?.role ?? session?.roleLabel ?? "").trim();
  const roleLabel =
    (explicitLabel && canonicalizeRoleKey(explicitLabel) === roleKey ? explicitLabel : "") ||
    roleLabelFromRoleKey(roleKey) ||
    explicitLabel ||
    sessionRoleToPlatformRole(session?.role) ||
    String(session?.role ?? "").trim() ||
    "Utilisateur";
  const sessionRole = sessionRoleFromRoleKey(roleKey, session?.role);

  return {
    roleKey: roleKey || (authoritative ? "" : String(session?.role ?? "").trim()) || "UNKNOWN",
    roleKeys,
    roleLabel,
    sessionRole: sessionRole || (authoritative ? UNAFFECTED_SESSION_ROLE : String(session?.role ?? "").trim()),
    permissions,
  };
}

export function attachCanonicalRoleIdentity<T>(session: T | null | undefined): T | null {
  if (!session || typeof session !== "object") return session ?? null;
  const current = session as T & {
    role?: string;
    roleLabel?: string;
    roleKey?: string;
    roleKeys?: string[];
    permissions?: string[];
    user?: Record<string, unknown>;
  };
  const identity = resolveCanonicalRoleIdentity(current);
  return {
    ...current,
    role: identity.sessionRole,
    roleLabel: identity.roleLabel,
    roleKey: identity.roleKey,
    roleKeys: identity.roleKeys,
    user: {
      ...(current.user ?? {}),
      role: identity.roleLabel,
      roleKey: identity.roleKey,
      roleKeys: identity.roleKeys,
    },
  };
}

export function isUnknownCanonicalRole(roleKey?: string | null): boolean {
  const key = canonicalizeRoleKey(roleKey);
  if (!key) return true;
  return !ROLE_KEY_LABELS[key];
}
