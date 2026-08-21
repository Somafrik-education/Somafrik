"use strict";

/**
 * Garde structurelle L0c : toute route `requirePermission(routeKey)` doit avoir
 * une entrée `routePermissions`. Aucune allowlist fail-open n'est tolérée.
 *
 * Les routes historiques PATCH/DELETE `/api/courses/:courseId` réutilisent
 * encore `POST /api/courses`. La politique `coursesRbacPolicy` compense ce
 * contrat historique en exigeant soit le privilège global `Gérer cours`, soit
 * CREATE+UPDATE+DELETE ensemble. Ainsi un CREATE seul ne peut jamais ouvrir un
 * DELETE tant que les clés method-specific ne sont pas séparées dans server.js.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { RbacService, routePermissions } = require("../services/rbacService");
const {
  COURSE_WRITE_ROUTE_KEY,
  COURSE_GRANULAR_WRITE_PERMISSIONS,
  canAccessCourseWrite,
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

  const getBlock = serverSrc.slice(
    serverSrc.indexOf('app.get("/api/course-schedules"'),
    serverSrc.indexOf('app.post("/api/courses"'),
  );
  assert.match(getBlock, /requirePermission\("GET \/api\/course-schedules"\)/);

  const postBlock = serverSrc.slice(
    serverSrc.indexOf('app.post("/api/course-schedules"'),
    serverSrc.indexOf('app.patch("/api/course-schedules/:scheduleId"'),
  );
  assert.match(postBlock, /requirePermission\("POST \/api\/course-schedules"\)/);

  const patchBlock = serverSrc.slice(
    serverSrc.indexOf('app.patch("/api/course-schedules/:scheduleId"'),
    serverSrc.indexOf('app.delete("/api/course-schedules/:scheduleId"'),
  );
  assert.match(patchBlock, /requirePermission\("PATCH \/api\/course-schedules\/:scheduleId"\)/);
  assert.equal(patchBlock.includes('requirePermission("POST /api/course-schedules")'), false);

  const deleteBlock = serverSrc.slice(
    serverSrc.indexOf('app.delete("/api/course-schedules/:scheduleId"'),
    serverSrc.indexOf('app.get("/api/evaluations"'),
  );
  assert.match(deleteBlock, /requirePermission\("DELETE \/api\/course-schedules\/:scheduleId"\)/);
  assert.equal(deleteBlock.includes('requirePermission("POST /api/course-schedules")'), false);
});

test("courses écritures : route cataloguée et verrou all-of tant que PATCH/DELETE réutilisent POST", () => {
  assert.ok(Array.isArray(routePermissions[COURSE_WRITE_ROUTE_KEY]));
  assert.ok(routePermissions[COURSE_WRITE_ROUTE_KEY].length > 0);
  for (const permission of COURSE_GRANULAR_WRITE_PERMISSIONS) {
    assert.ok(routePermissions[COURSE_WRITE_ROUTE_KEY].includes(permission), permission);
  }

  const postBlock = serverSrc.slice(
    serverSrc.indexOf('app.post("/api/courses"'),
    serverSrc.indexOf('app.get("/api/course-schedules"'),
  );
  assert.match(postBlock, /requirePermission\("POST \/api\/courses"\)/);

  const patchBlock = serverSrc.slice(
    serverSrc.indexOf('app.patch("/api/courses/:courseId"'),
    serverSrc.indexOf('app.delete("/api/courses/:courseId"'),
  );
  assert.match(patchBlock, /requirePermission\("POST \/api\/courses"\)/);

  const deleteBlock = serverSrc.slice(
    serverSrc.indexOf('app.delete("/api/courses/:courseId"'),
    serverSrc.indexOf('app.post("/api/course-schedules"'),
  );
  assert.match(deleteBlock, /requirePermission\("POST \/api\/courses"\)/);

  assert.equal(canAccessCourseWrite(new Set(["Matières:CREATE"])), false);
  assert.equal(canAccessCourseWrite(new Set(["Matières:UPDATE"])), false);
  assert.equal(canAccessCourseWrite(new Set(["Matières:DELETE"])), false);
  assert.equal(
    canAccessCourseWrite(new Set(COURSE_GRANULAR_WRITE_PERMISSIONS)),
    true,
  );
  assert.equal(canAccessCourseWrite(new Set(["Gérer cours"])), true);
  assert.equal(canAccessCourseWrite(new Set(["ALL_PRIVILEGES"])), true);
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
});

test("courses : lecture seule enseignant refusée en écriture ; Admin School et Préfet CRUD autorisés", () => {
  const rbac = new RbacService({});

  assert.equal(
    rbac.canAccess({ role: "teacher", permissions: ["Matières:READ"] }, COURSE_WRITE_ROUTE_KEY),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "school_admin", permissions: ["Gérer cours"] }, COURSE_WRITE_ROUTE_KEY),
    true,
  );
  assert.equal(
    rbac.canAccess(
      { role: "prefet", permissions: [...COURSE_GRANULAR_WRITE_PERMISSIONS] },
      COURSE_WRITE_ROUTE_KEY,
    ),
    true,
  );
});
