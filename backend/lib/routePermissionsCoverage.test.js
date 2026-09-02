"use strict";

/**
 * Garde structurelle L0c : toute route `requirePermission(routeKey)` doit avoir
 * une entrée `routePermissions`. Aucune allowlist fail-open n'est tolérée.
 *
 * `/api/courses` : clés distinctes par verbe HTTP.
 * POST → Matières:CREATE, PATCH → Matières:UPDATE, DELETE → Matières:DELETE.
 * Un CREATE granulaire n'autorise jamais UPDATE ni DELETE.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { RbacService, routePermissions } = require("../services/rbacService");
const {
  COURSE_GET_ROUTE_KEY,
  COURSE_POST_ROUTE_KEY,
  COURSE_PATCH_ROUTE_KEY,
  COURSE_DELETE_ROUTE_KEY,
  COURSE_WRITE_ROUTE_KEYS,
  COURSE_CREATE_PERMISSIONS,
  COURSE_UPDATE_PERMISSIONS,
  COURSE_DELETE_PERMISSIONS,
} = require("./coursesRbacPolicy");

const serverSrc = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

const COURSE_SCHEDULE_ROUTE_KEYS = Object.freeze([
  "GET /api/course-schedules",
  "POST /api/course-schedules",
  "PATCH /api/course-schedules/:scheduleId",
  "DELETE /api/course-schedules/:scheduleId",
]);

function requirePermissionKeys(src) {
  return [...src.matchAll(/requirePermission\("([^"]+)"\)/g)].map((match) => match[1]);
}

function sliceFrom(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle);
  assert.notEqual(start, -1, `introuvable: ${startNeedle}`);
  assert.notEqual(end, -1, `introuvable: ${endNeedle}`);
  assert.ok(end > start, `ordre invalide: ${startNeedle} doit précéder ${endNeedle}`);
  return src.slice(start, end);
}

test("chaque requirePermission(routeKey) a une entrée routePermissions — zéro exception", () => {
  const keys = [...new Set(requirePermissionKeys(serverSrc))];
  const missing = keys.filter((key) => !Array.isArray(routePermissions[key]));
  assert.deepEqual(
    missing.sort(),
    [],
    `clés requirePermission sans catalogue: ${missing.join(", ") || "(aucune)"}`,
  );
});

test("course-schedules n'est plus fail-open et PATCH/DELETE ont leurs propres clés", () => {
  for (const key of COURSE_SCHEDULE_ROUTE_KEYS) {
    assert.ok(Array.isArray(routePermissions[key]) && routePermissions[key].length > 0, key);
  }

  const getBlock = sliceFrom(serverSrc, 'app.get("/api/course-schedules"', 'app.post("/api/courses"');
  assert.match(getBlock, /requirePermission\("GET \/api\/course-schedules"\)/);

  const postBlock = sliceFrom(
    serverSrc,
    'app.post("/api/course-schedules"',
    'app.patch("/api/course-schedules/:scheduleId"',
  );
  assert.match(postBlock, /requirePermission\("POST \/api\/course-schedules"\)/);

  const patchBlock = sliceFrom(
    serverSrc,
    'app.patch("/api/course-schedules/:scheduleId"',
    'app.delete("/api/course-schedules/:scheduleId"',
  );
  assert.match(patchBlock, /requirePermission\("PATCH \/api\/course-schedules\/:scheduleId"\)/);
  assert.equal(patchBlock.includes('requirePermission("POST /api/course-schedules")'), false);

  const deleteBlock = sliceFrom(
    serverSrc,
    'app.delete("/api/course-schedules/:scheduleId"',
    'app.get("/api/evaluations"',
  );
  assert.match(deleteBlock, /requirePermission\("DELETE \/api\/course-schedules\/:scheduleId"\)/);
  assert.equal(deleteBlock.includes('requirePermission("POST /api/course-schedules")'), false);
});

test("courses : GET/POST/PATCH/DELETE ont chacun une clé cataloguée, sans mapping absent", () => {
  const catalogued = [
    COURSE_GET_ROUTE_KEY,
    COURSE_POST_ROUTE_KEY,
    COURSE_PATCH_ROUTE_KEY,
    COURSE_DELETE_ROUTE_KEY,
  ];
  for (const key of catalogued) {
    assert.ok(Array.isArray(routePermissions[key]) && routePermissions[key].length > 0, key);
  }

  const getBlock = sliceFrom(serverSrc, 'app.get("/api/courses"', 'app.get("/api/course-schedules"');
  assert.match(getBlock, /requirePermission\("GET \/api\/courses"\)/);

  const postBlock = sliceFrom(serverSrc, 'app.post("/api/courses"', 'app.patch("/api/courses/:courseId"');
  assert.match(postBlock, /requirePermission\("POST \/api\/courses"\)/);
  assert.equal(postBlock.includes('requirePermission("PATCH /api/courses/:courseId")'), false);

  const patchBlock = sliceFrom(
    serverSrc,
    'app.patch("/api/courses/:courseId"',
    'app.delete("/api/courses/:courseId"',
  );
  assert.match(patchBlock, /requirePermission\("PATCH \/api\/courses\/:courseId"\)/);
  assert.equal(patchBlock.includes('requirePermission("POST /api/courses")'), false);

  const deleteBlock = sliceFrom(
    serverSrc,
    'app.delete("/api/courses/:courseId"',
    'app.post("/api/course-schedules"',
  );
  assert.match(deleteBlock, /requirePermission\("DELETE \/api\/courses\/:courseId"\)/);
  assert.equal(deleteBlock.includes('requirePermission("POST /api/courses")'), false);

  assert.deepEqual(routePermissions[COURSE_POST_ROUTE_KEY], [...COURSE_CREATE_PERMISSIONS]);
  assert.deepEqual(routePermissions[COURSE_PATCH_ROUTE_KEY], [...COURSE_UPDATE_PERMISSIONS]);
  assert.deepEqual(routePermissions[COURSE_DELETE_ROUTE_KEY], [...COURSE_DELETE_PERMISSIONS]);
});

test("RbacService est globalement fail-closed pour toute clé non cataloguée", () => {
  const rbac = new RbacService({});
  const parent = { role: "Parent", permissions: ["Élèves:READ"] };
  assert.equal(rbac.canAccess(parent, "GET /api/course-schedules"), false);
  assert.equal(rbac.canAccess(parent, "POST /api/course-schedules"), false);
  assert.equal(rbac.canAccess(parent, "PATCH /api/course-schedules/:scheduleId"), false);
  assert.equal(rbac.canAccess(parent, "DELETE /api/course-schedules/:scheduleId"), false);
  assert.equal(
    rbac.canAccess(parent, "POST /api/this-route-is-not-catalogued"),
    false,
    "une clé inconnue doit être refusée par défaut",
  );
  assert.equal(rbac.canAccess(parent, "GET /api/courses"), false);
  assert.equal(rbac.canAccess(parent, COURSE_POST_ROUTE_KEY), false);
});

test("courses : CREATE granulaire n'ouvre ni UPDATE ni DELETE ; Gérer cours reste le composite historique", () => {
  const rbac = new RbacService({});
  const createOnly = { role: "school_admin", permissions: ["Matières:CREATE"] };
  const updateOnly = { role: "school_admin", permissions: ["Matières:UPDATE"] };
  const deleteOnly = { role: "school_admin", permissions: ["Matières:DELETE"] };
  const manageCourses = { role: "school_admin", permissions: ["Gérer cours"] };
  const allPrivileges = { role: "super_admin", permissions: ["ALL_PRIVILEGES"] };

  assert.equal(rbac.canAccess(createOnly, COURSE_POST_ROUTE_KEY), true);
  assert.equal(rbac.canAccess(createOnly, COURSE_PATCH_ROUTE_KEY), false);
  assert.equal(rbac.canAccess(createOnly, COURSE_DELETE_ROUTE_KEY), false);

  assert.equal(rbac.canAccess(updateOnly, COURSE_POST_ROUTE_KEY), false);
  assert.equal(rbac.canAccess(updateOnly, COURSE_PATCH_ROUTE_KEY), true);
  assert.equal(rbac.canAccess(updateOnly, COURSE_DELETE_ROUTE_KEY), false);

  assert.equal(rbac.canAccess(deleteOnly, COURSE_POST_ROUTE_KEY), false);
  assert.equal(rbac.canAccess(deleteOnly, COURSE_PATCH_ROUTE_KEY), false);
  assert.equal(rbac.canAccess(deleteOnly, COURSE_DELETE_ROUTE_KEY), true);

  for (const key of COURSE_WRITE_ROUTE_KEYS) {
    assert.equal(rbac.canAccess(manageCourses, key), true, `Gérer cours → ${key}`);
    assert.equal(rbac.canAccess(allPrivileges, key), true, `ALL_PRIVILEGES → ${key}`);
  }
});

test("courses : lecture seule enseignant refusée en écriture ; Admin School et Préfet selon matrice", () => {
  const rbac = new RbacService({});
  const teacherRead = { role: "teacher", permissions: ["Matières:READ"] };
  const teacherNotes = { role: "teacher", permissions: ["Notes:UPDATE"] };
  const schoolAdmin = { role: "school_admin", permissions: ["Gérer cours"] };
  const prefetCreate = { role: "prefet", permissions: ["Matières:CREATE"] };
  const prefetUpdate = { role: "prefet", permissions: ["Matières:UPDATE"] };
  const prefetDelete = { role: "prefet", permissions: ["Matières:DELETE"] };

  assert.equal(rbac.canAccess(teacherRead, COURSE_GET_ROUTE_KEY), true);
  assert.equal(rbac.canAccess(teacherNotes, COURSE_GET_ROUTE_KEY), false);
  for (const key of COURSE_WRITE_ROUTE_KEYS) {
    assert.equal(rbac.canAccess(teacherRead, key), false, `enseignant READ → deny ${key}`);
    assert.equal(rbac.canAccess(teacherNotes, key), false, `enseignant notes → deny ${key}`);
  }

  for (const key of COURSE_WRITE_ROUTE_KEYS) {
    assert.equal(rbac.canAccess(schoolAdmin, key), true, `Admin School Gérer cours → ${key}`);
  }

  assert.equal(rbac.canAccess(prefetCreate, COURSE_POST_ROUTE_KEY), true);
  assert.equal(rbac.canAccess(prefetCreate, COURSE_PATCH_ROUTE_KEY), false);
  assert.equal(rbac.canAccess(prefetCreate, COURSE_DELETE_ROUTE_KEY), false);
  assert.equal(rbac.canAccess(prefetUpdate, COURSE_PATCH_ROUTE_KEY), true);
  assert.equal(rbac.canAccess(prefetDelete, COURSE_DELETE_ROUTE_KEY), true);
});
