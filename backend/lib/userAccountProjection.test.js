"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { hydrateUser } = require("./userRoleLifecycleService");
const { displayRoles } = require("./userRoleLifecycle");
const {
  BUSINESS_PROFILE_KIND_LABELS,
  ACCESS_ROLES_NONE_LABEL,
  buildBusinessProfile,
  findActiveStudentProfileForUser,
  resolveAccountKind,
} = require("./businessProfileIntegrity");

const SAMPLE_IDENTITY = "CD-ITS-MR-26-00003";

describe("user account projection — type métier vs rôle d'accès", () => {
  it("élève lié sans rôle d'accès : type métier distinct, jamais Sans affectation", () => {
    assert.equal(displayRoles([]).assignmentStatus, "Sans affectation");
    const profile = buildBusinessProfile({
      studentRow: { id: "stu-1", student_code: SAMPLE_IDENTITY, status: "active" },
      roleKeys: [],
    });
    const hydrated = hydrateUser(
      { id: "user-1", first_name: "Marc", last_name: "Rumba", user_code: SAMPLE_IDENTITY },
      [],
      profile,
    );
    assert.equal(hydrated.accountKind, "student_login");
    assert.equal(hydrated.businessProfileLabel, BUSINESS_PROFILE_KIND_LABELS.student_login);
    assert.equal(hydrated.linkedStudent.studentCode, SAMPLE_IDENTITY);
    assert.deepEqual(hydrated.roleKeys, []);
    assert.equal(hydrated.assignmentStatus, "Sans affectation");
    assert.notEqual(hydrated.businessProfileLabel, hydrated.assignmentStatus);
    assert.notEqual(hydrated.businessProfileLabel, "Sans affectation");
    assert.equal(ACCESS_ROLES_NONE_LABEL, "Aucun rôle d'accès");
  });

  it("codes divergents : students.user_id relie quand même le type métier élève", () => {
    const profile = buildBusinessProfile({
      studentRow: {
        id: "stu-1",
        student_code: SAMPLE_IDENTITY,
        user_id: "user-div",
        status: "active",
      },
      roleKeys: [],
    });
    const hydrated = hydrateUser(
      {
        id: "user-div",
        first_name: "Marc",
        last_name: "Rumba",
        user_code: "CD-ITS-MR-26-00099",
        identity_code: "CD-ITS-MR-26-00099",
      },
      [],
      profile,
    );
    assert.equal(hydrated.accountKind, "student_login");
    assert.equal(hydrated.linkedStudent.studentCode, SAMPLE_IDENTITY);
    assert.notEqual(hydrated.businessProfileLabel, "Sans affectation");
    assert.deepEqual(hydrated.roleKeys, []);
  });

  it("élève lié + STUDENT : type métier élève, accès Élève / Étudiant", () => {
    const profile = buildBusinessProfile({
      studentRow: { id: "stu-1", student_code: SAMPLE_IDENTITY, status: "active" },
      roleKeys: ["STUDENT"],
    });
    const hydrated = hydrateUser(
      { id: "user-1", first_name: "Marc", last_name: "Rumba", user_code: SAMPLE_IDENTITY },
      ["STUDENT"],
      profile,
    );
    assert.equal(hydrated.accountKind, "student_login");
    assert.equal(hydrated.businessProfileLabel, "Compte lié à un élève");
    assert.equal(hydrated.assignmentStatus, "Élève / Étudiant");
    assert.deepEqual(hydrated.roleKeys, ["STUDENT"]);
  });

  it("staff sans rôle : Sans affectation autorisé comme type métier", () => {
    const profile = buildBusinessProfile({ roleKeys: [] });
    const hydrated = hydrateUser({ id: "user-staff", first_name: "Staff", last_name: "Nuru" }, [], profile);
    assert.equal(hydrated.accountKind, "unassigned");
    assert.equal(hydrated.businessProfileLabel, "Sans affectation");
    assert.equal(hydrated.assignmentStatus, "Sans affectation");
  });

  it("enseignant lié : type Profil enseignant", () => {
    const profile = buildBusinessProfile({
      teacherRow: { id: "t1", teacher_code: "ENS-1", status: "active" },
      roleKeys: ["TEACHER"],
    });
    const hydrated = hydrateUser({ id: "user-t", first_name: "Sarah", last_name: "Kalala" }, ["TEACHER"], profile);
    assert.equal(hydrated.accountKind, "teacher");
    assert.equal(hydrated.businessProfileLabel, "Profil enseignant");
    assert.equal(hydrated.assignmentStatus, "Enseignant");
  });

  it("conflit élève + enseignant : libellé explicite", () => {
    const profile = buildBusinessProfile({
      studentRow: { id: "s1", student_code: SAMPLE_IDENTITY, status: "active" },
      teacherRow: { id: "t1", teacher_code: "ENS-1", status: "active" },
      roleKeys: ["TEACHER"],
    });
    assert.equal(profile.accountKind, "conflict");
    assert.equal(profile.businessProfileLabel, "Conflit élève + enseignant");
    assert.equal(profile.businessProfileConflict, true);
  });

  it("élève inactif : pas de lien métier ; STUDENT roleKeys reste student_login", () => {
    const students = [
      { id: "stu-off", school_id: "school-a", student_code: SAMPLE_IDENTITY, status: "inactive" },
    ];
    const user = { id: "user-x", school_id: "school-a", user_code: SAMPLE_IDENTITY };
    assert.equal(findActiveStudentProfileForUser(students, user, "school-a"), null);
    assert.equal(resolveAccountKind({ roleKeys: [] }), "unassigned");
    assert.equal(
      buildBusinessProfile({ studentRow: null, roleKeys: [] }).businessProfileLabel,
      "Sans affectation",
    );
    assert.equal(resolveAccountKind({ roleKeys: ["STUDENT"] }), "student_login");
    assert.equal(
      buildBusinessProfile({ studentRow: null, roleKeys: ["STUDENT"] }).businessProfileLabel,
      "Compte lié à un élève",
    );
  });
});
