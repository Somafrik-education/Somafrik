import type {
  BackOfficeState,
  Country,
  PlatformNotification,
  School,
  SessionUser,
  Subscription,
  UserAccount,
} from "../types";
import {
  getCountryCodeFromScope,
  isActiveUserAccount,
  isInternalSchoolRole,
  isPastDate,
  normalize,
  schoolMatchesCountryScope,
  countryScopeMatches,
  ACTIVE_USERS_KPI_LABEL,
} from "./format";
import {
  COUNTRY_ADMIN_ROLE,
  isSuperAdminRole,
  scopedCountries as scopedCountriesForUser,
  SCHOOL_ADMIN_ROLE,
} from "./orgHierarchy";
import { isSuperadminManagedUser, isUnassignedUserAccount } from "./userAccounts";
import { isUserAccountVisible } from "./userAccountRules";
import {
  accountMatchesSchoolScope,
  buildUsersScopeTrace,
  logUsersScopeTrace,
  resolveSessionSchoolScope,
  schoolMatchesSessionScope,
  type DiagnoseScopedUsersResult,
} from "./schoolTenantIdentity";

interface ScopeState {
  schools: School[];
  users: UserAccount[];
  countries: Country[];
  subscriptions: Subscription[];
  notifications: PlatformNotification[];
}

/** Réduit l'état BackOffice aux données visibles pour l'utilisateur courant. */
export function applyClientScopeToState(state: BackOfficeState, user: SessionUser | null): BackOfficeState {
  if (!user || isSuperAdminRole(user.role)) return state;
  return {
    ...state,
    schools: scopedSchools(user, state),
    countries: scopedCountries(user, state),
    subscriptions: scopedSubscriptions(user, state),
    notifications: scopedNotifications(user, state),
    users: scopedUsers(user, state),
  };
}

export function scopedSchools(user: SessionUser | null, state: ScopeState): School[] {
  if (!user) return [];
  if (isSuperAdminRole(user.role)) return state.schools;
  if (user.role === COUNTRY_ADMIN_ROLE) {
    const countryScope = String(user.countryScope ?? "").trim();
    if (!countryScope || !getCountryCodeFromScope(countryScope)) return [];
    return state.schools.filter((school) => schoolMatchesCountryScope(school, countryScope));
  }
  const scope = resolveSessionSchoolScope(user);
  if (scope.mode !== "school") return [];
  return state.schools.filter((school) => schoolMatchesSessionScope(school, scope));
}

export function scopedCountries(user: SessionUser | null, state: ScopeState): Country[] {
  return scopedCountriesForUser(user, state.countries);
}

export function scopedSubscriptions(user: SessionUser | null, state: ScopeState): Subscription[] {
  if (!user) return [];
  if (isSuperAdminRole(user.role)) return state.subscriptions;
  if (user.role === COUNTRY_ADMIN_ROLE) {
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

export function scopedNotifications(
  user: SessionUser | null,
  state: ScopeState,
): PlatformNotification[] {
  if (!user) return [];
  if (isSuperAdminRole(user.role)) return state.notifications;
  if (user.role === COUNTRY_ADMIN_ROLE) {
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
      normalize(notification.audience).includes(normalize(user.role)) ||
      normalize(notification.audience).includes("etablissement"),
  );
}

export function diagnoseScopedUsers(
  user: SessionUser | null,
  state: ScopeState,
): DiagnoseScopedUsersResult {
  if (!user) {
    const trace = buildUsersScopeTrace(user, [], [], "CANONICAL_IDENTITY_MISSING");
    return { users: [], trace };
  }
  const visible = state.users.filter((account) => isUserAccountVisible(account));
  if (isSuperAdminRole(user.role)) {
    const users = visible.filter((account) => isSuperadminManagedUser(account));
    return { users, trace: buildUsersScopeTrace(user, visible, users, null) };
  }
  if (user.role === COUNTRY_ADMIN_ROLE) {
    const countrySchoolCodes = new Set(
      scopedSchools(user, state).map((school) => normalize(school.code)),
    );
    const users = visible.filter(
      (account) =>
        (account.role === SCHOOL_ADMIN_ROLE || isUnassignedUserAccount(account)) &&
        (countryScopeMatches(account.countryScope, user.countryScope) ||
          countrySchoolCodes.has(normalize(account.schoolCode))),
    );
    return { users, trace: buildUsersScopeTrace(user, visible, users, null) };
  }

  const scope = resolveSessionSchoolScope(user);
  if (scope.mode === "none") {
    const trace = buildUsersScopeTrace(user, visible, [], scope.error);
    logUsersScopeTrace(trace);
    return { users: [], trace };
  }
  if (scope.mode !== "school") {
    const trace = buildUsersScopeTrace(user, visible, [], "CANONICAL_IDENTITY_MISSING");
    logUsersScopeTrace(trace);
    return { users: [], trace };
  }

  const tenantIds = new Set(
    visible
      .map((account) => String(account.schoolId ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (tenantIds.size > 1) {
    const trace = buildUsersScopeTrace(user, visible, [], "MULTI_TENANT_RESPONSE");
    logUsersScopeTrace(trace);
    return { users: [], trace };
  }

  const users = visible.filter((account) => accountMatchesSchoolScope(account, scope));
  const error =
    visible.length > 0 && users.length === 0 ? "SCOPE_INCONSISTENCY" : null;
  const trace = buildUsersScopeTrace(user, visible, users, error);
  logUsersScopeTrace(trace);
  return { users: error ? [] : users, trace };
}

export function scopedUsers(user: SessionUser | null, state: ScopeState): UserAccount[] {
  return diagnoseScopedUsers(user, state).users;
}

function countUsersByRole(users: UserAccount[], roles: string[]): number {
  const normalizedRoles = roles.map((role) => normalize(role));
  return users.filter((user) => normalizedRoles.includes(normalize(user.role))).length;
}

export interface Kpi {
  label: string;
  value: number;
  suffix?: string;
}

export function getLiveKpis(user: SessionUser | null, state: ScopeState): Kpi[] {
  if (!user) return [];
  const schools = scopedSchools(user, state);
  const users = scopedUsers(user, state);
  const subscriptions = scopedSubscriptions(user, state);
  const notifications = scopedNotifications(user, state);
  const countries = scopedCountries(user, state);
  const activeUsers = users.filter(isActiveUserAccount);
  const suspendedSchools = schools.filter((school) => school.status === "Suspendu").length;
  const expiredSubscriptions = subscriptions.filter(
    (subscription) =>
      subscription.paymentStatus === "En retard" || isPastDate(subscription.endDate),
  ).length;
  const monthlyRevenue = subscriptions
    .filter((s) => s.status === "Actif" && s.paymentStatus === "À jour")
    .reduce((total, s) => total + Number(s.monthlyPrice ?? 0), 0);

  if (isInternalSchoolRole(user.role)) {
    return [
      { label: ACTIVE_USERS_KPI_LABEL, value: activeUsers.length },
      {
        label: "Élèves suivis",
        value: countUsersByRole(users, ["Élève / Étudiant", "Élève", "Étudiant"]),
      },
      { label: "Enseignants", value: countUsersByRole(users, ["Enseignant"]) },
      {
        label: "Alertes à traiter",
        value:
          users.filter((u) => !isActiveUserAccount(u)).length +
          notifications.filter((n) => n.status === "Non lu").length,
      },
    ];
  }

  return [
    { label: "Pays", value: countries.length },
    { label: "Établissements", value: schools.length },
    { label: ACTIVE_USERS_KPI_LABEL, value: activeUsers.length },
    { label: "Revenus mensuels", value: monthlyRevenue, suffix: "USD" },
    { label: "Alertes plateforme", value: suspendedSchools + expiredSubscriptions },
  ];
}
