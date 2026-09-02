"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TokenService } = require("../services/tokenService");
const { RbacService, routePermissions, PERMISSION_DENIED } = require("../services/rbacService");
const { TenantScopeService } = require("../services/tenantScopeService");
const { MOBILE_SYNC_ERROR } = require("./mobileSyncErrors");
const { handleMobileSyncL1Assignments, clampLimit } = require("./mobileSyncAssignments");
const { encodeMobileSyncCursor } = require("./mobileSyncCursor");
const { computeAssignmentsScopeHash } = require("./mobileSyncScope");

const tokens = new TokenService({ secret: "ci-test-secret-with-enough-length-for-production-checks" });
const tenantScopeService = new TenantScopeService();
const rbac = new RbacService();

const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";
const ID_C = "00000000-0000-4000-8000-00000000000c";
const TEACHER_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEACHER_UUID_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccbb";
const CLASS_A = "11111111-1111-4111-8111-111111111111";
const CLASS_B = "22222222-2222-4222-8222-222222222222";
const CLASS_C = "33333333-3333-4333-8333-333333333333";
const SUBJECT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SAME_TS = "2026-08-26T08:00:00.000Z";

const ASSIGNMENT_ITEM_KEYS = [
  "academicYearId",
  "assignmentRole",
  "classCode",
  "classId",
  "id",
  "status",
  "subjectCode",
  "subjectId",
  "teacherCode",
  "teacherId",
  "teacherUserId",
  "tombstone",
  "updatedAt",
];

function assignmentRow(id, overrides = {}) {
  return {
    id,
    teacherId: TEACHER_UUID,
    teacherCode: "TCH-A",
    teacherUserId: "teacher-1",
    classId: CLASS_A,
    classCode: "CLS-A",
    subjectId: SUBJECT_A,
    subjectCode: "SUB-A",
    academicYearId: "ay-1",
    assignmentRole: "primary",
    status: "active",
    updatedAt: SAME_TS,
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
        return { permissions: ["Affectations:READ", "Enseignants:READ"] };
      }
      if (keys.has("TEACHER")) {
        return { permissions: ["Affectations:READ"] };
      }
      return { permissions: [] };
    },
    async getLiveTeacherIdentityForSchool(userId, schoolId) {
      if (live.failTeacherIdentity) {
        throw new Error("pg teacher identity unavailable");
      }
      const keyed = live.teacherByUserSchool?.[`${userId}::${schoolId}`];
      if (keyed) return keyed;
      return live.teacherByUser?.[userId] ?? null;
    },
    async listLiveTeacherAssignmentIdsForSync(_schoolId, teacherId) {
      if (live.failAssignmentIds) {
        throw new Error("pg assignment ids unavailable");
      }
      return live.assignmentIdsByTeacher?.[teacherId] ?? [];
    },
    async listSchoolTeacherAssignmentsForMobileSync(schoolCode, options = {}) {
      live.sqlCalls = (live.sqlCalls ?? 0) + 1;
      live.lastAssignmentQuery = { schoolCode, ...options };
      let rows = [...(rowsBySchool[schoolCode] ?? [])];
      if (Array.isArray(options.teacherIds)) {
        const ids = new Set(options.teacherIds ?? []);
        if (!ids.size) return [];
        rows = rows.filter((row) => ids.has(String(row.teacherId)));
      }
      if (options.activeOnly) {
        rows = rows.filter((row) => String(row.status ?? "").toLowerCase() === "active");
      }
      if (options.afterUpdatedAt && options.afterId) {
        const afterTs = new Date(options.afterUpdatedAt).getTime();
        rows = rows.filter((row) => {
          const ts = new Date(row.updatedAt).getTime();
          return ts > afterTs || (ts === afterTs && String(row.id) > String(options.afterId));
        });
      }
      rows.sort((left, right) => {
        const ts = new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
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
    permissions: ["Affectations:READ", "Enseignants:READ"],
    ...overrides,
  };
}

function teacherPrincipal(overrides = {}) {
  return {
    sub: "teacher-1",
    role: "Enseignant",
    schoolCode: "SCH-A",
    permissions: ["Affectations:READ"],
    teacherCode: "JWT-CODE",
    teacherId: "JWT-CODE",
    assignments: [{ id: ID_A, teacherCode: "JWT-CODE" }],
    ...overrides,
  };
}

function defaultLiveRoleKeys(principal) {
  if (principal?.role === "Admin School") return ["SCHOOL_ADMIN"];
  if (principal?.role === "Enseignant") return ["TEACHER"];
  return [];
}

function defaultRows() {
  return {
    "SCH-A": [
      assignmentRow(ID_A, { classId: CLASS_A, classCode: "CLS-A" }),
      assignmentRow(ID_B, {
        teacherId: TEACHER_UUID_B,
        teacherCode: "TCH-B",
        teacherUserId: "teacher-b",
        classId: CLASS_B,
        classCode: "CLS-B",
      }),
      assignmentRow(ID_C, { classId: CLASS_C, classCode: "CLS-C" }),
    ],
  };
}

async function sync(principal, extras = {}) {
  const live = {
    roleKeysByUser: {
      [principal.sub]: extras.liveRoleKeys !== undefined ? extras.liveRoleKeys : defaultLiveRoleKeys(principal),
    },
    roleKeysByUserSchool: extras.liveRoleKeysBySchool,
    teacherByUser: extras.teacherByUser ?? {
      "teacher-1": { teacherId: TEACHER_UUID, teacherCode: "TCH-A", teacherUserId: "teacher-1" },
    },
    assignmentIdsByTeacher: extras.assignmentIdsByTeacher ?? {
      [TEACHER_UUID]: [{ assignmentId: ID_A }, { assignmentId: ID_C }],
    },
    failRoleKeys: Boolean(extras.failRoleKeys),
    failPermissions: Boolean(extras.failPermissions),
    failTeacherIdentity: Boolean(extras.failTeacherIdentity),
    failAssignmentIds: Boolean(extras.failAssignmentIds),
    resolvePermissions: extras.resolvePermissions,
    sqlCalls: 0,
  };
  return handleMobileSyncL1Assignments({
    principal,
    cursor: extras.cursor,
    limit: extras.limit,
    tokenService: tokens,
    repository: createFakeRepo(extras.rows ?? defaultRows(), live),
    tenantScopeService,
  });
}

test("RBAC identique à GET /api/assignments", () => {
  assert.deepEqual(
    routePermissions["GET /api/mobile-sync/l1/assignments"],
    routePermissions["GET /api/assignments"],
  );
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Affectations:READ"] }, "GET /api/mobile-sync/l1/assignments"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Affectations:READ"] }, "GET /api/mobile-sync/l1/assignments"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Enseignants:READ"] }, "GET /api/mobile-sync/l1/assignments"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Voir classes"] }, "GET /api/mobile-sync/l1/assignments"),
    false,
  );
  assert.equal(
    rbac.canAccess(
      { role: "Comptable", permissions: ["Gérer paiements", "Voir rapports financiers"] },
      "GET /api/mobile-sync/l1/assignments",
    ),
    false,
  );
});

test("cold sync Admin school-wide : mode full, teacherId UUID, tombstone deleted", async () => {
  const result = await sync(adminPrincipal(), {
    rows: {
      "SCH-A": [
        assignmentRow(ID_A),
        assignmentRow(ID_B, { status: "deleted", tombstone: true, classCode: "CLS-B" }),
      ],
    },
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.resource, "assignments");
  assert.equal(result.body.mode, "full");
  assert.equal(result.body.cursorStatus, "ok");
  assert.equal(result.body.hasMore, false);
  assert.ok(result.body.scopeHash);
  assert.ok(result.body.nextCursor);
  assert.equal(result.body.items.length, 2);
  const deleted = result.body.items.find((item) => item.id === ID_B);
  assert.equal(deleted.tombstone, true);
  assert.equal(deleted.status, "deleted");
  for (const item of result.body.items) {
    assert.deepEqual(Object.keys(item).sort(), ASSIGNMENT_ITEM_KEYS);
    assert.equal(item.teacherId.includes("-"), true);
    assert.notEqual(item.teacherId, item.teacherCode);
    assert.equal(Object.hasOwn(item, "teacherName"), false);
    assert.equal(Object.hasOwn(item, "email"), false);
    assert.equal(Object.hasOwn(item, "phone"), false);
    assert.equal(Object.hasOwn(item, "payload"), false);
    assert.equal(Object.hasOwn(item, "photo"), false);
    assert.equal(Object.hasOwn(item, "backoffice_state"), false);
  }
});

test("création affectation → delta school-wide", async () => {
  const rows = defaultRows();
  const cold = await sync(adminPrincipal(), { rows });
  rows["SCH-A"].push(
    assignmentRow("00000000-0000-4000-8000-00000000000d", {
      classCode: "CLS-D",
      updatedAt: "2026-08-26T09:00:00.000Z",
    }),
  );
  const warm = await sync(adminPrincipal(), { cursor: cold.body.nextCursor, rows });
  assert.equal(warm.body.mode, "delta");
  assert.equal(warm.body.items.length, 1);
  assert.equal(warm.body.items[0].classCode, "CLS-D");
});

test("modification classe/matière → delta", async () => {
  const rows = defaultRows();
  const cold = await sync(adminPrincipal(), { rows });
  rows["SCH-A"][0] = {
    ...rows["SCH-A"][0],
    classCode: "CLS-A*",
    subjectCode: "SUB-A*",
    updatedAt: "2026-08-26T09:00:00.000Z",
  };
  const warm = await sync(adminPrincipal(), { cursor: cold.body.nextCursor, rows });
  assert.equal(warm.body.mode, "delta");
  assert.equal(warm.body.items.length, 1);
  assert.equal(warm.body.items[0].id, ID_A);
  assert.equal(warm.body.items[0].classCode, "CLS-A*");
  assert.equal(warm.body.items[0].subjectCode, "SUB-A*");
});

test("mêmes updated_at : aucune perte, aucun doublon, ordre id ASC", async () => {
  const result = await sync(adminPrincipal(), { limit: 2 });
  assert.equal(result.body.items.length, 2);
  assert.equal(result.body.hasMore, true);
  assert.deepEqual(
    result.body.items.map((item) => item.id),
    [ID_A, ID_B],
  );
  const page2 = await sync(adminPrincipal(), { cursor: result.body.nextCursor, limit: 2 });
  assert.equal(page2.body.mode, "delta");
  assert.deepEqual(
    page2.body.items.map((item) => item.id),
    [ID_C],
  );
  const seen = new Set([...result.body.items, ...page2.body.items].map((item) => item.id));
  assert.equal(seen.size, 3);
});

test("Teacher : uniquement ses affectations (filtre UUID live, pas JWT teacherCode)", async () => {
  const result = await sync(teacherPrincipal());
  assert.deepEqual(
    result.body.items.map((item) => item.id).sort(),
    [ID_A, ID_C],
  );
  assert.ok(!result.body.items.some((item) => item.teacherCode === "TCH-B"));
  assert.ok(result.body.items.every((item) => item.teacherId === TEACHER_UUID));
});

test("JWT Admin stale + rôle live Teacher → uniquement Teacher", async () => {
  const staleAdmin = adminPrincipal({
    sub: "teacher-1",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Affectations:READ", "ALL_PRIVILEGES"],
    teacherCode: "JWT-ADMIN",
  });
  const result = await sync(staleAdmin, { liveRoleKeys: ["TEACHER"] });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(
    result.body.items.map((item) => item.id).sort(),
    [ID_A, ID_C],
  );
  assert.ok(!result.body.items.some((item) => item.id === ID_B));
});

test("JWT Teacher stale + rôle live Admin → school-wide", async () => {
  const staleTeacher = teacherPrincipal({
    sub: "admin-1",
    role: "Enseignant",
    roleKeys: ["TEACHER"],
  });
  const result = await sync(staleTeacher, { liveRoleKeys: ["SCHOOL_ADMIN"] });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.items.length, 3);
});

test("affectation ajoutée Teacher → scope_changed", async () => {
  const cold = await sync(teacherPrincipal(), {
    assignmentIdsByTeacher: { [TEACHER_UUID]: [{ assignmentId: ID_A }] },
  });
  const granted = await sync(teacherPrincipal(), {
    cursor: cold.body.nextCursor,
    assignmentIdsByTeacher: { [TEACHER_UUID]: [{ assignmentId: ID_A }, { assignmentId: ID_C }] },
  });
  assert.equal(granted.httpStatus, 409);
  assert.equal(granted.body.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);
  assert.equal(granted.body.cursorStatus, "scope_changed");
  assert.equal(granted.body.mode, "full_required");
});

test("affectation retirée → scope_changed puis full sans la ligne", async () => {
  const rows = defaultRows();
  const cold = await sync(teacherPrincipal(), {
    rows,
    assignmentIdsByTeacher: { [TEACHER_UUID]: [{ assignmentId: ID_A }, { assignmentId: ID_C }] },
  });
  const revoked = await sync(teacherPrincipal(), {
    cursor: cold.body.nextCursor,
    rows,
    assignmentIdsByTeacher: { [TEACHER_UUID]: [{ assignmentId: ID_A }] },
  });
  assert.equal(revoked.body.cursorStatus, "scope_changed");
  rows["SCH-A"] = rows["SCH-A"].map((row) =>
    row.id === ID_C ? { ...row, status: "deleted", tombstone: true } : row,
  );
  const resync = await sync(teacherPrincipal(), {
    rows,
    assignmentIdsByTeacher: { [TEACHER_UUID]: [{ assignmentId: ID_A }] },
  });
  assert.deepEqual(
    resync.body.items.map((item) => item.id),
    [ID_A],
  );
});

test("rôle Teacher révoqué → zéro donnée", async () => {
  const result = await sync(teacherPrincipal(), { liveRoleKeys: [] });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.items, []);
});

test("permission live révoquée → 403 avant SQL", async () => {
  const live = {
    roleKeysByUser: { "teacher-1": ["TEACHER"] },
    teacherByUser: {
      "teacher-1": { teacherId: TEACHER_UUID, teacherCode: "TCH-A", teacherUserId: "teacher-1" },
    },
    assignmentIdsByTeacher: { [TEACHER_UUID]: [{ assignmentId: ID_A }] },
    sqlCalls: 0,
    resolvePermissions: () => ({ permissions: [] }),
  };
  const result = await handleMobileSyncL1Assignments({
    principal: teacherPrincipal(),
    tokenService: tokens,
    repository: createFakeRepo(defaultRows(), live),
    tenantScopeService,
  });
  assert.equal(result.httpStatus, 403);
  assert.equal(result.body.code, PERMISSION_DENIED);
  assert.equal(result.body.items, undefined);
  assert.equal(live.sqlCalls, 0);
});

test("rôle SchoolB ne contamine pas SchoolA", async () => {
  const dual = adminPrincipal({
    sub: "user-x",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
  });
  const result = await sync(dual, {
    liveRoleKeys: [],
    liveRoleKeysBySchool: {
      "user-x::sid-SCH-A": ["TEACHER"],
      "user-x::sid-SCH-B": ["SCHOOL_ADMIN"],
    },
    teacherByUser: {
      "user-x": { teacherId: TEACHER_UUID, teacherCode: "TCH-A", teacherUserId: "user-x" },
    },
    assignmentIdsByTeacher: { [TEACHER_UUID]: [{ assignmentId: ID_A }] },
  });
  assert.deepEqual(
    result.body.items.map((item) => item.id).sort(),
    [ID_A, ID_C],
  );
  assert.ok(!result.body.items.some((item) => item.id === ID_B));
});

test("CUSTOM_ROLE + Affectations:READ → none", async () => {
  const { resolveAssignmentsSyncScope } = require("./mobileSyncScope");
  const live = {
    roleKeysByUser: { "custom-1": ["CUSTOM_ROLE"] },
    sqlCalls: 0,
    resolvePermissions: () => ({ permissions: ["Affectations:READ"] }),
  };
  const result = await handleMobileSyncL1Assignments({
    principal: adminPrincipal({
      sub: "custom-1",
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: ["Affectations:READ", "ALL_PRIVILEGES"],
    }),
    tokenService: tokens,
    repository: createFakeRepo(defaultRows(), live),
    tenantScopeService,
  });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.items, []);
  assert.deepEqual(live.lastAssignmentQuery.teacherIds, []);
  assert.equal(resolveAssignmentsSyncScope({
    role: "CUSTOM_ROLE",
    roles: ["CUSTOM_ROLE"],
    roleKeys: ["CUSTOM_ROLE"],
    permissions: ["Affectations:READ"],
  }).scopeKind, "none");
});

test("curseur Classes → Assignments : 400", async () => {
  const classesCursor = encodeMobileSyncCursor(
    {
      resource: "classes",
      schoolCode: "SCH-A",
      schoolId: "sid-SCH-A",
      principalId: "admin-1",
      scopeHash: "abc",
      lastUpdatedAt: SAME_TS,
      lastId: ID_A,
    },
    tokens,
  );
  await assert.rejects(
    () => sync(adminPrincipal(), { cursor: classesCursor }),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("curseur Students → Assignments : 400", async () => {
  const studentsCursor = encodeMobileSyncCursor(
    {
      resource: "students",
      schoolCode: "SCH-A",
      schoolId: "sid-SCH-A",
      principalId: "admin-1",
      scopeHash: "abc",
      lastUpdatedAt: SAME_TS,
      lastId: ID_A,
    },
    tokens,
  );
  await assert.rejects(
    () => sync(adminPrincipal(), { cursor: studentsCursor }),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("cursor school A sous school B → 403 fail-closed", async () => {
  const cold = await sync(adminPrincipal());
  await assert.rejects(
    () => sync(adminPrincipal({ schoolCode: "SCH-B" }), { cursor: cold.body.nextCursor }),
    (error) => error.statusCode === 403 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("cursor user A sous principal B → 400 fail-closed", async () => {
  const cold = await sync(adminPrincipal({ sub: "user-a" }));
  await assert.rejects(
    () => sync(adminPrincipal({ sub: "user-b" }), { cursor: cold.body.nextCursor }),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("cursor expiré / schema / génération → full_required", async () => {
  const principal = adminPrincipal();
  const { scopeHash } = computeAssignmentsScopeHash(principal, {
    schoolCode: "SCH-A",
    schoolId: "sid-SCH-A",
  });
  const expired = encodeMobileSyncCursor(
    {
      resource: "assignments",
      schoolCode: "SCH-A",
      schoolId: "sid-SCH-A",
      principalId: principal.sub,
      scopeHash,
      lastUpdatedAt: SAME_TS,
      lastId: ID_A,
    },
    tokens,
    { ttlSeconds: -60 },
  );
  const result = await sync(principal, { cursor: expired });
  assert.equal(result.httpStatus, 409);
  assert.equal(result.body.code, MOBILE_SYNC_ERROR.CURSOR_EXPIRED);
  assert.equal(result.body.mode, "full_required");
});

test("limit serveur clampée à 500", () => {
  assert.equal(clampLimit(undefined), 200);
  assert.equal(clampLimit("12"), 12);
  assert.equal(clampLimit("9999"), 500);
  assert.equal(clampLimit("0"), 200);
});

test("mémoire sans listSchoolTeacherAssignmentsForMobileSync → 503 PostgreSQL requis", async () => {
  const result = await handleMobileSyncL1Assignments({
    principal: adminPrincipal(),
    tokenService: tokens,
    repository: { getSchoolByCode: async () => ({ id: "x", school_code: "SCH-A" }) },
    tenantScopeService,
  });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.code, MOBILE_SYNC_ERROR.POSTGRES_REQUIRED);
});

test("erreur live roles / permissions / teacher identity → 503", async () => {
  const roles = await sync(adminPrincipal(), { failRoleKeys: true });
  assert.equal(roles.httpStatus, 503);
  assert.equal(roles.body.code, MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE);
  const perms = await sync(adminPrincipal(), { failPermissions: true });
  assert.equal(perms.httpStatus, 503);
  const identity = await sync(teacherPrincipal(), { failTeacherIdentity: true });
  assert.equal(identity.httpStatus, 503);
  assert.equal(identity.body.code, MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE);
});
