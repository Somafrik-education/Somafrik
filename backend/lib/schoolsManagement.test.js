"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeSchoolCode,
  normalizeCountryIso,
  findCanonicalCountry,
  toSchoolDbStatus,
  fromSchoolDbStatus,
  extractProfilePayload,
  mapEstablishmentRow,
  COUNTRY_NOT_FOUND_CODE,
} = require("./schoolsManagement");

test("normalise le code établissement en majuscules", () => {
  assert.equal(normalizeSchoolCode(" cd-2026-0001 "), "CD-2026-0001");
});

test("normalise l’ISO pays (RDC → CD) sans inventer un pays vide", () => {
  assert.equal(normalizeCountryIso("RDC"), "CD");
  assert.equal(normalizeCountryIso("BI"), "BI");
  assert.equal(normalizeCountryIso("", "RDC"), "CD");
  assert.equal(normalizeCountryIso(""), "");
  assert.equal(normalizeCountryIso("FR"), "FR");
});

test("findCanonicalCountry refuse un pays absent du référentiel (ex. FR)", () => {
  const catalog = [
    { id: "COUNTRY-RDC", name: "République Démocratique du Congo", code: "CD" },
    { id: "COUNTRY-BI", name: "Burundi", code: "BI" },
  ];
  assert.equal(findCanonicalCountry(catalog, "CD", "RDC")?.code, "CD");
  assert.equal(findCanonicalCountry(catalog, "FR", "France"), null);
  assert.equal(findCanonicalCountry(catalog, "", "France"), null);
  assert.equal(COUNTRY_NOT_FOUND_CODE, "COUNTRY_NOT_FOUND");
});

test("mappe les statuts BO ↔ PG", () => {
  assert.equal(toSchoolDbStatus("Actif"), "active");
  assert.equal(toSchoolDbStatus("En attente"), "pending");
  assert.equal(toSchoolDbStatus("Suspendu"), "suspended");
  assert.equal(toSchoolDbStatus("Supprimé"), "inactive");
  assert.equal(fromSchoolDbStatus("pending"), "En attente");
  assert.equal(fromSchoolDbStatus("suspended"), "Suspendu");
});

test("extrait le profil JSONB sans colonnes canoniques redondantes perdues", () => {
  const profile = extractProfilePayload({
    code: "CD-2026-0099",
    name: "Lycée Test",
    principalName: "Awa Kabila",
    validationStatus: "Validé",
    status: "Actif",
  });
  assert.equal(profile.principalName, "Awa Kabila");
  assert.equal(profile.validationStatus, "Validé");
  assert.equal(profile.status, "Actif");
  assert.equal(Object.prototype.hasOwnProperty.call(profile, "code"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(profile, "name"), false);
});

test("mapEstablishmentRow privilégie profile_payload pour le statut BO", () => {
  const mapped = mapEstablishmentRow({
    id: "uuid-1",
    country_id: "uuid-c",
    school_code: "CD-2026-0099",
    name: "Lycée Test",
    school_type: "Lycée",
    city: "Kinshasa",
    address: "1 av. Test",
    phone: "+243990000111",
    email: "contact@test.cd",
    logo_url: "",
    status: "pending",
    iso_code: "CD",
    country_name: "République Démocratique du Congo",
    country_currency: "CDF",
    profile_payload: {
      principalName: "Awa Kabila",
      status: "En attente",
      validationStatus: "En attente de validation",
      country: "RDC",
    },
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
  });
  assert.equal(mapped.code, "CD-2026-0099");
  assert.equal(mapped.legacySchoolCode, "CD-2026-0099");
  assert.equal(mapped.status, "En attente");
  assert.equal(mapped.principalName, "Awa Kabila");
  assert.equal(mapped.country, "RDC");
  assert.equal(mapped.countryCode, "CD");
  assert.equal(mapped.validationStatus, "En attente de validation");
});

test("mapEstablishmentRow émet login_code V2 comme code public", () => {
  const mapped = mapEstablishmentRow({
    id: "uuid-1",
    school_code: "CD-2026-0001",
    login_code: "CD-IN-26-001",
    name: "Institut Nuru",
    status: "active",
    iso_code: "CD",
    country_name: "République Démocratique du Congo",
    profile_payload: {},
  });
  assert.equal(mapped.code, "CD-IN-26-001");
  assert.equal(mapped.loginCode, "CD-IN-26-001");
  assert.equal(mapped.publicId, "CD-IN-26-001");
  assert.equal(mapped.legacySchoolCode, "CD-2026-0001");
});
