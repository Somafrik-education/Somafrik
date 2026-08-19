"use strict";

/**
 * Catalogue canonique des modules fonctionnels réellement exposés (Web + Mobile + APIs).
 * Aucun module fantôme (ex. Bibliothèque MVP non livrée).
 * moduleName = préfixe des jetons RBAC `Module:ACTION`.
 */

const FUNCTIONAL_MODULES = Object.freeze([
  { moduleKey: "countries", moduleName: "Pays", appliesWeb: true, appliesMobile: true, displayOrder: 10 },
  { moduleKey: "schools", moduleName: "Établissements", appliesWeb: true, appliesMobile: true, displayOrder: 20 },
  { moduleKey: "subscriptions", moduleName: "Abonnements", appliesWeb: true, appliesMobile: false, displayOrder: 30 },
  { moduleKey: "contacts", moduleName: "Contacts", appliesWeb: true, appliesMobile: false, displayOrder: 40 },
  { moduleKey: "relations", moduleName: "Relations", appliesWeb: true, appliesMobile: false, displayOrder: 50 },
  { moduleKey: "users", moduleName: "Utilisateurs", appliesWeb: true, appliesMobile: true, displayOrder: 60 },
  { moduleKey: "role_permissions", moduleName: "Droits par rôle", appliesWeb: true, appliesMobile: true, displayOrder: 70 },
  { moduleKey: "education_reference", moduleName: "Référentiels pédagogiques", appliesWeb: true, appliesMobile: false, displayOrder: 80 },
  { moduleKey: "classes", moduleName: "Classes", appliesWeb: true, appliesMobile: true, displayOrder: 90 },
  { moduleKey: "students", moduleName: "Élèves", appliesWeb: true, appliesMobile: true, displayOrder: 100 },
  { moduleKey: "teachers", moduleName: "Enseignants", appliesWeb: true, appliesMobile: true, displayOrder: 110 },
  { moduleKey: "assignments", moduleName: "Affectations", appliesWeb: true, appliesMobile: true, displayOrder: 120 },
  { moduleKey: "attendance", moduleName: "Présences", appliesWeb: true, appliesMobile: true, displayOrder: 130 },
  { moduleKey: "grades", moduleName: "Notes", appliesWeb: true, appliesMobile: true, displayOrder: 140 },
  { moduleKey: "report_cards", moduleName: "Bulletins", appliesWeb: true, appliesMobile: true, displayOrder: 150 },
  { moduleKey: "payments", moduleName: "Paiements", appliesWeb: true, appliesMobile: true, displayOrder: 160 },
  { moduleKey: "fees", moduleName: "Frais & tarifs", appliesWeb: true, appliesMobile: false, displayOrder: 170 },
  { moduleKey: "unpaid", moduleName: "Impayés", appliesWeb: true, appliesMobile: false, displayOrder: 180 },
  { moduleKey: "notifications", moduleName: "Notifications", appliesWeb: true, appliesMobile: true, displayOrder: 190 },
  { moduleKey: "messages", moduleName: "Messages", appliesWeb: true, appliesMobile: true, displayOrder: 200 },
  { moduleKey: "documents", moduleName: "Documents", appliesWeb: true, appliesMobile: true, displayOrder: 210 },
  { moduleKey: "reports", moduleName: "Rapports", appliesWeb: true, appliesMobile: true, displayOrder: 220 },
  { moduleKey: "school_settings", moduleName: "Paramètres Établissement", appliesWeb: true, appliesMobile: true, displayOrder: 230 },
  { moduleKey: "academic_years", moduleName: "Années Académiques", appliesWeb: true, appliesMobile: true, displayOrder: 240 },
  { moduleKey: "subjects", moduleName: "Matières", appliesWeb: true, appliesMobile: true, displayOrder: 250 },
  { moduleKey: "exams", moduleName: "Examens", appliesWeb: true, appliesMobile: true, displayOrder: 260 },
  { moduleKey: "planning", moduleName: "Planning de cours", appliesWeb: true, appliesMobile: false, displayOrder: 270 },
  { moduleKey: "rooms", moduleName: "Salles", appliesWeb: true, appliesMobile: false, displayOrder: 280 },
  { moduleKey: "replacements", moduleName: "Remplacements", appliesWeb: true, appliesMobile: false, displayOrder: 290 },
]);

const MODULE_BY_KEY = Object.freeze(Object.fromEntries(FUNCTIONAL_MODULES.map((row) => [row.moduleKey, row])));
const MODULE_BY_NAME = Object.freeze(Object.fromEntries(FUNCTIONAL_MODULES.map((row) => [row.moduleName, row])));

const CRUD_ACTIONS = Object.freeze(["CREATE", "READ", "UPDATE", "DELETE"]);

function listFunctionalModules() {
  return FUNCTIONAL_MODULES.map((row) => ({ ...row }));
}

function getModuleByKey(moduleKey) {
  return MODULE_BY_KEY[String(moduleKey ?? "").trim()] ?? null;
}

function getModuleByName(moduleName) {
  return MODULE_BY_NAME[String(moduleName ?? "").trim()] ?? null;
}

function isKnownModuleKey(moduleKey) {
  return Boolean(getModuleByKey(moduleKey));
}

module.exports = {
  FUNCTIONAL_MODULES,
  CRUD_ACTIONS,
  listFunctionalModules,
  getModuleByKey,
  getModuleByName,
  isKnownModuleKey,
};
