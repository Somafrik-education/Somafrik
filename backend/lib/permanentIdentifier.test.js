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
assert.equal(schoolShortCodeFromName("Institut Nuru"), "IN");
assert.equal(schoolShortCodeFromName("Institut Supérieur de Commerce"), "ISC");
assert.equal(schoolShortCodeFromName("Institut Superieur de Commerce"), "ISC");
assert.notEqual(schoolShortCodeFromName("Institut Supérieur de Commerce"), "ISDC");
assert.equal(schoolShortCodeFromName("École Kanyosha"), "EK");
assert.equal(schoolShortCodeFromName("Lycée Lumumba"), "LL");
assert.equal(schoolShortCodeFromName("Institut Supérieur des Techniques Médicales"), "ISTM");
assert.notEqual(schoolShortCodeFromName("Institut Supérieur des Techniques Médicales"), "ISDTC");
assert.notEqual(schoolShortCodeFromName("Institut Supérieur des Techniques Médicales"), "ISDTM");
assert.equal(schoolShortCodeFromName("Université de Kinshasa"), "UK");
assert.equal(schoolShortCodeFromName("École Nationale d'Administration"), "ENA");
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
