/**
 * S1.4 — Entités backoffice modifiables via PUT /api/backoffice/state, par rôle.
 *
 * Source : securityMatrix (CRUD) + permissions seed, sans élargir les droits.
 * Le scoping tenant (mergeScopedBackOfficeState) reste orthogonal à cette matrice.
 *
 * Fail-closed : principal absent ⇒ aucun droit.
 * auditLog n'est jamais modifiable côté client (enrichi uniquement par le serveur).
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
  "exams",
  "bulletins",
  "documents",
  "announcements",
  "messages",
  "notifications",
  "rolePermissions",
  "academicConfigs",
  "dashboardChartConfig",
]);

/**
 * Secrétaire — modules CRUD securityMatrix :
 * Élèves, Présences, Paiements, Notifications, Messages, Documents.
 * (Utilisateurs/Contacts/Notes/Frais = lecture seule ou « - »)
 */
const SECRETARY_WRITABLE_ENTITIES = Object.freeze([
  "notifications",
  "announcements",
  "messages",
  "documents",
]);

/**
 * Comptable — plus d'écriture Finance via PUT state (LOT 4 : APIs dédiées).
 */
const ACCOUNTANT_WRITABLE_ENTITIES = Object.freeze([]);

/**
 * Préfet / Proviseur / Directeur adjoint — pédagogie (matrix Préfet CRUD).
 */
const PREFET_WRITABLE_ENTITIES = Object.freeze([
  "exams",
  "bulletins",
  "documents",
  "announcements",
  "messages",
  "notifications",
  "academicConfigs",
]);

/**
 * Directeur — seed : Gérer utilisateurs, Modifier notes, Gérer paiements + socle préfet.
 */
const DIRECTOR_WRITABLE_ENTITIES = Object.freeze([
  ...new Set([...PREFET_WRITABLE_ENTITIES, "users", "contacts", "relations"]),
]);

const COUNTRY_ADMIN_WRITABLE_ENTITIES = Object.freeze([
  "users",
  "countries",
  "contacts",
  "relations",
  "subscriptions",
  "notifications",
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
 * Fail-closed : principal absent ⇒ [].
 * @param {{ role?: string } | null | undefined} principal
 * @param {string[]} [allEntities] entités connues (superadmin)
 * @returns {string[]}
 */
function getWritableBackOfficeEntitiesForPrincipal(principal, allEntities = []) {
  if (!principal) {
    return [];
  }

  const role = principal.role ?? "";

  if (isSuperAdminRole(role)) {
    // auditLog volontairement exclu : journal serveur uniquement.
    // Entités canoniques volontairement exclues : APIs PostgreSQL dédiées
    // (LOT 1 établissements, LOT 2 élèves, LOT 3 enseignants/affectations).
    return [
      ...allEntities.filter(
        (entity) =>
          entity !== "auditLog" &&
          entity !== "schools" &&
          entity !== "students" &&
          entity !== "teachers" &&
          entity !== "assignments" &&
          entity !== "payments" &&
          entity !== "paymentStatuses" &&
          entity !== "feeGrids" &&
          entity !== "schoolFeeItems" &&
          entity !== "studentFees" &&
          entity !== "feeTariffHistory" &&
          entity !== "paymentReminders" &&
          entity !== "courses" &&
          entity !== "courseSchedules" &&
          entity !== "evaluations" &&
          entity !== "notes" &&
          entity !== "presences",
      ),
      "rolePermissions",
      "academicConfigs",
      "dashboardChartConfig",
    ];
  }

  const mapped = ROLE_WRITABLE_ENTITIES[role];
  if (mapped) {
    return [...mapped];
  }

  // Rôle backoffice établissement inconnu : aucun droit d'écriture.
  if (isEstablishmentBackOfficeRole(role)) {
    return [];
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
  if (!principal) {
    return { ok: false, forbidden: [...touchedKeys, "(principal absent)"] };
  }

  const allowed = new Set(getWritableBackOfficeEntitiesForPrincipal(principal, allEntities));
  const forbidden = touchedKeys.filter((key) => !allowed.has(key));
  if (forbidden.length) {
    return { ok: false, forbidden };
  }
  return { ok: true };
}

/**
 * Entités « métier » éditables (hors clés optionnelles de config) — used pour le scope de suppression.
 * Fail-closed : principal absent ⇒ [].
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
  if (!principal) {
    return [];
  }

  const role = principal.role ?? "";

  if (isSuperAdminRole(role)) {
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
