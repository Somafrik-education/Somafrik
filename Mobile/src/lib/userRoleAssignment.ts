/**
 * Affectation multi-rôles Mobile — parité fonctionnelle avec web/src/pages/UsersPage.tsx.
 *
 * Le catalogue affichable vient exclusivement de GET /establishment-roles/assignable.
 * Aucune liste locale de rôles administrables n'est définie ici.
 * Parent et Élève / Étudiant sont exclus comme sur le Web (libellé + clés d'affectation interdites).
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

export type EstablishmentRoleCatalogueEntry = {
  id?: string;
  roleCode?: string;
  roleKey?: string;
  roleName?: string;
  permissions?: string[];
};

export type AssignableRoleChoice = {
  roleKey: string;
  roleName: string;
};

export type RoleBearingUser = BusinessProfileUser & {
  roles?: string[];
  activeRoles?: string[];
};

const UNAFFECTED_LABEL = "sans affectation";

/** Clés que le backend refuse déjà via isForbiddenAssignRoleKey (PARENT / STUDENT). */
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

/** Empêche un second tap d'Enregistrer de relancer la mutation tant que la première est en cours. */
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

/** Parité Web UsersPage.isAdministrableRoleLabel. */
export function isAdministrableRoleLabel(role: string): boolean {
  return role !== "Parent" && role !== "Élève / Étudiant";
}

function roleKeyToken(value: string): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\s/.-]+/g, "_");
}

function isForbiddenAssignableIdentity(roleKey: string, roleName: string): boolean {
  if (!isAdministrableRoleLabel(roleName)) return true;
  const name = normalize(roleName);
  if (name === "parent" || name === "eleve / etudiant" || name === "eleve" || name === "etudiant") return true;
  const key = roleKeyToken(roleKey);
  const nameKey = roleKeyToken(roleName);
  return FORBIDDEN_ASSIGN_ROLE_KEYS.has(key) || FORBIDDEN_ASSIGN_ROLE_KEYS.has(nameKey);
}

export function isCanonicalAssignableRole(
  role: EstablishmentRoleCatalogueEntry,
): role is EstablishmentRoleCatalogueEntry & { roleName: string } {
  const roleName = String(role.roleName ?? "").trim();
  const roleKey = String(role.roleKey ?? role.roleCode ?? "").trim();
  return Boolean(roleKey && roleName && normalize(roleName) !== UNAFFECTED_LABEL);
}

/**
 * Rôles proposés dans la modale. Les libellés restent ceux du catalogue backend.
 * Les permissions ne sont pas exposées : la matrice reste hors de cet écran.
 */
export function visibleAssignableRoles(catalog: EstablishmentRoleCatalogueEntry[]): AssignableRoleChoice[] {
  const seen = new Set<string>();
  const choices: AssignableRoleChoice[] = [];
  for (const entry of catalog) {
    if (!isCanonicalAssignableRole(entry)) continue;
    const roleName = String(entry.roleName).trim();
    const roleKey = String(entry.roleKey ?? entry.roleCode).trim();
    if (isForbiddenAssignableIdentity(roleKey, roleName)) continue;
    const dedupe = normalize(roleName);
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    choices.push({ roleKey, roleName });
  }
  return choices;
}

function cleanRoleLabel(value: unknown): string {
  const label = String(value ?? "").trim();
  if (!label || normalize(label) === UNAFFECTED_LABEL) return "";
  return label;
}

function uniqueLabels(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/** Rôles actuellement actifs. Même priorité que le Web : `roles`, puis le libellé unique. */
export function currentAccessRoleLabels(user: RoleBearingUser): string[] {
  const fromRoles = uniqueLabels((user.roles ?? []).map(cleanRoleLabel).filter(Boolean));
  if (fromRoles.length) return fromRoles;
  const fromActive = uniqueLabels((user.activeRoles ?? []).map(cleanRoleLabel).filter(Boolean));
  if (fromActive.length) return fromActive;
  const single = cleanRoleLabel(user.role);
  return single ? [single] : [];
}

function matchesChoice(label: string, choice: AssignableRoleChoice): boolean {
  const value = normalize(label);
  if (value === normalize(choice.roleName) || value === normalize(choice.roleKey)) return true;
  const token = roleKeyToken(label);
  return token === roleKeyToken(choice.roleKey) || token === roleKeyToken(choice.roleName);
}

/**
 * Aligne les rôles actifs sur les libellés du catalogue (pré-cochage).
 * Un rôle actif absent du catalogue est conservé pour ne pas être révoqué par omission.
 */
export function alignRolesToCatalogue(currentLabels: string[], catalog: AssignableRoleChoice[]): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const label of currentLabels) {
    const match = catalog.find((choice) => matchesChoice(label, choice));
    const next = match?.roleName ?? label;
    const key = normalize(next);
    if (!key || seen.has(key)) continue;
    seen.add(key);
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
  const diff = diffRoleAssignment(input.currentRoles, input.selectedRoles);
  if (isStudentLinkedAccount(input.user) || areStudentRolesLocked(input.user)) {
    const teacherGrant = diff.toGrant.some((role) => isTeacherRoleLabel(role));
    throw new RoleAssignmentRejected(
      teacherGrant ? STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE : STUDENT_ROLE_LOCKED_MESSAGE,
      409,
    );
  }

  for (const role of diff.toGrant) {
    if (!canAssignRoleToUserAccount(input.user, role)) {
      throw new RoleAssignmentRejected(
        isTeacherRoleLabel(role) ? STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE : STUDENT_ROLE_LOCKED_MESSAGE,
        409,
      );
    }
    try {
      await input.grant(input.userId, role);
    } catch (error) {
      throw new RoleAssignmentRejected(rejectionMessage(error), rejectionStatus(error));
    }
    input.onGranted?.(role);
  }

  for (const role of diff.toRevoke) {
    if (isStudentLinkedAccount(input.user) || areStudentRolesLocked(input.user)) {
      throw new RoleAssignmentRejected(STUDENT_ROLE_LOCKED_MESSAGE, 409);
    }
    try {
      await input.revoke(input.userId, role);
    } catch (error) {
      throw new RoleAssignmentRejected(rejectionMessage(error), rejectionStatus(error));
    }
    input.onRevoked?.(role);
  }

  return diff;
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
        /* Le refus API reste la vérité affichée. Un échec de relecture ne devient pas un succès. */
      }
    }
    return { ok: false, message, status };
  }
}
