"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { attachCanonicalSchoolIdentity } = require("./sessionSchoolIdentity");

test("session login expose schoolId + login_code, jamais leftover comme schoolPublicCode", () => {
  const attached = attachCanonicalSchoolIdentity(
    { schoolCode: "CD-2026-0001" },
    { id: "school-nuru", loginCode: "CD-IN-26-001", code: "CD-2026-0001" },
  );
  assert.equal(attached.schoolId, "school-nuru");
  assert.equal(attached.schoolPublicCode, "CD-IN-26-001");
  assert.equal(attached.schoolCode, "CD-2026-0001");
  assert.notEqual(attached.schoolPublicCode, attached.schoolCode);
});

test("n'invente pas un schoolPublicCode depuis leftover school.code", () => {
  const attached = attachCanonicalSchoolIdentity(
    { schoolCode: "CD-2026-0001" },
    { id: "school-nuru", code: "CD-2026-0001" },
  );
  assert.equal(attached.schoolId, "school-nuru");
  assert.equal(attached.schoolPublicCode, undefined);
});

test("conserve schoolPublicCode déjà porté par le user PG", () => {
  const attached = attachCanonicalSchoolIdentity(
    {
      schoolCode: "CD-2026-0001",
      schoolPublicCode: "CD-IN-26-001",
      schoolId: "user-school",
    },
    { id: "other", loginCode: "BI-EC-26-001" },
  );
  assert.equal(attached.schoolId, "user-school");
  assert.equal(attached.schoolPublicCode, "CD-IN-26-001");
});
