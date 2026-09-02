"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { AuthService, BusinessError } = require("../services/authService");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");

function platformFixture() {
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
  const superadmin = {
    id: "USER-SUPERADMIN",
    identifier: "superadmin",
    firstName: "Super",
    lastName: "Admin",
    role: "Super Administrateur Somafrik",
    schoolCode: "*",
    accessChannel: "Application",
    status: "Actif",
    password: "1234",
    pin: "1234",
  };
  const countryAdmin = {
    id: "USER-COUNTRY-RDC",
    identifier: "admin-rdc",
    firstName: "Admin",
    lastName: "RDC",
    role: "Admin Pays",
    schoolCode: "*",
    countryScope: "RDC",
    accessChannel: "Application",
    status: "Actif",
    password: "1234",
    pin: "1234",
  };
  const schoolAdmin = {
    id: "USR-ADMIN-1",
    identifier: "admin",
    firstName: "Admin",
    lastName: "Établissement",
    role: "Admin School",
    schoolCode: school.code,
    accessChannel: "Application",
    status: "Actif",
    password: "1234",
    pin: "1234",
  };
  return { school, superadmin, countryAdmin, schoolAdmin };
}

function createService() {
  attachMemoryLoginLockoutStore();
  const { school, superadmin, countryAdmin, schoolAdmin } = platformFixture();
  return new AuthService({
    school,
    schools: [school],
    teachers: [],
    students: [],
    userAccounts: [superadmin, countryAdmin, schoolAdmin],
    countries: [{ name: "RDC", code: "CD", status: "Actif" }],
    subscriptions: [],
  });
}

test("Superadmin se connecte sans schoolCode ni école fictive", async () => {
  const service = createService();
  const session = await service.login({
    role: "super_admin",
    identifier: "superadmin",
    pin: "1234",
  });
  assert.equal(session.role, "super_admin");
  assert.equal(session.school, undefined);
  assert.equal(session.platformContext.kind, "global");
  assert.equal(session.user.id, "USER-SUPERADMIN");
  assert.equal(session.user.identifier, "superadmin");
});

test("Admin Pays se connecte sans schoolCode ni PLATFORM-CD", async () => {
  const service = createService();
  const session = await service.login({
    role: "country_admin",
    identifier: "admin-rdc",
    pin: "1234",
  });
  assert.equal(session.role, "country_admin");
  assert.equal(session.school, undefined);
  assert.equal(session.platformContext.kind, "country");
  assert.equal(session.platformContext.countryCode, "CD");
  assert.equal(session.user.schoolCode, "*");
});

test("Utilisateur établissement sans schoolCode reste refusé", async () => {
  const service = createService();
  await assert.rejects(
    () =>
      service.login({
        role: "school_admin",
        identifier: "admin",
        pin: "1234",
      }),
    (error) => error instanceof BusinessError && error.statusCode === 400 && /Champs manquants/.test(error.message),
  );
});

test("PLATFORM n'est pas une école valide", async () => {
  const service = createService();
  await assert.rejects(
    () =>
      service.login({
        role: "super_admin",
        schoolCode: "PLATFORM",
        identifier: "superadmin",
        pin: "1234",
      }),
    (error) => error instanceof BusinessError && error.statusCode === 401,
  );
});
