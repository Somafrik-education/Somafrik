"use strict";

/**
 * P1-RC0-01 — Comptable doit pouvoir s'identifier et se connecter sur Mobile.
 * Web /backoffice/login accepte déjà ACCOUNTANT. L'UI Mobile a déjà accountant
 * (tabs, drawer, home). Seul managedMobileRoles omettait Comptable → identify 403.
 *
 *   node --test backend/lib/authComptableMobile.test.js
 */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { AuthService, BusinessError } = require("../services/authService");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");

function fixture() {
  const school = {
    id: "school-1",
    code: "SCH-TEST",
    loginCode: "CD-IN-26-001",
    publicId: "CD-IN-26-001",
    name: "Institut Nuru",
    city: "Kinshasa",
    country: "RDC",
    countryCode: "CD",
    status: "Actif",
    validationStatus: "Validé",
  };
  const accountant = {
    id: "USR-ACC-1",
    identifier: "comptable",
    email: "comptable@nuru.test",
    firstName: "Lina",
    lastName: "Mwamba",
    role: "Comptable",
    roleKeys: ["ACCOUNTANT"],
    schoolCode: school.code,
    accessChannel: "Application",
    status: "Actif",
    password: "1234",
    pin: "1234",
  };
  const secretary = {
    id: "USR-SEC-1",
    identifier: "secretaire",
    firstName: "Secret",
    lastName: "Aire",
    role: "Secrétaire",
    schoolCode: school.code,
    accessChannel: "Application",
    status: "Actif",
    password: "1234",
    pin: "1234",
  };
  return { school, accountant, secretary };
}

function createService() {
  attachMemoryLoginLockoutStore();
  const { school, accountant, secretary } = fixture();
  return new AuthService({
    school,
    schools: [school],
    teachers: [],
    students: [],
    userAccounts: [accountant, secretary],
    countries: [{ name: "RDC", code: "CD", status: "Actif" }],
    subscriptions: [],
  });
}

test("Comptable POST /identify Mobile → accountant (plus de 403)", () => {
  const service = createService();
  const identified = service.identify({
    schoolCode: "CD-IN-26-001",
    identifier: "comptable",
  });
  assert.equal(identified.role, "accountant");
  assert.equal(identified.roleLabel, "Comptable");
});

test("Comptable POST /login Mobile role=accountant → session", async () => {
  const service = createService();
  const session = await service.login({
    role: "accountant",
    schoolCode: "CD-IN-26-001",
    identifier: "comptable",
    pin: "1234",
  });
  assert.equal(session.role, "accountant");
  assert.equal(session.user.id, "USR-ACC-1");
  assert.equal(session.school.loginCode, "CD-IN-26-001");
});

test("Comptable ne devient pas school_admin ni teacher", async () => {
  const service = createService();
  await assert.rejects(
    () =>
      service.login({
        role: "school_admin",
        schoolCode: "CD-IN-26-001",
        identifier: "comptable",
        pin: "1234",
      }),
    (error) => error instanceof BusinessError && error.statusCode === 401,
  );
  await assert.rejects(
    () =>
      service.login({
        role: "teacher",
        schoolCode: "CD-IN-26-001",
        identifier: "comptable",
        pin: "1234",
      }),
    (error) => error instanceof BusinessError && error.statusCode === 401,
  );
});

test("Secrétaire reste autorisé (régression voisin)", () => {
  const service = createService();
  const identified = service.identify({
    schoolCode: "CD-IN-26-001",
    identifier: "secretaire",
  });
  assert.equal(identified.role, "secretary");
});
