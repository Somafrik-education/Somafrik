/**
 * Affectation multi-rôles Mobile — identité = roleKey, affichage = effectiveLabel.
 */
import {
  areStudentRolesLocked,
  canAssignRoleToUserAccount,
  isStudentLinkedAccount,
  isTeacherRoleLabel,
  STUDENT_ROLE_LOCKED_MESSAGE,
  STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE,
  type BusinessProfileUser,
} from "./businessProfile";
import { normalize } from "./format";
import {
  decorateAssignableRoles,
  grantIdentityForRoleKey,
  indexRoleDisplayCatalog,
  isServerProvidedRoleKey,
  type DecoratedAssignableRole,
  type RoleDisplayContract,
} from "./roleDisplayLabels";

export type EstablishmentRoleCatalogueEntry = {
  id?: string;
  roleCode?: string;
  roleKey?: string;
  roleName?: string;
  permissions?: string[];
};

export type AssignableRoleChoice = DecoratedAssignableRole;

export type RoleBearingUser = BusinessProfileUser & {
  roles?: string[];
  activeRoles?: string[];
  roleKey?: string;
};

const UNAFFECTED_LABEL = "sans affectation";

const FORBIDDEN_ASSIGN_ROLE_KEYS = new Set(["PARENT", "STUDENT", "ELEVE", "ETUDIANT", "ELEVE_ETUDIANT"]);

export class RoleAssignmentRejected extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "RoleAssignmentRejected";
    this.status = status;
  }
}

export type SingleFlightResult<T> = { status: "skipped" } | { status: "done"; value: T };

export function createSingleFlight() {
  let pending = false;
  return {
    async run<T>(task: () => Promise<T>): Promise<SingleFlightResult<T>> {
      if (pending) return { status: "skipped" };
      pending = true;
      try {
        const value = await task();
        return { status: "done", value };
      } finally {
        pending = false;
      }
    },
  };
}

export function isAdministrableRoleLabel(role: string): boolean {
  return role !== "Parent" && role !== "Élève / Étudiant";
}

function isForbiddenAssignableIdentity(roleKey: string, roleName: string): boolean {
  if (!isAdministrableRoleLabel(roleName)) return true;
  const name = normalize(roleName);
  if (name === "parent" || name === "eleve / etudiant" || name === "eleve" || name === "etudiant") return true;
  return FORBIDDEN_ASSIGN_ROLE_KEYS.has(roleKey);
}

export function isCanonicalAssignableRole(
  role: EstablishmentRoleCatalogueEntry,
): role is EstablishmentRoleCatalogueEntry & { roleName: string; roleKey: string } {
  const roleName = String(role.roleName ?? "").trim();
  const roleKey = grantIdentityForRoleKey(role.roleKey ?? role.roleCode);
  return Boolean(roleKey && roleName && normalize(roleName) !== UNAFFECTED_LABEL);
}

export function visibleAssignableRoles(
  catalog: EstablishmentRoleCatalogueEntry[],
  displayCatalog: Map<string, RoleDisplayContract> = new Map(),
): AssignableRoleChoice[] {
  const raw: Array<{ roleKey: string; roleName: string }> = [];
  for (const entry of catalog) {
    if (!isCanonicalAssignableRole(entry)) continue;
    const roleName = String(entry.roleName).trim();
    const roleKey = grantIdentityForRoleKey(entry.roleKey ?? entry.roleCode);
    if (!roleKey || isForbiddenAssignableIdentity(roleKey, roleName)) continue;
    raw.push({ roleKey, roleName });
  }
  return decorateAssignableRoles(raw, displayCatalog);
}

function cleanRoleLabel(value: unknown): string {
  const label = String(value ?? "").trim();
  if (!label || normalize(label) === UNAFFECTED_LABEL) return "";
  return label;
}

/** Autorité des mutations : roleKeys / roleKey. Fallback legacy sur un rôle système uniquement. */
export function currentAccessRoleKeys(user: RoleBearingUser): string[] {
  const fromKeys = (user.roleKeys ?? [])
    .map((key) => grantIdentityForRoleKey(key))
    .filter(Boolean);
  if (fromKeys.length) return [...new Set(fromKeys)];
  const primary = grantIdentityForRoleKey(user.roleKey);
  if (primary) return [primary];
  return [];
}

/** @deprecated identité = currentAccessRoleKeys. Conservé pour lecture historique. */
export function currentAccessRoleLabels(user: RoleBearingUser): string[] {
  const keys = currentAccessRoleKeys(user);
  if (keys.length) return keys;
  const fromRoles = (user.roles ?? []).map(cleanRoleLabel).filter(Boolean);
  if (fromRoles.length) return fromRoles;
  const fromActive = (user.activeRoles ?? []).map(cleanRoleLabel).filter(Boolean);
  if (fromActive.length) return fromActive;
  const single = cleanRoleLabel(user.role);
  return single ? [single] : [];
}

/**
 * Aligne les rôles actifs sur le catalogue par roleKey.
 * Un rôle actif absent du catalogue est conservé (fail-closed, pas de révocation silencieuse).
 */
export type AssignableRolesLoadState = {
  catalogReady: boolean;
  roleChoices: AssignableRoleChoice[];
  selectedRoles: string[];
  baselineRoles: string[];
  error: string;
};

export function failClosedAssignableRolesLoad(error?: unknown): AssignableRolesLoadState {
  return {
    catalogReady: false,
    roleChoices: [],
    selectedRoles: [],
    baselineRoles: [],
    error:
      error instanceof Error && error.message.trim()
        ? error.message
        : "Impossible de charger les rôles.",
  };
}

export function canCommitAssignableRoles(state: {
  catalogReady?: boolean;
  rolesLoading?: boolean;
  rolesSaving?: boolean;
}): boolean {
  return Boolean(state.catalogReady) && !state.rolesLoading && !state.rolesSaving;
}

export async function loadAssignableRolesForMutation(input: {
  currentRoleKeys: string[];
  loadAssignable: () => Promise<{ roles?: EstablishmentRoleCatalogueEntry[] } | null | undefined>;
  loadDisplay?: () => Promise<{ items?: RoleDisplayContract[] } | null | undefined>;
}): Promise<AssignableRolesLoadState> {
  try {
    const [payload, display] = await Promise.all([
      input.loadAssignable(),
      (input.loadDisplay ?? (async () => ({ items: [] })))().catch(() => ({ items: [] })),
    ]);
    const catalog = indexRoleDisplayCatalog(Array.isArray(display?.items) ? display.items : []);
    const roles = Array.isArray(payload?.roles) ? payload.roles : [];
    const choices = visibleAssignableRoles(roles, catalog);
    const aligned = alignRolesToCatalogue(input.currentRoleKeys, choices);
    return {
      catalogReady: true,
      roleChoices: choices,
      selectedRoles: aligned,
      baselineRoles: aligned,
      error: "",
    };
  } catch (error) {
    return failClosedAssignableRolesLoad(error);
  }
}

export function alignRolesToCatalogue(currentKeys: string[], catalog: AssignableRoleChoice[]): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  const byKey = new Map(catalog.map((choice) => [choice.roleKey, choice.roleKey]));
  for (const raw of currentKeys) {
    const identity = grantIdentityForRoleKey(raw) || (isServerProvidedRoleKey(raw) ? raw : "");
    const next = identity ? byKey.get(identity) ?? identity : "";
    if (!next || seen.has(next)) continue;
    seen.add(next);
    selected.push(next);
  }
  return selected;
}

export function diffRoleAssignment(currentRoles: string[], selectedRoles: string[]) {
  const current = new Set(currentRoles);
  const next = new Set(selectedRoles);
  return {
    toGrant: [...next].filter((role) => !current.has(role)),
    toRevoke: [...current].filter((role) => !next.has(role)),
    unchanged: [...next].filter((role) => current.has(role)),
  };
}

function rejectionMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Échec serveur.";
}

function rejectionStatus(error: unknown): number | undefined {
  if (error instanceof RoleAssignmentRejected) return error.status;
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status?: number }).status);
    if (Number.isFinite(status)) return status;
  }
  return undefined;
}

export async function applyUserRoleAssignment(input: {
  user: RoleBearingUser;
  userId: string;
  currentRoles: string[];
  selectedRoles: string[];
  grant: (userId: string, role: string) => Promise<unknown>;
  revoke: (userId: string, role: string) => Promise<unknown>;
  onGranted?: (role: string) => void;
  onRevoked?: (role: string) => void;
}): Promise<{ toGrant: string[]; toRevoke: string[]; unchanged: string[] }> {
  const currentRoles = input.currentRoles.map((role) => grantIdentityForRoleKey(role) || role);
  const selectedRoles = input.selectedRoles.map((role) => grantIdentityForRoleKey(role) || role);
  const diff = diffRoleAssignment(currentRoles, selectedRoles);
  if (isStudentLinkedAccount(input.user) || areStudentRolesLocked(input.user)) {
    const teacherGrant = diff.toGrant.some((role) => isTeacherRoleLabel(role) || role === "TEACHER");
    throw new RoleAssignmentRejected(
      teacherGrant ? STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE : STUDENT_ROLE_LOCKED_MESSAGE,
      409,
    );
  }

  for (const role of diff.toGrant) {
    const identity = grantIdentityForRoleKey(role);
    if (!identity) continue;
    if (!canAssignRoleToUserAccount(input.user, identity)) {
      throw new RoleAssignmentRejected(
        isTeacherRoleLabel(identity) || identity === "TEACHER"
          ? STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE
          : STUDENT_ROLE_LOCKED_MESSAGE,
        409,
      );
    }
    try {
      await input.grant(input.userId, identity);
    } catch (error) {
      throw new RoleAssignmentRejected(rejectionMessage(error), rejectionStatus(error));
    }
    input.onGranted?.(identity);
  }

  for (const role of diff.toRevoke) {
    const identity = grantIdentityForRoleKey(role);
    if (!identity) continue;
    if (isStudentLinkedAccount(input.user) || areStudentRolesLocked(input.user)) {
      throw new RoleAssignmentRejected(STUDENT_ROLE_LOCKED_MESSAGE, 409);
    }
    try {
      await input.revoke(input.userId, identity);
    } catch (error) {
      throw new RoleAssignmentRejected(rejectionMessage(error), rejectionStatus(error));
    }
    input.onRevoked?.(identity);
  }

  return {
    toGrant: diff.toGrant.map((role) => grantIdentityForRoleKey(role) || role).filter(Boolean),
    toRevoke: diff.toRevoke.map((role) => grantIdentityForRoleKey(role) || role).filter(Boolean),
    unchanged: diff.unchanged.map((role) => grantIdentityForRoleKey(role) || role).filter(Boolean),
  };
}

export async function commitUserRoleChanges(input: {
  user: RoleBearingUser;
  userId: string;
  currentRoles: string[];
  selectedRoles: string[];
  grant: (userId: string, role: string) => Promise<unknown>;
  revoke: (userId: string, role: string) => Promise<unknown>;
  reload: () => unknown;
  onGranted?: (role: string) => void;
  onRevoked?: (role: string) => void;
}): Promise<{ toGrant: string[]; toRevoke: string[]; unchanged: string[] }> {
  const diff = await applyUserRoleAssignment(input);
  await input.reload();
  return diff;
}

export async function saveUserRoleChanges(
  input: Parameters<typeof commitUserRoleChanges>[0] & {
    reloadAfterFailure?: () => unknown;
  },
): Promise<{ ok: true; toGrant: string[]; toRevoke: string[]; unchanged: string[] } | { ok: false; message: string; status?: number }> {
  try {
    const diff = await commitUserRoleChanges(input);
    return { ok: true, ...diff };
  } catch (error) {
    const message = rejectionMessage(error);
    const status = rejectionStatus(error);
    if (input.reloadAfterFailure) {
      try {
        await input.reloadAfterFailure();
      } catch {
        /* Le refus API reste la vérité affichée. */
      }
    }
    return { ok: false, message, status };
  }
}
