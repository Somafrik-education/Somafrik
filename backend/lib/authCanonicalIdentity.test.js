"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { AuthService, BusinessError } = require("../services/authService");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");
const {
  createCanonicalSchool,
  createCanonicalUser,
  createCanonicalTeacher,
} = require("./canonicalIdentityFactories");

function createAuth(overrides = {}) {
  const schoolA = overrides.schoolA ?? createCanonicalSchool({
    name: "Institut Nuru",
    sequence: 1,
    loginCode: "CD-IN-26-001",
  });
  const schoolB = overrides.schoolB ?? createCanonicalSchool({
    name: "Lycée Somafrik Test",
    sequence: 2,
    loginCode: "CD-LST-26-002",
  });
  const userA = createCanonicalUser({
    school: schoolA,
    firstName: "Jean Pierre",
    lastName: "Mbuyi",
    sequence: 1,
    role: "Enseignant",
  });
  const userB = createCanonicalUser({
    school: schoolB,
    firstName: "Jean Pierre",
    lastName: "Mbuyi",
    sequence: 1,
    role: "Enseignant",
  });
  const teacherA = createCanonicalTeacher({ school: schoolA, user: userA });
  const auth = new AuthService({
    userAccounts: [
      {
        id: userA.id,
        identifier: userA.identifier,
        publicId: userA.publicId,
        firstName: userA.firstName,
        lastName: userA.lastName,
        role: "Enseignant",
        schoolCode: schoolA.loginCode,
        status: "Actif",
        pin: "1234",
        password: "1234",
      },
      {
        id: userB.id,
        identifier: userB.identifier,
        publicId: userB.publicId,
        firstName: userB.firstName,
        lastName: userB.lastName,
        role: "Enseignant",
        schoolCode: schoolB.loginCode,
        status: "Actif",
        pin: "1234",
        password: "1234",
      },
    ],
    schools: [
      {
        id: schoolA.id,
        loginCode: schoolA.loginCode,
        publicId: schoolA.loginCode,
        code: schoolA.schoolCode,
        name: schoolA.name,
        countryCode: "CD",
        country: "RDC",
        status: "Actif",
        validationStatus: "Validé",
      },
      {
        id: schoolB.id,
        loginCode: schoolB.loginCode,
        publicId: schoolB.loginCode,
        code: schoolB.schoolCode,
        name: schoolB.name,
        countryCode: "CD",
        country: "RDC",
        status: "Actif",
        validationStatus: "Validé",
      },
    ],
    teachers: [
      { id: teacherA.id, userId: userA.id, identifier: teacherA.teacherCode, publicId: teacherA.teacherCode, schoolCode: schoolA.loginCode },
    ],
    students: [],
    relations: [],
    assignments: [],
    subscriptions: [
      { schoolCode: schoolA.loginCode, status: "active" },
      { schoolCode: schoolB.loginCode, status: "active" },
    ],
  });
  attachMemoryLoginLockoutStore(auth);
  return { auth, schoolA, schoolB, userA, userB };
}

async function expectBusiness(fn, status) {
  await assert.rejects(fn, (error) => error instanceof BusinessError && error.statusCode === status);
}

test("login canonique → 200", async () => {
  const { auth, schoolA, userA } = createAuth();
  const session = await auth.login({
    role: "teacher",
    schoolCode: schoolA.loginCode,
    identifier: userA.identifier,
    pin: "1234",
  });
  assert.equal(session.user.identifier, userA.identifier);
  assert.equal(session.user.schoolCode, schoolA.loginCode);
});

test("ancien identifiant ENS-0001 → refus", async () => {
  const { auth, schoolA } = createAuth();
  await expectBusiness(
    () => auth.login({ role: "teacher", schoolCode: schoolA.loginCode, identifier: "ENS-0001", pin: "1234" }),
    401,
  );
});

test("alias legacy CD-2026-0001-ENS-0001 → refus", async () => {
  const { auth, schoolA } = createAuth();
  await expectBusiness(
    () => auth.login({
      role: "teacher",
      schoolCode: schoolA.loginCode,
      identifier: "CD-2026-0001-ENS-0001",
      pin: "1234",
    }),
    401,
  );
});

test("autre tenant → refus même si les initiales personne coincident", async () => {
  const { auth, schoolA, userB } = createAuth();
  await expectBusiness(
    () => auth.login({
      role: "teacher",
      schoolCode: schoolA.loginCode,
      identifier: userB.identifier,
      pin: "1234",
    }),
    401,
  );
});

test("code établissement legacy CD-2026-0001 → refus", async () => {
  const { auth, userA } = createAuth();
  await expectBusiness(
    () => auth.login({
      role: "teacher",
      schoolCode: "CD-2026-0001",
      identifier: userA.identifier,
      pin: "1234",
    }),
    401,
  );
});

test("alias SCH-… → refus comme login public", async () => {
  const { auth, userA } = createAuth();
  await expectBusiness(
    () => auth.login({
      role: "teacher",
      schoolCode: "SCH-ABCDEF0123456789",
      identifier: userA.identifier,
      pin: "1234",
    }),
    401,
  );
});

test("publicId école distinct du login_code → refus", async () => {
  const { auth, schoolA, userA } = createAuth();
  await expectBusiness(
    () => auth.login({
      role: "teacher",
      schoolCode: schoolA.id,
      identifier: userA.identifier,
      pin: "1234",
    }),
    401,
  );
});

test("user_code inexistant → refus générique", async () => {
  const { auth, schoolA } = createAuth();
  await expectBusiness(
    () => auth.login({
      role: "teacher",
      schoolCode: schoolA.loginCode,
      identifier: "CD-IN-ZZ-26-99999",
      pin: "1234",
    }),
    401,
  );
});

test("UUID user utilisé comme login public → refus", async () => {
  const { auth, schoolA, userA } = createAuth();
  await expectBusiness(
    () => auth.login({
      role: "teacher",
      schoolCode: schoolA.loginCode,
      identifier: userA.id,
      pin: "1234",
    }),
    401,
  );
});

test("ancien alias élève ELE-0001 → refus", async () => {
  const { auth, schoolA } = createAuth();
  await expectBusiness(
    () => auth.login({
      role: "student",
      schoolCode: schoolA.loginCode,
      identifier: "ELE-0001",
      pin: "1234",
    }),
    401,
  );
});
