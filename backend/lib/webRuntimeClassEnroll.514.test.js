"use strict";

/**
 * #514 web-runtime — parcours réel Web :
 * ClassStudentsPage enroll → students + users → GET /backoffice/users → DataContext → UsersPage.
 *
 * Capture préprod après #515 : Type métier = Sans affectation, Rôle(s) d'accès = Aucun rôle d'accès.
 * Le Web affiche fidèlement le payload API (pas de normalizeUser qui jette les champs, contrairement à Mobile).
 * Le défaut est la liaison/projection : trigger d'identité qui réécrit users.*_code alors que
 * students.student_code reste le matricule, et le matcher ignore students.user_id.
 *
 * CD-ITS-MR-26-00003 = échantillon de format, pas un utilisateur production.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { hydrateUser } = require("./userRoleLifecycleService");
const {
  BUSINESS_PROFILE_KIND_LABELS,
  buildBusinessProfile,
  findActiveStudentProfileForUser,
} = require("./businessProfileIntegrity");

const SAMPLE_STUDENT_CODE = "CD-ITS-MR-26-00003";
const DIVERGED_USER_CODE = "CD-ITS-MR-26-00099";

describe("#514 web-runtime — parcours classe → GET /backoffice/users", () => {
  it("codes divergents + students.user_id : type métier élève même sans rôle d'accès", () => {
    assert.match(SAMPLE_STUDENT_CODE, /^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-\d{2}-\d{5}$/);
    const user = {
      id: "user-div",
      school_id: "school-a",
      first_name: "Marc",
      last_name: "Rumba",
      user_code: DIVERGED_USER_CODE,
      identity_code: DIVERGED_USER_CODE,
      login_code: "MR-26-00099",
      role: "STUDENT",
    };
    const student = {
      id: "stu-1",
      school_id: "school-a",
      student_code: SAMPLE_STUDENT_CODE,
      status: "active",
      user_id: "user-div",
    };
    const studentRow = findActiveStudentProfileForUser([student], user, "school-a");
    const hydrated = hydrateUser(user, [], buildBusinessProfile({ studentRow, roleKeys: [] }));
    assert.equal(hydrated.accountKind, "student_login");
    assert.equal(hydrated.businessProfileLabel, BUSINESS_PROFILE_KIND_LABELS.student_login);
    assert.equal(hydrated.linkedStudent.studentCode, SAMPLE_STUDENT_CODE);
    assert.deepEqual(hydrated.roleKeys, []);
    assert.notEqual(hydrated.businessProfileLabel, "Sans affectation");
  });

  it("listProjection GET /backoffice/users : même invariant via le store mémoire", async () => {
    const store = createClientsMemoryStore({
      platformSchools: [
        { id: "school-cd", code: "CD-2026-0001", name: "CD", countryId: "country-cd", countryCode: "CD" },
      ],
    });
    const schoolAdmin = {
      sub: "admin-cd",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      identifier: "admin",
    };
    const created = await store.createUser(
      { firstName: "Marc", lastName: "Rumba", email: "marc.514@test.local" },
      schoolAdmin,
      { ipAddress: "127.0.0.1", userAgent: "514-web-runtime" },
    );
    const row = store._tables.users.find((item) => item.id === created.id);
    row.user_code = DIVERGED_USER_CODE;
    row.identity_code = DIVERGED_USER_CODE;
    row.login_code = "MR-26-00099";
    store._tables.students.push({
      id: "student-514",
      school_id: "school-cd",
      student_code: SAMPLE_STUDENT_CODE,
      first_name: "Marc",
      last_name: "Rumba",
      status: "active",
      user_id: created.id,
    });
    const listed = store.listProjection().users.find((item) => item.id === created.id);
    assert.equal(listed.accountKind, "student_login");
    assert.equal(listed.businessProfileLabel, "Compte lié à un élève");
    assert.equal(listed.linkedStudent.studentCode, SAMPLE_STUDENT_CODE);
    assert.deepEqual(listed.roleKeys, []);
    assert.notEqual(listed.businessProfileLabel, "Sans affectation");
  });

  it("témoin : staff créé sans profil métier reste unassigned", async () => {
    const store = createClientsMemoryStore({
      platformSchools: [
        { id: "school-cd", code: "CD-2026-0001", name: "CD", countryId: "country-cd", countryCode: "CD" },
      ],
    });
    const schoolAdmin = {
      sub: "admin-cd",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      identifier: "admin",
    };
    const staff = await store.createUser(
      { firstName: "Staff", lastName: "Nuru", email: "staff.514@test.local" },
      schoolAdmin,
      { ipAddress: "127.0.0.1", userAgent: "514-web-runtime" },
    );
    assert.equal(staff.accountKind, "unassigned");
    assert.equal(staff.businessProfileLabel, "Sans affectation");
    assert.deepEqual(staff.roleKeys, []);
  });
});
