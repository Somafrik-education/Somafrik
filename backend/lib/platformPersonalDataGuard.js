"use strict";

/**
 * P0-2 — deny explicite plateforme vs données personnelles établissement.
 *
 * Super Administrateur Somafrik / Admin Pays ne doivent jamais lire ni
 * modifier les données personnelles métier d'un établissement, même avec
 * ALL_PRIVILEGES / COUNTRY_PRIVILEGES et même avec un schoolCode valide.
 *
 * Ce module ne dépend pas de rbacService ni de data.js (évite les cycles).
 */

const PLATFORM_PERSONAL_DATA_DENY = "PLATFORM_PERSONAL_DATA_DENIED";

const SUPER_ADMIN_ROLE_LABELS = Object.freeze([
  "Super Administrateur Somafrik",
  "Super Administrateur OKAFRIK",
]);

const COUNTRY_ADMIN_ROLE_LABELS = Object.freeze(["Admin Pays"]);

const PLATFORM_ADMIN_ROLE_KEYS = Object.freeze(["SUPER_ADMIN", "COUNTRY_ADMIN"]);

const PERSONAL_DATA_MODULE_KEYS = Object.freeze([
  "students",
  "teachers",
  "assignments",
  "contacts",
  "relations",
  "attendance",
  "grades",
  "report_cards",
  "payments",
  "unpaid",
  "messages",
  "documents",
  "exams",
]);

const PERSONAL_DATA_FEATURE_NAMES = Object.freeze([
  "Contacts",
  "Relations",
  "Élèves",
  "Enseignants",
  "Affectations",
  "Présences",
  "Notes",
  "Bulletins",
  "Paiements",
  "Impayés",
  "Messages",
  "Documents",
  "Examens",
]);

const PERSONAL_DATA_ALIAS_TOKENS = Object.freeze([
  "Voir élèves",
  "Gérer élèves",
  "Voir enseignants",
  "Ajouter enseignants",
  "Gérer enseignants",
  "Voir notes",
  "Créer notes",
  "Modifier notes",
  "Voir présences",
  "Modifier présences",
  "Faire appel",
  "Gérer appels",
  "Voir paiements",
  "Gérer paiements",
  "Messages parents",
  "Messages école",
  "Gérer messages",
  "Voir bulletins",
  "Valider bulletins",
  "Voir documents",
  "Voir examens",
  "Organiser examens",
  "Valider examens",
  "Voir enfant",
  "Gérer annonces",
  "Publier communications",
]);

const PERSONAL_DATA_FEATURE_PREFIXES = Object.freeze(
  PERSONAL_DATA_FEATURE_NAMES.map((name) => `${name}:`),
);

/**
 * Routes de données personnelles établissement. Deny pour SUPER_ADMIN / COUNTRY_ADMIN
 * AVANT requiredPermissions.some(...) — y compris ALL_PRIVILEGES / COUNTRY_PRIVILEGES.
 */
const SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM = Object.freeze([
  "GET /api/students",
  "GET /api/students/:id",
  "PATCH /api/students/:id",
  "DELETE /api/students/:id",
  "GET /api/students/:id/report",
  "GET /api/students/:id/report.pdf",
  "GET /api/students/:id/payments",
  "GET /api/classes/:classCode/students",
  "POST /api/classes/:classCode/students",
  "GET /api/mobile-sync/l1/students",
  "POST /api/backoffice/import/students/validate",
  "GET /api/teachers",
  "GET /api/teachers/:teacherCode",
  "POST /api/teachers",
  "PATCH /api/teachers/:teacherCode",
  "DELETE /api/teachers/:teacherCode",
  "GET /api/assignments",
  "POST /api/assignments",
  "PATCH /api/assignments/:assignmentId",
  "DELETE /api/assignments/:assignmentId",
  "GET /api/mobile-sync/l1/assignments",
  "POST /api/backoffice/users/create-teacher",
  "GET /api/notes",
  "GET /api/students/:id/notes",
  "POST /api/notes",
  "GET /api/evaluations",
  "POST /api/evaluations",
  "PATCH /api/evaluations/:evaluationId",
  "GET /api/presences",
  "GET /api/students/:id/presences",
  "POST /api/presences",
  "GET /api/payments",
  "POST /api/payments",
  "POST /api/payments/:paymentId/cancel",
  "GET /api/finance/payment-student-options",
  "GET /api/finance/student-fees",
  "POST /api/finance/student-fees/:obligationId/adjust",
  "POST /api/finance/reconcile-payment-allocations",
  "GET /api/backoffice/finance/unpaid",
  "POST /api/backoffice/finance/unpaid/reminders",
  "GET /api/backoffice/messages",
  "GET /api/backoffice/messages/unread-count",
  "GET /api/backoffice/messages/recipients",
  "GET /api/backoffice/messages/:messageId",
  "POST /api/backoffice/messages",
  "PATCH /api/backoffice/messages/:messageId/read",
  "GET /api/backoffice/conversations",
  "POST /api/backoffice/conversations",
  "GET /api/backoffice/conversations/:conversationId",
  "GET /api/backoffice/conversations/:conversationId/messages",
  "POST /api/backoffice/conversations/:conversationId/messages",
  "POST /api/backoffice/communications/attachments",
  "GET /api/backoffice/communications/attachments/:attachmentId",
  "GET /api/backoffice/messages/attachments/:attachmentId",
  "GET /api/backoffice/announcements",
  "GET /api/backoffice/announcements/unread-count",
  "GET /api/backoffice/announcements/audience-options",
  "GET /api/backoffice/announcements/:announcementId",
  "POST /api/backoffice/announcements",
  "POST /api/backoffice/announcements/attachments",
  "PATCH /api/backoffice/announcements/:announcementId",
  "PATCH /api/backoffice/announcements/:announcementId/read",
  "POST /api/backoffice/announcements/:announcementId/archive",
  "GET /api/backoffice/announcements/attachments/:attachmentId",
  "GET /api/backoffice/internal-notifications",
  "GET /api/backoffice/internal-notifications/unread-count",
  "GET /api/backoffice/internal-notifications/:notificationId",
  "POST /api/backoffice/internal-notifications",
  "PATCH /api/backoffice/internal-notifications/:notificationId/read",
  "PATCH /api/backoffice/internal-notifications/:notificationId/archive",
  "POST /api/backoffice/internal-notifications/attachments",
  "GET /api/backoffice/internal-notifications/attachments/:attachmentId",
  "GET /api/backoffice/contacts",
  "POST /api/backoffice/contacts",
  "PATCH /api/backoffice/contacts/:contactId",
  "POST /api/backoffice/contacts/:contactId/provision-account",
  "GET /api/backoffice/relations",
  "POST /api/backoffice/relations",
  "GET /api/parents/identity",
  "POST /api/parents/link",
  "PATCH /api/parents/relations/:relationId",
  "GET /api/v2/documents",
  "GET /api/report-cards",
  "POST /api/report-cards/generate",
  "POST /api/report-cards/:cardId/publish",
  "POST /api/report-cards/:cardId/archive",
  "GET /api/school-documents",
  "POST /api/school-documents",
  "PATCH /api/school-documents/:documentId",
  "POST /api/school-documents/:documentId/archive",
  "PUT /api/backoffice/report-cards",
  "GET /api/backoffice/report-cards",
  "PUT /api/backoffice/establishment-documents",
  "GET /api/backoffice/establishment-documents",
  "GET /api/data-export",
  "GET /api/v2/exams",
  "GET /api/exams",
  "GET /api/exams/:examId",
  "POST /api/exams",
  "PATCH /api/exams/:examId",
  "POST /api/exams/:examId/validate",
  "POST /api/exams/:examId/cancel",
  "POST /api/exams/:examId/archive",
  "PUT /api/backoffice/planning-exams",
  "GET /api/backoffice/planning-exams",
  "GET /api/v2/reports/advanced",
  "POST /api/mobile/push-devices/test",
  "GET /api/audit",
]);

const FORBIDDEN_ROUTE_SET = new Set(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM);

/**
 * Fonctions plateforme légitimes : pays, métadonnées établissement,
 * comptes admin établissement, abonnements, référentiels, paramètres globaux.
 * Liste de contrôle (non exhaustive) — le deny ne s'applique qu'à FORBIDDEN.
 */
const PLATFORM_ADMIN_ALLOWED = Object.freeze([
  "GET /api/backoffice/countries",
  "POST /api/backoffice/countries",
  "PATCH /api/backoffice/countries/:code",
  "GET /api/backoffice/establishments",
  "GET /api/backoffice/establishments/:code",
  "POST /api/backoffice/establishments",
  "PATCH /api/backoffice/establishments/:code",
  "DELETE /api/backoffice/establishments/:code",
  "POST /api/backoffice/establishments/import",
  "GET /api/backoffice/users",
  "POST /api/backoffice/users",
  "POST /api/backoffice/users/provision",
  "PATCH /api/backoffice/users/:userId",
  "POST /api/backoffice/users/:userId/reassign-school",
  "POST /api/backoffice/users/:userId/roles/grant",
  "POST /api/backoffice/users/:userId/roles/revoke",
  "GET /api/backoffice/users/assignable-roles",
  "POST /api/users/:id/reset-password",
  "GET /api/backoffice/subscriptions",
  "POST /api/backoffice/subscriptions",
  "PATCH /api/backoffice/subscriptions/:subscriptionId",
  "GET /api/backoffice/subscription-access",
  "POST /api/backoffice/subscription-offers",
  "PATCH /api/backoffice/subscription-offers/:offerId",
  "POST /api/backoffice/subscription-payments",
  "PATCH /api/backoffice/subscription-payments/:paymentId",
  "POST /api/backoffice/subscription-discounts",
  "PATCH /api/backoffice/subscription-discounts/:discountId",
  "GET /api/backoffice/role-permissions",
  "PUT /api/backoffice/role-permissions",
  "GET /api/backoffice/rbac/catalog",
  "GET /api/backoffice/rbac/permissions",
  "GET /api/backoffice/rbac/permissions/effective",
  "PATCH /api/backoffice/rbac/permissions",
  "POST /api/backoffice/rbac/roles",
  "PATCH /api/backoffice/rbac/roles/:roleId",
  "POST /api/backoffice/rbac/roles/:roleId/archive",
  "GET /api/backoffice/dashboard-chart-config",
  "PUT /api/backoffice/dashboard-chart-config",
  "GET /api/backoffice/notifications",
  "POST /api/backoffice/notifications",
  "PATCH /api/backoffice/notifications/:notificationId",
  "GET /api/backoffice/platform-announcements",
  "GET /api/backoffice/platform-announcements/unread-count",
  "GET /api/backoffice/platform-announcements/:announcementId",
  "POST /api/backoffice/platform-announcements",
  "POST /api/backoffice/platform-announcements/attachments",
  "GET /api/backoffice/platform-announcements/attachments/:attachmentId",
  "PATCH /api/backoffice/platform-announcements/:announcementId/read",
  "POST /api/backoffice/platform-announcements/:announcementId/archive",
  "GET /api/backoffice/education-levels",
  "POST /api/backoffice/education-levels",
  "PATCH /api/backoffice/education-levels/:levelId",
  "POST /api/backoffice/education-levels/:levelId/archive",
  "GET /api/backoffice/education-streams",
  "POST /api/backoffice/education-streams",
  "PATCH /api/backoffice/education-streams/:streamId",
  "POST /api/backoffice/education-streams/:streamId/archive",
  "GET /api/backoffice/education-class-groups",
  "POST /api/backoffice/education-class-groups",
  "PATCH /api/backoffice/education-class-groups/:groupId",
  "POST /api/backoffice/education-class-groups/:groupId/archive",
  "PATCH /api/backoffice/education-reference/labels",
  "GET /api/education-reference/catalog",
  "PUT /api/education-reference/school-activation",
  "GET /api/academic-config",
  "PUT /api/academic-config",
  "GET /api/school-settings",
  "PATCH /api/school-settings",
  "GET /api/classes",
  "POST /api/classes",
  "PATCH /api/classes/:classCode",
  "GET /api/mobile-sync/l1/classes",
]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function roleKeySet(principal) {
  const keys = new Set();
  const listed = Array.isArray(principal?.roleKeys) ? principal.roleKeys : [];
  for (const key of listed) {
    const normalized = asTrimmed(key).toUpperCase();
    if (normalized) keys.add(normalized);
  }
  return keys;
}

function isSuperAdminPrincipal(principal) {
  const label = asTrimmed(principal?.role);
  if (SUPER_ADMIN_ROLE_LABELS.includes(label)) return true;
  return roleKeySet(principal).has("SUPER_ADMIN");
}

function isCountryAdminPrincipal(principal) {
  const label = asTrimmed(principal?.role);
  if (COUNTRY_ADMIN_ROLE_LABELS.includes(label)) return true;
  return roleKeySet(principal).has("COUNTRY_ADMIN");
}

function isPlatformAdminPrincipal(principal) {
  return isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal);
}

function isSchoolPersonalDataRoute(routeKey) {
  return FORBIDDEN_ROUTE_SET.has(String(routeKey ?? ""));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routePathToRegExp(routePath) {
  const pattern = String(routePath)
    .split("/")
    .map((segment) => (segment.startsWith(":") && segment.length > 1 ? "[^/]+" : escapeRegExp(segment)))
    .join("/");
  return new RegExp(`^${pattern}$`);
}

const FORBIDDEN_HTTP_MATCHERS = Object.freeze(
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.map((routeKey) => {
    const space = routeKey.indexOf(" ");
    const method = space === -1 ? "" : routeKey.slice(0, space).toUpperCase();
    const routePath = space === -1 ? routeKey : routeKey.slice(space + 1);
    return Object.freeze({
      routeKey,
      method,
      regex: routePathToRegExp(routePath),
    });
  }),
);

function normalizeRequestPathname(pathname) {
  const raw = String(pathname ?? "").split("?")[0];
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      return new URL(raw).pathname;
    } catch {
      return raw;
    }
  }
  return raw;
}

function matchForbiddenPersonalDataRouteKey(method, pathname) {
  const verb = asTrimmed(method).toUpperCase() || "GET";
  const path = normalizeRequestPathname(pathname);
  if (!path) return "";
  for (const matcher of FORBIDDEN_HTTP_MATCHERS) {
    if (matcher.method === verb && matcher.regex.test(path)) {
      return matcher.routeKey;
    }
  }
  return "";
}

function isPlatformPersonalDataForbidden(principal, routeKey) {
  if (!isPlatformAdminPrincipal(principal)) return false;
  return isSchoolPersonalDataRoute(routeKey);
}

/**
 * Deny HTTP avant le scope établissement (header schoolCode).
 * Un schoolCode invalide/valide ne doit jamais masquer le 403 plateforme
 * derrière un 400 SCHOOL_SCOPE_*.
 */
function isPlatformPersonalDataForbiddenHttp(principal, method, pathname) {
  if (!isPlatformAdminPrincipal(principal)) return false;
  return Boolean(matchForbiddenPersonalDataRouteKey(method, pathname));
}

function isPersonalDataPermissionToken(token) {
  const value = asTrimmed(token);
  if (!value) return false;
  if (PERSONAL_DATA_ALIAS_TOKENS.includes(value)) return true;
  return PERSONAL_DATA_FEATURE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function stripPersonalDataPermissions(tokens = []) {
  return (Array.isArray(tokens) ? tokens : []).filter((token) => !isPersonalDataPermissionToken(token));
}

function unclassifiedRouteKeys(routePermissions = {}) {
  const keys = Object.keys(routePermissions);
  const forbiddenUnknown = SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.filter((key) => !keys.includes(key));
  return { missingFromCatalog: forbiddenUnknown };
}

module.exports = {
  PLATFORM_PERSONAL_DATA_DENY,
  SUPER_ADMIN_ROLE_LABELS,
  COUNTRY_ADMIN_ROLE_LABELS,
  PLATFORM_ADMIN_ROLE_KEYS,
  PERSONAL_DATA_MODULE_KEYS,
  PERSONAL_DATA_FEATURE_NAMES,
  PERSONAL_DATA_ALIAS_TOKENS,
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  PLATFORM_ADMIN_ALLOWED,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
  isPlatformAdminPrincipal,
  isSchoolPersonalDataRoute,
  isPlatformPersonalDataForbidden,
  isPlatformPersonalDataForbiddenHttp,
  matchForbiddenPersonalDataRouteKey,
  isPersonalDataPermissionToken,
  stripPersonalDataPermissions,
  unclassifiedRouteKeys,
};
