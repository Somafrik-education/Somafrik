"use strict";

const assert = require("node:assert/strict");
const {
  formatSchoolLoginCode,
  isLegacySchoolCodeFormat,
  isV2SchoolLoginCode,
  padSchoolSequence,
  publicSchoolCodeFromRecord,
  validateSchoolCode,
  allocateNextSchoolLoginCode,
  generateInternalSchoolAlias,
  isInternalSchoolAlias,
} = require("./schoolCodeV2");
const { schoolShortCodeFromName } = require("./permanentIdentifier");

assert.equal(schoolShortCodeFromName("Institut Nuru"), "IN");
assert.equal(schoolShortCodeFromName("Institut Supérieur de Commerce"), "ISC");
assert.notEqual(schoolShortCodeFromName("Institut Nuru"), "INSTITUT NURU");

assert.equal(
  formatSchoolLoginCode({ countryIso: "CD", schoolName: "Institut Nuru", year: 2026, sequence: 1 }),
  "CD-IN-26-001",
);
assert.equal(
  formatSchoolLoginCode({ countryIso: "CD", schoolName: "Institut Nuru", year: 2026, sequence: 2 }),
  "CD-IN-26-002",
);
assert.equal(padSchoolSequence(1), "001");
assert.equal(padSchoolSequence(2), "002");

assert.equal(isV2SchoolLoginCode("CD-IN-26-001"), true);
assert.equal(isV2SchoolLoginCode("CD-IN-26-002"), true);
assert.equal(isV2SchoolLoginCode("CD-2026-0001"), false);
assert.equal(isLegacySchoolCodeFormat("CD-2026-0001"), true);
assert.equal(isLegacySchoolCodeFormat("CD-IN-26-001"), false);

assert.deepEqual(validateSchoolCode("cd-in-26-001"), { normalized: "CD-IN-26-001", kind: "v2" });
assert.throws(
  () => validateSchoolCode("CD-2026-0001"),
  (error) => error.code === "SCHOOL_CODE_LEGACY_FORBIDDEN",
);
assert.throws(
  () => validateSchoolCode("SCH-ABCDEF"),
  (error) => error.code === "SCHOOL_CODE_LEGACY_FORBIDDEN",
);
assert.throws(
  () => validateSchoolCode("CD-2026-0001", { forCreation: true }),
  (error) => error.code === "SCHOOL_CODE_LEGACY_FORBIDDEN",
);
assert.throws(
  () => validateSchoolCode("CD-IN-26-001X", { forCreation: true }),
  (error) => error.code === "SCHOOL_CODE_INVALID",
);
assert.throws(() => validateSchoolCode(""), (error) => error.code === "SCHOOL_CODE_REQUIRED");

assert.equal(
  publicSchoolCodeFromRecord({
    code: "CD-2026-0001",
    publicId: "CD-2026-0001",
    loginCode: "CD-IN-26-001",
  }),
  "CD-IN-26-001",
);
assert.notEqual(
  publicSchoolCodeFromRecord({
    code: "CD-2026-0001",
    loginCode: "CD-IN-26-001",
  }),
  "CD-2026-0001",
);

assert.match(generateInternalSchoolAlias(), /^SCH-[A-Z0-9]+$/);
assert.equal(isInternalSchoolAlias("SCH-ABCDEF"), true);
assert.equal(isInternalSchoolAlias("CD-2026-0001"), false);
assert.equal(
  allocateNextSchoolLoginCode([], { countryIso: "CD", schoolName: "Lycée Somafrik Test", year: 2026 }),
  "CD-LST-26-001",
);
assert.equal(
  allocateNextSchoolLoginCode(
    [{ loginCode: "CD-LST-26-001" }],
    { countryIso: "CD", schoolName: "Autre École", year: 2026 },
  ),
  "CD-AE-26-002",
);

const src = require("fs").readFileSync(require("path").join(__dirname, "schoolCodeV2.js"), "utf8");
assert.doesNotMatch(src, /INSTITUT NURU/);
assert.match(src, /schoolShortCodeFromName/);

console.log("OK schoolCodeV2: CD-IN-26-001 / CD-IN-26-002, IN=initiales, legacy création refusée");
