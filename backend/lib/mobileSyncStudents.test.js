"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TokenService } = require("../services/tokenService");
const { RbacService, routePermissions, PERMISSION_DENIED } = require("../services/rbacService");
const { TenantScopeService } = require("../services/tenantScopeService");
const { MOBILE_SYNC_ERROR } = require("./mobileSyncErrors");
const { handleMobileSyncL1Students, clampLimit } = require("./mobileSyncStudents");
const { encodeMobileSyncCursor } = require("./mobileSyncCursor");
const { computeStudentsScopeHash } = require("./mobileSyncScope");

const tokens = new TokenService({ secret: "ci-test-secret-with-enough-length-for-production-checks" });
const tenantScopeService = new TenantScopeService();
const rbac = new RbacService();

const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";
const ID_C = "00000000-0000-4000-8000-00000000000c";
const CLASS_A = "11111111-1111-4111-8111-111111111111";
const CLASS_B = "22222222-2222-4222-8222-222222222222";
const SAME_TS = "2026-08-26T08:00:00.000Z";
const LATER_TS = "2026-08-26T09:00:00.000Z";

const STUDENT_ITEM_KEYS = [
  "academicYearId",
  "classCode",
  "classId",
  "enrollmentId",
  "enrollmentStatus",
  "firstName",
  "id",
  "lastName",
  "status",
  "studentCode",
  "syncUpdatedAt",
  "tombstone",
];

function studentRow(id, studentCode, overrides = {}) {
  return {
    id,
    studentCode,
    firstName: studentCode,
    lastName: "Test",
    classId: CLASS_A,
    classCode: "CLS-A",
    enrollmentId: `enr-${id.slice(-4)}`,
    enrollmentStatus: "active",
    academicYearId: "ay-1",
    status: "active",
    syncUpdatedAt: SAME_TS,
    tombstone: false,
    ...overrides,
  };
}

function createFakeRepo(rowsBySchool, live = {}) {
  return {
    async getSchoolByCode(code) {
      return { id: `sid-${code}`, school_code: code };
    },
    async listActiveUserRoleKeys() {
      throw new Error("listActiveUserRoleKeys unscoped ne doit pas être appelé par mobile-sync");
    },
    async listActiveUserRoleKeysForSchool(userId, schoolId) {
      if (live.failRoleKeys) {
        throw new Error("pg roles unavailable");
      }
      if (!schoolId) return [];
      const keyed = live.roleKeysByUserSchool?.[`${userId}::${schoolId}`];
      if (Array.isArray(keyed)) return keyed;
      const keys = live.roleKeysByUser?.[userId];
      return Array.isArray(keys) ? keys : [];
    },
    async resolveEffectivePermissions(principal) {
      if (live.failPermissions) {
        throw new Error("pg permissions unavailable");
      }
      live.lastPermissionsPrincipal = principal;
      if (typeof live.resolvePermissions === "function") {
        return live.resolvePermissions(principal);
      }
      const keys = new Set(principal.roleKeys ?? []);
      if (keys.has("SCHOOL_ADMIN") || keys.has("SUPER_ADMIN") || keys.has("PREFET_ETUDES")) {
        return { permissions: ["Élèves:READ", "Gérer élèves"] };
      }
      if (keys.has("TEACHER") || keys.has("PARENT") || keys.has("STUDENT")) {
        return { permissions: ["Élèves:READ"] };
      }
      return { permissions: [] };
    },
    async listLiveTeacherClassAssignmentsForSync(userId) {
      if (live.failAssignments) {
        throw new Error("pg assignments unavailable");
      }
      return live.assignmentsByUser?.[userId] ?? [];
    },
    async listLiveAssignedStudentIdsForSync(_schoolId, refs = {}) {
      if (live.failAssignedRoster) {
        throw new Error("pg assigned roster unavailable");
      }
      if (Array.isArray(live.assignedStudentIds)) {
        return live.assignedStudentIds.map((studentId) => ({ studentId }));
      }
      const classIds = new Set(refs.classIds ?? []);
      const classCodes = new Set(refs.classCodes ?? []);
      const all = Object.values(rowsBySchool).flat();
      return all
        .filter(
          (row) =>
            row.enrollmentStatus === "active" &&
            ((row.classId && classIds.has(String(row.classId))) ||
              (row.classCode && classCodes.has(String(row.classCode)))),
        )
        .map((row) => ({ studentId: row.id }));
    },
    async listLiveParentLinkedStudentIdsForSync(userId) {
      if (live.failParentLinks) {
        throw new Error("pg parent links unavailable");
      }
      return live.linkedByUser?.[userId] ?? [];
    },
    async listLiveSelfStudentIdForSync(userId) {
      if (live.failSelf) {
        throw new Error("pg self identity unavailable");
      }
      return live.selfByUser?.[userId] ?? null;
    },
    async listSchoolStudentsForMobileSync(schoolCode, options = {}) {
      live.sqlCalls = (live.sqlCalls ?? 0) + 1;
      let rows = [...(rowsBySchool[schoolCode] ?? [])];
      if (Array.isArray(options.studentIds)) {
        const ids = new Set(options.studentIds ?? []);
        if (!ids.size) return [];
        rows = rows.filter((row) => ids.has(String(row.id)));
      }
      if (Array.isArray(options.classIds) || Array.isArray(options.classCodes)) {
        const ids = new Set(options.classIds ?? []);
        const codes = new Set(options.classCodes ?? []);
        if (!ids.size && !codes.size) return [];
        rows = rows.filter(
          (row) =>
            (row.classId && ids.has(String(row.classId))) ||
            (row.classCode && codes.has(String(row.classCode))),
        );
      }
      if (options.afterUpdatedAt && options.afterId) {
        const afterTs = new Date(options.afterUpdatedAt).getTime();
        rows = rows.filter((row) => {
          const ts = new Date(row.syncUpdatedAt).getTime();
          return ts > afterTs || (ts === afterTs && String(row.id) > String(options.afterId));
        });
      }
      rows.sort((left, right) => {
        const ts = new Date(left.syncUpdatedAt).getTime() - new Date(right.syncUpdatedAt).getTime();
        if (ts !== 0) return ts;
        return String(left.id).localeCompare(String(right.id));
      });
      return rows.slice(0, options.limit);
    },
  };
}

function adminPrincipal(overrides = {}) {
  return {
    sub: "admin-1",
    role: "Admin School",
    schoolCode: "SCH-A",
    permissions: ["Élèves:READ", "Gérer élèves"],
    ...overrides,
  };
}

function teacherPrincipal(assignments, overrides = {}) {
  return {
    sub: "teacher-1",
    role: "Enseignant",
    schoolCode: "SCH-A",
    permissions: ["Élèves:READ"],
    assignments,
    ...overrides,
  };
}

function defaultLiveRoleKeys(principal) {
  if (principal?.role === "Admin School") return ["SCHOOL_ADMIN"];
  if (principal?.role === "Enseignant") return ["TEACHER"];
  if (principal?.role === "Parent") return ["PARENT"];
  if (principal?.role === "Élève / Étudiant") return ["STUDENT"];
  if (principal?.role === "Comptable") return ["ACCOUNTANT"];
  return [];
}

async function sync(principal, extra = {}) {
  const {
    cursor,
    limit,
    rows,
    liveAssignments,
    liveRoleKeys,
    liveRoleKeysBySchool,
    assignedStudentIds,
    linkedByUser,
    selfByUser,
    failRoleKeys,
    failPermissions,
    failAssignments,
    failAssignedRoster,
    failParentLinks,
    failSelf,
    resolvePermissions,
    live,
  } = extra;
  const defaultRows = {
    "SCH-A": [
      studentRow(ID_A, "STU-A"),
      studentRow(ID_B, "STU-B", { classId: CLASS_B, classCode: "CLS-B" }),
      studentRow(ID_C, "STU-C"),
    ],
  };
  const liveState = live ?? {
    assignmentsByUser: {
      [principal.sub]: liveAssignments ?? [],
    },
    roleKeysByUser: {
      [principal.sub]: liveRoleKeys !== undefined ? liveRoleKeys : defaultLiveRoleKeys(principal),
    },
    roleKeysByUserSchool: liveRoleKeysBySchool,
    assignedStudentIds,
    linkedByUser,
    selfByUser,
    failRoleKeys: Boolean(failRoleKeys),
    failPermissions: Boolean(failPermissions),
    failAssignments: Boolean(failAssignments),
    failAssignedRoster: Boolean(failAssignedRoster),
    failParentLinks: Boolean(failParentLinks),
    failSelf: Boolean(failSelf),
    resolvePermissions,
    sqlCalls: 0,
  };
  return handleMobileSyncL1Students({
    principal,
    cursor,
    limit,
    tokenService: tokens,
    repository: createFakeRepo(rows ?? defaultRows, liveState),
    tenantScopeService,
  });
}

test("RBAC identique à GET /api/students", () => {
  assert.deepEqual(
    routePermissions["GET /api/mobile-sync/l1/students"],
    routePermissions["GET /api/students"],
  );
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Élèves:READ"] }, "GET /api/mobile-sync/l1/students"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Élèves:READ"] }, "GET /api/mobile-sync/l1/students"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Voir classes"] }, "GET /api/mobile-sync/l1/students"),
    false,
  );
  assert.equal(
    rbac.canAccess(
      { role: "Comptable", permissions: ["Gérer paiements", "Voir rapports financiers"] },
      "GET /api/mobile-sync/l1/students",
    ),
    false,
  );
});

test("clampLimit défaut 200, max 500", () => {
  assert.equal(clampLimit(undefined), 200);
  assert.equal(clampLimit("0"), 200);
  assert.equal(clampLimit("999"), 500);
});

test("CUSTOM_ROLE + Élèves:READ live → scopeKind=none, items=[], zéro lecture élève", async () => {
  const { resolveStudentsSyncScope } = require("./mobileSyncScope");
  const principal = {
    sub: "custom-1",
    role: "CUSTOM_ROLE",
    schoolCode: "SCH-A",
    permissions: ["Élèves:READ"],
  };
  const result = await sync(principal, {
    liveRoleKeys: ["CUSTOM_ROLE"],
    resolvePermissions: () => ({ permissions: ["Élèves:READ"] }),
  });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.items, []);
  const liveScope = resolveStudentsSyncScope({
    role: "CUSTOM_ROLE",
    roles: ["CUSTOM_ROLE"],
    roleKeys: ["CUSTOM_ROLE"],
    permissions: ["Élèves:READ"],
  });
  assert.equal(liveScope.scopeKind, "none");
});

test("cold sync admin : mode full, projection minimale, pas de PII", async () => {
  const result = await sync(adminPrincipal());
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.resource, "students");
  assert.equal(result.body.mode, "full");
  assert.equal(result.body.cursorStatus, "ok");
  assert.equal(result.body.items.length, 3);
  for (const item of result.body.items) {
    assert.deepEqual(Object.keys(item).sort(), STUDENT_ITEM_KEYS);
    assert.equal(Object.hasOwn(item, "parentPhone"), false);
    assert.equal(Object.hasOwn(item, "parentEmail"), false);
    assert.equal(Object.hasOwn(item, "photoUrl"), false);
    assert.equal(Object.hasOwn(item, "password"), false);
  }
});

test("pagination same timestamp : aucune perte, ordre id ASC", async () => {
  const page1 = await sync(adminPrincipal(), { limit: 2 });
  assert.equal(page1.body.items.length, 2);
  assert.equal(page1.body.hasMore, true);
  assert.deepEqual(
    page1.body.items.map((item) => item.id),
    [ID_A, ID_B],
  );
  const page2 = await sync(adminPrincipal(), { cursor: page1.body.nextCursor, limit: 2 });
  assert.equal(page2.body.mode, "delta");
  assert.deepEqual(
    page2.body.items.map((item) => item.id),
    [ID_C],
  );
});

test("update identité → delta school-wide", async () => {
  const rows = {
    "SCH-A": [studentRow(ID_A, "STU-A"), studentRow(ID_B, "STU-B"), studentRow(ID_C, "STU-C")],
  };
  const cold = await sync(adminPrincipal(), { rows });
  rows["SCH-A"][0] = studentRow(ID_A, "STU-A", { firstName: "Amina", syncUpdatedAt: LATER_TS });
  const warm = await sync(adminPrincipal(), { cursor: cold.body.nextCursor, rows });
  assert.equal(warm.body.mode, "delta");
  assert.equal(warm.body.items.length, 1);
  assert.equal(warm.body.items[0].firstName, "Amina");
});

test("création élève → delta school-wide", async () => {
  const rows = {
    "SCH-A": [studentRow(ID_A, "STU-A"), studentRow(ID_B, "STU-B"), studentRow(ID_C, "STU-C")],
  };
  const cold = await sync(adminPrincipal(), { rows });
  const idD = "00000000-0000-4000-8000-00000000000d";
  rows["SCH-A"].push(studentRow(idD, "STU-D", { syncUpdatedAt: LATER_TS }));
  const warm = await sync(adminPrincipal(), { cursor: cold.body.nextCursor, rows });
  assert.equal(warm.body.items.length, 1);
  assert.equal(warm.body.items[0].studentCode, "STU-D");
});

test("transfert classe A → B → delta school-wide avec nouveaux class refs", async () => {
  const rows = {
    "SCH-A": [studentRow(ID_A, "STU-A"), studentRow(ID_B, "STU-B"), studentRow(ID_C, "STU-C")],
  };
  const cold = await sync(adminPrincipal(), { rows });
  rows["SCH-A"][0] = studentRow(ID_A, "STU-A", {
    classId: CLASS_B,
    classCode: "CLS-B",
    syncUpdatedAt: LATER_TS,
  });
  const warm = await sync(adminPrincipal(), { cursor: cold.body.nextCursor, rows });
  assert.equal(warm.body.items[0].classId, CLASS_B);
  assert.equal(warm.body.items[0].classCode, "CLS-B");
  assert.equal(warm.body.items[0].tombstone, false);
});

test("inscription désactivée sans nouvelle classe → classId null, tombstone false", async () => {
  const rows = {
    "SCH-A": [studentRow(ID_A, "STU-A"), studentRow(ID_B, "STU-B"), studentRow(ID_C, "STU-C")],
  };
  const cold = await sync(adminPrincipal(), { rows });
  rows["SCH-A"][0] = studentRow(ID_A, "STU-A", {
    classId: null,
    classCode: null,
    enrollmentId: null,
    enrollmentStatus: null,
    academicYearId: null,
    syncUpdatedAt: LATER_TS,
  });
  const warm = await sync(adminPrincipal(), { cursor: cold.body.nextCursor, rows });
  assert.equal(warm.body.items[0].classId, null);
  assert.equal(warm.body.items[0].classCode, null);
  assert.equal(warm.body.items[0].tombstone, false);
  assert.equal(warm.body.items[0].status, "active");
});

test("student inactive → tombstone", async () => {
  const result = await sync(adminPrincipal(), {
    rows: {
      "SCH-A": [studentRow(ID_A, "STU-A", { status: "inactive", tombstone: true })],
    },
  });
  assert.equal(result.body.items[0].tombstone, true);
  assert.equal(result.body.items[0].status, "inactive");
});

test("teacher : seulement élèves des classes affectées live", async () => {
  const staleJwt = teacherPrincipal([
    { classId: CLASS_A, classCode: "CLS-A", status: "active" },
    { classId: CLASS_B, classCode: "CLS-B", status: "active" },
  ]);
  const result = await sync(staleJwt, {
    liveAssignments: [{ classId: CLASS_A, classCode: "CLS-A", status: "active" }],
  });
  assert.ok(result.body.items.length >= 1);
  assert.ok(result.body.items.every((item) => item.classCode === "CLS-A"));
  assert.ok(!result.body.items.some((item) => item.classCode === "CLS-B"));
});

test("ajout élève dans classe teacher → scope_changed", async () => {
  const teacher = teacherPrincipal([{ classId: CLASS_A, classCode: "CLS-A", status: "active" }]);
  const cold = await sync(teacher, {
    liveAssignments: [{ classId: CLASS_A, classCode: "CLS-A", status: "active" }],
    assignedStudentIds: [ID_A, ID_C],
  });
  const added = await sync(teacher, {
    cursor: cold.body.nextCursor,
    liveAssignments: [{ classId: CLASS_A, classCode: "CLS-A", status: "active" }],
    assignedStudentIds: [ID_A, ID_C, ID_B],
  });
  assert.equal(added.httpStatus, 409);
  assert.equal(added.body.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);
  assert.equal(added.body.mode, "full_required");
});

test("transfert élève hors classe teacher → scope_changed puis full sans élève", async () => {
  const teacher = teacherPrincipal([{ classId: CLASS_A, classCode: "CLS-A", status: "active" }]);
  const cold = await sync(teacher, {
    liveAssignments: [{ classId: CLASS_A, classCode: "CLS-A", status: "active" }],
    assignedStudentIds: [ID_A, ID_C],
  });
  assert.ok(cold.body.items.some((item) => item.id === ID_A));
  const transferred = await sync(teacher, {
    cursor: cold.body.nextCursor,
    liveAssignments: [{ classId: CLASS_A, classCode: "CLS-A", status: "active" }],
    assignedStudentIds: [ID_C],
    rows: {
      "SCH-A": [
        studentRow(ID_A, "STU-A", { classId: CLASS_B, classCode: "CLS-B" }),
        studentRow(ID_C, "STU-C"),
      ],
    },
  });
  assert.equal(transferred.body.cursorStatus, "scope_changed");
  const resync = await sync(teacher, {
    liveAssignments: [{ classId: CLASS_A, classCode: "CLS-A", status: "active" }],
    assignedStudentIds: [ID_C],
    rows: {
      "SCH-A": [
        studentRow(ID_A, "STU-A", { classId: CLASS_B, classCode: "CLS-B" }),
        studentRow(ID_C, "STU-C"),
      ],
    },
  });
  assert.equal(resync.httpStatus, 200);
  assert.ok(!resync.body.items.some((item) => item.id === ID_A));
  assert.ok(resync.body.items.some((item) => item.id === ID_C));
});

test("grant/revoke affectation teacher, même JWT → scope_changed", async () => {
  const staleJwt = teacherPrincipal([{ classId: CLASS_A, classCode: "CLS-A", status: "active" }]);
  const cold = await sync(staleJwt, {
    liveAssignments: [{ classId: CLASS_A, classCode: "CLS-A", status: "active" }],
  });
  const granted = await sync(staleJwt, {
    cursor: cold.body.nextCursor,
    liveAssignments: [
      { classId: CLASS_A, classCode: "CLS-A", status: "active" },
      { classId: CLASS_B, classCode: "CLS-B", status: "active" },
    ],
  });
  assert.equal(granted.body.cursorStatus, "scope_changed");
});

test("rôle tenant révoqué, même JWT → zéro élève", async () => {
  const result = await sync(adminPrincipal(), { liveRoleKeys: [] });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.items, []);
});

test("rôle autre établissement ne contamine pas", async () => {
  const dual = adminPrincipal({
    sub: "user-x",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Élèves:READ", "Gérer élèves"],
  });
  const result = await sync(dual, {
    liveRoleKeys: [],
    liveRoleKeysBySchool: {
      "user-x::sid-SCH-A": ["TEACHER"],
      "user-x::sid-SCH-B": ["SCHOOL_ADMIN"],
    },
    liveAssignments: [{ classId: CLASS_A, classCode: "CLS-A", status: "active" }],
    rows: {
      "SCH-A": [studentRow(ID_A, "STU-A"), studentRow(ID_B, "STU-B", { classId: CLASS_B, classCode: "CLS-B" })],
      "SCH-B": [studentRow("00000000-0000-4000-8000-0000000000bb", "STU-B-ONLY")],
    },
  });
  assert.deepEqual(
    result.body.items.map((item) => item.studentCode),
    ["STU-A"],
  );
});

test("permission Students school-scopée DENY → 403, pas de SQL", async () => {
  const live = {
    roleKeysByUser: { "teacher-1": ["TEACHER"] },
    assignmentsByUser: { "teacher-1": [{ classId: CLASS_A, classCode: "CLS-A", status: "active" }] },
    sqlCalls: 0,
    resolvePermissions: (principal) => {
      assert.equal(principal.schoolCode, "SCH-A");
      assert.equal(principal.sub, undefined);
      return { permissions: [] };
    },
  };
  const result = await handleMobileSyncL1Students({
    principal: teacherPrincipal([{ classId: CLASS_A, classCode: "CLS-A", status: "active" }]),
    tokenService: tokens,
    repository: createFakeRepo(
      { "SCH-A": [studentRow(ID_A, "STU-A")] },
      live,
    ),
    tenantScopeService,
  });
  assert.equal(result.httpStatus, 403);
  assert.equal(result.body.code, PERMISSION_DENIED);
  assert.equal(result.body.items, undefined);
  assert.equal(live.sqlCalls, 0);
});

test("ACCOUNTANT@A + SCHOOL_ADMIN@B + JWT Admin@A → 403, zéro SQL", async () => {
  const live = {
    roleKeysByUserSchool: {
      "user-acc::sid-SCH-A": ["ACCOUNTANT"],
      "user-acc::sid-SCH-B": ["SCHOOL_ADMIN"],
    },
    sqlCalls: 0,
  };
  const result = await handleMobileSyncL1Students({
    principal: adminPrincipal({
      sub: "user-acc",
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: ["Élèves:READ", "Gérer élèves"],
    }),
    tokenService: tokens,
    repository: createFakeRepo({ "SCH-A": [studentRow(ID_A, "STU-A")] }, live),
    tenantScopeService,
  });
  assert.equal(result.httpStatus, 403);
  assert.equal(result.body.code, PERMISSION_DENIED);
  assert.equal(live.sqlCalls, 0);
});

test("parent link live grant/revoke → scope_changed", async () => {
  const parent = {
    sub: "parent-1",
    role: "Parent",
    schoolCode: "SCH-A",
    permissions: ["Élèves:READ"],
    studentIds: ["jwt-should-be-ignored"],
  };
  const cold = await sync(parent, {
    liveRoleKeys: ["PARENT"],
    linkedByUser: { "parent-1": [{ studentId: ID_A }] },
  });
  assert.deepEqual(
    cold.body.items.map((item) => item.id),
    [ID_A],
  );
  const revoked = await sync(parent, {
    cursor: cold.body.nextCursor,
    liveRoleKeys: ["PARENT"],
    linkedByUser: { "parent-1": [] },
  });
  assert.equal(revoked.body.cursorStatus, "scope_changed");
});

test("student self → uniquement soi-même, ignore studentId client", async () => {
  const student = {
    sub: "student-1",
    role: "Élève / Étudiant",
    schoolCode: "SCH-A",
    permissions: ["Élèves:READ"],
    studentIds: [ID_B],
  };
  const result = await sync(student, {
    liveRoleKeys: ["STUDENT"],
    selfByUser: { "student-1": { studentId: ID_A } },
  });
  assert.deepEqual(
    result.body.items.map((item) => item.id),
    [ID_A],
  );
});

test("cursor tamper → 400", async () => {
  const cold = await sync(adminPrincipal());
  const tampered = `${cold.body.nextCursor.slice(0, -2)}aa`;
  await assert.rejects(
    () => sync(adminPrincipal(), { cursor: tampered }),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("cursor Classes utilisé sur Students → 400", async () => {
  const classesCursor = encodeMobileSyncCursor(
    {
      resource: "classes",
      schoolCode: "SCH-A",
      schoolId: "sid-SCH-A",
      principalId: "admin-1",
      scopeHash: "abc",
    },
    tokens,
  );
  await assert.rejects(
    () => sync(adminPrincipal(), { cursor: classesCursor }),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("cursor autre tenant → 403", async () => {
  const cold = await sync(adminPrincipal());
  await assert.rejects(
    () => sync(adminPrincipal({ schoolCode: "SCH-B" }), { cursor: cold.body.nextCursor }),
    (error) => error.statusCode === 403 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("cursor autre principal → 400", async () => {
  const cold = await sync(adminPrincipal({ sub: "user-a" }));
  await assert.rejects(
    () => sync(adminPrincipal({ sub: "user-b" }), { cursor: cold.body.nextCursor }),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("expired schema/generation → 409 full_required", async () => {
  const expired = tokens.sign(
    {
      typ: "mobile-sync-cursor",
      sv: 99,
      gen: 1,
      resource: "students",
      schoolCode: "SCH-A",
      schoolId: "sid-SCH-A",
      principalId: "admin-1",
      scopeHash: "x",
    },
    3600,
  );
  const result = await sync(adminPrincipal(), { cursor: expired });
  assert.equal(result.httpStatus, 409);
  assert.equal(result.body.code, MOBILE_SYNC_ERROR.CURSOR_EXPIRED);
  assert.equal(result.body.mode, "full_required");
});

test("mémoire/non-PG → 503", async () => {
  const result = await handleMobileSyncL1Students({
    principal: adminPrincipal(),
    tokenService: tokens,
    repository: { getSchoolByCode: async () => ({ id: "x", school_code: "SCH-A" }) },
    tenantScopeService,
  });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.code, MOBILE_SYNC_ERROR.POSTGRES_REQUIRED);
});

test("erreur rôle/permission/assignment/link PG → 503 zéro donnée", async () => {
  for (const flag of ["failRoleKeys", "failPermissions", "failAssignments", "failAssignedRoster", "failParentLinks", "failSelf"]) {
    const principal =
      flag === "failParentLinks"
        ? { sub: "parent-1", role: "Parent", schoolCode: "SCH-A", permissions: ["Élèves:READ"] }
        : flag === "failSelf"
          ? { sub: "student-1", role: "Élève / Étudiant", schoolCode: "SCH-A", permissions: ["Élèves:READ"] }
          : flag === "failAssignments" || flag === "failAssignedRoster"
            ? teacherPrincipal([{ classId: CLASS_A, classCode: "CLS-A", status: "active" }])
            : adminPrincipal();
    const result = await sync(principal, {
      [flag]: true,
      liveAssignments:
        flag === "failAssignments" || flag === "failAssignedRoster"
          ? [{ classId: CLASS_A, classCode: "CLS-A", status: "active" }]
          : undefined,
    });
    assert.equal(result.httpStatus, 503, flag);
    assert.equal(result.body.code, MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE, flag);
    assert.equal(result.body.items, undefined, flag);
  }
});

test("scopeHash students distinct du scopeHash classes", () => {
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const { computeClassesScopeHash } = require("./mobileSyncScope");
  const students = computeStudentsScopeHash(adminPrincipal(), school);
  const classes = computeClassesScopeHash(
    {
      sub: "admin-1",
      role: "Admin School",
      schoolCode: "SCH-A",
      permissions: ["Voir classes", "Gérer classes"],
    },
    school,
  );
  assert.notEqual(students.scopeHash, classes.scopeHash);
});

test("handler Students n'utilise pas backoffice_state / overlay legacy", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./mobileSyncStudents.js"), "utf8");
  assert.doesNotMatch(src, /backoffice_state/);
  assert.doesNotMatch(src, /legacy/i);
  assert.doesNotMatch(src, /overlay/i);
});
