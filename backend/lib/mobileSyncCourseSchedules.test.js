"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TokenService } = require("../services/tokenService");
const { RbacService, routePermissions, PERMISSION_DENIED } = require("../services/rbacService");
const { TenantScopeService } = require("../services/tenantScopeService");
const { MOBILE_SYNC_ERROR, MOBILE_SYNC_CURSOR_TYP, MOBILE_SYNC_GENERATION } = require("./mobileSyncErrors");
const { handleMobileSyncL1CourseSchedules, clampLimit } = require("./mobileSyncCourseSchedules");
const { encodeMobileSyncCursor } = require("./mobileSyncCursor");
const { mapMobileSyncCourseScheduleRow, SELECT_COURSE_SCHEDULE_SYNC } = require("../db/courseSchedulesRepository");
const { WEEKLY_SLOT_SELECT, REPLACEMENT_SELECT } = require("../db/pedagogyPgStore");

const tokens = new TokenService({ secret: "ci-test-secret-with-enough-length-for-production-checks" });
const tenantScopeService = new TenantScopeService();
const rbac = new RbacService();

const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";
const ID_C = "00000000-0000-4000-8000-00000000000c";
const TEACHER_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLASS_A = "11111111-1111-4111-8111-111111111111";
const CLASS_B = "22222222-2222-4222-8222-222222222222";
const SUBJECT_MATH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT_FR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb0f";
const COURSE_MATH = "dddddddd-dddd-4ddd-8ddd-dddddddddd0a";
const SAME_TS = "2026-08-26T08:00:00.000Z";

const ITEM_KEYS = [
  "academicYearId",
  "classCode",
  "classId",
  "courseCode",
  "dayOfWeek",
  "endTime",
  "id",
  "roomCode",
  "roomId",
  "schoolCourseId",
  "startTime",
  "status",
  "subjectCode",
  "subjectId",
  "teacherCode",
  "teacherId",
  "tombstone",
  "updatedAt",
];

function slotRow(id, overrides = {}) {
  return {
    id,
    schoolCourseId: COURSE_MATH,
    courseCode: "CRS-MATH",
    academicYearId: "ay-1",
    classId: CLASS_A,
    classCode: "CLS-A",
    subjectId: SUBJECT_MATH,
    subjectCode: "SUB-MATH",
    teacherId: TEACHER_UUID,
    teacherCode: "TCH-A",
    roomId: null,
    roomCode: null,
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "09:00",
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
      if (live.failRoleKeys) throw new Error("pg roles unavailable");
      if (!schoolId) return [];
      const keys = live.roleKeysByUser?.[userId];
      return Array.isArray(keys) ? keys : [];
    },
    async resolveEffectivePermissions(principal) {
      if (live.failPermissions) throw new Error("pg permissions unavailable");
      if (typeof live.resolvePermissions === "function") return live.resolvePermissions(principal);
      const keys = new Set(principal.roleKeys ?? []);
      if (keys.has("SCHOOL_ADMIN") || keys.has("TEACHER")) {
        return { permissions: ["Planning de cours:READ"] };
      }
      return { permissions: [] };
    },
    async getLiveTeacherIdentityForSchool(userId) {
      if (live.failTeacherIdentity) throw new Error("pg teacher identity unavailable");
      return live.teacherByUser?.[userId] ?? null;
    },
    async listLiveTeacherAssignmentPairsForSync(_schoolId, teacherId) {
      if (live.failAssignmentPairs) throw new Error("pg assignment pairs unavailable");
      return live.pairsByTeacher?.[teacherId] ?? [];
    },
    async listCourseSchedulesForMobileSync(schoolCode, options = {}) {
      live.lastQuery = { schoolCode, ...options };
      let rows = [...(rowsBySchool[schoolCode] ?? [])];
      if (Array.isArray(options.teacherIds)) {
        if (!options.teacherIds.length) return [];
        const allowed = new Set(options.teacherIds);
        rows = rows.filter((row) => allowed.has(row.teacherId));
      }
      if (Array.isArray(options.coursePairs)) {
        if (!options.coursePairs.length) return [];
        const keys = new Set(options.coursePairs.map((pair) => `${pair.classId}|${pair.subjectId}`));
        rows = rows.filter((row) => keys.has(`${row.classId}|${row.subjectId}`));
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
    permissions: ["Planning de cours:READ"],
    ...overrides,
  };
}

function teacherPrincipal(overrides = {}) {
  return {
    sub: "teacher-1",
    role: "Enseignant",
    schoolCode: "SCH-A",
    permissions: ["Planning de cours:READ"],
    teacherCode: "JWT-CODE",
    ...overrides,
  };
}

async function sync(principal, { rows, live, cursor, limit } = {}) {
  const liveState = {
    roleKeysByUser: {
      "admin-1": ["SCHOOL_ADMIN"],
      "teacher-1": ["TEACHER"],
      "accountant-1": ["ACCOUNTANT"],
    },
    teacherByUser: {
      "teacher-1": { teacherId: TEACHER_UUID, teacherCode: "TCH-A", teacherUserId: "teacher-1" },
    },
    pairsByTeacher: {
      [TEACHER_UUID]: [{ assignmentId: "asg-math", classId: CLASS_A, subjectId: SUBJECT_MATH }],
    },
    ...live,
  };
  return handleMobileSyncL1CourseSchedules({
    principal,
    cursor,
    limit,
    tokenService: tokens,
    repository: createFakeRepo(rows ?? { "SCH-A": [slotRow(ID_A)] }, liveState),
    tenantScopeService,
  });
}

test("RBAC identique à GET /api/course-schedules", () => {
  assert.deepEqual(routePermissions["GET /api/mobile-sync/l1/course-schedules"], [
    "Planning de cours:READ",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["GET /api/course-schedules"], ["Planning de cours:READ", "ALL_PRIVILEGES"]);
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Planning de cours:READ"] }, "GET /api/mobile-sync/l1/course-schedules"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Comptable", permissions: ["Gérer paiements"] }, "GET /api/mobile-sync/l1/course-schedules"),
    false,
  );
});

test("WEEKLY_SLOT_SELECT et L1 SELECT exigent school_id ; roomId = r.id", () => {
  assert.match(WEEKLY_SLOT_SELECT, /JOIN school_courses sc ON sc\.id = w\.school_course_id\s+AND sc\.school_id = w\.school_id/);
  assert.match(WEEKLY_SLOT_SELECT, /JOIN classes c ON c\.id = w\.class_id\s+AND c\.school_id = w\.school_id/);
  assert.match(WEEKLY_SLOT_SELECT, /JOIN academic_years ay ON ay\.id = w\.academic_year_id\s+AND ay\.school_id = w\.school_id/);
  assert.match(WEEKLY_SLOT_SELECT, /JOIN teachers t ON t\.id = w\.teacher_id\s+AND t\.school_id = w\.school_id/);
  assert.match(WEEKLY_SLOT_SELECT, /JOIN subjects sub ON sub\.id = sc\.subject_id\s+AND sub\.school_id = w\.school_id/);
  assert.match(WEEKLY_SLOT_SELECT, /LEFT JOIN school_rooms r ON r\.id = w\.room_id\s+AND r\.school_id = w\.school_id/);
  assert.match(WEEKLY_SLOT_SELECT, /r\.id AS room_id/);
  assert.equal(WEEKLY_SLOT_SELECT.includes("w.room_id,"), false);
  assert.match(REPLACEMENT_SELECT, /AND w\.school_id = r\.school_id/);
  assert.match(REPLACEMENT_SELECT, /AND orig\.school_id = r\.school_id/);
  assert.match(REPLACEMENT_SELECT, /AND subste\.school_id = r\.school_id/);
  assert.match(SELECT_COURSE_SCHEDULE_SYNC, /AND t\.school_id = w\.school_id/);
  assert.equal(
    mapMobileSyncCourseScheduleRow({
      id: "s",
      school_course_id: COURSE_MATH,
      course_code: "CRS",
      academic_year_id: "ay",
      class_id: CLASS_A,
      class_code: "CLS",
      subject_id: SUBJECT_MATH,
      subject_code: "MATH",
      teacher_id: TEACHER_UUID,
      teacher_code: "TCH",
      room_id: null,
      room_code: null,
      day_of_week: 2,
      start_time: "08:00:00",
      end_time: "09:00:00",
      status: "cancelled",
      updated_at: SAME_TS,
    }).tombstone,
    true,
  );
});

test("cold Admin school-wide : full + tombstone cancelled/archived", async () => {
  const result = await sync(adminPrincipal(), {
    rows: {
      "SCH-A": [
        slotRow(ID_A),
        slotRow(ID_B, { status: "cancelled", tombstone: true }),
        slotRow(ID_C, { status: "archived", tombstone: true }),
      ],
    },
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.resource, "course-schedules");
  assert.equal(result.body.mode, "full");
  assert.equal(result.body.items.length, 3);
  assert.equal(result.body.items.find((item) => item.id === ID_B).tombstone, true);
  assert.equal(result.body.items.find((item) => item.id === ID_C).status, "archived");
  for (const item of result.body.items) {
    assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS);
    assert.equal(Object.hasOwn(item, "className"), false);
    assert.equal(Object.hasOwn(item, "subjectName"), false);
    assert.equal(Object.hasOwn(item, "teacherName"), false);
  }
});

test("création créneau → delta school-wide", async () => {
  const rows = { "SCH-A": [slotRow(ID_A)] };
  const cold = await sync(adminPrincipal(), { rows });
  rows["SCH-A"].push(slotRow(ID_C, { updatedAt: "2026-08-26T09:00:00.000Z" }));
  const warm = await sync(adminPrincipal(), { rows, cursor: cold.body.nextCursor });
  assert.equal(warm.body.mode, "delta");
  assert.deepEqual(warm.body.items.map((item) => item.id), [ID_C]);
});

test("Teacher : A/Maths visible, A/Français et B/Maths cachés même si teacher_id=T", async () => {
  const result = await sync(teacherPrincipal(), {
    rows: {
      "SCH-A": [
        slotRow(ID_A, { classId: CLASS_A, subjectId: SUBJECT_MATH }),
        slotRow(ID_B, {
          classId: CLASS_A,
          subjectId: SUBJECT_FR,
          subjectCode: "FR",
          teacherId: TEACHER_UUID,
        }),
        slotRow(ID_C, {
          classId: CLASS_B,
          classCode: "CLS-B",
          subjectId: SUBJECT_MATH,
          teacherId: TEACHER_UUID,
        }),
      ],
    },
  });
  assert.deepEqual(result.body.items.map((item) => item.id), [ID_A]);
});

test("JWT Admin stale + PG Teacher → assigned", async () => {
  const result = await sync(
    adminPrincipal({
      sub: "teacher-1",
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: ["Planning de cours:READ", "ALL_PRIVILEGES"],
    }),
    {
      live: { roleKeysByUser: { "teacher-1": ["TEACHER"] } },
      rows: {
        "SCH-A": [
          slotRow(ID_A),
          slotRow(ID_B, { classId: CLASS_B, classCode: "CLS-B", subjectId: SUBJECT_FR }),
        ],
      },
    },
  );
  assert.deepEqual(result.body.items.map((item) => item.id), [ID_A]);
});

test("affectation ajoutée → scope_changed", async () => {
  const live = {
    pairsByTeacher: {
      [TEACHER_UUID]: [{ assignmentId: "asg-math", classId: CLASS_A, subjectId: SUBJECT_MATH }],
    },
  };
  const cold = await sync(teacherPrincipal(), { live });
  live.pairsByTeacher[TEACHER_UUID] = [
    { assignmentId: "asg-math", classId: CLASS_A, subjectId: SUBJECT_MATH },
    { assignmentId: "asg-fr", classId: CLASS_A, subjectId: SUBJECT_FR },
  ];
  const granted = await sync(teacherPrincipal(), { live, cursor: cold.body.nextCursor });
  assert.equal(granted.httpStatus, 409);
  assert.equal(granted.body.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);
});

test("Comptable live → 403", async () => {
  const result = await sync({
    sub: "accountant-1",
    role: "Comptable",
    schoolCode: "SCH-A",
    permissions: ["Gérer paiements"],
  });
  assert.equal(result.httpStatus, 403);
  assert.equal(result.body.code, PERMISSION_DENIED);
});

test("permission live révoquée → 403", async () => {
  const result = await sync(teacherPrincipal(), {
    live: { resolvePermissions: () => ({ permissions: [] }) },
  });
  assert.equal(result.httpStatus, 403);
});

test("rôle Teacher révoqué → zéro donnée", async () => {
  const result = await sync(teacherPrincipal(), { live: { roleKeysByUser: { "teacher-1": [] } } });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.items, []);
});

test("CUSTOM_ROLE + Planning:READ → none", async () => {
  const result = await sync(
    adminPrincipal({ sub: "custom-1", role: "Admin School", permissions: ["Planning de cours:READ"] }),
    { live: { roleKeysByUser: { "custom-1": ["CUSTOM_ROLE"] } } },
  );
  assert.deepEqual(result.body.items, []);
});

test("curseur school-courses → course-schedules : 400", async () => {
  const cursor = encodeMobileSyncCursor(
    {
      resource: "school-courses",
      schoolCode: "SCH-A",
      schoolId: "sid-SCH-A",
      principalId: "admin-1",
      scopeHash: "deadbeef",
      lastUpdatedAt: SAME_TS,
      lastId: ID_A,
    },
    tokens,
  );
  await assert.rejects(
    () => sync(adminPrincipal(), { cursor }),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("curseur expiré → 409 full_required", async () => {
  const expired = tokens.sign(
    {
      typ: MOBILE_SYNC_CURSOR_TYP,
      sv: 99,
      gen: MOBILE_SYNC_GENERATION,
      resource: "course-schedules",
      schoolCode: "SCH-A",
      schoolId: "sid-SCH-A",
      principalId: "admin-1",
      scopeHash: "abc",
      lastUpdatedAt: SAME_TS,
      lastId: ID_A,
    },
    3600,
  );
  const result = await sync(adminPrincipal(), { cursor: expired });
  assert.equal(result.httpStatus, 409);
  assert.equal(result.body.code, MOBILE_SYNC_ERROR.CURSOR_EXPIRED);
  assert.equal(result.body.mode, "full_required");
});

test("erreur live roles → 503", async () => {
  const result = await sync(adminPrincipal(), { live: { failRoleKeys: true } });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.code, MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE);
});

test("mémoire sans listCourseSchedulesForMobileSync → 503", async () => {
  const result = await handleMobileSyncL1CourseSchedules({
    principal: adminPrincipal(),
    tokenService: tokens,
    repository: {
      async getSchoolByCode(code) {
        return { id: `sid-${code}`, school_code: code };
      },
    },
    tenantScopeService,
  });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.code, MOBILE_SYNC_ERROR.POSTGRES_REQUIRED);
});

test("limit serveur clampée à 500", () => {
  assert.equal(clampLimit(null), 200);
  assert.equal(clampLimit(9999), 500);
});
