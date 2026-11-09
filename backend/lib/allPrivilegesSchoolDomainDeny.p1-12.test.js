"use strict";

/**
 * P1-12 — ALL_PRIVILEGES seul n'ouvre plus le domaine scolaire via canAccess.
 *
 *   node --test backend/lib/allPrivilegesSchoolDomainDeny.p1-12.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { RbacService } = require("../services/rbacService");
const { isPlatformPersonalDataForbidden } = require("./platformPersonalDataGuard");
const { isSuperAdminPrincipal } = require("./superadminPrincipal");
const {
  hasBackendSchoolBoundRole,
  omitAllPrivilegesForUnboundSchoolDomain,
} = require("./allPrivilegesSchoolDomainDeny");

const rbac = new RbacService();

const AGENT = { role: "Agent", permissions: ["ALL_PRIVILEGES"], schoolCode: "*" };
const EMPTY_ROLE = { role: "", permissions: ["ALL_PRIVILEGES"], schoolCode: "*" };
const SCHOOL_ROUTES = [
  "GET /api/students",
  "GET /api/notes",
  "GET /api/presences",
  "GET /api/payments",
  "GET /api/backoffice/messages",
  "GET /api/data-export",
  "GET /api/course-schedules",
  "GET /api/teachers",
  "GET /api/finance/fee-grids",
];
const PLATFORM_ROUTES = [
  "GET /api/backoffice/users",
  "GET /api/backoffice/subscriptions",
  "GET /api/backoffice/countries",
  "GET /api/classes",
];

test("P1-12 ALL_PRIVILEGES seul : canAccess scolaire refusé, plateforme conservée", () => {
  assert.equal(isSuperAdminPrincipal(AGENT), false);
  assert.equal(hasBackendSchoolBoundRole(AGENT), false);
  assert.equal(isPlatformPersonalDataForbidden(AGENT, "GET /api/students"), false);
  for (const route of SCHOOL_ROUTES) {
    assert.equal(rbac.canAccess(AGENT, route), false, route);
    assert.equal(rbac.canAccess(EMPTY_ROLE, route), false, route);
  }
  for (const route of PLATFORM_ROUTES) {
    assert.equal(rbac.canAccess(AGENT, route), true, route);
  }
});

test("P1-12 rôles établissement : ALL_PRIVILEGES ne retire pas l'accès scolaire", () => {
  const schoolAdmin = {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["ALL_PRIVILEGES"],
    schoolCode: "*",
  };
  const teacher = { role: "teacher", permissions: ["ALL_PRIVILEGES"], schoolCode: "CD-2026-0001" };
  const parent = { role: "parent_student", permissions: ["ALL_PRIVILEGES"], schoolCode: "CD-2026-0001" };
  const student = { role: "Élève / Étudiant", permissions: ["ALL_PRIVILEGES"], schoolCode: "CD-2026-0001" };
  const prefet = { role: "prefet", permissions: ["ALL_PRIVILEGES"], schoolCode: "CD-2026-0001" };
  const accountant = { roleKeys: ["ACCOUNTANT"], permissions: ["ALL_PRIVILEGES"], schoolCode: "CD-2026-0001" };

  assert.equal(hasBackendSchoolBoundRole(schoolAdmin), true);
  assert.equal(rbac.canAccess(schoolAdmin, "GET /api/students"), true);
  assert.equal(rbac.canAccess(schoolAdmin, "GET /api/backoffice/messages"), true);
  assert.equal(rbac.canAccess(schoolAdmin, "GET /api/payments"), true);
  assert.equal(rbac.canAccess(schoolAdmin, "GET /api/finance/fee-grids"), true);
  assert.equal(rbac.canAccess(teacher, "GET /api/notes"), true);
  assert.equal(rbac.canAccess(parent, "GET /api/students"), true);
  assert.equal(rbac.canAccess(student, "GET /api/presences"), true);
  assert.equal(rbac.canAccess(prefet, "GET /api/course-schedules"), true);
  assert.equal(rbac.canAccess(accountant, "GET /api/payments"), true);
});

test("P1-12 un jeton scolaire explicite sans ALL_PRIVILEGES reste évalué", () => {
  const explicit = { role: "Agent", permissions: ["Élèves:READ"], schoolCode: "CD-2026-0001" };
  assert.equal(rbac.canAccess(explicit, "GET /api/students"), true);
  assert.equal(rbac.canAccess(explicit, "GET /api/notes"), false);
  const mixed = { role: "Agent", permissions: ["ALL_PRIVILEGES", "Élèves:READ"], schoolCode: "*" };
  assert.equal(rbac.canAccess(mixed, "GET /api/students"), true);
  assert.equal(rbac.canAccess(mixed, "GET /api/notes"), false);
});

test("garde source P1-12 : le jeton est retiré avant some()", () => {
  const source = fs.readFileSync(path.join(__dirname, "../services/rbacService.js"), "utf8");
  const canAccess = source.match(/canAccess\(principal, routeKey\) \{[\s\S]*?\n  \}/);
  assert.ok(canAccess, "canAccess introuvable");
  const body = canAccess[0];
  const omitAt = body.indexOf("omitAllPrivilegesForUnboundSchoolDomain(");
  const returnAt = body.indexOf("return requiredPermissions.some(");
  assert.ok(omitAt > 0);
  assert.ok(returnAt > omitAt);
  const stripped = omitAllPrivilegesForUnboundSchoolDomain(AGENT, "GET /api/students", new Set(["ALL_PRIVILEGES"]));
  assert.equal(stripped.has("ALL_PRIVILEGES"), false);
});
