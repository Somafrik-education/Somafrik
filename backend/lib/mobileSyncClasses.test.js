"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TokenService } = require("../services/tokenService");
const { RbacService, routePermissions, PERMISSION_DENIED } = require("../services/rbacService");
const { TenantScopeService } = require("../services/tenantScopeService");
const { MOBILE_SYNC_ERROR } = require("./mobileSyncErrors");
const { handleMobileSyncL1Classes, clampLimit } = require("./mobileSyncClasses");
const { encodeMobileSyncCursor } = require("./mobileSyncCursor");
const { computeClassesScopeHash } = require("./mobileSyncScope");

const tokens = new TokenService({ secret: "ci-test-secret-with-enough-length-for-production-checks" });
const tenantScopeService = new TenantScopeService();
const rbac = new RbacService();

const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";
const ID_C = "00000000-0000-4000-8000-00000000000c";
const SAME_TS = "2026-08-26T08:00:00.000Z";

function classRow(id, classCode, overrides = {}) {
  return {
    id,
    classCode,
    name: classCode,
    academicYearId: "ay-1",
    levelId: "level-1",
    streamId: null,
    groupId: "group-1",
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
      if (keys.has("SCHOOL_ADMIN") || keys.has("SUPER_ADMIN")) {
        return { permissions: ["Voir classes", "Gérer classes"] };
      }
      if (keys.has("TEACHER") || keys.has("PREFET_ETUDES")) {
        return { permissions: ["Voir classes"] };
      }
      return { permissions: [] };
    },
    async listLiveTeacherClassAssignmentsForSync(userId) {
      return live.assignmentsByUser?.[userId] ?? [];
    },
    async listSchoolClassesForMobileSync(schoolCode, options = {}) {
      live.sqlCalls = (live.sqlCalls ?? 0) + 1;
      let rows = [...(rowsBySchool[schoolCode] ?? [])];
      if (Array.isArray(options.classIds) || Array.isArray(options.classCodes)) {
        const ids = new Set(options.classIds ?? []);
        const codes = new Set(options.classCodes ?? []);
        if (!ids.size && !codes.size) return [];
        rows = rows.filter((row) => ids.has(String(row.id)) || codes.has(String(row.classCode)));
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

function defaultLiveRoleKeys(principal) {
  if (principal?.role === "Admin School") return ["SCHOOL_ADMIN"];
  if (principal?.role === "Enseignant") return ["TEACHER"];
  return [];
}

async function sync(principal, { cursor, limit, rows, liveAssignments, liveRoleKeys, liveRoleKeysBySchool, failRoleKeys, resolvePermissions } = {}) {
  const defaultRows = {
    "SCH-A": [classRow(ID_A, "CLS-A"), classRow(ID_B, "CLS-B"), classRow(ID_C, "CLS-C")],
  };
  return handleMobileSyncL1Classes({
    principal,
    cursor,
    limit,
    tokenService: tokens,
    repository: createFakeRepo(rows ?? defaultRows, {
      assignmentsByUser: {
        [principal.sub]: liveAssignments ?? [],
      },
      roleKeysByUser: {
        [principal.sub]: liveRoleKeys !== undefined ? liveRoleKeys : defaultLiveRoleKeys(principal),
      },
      roleKeysByUserSchool: liveRoleKeysBySchool,
      failRoleKeys: Boolean(failRoleKeys),
      resolvePermissions,
    }),
    tenantScopeService,
  });
}

test("RBAC identique à GET /api/classes", () => {
  assert.deepEqual(
    routePermissions["GET /api/mobile-sync/l1/classes"],
    routePermissions["GET /api/classes"],
  );
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Voir classes"] }, "GET /api/mobile-sync/l1/classes"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: ["Voir classes"] }, "GET /api/mobile-sync/l1/classes"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Voir classes"] }, "GET /api/mobile-sync/l1/classes"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Voir élèves"] }, "GET /api/mobile-sync/l1/classes"),
    false,
  );
  assert.equal(
    rbac.canAccess(
      { role: "Comptable", permissions: ["Gérer paiements", "Voir rapports financiers"] },
      "GET /api/mobile-sync/l1/classes",
    ),
    false,
  );
});

test("cold sync : mode full, projection minimale, tombstone inactive", async () => {
  const result = await sync(adminPrincipal(), {
    rows: {
      "SCH-A": [
        classRow(ID_A, "CLS-A"),
        classRow(ID_B, "CLS-B", { status: "inactive", tombstone: true }),
      ],
    },
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.resource, "classes");
  assert.equal(result.body.mode, "full");
  assert.equal(result.body.cursorStatus, "ok");
  assert.equal(result.body.hasMore, false);
  assert.ok(result.body.scopeHash);
  assert.ok(result.body.nextCursor);
  assert.equal(result.body.items.length, 2);
  const inactive = result.body.items.find((item) => item.id === ID_B);
  assert.equal(inactive.tombstone, true);
  assert.equal(inactive.status, "inactive");
  for (const item of result.body.items) {
    assert.deepEqual(
      Object.keys(item).sort(),
      [
        "academicYearId",
        "classCode",
        "groupId",
        "id",
        "levelId",
        "name",
        "status",
        "streamId",
        "tombstone",
        "updatedAt",
      ].sort(),
    );
    assert.equal(Object.hasOwn(item, "students"), false);
    assert.equal(Object.hasOwn(item, "teacher"), false);
    assert.equal(Object.hasOwn(item, "payload"), false);
  }
});

test("warm delta : seulement les lignes strictement postérieures au curseur", async () => {
  const rows = {
    "SCH-A": [classRow(ID_A, "CLS-A"), classRow(ID_B, "CLS-B"), classRow(ID_C, "CLS-C")],
  };
  const cold = await sync(adminPrincipal(), { rows });
  const last = cold.body.items[cold.body.items.length - 1];
  rows["SCH-A"].push(
    classRow("00000000-0000-4000-8000-00000000000d", "CLS-D", {
      updatedAt: "2026-08-26T09:00:00.000Z",
    }),
  );
  const warm = await sync(adminPrincipal(), { cursor: cold.body.nextCursor, rows });
  assert.equal(warm.body.mode, "delta");
  assert.equal(warm.body.items.length, 1);
  assert.equal(warm.body.items[0].classCode, "CLS-D");
  assert.ok(!warm.body.items.some((item) => item.id === last.id));
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

test("pagination : nextCursor pointe vers le dernier item envoyé", async () => {
  const first = await sync(adminPrincipal(), { limit: 1 });
  assert.equal(first.body.items[0].id, ID_A);
  assert.equal(first.body.hasMore, true);
  const second = await sync(adminPrincipal(), { cursor: first.body.nextCursor, limit: 1 });
  assert.equal(second.body.items[0].id, ID_B);
});

test("teacher : classe A visible, B invisible (filtre live PG, pas JWT)", async () => {
  const staleJwt = teacherPrincipal([
    { classId: ID_A, classCode: "CLS-A", status: "active" },
    { classId: ID_B, classCode: "CLS-B", status: "active" },
  ]);
  const result = await sync(staleJwt, {
    liveAssignments: [{ classId: ID_A, classCode: "CLS-A", status: "active" }],
  });
  assert.deepEqual(
    result.body.items.map((item) => item.classCode),
    ["CLS-A"],
  );
});

test("grant PG live, JWT inchangé → scope_changed / full_required", async () => {
  const staleJwt = teacherPrincipal([{ classId: ID_A, classCode: "CLS-A", status: "active" }]);
  const cold = await sync(staleJwt, {
    liveAssignments: [{ classId: ID_A, classCode: "CLS-A", status: "active" }],
  });
  const granted = await sync(staleJwt, {
    cursor: cold.body.nextCursor,
    liveAssignments: [
      { classId: ID_A, classCode: "CLS-A", status: "active" },
      { classId: ID_B, classCode: "CLS-B", status: "active" },
    ],
  });
  assert.equal(granted.httpStatus, 409);
  assert.equal(granted.body.code, MOBILE_SYNC_ERROR.SCOPE_CHANGED);
  assert.equal(granted.body.cursorStatus, "scope_changed");
  assert.equal(granted.body.mode, "full_required");
  const resync = await sync(staleJwt, {
    liveAssignments: [
      { classId: ID_A, classCode: "CLS-A", status: "active" },
      { classId: ID_B, classCode: "CLS-B", status: "active" },
    ],
  });
  assert.equal(resync.httpStatus, 200);
  assert.equal(resync.body.mode, "full");
  assert.deepEqual(
    resync.body.items.map((item) => item.classCode).sort(),
    ["CLS-A", "CLS-B"],
  );
});

test("revoke PG live, JWT stale A+B → scope_changed puis full sans B", async () => {
  const staleJwt = teacherPrincipal([
    { classId: ID_A, classCode: "CLS-A", status: "active" },
    { classId: ID_B, classCode: "CLS-B", status: "active" },
  ]);
  const cold = await sync(staleJwt, {
    liveAssignments: [
      { classId: ID_A, classCode: "CLS-A", status: "active" },
      { classId: ID_B, classCode: "CLS-B", status: "active" },
    ],
  });
  const revoked = await sync(staleJwt, {
    cursor: cold.body.nextCursor,
    liveAssignments: [{ classId: ID_A, classCode: "CLS-A", status: "active" }],
  });
  assert.equal(revoked.body.cursorStatus, "scope_changed");
  const resync = await sync(staleJwt, {
    liveAssignments: [{ classId: ID_A, classCode: "CLS-A", status: "active" }],
  });
  assert.deepEqual(
    resync.body.items.map((item) => item.classCode),
    ["CLS-A"],
  );
});

test("cursor school A sous school B → 403 fail-closed", async () => {
  const cold = await sync(adminPrincipal());
  await assert.rejects(
    () => sync(adminPrincipal({ sub: "admin-1", schoolCode: "SCH-B" }), { cursor: cold.body.nextCursor }),
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

test("tamper cursor → refus", async () => {
  const cold = await sync(adminPrincipal());
  const tampered = `${cold.body.nextCursor.slice(0, -3)}zzz`;
  await assert.rejects(
    () => sync(adminPrincipal(), { cursor: tampered }),
    (error) => error.statusCode === 400 && error.code === MOBILE_SYNC_ERROR.CURSOR_INVALID,
  );
});

test("cursor expiré → full_required", async () => {
  const principal = adminPrincipal();
  const { scopeHash } = computeClassesScopeHash(principal, {
    schoolCode: "SCH-A",
    schoolId: "sid-SCH-A",
  });
  const expired = encodeMobileSyncCursor(
    {
      resource: "classes",
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
  assert.equal(result.body.cursorStatus, "expired");
  assert.equal(result.body.mode, "full_required");
});

test("limit serveur clampée à 500", () => {
  assert.equal(clampLimit(undefined), 200);
  assert.equal(clampLimit("12"), 12);
  assert.equal(clampLimit("9999"), 500);
  assert.equal(clampLimit("0"), 200);
});

test("mémoire sans listSchoolClassesForMobileSync → 503 PostgreSQL requis", async () => {
  const result = await handleMobileSyncL1Classes({
    principal: adminPrincipal(),
    tokenService: tokens,
    repository: { getSchoolByCode: async () => ({ id: "x", school_code: "SCH-A" }) },
    tenantScopeService,
  });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.code, MOBILE_SYNC_ERROR.POSTGRES_REQUIRED);
});

test("JWT Admin stale + rôles live [] → zéro classe", async () => {
  const result = await sync(adminPrincipal(), { liveRoleKeys: [] });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.items, []);
  assert.ok(!result.body.items.some((item) => item.classCode));
});

test("JWT Teacher stale + rôle live révoqué → zéro classe", async () => {
  const staleJwt = teacherPrincipal([
    { classId: ID_A, classCode: "CLS-A", status: "active" },
    { classId: ID_B, classCode: "CLS-B", status: "active" },
  ]);
  const result = await sync(staleJwt, {
    liveRoleKeys: [],
    liveAssignments: [
      { classId: ID_A, classCode: "CLS-A", status: "active" },
      { classId: ID_B, classCode: "CLS-B", status: "active" },
    ],
  });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body.items, []);
});

test("erreur lecture rôles live → zéro donnée", async () => {
  const result = await sync(adminPrincipal(), { failRoleKeys: true });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.code, MOBILE_SYNC_ERROR.LIVE_SCOPE_UNAVAILABLE);
  assert.equal(result.body.items, undefined);
});

test("TEACHER School A + SCHOOL_ADMIN School B → sync A assigned, jamais school-wide", async () => {
  const dual = adminPrincipal({
    sub: "user-x",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    schoolCode: "SCH-A",
    permissions: ["Voir classes", "Gérer classes"],
  });
  const result = await sync(dual, {
    liveRoleKeys: [],
    liveRoleKeysBySchool: {
      "user-x::sid-SCH-A": ["TEACHER"],
      "user-x::sid-SCH-B": ["SCHOOL_ADMIN"],
    },
    liveAssignments: [{ classId: ID_A, classCode: "CLS-A", status: "active" }],
    rows: {
      "SCH-A": [classRow(ID_A, "CLS-A"), classRow(ID_B, "CLS-B"), classRow(ID_C, "CLS-C")],
      "SCH-B": [classRow("00000000-0000-4000-8000-0000000000bb", "CLS-B-ONLY")],
    },
  });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(
    result.body.items.map((item) => item.classCode),
    ["CLS-A"],
  );
  assert.ok(!result.body.items.some((item) => item.classCode === "CLS-B"));
  assert.ok(!result.body.items.some((item) => item.classCode === "CLS-B-ONLY"));
});

test("DENY Classes school-scopé : schoolCode transmis, pas un READ global sans tenant", async () => {
  const stale = teacherPrincipal([{ classId: ID_A, classCode: "CLS-A", status: "active" }]);
  const result = await sync(stale, {
    liveAssignments: [{ classId: ID_A, classCode: "CLS-A", status: "active" }],
    resolvePermissions: (principal) => {
      assert.equal(principal.schoolCode, "SCH-A");
      assert.equal(principal.effectiveSchoolId, "sid-SCH-A");
      assert.equal(principal.sub, undefined);
      if (!principal.schoolCode) {
        return { permissions: ["Voir classes", "Classes:READ"] };
      }
      return { permissions: [] };
    },
  });
  assert.equal(result.httpStatus, 403);
  assert.equal(result.body.code, PERMISSION_DENIED);
  assert.equal(result.body.items, undefined);
});

test("ACCOUNTANT@A + SCHOOL_ADMIN@B + JWT Admin@A → 403, aucune classe, pas de SQL", async () => {
  const live = {
    roleKeysByUserSchool: {
      "user-acc::sid-SCH-A": ["ACCOUNTANT"],
      "user-acc::sid-SCH-B": ["SCHOOL_ADMIN"],
    },
    sqlCalls: 0,
  };
  const result = await handleMobileSyncL1Classes({
    principal: adminPrincipal({
      sub: "user-acc",
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-A",
      permissions: ["Voir classes", "Gérer classes"],
    }),
    tokenService: tokens,
    repository: createFakeRepo(
      {
        "SCH-A": [classRow(ID_A, "CLS-A"), classRow(ID_B, "CLS-B"), classRow(ID_C, "CLS-C")],
      },
      live,
    ),
    tenantScopeService,
  });
  assert.equal(result.httpStatus, 403);
  assert.equal(result.body.code, PERMISSION_DENIED);
  assert.equal(result.body.items, undefined);
  assert.equal(live.sqlCalls, 0);
});
