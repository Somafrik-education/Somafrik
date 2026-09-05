/**
 *   npx tsx Mobile/src/lib/canonicalResourceNormalize.test.ts
 */
import assert from "node:assert/strict";
import {
  normalizeAnnouncement,
  normalizeMessage,
  normalizeSchool,
  normalizeTeacher,
  normalizeUser,
  readTenantScopeFields,
} from "./canonicalResourceNormalize";
import { pickInitialSchoolCode, schoolSelectorChoice } from "./activeSchool";
import {
  ACCESS_ROLES_NONE_LABEL,
  formatAccessRolesDisplay,
  formatBusinessProfileKind,
} from "./businessProfile";

function run() {
  const tenant = readTenantScopeFields({
    school_code: "SCH-ABC123",
    school_login_code: "CD-IN-26-001",
    schoolId: "uuid-school",
    country_code: "CD",
  });
  assert.equal(tenant.schoolCode, "CD-IN-26-001");
  assert.equal(tenant.schoolId, "uuid-school");
  assert.equal(tenant.countryCode, "CD");

  const teacher = normalizeTeacher({
    id: "ENS-9",
    teacher_code: "CD-IN-ENS-26-009",
    first_name: "Amina",
    last_name: "Diallo",
    schoolCode: "SCH-ABC123",
    schoolPublicCode: "CD-IN-26-001",
    assigned_classes: [],
  });
  assert.equal(teacher?.schoolCode, "CD-IN-26-001");
  assert.deepEqual(teacher?.assignedClasses, []);

  const user = normalizeUser({
    id: "user-pg",
    userCode: "USR-2026-00001",
    firstName: "Jean",
    lastName: "Mbuyi",
    schoolCode: "SCH-ABC123",
    schoolPublicCode: "CD-IN-26-001",
  });
  assert.equal(user?.schoolCode, "CD-IN-26-001");
  assert.notEqual(user?.schoolCode, "SCH-ABC123");

  const apiStudent = {
    id: "user-student",
    publicId: "CD-ITS-MR-26-00003",
    firstName: "Marc",
    lastName: "Rumba",
    accountKind: "student_login",
    businessProfileLabel: "Compte lié à un élève",
    linkedStudent: { studentId: "stu-1", studentCode: "CD-ITS-MR-26-00003", status: "active" },
    linkedTeacher: null,
    businessProfileConflict: false,
    role: "Sans affectation",
    assignmentStatus: "Sans affectation",
    roles: [] as string[],
    roleKeys: [] as string[],
    activeRoles: [] as string[],
  };
  assert.equal(formatBusinessProfileKind(apiStudent), "Compte lié à un élève");
  const normalizedStudent = normalizeUser(apiStudent);
  assert.equal(normalizedStudent?.accountKind, "student_login");
  assert.equal(normalizedStudent?.businessProfileLabel, "Compte lié à un élève");
  assert.equal(normalizedStudent?.linkedStudent?.studentCode, "CD-ITS-MR-26-00003");
  assert.equal(normalizedStudent?.linkedTeacher, null);
  assert.equal(normalizedStudent?.assignmentStatus, "Sans affectation");
  assert.deepEqual(normalizedStudent?.roleKeys, []);
  assert.equal(formatBusinessProfileKind(normalizedStudent || {}), "Compte lié à un élève");
  assert.notEqual(formatBusinessProfileKind(normalizedStudent || {}), "Sans affectation");
  assert.equal(formatAccessRolesDisplay(normalizedStudent || {}), ACCESS_ROLES_NONE_LABEL);

  const normalizedStaff = normalizeUser({
    id: "user-staff",
    accountKind: "unassigned",
    role: "Sans affectation",
    assignmentStatus: "Sans affectation",
    roleKeys: [],
  });
  assert.equal(formatBusinessProfileKind(normalizedStaff || {}), "Sans affectation");
  assert.equal(formatAccessRolesDisplay(normalizedStaff || {}), ACCESS_ROLES_NONE_LABEL);

  const normalizedTeacher = normalizeUser({
    id: "user-teacher",
    accountKind: "teacher",
    linkedTeacher: { teacherId: "t1", teacherCode: "ENS-1", status: "active" },
    roleKeys: ["TEACHER"],
    activeRoles: ["Enseignant"],
    assignmentStatus: "Enseignant",
  });
  assert.equal(normalizedTeacher?.accountKind, "teacher");
  assert.deepEqual(normalizedTeacher?.roleKeys, ["TEACHER"]);
  assert.equal(formatBusinessProfileKind(normalizedTeacher || {}), "Profil enseignant");

  const normalizedConflict = normalizeUser({
    id: "user-conflict",
    accountKind: "conflict",
    linkedStudent: { studentCode: "CD-ITS-MR-26-00003" },
    linkedTeacher: { teacherCode: "ENS-X" },
    businessProfileConflict: true,
  });
  assert.equal(formatBusinessProfileKind(normalizedConflict || {}), "Conflit élève + enseignant");

  const announcement = normalizeAnnouncement({
    id: "ann-pg",
    title: "Conseil",
    message: "18h",
    school_code: "SCH-ABC123",
    school_login_code: "CD-IN-26-001",
    school_id: "school-1",
  });
  assert.equal(announcement?.schoolCode, "CD-IN-26-001");
  assert.equal(announcement?.schoolId, "school-1");
  assert.equal(announcement?.systemBroadcast, false);

  const message = normalizeMessage({
    id: "msg-pg",
    parent_phone: "+243820000009",
    theme: "Absence",
    message: "Justifiée",
    school_code: "SCH-ABC123",
    school_login_code: "CD-IN-26-001",
  });
  assert.equal(message?.schoolCode, "CD-IN-26-001");

  const school = normalizeSchool({
    id: "school-uuid",
    code: "SCH-ABC123",
    schoolCode: "SCH-ABC123",
    loginCode: "CD-IN-26-001",
    publicId: "CD-IN-26-001",
    name: "Institut Nuru",
    countryCode: "CD",
  });
  if (!school) throw new Error("normalizeSchool a échoué");
  assert.equal(school.code, "CD-IN-26-001");
  assert.equal(school.publicId, "CD-IN-26-001");
  assert.equal(school.name, "Institut Nuru");
  assert.equal(school.countryCode, "CD");
  assert.notEqual(school.code, "SCH-ABC123");
  assert.doesNotMatch(JSON.stringify(school), /SCH-ABC123/);

  const selector = schoolSelectorChoice(school);
  assert.equal(selector.code, "CD-IN-26-001");
  assert.match(selector.label, /CD-IN-26-001/);
  assert.doesNotMatch(selector.label, /SCH-ABC123/);
  const activeSchoolCode = pickInitialSchoolCode({ role: "super_admin" }, [selector.code]);
  assert.equal(activeSchoolCode, "CD-IN-26-001");
  assert.notEqual(activeSchoolCode, "SCH-ABC123");

  console.log("canonicalResourceNormalize.test.ts OK");
}

run();
