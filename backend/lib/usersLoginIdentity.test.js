"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  USERS_LOGIN_IDENTITY_DUPLICATES_CODE,
  ACTIVE_USER_IDENTITY_STATUS_SQL,
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
