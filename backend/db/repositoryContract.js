/**
 * Contrat de la couche d'accès aux données (sous la logique métier).
 *
 * Toute implémentation de dépôt (PostgreSQL, mémoire de secours, futurs moteurs)
 * doit exposer ces méthodes pour rester interchangeable derrière les services.
 * `assertRepositoryContract` est appelée au démarrage afin de détecter toute
 * dérive entre implémentations avant qu'une requête en production n'échoue.
 */

const REPOSITORY_METHODS = Object.freeze([
  // Cycle de vie / connexion
  "init",
  "close",
  // Lecture agrégée consommée par les services métier
  "getDataset",
  // Sessions & authentification
  "createSession",
  "findActiveSession",
  "revokeSession",
  // Audit
  "recordAudit",
  "getAuditLogs",
  // État BackOffice & configuration académique
  "getBackOfficeState",
  "saveBackOfficeState",
  "getAcademicConfig",
  "saveAcademicConfig",
  // Comptes utilisateurs
  "resetUserPassword",
  "changeUserPassword",
  // Saisies pédagogiques
  "upsertGrade",
  "upsertAttendanceBatch",
  // Référentiels V2
  "getSubjectsV2",
  "createSubject",
  "deleteSubject",
  "getAcademicYearsV2",
  "getExamsV2",
  "getDocumentsV2",
  "getAdvancedReportsV2",
  // Classes métier (CRUD établissement)
  "listSchoolClasses",
  "createSchoolClass",
  "updateSchoolClass",
  // Élèves métier (LOT 2 — PostgreSQL canonique)
  "listClassStudents",
  "listSchoolStudents",
  "enrollStudentInClass",
  "getSchoolStudentByCode",
  "updateSchoolStudentByCode",
  // Enseignants / affectations métier (LOT 3 — PostgreSQL canonique)
  "listSchoolTeacherAssignments",
  "createSchoolTeacherAssignment",
  "updateSchoolTeacherAssignment",
  "deleteSchoolTeacherAssignment",
  "listEstablishments",
  "persistEstablishment",
  // Finance métier (LOT 4 — PostgreSQL canonique)
  "listFinanceProjection",
  "createSchoolPayment",
  "getSchoolPayment",
  "cancelSchoolPayment",
  "listFinancePaymentStatuses",
  "upsertFinancePaymentStatus",
  "listFinanceFeeGrids",
  "getFinanceFeeGrid",
  "upsertFinanceFeeGrid",
  "setFinanceFeeGridStatus",
  "applyFinanceFeeGrid",
  "listFinanceStudentFees",
  "getFinanceStudentFee",
  "adjustFinanceStudentFee",
  "createFinanceReminder",
  // Pédagogie métier (LOT 5 — PostgreSQL canonique)
  "listPedagogyProjection",
  "createSchoolCourse",
  "updateSchoolCourse",
  "deleteSchoolCourse",
  "getSchoolCourse",
  "createCourseSchedule",
  "updateCourseSchedule",
  "deleteCourseSchedule",
  "getCourseSchedule",
  "createSchoolEvaluation",
  "updateSchoolEvaluation",
  "upsertSchoolGrade",
  "upsertSchoolAttendanceBatch",
  // Plateforme métier (LOT 6 — PostgreSQL canonique)
  "listPlatformProjection",
  "getPlatformSchoolByCode",
  "getRolePermissionsMap",
  "createPlatformCountry",
  "updatePlatformCountry",
  "upsertPlatformSubscription",
  "createPlatformNotification",
  "updatePlatformNotification",
  "replacePlatformRolePermissions",
  "savePlatformDashboardChartConfig",
  "upsertPlatformSubscriptionOffer",
  "createPlatformSubscriptionPayment",
  "updatePlatformSubscriptionPayment",
  "createPlatformSubscriptionDiscount",
  "updatePlatformSubscriptionDiscount",
]);

/**
 * Vérifie qu'une instance de dépôt satisfait le contrat attendu.
 * @param {object} repository Instance à valider.
 * @param {string} [label] Nom lisible pour les messages d'erreur.
 * @returns {object} Le dépôt validé (pour chaînage).
 */
function assertRepositoryContract(repository, label = "repository") {
  if (!repository || typeof repository !== "object") {
    throw new TypeError(`Contrat de dépôt invalide: ${label} n'est pas un objet.`);
  }

  const missing = REPOSITORY_METHODS.filter(
    (method) => typeof repository[method] !== "function"
  );

  if (missing.length) {
    throw new Error(
      `Le dépôt "${label}" ne respecte pas le contrat d'accès aux données. ` +
        `Méthodes manquantes: ${missing.join(", ")}.`
    );
  }

  return repository;
}

module.exports = { REPOSITORY_METHODS, assertRepositoryContract };
