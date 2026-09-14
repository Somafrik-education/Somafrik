"use strict";

/**
 * Matrice de qualification Démo — DEMO-0.
 * Aucun formulaire UI dans ce lot.
 */

const PROFILES = Object.freeze([
  Object.freeze({ id: "direction_promoteur", label: "Direction / Promoteur" }),
  Object.freeze({ id: "administration_scolaire", label: "Administration scolaire" }),
  Object.freeze({ id: "enseignant", label: "Enseignant" }),
  Object.freeze({ id: "personnel", label: "Personnel" }),
  Object.freeze({ id: "parent", label: "Parent" }),
  Object.freeze({ id: "partenaire_ong", label: "Partenaire/ONG" }),
  Object.freeze({ id: "investisseur", label: "Investisseur" }),
  Object.freeze({ id: "etudiant_chercheur", label: "Étudiant/Chercheur" }),
  Object.freeze({ id: "autre", label: "Autre" }),
]);

const DISCOVERY_ROLES = Object.freeze([
  Object.freeze({ id: "decide", label: "Je décide" }),
  Object.freeze({ id: "participate", label: "Je participe au choix" }),
  Object.freeze({ id: "will_use", label: "Je serai utilisateur" }),
  Object.freeze({ id: "recommend", label: "Je recommande des solutions" }),
  Object.freeze({ id: "browse", label: "Je découvre simplement" }),
]);

const DISCOVERY_PROMPT = "Quel est votre rôle dans la découverte de Somafrik ?";

const FIELDS = Object.freeze({
  profile: Object.freeze({ required: true, source: "PROFILES" }),
  discoveryRole: Object.freeze({ required: true, source: "DISCOVERY_ROLES" }),
  country: Object.freeze({
    required: true,
    format: "ISO-3166-1-alpha-2",
    limitedToFrancophoneAfricaTrialList: false,
  }),
  organizationName: Object.freeze({ required: false }),
  phone: Object.freeze({ required: false, mustNotBeRequired: true }),
  email: Object.freeze({ required: false, mustNotBeRequired: true }),
});

const REQUIRED_FIELD_IDS = Object.freeze(
  Object.keys(FIELDS).filter((id) => FIELDS[id].required),
);

const FORBIDDEN_REQUIRED_FIELD_IDS = Object.freeze(["phone", "email"]);

function isAllowedProfile(id) {
  return PROFILES.some((profile) => profile.id === id);
}

function isAllowedDiscoveryRole(id) {
  return DISCOVERY_ROLES.some((role) => role.id === id);
}

function isIso3166Alpha2(value) {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value);
}

/**
 * @param {{ profile?: string, discoveryRole?: string, country?: string, organizationName?: string, phone?: string, email?: string }} payload
 * @returns {string[]}
 */
function collectQualificationViolations(payload = {}) {
  const violations = [];
  if (!isAllowedProfile(payload.profile)) {
    violations.push("profile");
  }
  if (!isAllowedDiscoveryRole(payload.discoveryRole)) {
    violations.push("discoveryRole");
  }
  if (!isIso3166Alpha2(payload.country)) {
    violations.push("country");
  }
  return violations;
}

function isCompleteQualification(payload) {
  return collectQualificationViolations(payload).length === 0;
}

module.exports = {
  PROFILES,
  DISCOVERY_ROLES,
  DISCOVERY_PROMPT,
  FIELDS,
  REQUIRED_FIELD_IDS,
  FORBIDDEN_REQUIRED_FIELD_IDS,
  isAllowedProfile,
  isAllowedDiscoveryRole,
  isIso3166Alpha2,
  collectQualificationViolations,
  isCompleteQualification,
};
