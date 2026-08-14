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
