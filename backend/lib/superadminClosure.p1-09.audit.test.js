"use strict";

/**
 * P1-09 — Replay final de fermeture sécurité (Backend).
 * Aucune correction produit ici : invariants P0/P1 + résiduels documentés.
 *
 *   node --test backend/lib/superadminClosure.p1-09.audit.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { RbacService } = require("../services/rbacService");
const { isSuperAdminPrincipal } = require("./superadminPrincipal");
const {
  isPlatformPersonalDataForbidden,
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  PLATFORM_ADMIN_ALLOWED,
} = require("./platformPersonalDataGuard");
const { resolveFinanceSchoolScope } = require("./financeSchoolScope");
const { resolvePlanningSchoolScope } = require("./planningSchoolScope");
const {
  resolveCourseSchedulesSyncScope,
  resolveSchoolCoursesSyncScope,
  resolveStudentsSyncScope,
  resolveClassesSyncScope,
  resolveAssignmentsSyncScope,
} = require("./mobileSyncScope");
const { SCHOOL_WIDE_STUDENT_READ_ROLES, principalHasClassAccess } = require("./classStudentsAuthz");

const ROOT = path.resolve(__dirname, "../..");
const rbac = new RbacService();

const SUPER = {
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
};
const COUNTRY = {
  role: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES"],
  schoolCode: "*",
};
const SCHOOL_ADMIN = {
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Élèves:READ", "Messages:READ", "Paiements:READ", "Notes:READ", "Présences:READ"],
  schoolCode: "CD-2026-0001",
  financeLoginCode: "CD-2026-0001",
  planningLoginCode: "CD-2026-0001",
  planningSchoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const TEACHER = {
  role: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: ["Élèves:READ", "Notes:READ", "Présences:READ"],
  schoolCode: "CD-2026-0001",
};
const PARENT = {
  role: "Parent",
  roleKeys: ["PARENT"],
  permissions: ["Élèves:READ", "Notifications:READ"],
  schoolCode: "CD-2026-0001",
};
const STUDENT = {
  role: "Élève / Étudiant",
  roleKeys: ["STUDENT"],
  permissions: ["Élèves:READ"],
  schoolCode: "CD-2026-0001",
};
const ALL_PRIVILEGES_ONLY = {
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
};
const WILDCARD_ONLY = { schoolCode: "*" };

const SCHOOL_PII_ROUTES = [
  "GET /api/students",
  "GET /api/notes",
  "GET /api/presences",
  "GET /api/payments",
  "GET /api/backoffice/messages",
  "GET /api/data-export",
  "GET /api/mobile-sync/l1/students",
  "GET /api/mobile-sync/l1/school-courses",
  "GET /api/mobile-sync/l1/course-schedules",
  "GET /api/course-schedules",
  "GET /api/classes/:classCode/head-teacher/candidates",
];

const PLATFORM_ROUTES = [
  "GET /api/backoffice/countries",
  "GET /api/backoffice/establishments",
  "GET /api/backoffice/users",
  "GET /api/backoffice/subscriptions",
  "GET /api/backoffice/platform-announcements",
];

test("P1-09 P1-02 : ALL_PRIVILEGES / schoolCode * ne sont pas Superadmin", () => {
  assert.equal(isSuperAdminPrincipal(SUPER), true);
  assert.equal(isSuperAdminPrincipal(ALL_PRIVILEGES_ONLY), false);
  assert.equal(isSuperAdminPrincipal(WILDCARD_ONLY), false);
  assert.equal(isSuperAdminPrincipal(COUNTRY), false);
  assert.equal(isSuperAdminPrincipal(SCHOOL_ADMIN), false);
});

test("P1-09 P0-2 / P1-01 / P1-03 / P1-06 : Superadmin / Admin Pays → 403 scolaire", () => {
  for (const route of SCHOOL_PII_ROUTES) {
    assert.equal(isPlatformPersonalDataForbidden(SUPER, route), true, `super ${route}`);
    assert.equal(isPlatformPersonalDataForbidden(COUNTRY, route), true, `pays ${route}`);
    assert.equal(rbac.canAccess(SUPER, route), false, `super rbac ${route}`);
  }
  assert.equal(resolveFinanceSchoolScope(SUPER).mode, "none");
  assert.equal(resolveFinanceSchoolScope(COUNTRY).mode, "none");
  assert.equal(resolvePlanningSchoolScope(SUPER).mode, "none");
  assert.equal(resolvePlanningSchoolScope(COUNTRY).mode, "none");
  assert.equal(principalHasClassAccess(SUPER, "6ème A"), false);
});

test("P1-09 P1-06 : planning / L1 sync Superadmin = none, pas all/school-wide", () => {
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/course-schedules"), true);
  assert.equal(
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/mobile-sync/l1/course-schedules"),
    true,
  );
  assert.equal(
    PLATFORM_ADMIN_ALLOWED.includes("GET /api/classes/:classCode/head-teacher/candidates"),
    false,
  );
  for (const resolve of [
    resolveClassesSyncScope,
    resolveStudentsSyncScope,
    resolveAssignmentsSyncScope,
    resolveSchoolCoursesSyncScope,
    resolveCourseSchedulesSyncScope,
  ]) {
    assert.equal(resolve(SUPER).scopeKind, "none", resolve.name);
    assert.equal(resolve(COUNTRY).scopeKind, "none", resolve.name);
    assert.equal(resolve(ALL_PRIVILEGES_ONLY).scopeKind, "none", `priv ${resolve.name}`);
    assert.equal(resolve(WILDCARD_ONLY).scopeKind, "none", `star ${resolve.name}`);
  }
  assert.equal(SCHOOL_WIDE_STUDENT_READ_ROLES.has("Admin Pays"), false);
  assert.equal(SCHOOL_WIDE_STUDENT_READ_ROLES.has("Admin School"), true);
});

test("P1-09 ALL_PRIVILEGES / * : aucun mode all Finance/Planning, pas un Admin School global", () => {
  assert.equal(resolveFinanceSchoolScope(ALL_PRIVILEGES_ONLY).mode, "none");
  assert.equal(resolveFinanceSchoolScope(WILDCARD_ONLY).mode, "none");
  assert.equal(resolvePlanningSchoolScope(ALL_PRIVILEGES_ONLY).mode, "none");
  assert.equal(resolvePlanningSchoolScope({ schoolCode: "*", planningLoginCode: "*" }).mode, "none");
  const planningSrc = fs.readFileSync(path.join(ROOT, "backend/lib/planningSchoolScope.js"), "utf8");
  const resolveFn = planningSrc.slice(planningSrc.indexOf("function resolvePlanningSchoolScope"));
  assert.doesNotMatch(resolveFn.slice(0, 700), /return \{ mode: "all" \}/);
});

test("P1-09 RESIDUEL Backend : ALL_PRIVILEGES seul n'est pas deny P0-2 (pas Superadmin)", () => {
  assert.equal(isPlatformPersonalDataForbidden(ALL_PRIVILEGES_ONLY, "GET /api/students"), false);
  assert.equal(rbac.canAccess(ALL_PRIVILEGES_ONLY, "GET /api/students"), true);
});

test("P1-09 plateforme Superadmin ouverte, scolaire Admin School / Teacher / Parent / Student conservé", () => {
  for (const route of PLATFORM_ROUTES) {
    assert.equal(rbac.canAccess(SUPER, route), true, route);
  }
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, "GET /api/students"), true);
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, "GET /api/backoffice/messages"), true);
  assert.equal(resolveFinanceSchoolScope(SCHOOL_ADMIN).mode, "schools");
  assert.equal(resolvePlanningSchoolScope(SCHOOL_ADMIN).mode, "school");
  assert.equal(resolveStudentsSyncScope(SCHOOL_ADMIN).scopeKind, "school-wide");
  assert.equal(rbac.canAccess(TEACHER, "GET /api/notes"), true);
  assert.equal(rbac.canAccess(PARENT, "GET /api/students"), true);
  assert.equal(rbac.canAccess(STUDENT, "GET /api/students"), true);
});

test("P1-09 P0-04 AUTH_OPTIONAL fail-closed toujours en place", () => {
  const src = fs.readFileSync(path.join(ROOT, "backend/services/rbacService.js"), "utf8");
  const canAccess = src.slice(src.indexOf("canAccess(principal, routeKey)"));
  assert.doesNotMatch(canAccess.slice(0, 900), /SOMAFRIK_AUTH_OPTIONAL/);
});
