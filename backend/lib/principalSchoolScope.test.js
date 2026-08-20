"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolvePrincipalSchoolCode,
  stripClientSchoolCode,
  scopeResidualItems,
} = require("./principalSchoolScope");
const { BusinessError } = require("../services/authService");

test("scopeResidualItems force le schoolCode du principal", () => {
  const scoped = scopeResidualItems("CD-IN-26-001", [{ id: "EX-1", title: "Devoir" }]);
  assert.deepEqual(scoped, [{ id: "EX-1", title: "Devoir", schoolCode: "CD-IN-26-001" }]);
});

test("scopeResidualItems rejette un schoolCode imbriqué étranger", () => {
  assert.throws(
    () =>
      scopeResidualItems("CD-IN-26-001", [
        { id: "EX-FOREIGN", schoolCode: "BI-EC-26-001", title: "Inject" },
      ]),
    (error) => error instanceof BusinessError && error.statusCode === 400,
  );
});

test("stripClientSchoolCode retire le schoolCode racine", () => {
  assert.deepEqual(stripClientSchoolCode({ schoolCode: "BI-EC-26-001", periodMode: "trimestre" }), {
    periodMode: "trimestre",
  });
});

test("resolvePrincipalSchoolCode refuse le périmètre global", () => {
  assert.throws(
    () => resolvePrincipalSchoolCode({ schoolCode: "*" }),
    (error) => error instanceof BusinessError && error.statusCode === 400,
  );
});

const {
  SCHOOL_SCOPE_HEADER,
  resolveEffectiveSchoolScope,
  applyEffectiveSchoolScope,
  canonicalSchoolCodeFromRecord,
} = require("./principalSchoolScope");

const nuru = {
  id: "school-nuru",
  code: "SCH-ABC123",
  school_code: "SCH-ABC123",
  loginCode: "CD-IN-26-001",
  login_code: "CD-IN-26-001",
  publicId: "CD-IN-26-001",
  name: "Institut Nuru",
  country: "RDC",
  countryCode: "CD",
};

const bujumbura = {
  id: "school-bi",
  code: "SCH-BI001",
  school_code: "SCH-BI001",
  loginCode: "BI-EC-26-001",
  login_code: "BI-EC-26-001",
  publicId: "BI-EC-26-001",
  name: "École Centrale",
  country: "Burundi",
  countryCode: "BI",
};

test("canonicalSchoolCodeFromRecord expose le login_code V2, jamais SCH-*", () => {
  assert.equal(canonicalSchoolCodeFromRecord(nuru), "CD-IN-26-001");
  assert.notEqual(canonicalSchoolCodeFromRecord(nuru), "SCH-ABC123");
});

test("Superadmin + CD-IN-26-001 scope students/teachers vers Nuru", () => {
  const principal = resolveEffectiveSchoolScope({
    principal: { role: "Super Administrateur Somafrik", schoolCode: "*", sub: "super-1" },
    requestedSchoolCode: "CD-IN-26-001",
    school: nuru,
  });
  assert.equal(resolvePrincipalSchoolCode(principal), "SCH-ABC123");
  assert.equal(principal.effectiveSchoolCode, "CD-IN-26-001");
  assert.equal(principal.effectiveSchoolInternalCode, "SCH-ABC123");
  assert.equal(principal.effectiveSchoolId, "school-nuru");
  assert.equal(principal.schoolScopeSource, "request");
  assert.equal(principal.sub, "super-1");
  assert.equal(principal.role, "Super Administrateur Somafrik");
});

test("Superadmin sans sélection conserve * (GET students → 400)", () => {
  const principal = resolveEffectiveSchoolScope({
    principal: { role: "Super Administrateur Somafrik", schoolCode: "*" },
    requestedSchoolCode: "",
    school: null,
  });
  assert.equal(principal.schoolCode, "*");
  assert.equal(principal.effectiveSchoolCode, undefined);
  assert.throws(
    () => resolvePrincipalSchoolCode(principal),
    (error) => error instanceof BusinessError && error.statusCode === 400,
  );
});

test("Admin Pays CD + école CD autorisé", () => {
  const principal = resolveEffectiveSchoolScope({
    principal: { role: "Admin Pays", schoolCode: "*", countryCode: "CD", countryScope: "RDC" },
    requestedSchoolCode: "CD-IN-26-001",
    school: nuru,
  });
  assert.equal(resolvePrincipalSchoolCode(principal), "SCH-ABC123");
  assert.equal(principal.effectiveSchoolCode, "CD-IN-26-001");
  assert.equal(principal.effectiveSchoolInternalCode, "SCH-ABC123");
});

test("Admin Pays CD + école BI → 403", () => {
  assert.throws(
    () =>
      resolveEffectiveSchoolScope({
        principal: { role: "Admin Pays", schoolCode: "*", countryCode: "CD", countryScope: "RDC" },
        requestedSchoolCode: "BI-EC-26-001",
        school: bujumbura,
      }),
    (error) =>
      error instanceof BusinessError && error.statusCode === 403 && error.code === "SCHOOL_SCOPE_COUNTRY_FORBIDDEN",
  );
});

test("Admin School ne peut pas override son école", () => {
  assert.throws(
    () =>
      resolveEffectiveSchoolScope({
        principal: { role: "Admin School", schoolCode: "SCH-ABC123" },
        requestedSchoolCode: "BI-EC-26-001",
        school: bujumbura,
      }),
    (error) =>
      error instanceof BusinessError &&
      error.statusCode === 403 &&
      error.code === "SCHOOL_SCOPE_OVERRIDE_FORBIDDEN",
  );
});

test("Admin School + login_code V2 de son école est accepté sans casser la clé repository", () => {
  const principal = resolveEffectiveSchoolScope({
    principal: { role: "Admin School", schoolCode: "SCH-ABC123" },
    requestedSchoolCode: "CD-IN-26-001",
    school: nuru,
  });
  assert.equal(principal.schoolCode, "SCH-ABC123");
  assert.equal(principal.effectiveSchoolCode, "CD-IN-26-001");
  assert.equal(principal.effectiveSchoolInternalCode, "SCH-ABC123");
});

test("SCH-* envoyé par le client est refusé", () => {
  assert.throws(
    () =>
      resolveEffectiveSchoolScope({
        principal: { role: "Super Administrateur Somafrik", schoolCode: "*" },
        requestedSchoolCode: "SCH-ABC123",
        school: nuru,
      }),
    (error) =>
      error instanceof BusinessError &&
      error.statusCode === 400 &&
      error.code === "SCHOOL_SCOPE_INTERNAL_ALIAS_FORBIDDEN",
  );
});

test("code client non V2 est refusé avant autorité tenant", () => {
  assert.throws(
    () =>
      resolveEffectiveSchoolScope({
        principal: { role: "Super Administrateur Somafrik", schoolCode: "*" },
        requestedSchoolCode: "NURU",
        school: null,
      }),
    (error) =>
      error instanceof BusinessError &&
      error.statusCode === 400 &&
      error.code === "SCHOOL_SCOPE_V2_REQUIRED",
  );
});

test("login_code V2 inconnu → 404", () => {
  assert.throws(
    () =>
      resolveEffectiveSchoolScope({
        principal: { role: "Super Administrateur Somafrik", schoolCode: "*" },
        requestedSchoolCode: "CD-IN-26-999",
        school: null,
      }),
    (error) => error instanceof BusinessError && error.statusCode === 404,
  );
});

test("applyEffectiveSchoolScope lit X-Somafrik-School-Code et résout le principal", async () => {
  const req = {
    principal: { role: "Super Administrateur Somafrik", schoolCode: "*" },
    get: (name) => (String(name).toLowerCase() === "x-somafrik-school-code" ? "CD-IN-26-001" : ""),
    headers: { "x-somafrik-school-code": "CD-IN-26-001" },
  };
  const lookup = async (code) => {
    assert.equal(code, "CD-IN-26-001");
    return nuru;
  };
  await applyEffectiveSchoolScope(req, lookup);
  assert.equal(req.principal.schoolCode, "SCH-ABC123");
  assert.equal(req.principal.effectiveSchoolCode, "CD-IN-26-001");
  assert.equal(req.principal.effectiveSchoolInternalCode, "SCH-ABC123");
  assert.equal(SCHOOL_SCOPE_HEADER, "X-Somafrik-School-Code");
});
