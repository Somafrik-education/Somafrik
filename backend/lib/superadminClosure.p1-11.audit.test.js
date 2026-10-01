"use strict";

/**
 * P1-11 — Replay final de fermeture P0/P1 après merge #850.
 * Audit only. Le résiduel RBAC Backend est constaté, pas corrigé ici.
 *
 *   node --test backend/lib/superadminClosure.p1-11.audit.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { RbacService } = require("../services/rbacService");
const { isSuperAdminPrincipal } = require("./superadminPrincipal");
const { isPlatformPersonalDataForbidden } = require("./platformPersonalDataGuard");
const { resolveFinanceSchoolScope } = require("./financeSchoolScope");
const { resolvePlanningSchoolScope } = require("./planningSchoolScope");
const { resolveStudentsSyncScope } = require("./mobileSyncScope");
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
  permissions: ["Élèves:READ", "Paiements:READ"],
  schoolCode: "CD-2026-0001",
  financeLoginCode: "CD-2026-0001",
  planningLoginCode: "CD-2026-0001",
  planningSchoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

const SCHOOL_ROUTES = [
  "GET /api/students",
  "GET /api/notes",
  "GET /api/presences",
  "GET /api/payments",
  "GET /api/backoffice/messages",
  "GET /api/data-export",
  "GET /api/course-schedules",
];

test("P1-11 Superadmin / Admin Pays : deny HTTP scolaire + scopes none", () => {
  assert.equal(isSuperAdminPrincipal(SUPER), true);
  assert.equal(isSuperAdminPrincipal(AGENT), false);
  for (const route of SCHOOL_ROUTES) {
    assert.equal(isPlatformPersonalDataForbidden(SUPER, route), true, route);
    assert.equal(isPlatformPersonalDataForbidden(COUNTRY, route), true, route);
    assert.equal(rbac.canAccess(SUPER, route), false, route);
  }
  assert.equal(resolveFinanceSchoolScope(SUPER).mode, "none");
  assert.equal(resolvePlanningSchoolScope(SUPER).mode, "none");
  assert.equal(resolveStudentsSyncScope(SUPER).scopeKind, "none");
});

test("P1-11 ALL_PRIVILEGES seul : tenant none et annuaire élèves 403", () => {
  assert.equal(resolveFinanceSchoolScope(AGENT).mode, "none");
  assert.equal(resolvePlanningSchoolScope(AGENT).mode, "none");
  assert.equal(resolveStudentsSyncScope(AGENT).scopeKind, "none");
  assert.throws(
    () => scopeSchoolStudentsForPrincipal(AGENT, [{ id: "stu-1" }], () => undefined),
    (error) => error.statusCode === 403,
  );
  assert.equal(resolveFinanceSchoolScope(SCHOOL_ADMIN).mode, "schools");
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, "GET /api/students"), true);
});

test("P1-11 RESIDUEL Backend : le garde RBAC admet encore ALL_PRIVILEGES seul", () => {
  for (const route of SCHOOL_ROUTES) {
    assert.equal(isPlatformPersonalDataForbidden(AGENT, route), false, route);
    assert.equal(rbac.canAccess(AGENT, route), true, route);
  }
  assert.equal(rbac.canAccess(AGENT, "GET /api/backoffice/users"), true);
});
