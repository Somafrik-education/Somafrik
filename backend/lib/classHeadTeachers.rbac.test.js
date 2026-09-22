"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RbacService, routePermissions } = require("../services/rbacService");
const {
  HEAD_TEACHER_CANDIDATES_ROUTE,
  HEAD_TEACHER_ASSIGN_ROUTE,
  HEAD_TEACHER_REMOVE_ROUTE,
  HEAD_TEACHER_WRITE_PERMISSIONS,
} = require("./classHeadTeachersManagement");
const { PLATFORM_ADMIN_ALLOWED } = require("./platformPersonalDataGuard");

const rbac = new RbacService();

test("routes professeur principal sont cataloguées", () => {
  for (const key of [HEAD_TEACHER_CANDIDATES_ROUTE, HEAD_TEACHER_ASSIGN_ROUTE, HEAD_TEACHER_REMOVE_ROUTE]) {
    assert.deepEqual(routePermissions[key], [...HEAD_TEACHER_WRITE_PERMISSIONS]);
    assert.ok(PLATFORM_ADMIN_ALLOWED.includes(key), key);
  }
});

test("RBAC : superadmin et admin établissement autorisés, enseignant refusé", () => {
  assert.equal(
    rbac.canAccess(
      { role: "Super Administrateur Somafrik", permissions: ["ALL_PRIVILEGES"] },
      HEAD_TEACHER_ASSIGN_ROUTE,
    ),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Gérer classes"] }, HEAD_TEACHER_ASSIGN_ROUTE),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Classes:READ", "Voir classes"] }, HEAD_TEACHER_ASSIGN_ROUTE),
    false,
    "Admin School avec jetons lecture seuls → 403, pas de shortcut rôle",
  );
  assert.equal(
    rbac.canAccess(
      { role: "Préfet des études", permissions: ["Affectations:CREATE"] },
      HEAD_TEACHER_ASSIGN_ROUTE,
    ),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Classes:READ", "Voir classes"] }, HEAD_TEACHER_ASSIGN_ROUTE),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Classes:READ"] }, HEAD_TEACHER_CANDIDATES_ROUTE),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Classes:READ"] }, HEAD_TEACHER_REMOVE_ROUTE),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Admin Pays", permissions: ["COUNTRY_PRIVILEGES"] }, HEAD_TEACHER_ASSIGN_ROUTE),
    false,
  );
});
