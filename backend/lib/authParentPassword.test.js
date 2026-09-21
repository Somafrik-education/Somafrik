"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { AuthService, BusinessError } = require("../services/authService");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");
const { hashSecret } = require("../services/credentialService");

const SCHOOL = {
  id: "school-1",
  code: "SCH-TEST",
  loginCode: "CD-IN-26-001",
  publicId: "CD-IN-26-001",
  name: "Institut Nuru",
  city: "Kinshasa",
  country: "RDC",
  countryCode: "CD",
  status: "Actif",
  validationStatus: "Validé",
};

function createService() {
  attachMemoryLoginLockoutStore();
  const parent = {
    id: "USR-PARENT-1",
    identifier: "+243820000001",
    phone: "+243820000001",
    firstName: "Aline",
    lastName: "Kabila",
    role: "Parent",
    schoolCode: SCHOOL.code,
    accessChannel: "Application",
    status: "Actif",
    passwordHash: hashSecret("Pass1234"),
    pinHash: hashSecret("999999"),
    pin: "999999",
  };
  const teacher = {
    id: "USR-TEACHER-1",
    identifier: "prof",
    firstName: "Paul",
    lastName: "Teacher",
    role: "Enseignant",
    schoolCode: SCHOOL.code,
    accessChannel: "Application",
    status: "Actif",
    password: "TeacherPin1!",
    pin: "123456",
  };
  const student = {
    id: "USR-STUDENT-1",
    identifier: "eleve1",
    firstName: "Marc",
    lastName: "Rumba",
    role: "Élève / Étudiant",
    schoolCode: SCHOOL.code,
    accessChannel: "Application",
    status: "Actif",
    pin: "123456",
  };
  const admin = {
    id: "USR-ADMIN-1",
    identifier: "admin",
    firstName: "Admin",
    lastName: "Établissement",
    role: "Admin School",
    schoolCode: SCHOOL.code,
    accessChannel: "Application",
    status: "Actif",
    password: "1234",
    pin: "1234",
  };
  return new AuthService({
    school: SCHOOL,
    schools: [SCHOOL],
    teachers: [],
    students: [],
    userAccounts: [parent, teacher, student, admin],
    countries: [],
    subscriptions: [],
  });
}

test("Parent se connecte avec le champ password canonique", async () => {
  const service = createService();
  const session = await service.login({
    role: "parent_student",
    schoolCode: "CD-IN-26-001",
    identifier: "+243820000001",
    password: "Pass1234",
  });
  assert.equal(session.role, "parent_student");
  assert.equal(session.user.role, "Parent");
});

test("Parent refuse pin comme transport, même si le secret passwordHash correspond", async () => {
  const service = createService();
  await assert.rejects(
    () =>
      service.login({
        role: "parent_student",
        schoolCode: "CD-IN-26-001",
        identifier: "+243820000001",
        pin: "Pass1234",
      }),
    (error) => error instanceof BusinessError && error.statusCode === 400 && /Champs manquants/.test(error.message),
  );
});

test("Parent refuse pinHash / PIN historique", async () => {
  const service = createService();
  await assert.rejects(
    () =>
      service.login({
        role: "parent_student",
        schoolCode: "CD-IN-26-001",
        identifier: "+243820000001",
        password: "999999",
      }),
    (error) => error instanceof BusinessError && error.statusCode === 401,
  );
  await assert.rejects(
    () =>
      service.login({
        role: "parent_student",
        schoolCode: "CD-IN-26-001",
        identifier: "+243820000001",
        pin: "999999",
      }),
    (error) => error instanceof BusinessError && error.statusCode === 400,
  );
});

test("Parent mauvais mot de passe → 401 standard", async () => {
  const service = createService();
  await assert.rejects(
    () =>
      service.login({
        role: "parent_student",
        schoolCode: "CD-IN-26-001",
        identifier: "+243820000001",
        password: "WrongPass1",
      }),
    (error) => error instanceof BusinessError && error.statusCode === 401,
  );
});

test("Teacher / Admin / Student auth inchangés via pin", async () => {
  const service = createService();
  const teacher = await service.login({
    role: "teacher",
    schoolCode: "CD-IN-26-001",
    identifier: "prof",
    pin: "TeacherPin1!",
  });
  assert.equal(teacher.user.role, "Enseignant");
  const admin = await service.login({
    role: "school_admin",
    schoolCode: "CD-IN-26-001",
    identifier: "admin",
    pin: "1234",
  });
  assert.equal(admin.role, "school_admin");
  const student = await service.login({
    role: "student",
    schoolCode: "CD-IN-26-001",
    identifier: "eleve1",
    pin: "123456",
  });
  assert.equal(student.role, "student");
});
