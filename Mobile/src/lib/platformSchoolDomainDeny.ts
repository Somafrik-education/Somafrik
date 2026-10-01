/**
 * P1-04 — Superadmin / Admin Pays ne sont pas des Admin School globaux.
 * Miroir Mobile du contrat Backend P1-02 + P0-2 / P1-01 / P1-03.
 * Ne pas ouvrir de domaine scolaire via ALL_PRIVILEGES ou schoolCode "*".
 */
import { isSuperAdminRole, sessionRoleToPlatformRole } from "./orgHierarchy";

const SUPER_ADMIN_KEYS = new Set(["SUPER_ADMIN", "super_admin"]);
const COUNTRY_ADMIN_KEYS = new Set(["COUNTRY_ADMIN", "country_admin"]);

const SCHOOL_DOMAIN_FEATURES = new Set([
  "Élèves",
  "Classes",
  "Enseignants",
  "Présences",
  "Notes",
  "Paiements",
  "Impayés",
  "Frais & tarifs",
  "Messages",
  "Planning de cours",
  "Affectations",
  "Matières",
  "Examens",
  "Bulletins",
  "Documents",
  "Rapports",
]);

const SCHOOL_DOMAIN_VIEWS = new Set([
  "students",
  "Students",
  "StudentDetail",
  "StudentNotes",
  "StudentPresences",
  "StudentPayments",
  "classes",
  "Classes",
  "Teachers",
  "teachers",
  "TeacherStudents",
  "TeacherAttendance",
  "TeacherGrades",
  "ClassGradesStats",
  "Presences",
  "Notes",
  "Payments",
  "Unpaid",
  "FeeGrids",
  "FraisEleve",
  "messages",
  "Messages",
  "InternalNotifications",
  "Schooling",
  "Timetable",
  "ReportCards",
  "Exams",
  "establishment",
]);

const SCHOOL_BOUND_SESSION_ROLES = new Set([
  "school_admin",
  "principal",
  "proviseur",
  "prefet",
  "secretary",
  "accountant",
  "adjoint",
  "supervisor",
  "teacher",
  "parent_student",
]);

function collectRoleTokens(session: unknown): string[] {
  if (!session || typeof session !== "object" || Array.isArray(session)) return [];
  const row = session as Record<string, unknown>;
  const user = row.user && typeof row.user === "object" && !Array.isArray(row.user) ? (row.user as Record<string, unknown>) : {};
  const nested = [
    ...(Array.isArray(row.roleKeys) ? row.roleKeys : []),
    ...(Array.isArray(row.roles) ? row.roles : []),
    ...(Array.isArray(user.roleKeys) ? user.roleKeys : []),
    ...(Array.isArray(user.roles) ? user.roles : []),
  ];
  return [row.role, row.roleLabel, row.roleKey, user.role, user.roleKey, user.roleLabel, ...nested]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function isSuperAdminToken(token: string): boolean {
  if (SUPER_ADMIN_KEYS.has(token) || SUPER_ADMIN_KEYS.has(token.toUpperCase())) return true;
  return isSuperAdminRole(token);
}

function isCountryAdminToken(token: string): boolean {
  if (COUNTRY_ADMIN_KEYS.has(token) || COUNTRY_ADMIN_KEYS.has(token.toUpperCase())) return true;
  return token === "Admin Pays";
}

export function isSuperAdminPrincipalSession(session: unknown): boolean {
  return collectRoleTokens(session).some(isSuperAdminToken);
}

export function isCountryAdminSession(session: unknown): boolean {
  return collectRoleTokens(session).some(isCountryAdminToken);
}

/** Superadmin ou Admin Pays : admin plateforme, jamais inbox / PII scolaires. */
export function isPlatformAdminSession(session: unknown): boolean {
  return isSuperAdminPrincipalSession(session) || isCountryAdminSession(session);
}

export function isSchoolDomainFeature(feature?: string | null): boolean {
  return Boolean(feature) && SCHOOL_DOMAIN_FEATURES.has(feature as string);
}

export function isSchoolDomainView(view?: string | null): boolean {
  return Boolean(view) && SCHOOL_DOMAIN_VIEWS.has(view as string);
}

export function hasSchoolBoundSessionRole(session: unknown): boolean {
  if (isPlatformAdminSession(session)) return false;
  const row = session && typeof session === "object" ? (session as { role?: string }) : null;
  const role = String(row?.role ?? "").trim();
  if (SCHOOL_BOUND_SESSION_ROLES.has(role)) return true;
  const platform = sessionRoleToPlatformRole(role);
  return platform === "Admin School" || platform === "Enseignant" || platform === "Parent";
}

function collectPermissionTokens(session: unknown): string[] {
  if (!session || typeof session !== "object" || Array.isArray(session)) return [];
  const row = session as Record<string, unknown>;
  const user = row.user && typeof row.user === "object" && !Array.isArray(row.user) ? (row.user as Record<string, unknown>) : {};
  return [
    ...(Array.isArray(row.permissions) ? row.permissions : []),
    ...(Array.isArray(user.permissions) ? user.permissions : []),
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
}

export function hasWildcardSchoolCode(session: unknown): boolean {
  if (!session || typeof session !== "object" || Array.isArray(session)) return false;
  const row = session as Record<string, unknown>;
  const user = row.user && typeof row.user === "object" && !Array.isArray(row.user) ? (row.user as Record<string, unknown>) : {};
  const school = row.school && typeof row.school === "object" && !Array.isArray(row.school) ? (row.school as Record<string, unknown>) : {};
  const codes = [row.schoolCode, user.schoolCode, school.code].map((value) => String(value ?? "").trim());
  return codes.includes("*");
}

export function hasAllPrivilegesToken(session: unknown): boolean {
  return collectPermissionTokens(session).includes("ALL_PRIVILEGES");
}

export function shouldDenySchoolDomain(session: unknown, featureOrView?: string | null): boolean {
  if (!session) return true;
  const schoolTarget =
    !featureOrView || isSchoolDomainFeature(featureOrView) || isSchoolDomainView(featureOrView);
  if (!schoolTarget) return false;
  if (isPlatformAdminSession(session)) return true;
  if (hasSchoolBoundSessionRole(session)) return false;
  if (hasWildcardSchoolCode(session)) return true;
  if (hasAllPrivilegesToken(session)) return true;
  return false;
}

export function shouldSkipSchoolTenantHydration(session: unknown): boolean {
  return isPlatformAdminSession(session);
}

/** Collections PII / métier établissement : jamais présentées à Superadmin / Admin Pays. */
export function stripSchoolDomainCollections<T extends Record<string, unknown>>(payload: T): T {
  return {
    ...payload,
    students: [],
    teachers: [],
    classes: [],
    courses: [],
    assignments: [],
    payments: [],
    presences: [],
    notes: [],
    messages: [],
    paymentStatuses: [],
  };
}

export function resolveSafeMobileDestination(destination: string, session: unknown): string {
  if (shouldDenySchoolDomain(session, destination)) return "Home";
  return destination;
}

export function constrainPlatformSchoolNavigation<T extends { destination: string }>(
  target: T,
  session: unknown,
): T {
  if (!isPlatformAdminSession(session)) return target;
  if (isSchoolDomainView(target.destination)) {
    return { ...target, destination: "Home" };
  }
  return target;
}
