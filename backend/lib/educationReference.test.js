"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  EDUCATION_REFERENCE_ERROR,
  assertNoLegacyAcademicLevelsTracksWrite,
  stripLegacyAcademicLevelsTracks,
  normalizeCode,
} = require("./educationReferenceManagement");

test("assertNoLegacyAcademicLevelsTracksWrite rejette levels y compris null/[]", () => {
  for (const payload of [{ levels: ["1ère"] }, { levels: [] }, { levels: null }, { tracks: ["Générale"] }, { tracks: {} }]) {
    assert.throws(() => assertNoLegacyAcademicLevelsTracksWrite(payload), (error) => {
      assert.ok(error.statusCode === 400);
      assert.ok(
        error.code === EDUCATION_REFERENCE_ERROR.LEGACY_ACADEMIC_LEVELS_WRITE_FORBIDDEN ||
          error.code === EDUCATION_REFERENCE_ERROR.LEGACY_ACADEMIC_STREAMS_WRITE_FORBIDDEN,
      );
      return true;
    });
  }
});

test("stripLegacyAcademicLevelsTracks retire les clés interdites", () => {
  const next = stripLegacyAcademicLevelsTracks({ levels: ["x"], tracks: ["y"], periods: [] });
  assert.deepEqual(next, { periods: [] });
});

test("normalizeCode produit un code stable", () => {
  assert.equal(normalizeCode("1ère Année"), "1ere_annee");
});

const {
  assertEducationReferenceCatalogWrite,
  resolveCatalogWriteCountryCode,
} = require("./educationReferenceManagement");

test("COUNTRY_ADMIN sans CREATE ne peut pas écrire le catalogue", () => {
  assert.throws(
    () =>
      assertEducationReferenceCatalogWrite(
        { role: "Admin Pays", countryCode: "CD", permissions: ["COUNTRY_PRIVILEGES"] },
        "CD",
        "create",
      ),
    (error) => error.statusCode === 403 && error.code === EDUCATION_REFERENCE_ERROR.FORBIDDEN,
  );
});

test("COUNTRY_ADMIN avec CREATE écrit son pays uniquement", () => {
  const principal = {
    role: "Admin Pays",
    countryCode: "BI",
    permissions: ["Référentiels pédagogiques:CREATE"],
  };
  assertEducationReferenceCatalogWrite(principal, "BI", "create");
  assert.throws(
    () => assertEducationReferenceCatalogWrite(principal, "CD", "create"),
    (error) => error.statusCode === 403 && error.code === EDUCATION_REFERENCE_ERROR.COUNTRY_MISMATCH,
  );
});

test("Admin School ne peut pas écrire le catalogue national", () => {
  assert.throws(
    () =>
      assertEducationReferenceCatalogWrite(
        { role: "Admin School", permissions: ["Référentiels pédagogiques:CREATE", "Classes:CREATE"] },
        "CD",
        "create",
      ),
    (error) => error.statusCode === 403 && error.code === EDUCATION_REFERENCE_ERROR.FORBIDDEN,
  );
});

test("Superadmin n'a pas de pays par défaut CD", () => {
  assert.equal(
    resolveCatalogWriteCountryCode({}, { role: "Super Administrateur Somafrik" }),
    "",
  );
});
