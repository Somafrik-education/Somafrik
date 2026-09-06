"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeRoleCode } = require("./establishmentRolesManagement");
const {
  NORMALIZE_ROLE_CODE_FUNCTION_SQL,
  backfillFromUsersRoleSql,
  inventoryUnknownUsersRoleSql,
} = require("../db/userRolesSchema");

test("normalizeRoleCode: CONSEILLER_PÉDAGOGIQUE → conseiller_pedagogique", () => {
  assert.equal(normalizeRoleCode("CONSEILLER_PÉDAGOGIQUE"), "conseiller_pedagogique");
  assert.equal(normalizeRoleCode("Conseiller pédagogique"), "conseiller_pedagogique");
  assert.equal(normalizeRoleCode("conseiller_pedagogique"), "conseiller_pedagogique");
  assert.equal(normalizeRoleCode("  Conseiller   Pédagogique  "), "conseiller_pedagogique");
  assert.equal(normalizeRoleCode("CONSEILLER-PÉDAGOGIQUE"), "conseiller_pedagogique");
});

test("normalizeRoleCode: accents / espaces / underscores / casse déterministes", () => {
  assert.equal(normalizeRoleCode("Préfet des études"), "prefet_des_etudes");
  assert.equal(normalizeRoleCode("PREFET_DES_ETUDES"), "prefet_des_etudes");
  assert.equal(normalizeRoleCode("_Admin School_"), "admin_school");
});

test("backfill catalogue n'écrit jamais la valeur legacy brute en ELSE", () => {
  const catalogSql = backfillFromUsersRoleSql(true);
  assert.match(catalogSql, /somafrik_normalize_role_code/);
  assert.match(catalogSql, /establishment_roles/);
  assert.doesNotMatch(catalogSql, /ELSE upper\(btrim\(u\.role\)\)/);
  assert.match(NORMALIZE_ROLE_CODE_FUNCTION_SQL, /normalize\(lower\(btrim\(src\)\), NFD\)/);
  assert.match(NORMALIZE_ROLE_CODE_FUNCTION_SQL, /chr\(768\)/);
});

test("inventaire sans catalogue reste fail-closed pour un rôle dynamique", () => {
  const sql = inventoryUnknownUsersRoleSql(false);
  assert.match(sql, /NOT \(/);
  assert.doesNotMatch(sql, /establishment_roles/);
});

test("inventaire avec catalogue exige une correspondance unique active school et un school_id", () => {
  const sql = inventoryUnknownUsersRoleSql(true);
  assert.match(sql, /establishment_roles/);
  assert.match(sql, /er\.status\)\) = 'active'/);
  assert.match(sql, /er\.scope\)\) = 'school'/);
  assert.match(sql, /u\.school_id IS NOT NULL/);
  assert.match(sql, /COUNT\(\*\)::int/);
  const catalogSql = backfillFromUsersRoleSql(true);
  assert.match(catalogSql, /u\.school_id IS NULL THEN NULL/);
});

test("schéma user_roles inclut le verrou FK students.user_id", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const schema = fs.readFileSync(path.join(__dirname, "../db/userRolesSchema.js"), "utf8");
  assert.match(schema, /20260908_student_role_lock\.sql/);
  const migration = fs.readFileSync(
    path.join(__dirname, "../db/migrations/20260908_student_role_lock.sql"),
    "utf8",
  );
  assert.match(migration, /st\.user_id = target_user_id/);
  assert.match(migration, /STUDENT_ROLE_LOCKED/);
  assert.match(migration, /BEFORE INSERT OR DELETE OR UPDATE/);
  assert.doesNotMatch(migration, /student_code\s*=/);
});
