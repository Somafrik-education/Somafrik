/**
 * S1.4 — Entités backoffice modifiables via PUT /api/backoffice/state, par rôle.
 *
 * Source : securityMatrix (CRUD) + permissions seed, sans élargir les droits.
 * Le scoping tenant (mergeScopedBackOfficeState) reste orthogonal à cette matrice.
 */

const {
  SUPER_ADMIN_ROLES,
  isEstablishmentBackOfficeRole,
} = require("./establishmentRoles");

/** Entités établissement historiquement accessibles à Admin School (liste actuelle). */
const ADMIN_SCHOOL_WRITABLE_ENTITIES = Object.freeze([
  "contacts",
  "relations",
  "users",
  "students",
  "teachers",
  "classes",
  "courses",
  "assignments",
  "courseSchedules",
  "payments",
  "paymentStatuses",
  "feeGrids",
  "schoolFeeItems",
  "studentFees",
  "feeTariffHistory",
  "presences",
  "notes",
  "evaluations",
  "exams",
  "bulletins",
  "documents",
  "announcements",
  "messages",
  "notifications",
  "rolePermissions",
  "academicConfigs",
  "dashboardChartConfig",
  "auditLog",
]);

/**
 * Secrétaire — modules CRUD securityMatrix :
 * Élèves, Présences, Paiements, Notifications, Messages, Documents.
 * (Utilisateurs/Contacts/Notes/Frais = lecture seule ou « - »)
 */
const SECRETARY_WRITABLE_ENTITIES = Object.freeze([
  "students",
  "presences",
  "payments",
  "paymentStatuses",
  "notifications",
  "announcements",
  "messages",
  "documents",
  "auditLog",
]);

/**
 * Comptable — seed « Gérer paiements » (+ suivi frais élèves opérationnels).
 * Pas de configuration tarifaire (feeGrids / schoolFeeItems / feeTariffHistory).
 */
const ACCOUNTANT_WRITABLE_ENTITIES = Object.freeze([
  "payments",
  "paymentStatuses",
  "studentFees",
  "auditLog",
]);

/**
 * Préfet / Proviseur / Directeur adjoint — pédagogie (matrix Préfet CRUD).
 */
const PREFET_WRITABLE_ENTITIES = Object.freeze([
  "students",
  "classes",
  "teachers",
  "courses",
  "assignments",
  "courseSchedules",
  "presences",
  "notes",
  "evaluations",
  "exams",
  "bulletins",
  "documents",
  "announcements",
  "messages",
  "notifications",
  "academicConfigs",
  "auditLog",
]);

/**
 * Directeur — seed : Gérer utilisateurs, Modifier notes, Gérer paiements + socle préfet.
 */
const DIRECTOR_WRITABLE_ENTITIES = Object.freeze([
  ...new Set([...PREFET_WRITABLE_ENTITIES, "users", "payments", "paymentStatuses", "contacts", "relations"]),
]);

const COUNTRY_ADMIN_WRITABLE_ENTITIES = Object.freeze([
  "schools",
  "users",
  "countries",
  "contacts",
  "relations",
  "subscriptions",
  "notifications",
  "auditLog",
]);

const ROLE_WRITABLE_ENTITIES = Object.freeze({
  "Admin School": ADMIN_SCHOOL_WRITABLE_ENTITIES,
  Secrétaire: SECRETARY_WRITABLE_ENTITIES,
  Sécretaire: SECRETARY_WRITABLE_ENTITIES,
  Comptable: ACCOUNTANT_WRITABLE_ENTITIES,
  "Préfet des études": PREFET_WRITABLE_ENTITIES,
  Proviseur: PREFET_WRITABLE_ENTITIES,
  "Directeur adjoint": PREFET_WRITABLE_ENTITIES,
  Directeur: DIRECTOR_WRITABLE_ENTITIES,
  "Admin Pays": COUNTRY_ADMIN_WRITABLE_ENTITIES,
});

function isSuperAdminRole(role) {
  return SUPER_ADMIN_ROLES.includes(role);
}

/**
 * Liste des clés d'état qu'un principal peut toucher sur PUT /api/backoffice/state.
 * @param {{ role?: string } | null | undefined} principal
 * @param {string[]} [allEntities] entités connues (superadmin)
 * @returns {string[]}
 */
function getWritableBackOfficeEntitiesForPrincipal(principal, allEntities = []) {
  const role = principal?.role ?? "";

  if (!principal || isSuperAdminRole(role)) {
    return [
      ...allEntities,
      "rolePermissions",
      "academicConfigs",
      "dashboardChartConfig",
      "auditLog",
    ];
  }

  const mapped = ROLE_WRITABLE_ENTITIES[role];
  if (mapped) {
    return [...mapped];
  }

  // Rôle backoffice établissement inconnu : aucun droit d'écriture élargi.
  if (isEstablishmentBackOfficeRole(role)) {
    return ["auditLog"];
  }

  return [];
}

/**
 * @param {{ role?: string } | null | undefined} principal
 * @param {string[]} touchedKeys
 * @param {string[]} [allEntities]
 * @returns {{ ok: true } | { ok: false, forbidden: string[] }}
 */
function evaluateBackOfficeWriteAccess(principal, touchedKeys = [], allEntities = []) {
  const allowed = new Set(getWritableBackOfficeEntitiesForPrincipal(principal, allEntities));
  const forbidden = touchedKeys.filter((key) => !allowed.has(key));
  if (forbidden.length) {
    return { ok: false, forbidden };
  }
  return { ok: true };
}

/**
 * Entités « métier » éditables (hors clés optionnelles de config) — utilisé pour le scope de suppression.
 * @param {{ role?: string } | null | undefined} principal
 * @param {string[]} deletableEntities
 * @param {string[]} [countryAdminEntities]
 * @returns {string[]}
 */
function getEditableEntitiesForPrincipalRole(
  principal,
  deletableEntities = [],
  countryAdminEntities = COUNTRY_ADMIN_WRITABLE_ENTITIES,
) {
  const role = principal?.role ?? "";

  if (!principal || isSuperAdminRole(role)) {
    return [...deletableEntities];
  }

  if (role === "Admin Pays") {
    return countryAdminEntities.filter((entity) => deletableEntities.includes(entity) || entity === "notifications");
  }

  const writable = getWritableBackOfficeEntitiesForPrincipal(principal, deletableEntities);
  return writable.filter((entity) => deletableEntities.includes(entity));
}

module.exports = {
  ADMIN_SCHOOL_WRITABLE_ENTITIES,
  SECRETARY_WRITABLE_ENTITIES,
  ACCOUNTANT_WRITABLE_ENTITIES,
  PREFET_WRITABLE_ENTITIES,
  DIRECTOR_WRITABLE_ENTITIES,
  COUNTRY_ADMIN_WRITABLE_ENTITIES,
  ROLE_WRITABLE_ENTITIES,
  getWritableBackOfficeEntitiesForPrincipal,
  evaluateBackOfficeWriteAccess,
  getEditableEntitiesForPrincipalRole,
};
