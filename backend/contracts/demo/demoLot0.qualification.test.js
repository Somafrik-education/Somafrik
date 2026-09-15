"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
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
} = require("./qualification");

test("neuf profils de découverte figés", () => {
  assert.equal(PROFILES.length, 9);
  assert.deepEqual(
    PROFILES.map((profile) => profile.id),
    [
      "direction_promoteur",
      "administration_scolaire",
      "enseignant",
      "personnel",
      "parent",
      "partenaire_ong",
      "investisseur",
      "etudiant_chercheur",
      "autre",
    ],
  );
  assert.equal(PROFILES[0].label, "Direction / Promoteur");
  assert.equal(PROFILES[5].label, "Partenaire/ONG");
  assert.equal(PROFILES[7].label, "Étudiant/Chercheur");
});

test("cinq rôles de découverte et libellé de question", () => {
  assert.equal(DISCOVERY_ROLES.length, 5);
  assert.equal(DISCOVERY_PROMPT, "Quel est votre rôle dans la découverte de Somafrik ?");
  assert.deepEqual(
    DISCOVERY_ROLES.map((role) => role.label),
    [
      "Je décide",
      "Je participe au choix",
      "Je serai utilisateur",
      "Je recommande des solutions",
      "Je découvre simplement",
    ],
  );
});

test("pays obligatoire, établissement facultatif, téléphone et e-mail non exigés", () => {
  assert.deepEqual([...REQUIRED_FIELD_IDS].sort(), ["country", "discoveryRole", "profile"]);
  assert.equal(FIELDS.organizationName.required, false);
  assert.equal(FIELDS.phone.mustNotBeRequired, true);
  assert.equal(FIELDS.email.mustNotBeRequired, true);
  assert.equal(FIELDS.country.limitedToFrancophoneAfricaTrialList, false);
  assert.equal(FIELDS.country.format, "ISO-3166-1-alpha-2");
  for (const id of FORBIDDEN_REQUIRED_FIELD_IDS) {
    assert.equal(FIELDS[id].required, false, id);
  }
});

test("une qualification complète n'exige ni téléphone ni e-mail", () => {
  const payload = {
    profile: "direction_promoteur",
    discoveryRole: "decide",
    country: "CD",
  };
  assert.equal(isCompleteQualification(payload), true);
  assert.deepEqual(collectQualificationViolations(payload), []);
  assert.equal(isCompleteQualification({ ...payload, organizationName: "École Nuru" }), true);
});

test("refuse les profils, rôles ou pays hors contrat", () => {
  assert.equal(isAllowedProfile("chef_etablissement"), false);
  assert.equal(isAllowedDiscoveryRole("acheteur"), false);
  assert.equal(isIso3166Alpha2("cd"), false);
  assert.equal(isIso3166Alpha2("RDC"), false);
  assert.equal(isIso3166Alpha2("CD"), true);
  assert.ok(collectQualificationViolations({}).includes("profile"));
  assert.ok(
    collectQualificationViolations({
      profile: "enseignant",
      discoveryRole: "browse",
      country: "France",
    }).includes("country"),
  );
});

test("le parcours essai 30 jours n'est pas un profil Demo", () => {
  for (const trialOnlyRole of ["Chef d'établissement", "Promoteur", "Directeur", "Administrateur"]) {
    assert.equal(isAllowedProfile(trialOnlyRole), false, trialOnlyRole);
  }
});
