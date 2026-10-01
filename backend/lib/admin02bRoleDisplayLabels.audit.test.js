"use strict";

/**
 * ADMIN-02B — audit stockage libellés d’affichage.
 * STOP : aucune colonne display propre, aucune migration créée.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROLE_TO_DB } = require("./clientsManagement");
const { toRoleKey, toRoleLabel } = require("./userRoleLifecycle");
const { isProtectedSystemRole, assertNotProtectedMutation } = require("./functionalRbacManagement");
const { FUNCTIONAL_RBAC_ERROR } = require("./functionalRbacManagement");

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

test("ADMIN-02B STOP — establishment_roles n'a pas de display_label", () => {
  const schema = readUtf8("../db/establishmentRolesSchema.js");
  assert.match(schema, /role_code TEXT NOT NULL/);
  assert.match(schema, /role_name TEXT NOT NULL/);
  assert.match(schema, /establishment_roles_role_name_unique UNIQUE \(role_name\)/);
  assert.doesNotMatch(schema, /display_label/);
  assert.doesNotMatch(schema, /displayLabel/);
  assert.doesNotMatch(readUtf8("../db/migrations/20260816_establishment_roles_canonical.sql"), /display_label/);
});

test("ADMIN-02B STOP — users.role et user_roles.role_key restent l'identité", () => {
  const schema = readUtf8("../db/schema.sql");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS users \([\s\S]*role TEXT,/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_roles \([\s\S]*role_key TEXT NOT NULL/);
  assert.doesNotMatch(schema, /display_label/);
});

test("ADMIN-02B STOP — Directeur est déjà l'identité PRINCIPAL, pas SCHOOL_ADMIN", () => {
  assert.equal(ROLE_TO_DB.Directeur, "PRINCIPAL");
  assert.equal(toRoleKey("Directeur"), "PRINCIPAL");
  assert.equal(toRoleKey("Admin School"), "SCHOOL_ADMIN");
  assert.equal(toRoleLabel("SCHOOL_ADMIN"), "Admin School");
  assert.notEqual(toRoleKey("Directeur"), "SCHOOL_ADMIN");
});

test("ADMIN-02B STOP — rôles protégés non renommables via ADMIN-02", () => {
  for (const key of ["SUPER_ADMIN", "COUNTRY_ADMIN", "SCHOOL_ADMIN"]) {
    assert.equal(isProtectedSystemRole(key), true, key);
    assert.throws(
      () => assertNotProtectedMutation(key, "renommés ou modifiés"),
      (error) => error.statusCode === 403 && error.code === FUNCTIONAL_RBAC_ERROR.ROLE_PROTECTED,
    );
  }
});

test("ADMIN-02B STOP — aucune API display-label / audit dédié", () => {
  const server = readUtf8("../server.js");
  assert.doesNotMatch(server, /ROLE_DISPLAY_LABEL_UPDATE/);
  assert.doesNotMatch(server, /ROLE_DISPLAY_LABEL_RESET/);
  assert.doesNotMatch(server, /\/api\/backoffice\/rbac\/role-display/);
  assert.doesNotMatch(server, /displayLabel/);
  const rbac = readUtf8("./functionalRbacManagement.js");
  assert.doesNotMatch(rbac, /ROLE_DISPLAY_LABEL/);
});

test("ADMIN-02B STOP — updateRole ADMIN-02 mute roleName, pas un alias", () => {
  const service = readUtf8("./establishmentRolesService.js");
  assert.match(service, /assertNotProtectedMutation/);
  assert.match(service, /roleName: nextName/);
  assert.doesNotMatch(service, /displayLabel/);
});

test("ADMIN-02B STOP — aucune migration display_label ajoutée", () => {
  const migrationsDir = path.join(__dirname, "../db/migrations");
  const files = fs.readdirSync(migrationsDir);
  for (const file of files) {
    const body = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    assert.doesNotMatch(body, /display_label/, file);
    assert.doesNotMatch(body, /role_display_labels/, file);
  }
});
