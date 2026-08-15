"use strict";

const assert = require("node:assert/strict");
const {
  identityInitials,
  schoolShortCodeFromName,
  normalizeSchoolShortCode,
  formatLoginCode,
  formatIdentityCode,
} = require("./permanentIdentifier");

assert.equal(identityInitials("Grâce", "Kabeya"), "GK");
assert.equal(identityInitials("Jean Pierre", "Mbuyi"), "JPM");
assert.equal(identityInitials("Marie-Claire", "Mukendi"), "MCM");
assert.equal(identityInitials("Éric", "N'Dala"), "END");
assert.equal(schoolShortCodeFromName("Institut Kibwija"), "IK");
assert.equal(schoolShortCodeFromName("Collège Saint Michel"), "CSM");
assert.equal(normalizeSchoolShortCode(" i-k "), "IK");
assert.equal(formatLoginCode({ initials: "GK", year: 2026, sequence: 1 }), "GK-26-00001");
assert.equal(
  formatIdentityCode({ countryCode: "cd", schoolShortCode: "ik", initials: "GK", year: 2026, sequence: 1 }),
  "CD-IK-GK-26-00001",
);
assert.equal(
  formatIdentityCode({ countryCode: "CD", schoolShortCode: "IK", initials: "JPM", year: 2026, sequence: 99999 }),
  "CD-IK-JPM-26-99999",
);
assert.throws(
  () => formatLoginCode({ initials: "GK", year: 2026, sequence: 100000 }),
  (error) => error.code === "IDENTITY_SEQUENCE_EXHAUSTED",
);

console.log("permanentIdentifier.test.js OK");
