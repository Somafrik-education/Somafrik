"use strict";

/**
 * Matrice d'identités Lot B — invariants, pas des regex de helper.
 *
 * Établissement : schools.login_code
 * Utilisateur   : users.user_code
 * Élève/personne: students.login_code
 * Relations DB  : UUID
 *
 * leftover school_code / teacher_code : stockés seulement, jamais Auth/tenant/lookup.
 */

const assert = require("node:assert/strict");
const {
  canonicalSchoolLoginOrNull,
  isLegacySchoolCodeFormat,
  isV2SchoolLoginCode,
  matchesSchoolLookup,
} = require("./schoolCodeV2");
const {
  schoolRecordInFinanceScope,
  studentRecordInFinanceScope,
  studentSchoolPublicLogin,
} = require("./financeSchoolScope");

const leftoverSchool = "CD-2026-0001";
const schoolLogin = "CD-IN-26-001";
const otherSchoolLogin = "BI-ESB-26-001";
const leftoverTeacher = "ENS-0001";
const userCode = "CD-IN-JK-26-00001";
const personLogin = "CD-IN-EL-26-001";
const schoolUuid = "550e8400-e29b-41d4-a716-446655440001";

const sameTenant = { mode: "schools", codes: [schoolLogin] };
const otherTenant = { mode: "schools", codes: [otherSchoolLogin] };

assert.equal(isV2SchoolLoginCode(schoolLogin), true);
assert.equal(isLegacySchoolCodeFormat(leftoverSchool), true);
assert.equal(canonicalSchoolLoginOrNull(leftoverSchool), null);
assert.equal(canonicalSchoolLoginOrNull(leftoverTeacher), null);
assert.equal(canonicalSchoolLoginOrNull(userCode), null);
assert.equal(canonicalSchoolLoginOrNull(personLogin), null);
assert.equal(canonicalSchoolLoginOrNull(schoolUuid), null);
assert.equal(canonicalSchoolLoginOrNull(schoolLogin), schoolLogin);

assert.equal(matchesSchoolLookup({ loginCode: schoolLogin }, leftoverSchool), false);
assert.equal(matchesSchoolLookup({ loginCode: schoolLogin, code: leftoverSchool }, leftoverSchool), false);
assert.equal(matchesSchoolLookup({ loginCode: schoolLogin }, schoolLogin), true);
assert.equal(matchesSchoolLookup({ loginCode: schoolLogin }, otherSchoolLogin), false);

assert.equal(studentSchoolPublicLogin({ login_code: personLogin, school_login_code: schoolLogin }), schoolLogin);
assert.equal(studentSchoolPublicLogin({ loginCode: personLogin, schoolCode: schoolLogin }), schoolLogin);
assert.notEqual(studentSchoolPublicLogin({ login_code: personLogin }), personLogin);

assert.equal(
  schoolRecordInFinanceScope({ login_code: schoolLogin }, sameTenant),
  true,
);
assert.equal(
  schoolRecordInFinanceScope({ login_code: leftoverSchool, school_code: leftoverSchool }, sameTenant),
  false,
  "leftover school_code n'entre pas dans le scope",
);
assert.equal(
  studentRecordInFinanceScope({ login_code: personLogin, school_login_code: schoolLogin }, sameTenant),
  true,
);
assert.equal(
  studentRecordInFinanceScope({ login_code: personLogin, school_login_code: schoolLogin }, otherTenant),
  false,
);
assert.equal(
  studentRecordInFinanceScope({ login_code: personLogin }, sameTenant),
  false,
  "login personne ne doit jamais servir de tenant établissement",
);

assert.notEqual(leftoverSchool, schoolLogin, "school_code leftover ≠ login_code");
assert.notEqual(leftoverTeacher, userCode, "teacher_code leftover ≠ user_code");
assert.notEqual(personLogin, schoolLogin, "student login_code ≠ school login_code");
assert.notEqual(schoolLogin, otherSchoolLogin, "école A ≠ école B");

console.log("idCanonicalIdentityMatrix.test.js OK");
