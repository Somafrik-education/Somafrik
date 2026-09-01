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
  projectScopedUsersForSchool,
  type UserScopeProjection,
} from "./schoolCanonicalIdentity";

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
  // Audit #456 SAFE aujourd'hui : GET /schools projette `code` = leftover school_code,
  // aligné sur le leftover JWT. Preuve : scope.otherDomains.audit.test.ts.
  return state.schools.filter((school) => normalize(school.code) === normalize(user.schoolCode));
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
  // Audit #456 SAFE aujourd'hui : GET /subscriptions.schoolCode = leftover school_code.
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
  // Audit #456 SAFE aujourd'hui : GET /notifications.schoolCode = leftover school_code.
  // Audience « etablissement » / rôle est un filet supplémentaire, pas une autorité UUID.
  return state.notifications.filter(
    (notification) =>
      normalize(notification.schoolCode) === normalize(user.schoolCode) ||
      normalize(notification.audience).includes(normalize(user.role)) ||
      normalize(notification.audience).includes("etablissement"),
  );
}

export function projectScopedUsers(user: SessionUser | null, state: ScopeState): UserScopeProjection {
  if (!user) {
    return {
      users: [],
      error: null,
      received: 0,
      kept: 0,
      trace: {
        kind: "users_scope_trace",
        role: "",
        session: {
          hasSchoolId: false,
          hasPublicCode: false,
          leftoverPresent: false,
          schoolCodeIsV2: false,
          leftoverEqualsPublic: null,
        },
        api: {
          received: 0,
          distinctSchoolIds: 0,
          distinctPublicCodes: 0,
          distinctProjectedSchoolCodes: 0,
        },
        kept: 0,
        error: null,
      },
    };
  }
  const visible = state.users.filter((account) => isUserAccountVisible(account));
  if (isSuperAdminRole(user.role)) {
    const users = visible.filter((account) => isSuperadminManagedUser(account));
    return {
      users,
      error: null,
      received: visible.length,
      kept: users.length,
      trace: {
        kind: "users_scope_trace",
        role: String(user.role ?? ""),
        session: {
          hasSchoolId: false,
          hasPublicCode: false,
          leftoverPresent: false,
          schoolCodeIsV2: false,
          leftoverEqualsPublic: null,
        },
        api: {
          received: visible.length,
          distinctSchoolIds: 0,
          distinctPublicCodes: 0,
          distinctProjectedSchoolCodes: 0,
        },
        kept: users.length,
        error: null,
      },
    };
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
    return {
      users,
      error: null,
      received: visible.length,
      kept: users.length,
      trace: {
        kind: "users_scope_trace",
        role: String(user.role ?? ""),
        session: {
          hasSchoolId: false,
          hasPublicCode: false,
          leftoverPresent: false,
          schoolCodeIsV2: false,
          leftoverEqualsPublic: null,
        },
        api: {
          received: visible.length,
          distinctSchoolIds: 0,
          distinctPublicCodes: 0,
          distinctProjectedSchoolCodes: 0,
        },
        kept: users.length,
        error: null,
      },
    };
  }
  return projectScopedUsersForSchool(user, visible);
}

export function scopedUsers(user: SessionUser | null, state: ScopeState): UserAccount[] {
  return projectScopedUsers(user, state).users;
}

/**
 * Erreur users à propager depuis le merge distant, AVANT applyClientScopeToState.
 * `undefined` = ce batch ne charge pas `users` (ne pas toucher scopeError).
 * Après filtrage client, UsersPage ne peut plus reconstruire SCOPE_LEAK / SCOPE_MISMATCH.
 */
export function usersScopeErrorFromLoadedDomains(
  user: SessionUser | null,
  loadedKeys: readonly string[],
  state: Pick<ScopeState, "users" | "schools" | "countries" | "subscriptions" | "notifications">,
): string | null | undefined {
  if (!loadedKeys.includes("users")) return undefined;
  return projectScopedUsers(user, state).error?.message ?? null;
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
