"use strict";

/**
 * Garde structurelle fail-open : toute route `requirePermission(routeKey)`
 * doit avoir une entrée `routePermissions`.
 *
 * Exception documentée (P1 hors lot Planning) : POST /api/courses — PATCH/DELETE
 * `/api/courses/:courseId` réutilisent cette même clé absente. Un fail-closed
 * global de `RbacService.canAccess()` casserait ces écritures. Ne pas élargir
 * ce correctif Planning.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { RbacService, routePermissions } = require("../services/rbacService");

const serverSrc = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

const KNOWN_FAIL_OPEN_ROUTE_KEYS = Object.freeze(["POST /api/courses"]);

const COURSE_SCHEDULE_ROUTE_KEYS = Object.freeze([
  "GET /api/course-schedules",
  "POST /api/course-schedules",
  "PATCH /api/course-schedules/:scheduleId",
  "DELETE /api/course-schedules/:scheduleId",
]);

function requirePermissionKeys(src) {
  return [...src.matchAll(/requirePermission\("([^"]+)"\)/g)].map((match) => match[1]);
}

test("chaque requirePermission(routeKey) a une entrée routePermissions, hors allowlist P1", () => {
  const keys = [...new Set(requirePermissionKeys(serverSrc))];
  const missing = keys.filter((key) => !Array.isArray(routePermissions[key]));
  assert.deepEqual(
    missing.sort(),
    [...KNOWN_FAIL_OPEN_ROUTE_KEYS].sort(),
    `clés requirePermission sans catalogue: ${missing.join(", ") || "(aucune)"}`,
  );
});

test("course-schedules n'est plus fail-open et PATCH/DELETE ont leurs propres clés", () => {
  for (const key of COURSE_SCHEDULE_ROUTE_KEYS) {
    assert.ok(Array.isArray(routePermissions[key]) && routePermissions[key].length > 0, key);
    assert.equal(KNOWN_FAIL_OPEN_ROUTE_KEYS.includes(key), false, key);
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

test("canAccess refuse une clé course-schedules sans grant ; clé inconnue reste fail-open (P1)", () => {
  const rbac = new RbacService({ rolePermissions: {} });
  const parent = { role: "Parent", permissions: ["Élèves:READ"] };
  assert.equal(rbac.canAccess(parent, "GET /api/course-schedules"), false);
  assert.equal(rbac.canAccess(parent, "POST /api/course-schedules"), false);
  assert.equal(rbac.canAccess(parent, "PATCH /api/course-schedules/:scheduleId"), false);
  assert.equal(rbac.canAccess(parent, "DELETE /api/course-schedules/:scheduleId"), false);
  assert.equal(
    rbac.canAccess(parent, "POST /api/this-route-is-not-catalogued"),
    true,
    "canAccess global toujours fail-open si clé absente — P1 séparé",
  );
});
