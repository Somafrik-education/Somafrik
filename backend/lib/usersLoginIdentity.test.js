"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  USERS_LOGIN_IDENTITY_DUPLICATES_CODE,
  ACTIVE_USER_IDENTITY_STATUS_SQL,
  activeIdentityStatusSql,
  formatUsersLoginIdentityDuplicateDiagnostic,
  isUsersLoginIdentityUniquenessViolation,
} = require("./usersLoginIdentity");
const { AuthService } = require("../services/authService");
const { BackOfficeAccessService } = require("../services/backOfficeAccessService");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");
const fs = require("node:fs");
const path = require("node:path");

test("formatUsersLoginIdentityDuplicateDiagnostic inclut le code et les exemples", () => {
  const message = formatUsersLoginIdentityDuplicateDiagnostic(
    [{ school_code: "CD-2026-0001", email_key: "a@b.com", duplicate_count: 2, user_codes: ["U1", "U2"] }],
    1,
  );
  assert.match(message, /1 groupe\(s\) en doublon/);
  assert.match(message, /CD-2026-0001/);
});

test("isUsersLoginIdentityUniquenessViolation détecte la contrainte PG", () => {
  assert.equal(
    isUsersLoginIdentityUniquenessViolation({ code: "23505", constraint: "uq_users_school_email" }),
    true,
  );
  assert.equal(isUsersLoginIdentityUniquenessViolation({ code: "23505", constraint: "other" }), false);
});

test("code diagnostic users login identity", () => {
  assert.equal(USERS_LOGIN_IDENTITY_DUPLICATES_CODE, "USERS_LOGIN_IDENTITY_DUPLICATES");
});

test("activeIdentityStatusSql qualifie status quand un alias est fourni", () => {
  assert.match(activeIdentityStatusSql("u"), /COALESCE\(u\.status/);
  assert.doesNotMatch(activeIdentityStatusSql("u"), /JOIN/);
  assert.match(ACTIVE_USER_IDENTITY_STATUS_SQL, /COALESCE\(status/);
  assert.match(ACTIVE_USER_IDENTITY_STATUS_SQL, /archived/);
});

test("migration et module alignent index partiels sur archived/deleted", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "../db/migrations/20260814_users_login_identity_uniqueness.sql"),
    "utf8",
  );
  assert.match(migration, /NOT IN \('deleted', 'archived'\)/);
  const indexBlocks = migration.match(/CREATE UNIQUE INDEX[\s\S]*?;/g) ?? [];
  assert.equal(indexBlocks.length, 4);
  for (const block of indexBlocks) {
    assert.match(block, /NOT IN \('deleted', 'archived'\)/);
  }
});

function schoolLoginFixture() {
  const school = {
    id: "school-ik",
    code: "CD-2026-0001",
    legacySchoolCode: "CD-2026-0001",
    publicId: "CD-2026-0001",
    loginCode: "CD-IK-26-001",
    shortCode: "IK",
    country: "RDC",
    countryCode: "CD",
    name: "Institut K",
    status: "Actif",
    validationStatus: "Validé",
  };
  const user = {
    id: "user-gk",
    userCode: "GK-26-00001",
    identifier: "GK-26-00001",
    publicId: "GK-26-00001",
    schoolCode: school.code,
    firstName: "Grace",
    lastName: "Kabongo",
    role: "Admin School",
    accessChannel: "Application",
    status: "Actif",
    password: "Somafrik26!",
    mustChangePassword: false,
    permissions: [],
  };
  return { school, user };
}

test("AuthService accepte CD-IK-26-001 avec GK-26-00001", async () => {
  attachMemoryLoginLockoutStore();
  const { school, user } = schoolLoginFixture();
  const service = new AuthService({
    school,
    schools: [school],
    teachers: [],
    students: [],
    userAccounts: [user],
    countries: [],
    subscriptions: [],
  });

  assert.deepEqual(service.identify({ schoolCode: "CD-IK-26-001", identifier: "GK-26-00001" }), {
    role: "school_admin",
    roleLabel: "Admin Établissement",
  });

  const result = await service.login({
    role: "school_admin",
    schoolCode: "CD-IK-26-001",
    identifier: "GK-26-00001",
    pin: "Somafrik26!",
  });
  assert.equal(result.school.loginCode, "CD-IK-26-001");
  assert.equal(result.user.id, user.id);
  assert.equal(result.user.schoolCode, school.code);
});

test("BackOfficeAccessService résout CD-IK-26-001 vers le tenant historique", async () => {
  attachMemoryLoginLockoutStore();
  const { school, user } = schoolLoginFixture();
  const service = new BackOfficeAccessService({
    school,
    schools: [school],
    userAccounts: [user],
    students: [],
    countries: [],
    subscriptions: [],
  });

  const result = await service.login({
    schoolCode: "CD-IK-26-001",
    identifier: "GK-26-00001",
    password: "Somafrik26!",
  });
  assert.equal(result.user.id, user.id);
  assert.equal(result.schoolContext.loginCode, "CD-IK-26-001");
  assert.equal(result.schoolContext.code, school.code);
});
