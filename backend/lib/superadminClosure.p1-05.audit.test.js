"use strict";

/**
 * P1-05 — Audit de fermeture Superadmin (Backend).
 * Aucune correction produit ici : invariants fermés + écarts restants documentés.
 *
 *   node --test backend/lib/superadminClosure.p1-05.audit.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { isSuperAdminPrincipal } = require("./superadminPrincipal");
const { isPlatformPersonalDataForbidden, SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM, PLATFORM_ADMIN_ALLOWED } = require("./platformPersonalDataGuard");
const { resolveFinanceSchoolScope } = require("./financeSchoolScope");
const { resolvePlanningSchoolScope } = require("./planningSchoolScope");
const { resolveCourseSchedulesSyncScope, resolveSchoolCoursesSyncScope } = require("./mobileSyncScope");

const ROOT = path.resolve(__dirname, "../..");
const SUPER = {
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
};

test("P1-05 replay P1-02 : ALL_PRIVILEGES / schoolCode * ne sont pas Superadmin", () => {
  assert.equal(isSuperAdminPrincipal(SUPER), true);
  assert.equal(isSuperAdminPrincipal({ permissions: ["ALL_PRIVILEGES"] }), false);
  assert.equal(isSuperAdminPrincipal({ schoolCode: "*" }), false);
  assert.equal(isSuperAdminPrincipal({ role: "Admin Pays" }), false);
  assert.equal(isSuperAdminPrincipal({ role: "Admin School" }), false);
});

test("P1-05 replay P0-2 / P1-01 / P1-03 : élèves, finance, messages, export HTTP fermés", () => {
  for (const route of [
    "GET /api/students",
    "GET /api/notes",
    "GET /api/presences",
    "GET /api/payments",
    "GET /api/backoffice/messages",
    "GET /api/data-export",
    "GET /api/mobile-sync/l1/students",
  ]) {
    assert.equal(isPlatformPersonalDataForbidden(SUPER, route), true, route);
  }
  assert.equal(resolveFinanceSchoolScope(SUPER).mode, "none");
});

test("P1-05 KNOWN_GAP Backend : planning Superadmin reste mode all", () => {
  const scope = resolvePlanningSchoolScope(SUPER);
  assert.equal(
    scope.mode,
    "all",
    "écart documenté : resolvePlanningSchoolScope Superadmin = all (P1 isolé suivant)",
  );
});

test("P1-05 KNOWN_GAP Backend : course-schedules / school-courses hors matrice P0-2", () => {
  assert.equal(
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/course-schedules"),
    false,
  );
  assert.equal(
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/mobile-sync/l1/course-schedules"),
    false,
  );
  assert.equal(
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/mobile-sync/l1/school-courses"),
    false,
  );
  assert.equal(
    PLATFORM_ADMIN_ALLOWED.includes("GET /api/classes/:classCode/head-teacher/candidates"),
    true,
    "écart documenté : candidats prof titulaire encore plateforme-autorisés",
  );
});

test("P1-05 KNOWN_GAP Backend : mobileSync Superadmin = school-wide", () => {
  assert.equal(resolveCourseSchedulesSyncScope(SUPER).scopeKind, "school-wide");
  assert.equal(resolveSchoolCoursesSyncScope(SUPER).scopeKind, "school-wide");
});

test("P1-05 KNOWN_GAP Backend : Admin Pays encore school-wide reader élèves (défense en profondeur)", () => {
  const src = fs.readFileSync(path.join(ROOT, "backend/lib/classStudentsAuthz.js"), "utf8");
  assert.match(src, /"Admin Pays"/);
});
