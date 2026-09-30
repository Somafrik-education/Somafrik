"use strict";

/**
 * P1-01 — Superadmin n'obtient plus le périmètre Finance `mode: all`.
 *
 *   node --test backend/lib/financeSuperadminScope.p1-01.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { RbacService } = require("../services/rbacService");
const {
  resolveFinanceSchoolScope,
  schoolCodeInScope,
  attachFinanceMembershipScope,
  attachFinanceFixtureScope,
  isSchoolFinanceForbiddenForSuperadmin,
} = require("./financeSchoolScope");
const { assertTenant } = require("./financeService");
const { isFinanceLiveRbacRouteKey } = require("./financeRbacRouteMatrix");

const SCHOOL_A = "CD-2026-0001";
const SCHOOL_B = "BI-2026-0001";
const SCHOOL_FINANCE_GET = "GET /api/payments";
const SCHOOL_FINANCE_GRIDS = "GET /api/finance/fee-grids";
const SCHOOL_FINANCE_FEES = "GET /api/finance/student-fees";
const PLATFORM_SUBSCRIPTIONS = "GET /api/backoffice/subscriptions";
const PLATFORM_SUBSCRIPTION_ACCESS = "GET /api/backoffice/subscription-access";

const superadmin = {
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES", "Paiements:READ", "Frais & tarifs:READ", "Impayés:READ"],
  schoolCode: "*",
};

const superadminRequestScopedA = {
  ...superadmin,
  schoolCode: "",
  effectiveSchoolCode: SCHOOL_A,
  schoolScopeSource: "request",
  financeLoginCode: SCHOOL_A,
};

const allPrivilegesOnly = {
  role: "Agent",
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "",
};

const schoolAdminA = {
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Paiements:READ", "Frais & tarifs:READ", "Impayés:READ", "Voir paiements"],
  schoolCode: SCHOOL_A,
  financeLoginCode: SCHOOL_A,
};

const schoolAdminB = {
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Paiements:READ", "Frais & tarifs:READ", "Impayés:READ"],
  schoolCode: SCHOOL_B,
  financeLoginCode: SCHOOL_B,
};

const accountantA = {
  role: "Comptable",
  roleKeys: ["ACCOUNTANT"],
  permissions: ["Paiements:READ", "Paiements:CREATE", "Paiements:UPDATE", "Voir paiements"],
  schoolCode: SCHOOL_A,
  financeLoginCode: SCHOOL_A,
};

test("P1-01 Superadmin → Finance scolaire globale : refus (mode none, pas all)", () => {
  const scope = resolveFinanceSchoolScope(superadmin);
  assert.equal(scope.mode, "none");
  assert.equal(schoolCodeInScope(SCHOOL_A, scope), false);
  assert.equal(schoolCodeInScope(SCHOOL_B, scope), false);
  const rbac = new RbacService();
  assert.equal(rbac.canAccess(superadmin, SCHOOL_FINANCE_GET), false);
  assert.equal(rbac.canAccess(superadmin, SCHOOL_FINANCE_GRIDS), false);
  assert.equal(rbac.canAccess(superadmin, SCHOOL_FINANCE_FEES), false);
  assert.throws(
    () => assertTenant(superadmin, SCHOOL_A),
    (error) => error.statusCode === 403,
  );
});

test("P1-01 Superadmin → Finance d'un établissement précis : refus sans rôle scolaire", () => {
  const scope = resolveFinanceSchoolScope(superadminRequestScopedA);
  assert.equal(scope.mode, "none");
  assert.equal(schoolCodeInScope(SCHOOL_A, scope), false);
  const rbac = new RbacService();
  assert.equal(rbac.canAccess(superadminRequestScopedA, SCHOOL_FINANCE_GET), false);
  assert.equal(rbac.canAccess(superadminRequestScopedA, SCHOOL_FINANCE_GRIDS), false);
  assert.throws(
    () => assertTenant(superadminRequestScopedA, SCHOOL_A),
    (error) => error.statusCode === 403,
  );
});

test("P1-01 ALL_PRIVILEGES seul ne donne pas accès aux données financières scolaires", () => {
  const scope = resolveFinanceSchoolScope(allPrivilegesOnly);
  assert.equal(scope.mode, "none");
  assert.equal(schoolCodeInScope(SCHOOL_A, scope), false);
  const rbac = new RbacService();
  assert.equal(rbac.canAccess(superadmin, SCHOOL_FINANCE_GRIDS), false);
  assert.equal(isSchoolFinanceForbiddenForSuperadmin(superadmin, SCHOOL_FINANCE_GRIDS), true);
  assert.equal(isSchoolFinanceForbiddenForSuperadmin(allPrivilegesOnly, SCHOOL_FINANCE_GRIDS), false);
  assert.throws(
    () => assertTenant(allPrivilegesOnly, SCHOOL_A),
    (error) => error.statusCode === 403,
  );
});

test("P1-01 Admin School conserve la Finance de son établissement", () => {
  const scope = resolveFinanceSchoolScope(schoolAdminA);
  assert.equal(scope.mode, "schools");
  assert.deepEqual(scope.codes, [SCHOOL_A]);
  assert.equal(schoolCodeInScope(SCHOOL_A, scope), true);
  const rbac = new RbacService();
  assert.equal(rbac.canAccess(schoolAdminA, SCHOOL_FINANCE_GET), true);
  assert.equal(rbac.canAccess(schoolAdminA, SCHOOL_FINANCE_GRIDS), true);
  assert.doesNotThrow(() => assertTenant(schoolAdminA, SCHOOL_A));
});

test("P1-01 Admin School établissement A → établissement B refusé", () => {
  const scope = resolveFinanceSchoolScope(schoolAdminA);
  assert.equal(schoolCodeInScope(SCHOOL_B, scope), false);
  assert.throws(
    () => assertTenant(schoolAdminA, SCHOOL_B),
    (error) => error.statusCode === 403,
  );
  const scopeB = resolveFinanceSchoolScope(schoolAdminB);
  assert.equal(schoolCodeInScope(SCHOOL_A, scopeB), false);
  assert.throws(
    () => assertTenant(schoolAdminB, SCHOOL_A),
    (error) => error.statusCode === 403,
  );
});

test("P1-01 utilisateur Finance autorisé conserve le périmètre de son établissement", () => {
  const scope = resolveFinanceSchoolScope(accountantA);
  assert.equal(scope.mode, "schools");
  assert.deepEqual(scope.codes, [SCHOOL_A]);
  assert.equal(schoolCodeInScope(SCHOOL_A, scope), true);
  assert.equal(schoolCodeInScope(SCHOOL_B, scope), false);
  const rbac = new RbacService();
  assert.equal(rbac.canAccess(accountantA, SCHOOL_FINANCE_GET), true);
  assert.doesNotThrow(() => assertTenant(accountantA, SCHOOL_A));
  assert.throws(
    () => assertTenant(accountantA, SCHOOL_B),
    (error) => error.statusCode === 403,
  );
});

test("P1-01 Superadmin conserve les abonnements plateforme Somafrik", () => {
  const rbac = new RbacService();
  assert.equal(isFinanceLiveRbacRouteKey(PLATFORM_SUBSCRIPTIONS), false);
  assert.equal(isFinanceLiveRbacRouteKey(PLATFORM_SUBSCRIPTION_ACCESS), false);
  assert.equal(isSchoolFinanceForbiddenForSuperadmin(superadmin, PLATFORM_SUBSCRIPTIONS), false);
  assert.equal(rbac.canAccess(superadmin, PLATFORM_SUBSCRIPTIONS), true);
  assert.equal(rbac.canAccess(superadmin, PLATFORM_SUBSCRIPTION_ACCESS), true);
  assert.equal(rbac.canAccess(superadmin, "GET /api/backoffice/countries"), true);
});

test("P1-01 absence de principal → fail-closed", () => {
  assert.equal(resolveFinanceSchoolScope(null).mode, "none");
  assert.equal(resolveFinanceSchoolScope(undefined).mode, "none");
  assert.equal(schoolCodeInScope(SCHOOL_A, resolveFinanceSchoolScope(null)), false);
  const rbac = new RbacService();
  assert.equal(rbac.canAccess(null, SCHOOL_FINANCE_GET), false);
  assert.equal(rbac.canAccess(undefined, SCHOOL_FINANCE_GRIDS), false);
  assert.throws(
    () => assertTenant(null, SCHOOL_A),
    (error) => error.statusCode === 403,
  );
});

test("P1-01 Superadmin n'acquiert pas de membership Finance (attach)", async () => {
  const one = async () => {
    throw new Error("lookup école interdit pour Superadmin");
  };
  const attached = await attachFinanceMembershipScope(superadminRequestScopedA, one);
  assert.equal(attached.financeLoginCode, SCHOOL_A);
  assert.equal(resolveFinanceSchoolScope(attached).mode, "none");
  const fixture = attachFinanceFixtureScope(superadmin);
  assert.equal(resolveFinanceSchoolScope(fixture).mode, "none");
});

test("garde source : SUPER_ADMIN ne doit plus produire mode: all", () => {
  const source = fs.readFileSync(path.join(__dirname, "financeSchoolScope.js"), "utf8");
  const resolveFn = source.slice(
    source.indexOf("function resolveFinanceSchoolScope"),
    source.indexOf("function sqlSchoolPredicate"),
  );
  assert.match(resolveFn, /if \(!principal\) \{\s*return \{ mode: "none" \}/);
  assert.doesNotMatch(resolveFn, /mode:\s*["']all["']/);
  assert.doesNotMatch(resolveFn, /return \{ mode: "all" \}/);
  assert.match(resolveFn, /isPlatformSuperadminRole\(principal\)/);

  const canAccess = fs
    .readFileSync(path.join(__dirname, "../services/rbacService.js"), "utf8")
    .match(/canAccess\(principal, routeKey\) \{[\s\S]*?\n  \}/);
  assert.ok(canAccess, "canAccess introuvable");
  assert.match(canAccess[0], /isSchoolFinanceForbiddenForSuperadmin\(principal, routeKey\)/);
});
