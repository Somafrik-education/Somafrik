import type { BackOfficeState, Country, School, Session, SessionUser, UserAccount } from "../types";
import { getSchoolAcademicLists, mergeSelectOptions } from "./academicConfig";
import {
  canonicalCountryScope,
  countryScopeMatches,
  isInternalSchoolRole,
  isSchoolAdminRole,
  normalize,
  resolveCountryScopeFromSchool,
  schoolMatchesCountryScope,
} from "./format";
import {
  COUNTRY_ADMIN_ROLE,
  isPendingValidationStatus,
  isSuperAdminRole,
  normalizePlatformRole,
  PENDING_VALIDATION_STATUS,
  SCHOOL_ADMIN_ROLE,
  SUPER_ADMIN_ROLE,
} from "./orgHierarchy";
import { isTeacherUserRole } from "./userTeacherSync";
import { resolveEffectivePermissions } from "./permissions";
import { api } from "../api/client";
import { findDuplicateLoginIdentifier } from "./userAccountRules";

const PLATFORM_ROLES = new Set([SUPER_ADMIN_ROLE, COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE]);

export function formatAccessChannelLabel(channel?: string): string {
  if (!channel) return "";
  if (channel === "BackOffice") return "Plateforme";
  return channel;
}

function normalizedPlatformRoleKey(role?: string): string {
  return normalize(normalizePlatformRole(role));
}

export function isPlatformUserRole(role?: string): boolean {
  if (!role) return false;
  const key = normalizedPlatformRoleKey(role);
  return [...PLATFORM_ROLES].some((platformRole) => normalizedPlatformRoleKey(platformRole) === key);
}

/** Comptes plateforme gérables par le Superadmin (dont ceux créés par un Admin Pays). */
export function isSuperadminManagedUser(user: Pick<UserAccount, "role">): boolean {
  const key = normalizedPlatformRoleKey(user.role);
  return (
    normalizedPlatformRoleKey(COUNTRY_ADMIN_ROLE) === key ||
    normalizedPlatformRoleKey(SCHOOL_ADMIN_ROLE) === key
  );
}

export function isCountryAdminProvisionedUser(
  user: Pick<UserAccount, "role" | "validationRequestedBy" | "validationStatus" | "status">,
): boolean {
  if (!isSuperadminManagedUser(user) || normalizedPlatformRoleKey(user.role) !== normalizedPlatformRoleKey(SCHOOL_ADMIN_ROLE)) {
    return false;
  }
  return Boolean(user.validationRequestedBy) || isPendingValidationStatus(user.validationStatus ?? user.status);
}

export function canSuperadminManageUser(user: UserAccount): boolean {
  return isSuperadminManagedUser(user);
}

export function canManageUserAccount(
  actor: SessionUser | null | undefined,
  target: UserAccount,
  action: "READ" | "CREATE" | "UPDATE" | "DELETE" | "SUSPEND" | "VALIDATE" = "UPDATE",
): boolean {
  if (!actor) return false;
  if (isSuperAdminRole(actor.role)) {
    if (action === "VALIDATE") {
      return isCountryAdminProvisionedUser(target) || isPendingValidationStatus(target.validationStatus ?? target.status);
    }
    return canSuperadminManageUser(target);
  }
  if (actor.role === COUNTRY_ADMIN_ROLE) {
    return (
      normalizedPlatformRoleKey(target.role) === normalizedPlatformRoleKey(SCHOOL_ADMIN_ROLE) &&
      (action === "READ" || action === "CREATE" || action === "UPDATE" || action === "SUSPEND")
    );
  }
  return normalize(actor.schoolCode) === normalize(target.schoolCode);
}

export function findUserAccountForContact(
  contact: Record<string, unknown>,
  users: UserAccount[],
): UserAccount | undefined {
  const contactId = String(contact.id ?? "").trim();
  const userId = String(contact.userId ?? "").trim();
  const userIdentifier = String(contact.userIdentifier ?? "").trim();
  return users.find((user) => {
    if (contactId && normalize(String(user.contactId ?? "")) === normalize(contactId)) return true;
    if (userId && normalize(String(user.id ?? "")) === normalize(userId)) return true;
    if (userIdentifier && normalize(user.identifier) === normalize(userIdentifier)) return true;
    return false;
  });
}

export async function resetUserAccountPassword(
  user: Pick<UserAccount, "id" | "identifier">,
  temporaryPassword: string,
): Promise<string> {
  const response = await api.post<{ temporaryPassword?: string }>(
    `/users/${encodeURIComponent(String(user.id ?? user.identifier))}/reset-password`,
    { temporaryPassword: temporaryPassword.trim() },
  );
  return String(response.temporaryPassword ?? temporaryPassword.trim());
}

/** Comptes plateforme créables / gérables directement par le Superadmin (page Utilisateurs). */
export const SUPERADMIN_DIRECT_USER_ROLES = [
  COUNTRY_ADMIN_ROLE,
  SCHOOL_ADMIN_ROLE,
] as const;

export function isSuperadminDirectUserRole(role?: string): boolean {
  return (
    role === COUNTRY_ADMIN_ROLE ||
    role === SCHOOL_ADMIN_ROLE
  );
}

export interface UserFormFieldPolicy {
  countryScope: "hidden" | "readonly" | "select";
  scopeLevel: "hidden" | "readonly" | "select";
  schoolCode: "hidden" | "readonly" | "select";
  accessChannel: "hidden" | "readonly" | "select";
}

/** Champs modifiables selon le créateur et le rôle cible. */
export function getUserFormFieldPolicy(
  creator: SessionUser | null | undefined,
  targetRole: string,
): UserFormFieldPolicy {
  if (isSuperAdminRole(creator?.role)) {
    if (targetRole === COUNTRY_ADMIN_ROLE) {
      return {
        countryScope: "select",
        scopeLevel: "readonly",
        schoolCode: "readonly",
        accessChannel: "readonly",
      };
    }
    if (targetRole === SCHOOL_ADMIN_ROLE) {
      return {
        countryScope: "select",
        scopeLevel: "readonly",
        schoolCode: "select",
        accessChannel: "readonly",
      };
    }
    return {
      countryScope: "hidden",
      scopeLevel: "readonly",
      schoolCode: "readonly",
      accessChannel: "readonly",
    };
  }

  if (creator?.role === COUNTRY_ADMIN_ROLE) {
    return {
      countryScope: "readonly",
      scopeLevel: "readonly",
      schoolCode: "select",
      accessChannel: "readonly",
    };
  }

  return {
    countryScope: "readonly",
    scopeLevel: "readonly",
    schoolCode: "readonly",
    accessChannel: "select",
  };
}

/** Rôles disponibles pour créer un compte (liste établissement + rôles déjà utilisés). */
export function getCreatableUserRoles(
  currentUser: SessionUser | null | undefined,
  state: BackOfficeState,
  schoolCode?: string,
): string[] {
  if (!currentUser) return [];

  if (isSuperAdminRole(currentUser.role)) {
    return [...SUPERADMIN_DIRECT_USER_ROLES];
  }

  if (currentUser.role === COUNTRY_ADMIN_ROLE) {
    return [SCHOOL_ADMIN_ROLE];
  }

  if (isSchoolAdminRole(currentUser.role) || isInternalSchoolRole(currentUser.role)) {
    const { userRoles } = getSchoolAcademicLists(state, schoolCode);
    const inUse = state.users
      .filter((user) => normalize(user.schoolCode) === normalize(schoolCode ?? currentUser.schoolCode))
      .map((user) => user.role)
      .filter(Boolean);
    return mergeSelectOptions(userRoles, inUse);
  }

  return [];
}

export function getRoleDefaults(role: string, schoolCode: string) {
  if (role === SUPER_ADMIN_ROLE) {
    return { scopeLevel: "Global", schoolCode: "*", accessChannel: "Application" };
  }
  if (role === COUNTRY_ADMIN_ROLE) {
    return { scopeLevel: "Pays", schoolCode: "*", accessChannel: "Application" };
  }
  if (role === SCHOOL_ADMIN_ROLE) {
    return { scopeLevel: "Établissement", schoolCode, accessChannel: "Application" };
  }
  return { scopeLevel: "Établissement", schoolCode, accessChannel: "Application" };
}

export function getUserIdentifierPrefix(role?: string): string {
  const key = normalize(role);
  if (key.includes("enseignant") || key.includes("prof")) return "ENS";
  if (key.includes("eleve") || key.includes("etudiant")) return "ELE";
  if (key.includes("parent")) return "PAR";
  if (key.includes("admin school") || key === "admin") return "ADM";
  if (key.includes("prefet")) return "PRF";
  if (key.includes("secretaire")) return "SEC";
  if (key.includes("comptable")) return "CPT";
  return "USR";
}

function nextSequence(values: string[], pattern: RegExp): number {
  let max = 0;
  values.forEach((value) => {
    const match = pattern.exec(value);
    if (match?.[1]) {
      max = Math.max(max, Number(match[1]));
    }
  });
  return max + 1;
}

export function generateUserIdentifier(users: UserAccount[], role?: string): string {
  const prefix = getUserIdentifierPrefix(role);
  const identifiers = users.map((user) => String(user.identifier ?? user.publicId ?? ""));
  const next = nextSequence(identifiers, new RegExp(`^${prefix}-(\\d+)$`, "i"));
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

export function generateTemporaryPassword(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `SF-${token}-${String(bytes[0]).padStart(3, "0")}`;
}

function generateUserRecordId(users: UserAccount[]): string {
  const existing = new Set(users.map((user) => String(user.id ?? "").trim()).filter(Boolean));
  let attempt =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `usr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  while (existing.has(attempt)) {
    attempt =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `usr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  return attempt;
}

function findSchoolInScope(state: BackOfficeState, session: Session, schoolCode?: string) {
  const code = schoolCode ?? getDefaultSchoolCode(session, state);
  return state.schools.find((item) => normalize(item.code) === normalize(code));
}

export function getDefaultSchoolCode(session: Session | null, state: BackOfficeState): string {
  const fromUser = session?.user?.schoolCode;
  if (fromUser && fromUser !== "*") return fromUser;
  if (session?.user?.role === COUNTRY_ADMIN_ROLE) {
    const school = state.schools.find((item) =>
      schoolMatchesCountryScope(item, session.user.countryScope),
    );
    if (school?.code) return school.code;
  }
  return state.schools[0]?.code ?? "";
}

function resolveCountryScopeForRole(
  role: string,
  session: Session,
  school?: { country?: string; countryCode?: string },
): string {
  if (role === COUNTRY_ADMIN_ROLE) {
    return "";
  }
  if (isSuperAdminRole(session.user.role)) {
    if (role === SCHOOL_ADMIN_ROLE && school) {
      return resolveCountryScopeFromSchool(school, "");
    }
    return "";
  }
  if (session.user.role === COUNTRY_ADMIN_ROLE) {
    return session.user.countryScope ?? resolveCountryScopeFromSchool(school ?? {}, "");
  }
  if (school) {
    return resolveCountryScopeFromSchool(school, session.user.countryScope ?? "");
  }
  return session.user.countryScope ?? "";
}

function resolveSchoolCodeForRole(role: string, session: Session, state: BackOfficeState, current?: string) {
  const defaults = getRoleDefaults(role, getDefaultSchoolCode(session, state));
  if (role === SCHOOL_ADMIN_ROLE && current && current !== "*") {
    return current;
  }
  return defaults.schoolCode;
}

export function buildNewUserDraft(
  role: string,
  session: Session,
  state: BackOfficeState,
): UserAccount {
  const schoolCode = resolveSchoolCodeForRole(role, session, state);
  const defaults = getRoleDefaults(role, schoolCode);
  const school = findSchoolInScope(state, session, defaults.schoolCode);
  const temporaryPassword = generateTemporaryPassword();

  // Règle métier : un Admin École créé par un Admin Pays doit être validé par le
  // Super Admin avant d'être utilisable. Il naît donc « En attente de validation ».
  const requiresSuperAdminValidation =
    session.user.role === COUNTRY_ADMIN_ROLE && role === SCHOOL_ADMIN_ROLE;

  return {
    id: generateUserRecordId(state.users),
    firstName: "",
    lastName: "",
    role,
    identifier: generateUserIdentifier(state.users, role),
    email: "",
    phone: "",
    gender: "Non renseigné",
    schoolCode: defaults.schoolCode,
    countryScope: resolveCountryScopeForRole(role, session, school),
    scopeLevel: defaults.scopeLevel,
    accessChannel: defaults.accessChannel,
    status: requiresSuperAdminValidation ? PENDING_VALIDATION_STATUS : "Actif",
    validationStatus: requiresSuperAdminValidation ? PENDING_VALIDATION_STATUS : undefined,
    validationRequestedBy: requiresSuperAdminValidation
      ? session.user.identifier ?? session.user.firstName ?? "Admin Pays"
      : undefined,
    permissions: resolveEffectivePermissions(role, undefined, state.rolePermissions),
    temporaryPassword,
    hasTemporaryPassword: true,
    mustChangePassword: true,
    createdBy: session.user.identifier ?? session.user.firstName ?? "Administrateur",
  };
}

export function applyRoleChangeToUser(
  user: UserAccount,
  role: string,
  session: Session,
  state: BackOfficeState,
): UserAccount {
  const schoolCode = resolveSchoolCodeForRole(role, session, state, user.schoolCode);
  const defaults = getRoleDefaults(role, schoolCode);
  const school = findSchoolInScope(state, session, defaults.schoolCode);
  const isNew = !user.id;

  return {
    ...user,
    role,
    schoolCode: defaults.schoolCode,
    countryScope: resolveCountryScopeForRole(role, session, school),
    scopeLevel: defaults.scopeLevel,
    accessChannel: defaults.accessChannel,
    permissions: resolveEffectivePermissions(role, undefined, state.rolePermissions),
    identifier: isNew ? generateUserIdentifier(state.users, role) : user.identifier,
  };
}

/**
 * Libellé du périmètre établissement d'un compte, sans exposer le marqueur «*».
 * Chaque rôle affiche son périmètre autorisé :
 *  - Super Admin  → tout le système Somafrik ;
 *  - Admin Pays   → tous les établissements de son pays ;
 *  - Admin École / rôles internes → l'établissement rattaché.
 */
export function getUserEstablishmentLabel(user: UserAccount, schools: School[] = []): string {
  const hasGlobalScope = !user.schoolCode || user.schoolCode === "*";

  if (hasGlobalScope) {
    if (isSuperAdminRole(user.role)) {
      return "Tous les établissements (système Somafrik)";
    }
    if (user.role === COUNTRY_ADMIN_ROLE) {
      return user.countryScope
        ? `Tous les établissements — ${user.countryScope}`
        : "Tous les établissements du pays";
    }
    return "Périmètre non défini";
  }

  const school = schools.find((item) => normalize(item.code) === normalize(user.schoolCode));
  return school ? `${school.name} (${school.code})` : (user.schoolCode as string);
}

export function getCountryScopeOptions(countries: Country[]) {
  return countries.map((country) => ({
    value: canonicalCountryScope(country),
    label: `${country.name} (${canonicalCountryScope(country)})`,
  }));
}

export interface ValidateUserAccountOptions {
  creator?: SessionUser | null;
  allowedSchoolCodes?: string[];
  teachers?: unknown[];
}

export function validateUserAccount(
  user: UserAccount,
  users: UserAccount[],
  creatableRoles: string[],
  options: ValidateUserAccountOptions = {},
): string | null {
  const { creator, allowedSchoolCodes } = options;

  if (!user.firstName?.trim() || !user.lastName?.trim()) {
    return "Prénom et nom sont obligatoires.";
  }
  if (!user.role?.trim()) {
    return "Choisissez un rôle.";
  }
  if (!creatableRoles.includes(user.role)) {
    return "Ce rôle n'est pas autorisé pour votre périmètre.";
  }
  if (!user.identifier?.trim()) {
    return "Identifiant obligatoire.";
  }
  const identifier = user.identifier.trim();
  const duplicate = findDuplicateLoginIdentifier(users, user);
  if (duplicate) {
    return `L'identifiant « ${identifier} » est déjà utilisé dans cet établissement.`;
  }

  if (isTeacherUserRole(user.role)) {
    const teachers = (options.teachers ?? []) as Array<{ id?: string; userId?: string; identifier?: string }>;
    const teacherConflict = teachers.find(
      (teacher) =>
        normalize(String(teacher.identifier ?? "")) === normalize(identifier) &&
        teacher.userId &&
        teacher.userId !== user.id,
    );
    if (teacherConflict) {
      return `L'identifiant « ${identifier} » est déjà attribué à un autre enseignant.`;
    }
  }

  const defaults = getRoleDefaults(user.role, user.schoolCode ?? "");
  if (user.scopeLevel !== defaults.scopeLevel) {
    return `Le périmètre doit être « ${defaults.scopeLevel} » pour le rôle ${user.role}.`;
  }
  if (user.accessChannel !== defaults.accessChannel) {
    return `Le canal d'accès doit être « ${defaults.accessChannel} » pour ce rôle.`;
  }

  if (user.role === COUNTRY_ADMIN_ROLE && !user.countryScope?.trim()) {
    return "Pays obligatoire pour un admin pays.";
  }
  if (user.role === SCHOOL_ADMIN_ROLE) {
    if (!user.countryScope?.trim()) {
      return "Pays obligatoire pour un admin école.";
    }
    if (!user.schoolCode?.trim() || user.schoolCode === "*") {
      return "Sélectionnez l'établissement à administrer.";
    }
  }
  if (!isPlatformUserRole(user.role) && !user.schoolCode?.trim()) {
    return "Code établissement obligatoire pour ce rôle.";
  }

  if (creator?.role === COUNTRY_ADMIN_ROLE) {
    if (user.role !== SCHOOL_ADMIN_ROLE) {
      return "Un admin pays ne peut gérer que des comptes Admin School.";
    }
    if (!countryScopeMatches(user.countryScope, creator.countryScope)) {
      return "Le pays du compte doit correspondre à votre périmètre.";
    }
    if (allowedSchoolCodes?.length && !allowedSchoolCodes.includes(normalize(user.schoolCode))) {
      return "Cet établissement n'appartient pas à votre pays.";
    }
  }

  if (isSuperAdminRole(creator?.role) && isSuperadminManagedUser(user)) {
    if (user.role === COUNTRY_ADMIN_ROLE && user.schoolCode !== "*") {
      return "Un admin pays doit avoir l'établissement « * ».";
    }
    if (user.role === SCHOOL_ADMIN_ROLE) {
      if (!user.countryScope?.trim()) {
        return "Pays obligatoire pour un admin école.";
      }
      if (!user.schoolCode?.trim() || user.schoolCode === "*") {
        return "Sélectionnez l'établissement à administrer.";
      }
      if (allowedSchoolCodes?.length && !allowedSchoolCodes.includes(normalize(user.schoolCode))) {
        return "Cet établissement n'est pas disponible dans votre périmètre.";
      }
    }
    return null;
  }

  return null;
}
