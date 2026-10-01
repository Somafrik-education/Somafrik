"use strict";

/**
 * P1-13 — Replay final après merge #855 sur develop.
 * Audit only. Le résiduel #852 est fermé. Les routes hors catalogue P1-12
 * restent ouvertes et sont constatées, pas corrigées ici.
 *
 *   node --test backend/lib/superadminClosure.p1-13.audit.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { RbacService } = require("../services/rbacService");
const { isSuperAdminPrincipal } = require("./superadminPrincipal");
const { isPlatformPersonalDataForbidden } = require("./platformPersonalDataGuard");
const { resolveFinanceSchoolScope } = require("./financeSchoolScope");
const { resolvePlanningSchoolScope } = require("./planningSchoolScope");
const { resolveStudentsSyncScope, resolveSchoolCoursesSyncScope } = require("./mobileSyncScope");
const { scopeSchoolStudentsForPrincipal } = require("./classStudentsAuthz");

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
const AGENT = { role: "Agent", permissions: ["ALL_PRIVILEGES"], schoolCode: "*" };
const SCHOOL_ADMIN = {
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Élèves:READ", "Paiements:READ", "ALL_PRIVILEGES"],
  schoolCode: "CD-2026-0001",
  financeLoginCode: "CD-2026-0001",
  planningLoginCode: "CD-2026-0001",
  planningSchoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

const CLOSED_ROUTES = [
  "GET /api/students",
  "GET /api/notes",
  "GET /api/presences",
  "GET /api/payments",
  "GET /api/backoffice/messages",
  "GET /api/data-export",
  "GET /api/course-schedules",
  "GET /api/teachers",
];

const STILL_OPEN_OUTSIDE_P1_12 = [
  "GET /api/courses",
  "POST /api/courses",
  "GET /api/v2/subjects",
  "GET /api/school-rooms",
  "GET /api/course-schedule-replacements",
  "GET /api/v2/academic-years",
  "GET /api/evaluation-types",
  "GET /api/report-card-templates",
];

test("P1-13 résiduel #852 fermé : ALL_PRIVILEGES seul n'ouvre plus le catalogue P1-12", () => {
  assert.equal(isSuperAdminPrincipal(AGENT), false);
  assert.equal(isPlatformPersonalDataForbidden(AGENT, "GET /api/students"), false);
  for (const route of CLOSED_ROUTES) {
    assert.equal(isPlatformPersonalDataForbidden(SUPER, route), true, route);
    assert.equal(isPlatformPersonalDataForbidden(COUNTRY, route), true, route);
    assert.equal(rbac.canAccess(SUPER, route), false, route);
    assert.equal(rbac.canAccess(COUNTRY, route), false, route);
    assert.equal(rbac.canAccess(AGENT, route), false, route);
  }
  assert.equal(rbac.canAccess(SUPER, "GET /api/finance/fee-grids"), false);
  assert.equal(rbac.canAccess(AGENT, "GET /api/finance/fee-grids"), false);
  assert.equal(resolveFinanceSchoolScope(AGENT).mode, "none");
  assert.equal(resolvePlanningSchoolScope(AGENT).mode, "none");
  assert.equal(resolveStudentsSyncScope(AGENT).scopeKind, "none");
  assert.equal(resolveSchoolCoursesSyncScope(AGENT).scopeKind, "none");
  assert.throws(
    () => scopeSchoolStudentsForPrincipal(AGENT, [{ id: "stu-1" }], () => undefined),
    (error) => error.statusCode === 403,
  );
});

test("P1-13 plateforme et Admin School conservés", () => {
  assert.equal(rbac.canAccess(AGENT, "GET /api/backoffice/users"), true);
  assert.equal(rbac.canAccess(AGENT, "GET /api/backoffice/subscriptions"), true);
  assert.equal(rbac.canAccess(AGENT, "GET /api/classes"), true);
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, "GET /api/students"), true);
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, "GET /api/payments"), true);
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, "GET /api/courses"), true);
  assert.equal(resolveFinanceSchoolScope(SCHOOL_ADMIN).mode, "schools");
});

test("P1-13 RESIDUEL hors catalogue P1-12 : matières, salles, remplacements encore ouverts", () => {
  for (const route of STILL_OPEN_OUTSIDE_P1_12) {
    assert.equal(rbac.canAccess(AGENT, route), true, route);
    assert.equal(rbac.canAccess(SUPER, route), true, route);
  }
});
