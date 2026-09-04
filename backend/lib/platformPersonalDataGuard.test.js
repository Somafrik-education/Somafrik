"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RbacService, routePermissions } = require("../services/rbacService");
const {
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  PLATFORM_ADMIN_ALLOWED,
  PLATFORM_PERSONAL_DATA_DENY,
  isPlatformAdminPrincipal,
  isPlatformPersonalDataForbidden,
  isPlatformPersonalDataForbiddenHttp,
  matchForbiddenPersonalDataRouteKey,
  isPersonalDataPermissionToken,
  stripPersonalDataPermissions,
  unclassifiedRouteKeys,
} = require("./platformPersonalDataGuard");
const seedData = require("../data");

const rbac = new RbacService();

const SUPER = {
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES", "Élèves:READ", "Voir élèves"],
  schoolCode: "*",
};

const SUPER_WITH_SCHOOL = {
  ...SUPER,
  schoolCode: "CD-2026-0001",
};

const COUNTRY = {
  role: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES", "Élèves:READ"],
  schoolCode: "*",
  countryCode: "CD",
};

const COUNTRY_WITH_SCHOOL = {
  ...COUNTRY,
  schoolCode: "CD-2026-0001",
};

const SCHOOL_ADMIN = {
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Élèves:READ", "Voir élèves", "Gérer élèves"],
  schoolCode: "CD-2026-0001",
};

const TEACHER = {
  role: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: ["Voir élèves", "Élèves:READ", "Notes:READ", "Présences:READ"],
  schoolCode: "CD-2026-0001",
};

const FORBIDDEN_SAMPLE = [
  "GET /api/students",
  "GET /api/teachers",
  "GET /api/notes",
  "GET /api/evaluations",
  "GET /api/presences",
  "GET /api/payments",
  "GET /api/backoffice/messages",
  "GET /api/v2/documents",
  "GET /api/data-export",
];

test("P0-2 : chaque route FORBIDDEN existe dans routePermissions", () => {
  const { missingFromCatalog } = unclassifiedRouteKeys(routePermissions);
  assert.deepEqual(missingFromCatalog, [], missingFromCatalog.join(", "));
});

test("P0-2 : PLATFORM_ADMIN_ALLOWED et FORBIDDEN sont disjoints", () => {
  const overlap = PLATFORM_ADMIN_ALLOWED.filter((key) =>
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(key),
  );
  assert.deepEqual(overlap, [], overlap.join(", "));
  const missingAllowed = PLATFORM_ADMIN_ALLOWED.filter((key) => !routePermissions[key]);
  assert.deepEqual(missingAllowed, [], missingAllowed.join(", "));
});

test("P0-2 : Superadmin / Admin Pays identifiés même via roleKeys", () => {
  assert.equal(isPlatformAdminPrincipal(SUPER), true);
  assert.equal(isPlatformAdminPrincipal(COUNTRY), true);
  assert.equal(isPlatformAdminPrincipal({ roleKeys: ["SUPER_ADMIN"] }), true);
  assert.equal(isPlatformAdminPrincipal({ role: "Super Administrateur OKAFRIK" }), true);
  assert.equal(isPlatformAdminPrincipal(SCHOOL_ADMIN), false);
  assert.equal(isPlatformAdminPrincipal(TEACHER), false);
});

test("P0-2 : matching HTTP ignore query/header et paramétrage :id", () => {
  assert.equal(matchForbiddenPersonalDataRouteKey("GET", "/api/students"), "GET /api/students");
  assert.equal(
    matchForbiddenPersonalDataRouteKey("GET", "/api/students?schoolCode=CD-IN-26-001"),
    "GET /api/students",
  );
  assert.equal(matchForbiddenPersonalDataRouteKey("GET", "/api/students/abc-1"), "GET /api/students/:id");
  assert.equal(matchForbiddenPersonalDataRouteKey("GET", "/api/backoffice/countries"), "");
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/students"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER_WITH_SCHOOL, "GET", "/api/students"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(COUNTRY_WITH_SCHOOL, "GET", "/api/data-export"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SCHOOL_ADMIN, "GET", "/api/students"), false);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/backoffice/countries"), false);
});

test("P0-2 : deny avant some() — ALL_PRIVILEGES ne passe pas les routes perso", () => {
  for (const route of FORBIDDEN_SAMPLE) {
    assert.equal(isPlatformPersonalDataForbidden(SUPER, route), true, route);
    assert.equal(rbac.canAccess(SUPER, route), false, `super ${route}`);
    assert.equal(rbac.canAccess(SUPER_WITH_SCHOOL, route), false, `super+school ${route}`);
    assert.equal(rbac.canAccess(COUNTRY, route), false, `country ${route}`);
    assert.equal(rbac.canAccess(COUNTRY_WITH_SCHOOL, route), false, `country+school ${route}`);
  }
  assert.equal(PLATFORM_PERSONAL_DATA_DENY, "PLATFORM_PERSONAL_DATA_DENIED");
});

test("P0-2 : toutes les routes FORBIDDEN refusent SUPER_ADMIN et COUNTRY_ADMIN", () => {
  for (const route of SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM) {
    assert.equal(rbac.canAccess(SUPER, route), false, `super ${route}`);
    assert.equal(rbac.canAccess(SUPER_WITH_SCHOOL, route), false, `super+school ${route}`);
    assert.equal(rbac.canAccess(COUNTRY, route), false, `country ${route}`);
    assert.equal(rbac.canAccess(COUNTRY_WITH_SCHOOL, route), false, `country+school ${route}`);
  }
});

test("P0-2 : rôles établissement autorisés restent positifs", () => {
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, "GET /api/students"), true);
  assert.equal(rbac.canAccess(TEACHER, "GET /api/students"), true);
  assert.equal(
    rbac.canAccess({ ...SCHOOL_ADMIN, permissions: ["Enseignants:READ", "Voir enseignants"] }, "GET /api/teachers"),
    true,
  );
  assert.equal(rbac.canAccess(TEACHER, "GET /api/notes"), true);
  assert.equal(
    rbac.canAccess(
      { role: "Admin School", permissions: ["Paramètres Établissement:READ"], schoolCode: "CD-2026-0001" },
      "GET /api/data-export",
    ),
    true,
  );
});

test("P0-2 : fonctions plateforme restent ouvertes", () => {
  for (const route of [
    "GET /api/backoffice/countries",
    "GET /api/backoffice/establishments",
    "GET /api/backoffice/users",
    "GET /api/backoffice/subscriptions",
    "GET /api/backoffice/rbac/catalog",
    "GET /api/backoffice/platform-announcements",
  ]) {
    assert.equal(rbac.canAccess(SUPER, route), true, route);
  }
  assert.equal(rbac.canAccess(COUNTRY, "GET /api/backoffice/establishments"), true);
  assert.equal(rbac.canAccess(COUNTRY, "GET /api/backoffice/users"), true);
});

test("P0-2 : seed Superadmin / Admin Pays sans jetons perso", () => {
  const superPerms = seedData.rolePermissions["Super Administrateur Somafrik"] ?? [];
  const countryPerms = seedData.rolePermissions["Admin Pays"] ?? [];
  for (const token of superPerms) {
    assert.equal(isPersonalDataPermissionToken(token), false, `super seed ${token}`);
  }
  for (const token of countryPerms) {
    assert.equal(isPersonalDataPermissionToken(token), false, `country seed ${token}`);
  }
  assert.ok(superPerms.includes("ALL_PRIVILEGES"));
  assert.ok(countryPerms.includes("COUNTRY_PRIVILEGES"));
  assert.deepEqual(stripPersonalDataPermissions(["ALL_PRIVILEGES", "Élèves:READ", "Voir élèves"]), ["ALL_PRIVILEGES"]);
});
