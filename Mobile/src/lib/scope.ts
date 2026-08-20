import { getCountryCodeFromScope, normalize, schoolMatchesCountryScope } from "./format";
import {
  COUNTRY_ADMIN_ROLE,
  isSuperAdminRole,
  SCHOOL_ADMIN_ROLE,
  sessionRoleToPlatformRole,
} from "./orgHierarchy";
import { ALL_SCHOOLS_CODE, isAllSchoolsSelection } from "./activeSchool";

export type PlatformNotification = {
  id?: string;
  title: string;
  message: string;
  type?: string;
  audience?: string;
  priority?: string;
  status?: string;
  date?: string;
  countryCode?: string;
  schoolCode?: string;
  createdBy?: string;
};

interface ScopeUser {
  role?: string;
  countryScope?: string;
  schoolCode?: string;
}

interface ScopeState {
  schools: { code: string; country?: string; countryCode?: string }[];
  users: { role?: string; schoolCode?: string; countryScope?: string; status?: string }[];
  countries: { name: string; code: string }[];
  subscriptions: { schoolCode?: string; country?: string; countryCode?: string }[];
  notifications: PlatformNotification[];
}

export function scopedSchools(user: ScopeUser | null, state: ScopeState) {
  if (!user) return [];
  if (user.role === "super_admin" || isSuperAdminRole(sessionRoleToPlatformRole(user.role))) {
    return state.schools;
  }
  if (user.role === "country_admin" || user.role === COUNTRY_ADMIN_ROLE) {
    return state.schools.filter((school) => schoolMatchesCountryScope(school, user.countryScope));
  }
  return state.schools.filter((school) => normalize(school.code) === normalize(user.schoolCode));
}

export function scopedCountries(user: ScopeUser | null, state: ScopeState) {
  if (!user) return [];
  if (user.role === "super_admin" || isSuperAdminRole(sessionRoleToPlatformRole(user.role))) {
    return state.countries;
  }
  if (user.role === "country_admin" || user.role === COUNTRY_ADMIN_ROLE) {
    return state.countries.filter(
      (country) =>
        normalize(country.name) === normalize(user.countryScope) ||
        normalize(country.code) === normalize(user.countryScope) ||
        getCountryCodeFromScope(user.countryScope) === country.code,
    );
  }
  return state.countries;
}

export function scopedSubscriptions(user: ScopeUser | null, state: ScopeState) {
  if (!user) return [];
  if (user.role === "super_admin" || isSuperAdminRole(sessionRoleToPlatformRole(user.role))) {
    return state.subscriptions;
  }
  if (user.role === "country_admin" || user.role === COUNTRY_ADMIN_ROLE) {
    const countryCode = getCountryCodeFromScope(user.countryScope);
    return state.subscriptions.filter(
      (subscription) =>
        normalize(subscription.country) === normalize(user.countryScope) ||
        normalize(subscription.countryCode) === normalize(countryCode),
    );
  }
  return state.subscriptions.filter(
    (subscription) => normalize(subscription.schoolCode) === normalize(user.schoolCode),
  );
}

export function scopedNotifications(user: ScopeUser | null, state: ScopeState) {
  if (!user) return [];
  if (user.role === "super_admin" || isSuperAdminRole(sessionRoleToPlatformRole(user.role))) {
    return state.notifications;
  }
  if (user.role === "country_admin" || user.role === COUNTRY_ADMIN_ROLE) {
    const countryCode = getCountryCodeFromScope(user.countryScope);
    return state.notifications.filter(
      (notification) =>
        normalize(notification.countryCode) === normalize(countryCode) ||
        normalize(notification.audience).includes("admin pays"),
    );
  }
  return state.notifications.filter(
    (notification) =>
      normalize(notification.schoolCode) === normalize(user.schoolCode) ||
      normalize(notification.audience ?? "").includes(normalize(user.role)) ||
      normalize(notification.audience ?? "").includes("etablissement"),
  );
}

export function scopedUsers(user: ScopeUser | null, state: ScopeState) {
  if (!user) return [];
  if (user.role === "super_admin" || isSuperAdminRole(sessionRoleToPlatformRole(user.role))) {
    return state.users.filter((account) => {
      const role = normalize(account.role);
      return role === "admin pays" || role === "admin school";
    });
  }
  if (user.role === "country_admin" || user.role === COUNTRY_ADMIN_ROLE) {
    const countrySchoolCodes = new Set(scopedSchools(user, state).map((school) => normalize(school.code)));
    return state.users.filter(
      (account) =>
        account.role === SCHOOL_ADMIN_ROLE &&
        (normalize(account.countryScope) === normalize(user.countryScope) ||
          countrySchoolCodes.has(normalize(account.schoolCode))),
    );
  }
  return state.users.filter((account) => normalize(account.schoolCode) === normalize(user.schoolCode));
}

/** Diffusion système (Super Admin) : marquée explicitement, visible par tous les établissements. */
function isSystemBroadcast(item: { systemBroadcast?: boolean; scope?: string }): boolean {
  return item.systemBroadcast === true || normalize(item.scope ?? "") === "system";
}

function filterBySchoolCode<T extends { schoolCode?: string; code?: string }>(
  items: T[],
  schoolCode: string,
): T[] {
  return items.filter(
    (item) =>
      normalize(item.schoolCode) === normalize(schoolCode) ||
      normalize(item.code) === normalize(schoolCode),
  );
}

export function scopeSchoolEntityData<T extends Record<string, unknown>>(
  payload: T,
  schoolCode: string,
  studentIds?: Set<string>,
): T {
  if (isAllSchoolsSelection(schoolCode)) return payload;

  const students = filterBySchoolCode((payload.students as any[]) ?? [], schoolCode);
  const ids = studentIds ?? new Set(students.map((item: any) => item.id));
  const classNames = new Set(students.map((item: any) => item.className).filter(Boolean));

  return {
    ...payload,
    schools: filterBySchoolCode((payload.schools as any[]) ?? [], schoolCode),
    users: filterBySchoolCode((payload.users as any[]) ?? [], schoolCode),
    students,
    teachers: ((payload.teachers as any[]) ?? []).filter(
      (item) =>
        normalize(item.schoolCode) === normalize(schoolCode) ||
        (item.assignedClasses ?? []).some((name: string) => classNames.has(name)),
    ),
    classes: ((payload.classes as any[]) ?? []).filter(
      (item) => normalize(item.schoolCode) === normalize(schoolCode) || classNames.has(item.name),
    ),
    courses: ((payload.courses as any[]) ?? []).filter(
      (item) => normalize(item.schoolCode) === normalize(schoolCode) || classNames.has(item.className),
    ),
    assignments: ((payload.assignments as any[]) ?? []).filter(
      (item) => normalize(item.schoolCode) === normalize(schoolCode) || classNames.has(item.className),
    ),
    payments: ((payload.payments as any[]) ?? []).filter(
      (item) => normalize(item.schoolCode) === normalize(schoolCode) || ids.has(item.studentId),
    ),
    presences: ((payload.presences as any[]) ?? []).filter(
      (item) => normalize(item.schoolCode) === normalize(schoolCode) || ids.has(item.studentId),
    ),
    notes: ((payload.notes as any[]) ?? []).filter(
      (item) => normalize(item.schoolCode) === normalize(schoolCode) || ids.has(item.studentId),
    ),
    announcements: ((payload.announcements as any[]) ?? []).filter(
      (item) => normalize(item.schoolCode) === normalize(schoolCode) || isSystemBroadcast(item),
    ),
    messages: ((payload.messages as any[]) ?? []).filter(
      (item) =>
        normalize(item.schoolCode) === normalize(schoolCode) ||
        ids.has(item.studentId) ||
        isSystemBroadcast(item),
    ),
    paymentStatuses: filterBySchoolCode((payload.paymentStatuses as any[]) ?? [], schoolCode),
    subscriptions: filterBySchoolCode((payload.subscriptions as any[]) ?? [], schoolCode),
  };
}

/**
 * Quand un rôle plateforme a choisi un établissement, les routes tenant sont déjà
 * limitées côté backend via X-Somafrik-School-Code + requireAuth. Le client ne doit
 * pas refaire un filtrage SCH-* === login_code V2 qui pourrait transformer une
 * réponse PostgreSQL valide en tableau vide. Les collections de contexte plateforme
 * restent, elles, scopées au principal afin de conserver le sélecteur et les droits.
 */
export function trustServerScopedPlatformTenant<T extends Record<string, unknown>>(
  payload: T,
  principalScoped: T,
): T {
  return {
    ...payload,
    countries: principalScoped.countries,
    schools: principalScoped.schools,
    subscriptions: principalScoped.subscriptions,
    notifications: principalScoped.notifications,
  } as T;
}

export function scopeBackOfficeForSession<T extends Record<string, unknown>>(
  payload: T,
  session: any,
  activeSchoolCode?: string,
): T {
  if (!session) return payload;

  const user = {
    role: session.role,
    countryScope: session.user?.countryScope ?? session.user?.countryCode,
    schoolCode: activeSchoolCode || session.user?.schoolCode || session.school?.code,
  };

  const scopeState = {
    schools: (payload.schools as any[]) ?? [],
    users: (payload.users as any[]) ?? [],
    countries: (payload.countries as any[]) ?? [],
    subscriptions: (payload.subscriptions as any[]) ?? [],
    notifications: (payload.notifications as any[]) ?? [],
  };

  if (session.role === "country_admin") {
    const scoped = {
      ...payload,
      countries: scopedCountries(user, scopeState),
      schools: scopedSchools(user, scopeState),
      subscriptions: scopedSubscriptions(user, scopeState),
      users: scopedUsers(user, scopeState),
      notifications: scopedNotifications(user, scopeState),
    } as T;
    if (activeSchoolCode && !isAllSchoolsSelection(activeSchoolCode)) {
      return trustServerScopedPlatformTenant(payload, scoped);
    }
    return scoped;
  }

  if (session.role === "super_admin") {
    const scoped = {
      ...payload,
      countries: scopedCountries(user, scopeState),
      schools: scopedSchools(user, scopeState),
      subscriptions: scopedSubscriptions(user, scopeState),
      users: scopedUsers(user, scopeState),
      notifications: scopedNotifications(user, scopeState),
    } as T;
    if (activeSchoolCode && !isAllSchoolsSelection(activeSchoolCode)) {
      return trustServerScopedPlatformTenant(payload, scoped);
    }
    return scoped;
  }

  // Pour les comptes établissement, le JWT et les repositories PostgreSQL sont déjà
  // tenant-scoped. Ne pas refaire côté UI un contrôle d'identité pouvant comparer
  // l'alias interne de session à un schoolCode public V2 normalisé.
  if (session.role === "school_admin") {
    return payload;
  }

  return payload;
}

export { ALL_SCHOOLS_CODE };
