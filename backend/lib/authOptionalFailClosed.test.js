"use strict";

/**
 * P0-04 — SOMAFRIK_AUTH_OPTIONAL ne contourne plus canAccess.
 *
 *   node --test backend/lib/authOptionalFailClosed.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { RbacService } = require("../services/rbacService");

const PROTECTED_ROUTE = "GET /api/students";
const PLATFORM_ROUTE = "GET /api/backoffice/countries";

const schoolAdmin = {
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Élèves:READ", "Voir élèves", "Gérer élèves"],
  schoolCode: "CD-2026-0001",
};

const teacherNoStudents = {
  role: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: ["Voir tableau de bord"],
  schoolCode: "CD-2026-0001",
};

const superadmin = {
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES", "Élèves:READ", "Voir élèves"],
  schoolCode: "*",
};

function withAuthOptional(value, fn) {
  const previous = process.env.SOMAFRIK_AUTH_OPTIONAL;
  if (value === undefined) {
    delete process.env.SOMAFRIK_AUTH_OPTIONAL;
  } else {
    process.env.SOMAFRIK_AUTH_OPTIONAL = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.SOMAFRIK_AUTH_OPTIONAL;
    } else {
      process.env.SOMAFRIK_AUTH_OPTIONAL = previous;
    }
  }
}

test("P0-04 route protégée sans principal → refus", () => {
  const rbac = new RbacService();
  assert.equal(rbac.canAccess(null, PROTECTED_ROUTE), false);
  assert.equal(rbac.canAccess(undefined, PROTECTED_ROUTE), false);
});

test("P0-04 SOMAFRIK_AUTH_OPTIONAL=true ne déverrouille pas une route protégée sans principal", () => {
  const rbac = new RbacService();
  withAuthOptional("true", () => {
    assert.equal(rbac.canAccess(null, PROTECTED_ROUTE), false);
    assert.equal(rbac.canAccess(undefined, PROTECTED_ROUTE), false);
    assert.equal(rbac.canAccess(teacherNoStudents, PROTECTED_ROUTE), false);
  });
});

test("P0-04 utilisateur authentifié et autorisé conserve l'accès", () => {
  const rbac = new RbacService();
  assert.equal(rbac.canAccess(schoolAdmin, PROTECTED_ROUTE), true);
  withAuthOptional("true", () => {
    assert.equal(rbac.canAccess(schoolAdmin, PROTECTED_ROUTE), true);
  });
});

test("P0-04 utilisateur authentifié sans permission → refus, même avec AUTH_OPTIONAL", () => {
  const rbac = new RbacService();
  assert.equal(rbac.canAccess(teacherNoStudents, PROTECTED_ROUTE), false);
  withAuthOptional("true", () => {
    assert.equal(rbac.canAccess(teacherNoStudents, PROTECTED_ROUTE), false);
  });
});

test("P0-04 Superadmin : uniquement le contrat plateforme, AUTH_OPTIONAL n'ouvre pas les PII", () => {
  const rbac = new RbacService();
  assert.equal(rbac.canAccess(superadmin, PLATFORM_ROUTE), true);
  assert.equal(rbac.canAccess(superadmin, PROTECTED_ROUTE), false);
  withAuthOptional("true", () => {
    assert.equal(rbac.canAccess(superadmin, PLATFORM_ROUTE), true);
    assert.equal(rbac.canAccess(superadmin, PROTECTED_ROUTE), false);
  });
});

test("garde source : SOMAFRIK_AUTH_OPTIONAL ne force plus canAccess=true", () => {
  const source = fs.readFileSync(path.join(__dirname, "../services/rbacService.js"), "utf8");
  const canAccess = source.match(/canAccess\(principal, routeKey\) \{[\s\S]*?\n  \}/);
  assert.ok(canAccess, "canAccess introuvable");
  assert.doesNotMatch(canAccess[0], /SOMAFRIK_AUTH_OPTIONAL/);
  assert.doesNotMatch(canAccess[0], /return true;/);
  assert.match(canAccess[0], /if \(!principal\) \{\s*return false;/);

  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const requirePermission = server.match(/function requirePermission\(routeKey\) \{[\s\S]*?\n\}/);
  assert.ok(requirePermission, "requirePermission introuvable");
  assert.doesNotMatch(requirePermission[0], /SOMAFRIK_AUTH_OPTIONAL/);
  assert.match(requirePermission[0], /rbacService\.canAccess\(req\.principal, routeKey\)/);
});
