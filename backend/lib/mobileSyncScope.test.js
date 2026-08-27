"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeClassesScopeHash, resolveClassesSyncScope } = require("./mobileSyncScope");

function adminPrincipal(overrides = {}) {
  return {
    sub: "admin-1",
    role: "Admin School",
    schoolCode: "SCH-A",
    permissions: ["Voir classes", "Gérer classes"],
    ...overrides,
  };
}

function teacherPrincipal(assignments, overrides = {}) {
  return {
    sub: "teacher-1",
    role: "Enseignant",
    schoolCode: "SCH-A",
    permissions: ["Voir classes"],
    assignments,
    ...overrides,
  };
}

test("scopeHash déterministe à entrée identique", () => {
  const a = computeClassesScopeHash(adminPrincipal(), { schoolCode: "SCH-A", schoolId: "id-a" });
  const b = computeClassesScopeHash(adminPrincipal(), { schoolCode: "SCH-A", schoolId: "id-a" });
  assert.equal(a.scopeHash, b.scopeHash);
  assert.match(a.scopeHash, /^[a-f0-9]{64}$/);
});

test("Admin School = school-wide (pas la liste des class IDs)", () => {
  const scope = resolveClassesSyncScope(adminPrincipal());
  assert.equal(scope.scopeKind, "school-wide");
  assert.deepEqual(scope.classIds, []);
});

test("nouvelle classe n'invalide pas le scopeHash school-wide", () => {
  const before = computeClassesScopeHash(adminPrincipal(), { schoolCode: "SCH-A", schoolId: "id-a" });
  const after = computeClassesScopeHash(adminPrincipal(), { schoolCode: "SCH-A", schoolId: "id-a" });
  assert.equal(before.scopeHash, after.scopeHash);
});

test("Teacher : uniquement les classes d'affectations actives", () => {
  const scope = resolveClassesSyncScope(
    teacherPrincipal([
      { classId: "class-a", classCode: "CLS-A", status: "active" },
      { classId: "class-b", classCode: "CLS-B", status: "inactive" },
    ]),
  );
  assert.equal(scope.scopeKind, "assigned");
  assert.deepEqual(scope.classIds, ["class-a"]);
  assert.deepEqual(scope.classCodes, ["CLS-A"]);
});

test("grant d'une classe change le scopeHash enseignant", () => {
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const before = computeClassesScopeHash(
    teacherPrincipal([{ classId: "class-a", classCode: "CLS-A", status: "active" }]),
    school,
  );
  const after = computeClassesScopeHash(
    teacherPrincipal([
      { classId: "class-a", classCode: "CLS-A", status: "active" },
      { classId: "class-b", classCode: "CLS-B", status: "active" },
    ]),
    school,
  );
  assert.notEqual(before.scopeHash, after.scopeHash);
});

test("revoke d'une classe change le scopeHash enseignant", () => {
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const before = computeClassesScopeHash(
    teacherPrincipal([
      { classId: "class-a", classCode: "CLS-A", status: "active" },
      { classId: "class-b", classCode: "CLS-B", status: "active" },
    ]),
    school,
  );
  const after = computeClassesScopeHash(
    teacherPrincipal([{ classId: "class-a", classCode: "CLS-A", status: "active" }]),
    school,
  );
  assert.notEqual(before.scopeHash, after.scopeHash);
});

test("tenant différent → scopeHash différent", () => {
  const principal = adminPrincipal();
  const a = computeClassesScopeHash(principal, { schoolCode: "SCH-A", schoolId: "id-a" });
  const b = computeClassesScopeHash(principal, { schoolCode: "SCH-B", schoolId: "id-b" });
  assert.notEqual(a.scopeHash, b.scopeHash);
});

test("principal différent → scopeHash différent", () => {
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const a = computeClassesScopeHash(adminPrincipal({ sub: "admin-1" }), school);
  const b = computeClassesScopeHash(adminPrincipal({ sub: "admin-2" }), school);
  assert.notEqual(a.scopeHash, b.scopeHash);
});

test("Préfet = school-wide comme GET /api/classes", () => {
  const scope = resolveClassesSyncScope({
    role: "Préfet des études",
    permissions: ["Voir classes"],
    assignments: [{ classId: "class-a", classCode: "CLS-A", status: "active" }],
  });
  assert.equal(scope.scopeKind, "school-wide");
});

test("Classes CUSTOM_ROLE + Classes:READ → scopeKind=none, jamais school-wide", () => {
  const { computeClassesScopeHash } = require("./mobileSyncScope");
  const custom = {
    sub: "custom-1",
    role: "CUSTOM_ROLE",
    roles: ["CUSTOM_ROLE"],
    roleKeys: ["CUSTOM_ROLE"],
    schoolCode: "SCH-A",
    permissions: ["Classes:READ", "Voir classes"],
    assignments: [{ classId: "class-a", classCode: "CLS-A", status: "active" }],
  };
  const scope = resolveClassesSyncScope(custom);
  assert.equal(scope.scopeKind, "none");
  assert.deepEqual(scope.classIds, []);
  assert.deepEqual(scope.classCodes, []);
  const hashed = computeClassesScopeHash(custom, { schoolCode: "SCH-A", schoolId: "id-a" });
  assert.equal(hashed.scope.scopeKind, "none");
  assert.deepEqual(hashed.input.classIds, []);
});

function trapUnscopedRoleKeys() {
  return async function listActiveUserRoleKeys() {
    throw new Error("listActiveUserRoleKeys unscoped ne doit pas être appelé par mobile-sync");
  };
}

test("scopeHash live ignore principal.assignments JWT", async () => {
  const { resolveLiveClassesSyncSnapshot } = require("./mobileSyncScope");
  const stale = teacherPrincipal([
    { classId: "class-a", classCode: "CLS-A", status: "active" },
    { classId: "class-b", classCode: "CLS-B", status: "active" },
  ]);
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const liveOnlyA = {
    listActiveUserRoleKeys: trapUnscopedRoleKeys(),
    async listActiveUserRoleKeysForSchool() {
      return ["TEACHER"];
    },
    async listLiveTeacherClassAssignmentsForSync() {
      return [{ classId: "class-a", classCode: "CLS-A", status: "active" }];
    },
  };
  const hashed = await resolveLiveClassesSyncSnapshot(liveOnlyA, stale, school);
  assert.deepEqual(hashed.scope.classIds, ["class-a"]);
  const jwtHashed = computeClassesScopeHash(stale, school);
  assert.notEqual(hashed.scopeHash, jwtHashed.scopeHash);
});

test("ordre des affectations identiques → même scopeHash", () => {
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const a = computeClassesScopeHash(
    teacherPrincipal([
      { classId: "class-b", classCode: "CLS-B", status: "active" },
      { classId: "class-a", classCode: "CLS-A", status: "active" },
    ]),
    school,
  );
  const b = computeClassesScopeHash(
    teacherPrincipal([
      { classId: "class-a", classCode: "CLS-A", status: "active" },
      { classId: "class-b", classCode: "CLS-B", status: "active" },
    ]),
    school,
  );
  assert.equal(a.scopeHash, b.scopeHash);
});

test("sans dépôt d'affectations live → assigned vide (pas de fuite JWT)", async () => {
  const { resolveLiveClassesSyncSnapshot } = require("./mobileSyncScope");
  const stale = teacherPrincipal([
    { classId: "class-a", classCode: "CLS-A", status: "active" },
    { classId: "class-b", classCode: "CLS-B", status: "active" },
  ]);
  const hashed = await resolveLiveClassesSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async listActiveUserRoleKeysForSchool() {
        return ["TEACHER"];
      },
    },
    stale,
    {
      schoolCode: "SCH-A",
      schoolId: "id-a",
    },
  );
  assert.equal(hashed.scope.scopeKind, "assigned");
  assert.deepEqual(hashed.scope.classIds, []);
});

test("JWT Admin stale + rôles live [] → aucun scope", async () => {
  const { resolveLiveClassesSyncSnapshot } = require("./mobileSyncScope");
  const hashed = await resolveLiveClassesSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async listActiveUserRoleKeysForSchool() {
        return [];
      },
    },
    adminPrincipal(),
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.equal(hashed.scope.scopeKind, "none");
  assert.deepEqual(hashed.scope.classIds, []);
});

test("JWT Teacher stale + rôle live révoqué → aucun scope", async () => {
  const { resolveLiveClassesSyncSnapshot } = require("./mobileSyncScope");
  const stale = teacherPrincipal([
    { classId: "class-a", classCode: "CLS-A", status: "active" },
    { classId: "class-b", classCode: "CLS-B", status: "active" },
  ]);
  const hashed = await resolveLiveClassesSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async listActiveUserRoleKeysForSchool() {
        return [];
      },
      async listLiveTeacherClassAssignmentsForSync() {
        return [
          { classId: "class-a", classCode: "CLS-A", status: "active" },
          { classId: "class-b", classCode: "CLS-B", status: "active" },
        ];
      },
    },
    stale,
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.equal(hashed.scope.scopeKind, "none");
  assert.deepEqual(hashed.scope.classIds, []);
});

test("erreur lecture rôles live → fail-closed, pas de fallback JWT", async () => {
  const { resolveLiveClassesSyncSnapshot } = require("./mobileSyncScope");
  await assert.rejects(
    () =>
      resolveLiveClassesSyncSnapshot(
        {
          listActiveUserRoleKeys: trapUnscopedRoleKeys(),
          async listActiveUserRoleKeysForSchool() {
            throw new Error("pg roles unavailable");
          },
        },
        adminPrincipal(),
        { schoolCode: "SCH-A", schoolId: "id-a" },
      ),
    (error) => error.code === "MOBILE_SYNC_LIVE_SCOPE_UNAVAILABLE" && error.statusCode === 503,
  );
});

test("TEACHER tenant A + SCHOOL_ADMIN tenant B → sync A reste assigned", async () => {
  const { resolveLiveClassesSyncSnapshot } = require("./mobileSyncScope");
  const staleAdminJwt = adminPrincipal({
    sub: "user-x",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    schoolCode: "SCH-A",
  });
  const rolesBySchool = {
    "id-a": ["TEACHER"],
    "id-b": ["SCHOOL_ADMIN"],
  };
  const hashedA = await resolveLiveClassesSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async listActiveUserRoleKeysForSchool(_userId, schoolId) {
        return rolesBySchool[String(schoolId)] ?? [];
      },
      async listLiveTeacherClassAssignmentsForSync() {
        return [{ classId: "class-a", classCode: "CLS-A", status: "active" }];
      },
    },
    staleAdminJwt,
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.equal(hashedA.scope.scopeKind, "assigned");
  assert.deepEqual(hashedA.scope.classIds, ["class-a"]);
  assert.deepEqual(hashedA.input.roleKeys, ["Enseignant"]);
  assert.ok(!hashedA.input.roleKeys.includes("Admin School"));
  assert.ok(!hashedA.input.roleKeys.includes("SCHOOL_ADMIN"));
  const hashedB = await resolveLiveClassesSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async listActiveUserRoleKeysForSchool(_userId, schoolId) {
        return rolesBySchool[String(schoolId)] ?? [];
      },
    },
    adminPrincipal({ sub: "user-x", schoolCode: "SCH-B" }),
    { schoolCode: "SCH-B", schoolId: "id-b" },
  );
  assert.equal(hashedB.scope.scopeKind, "school-wide");
});

test("sans schoolId tenant → aucun rôle live", async () => {
  const { resolveLiveClassesSyncSnapshot } = require("./mobileSyncScope");
  const hashed = await resolveLiveClassesSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async listActiveUserRoleKeysForSchool() {
        return ["SCHOOL_ADMIN"];
      },
    },
    adminPrincipal(),
    { schoolCode: "SCH-A", schoolId: "" },
  );
  assert.equal(hashed.scope.scopeKind, "none");
});

test("permissions live reçoivent schoolCode — DENY school vs READ global", async () => {
  const { resolveLiveClassesSyncSnapshot, liveSnapshotHasClassesRead } = require("./mobileSyncScope");
  let seen = null;
  const hashed = await resolveLiveClassesSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async listActiveUserRoleKeysForSchool() {
        return ["TEACHER"];
      },
      async resolveEffectivePermissions(principal) {
        seen = principal;
        assert.equal(principal.schoolCode, "SCH-A");
        assert.equal(principal.effectiveSchoolId, "id-a");
        assert.equal(principal.sub, undefined);
        if (!principal.schoolCode) {
          return { permissions: ["Voir classes", "Classes:READ"] };
        }
        return { permissions: [] };
      },
      async listLiveTeacherClassAssignmentsForSync() {
        return [{ classId: "class-a", classCode: "CLS-A", status: "active" }];
      },
    },
    teacherPrincipal([{ classId: "class-a", classCode: "CLS-A", status: "active" }]),
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.equal(seen.schoolCode, "SCH-A");
  assert.deepEqual(hashed.input.permissionKeys, []);
  assert.equal(liveSnapshotHasClassesRead(hashed.input), false);
  assert.equal(hashed.scope.scopeKind, "assigned");
});

test("ACCOUNTANT live du tenant : school-wide sans permission Classes", async () => {
  const { resolveLiveClassesSyncSnapshot, liveSnapshotHasClassesRead } = require("./mobileSyncScope");
  const hashed = await resolveLiveClassesSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async listActiveUserRoleKeysForSchool(_userId, schoolId) {
        return schoolId === "id-a" ? ["ACCOUNTANT"] : ["SCHOOL_ADMIN"];
      },
    },
    adminPrincipal({ sub: "user-acc" }),
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.equal(hashed.scope.scopeKind, "school-wide");
  assert.equal(liveSnapshotHasClassesRead(hashed.input), false);
});

test("Students CUSTOM_ROLE + Élèves:READ → scopeKind=none, jamais school-wide", () => {
  const { computeStudentsScopeHash, resolveStudentsSyncScope } = require("./mobileSyncScope");
  const custom = {
    sub: "custom-1",
    role: "CUSTOM_ROLE",
    roles: ["CUSTOM_ROLE"],
    roleKeys: ["CUSTOM_ROLE"],
    schoolCode: "SCH-A",
    permissions: ["Élèves:READ"],
    authorizedStudentIds: ["stu-1"],
  };
  const scope = resolveStudentsSyncScope(custom);
  assert.equal(scope.scopeKind, "none");
  assert.deepEqual(scope.studentIds, []);
  assert.deepEqual(scope.classIds, []);
  const hashed = computeStudentsScopeHash(custom, { schoolCode: "SCH-A", schoolId: "id-a" });
  assert.equal(hashed.scope.scopeKind, "none");
  assert.deepEqual(hashed.input.studentIds, []);
});

test("Students school-wide : pas de roster IDs dans le scopeHash", () => {
  const { computeStudentsScopeHash, resolveStudentsSyncScope } = require("./mobileSyncScope");
  const scope = resolveStudentsSyncScope(adminPrincipal({ permissions: ["Élèves:READ"] }));
  assert.equal(scope.scopeKind, "school-wide");
  const hashed = computeStudentsScopeHash(
    adminPrincipal({
      permissions: ["Élèves:READ"],
      authorizedStudentIds: ["stu-1", "stu-2"],
    }),
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.deepEqual(hashed.input.studentIds, []);
  assert.equal(hashed.input.resource, "students");
});

test("Students assigned : roster IDs dans le scopeHash, grant/revoke change le hash", () => {
  const { computeStudentsScopeHash, resolveStudentsSyncScope } = require("./mobileSyncScope");
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const teacherA = teacherPrincipal([{ classId: "class-a", classCode: "CLS-A", status: "active" }], {
    permissions: ["Élèves:READ"],
    authorizedStudentIds: ["stu-1"],
  });
  const scope = resolveStudentsSyncScope(teacherA);
  assert.equal(scope.scopeKind, "assigned");
  assert.deepEqual(scope.studentIds, ["stu-1"]);
  const before = computeStudentsScopeHash(teacherA, school);
  const afterAdd = computeStudentsScopeHash(
    teacherPrincipal([{ classId: "class-a", classCode: "CLS-A", status: "active" }], {
      permissions: ["Élèves:READ"],
      authorizedStudentIds: ["stu-1", "stu-2"],
    }),
    school,
  );
  assert.notEqual(before.scopeHash, afterAdd.scopeHash);
  const afterTransferOut = computeStudentsScopeHash(
    teacherPrincipal([{ classId: "class-a", classCode: "CLS-A", status: "active" }], {
      permissions: ["Élèves:READ"],
      authorizedStudentIds: [],
    }),
    school,
  );
  assert.notEqual(before.scopeHash, afterTransferOut.scopeHash);
});

test("Students linked / self : roster live, jamais JWT studentIds", async () => {
  const { resolveLiveStudentsSyncSnapshot } = require("./mobileSyncScope");
  const parentJwt = {
    sub: "parent-1",
    role: "Parent",
    schoolCode: "SCH-A",
    permissions: ["Élèves:READ"],
    studentIds: ["jwt-stu"],
  };
  const hashed = await resolveLiveStudentsSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async listActiveUserRoleKeysForSchool() {
        return ["PARENT"];
      },
      async resolveEffectivePermissions() {
        return { permissions: ["Élèves:READ"] };
      },
      async listLiveParentLinkedStudentIdsForSync() {
        return [{ studentId: "live-stu" }];
      },
    },
    parentJwt,
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.equal(hashed.scope.scopeKind, "linked");
  assert.deepEqual(hashed.scope.studentIds, ["live-stu"]);
  assert.ok(!hashed.input.studentIds.includes("jwt-stu"));
});

test("Students live PG error liens parent → 503, pas de fallback JWT", async () => {
  const { resolveLiveStudentsSyncSnapshot } = require("./mobileSyncScope");
  await assert.rejects(
    () =>
      resolveLiveStudentsSyncSnapshot(
        {
          listActiveUserRoleKeys: trapUnscopedRoleKeys(),
          async listActiveUserRoleKeysForSchool() {
            return ["PARENT"];
          },
          async resolveEffectivePermissions() {
            return { permissions: ["Élèves:READ"] };
          },
          async listLiveParentLinkedStudentIdsForSync() {
            throw new Error("pg links unavailable");
          },
        },
        { sub: "parent-1", role: "Parent", schoolCode: "SCH-A" },
        { schoolCode: "SCH-A", schoolId: "id-a" },
      ),
    (error) => error.code === "MOBILE_SYNC_LIVE_SCOPE_UNAVAILABLE" && error.statusCode === 503,
  );
});

test("Assignments CUSTOM_ROLE + Affectations:READ → scopeKind=none, jamais school-wide", () => {
  const { computeAssignmentsScopeHash, resolveAssignmentsSyncScope } = require("./mobileSyncScope");
  const custom = {
    sub: "custom-1",
    role: "CUSTOM_ROLE",
    roles: ["CUSTOM_ROLE"],
    roleKeys: ["CUSTOM_ROLE"],
    schoolCode: "SCH-A",
    permissions: ["Affectations:READ", "Enseignants:READ"],
    liveTeacherId: "teacher-uuid",
    authorizedAssignmentIds: ["asg-1"],
    teacherCode: "TCH-JWT",
    teacherId: "TCH-JWT",
    assignments: [{ id: "asg-1" }],
  };
  const scope = resolveAssignmentsSyncScope(custom);
  assert.equal(scope.scopeKind, "none");
  assert.deepEqual(scope.assignmentIds, []);
  const hashed = computeAssignmentsScopeHash(custom, { schoolCode: "SCH-A", schoolId: "id-a" });
  assert.equal(hashed.scope.scopeKind, "none");
  assert.deepEqual(hashed.input.assignmentIds, []);
});

test("Assignments school-wide : pas de roster d'IDs dans le scopeHash", () => {
  const { computeAssignmentsScopeHash, resolveAssignmentsSyncScope } = require("./mobileSyncScope");
  const scope = resolveAssignmentsSyncScope(
    adminPrincipal({ permissions: ["Affectations:READ"] }),
  );
  assert.equal(scope.scopeKind, "school-wide");
  const hashed = computeAssignmentsScopeHash(
    adminPrincipal({
      permissions: ["Affectations:READ"],
      authorizedAssignmentIds: ["asg-1", "asg-2"],
    }),
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.deepEqual(hashed.input.assignmentIds, []);
  assert.equal(hashed.input.resource, "assignments");
});

test("Assignments assigned : roster IDs dans le scopeHash, grant/revoke change le hash", () => {
  const { computeAssignmentsScopeHash, resolveAssignmentsSyncScope } = require("./mobileSyncScope");
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const teacherA = {
    sub: "teacher-1",
    role: "Enseignant",
    roles: ["Enseignant"],
    roleKeys: ["TEACHER"],
    schoolCode: "SCH-A",
    permissions: ["Affectations:READ"],
    liveTeacherId: "teacher-uuid",
    authorizedAssignmentIds: ["asg-1"],
  };
  const scope = resolveAssignmentsSyncScope(teacherA);
  assert.equal(scope.scopeKind, "assigned");
  assert.deepEqual(scope.assignmentIds, ["asg-1"]);
  const before = computeAssignmentsScopeHash(teacherA, school);
  const afterAdd = computeAssignmentsScopeHash(
    { ...teacherA, authorizedAssignmentIds: ["asg-1", "asg-2"] },
    school,
  );
  assert.notEqual(before.scopeHash, afterAdd.scopeHash);
  const afterRevoke = computeAssignmentsScopeHash(
    { ...teacherA, authorizedAssignmentIds: [] },
    school,
  );
  assert.notEqual(before.scopeHash, afterRevoke.scopeHash);
});

test("Assignments live ignore teacherCode / teacherId / assignments JWT", async () => {
  const { resolveLiveAssignmentsSyncSnapshot } = require("./mobileSyncScope");
  const stale = {
    sub: "teacher-1",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    schoolCode: "SCH-A",
    permissions: ["Affectations:READ", "ALL_PRIVILEGES"],
    teacherCode: "JWT-CODE",
    teacherId: "JWT-CODE",
    assignments: [{ id: "jwt-asg" }],
  };
  const hashed = await resolveLiveAssignmentsSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async listActiveUserRoleKeysForSchool() {
        return ["TEACHER"];
      },
      async resolveEffectivePermissions() {
        return { permissions: ["Affectations:READ"] };
      },
      async getLiveTeacherIdentityForSchool() {
        return { teacherId: "live-teacher-uuid", teacherCode: "TCH-LIVE", teacherUserId: "teacher-1" };
      },
      async listLiveTeacherAssignmentIdsForSync() {
        return [{ assignmentId: "live-asg" }];
      },
    },
    stale,
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.equal(hashed.scope.scopeKind, "assigned");
  assert.equal(hashed.scope.teacherId, "live-teacher-uuid");
  assert.deepEqual(hashed.scope.assignmentIds, ["live-asg"]);
  assert.ok(!hashed.input.assignmentIds.includes("jwt-asg"));
});

test("SchoolCourses CUSTOM_ROLE + Matières:READ → scopeKind=none, jamais school-wide", () => {
  const { computeSchoolCoursesScopeHash, resolveSchoolCoursesSyncScope } = require("./mobileSyncScope");
  const custom = {
    sub: "custom-1",
    role: "CUSTOM_ROLE",
    roles: ["CUSTOM_ROLE"],
    roleKeys: ["CUSTOM_ROLE"],
    schoolCode: "SCH-A",
    permissions: ["Matières:READ", "Voir classes"],
    liveTeacherId: "teacher-uuid",
    authorizedAssignmentIds: ["asg-1"],
    authorizedCoursePairs: [{ classId: "class-a", subjectId: "sub-math" }],
    teacherCode: "TCH-JWT",
  };
  const scope = resolveSchoolCoursesSyncScope(custom);
  assert.equal(scope.scopeKind, "none");
  assert.deepEqual(scope.coursePairs, []);
  const hashed = computeSchoolCoursesScopeHash(custom, { schoolCode: "SCH-A", schoolId: "id-a" });
  assert.equal(hashed.scope.scopeKind, "none");
  assert.deepEqual(hashed.input.coursePairs, []);
});

test("SchoolCourses school-wide : pas de roster de paires dans le scopeHash", () => {
  const { computeSchoolCoursesScopeHash, resolveSchoolCoursesSyncScope } = require("./mobileSyncScope");
  const scope = resolveSchoolCoursesSyncScope(
    adminPrincipal({ permissions: ["Matières:READ", "Voir classes"] }),
  );
  assert.equal(scope.scopeKind, "school-wide");
  const hashed = computeSchoolCoursesScopeHash(
    adminPrincipal({
      permissions: ["Matières:READ"],
      authorizedCoursePairs: [{ classId: "class-a", subjectId: "sub-math" }],
    }),
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.deepEqual(hashed.input.coursePairs, []);
  assert.equal(hashed.input.resource, "school-courses");
});

test("SchoolCourses assigned : paires class|subject dans le scopeHash, grant/revoke change le hash", () => {
  const { computeSchoolCoursesScopeHash, resolveSchoolCoursesSyncScope } = require("./mobileSyncScope");
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const teacherA = {
    sub: "teacher-1",
    role: "Enseignant",
    roles: ["Enseignant"],
    roleKeys: ["TEACHER"],
    schoolCode: "SCH-A",
    permissions: ["Matières:READ"],
    liveTeacherId: "teacher-uuid",
    authorizedAssignmentIds: ["asg-1"],
    authorizedCoursePairs: [{ classId: "class-a", subjectId: "sub-math" }],
  };
  const scope = resolveSchoolCoursesSyncScope(teacherA);
  assert.equal(scope.scopeKind, "assigned");
  assert.deepEqual(scope.coursePairs, [{ classId: "class-a", subjectId: "sub-math" }]);
  const before = computeSchoolCoursesScopeHash(teacherA, school);
  const afterAdd = computeSchoolCoursesScopeHash(
    {
      ...teacherA,
      authorizedAssignmentIds: ["asg-1", "asg-2"],
      authorizedCoursePairs: [
        { classId: "class-a", subjectId: "sub-math" },
        { classId: "class-a", subjectId: "sub-fr" },
      ],
    },
    school,
  );
  assert.notEqual(before.scopeHash, afterAdd.scopeHash);
  const afterRevoke = computeSchoolCoursesScopeHash(
    { ...teacherA, authorizedAssignmentIds: [], authorizedCoursePairs: [] },
    school,
  );
  assert.notEqual(before.scopeHash, afterRevoke.scopeHash);
});

test("SchoolCourses live ignore teacherCode / teacherId / assignments JWT", async () => {
  const { resolveLiveSchoolCoursesSyncSnapshot } = require("./mobileSyncScope");
  const stale = {
    sub: "teacher-1",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    schoolCode: "SCH-A",
    permissions: ["Matières:READ", "ALL_PRIVILEGES"],
    teacherCode: "JWT-CODE",
    teacherId: "JWT-CODE",
    assignments: [{ classId: "jwt-class", subjectId: "jwt-subject" }],
  };
  const hashed = await resolveLiveSchoolCoursesSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async listActiveUserRoleKeysForSchool() {
        return ["TEACHER"];
      },
      async resolveEffectivePermissions() {
        return { permissions: ["Matières:READ"] };
      },
      async getLiveTeacherIdentityForSchool() {
        return { teacherId: "live-teacher-uuid", teacherCode: "TCH-LIVE", teacherUserId: "teacher-1" };
      },
      async listLiveTeacherAssignmentPairsForSync() {
        return [{ assignmentId: "live-asg", classId: "class-a", subjectId: "sub-math" }];
      },
    },
    stale,
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.equal(hashed.scope.scopeKind, "assigned");
  assert.equal(hashed.scope.teacherId, "live-teacher-uuid");
  assert.deepEqual(hashed.scope.coursePairs, [{ classId: "class-a", subjectId: "sub-math" }]);
  assert.ok(!hashed.input.coursePairs.some((key) => key.includes("jwt-class")));
});

test("SchoolCourses erreur paires d'affectations live → 503, pas de fallback JWT", async () => {
  const { resolveLiveSchoolCoursesSyncSnapshot } = require("./mobileSyncScope");
  await assert.rejects(
    () =>
      resolveLiveSchoolCoursesSyncSnapshot(
        {
          listActiveUserRoleKeys: trapUnscopedRoleKeys(),
          async listActiveUserRoleKeysForSchool() {
            return ["TEACHER"];
          },
          async resolveEffectivePermissions() {
            return { permissions: ["Matières:READ"] };
          },
          async getLiveTeacherIdentityForSchool() {
            return { teacherId: "live-teacher-uuid", teacherCode: "TCH-LIVE", teacherUserId: "teacher-1" };
          },
          async listLiveTeacherAssignmentPairsForSync() {
            throw new Error("pg assignment pairs unavailable");
          },
        },
        { sub: "teacher-1", role: "Enseignant", schoolCode: "SCH-A" },
        { schoolCode: "SCH-A", schoolId: "id-a" },
      ),
    (error) => error.code === "MOBILE_SYNC_LIVE_SCOPE_UNAVAILABLE" && error.statusCode === 503,
  );
});

test("Assignments live : JWT sub = teachers.id récupère users.id, jamais teacherCode", async () => {
  const { resolveLiveAssignmentsSyncSnapshot } = require("./mobileSyncScope");
  const USER = "c81b0ec1-b8dd-4f09-8357-6775586920ff";
  const TEACHER = "cd866ff1-92f5-4bf6-9086-dce64f903717";
  const hashed = await resolveLiveAssignmentsSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async resolveCanonicalUserIdForSchool(ref) {
        if (ref === TEACHER || ref === USER) return USER;
        return null;
      },
      async listActiveUserRoleKeysForSchool(userId) {
        assert.equal(userId, USER);
        return ["TEACHER"];
      },
      async resolveEffectivePermissions() {
        return { permissions: ["Affectations:READ"] };
      },
      async getLiveTeacherIdentityForSchool(userId) {
        assert.equal(userId, USER);
        return { teacherId: TEACHER, teacherCode: "TCH-LIVE", teacherUserId: USER };
      },
      async listLiveTeacherAssignmentIdsForSync(_schoolId, teacherId) {
        assert.equal(teacherId, TEACHER);
        return [{ assignmentId: "a1" }, { assignmentId: "a2" }, { assignmentId: "a3" }, { assignmentId: "a4" }];
      },
    },
    {
      sub: TEACHER,
      role: "Enseignant",
      schoolCode: "SCH-A",
      teacherCode: "JWT-CODE",
      teacherId: "JWT-CODE",
    },
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.equal(hashed.scope.scopeKind, "assigned");
  assert.equal(hashed.scope.teacherId, TEACHER);
  assert.deepEqual(hashed.scope.assignmentIds, ["a1", "a2", "a3", "a4"]);
  assert.equal(hashed.principalTrace.canonicalUserId, USER);
  assert.equal(hashed.principalTrace.recoveredFromTeacherId, true);
});

test("Assignments live fail-closed : principal sans teachers.user_id → []", async () => {
  const { resolveLiveAssignmentsSyncSnapshot } = require("./mobileSyncScope");
  const hashed = await resolveLiveAssignmentsSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async resolveCanonicalUserIdForSchool() {
        return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99";
      },
      async listActiveUserRoleKeysForSchool() {
        return ["TEACHER"];
      },
      async resolveEffectivePermissions() {
        return { permissions: ["Affectations:READ"] };
      },
      async getLiveTeacherIdentityForSchool() {
        return null;
      },
      async listLiveTeacherAssignmentIdsForSync() {
        return [{ assignmentId: "foreign-asg" }];
      },
    },
    { sub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99", role: "Enseignant", schoolCode: "SCH-A" },
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.equal(hashed.scope.scopeKind, "assigned");
  assert.equal(hashed.scope.teacherId, "");
  assert.deepEqual(hashed.scope.assignmentIds, []);
});

test("Assignments erreur identité enseignant live → 503, pas de fallback JWT", async () => {
  const { resolveLiveAssignmentsSyncSnapshot } = require("./mobileSyncScope");
  await assert.rejects(
    () =>
      resolveLiveAssignmentsSyncSnapshot(
        {
          listActiveUserRoleKeys: trapUnscopedRoleKeys(),
          async listActiveUserRoleKeysForSchool() {
            return ["TEACHER"];
          },
          async resolveEffectivePermissions() {
            return { permissions: ["Affectations:READ"] };
          },
          async getLiveTeacherIdentityForSchool() {
            throw new Error("pg teacher identity unavailable");
          },
        },
        { sub: "teacher-1", role: "Enseignant", schoolCode: "SCH-A" },
        { schoolCode: "SCH-A", schoolId: "id-a" },
      ),
    (error) => error.code === "MOBILE_SYNC_LIVE_SCOPE_UNAVAILABLE" && error.statusCode === 503,
  );
});

test("CourseSchedules CUSTOM_ROLE + Planning de cours:READ → scopeKind=none", () => {
  const { computeCourseSchedulesScopeHash, resolveCourseSchedulesSyncScope } = require("./mobileSyncScope");
  const custom = {
    sub: "custom-1",
    role: "CUSTOM_ROLE",
    roles: ["CUSTOM_ROLE"],
    roleKeys: ["CUSTOM_ROLE"],
    schoolCode: "SCH-A",
    permissions: ["Planning de cours:READ"],
    liveTeacherId: "teacher-uuid",
    authorizedCoursePairs: [{ classId: "class-a", subjectId: "sub-math" }],
  };
  const scope = resolveCourseSchedulesSyncScope(custom);
  assert.equal(scope.scopeKind, "none");
  const hashed = computeCourseSchedulesScopeHash(custom, { schoolCode: "SCH-A", schoolId: "id-a" });
  assert.equal(hashed.input.resource, "course-schedules");
  assert.deepEqual(hashed.input.coursePairs, []);
});

test("CourseSchedules assigned : paires + teacherId dans le hash, grant change le hash", () => {
  const { computeCourseSchedulesScopeHash, resolveCourseSchedulesSyncScope } = require("./mobileSyncScope");
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const teacherA = {
    sub: "teacher-1",
    role: "Enseignant",
    roles: ["Enseignant"],
    roleKeys: ["TEACHER"],
    schoolCode: "SCH-A",
    permissions: ["Planning de cours:READ"],
    liveTeacherId: "teacher-uuid",
    authorizedAssignmentIds: ["asg-1"],
    authorizedCoursePairs: [{ classId: "class-a", subjectId: "sub-math" }],
  };
  assert.equal(resolveCourseSchedulesSyncScope(teacherA).scopeKind, "assigned");
  const before = computeCourseSchedulesScopeHash(teacherA, school);
  const afterAdd = computeCourseSchedulesScopeHash(
    {
      ...teacherA,
      authorizedAssignmentIds: ["asg-1", "asg-2"],
      authorizedCoursePairs: [
        { classId: "class-a", subjectId: "sub-math" },
        { classId: "class-a", subjectId: "sub-fr" },
      ],
    },
    school,
  );
  assert.notEqual(before.scopeHash, afterAdd.scopeHash);
});

test("CourseSchedules live ignore teacherCode JWT", async () => {
  const { resolveLiveCourseSchedulesSyncSnapshot } = require("./mobileSyncScope");
  const hashed = await resolveLiveCourseSchedulesSyncSnapshot(
    {
      listActiveUserRoleKeys: trapUnscopedRoleKeys(),
      async listActiveUserRoleKeysForSchool() {
        return ["TEACHER"];
      },
      async resolveEffectivePermissions() {
        return { permissions: ["Planning de cours:READ"] };
      },
      async getLiveTeacherIdentityForSchool() {
        return { teacherId: "live-teacher-uuid", teacherCode: "TCH-LIVE", teacherUserId: "teacher-1" };
      },
      async listLiveTeacherAssignmentPairsForSync() {
        return [{ assignmentId: "live-asg", classId: "class-a", subjectId: "sub-math" }];
      },
    },
    {
      sub: "teacher-1",
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Planning de cours:READ", "ALL_PRIVILEGES"],
      teacherCode: "JWT-CODE",
    },
    { schoolCode: "SCH-A", schoolId: "id-a" },
  );
  assert.equal(hashed.scope.scopeKind, "assigned");
  assert.equal(hashed.scope.teacherId, "live-teacher-uuid");
  assert.deepEqual(hashed.scope.coursePairs, [{ classId: "class-a", subjectId: "sub-math" }]);
});

