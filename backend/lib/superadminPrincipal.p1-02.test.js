"use strict";

/**
 * P1-02 — une seule autorité isSuperAdminPrincipal.
 *
 *   node --test backend/lib/superadminPrincipal.p1-02.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { RbacService } = require("../services/rbacService");
const { isSuperAdminPrincipal } = require("./superadminPrincipal");
const { resolveFinanceSchoolScope } = require("./financeSchoolScope");
const { isPlatformPersonalDataForbidden } = require("./platformPersonalDataGuard");
const {
  principalHasClassAccess,
  scopeSchoolStudentsForPrincipal,
} = require("./classStudentsAuthz");

const CANONICAL = {
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
};

test("P1-02 rôle canonique Superadmin reconnu", () => {
  assert.equal(isSuperAdminPrincipal({ role: "Super Administrateur Somafrik" }), true);
  assert.equal(isSuperAdminPrincipal(CANONICAL), true);
});

test("P1-02 SUPER_ADMIN reconnu selon le contrat d'authentification", () => {
  assert.equal(isSuperAdminPrincipal({ roleKeys: ["SUPER_ADMIN"] }), true);
  assert.equal(isSuperAdminPrincipal({ roleKey: "SUPER_ADMIN" }), true);
  assert.equal(isSuperAdminPrincipal({ roles: ["SUPER_ADMIN"] }), true);
  assert.equal(isSuperAdminPrincipal({ roles: [{ roleKey: "SUPER_ADMIN" }] }), true);
});

test("P1-02 alias super_admin reconnu lorsqu'il appartient au principal", () => {
  assert.equal(isSuperAdminPrincipal({ role: "super_admin" }), true);
  assert.equal(isSuperAdminPrincipal({ roleKeys: ["super_admin"] }), true);
});

test("P1-02 alias historique OKAFRIK reconnu (compat JWT)", () => {
  assert.equal(isSuperAdminPrincipal({ role: "Super Administrateur OKAFRIK" }), true);
});

test("P1-02 ALL_PRIVILEGES seul n'est pas Superadmin", () => {
  assert.equal(isSuperAdminPrincipal({ permissions: ["ALL_PRIVILEGES"] }), false);
  assert.equal(
    isSuperAdminPrincipal({ role: "Admin School", permissions: ["ALL_PRIVILEGES"], schoolCode: "*" }),
    false,
  );
});

test("P1-02 schoolCode: \"*\" seul n'est pas Superadmin", () => {
  assert.equal(isSuperAdminPrincipal({ schoolCode: "*" }), false);
  assert.equal(isSuperAdminPrincipal({ role: "Admin School", schoolCode: "*" }), false);
});

test("P1-02 Admin School / Admin Pays non reconnus", () => {
  assert.equal(isSuperAdminPrincipal({ role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] }), false);
  assert.equal(isSuperAdminPrincipal({ role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"] }), false);
});

test("P1-02 principal absent ou malformé → false", () => {
  assert.equal(isSuperAdminPrincipal(null), false);
  assert.equal(isSuperAdminPrincipal(undefined), false);
  assert.equal(isSuperAdminPrincipal(""), false);
  assert.equal(isSuperAdminPrincipal([]), false);
  assert.equal(isSuperAdminPrincipal({}), false);
  assert.equal(isSuperAdminPrincipal({ identifier: "superadmin" }), false);
  assert.equal(isSuperAdminPrincipal({ roleKeys: "SUPER_ADMIN" }), false);
  assert.equal(isSuperAdminPrincipal({ roles: { role: "SUPER_ADMIN" } }), false);
  assert.equal(isSuperAdminPrincipal({ role: 1, permissions: ["ALL_PRIVILEGES"] }), false);
});

test("P1-02 unification ne rouvre pas les PII élèves", () => {
  const rbac = new RbacService();
  assert.equal(isPlatformPersonalDataForbidden(CANONICAL, "GET /api/students"), true);
  assert.equal(rbac.canAccess(CANONICAL, "GET /api/students"), false);
  assert.equal(rbac.canAccess({ role: "super_admin", permissions: ["ALL_PRIVILEGES"] }, "GET /api/students"), false);
  assert.equal(rbac.canAccess({ roleKeys: ["SUPER_ADMIN"], permissions: ["ALL_PRIVILEGES"] }, "GET /api/students"), false);
  assert.equal(
    isPlatformPersonalDataForbidden({ permissions: ["ALL_PRIVILEGES"], schoolCode: "*" }, "GET /api/students"),
    false,
    "ALL_PRIVILEGES + schoolCode * seuls ne font pas un Superadmin (donc pas le deny plateforme)",
  );
});

test("P1-02 unification ne rouvre pas la Finance scolaire", () => {
  const rbac = new RbacService();
  const financeSource = fs.readFileSync(path.join(__dirname, "financeSchoolScope.js"), "utf8");
  assert.equal(resolveFinanceSchoolScope(CANONICAL).mode, "none");
  assert.equal(resolveFinanceSchoolScope({ role: "super_admin", roleKeys: ["SUPER_ADMIN"] }).mode, "none");
  assert.equal(rbac.canAccess(CANONICAL, "GET /api/finance/fee-grids"), false);
  assert.equal(rbac.canAccess({ role: "super_admin", permissions: ["ALL_PRIVILEGES"] }, "GET /api/finance/fee-grids"), false);
  assert.equal(rbac.canAccess(CANONICAL, "GET /api/payments"), false);
  assert.match(financeSource, /require\("\.\/superadminPrincipal"\)/);
  assert.doesNotMatch(financeSource, /function isPlatformSuperadminRole/);
  assert.doesNotMatch(
    financeSource.slice(
      financeSource.indexOf("function resolveFinanceSchoolScope"),
      financeSource.indexOf("function sqlSchoolPredicate"),
    ),
    /return \{ mode: "all" \}/,
  );
});

test("P1-02 unification ne rouvre pas les ressources school-domain protégées", () => {
  const superadmin = { role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"] };
  const alias = { role: "super_admin", roleKeys: ["SUPER_ADMIN"] };
  assert.equal(principalHasClassAccess(superadmin, "Classe A"), false);
  assert.equal(principalHasClassAccess(alias, "Classe A"), false);
  assert.throws(
    () => scopeSchoolStudentsForPrincipal(superadmin, [{ id: "STU-1" }], () => undefined),
    (error) => error.statusCode === 403,
  );
});

test("garde source : une seule function isSuperAdminPrincipal Backend", () => {
  const root = path.join(__dirname, "..");
  const hits = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "coverage"].includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".js")) continue;
      const text = fs.readFileSync(full, "utf8");
      if (/function isSuperAdminPrincipal\s*\(/.test(text)) hits.push(path.relative(root, full));
    }
  }
  walk(root);
  assert.deepEqual(hits, ["lib/superadminPrincipal.js"], hits.join(", "));
});

test("P1-02 ne branche pas l'autorité canonique pour accorder mode all", () => {
  const files = [
    "usersSchoolScope.js",
    "presenceSchoolScope.js",
    "academicYearSchoolScope.js",
    "enrollmentSchoolScope.js",
    "classStudentsAuthz.js",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.doesNotMatch(source, /require\("\.\/superadminPrincipal"\)/, file);
  }
});
