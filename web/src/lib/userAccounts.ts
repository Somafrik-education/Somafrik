import type { BackOfficeState, Country, Session, SessionUser, UserAccount } from "../types";
import { getSchoolAcademicLists, mergeSelectOptions } from "./academicConfig";
import {
  canonicalCountryScope,
  getCountryCodeFromScope,
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
  SCHOOL_ADMIN_ROLE,
  SUPER_ADMIN_ROLE,
} from "./orgHierarchy";
import { resolveEffectivePermissions } from "./permissions";
import { api } from "../api/client";
import { findDuplicateLoginIdentifier } from "./userAccountRules";
import {
  accountMatchesSchoolIdentity,
  resolveSessionSchoolIdentity,
} from "./schoolCanonicalIdentity";

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

export function isUnassignedUserAccount(
  user: Pick<UserAccount, "role" | "roles" | "assignmentStatus" | "accountKind" | "linkedStudent" | "linkedTeacher" | "businessProfileLabel" | "businessProfileConflict" | "roleKeys">,
): boolean {
  if (formatBusinessProfileKind(user) !== BUSINESS_PROFILE_KIND_LABELS.unassigned) {
    return false;
  }
  const role = normalize(String(user.role ?? ""));
  const roles = Array.isArray(user.roles) ? user.roles.filter((item) => normalize(item)) : [];
  const assignmentStatus = normalize(String(user.assignmentStatus ?? ""));
  return (
    roles.length === 0 &&
    (!role || role === "sans affectation") &&
    (!assignmentStatus || assignmentStatus === "sans affectation")
  );
}

/** Comptes plateforme gérables par le Superadmin (dont les identités encore sans rôle). */
export function isSuperadminManagedUser(
  user: Pick<UserAccount, "role" | "roles" | "assignmentStatus">,
): boolean {
  if (isUnassignedUserAccount(user)) return true;
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
      (normalizedPlatformRoleKey(target.role) === normalizedPlatformRoleKey(SCHOOL_ADMIN_ROLE) ||
        isUnassignedUserAccount(target)) &&
      (action === "READ" || action === "CREATE" || action === "UPDATE" || action === "SUSPEND")
    );
  }
  // L'ancien JWT peut encore porter schools.school_code (SCH-…), tandis que
  // GET /users projette schools.login_code (CD-…): ces codes ne sont pas une
  // autorité de tenant. Comparer exclusivement l'UUID membership canonique.
  const identity = resolveSessionSchoolIdentity(actor);
  return Boolean(identity && accountMatchesSchoolIdentity(target, identity));
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

/** Champs modifiables selon le créateur, le rôle cible, et le mode create vs edit. */
export function getUserFormFieldPolicy(
  creator: SessionUser | null | undefined,
  targetRole: string,
  options: { mode?: "create" | "edit" } = {},
): UserFormFieldPolicy {
  let policy: UserFormFieldPolicy;
  if (isSuperAdminRole(creator?.role)) {
    if (targetRole === COUNTRY_ADMIN_ROLE) {
      policy = {
        countryScope: "select",
        scopeLevel: "readonly",
        schoolCode: "readonly",
        accessChannel: "readonly",
      };
    } else if (targetRole === SCHOOL_ADMIN_ROLE) {
      policy = {
        countryScope: "select",
        scopeLevel: "readonly",
        schoolCode: "select",
        accessChannel: "readonly",
      };
    } else {
      policy = {
        countryScope: "select",
        scopeLevel: "readonly",
        schoolCode: "select",
        accessChannel: "readonly",
      };
    }
  } else if (creator?.role === COUNTRY_ADMIN_ROLE) {
    policy = {
      countryScope: "readonly",
      scopeLevel: "readonly",
      schoolCode: "select",
      accessChannel: "readonly",
    };
  } else {
    policy = {
      countryScope: "readonly",
      scopeLevel: "readonly",
      schoolCode: "readonly",
      accessChannel: "select",
    };
  }

  if (options.mode === "edit") {
    return {
      ...policy,
      countryScope: "readonly",
      schoolCode: "readonly",
    };
  }
  return policy;
}

const IDENTITY_UPDATE_ALLOWLIST = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "gender",
  "status",
  "birthDate",
  "validationStatus",
  "validationRequestedBy",
  "validationRequestedAt",
  "validatedBy",
  "validatedAt",
] as const;

/** PATCH identité : allowlist stricte. Jamais userCode / schoolCode / countryCode / role. */
export function toUpdateUserIdentityPayload(user: Partial<UserAccount>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of IDENTITY_UPDATE_ALLOWLIST) {
    if (user[key] !== undefined) payload[key] = user[key];
  }
  return payload;
}

export function canReassignUserTenant(
  actor: SessionUser | null | undefined,
  target: UserAccount | null | undefined,
): boolean {
  if (!actor || !target?.id) return false;
  if (isSuperAdminRole(target.role) || target.role === COUNTRY_ADMIN_ROLE) return false;
  const keys = target.roleKeys ?? [];
  if (keys.includes("SUPER_ADMIN") || keys.includes("COUNTRY_ADMIN")) return false;
  return isSuperAdminRole(actor.role) || actor.role === COUNTRY_ADMIN_ROLE;
}

const PARENT_STUDENT_ROLE_LABELS = new Set(["Parent", "Élève / Étudiant"]);

export const ACCESS_ROLES_NONE_LABEL = "Aucun rôle d'accès";
export const BUSINESS_PROFILE_KIND_LABELS = {
  student_login: "Compte lié à un élève",
  teacher: "Profil enseignant",
  staff: "Compte staff",
  unassigned: "Sans affectation",
  conflict: "Conflit élève + enseignant",
} as const;

function accessRoleKeysOf(
  user: Pick<UserAccount, "roleKeys">,
): string[] {
  return (user.roleKeys ?? []).map((key) => String(key ?? "").trim().toUpperCase()).filter(Boolean);
}

function isEmptyAccessLabel(value?: string | null): boolean {
  const status = String(value ?? "").trim();
  return !status || status.toLowerCase() === "sans affectation";
}

/** Type métier. Un élève lié n'est jamais « Sans affectation ». */
export function formatBusinessProfileKind(
  user: Pick<UserAccount, "accountKind" | "linkedStudent" | "linkedTeacher" | "businessProfileLabel" | "businessProfileConflict" | "roleKeys">,
): string {
  if (user.businessProfileLabel) return user.businessProfileLabel;
  if (user.accountKind === "conflict" || user.businessProfileConflict) {
    return BUSINESS_PROFILE_KIND_LABELS.conflict;
  }
  const keys = accessRoleKeysOf(user);
  if (
    user.accountKind === "student_login" ||
    user.linkedStudent?.studentId ||
    user.linkedStudent?.studentCode ||
    keys.includes("STUDENT")
  ) {
    return BUSINESS_PROFILE_KIND_LABELS.student_login;
  }
  if (
    user.accountKind === "teacher" ||
    user.linkedTeacher?.teacherId ||
    user.linkedTeacher?.teacherCode ||
    keys.includes("TEACHER")
  ) {
    return BUSINESS_PROFILE_KIND_LABELS.teacher;
  }
  if (user.accountKind === "staff" || keys.length) {
    return BUSINESS_PROFILE_KIND_LABELS.staff;
  }
  return BUSINESS_PROFILE_KIND_LABELS.unassigned;
}

/** Rôles d'accès uniquement. Distinct du type métier. */
export function formatAccessRolesDisplay(
  user: Pick<UserAccount, "role" | "roles" | "roleKeys" | "assignmentStatus">,
): string {
  const keys = accessRoleKeysOf(user);
  if (keys.length) {
    if (!isEmptyAccessLabel(user.assignmentStatus)) return String(user.assignmentStatus).trim();
    if (Array.isArray(user.roles) && user.roles.length) return user.roles.join(", ");
    if (!isEmptyAccessLabel(user.role)) return String(user.role).trim();
    return keys.join(", ");
  }
  if (!isEmptyAccessLabel(user.assignmentStatus)) return String(user.assignmentStatus).trim();
  if (Array.isArray(user.roles) && user.roles.length) return user.roles.join(", ");
  if (!isEmptyAccessLabel(user.role)) return String(user.role).trim();
  return ACCESS_ROLES_NONE_LABEL;
}

export function formatUserRolesDisplay(user: Pick<UserAccount, "role" | "roles" | "assignmentStatus" | "accountKind" | "linkedStudent" | "linkedTeacher" | "businessProfileLabel" | "businessProfileConflict" | "roleKeys">): string {
  return formatAccessRolesDisplay(user);
}

export function isStudentLinkedAccount(
  user: Pick<UserAccount, "accountKind" | "linkedStudent" | "role" | "roles" | "roleKeys">,
): boolean {
  if (user.accountKind === "student_login" || user.accountKind === "conflict") return true;
  if (user.linkedStudent?.studentId || user.linkedStudent?.studentCode) return true;
  const tokens = [
    user.role,
    ...(user.roles ?? []),
    ...(user.roleKeys ?? []),
  ]
    .map((value) => normalize(String(value ?? "")))
    .filter(Boolean);
  return tokens.some((value) => value === "eleve / etudiant" || value === "student" || value === "eleve");
}

export function isTeacherRoleLabel(role: string | undefined | null): boolean {
  const value = normalize(String(role ?? ""));
  return value === "enseignant" || value === "teacher";
}

export function canAssignRoleToUserAccount(
  user: Pick<UserAccount, "accountKind" | "linkedStudent" | "linkedTeacher" | "role" | "roles" | "roleKeys">,
  roleName: string,
): boolean {
  if (isStudentLinkedAccount(user) && isTeacherRoleLabel(roleName)) return false;
  if ((user.linkedTeacher || user.accountKind === "teacher" || user.accountKind === "conflict") && normalize(roleName) === "eleve / etudiant") {
    return false;
  }
  return true;
}

export function accountKindLabel(
  user: Pick<UserAccount, "accountKind" | "linkedStudent" | "businessProfileConflict" | "businessProfileLabel">,
): string | null {
  const kind = formatBusinessProfileKind(user);
  if (kind === BUSINESS_PROFILE_KIND_LABELS.unassigned) return null;
  if (kind === BUSINESS_PROFILE_KIND_LABELS.staff) return null;
  return kind;
}

export const STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE =
  "Ce compte est lié à un élève actif. Le rôle Enseignant n'est pas compatible. Un compte utilisateur n'est pas un profil métier.";

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
      .flatMap((user) => (user.roles?.length ? user.roles : [user.role]))
      .filter((role): role is string => Boolean(role));
    return mergeSelectOptions(userRoles, inUse).filter((role) => !PARENT_STUDENT_ROLE_LABELS.has(role));
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
  const key = normalize(role);
  if (key.includes("eleve") || key.includes("etudiant") || key === "student") {
    throw new Error(
      "L'identifiant élève est le matricule PostgreSQL (CD-IN-EL-26-001). Pas de générateur Web.",
    );
  }
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

function findSchoolInScope(state: BackOfficeState, session: Session, schoolCode?: string) {
  const code = schoolCode ?? getDefaultSchoolCode(session);
  return state.schools.find((item) => normalize(item.code) === normalize(code));
}

export function getDefaultSchoolCode(session: Session | null): string {
  const fromUser = session?.user?.schoolCode;
  if (fromUser && fromUser !== "*") return fromUser;
  return "";
}

function resolveCountryScopeForRole(
  role: string,
  session: Session,
  school?: { country?: string; countryCode?: string },
  currentCountryScope = "",
): string {
  if (isSuperAdminRole(session.user.role)) {
    if (role === SCHOOL_ADMIN_ROLE && school) {
      return resolveCountryScopeFromSchool(school, currentCountryScope);
    }
    return currentCountryScope;
  }
  if (role === COUNTRY_ADMIN_ROLE) {
    return currentCountryScope || session.user.countryScope || "";
  }
  if (session.user.role === COUNTRY_ADMIN_ROLE) {
    return session.user.countryScope ?? resolveCountryScopeFromSchool(school ?? {}, currentCountryScope);
  }
  if (school) {
    return resolveCountryScopeFromSchool(school, session.user.countryScope ?? currentCountryScope);
  }
  return session.user.countryScope ?? currentCountryScope;
}

function resolveSchoolCodeForRole(role: string, session: Session, current?: string) {
  if (role === SUPER_ADMIN_ROLE || role === COUNTRY_ADMIN_ROLE) {
    return "*";
  }
  if (current && current !== "*") {
    return current;
  }
  const fromUser = session.user.schoolCode;
  if (fromUser && fromUser !== "*") return fromUser;
  return "";
}

export function buildNewUserDraft(
  _role: string,
  session: Session,
  state: BackOfficeState,
): UserAccount {
  const schoolCode = getDefaultSchoolCode(session);
  const defaults = getRoleDefaults("", schoolCode);
  const school = schoolCode ? findSchoolInScope(state, session, schoolCode) : undefined;
  const temporaryPassword = generateTemporaryPassword();
  const countryScope = isSuperAdminRole(session.user.role)
    ? ""
    : resolveCountryScopeForRole("", session, school, session.user.countryScope ?? "");

  return {
    firstName: "",
    lastName: "",
    role: "",
    roles: [],
    assignmentStatus: "Sans affectation",
    identifier: "",
    email: "",
    phone: "",
    gender: "Non renseigné",
    schoolCode: schoolCode || defaults.schoolCode || "",
    countryScope,
    scopeLevel: defaults.scopeLevel,
    accessChannel: defaults.accessChannel,
    status: "Actif",
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
  const schoolCode = resolveSchoolCodeForRole(role, session, user.schoolCode);
  const defaults = getRoleDefaults(role, schoolCode);
  const school = schoolCode && schoolCode !== "*" ? findSchoolInScope(state, session, schoolCode) : undefined;
  const isNew = !user.id;

  return {
    ...user,
    role,
    schoolCode: defaults.schoolCode,
    countryScope: resolveCountryScopeForRole(role, session, school, user.countryScope ?? ""),
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
export function getUserEstablishmentLabel(user: UserAccount): string {
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

  const publicCode = String(user.schoolPublicCode ?? "").trim().toUpperCase();
  if (!publicCode) return "—";
  const schoolName = String(user.schoolName ?? "").trim();
  return schoolName ? `${schoolName} (${publicCode})` : publicCode;
}

export function getCountryScopeOptions(countries: Country[]) {
  return countries.map((country) => ({
    value: canonicalCountryScope(country),
    label: `${country.name} (${canonicalCountryScope(country)})`,
  }));
}

export function schoolsMatchingCountryScope<T extends { country?: string; countryCode?: string; code?: string }>(
  schools: T[],
  countryScope?: string,
): T[] {
  if (!String(countryScope ?? "").trim()) return [];
  return schools.filter((school) => schoolMatchesCountryScope(school, countryScope));
}

export function toCreateUserApiPayload(user: UserAccount): Record<string, unknown> {
  const schoolCode = String(user.schoolCode ?? "").trim();
  const countryCode = getCountryCodeFromScope(user.countryScope);
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    gender: user.gender,
    status: user.status,
    temporaryPassword: user.temporaryPassword,
    schoolCode: schoolCode && schoolCode !== "*" ? schoolCode : "",
    ...(countryCode ? { countryCode } : {}),
    ...(user.countryScope ? { countryScope: user.countryScope } : {}),
  };
}

/** Superadmin : création atomique identité + rôle (COUNTRY_ADMIN / SCHOOL_ADMIN). */
export function toProvisionUserApiPayload(user: UserAccount): Record<string, unknown> {
  const countryCode = getCountryCodeFromScope(user.countryScope);
  const roleKey =
    user.role === COUNTRY_ADMIN_ROLE ? "COUNTRY_ADMIN" : user.role === SCHOOL_ADMIN_ROLE ? "SCHOOL_ADMIN" : "";
  const payload: Record<string, unknown> = {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    gender: user.gender,
    status: user.status,
    temporaryPassword: user.temporaryPassword,
    roleKey,
    ...(countryCode ? { countryCode } : {}),
    ...(user.countryScope ? { countryScope: user.countryScope } : {}),
  };
  if (roleKey === "SCHOOL_ADMIN") {
    const schoolCode = String(user.schoolCode ?? "").trim();
    payload.schoolCode = schoolCode && schoolCode !== "*" ? schoolCode : "";
  }
  return payload;
}

export interface ValidateUserAccountOptions {
  creator?: SessionUser | null;
  allowedSchoolCodes?: string[];
  teachers?: unknown[];
  schools?: Array<{ code?: string; country?: string; countryCode?: string }>;
}

export function validateUserAccount(
  user: UserAccount,
  users: UserAccount[],
  creatableRoles: string[],
  options: ValidateUserAccountOptions = {},
): string | null {
  const { creator, allowedSchoolCodes, schools } = options;

  if (!user.firstName?.trim() || !user.lastName?.trim()) {
    return "Prénom et nom sont obligatoires.";
  }
  const requestedRole = String(user.role ?? "").trim();
  if (
    !user.id &&
    requestedRole &&
    requestedRole !== "Sans affectation" &&
    creatableRoles.length > 0 &&
    !creatableRoles.includes(requestedRole)
  ) {
    return "Ce rôle n'est pas attribuable à la création depuis Comptes utilisateurs.";
  }
  if (user.email?.trim()) {
    const duplicate = findDuplicateLoginIdentifier(users, user);
    if (duplicate) {
      return `L'email « ${user.email.trim()} » est déjà utilisé dans cet établissement.`;
    }
  }
  if (creator?.role === COUNTRY_ADMIN_ROLE) {
    if (user.role === SCHOOL_ADMIN_ROLE || !user.id) {
      if (!user.schoolCode?.trim() || user.schoolCode === "*") {
        return "Sélectionnez l'établissement à administrer.";
      }
    }
    if (allowedSchoolCodes?.length && user.schoolCode && !allowedSchoolCodes.includes(normalize(user.schoolCode))) {
      return "Cet établissement n'appartient pas à votre pays.";
    }
  }

  if (isSuperAdminRole(creator?.role) && isSuperadminManagedUser(user)) {
    if (user.role === COUNTRY_ADMIN_ROLE) {
      if (!user.countryScope?.trim()) {
        return "Pays obligatoire pour un admin pays.";
      }
      if (user.schoolCode && user.schoolCode !== "*") {
        return "Un admin pays doit avoir l'établissement « * ».";
      }
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
      const selectedSchool = schools?.find((item) => normalize(item.code) === normalize(user.schoolCode));
      if (selectedSchool && !schoolMatchesCountryScope(selectedSchool, user.countryScope)) {
        return "L'établissement n'appartient pas au pays sélectionné.";
      }
    }
    if (user.schoolCode && user.schoolCode !== "*" && !user.countryScope?.trim()) {
      return "Pays obligatoire lorsque un établissement est sélectionné.";
    }
    return null;
  }

  if (isSuperAdminRole(creator?.role) && !user.id) {
    if (user.schoolCode && user.schoolCode !== "*" && !user.countryScope?.trim()) {
      return "Pays obligatoire lorsque un établissement est sélectionné.";
    }
    if (user.role === SCHOOL_ADMIN_ROLE) {
      return "Pays et établissement obligatoires pour un admin école.";
    }
  }

  return null;
}
