"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { routePermissions } = require("../services/rbacService");

const ROOT = path.join(__dirname, "../..");

test("GET course-schedules (y compris projection course-options) exige Planning de cours:READ", () => {
  assert.deepEqual(routePermissions["GET /api/course-schedules"], ["Planning de cours:READ", "ALL_PRIVILEGES"]);
});

test("la page Planning consomme la projection, pas state.courses / Matières", () => {
  const page = fs.readFileSync(path.join(ROOT, "web/src/pages/CoursePlanningPage.tsx"), "utf8");
  assert.match(page, /listPlanningCourseOptions/);
  assert.doesNotMatch(page, /listSchoolCoursesForClass/);
  assert.doesNotMatch(page, /Créez-le dans Mon établissement/);
  const service = fs.readFileSync(path.join(ROOT, "backend/lib/pedagogyService.js"), "utf8");
  assert.match(service, /planning-course-options/);
  assert.match(service, /isPlanningCourseOptionsProjection/);
});
