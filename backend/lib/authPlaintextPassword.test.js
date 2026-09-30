"use strict";

/**
 * P0-02 — la vérification de secret n'accepte plus le clair (password / pin / temporaryPassword).
 *
 *   node --test backend/lib/authPlaintextPassword.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { AuthService, BusinessError } = require("../services/authService");
const { BackOfficeAccessService } = require("../services/backOfficeAccessService");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");
const { hashSecret, verifySecret } = require("../services/credentialService");
const { superadminLoginPassword } = require("./superadminSeedSecret");

const SCHOOL = {
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

function schoolAdmin(overrides = {}) {
  return {
    id: "USR-ADMIN-1",
    identifier: "admin",
    firstName: "Admin",
    lastName: "Établissement",
    role: "Admin School",
    schoolCode: SCHOOL.code,
    accessChannel: "Application",
    status: "Actif",
    password: "1234",
    pin: "1234",
    ...overrides,
  };
}

function createAuth(userAccounts) {
  attachMemoryLoginLockoutStore();
  return new AuthService({
    school: SCHOOL,
    schools: [SCHOOL],
    teachers: [],
    students: [],
    userAccounts,
    countries: [],
    subscriptions: [],
  });
}

test("verifyUserSecret refuse un compte qui n'a que le secret en clair", () => {
  const service = createAuth([]);
  assert.equal(service.verifyUserSecret({ password: "1234", pin: "1234" }, "1234"), false);
  assert.equal(service.verifyUserSecret({ temporaryPassword: "TempPass1" }, "TempPass1"), false);
  assert.equal(service.verifyUserSecret({ password: "Somafrik26!" }, "Somafrik26!"), false);
});

test("verifyUserSecret refuse le clair même si un hash différent est présent", () => {
  const service = createAuth([]);
  const user = {
    password: "1234",
    pin: "1234",
    temporaryPassword: "1234",
    passwordHash: hashSecret("other-secret"),
    pinHash: hashSecret("other-secret"),
  };
  assert.equal(service.verifyUserSecret(user, "1234"), false);
  assert.equal(service.verifyUserSecret(user, "other-secret"), true);
});

test("verifyUserSecret accepte un hash scrypt", () => {
  const service = createAuth([]);
  const hashed = hashSecret("1234");
  assert.equal(service.verifyUserSecret({ passwordHash: hashed }, "1234"), true);
  assert.equal(service.verifyUserSecret({ pinHash: hashed }, "1234"), true);
});

test("AuthService materialise les hash : login fixture clair reste possible", async () => {
  const user = schoolAdmin();
  const service = createAuth([user]);
  assert.match(String(user.passwordHash), /^scrypt\$/);
  assert.match(String(user.pinHash), /^scrypt\$/);
  assert.equal(user.password, "1234");
  const session = await service.login({
    role: "school_admin",
    schoolCode: "CD-IN-26-001",
    identifier: "admin",
    pin: "1234",
  });
  assert.equal(session.role, "school_admin");
});

test("BackOfficeAccessService refuse le clair hors hash", async () => {
  attachMemoryLoginLockoutStore();
  const service = new BackOfficeAccessService({
    school: SCHOOL,
    schools: [SCHOOL],
    userAccounts: [],
    students: [],
    countries: [],
    subscriptions: [],
  });
  assert.equal(service.verifyPassword({ password: "1234" }, "1234"), false);
  assert.equal(service.verifyPassword({ temporaryPassword: "TempPass1" }, "TempPass1"), false);
  assert.equal(service.verifyPassword({ passwordHash: hashSecret("1234") }, "1234"), true);

  await assert.rejects(
    () =>
      service.login({
        schoolCode: "CD-IN-26-001",
        identifier: "admin",
        password: "1234",
      }),
    (error) => error instanceof BusinessError && error.statusCode === 401,
  );
});

test("BackOfficeAccessService login fixture clair via hash materialisé", async () => {
  attachMemoryLoginLockoutStore();
  const user = schoolAdmin();
  const service = new BackOfficeAccessService({
    school: SCHOOL,
    schools: [SCHOOL],
    userAccounts: [user],
    students: [],
    countries: [],
    subscriptions: [],
  });
  const session = await service.login({
    schoolCode: "CD-IN-26-001",
    identifier: "admin",
    password: "1234",
  });
  assert.equal(session.user.id, user.id);
});

test("Superadmin refuse toujours 1234, même hashé", async () => {
  const hashed1234 = hashSecret("1234");
  const service = createAuth([
    {
      id: "USER-SUPERADMIN",
      identifier: "superadmin",
      firstName: "Super",
      lastName: "Admin",
      role: "Super Administrateur Somafrik",
      schoolCode: "*",
      accessChannel: "Application",
      status: "Actif",
      passwordHash: hashed1234,
      pinHash: hashed1234,
    },
  ]);
  await assert.rejects(
    () =>
      service.login({
        role: "super_admin",
        identifier: "superadmin",
        pin: "1234",
      }),
    (error) => error instanceof BusinessError && error.statusCode === 401,
  );
  assert.equal(verifySecret(superadminLoginPassword(), hashed1234), false);
});

test("garde source : verify* ne compare plus password/pin/temporaryPassword en clair", () => {
  const authSource = fs.readFileSync(path.join(__dirname, "../services/authService.js"), "utf8");
  const verifyUser = authSource.match(/verifyUserSecret\([\s\S]*?\n  \}/);
  assert.ok(verifyUser, "verifyUserSecret introuvable");
  assert.doesNotMatch(verifyUser[0], /temporaryPassword === normalizedSecret/);
  assert.doesNotMatch(verifyUser[0], /user\.password \?\? ""\) === normalizedSecret/);
  assert.doesNotMatch(verifyUser[0], /user\.pin \?\? ""\) === normalizedSecret/);

  const backOfficeSource = fs.readFileSync(path.join(__dirname, "../services/backOfficeAccessService.js"), "utf8");
  const verifyPassword = backOfficeSource.match(/verifyPassword\([\s\S]*?\n  \}/);
  assert.ok(verifyPassword, "verifyPassword introuvable");
  assert.doesNotMatch(verifyPassword[0], /temporaryPassword === normalizedPassword/);
  assert.doesNotMatch(verifyPassword[0], /user\.password \?\? ""\) === normalizedPassword/);

  const credentialSource = fs.readFileSync(path.join(__dirname, "../services/credentialService.js"), "utf8");
  const verifySecretFn = credentialSource.match(/function verifySecret\([\s\S]*?\n\}/);
  assert.ok(verifySecretFn, "verifySecret introuvable");
  assert.doesNotMatch(verifySecretFn[0], /String\(secret\) === String\(storedHash\)/);
  assert.match(verifySecretFn[0], /startsWith\(`\$\{HASH_PREFIX\}\$`\)/);
});
