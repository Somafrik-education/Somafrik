"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  createCanonicalSchool,
  createCanonicalUser,
  createCanonicalTeacher,
  createCanonicalStudent,
} = require("./canonicalIdentityFactories");

test("createCanonicalSchool n'expose que UUID + login_code V2", () => {
  const school = createCanonicalSchool({
    countryIso: "CD",
    name: "Institut Nuru",
    year: 2026,
    sequence: 1,
  });
  assert.equal(school.loginCode, "CD-IN-26-001");
  assert.equal(Object.hasOwn(school, "schoolCode"), false);
  assert.doesNotMatch(school.loginCode, /^[A-Z]{2}-20\d{2}-\d{4}$/);
  assert.doesNotMatch(school.loginCode, /^SCH-/);
});

test("createCanonicalUser n'a qu'une identité publique", () => {
  const school = createCanonicalSchool();
  const user = createCanonicalUser({
    school,
    firstName: "Jean Pierre",
    lastName: "Mbuyi",
    year: 2026,
    sequence: 1,
  });
  assert.equal(user.identityCode, "CD-IN-JPM-26-00001");
  assert.equal(user.userCode, user.identityCode);
  assert.equal(user.identifier, user.identityCode);
  assert.equal(user.publicId, user.identityCode);
  assert.doesNotMatch(user.identityCode, /\bENS-\d{4}\b/);
});

test("createCanonicalTeacher reprend l'identité user, jamais ENS-####", () => {
  const school = createCanonicalSchool({ sequence: 2 });
  const user = createCanonicalUser({ school, firstName: "Seke", lastName: "Mbuyi", sequence: 2 });
  const teacher = createCanonicalTeacher({ school, user });
  assert.equal(teacher.teacherCode, user.userCode);
  assert.equal(teacher.publicId, user.userCode);
  assert.equal(teacher.userId, user.id);
  assert.doesNotMatch(teacher.teacherCode, /\bENS-\d{4}\b/);
  assert.doesNotMatch(teacher.teacherCode, /20\d{2}-\d{4}-ENS-/);
});

test("createCanonicalStudent aligne matricule / login / publicId", () => {
  const school = createCanonicalSchool();
  const student = createCanonicalStudent({
    school,
    firstName: "Hope Sabrina",
    lastName: "Okito",
    year: 2026,
    sequence: 1,
  });
  assert.equal(student.studentCode, "CD-IN-OHS-26-00001");
  assert.equal(student.publicId, student.studentCode);
  assert.equal(student.identifier, student.studentCode);
});

test("deux établissements produisent des identités disjointes", () => {
  const a = createCanonicalSchool({ name: "Institut Nuru", sequence: 1 });
  const b = createCanonicalSchool({ name: "Lycée Somafrik Test", sequence: 2 });
  const teacherA = createCanonicalTeacher({
    school: a,
    user: createCanonicalUser({ school: a, firstName: "Ada", lastName: "Lovelace", sequence: 1 }),
  });
  const teacherB = createCanonicalTeacher({
    school: b,
    user: createCanonicalUser({ school: b, firstName: "Ada", lastName: "Lovelace", sequence: 1 }),
  });
  assert.notEqual(a.loginCode, b.loginCode);
  assert.notEqual(teacherA.teacherCode, teacherB.teacherCode);
  assert.notEqual(teacherA.user.identityCode, teacherB.user.identityCode);
});
