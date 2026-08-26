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
