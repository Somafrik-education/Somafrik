"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertMobileSyncCanonicalLoginCode } = require("./mobileSyncSchoolScope");

test("SY-08: login_code vide refuse leftover", () => {
  assert.throws(
    () => assertMobileSyncCanonicalLoginCode({ id: "s1", school_code: "CD-2026-0099", login_code: null }),
    (error) => error?.statusCode === 403,
  );
  assert.throws(
    () => assertMobileSyncCanonicalLoginCode({ id: "s1", school_code: "CD-2026-0099", login_code: "   " }),
    (error) => error?.statusCode === 403,
  );
});

test("SY-08: login_code canonique passe", () => {
  const school = assertMobileSyncCanonicalLoginCode({
    id: "s1",
    school_code: "CD-2026-0001",
    login_code: "CD-LAC-26-001",
  });
  assert.equal(school.login_code, "CD-LAC-26-001");
});

test("fixtures mémoire sans login_code restent inchangées", () => {
  const school = assertMobileSyncCanonicalLoginCode({ id: "sid-SCH-A", school_code: "SCH-A" });
  assert.equal(school.school_code, "SCH-A");
});
