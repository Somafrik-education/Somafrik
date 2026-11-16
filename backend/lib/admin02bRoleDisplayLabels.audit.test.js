"use strict";

/**
 * ADMIN-02B — garde statique : display_label hors chemins d'autorisation.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { ROLE_TO_DB } = require("./clientsManagement");
const { toRoleKey, toRoleLabel } = require("./userRoleLifecycle");
const { isProtectedSystemRole, assertNotProtectedMutation } = require("./functionalRbacManagement");
const { FUNCTIONAL_RBAC_ERROR } = require("./functionalRbacManagement");

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

const RBAC_RESOLVER_FILES = [
  "./userRoleLifecycle.js",
  "./functionalRbacResolution.js",
  "./rbacMandatoryPermissions.js",
  "../services/rbacService.js",
  "./liveRbacPrincipalAuthority.js",
];

test("ADMIN-02B — Directeur reste l'identité PRINCIPAL, pas SCHOOL_ADMIN", () => {
  assert.equal(ROLE_TO_DB.Directeur, "PRINCIPAL");
  assert.equal(toRoleKey("Directeur"), "PRINCIPAL");
  assert.equal(toRoleKey("Admin School"), "SCHOOL_ADMIN");
  assert.equal(toRoleLabel("SCHOOL_ADMIN"), "Admin School");
  assert.notEqual(toRoleKey("Directeur"), "SCHOOL_ADMIN");
});

test("ADMIN-02B — rôles protégés restent non renommables via ADMIN-02", () => {
  for (const key of ["SUPER_ADMIN", "COUNTRY_ADMIN", "SCHOOL_ADMIN"]) {
    assert.equal(isProtectedSystemRole(key), true, key);
    assert.throws(
      () => assertNotProtectedMutation(key, "renommés ou modifiés"),
      (error) => error.statusCode === 403 && error.code === FUNCTIONAL_RBAC_ERROR.ROLE_PROTECTED,
    );
  }
});

test("ADMIN-02B — resolvers RBAC / toRoleKey ne consomment pas displayLabel", () => {
  for (const file of RBAC_RESOLVER_FILES) {
    const body = readUtf8(file);
    assert.doesNotMatch(body, /displayLabel|effectiveLabel|display_label/, file);
  }
  const toRoleKeySrc = readUtf8("./userRoleLifecycle.js");
  assert.match(toRoleKeySrc, /function toRoleKey\(/);
  assert.doesNotMatch(toRoleKeySrc, /displayLabel/);
});

test("ADMIN-02B — users.role et user_roles.role_key restent l'identité", () => {
  const schema = readUtf8("../db/schema.sql");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS users \([\s\S]*role TEXT,/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_roles \([\s\S]*role_key TEXT NOT NULL/);
  assert.doesNotMatch(schema, /display_label/);
});

test("ADMIN-02B — API display-label dédiée, rename ADMIN-02 inchangé", () => {
  const server = readUtf8("../server.js");
  assert.match(server, /updateEstablishmentRoleDisplayLabel/);
  assert.match(server, /resetEstablishmentRoleDisplayLabel/);
  const service = readUtf8("./establishmentRolesService.js");
  assert.match(service, /assertNotProtectedMutation/);
  assert.match(service, /roleName: nextName/);
  const renameFn = service.slice(service.indexOf("async function updateRole("), service.indexOf("async function updateRoleDisplayLabel"));
  assert.doesNotMatch(renameFn, /displayLabel/);
});
