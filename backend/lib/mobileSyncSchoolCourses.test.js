"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TokenService } = require("../services/tokenService");
const { RbacService, routePermissions, PERMISSION_DENIED } = require("../services/rbacService");
const { TenantScopeService } = require("../services/tenantScopeService");
const { MOBILE_SYNC_ERROR } = require("./mobileSyncErrors");
const { handleMobileSyncL1SchoolCourses, clampLimit } = require("./mobileSyncSchoolCourses");
const { encodeMobileSyncCursor } = require("./mobileSyncCursor");
const { COURSE_READ_PERMISSIONS } = require("./coursesRbacPolicy");
const { mapMobileSyncSchoolCourseRow, SELECT_SCHOOL_COURSE_SYNC } = require("../db/schoolCoursesRepository");

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
const SAME_TS = "2026-08-26T08:00:00.000Z";

const COURSE_ITEM_KEYS = [
  "academicYearId",
  "classCode",
  "classId",
  "coefficient",
  "courseCode",
  "id",
  "status",
  "subjectCode",
  "subjectId",
  "teacherCode",
  "teacherId",
  "tombstone",
  "updatedAt",
];

function courseRow(id, overrides = {}) {
  return {
    id,
    courseCode: `CRS-${id.slice(-4)}`,
    classId: CLASS_A,
    classCode: "CLS-A",
    subjectId: SUBJECT_MATH,
    subjectCode: "SUB-MATH",
    teacherId: TEACHER_UUID,
    teacherCode: "TCH-A",
    academicYearId: "ay-1",
    coefficient: 1,
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
      if (typeof live.resolvePermissions === "function") {
        return live.resolvePermissions(principal);
      }
      const keys = new Set(principal.roleKeys ?? []);
      if (keys.has("SCHOOL_ADMIN") || keys.has("SUPER_ADMIN") || keys.has("PREFET_ETUDES")) {
        return { permissions: ["Matières:READ", "Voir classes", "Gérer cours"] };
      }
      if (keys.has("TEACHER")) {
        return { permissions: ["Matières:READ", "Voir classes"] };
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
    async listLiveTeacherAssignmentPairsForSync(_schoolId, teacherId) {
      if (live.failAssignmentPairs) {
        throw new Error("pg assignment pairs unavailable");
      }
      return live.pairsByTeacher?.[teacherId] ?? [];
    },
    async listSchoolCoursesForMobileSync(schoolCode, options = {}) {
      live.lastCourseQuery = { schoolCode, ...options };
      let rows = [...(rowsBySchool[schoolCode] ?? [])];
      if (Array.isArray(options.coursePairs)) {
        if (!options.coursePairs.length) return [];
        const keys = new Set(
          options.coursePairs.map((pair) => `${pair.classId}|${pair.subjectId}`),
        );
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
    permissions: ["Matières:READ", "Voir classes"],
    ...overrides,
  };
}

function teacherPrincipal(overrides = {}) {
  return {
    sub: "teacher-1",
    role: "Enseignant",
    schoolCode: "SCH-A",
    permissions: ["Matières:READ", "Voir classes"],
    teacherCode: "JWT-CODE",
    teacherId: "JWT-CODE",
    assignments: [{ classId: CLASS_A, classCode: "JWT-CLASS" }],
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
      [TEACHER_UUID]: [
        { assignmentId: "asg-math", classId: CLASS_A, subjectId: SUBJECT_MATH },
      ],
    },
    ...live,
  };
  return handleMobileSyncL1SchoolCourses({
    principal,
    cursor,
    limit,
    tokenService: tokens,
    repository: createFakeRepo(rows ?? { "SCH-A": [courseRow(ID_A)] }, liveState),
    tenantScopeService,
  });
}

test("RBAC identique à GET /api/courses", () => {
  assert.deepEqual(routePermissions["GET /api/mobile-sync/l1/school-courses"], [...COURSE_READ_PERMISSIONS]);
  assert.deepEqual(routePermissions["GET /api/courses"], [...COURSE_READ_PERMISSIONS]);
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Voir classes"] }, "GET /api/mobile-sync/l1/school-courses"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Matières:READ"] }, "GET /api/mobile-sync/l1/school-courses"),
    true,
  );
  assert.equal(
    rbac.canAccess(
      { role: "Comptable", permissions: ["Gérer paiements", "Voir rapports financiers"] },
      "GET /api/mobile-sync/l1/school-courses",
    ),
    false,
  );
});

test("SELECT L1 exige school_id ; teacherId = t.id pas sc.teacher_id", () => {
  assert.match(SELECT_SCHOOL_COURSE_SYNC, /JOIN classes cl ON cl\.id = sc\.class_id\s+AND cl\.school_id = sc\.school_id/);
  assert.match(SELECT_SCHOOL_COURSE_SYNC, /JOIN subjects sub ON sub\.id = sc\.subject_id\s+AND sub\.school_id = sc\.school_id/);
  assert.match(
    SELECT_SCHOOL_COURSE_SYNC,
    /JOIN academic_years ay ON ay\.id = cl\.academic_year_id\s+AND ay\.school_id = sc\.school_id/,
  );
  assert.match(
    SELECT_SCHOOL_COURSE_SYNC,
    /LEFT JOIN teachers t ON t\.id = sc\.teacher_id\s+AND t\.school_id = sc\.school_id/,
  );
  assert.match(SELECT_SCHOOL_COURSE_SYNC, /t\.id AS teacher_id/);
  assert.equal(SELECT_SCHOOL_COURSE_SYNC.includes("sc.teacher_id AS teacher_id"), false);
  assert.equal(
    mapMobileSyncSchoolCourseRow({
      id: "c",
      course_code: "CRS",
      class_id: CLASS_A,
      class_code: "CLS-A",
      subject_id: SUBJECT_MATH,
      subject_code: "MATH",
      teacher_id: null,
      teacher_code: null,
      academic_year_id: "ay",
      coefficient: "2.50",
      status: "archived",
      updated_at: SAME_TS,
    }).tombstone,
    true,
  );
  assert.equal(
    mapMobileSyncSchoolCourseRow({
      id: "c",
      course_code: "CRS",
      class_id: CLASS_A,
      class_code: "CLS-A",
      subject_id: SUBJECT_MATH,
      subject_code: "MATH",
      teacher_id: TEACHER_UUID,
      teacher_code: "TCH",
      academic_year_id: "ay",
      coefficient: 1,
      status: "active",
      updated_at: SAME_TS,
    }).tombstone,
    false,
  );
});

test("cold sync Admin school-wide : mode full + tombstone archived", async () => {
  const result = await sync(adminPrincipal(), {
    rows: {
      "SCH-A": [
        courseRow(ID_A),
        courseRow(ID_B, { status: "archived", tombstone: true, courseCode: "CRS-OLD" }),
      ],
    },
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.resource, "school-courses");
  assert.equal(result.body.mode, "full");
  assert.equal(result.body.cursorStatus, "ok");
  assert.equal(result.body.items.length, 2);
  const archived = result.body.items.find((item) => item.id === ID_B);
  assert.equal(archived.tombstone, true);
  assert.equal(archived.status, "archived");
  for (const item of result.body.items) {
    assert.deepEqual(Object.keys(item).sort(), COURSE_ITEM_KEYS);
    assert.equal(Object.hasOwn(item, "className"), false);
    assert.equal(Object.hasOwn(item, "subjectName"), false);
    assert.equal(Object.hasOwn(item, "teacherName"), false);
    assert.equal(Object.hasOwn(item, "legacyJsonId"), false);
  }
});

test("création cours → delta school-wide", async () => {
  const rows = { "SCH-A": [courseRow(ID_A)] };
  const cold = await sync(adminPrincipal(), { rows });
  rows["SCH-A"].push(courseRow(ID_C, { updatedAt: "2026-08-26T09:00:00.000Z", courseCode: "CRS-NEW" }));
  const warm = await sync(adminPrincipal(), { rows, cursor: cold.body.nextCursor });
  assert.equal(warm.body.mode, "delta");
  assert.deepEqual(warm.body.items.map((item) => item.id), [ID_C]);
});

test("Teacher : uniquement Classe A / Maths, pas A/Français ni B/Maths", async () => {
  const result = await sync(teacherPrincipal(), {
    rows: {
      "SCH-A": [
        courseRow(ID_A, { classId: CLASS_A, subjectId: SUBJECT_MATH, courseCode: "A-MATH" }),
        courseRow(ID_B, {
          classId: CLASS_A,
          subjectId: SUBJECT_FR,
          subjectCode: "SUB-FR",
          courseCode: "A-FR",
          teacherId: TEACHER_UUID,
        }),
        courseRow(ID_C, {
          classId: CLASS_B,
          classCode: "CLS-B",
          subjectId: SUBJECT_MATH,
          courseCode: "B-MATH",
          teacherId: TEACHER_UUID,
        }),
      ],
    },
  });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.items.map((item) => item.id), [ID_A]);
  assert.ok(!result.body.items.some((item) => item.courseCode === "A-FR" || item.courseCode === "B-MATH"));
});

test("JWT Admin stale + rôle live Teacher → assigned", async () => {
  const staleAdmin = adminPrincipal({
    sub: "teacher-1",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Matières:READ", "ALL_PRIVILEGES"],
  });
  const result = await sync(staleAdmin, {
    live: { roleKeysByUser: { "teacher-1": ["TEACHER"] } },
    rows: {
      "SCH-A": [
        courseRow(ID_A),
        courseRow(ID_B, { classId: CLASS_B, classCode: "CLS-B", subjectId: SUBJECT_FR, subjectCode: "FR" }),
      ],
    },
  });
  assert.deepEqual(result.body.items.map((item) => item.id), [ID_A]);
});

test("affectation ajoutée Teacher → scope_changed", async () => {
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
  assert.equal(granted.body.mode, "full_required");
});

test("rôle Teacher révoqué → zéro donnée", async () => {
  const result = await sync(teacherPrincipal(), {
    live: { roleKeysByUser: { "teacher-1": [] } },
  });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.items, []);
});

test("permission live révoquée → 403 avant SQL", async () => {
  const result = await sync(teacherPrincipal(), {
    live: {
      resolvePermissions: () => ({ permissions: [] }),
    },
  });
  assert.equal(result.httpStatus, 403);
  assert.equal(result.body.code, PERMISSION_DENIED);
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

test("CUSTOM_ROLE + Matières:READ → none", async () => {
  const result = await sync(
    adminPrincipal({ sub: "custom-1", role: "Admin School", permissions: ["Matières:READ"] }),
    { live: { roleKeysByUser: { "custom-1": ["CUSTOM_ROLE"] } } },
  );
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.items, []);
});

test("curseur Classes → SchoolCourses : 400", async () => {
  const classesCursor = encodeMobileSyncCursor(
    {
      resource: "classes",
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
    () => sync(adminPrincipal(), { cursor: classesCursor }),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("erreur live roles → 503", async () => {
  const result = await sync(adminPrincipal(), { live: { failRoleKeys: true } });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.code, MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE);
});

test("mémoire sans listSchoolCoursesForMobileSync → 503 PostgreSQL requis", async () => {
  const result = await handleMobileSyncL1SchoolCourses({
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
