"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mergeRolePermissions } = require("./rolePermissionsResolution");

test("mergeRolePermissions conserve un rôle PG actif avec permissions=[]", () => {
  const map = { "Lot2 Vide": [], Secrétaire: ["Documents:READ"] };
  assert.deepEqual(mergeRolePermissions("Lot2 Vide", ["Voir tableau de bord"], map), []);
});

test("mergeRolePermissions refuse le fallback dashboard pour un rôle absent de la map canonique", () => {
  const map = { Secrétaire: ["Documents:READ"] };
  assert.deepEqual(mergeRolePermissions("Rôle Inventé", ["Voir tableau de bord"], map), []);
});

test("mergeRolePermissions résout le role_code comme alias de role_name", () => {
  const permissions = ["Documents:READ"];
  const bucket = [];
  const map = { "Lot2 Code Label": bucket, lot2_code_role: bucket };
  bucket.push(...permissions);
  assert.deepEqual(mergeRolePermissions("lot2_code_role", ["Voir tableau de bord"], map), permissions);
  assert.deepEqual(mergeRolePermissions("Lot2 Code Label", ["Voir tableau de bord"], map), permissions);
});
