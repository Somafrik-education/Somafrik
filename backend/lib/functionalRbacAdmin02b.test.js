"use strict";

/**
 * ADMIN-02B — libellés d'affichage (DL-01 → DL-18).
 * DISPLAY ONLY. role_code / role_name / user_roles / JWT / RBAC inchangés.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { updateRoleDisplayLabel, resetRoleDisplayLabel, listRoleDisplayLabels, updateRole } = require("./establishmentRolesService");
const { resolveEffectiveRoleLabel, applyRoleDisplayContract, normalizeDisplayLabel } = require("./roleDisplayLabels");
const { ROLE_TO_DB } = require("./clientsManagement");
const { toRoleKey, toRoleLabel } = require("./userRoleLifecycle");
const { RBAC_AUDIT_ACTIONS, assertNotProtectedMutation, FUNCTIONAL_RBAC_ERROR } = require("./functionalRbacManagement");
const { createEstablishmentRolesMemoryStore } = require("../db/establishmentRolesMemoryStore");
const { RbacService, routePermissions } = require("../services/rbacService");
const { PLATFORM_ADMIN_ALLOWED } = require("./platformPersonalDataGuard");

const SUPER_ADMIN = {
  role: "Super Administrateur Somafrik",
  identifier: "superadmin",
  roleKeys: ["SUPER_ADMIN"],
};
const COUNTRY_ADMIN = { role: "Admin Pays", identifier: "country-admin", roleKeys: ["COUNTRY_ADMIN"] };
const SCHOOL_ADMIN = { role: "Admin School", identifier: "school-admin", roleKeys: ["SCHOOL_ADMIN"] };
const TEACHER = { role: "Enseignant", identifier: "teacher", roleKeys: ["TEACHER"] };

const WRITE_PATCH = "PATCH /api/backoffice/rbac/roles/:roleId/display-label";
const WRITE_RESET = "POST /api/backoffice/rbac/roles/:roleId/display-label/reset";

function rolesRepo() {
  const store = createEstablishmentRolesMemoryStore({
    roles: [
      {
        id: "role-super",
        roleCode: "SUPER_ADMIN",
        roleName: "Super Administrateur Somafrik",
        scope: "platform",
        schoolAssignable: false,
      },
      {
        id: "role-country",
        roleCode: "COUNTRY_ADMIN",
        roleName: "Admin Pays",
        scope: "country",
        schoolAssignable: false,
      },
      {
        id: "role-school",
        roleCode: "SCHOOL_ADMIN",
        roleName: "Admin School",
        scope: "school",
        schoolAssignable: false,
      },
      {
        id: "role-principal",
        roleCode: "PRINCIPAL",
        roleName: "Directeur",
        scope: "school",
        schoolAssignable: true,
      },
    ],
  });
  const audits = [];
  const repo = {
    getEstablishmentRolesStore: () => store,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async (entry) => {
      audits.push(entry);
      return true;
    },
  };
  return { repo, store, audits };
}

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

test("DL-01 colonne display_label nullable, sans UNIQUE", () => {
  const schema = readUtf8("../db/establishmentRolesSchema.js");
  const migration = readUtf8("../db/migrations/20261001_establishment_roles_display_label.sql");
  assert.match(schema, /display_label TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS display_label TEXT/);
  assert.doesNotMatch(schema, /UNIQUE \(display_label\)/);
  assert.doesNotMatch(migration, /UNIQUE \(display_label\)/);
  assert.doesNotMatch(migration, /UNIQUE \(display_label/);
  assert.equal(normalizeDisplayLabel(""), null);
  assert.equal(normalizeDisplayLabel("   "), null);
});

test("DL-02 defaultLabel = role_name", () => {
  const contract = applyRoleDisplayContract({ role_code: "SCHOOL_ADMIN", role_name: "Admin School" });
  assert.equal(contract.roleKey, "SCHOOL_ADMIN");
  assert.equal(contract.defaultLabel, "Admin School");
  assert.equal(contract.displayLabel, null);
});

test("DL-03 effectiveLabel = display_label trim non vide", () => {
  assert.equal(
    resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: "  Directeur  " }),
    "Directeur",
  );
});

test("DL-04 NULL display_label → effectiveLabel = role_name", () => {
  assert.equal(
    resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: null }),
    "Admin School",
  );
});

test("DL-05 chaîne vide traitée comme RESET/NULL, jamais stockée", async () => {
  const { repo, store } = rolesRepo();
  const saved = await updateRoleDisplayLabel(repo, "role-school", { displayLabel: "   " }, SUPER_ADMIN, {});
  assert.equal(saved.displayLabel, null);
  assert.equal(saved.effectiveLabel, "Admin School");
  const row = await store.getRoleById("role-school");
  assert.equal(row.displayLabel, null);
});

test("DL-06 SUPER_ADMIN écrit un display_label y compris rôle protégé", async () => {
  const { repo, store } = rolesRepo();
  const saved = await updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, SUPER_ADMIN, {});
  assert.equal(saved.roleKey, "SCHOOL_ADMIN");
  assert.equal(saved.displayLabel, "Directeur");
  assert.equal(saved.effectiveLabel, "Directeur");
  assert.equal(saved.roleName, "Admin School");
  const reread = await store.getRoleById("role-school");
  assert.equal(reread.effectiveLabel, "Directeur");
  assert.equal(reread.roleCode, "SCHOOL_ADMIN");
});

test("DL-07 COUNTRY_ADMIN write → 403", async () => {
  const { repo } = rolesRepo();
  await assert.rejects(
    () => updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, COUNTRY_ADMIN, {}),
    (error) => error.statusCode === 403,
  );
});

test("DL-08 SCHOOL_ADMIN write → 403", async () => {
  const { repo } = rolesRepo();
  await assert.rejects(
    () => updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, SCHOOL_ADMIN, {}),
    (error) => error.statusCode === 403,
  );
});

test("DL-09 autres rôles write → 403", async () => {
  const { repo } = rolesRepo();
  await assert.rejects(
    () => updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, TEACHER, {}),
    (error) => error.statusCode === 403,
  );
  const rbac = new RbacService();
  assert.equal(rbac.canAccess({ role: "Enseignant", permissions: [] }, WRITE_PATCH), false);
  assert.equal(rbac.canAccess({ role: "Admin Pays", permissions: ["COUNTRY_PRIVILEGES"] }, WRITE_PATCH), false);
  assert.equal(rbac.canAccess({ role: "Admin School", permissions: ["Rôles Établissement:UPDATE"] }, WRITE_RESET), false);
});

test("DL-10 display_label ne passe pas par assertNotProtectedMutation", async () => {
  const service = readUtf8("./establishmentRolesService.js");
  const displayFn = service.slice(service.indexOf("async function updateRoleDisplayLabel"), service.indexOf("async function resetRoleDisplayLabel"));
  assert.doesNotMatch(displayFn, /assertNotProtectedMutation/);
  const { repo } = rolesRepo();
  const saved = await updateRoleDisplayLabel(repo, "role-super", { displayLabel: "Superadmin" }, SUPER_ADMIN, {});
  assert.equal(saved.displayLabel, "Superadmin");
  await assert.rejects(
    () => updateRole(repo, "role-school", { roleName: "Directeur" }, SUPER_ADMIN, {}),
    (error) => error.statusCode === 403 && error.code === FUNCTIONAL_RBAC_ERROR.ROLE_PROTECTED,
  );
  assert.throws(
    () => assertNotProtectedMutation("SCHOOL_ADMIN", "renommés ou modifiés"),
    (error) => error.statusCode === 403,
  );
});

test("DL-11 role_code / role_name inchangés après écriture display", async () => {
  const { repo, store } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, SUPER_ADMIN, {});
  const row = await store.getRoleById("role-school");
  assert.equal(row.roleCode, "SCHOOL_ADMIN");
  assert.equal(row.roleName, "Admin School");
  assert.equal(row.defaultLabel, "Admin School");
});

test("DL-12 API dédiée, pas le PATCH rename ADMIN-02", () => {
  const server = readUtf8("../server.js");
  assert.match(server, /\/api\/backoffice\/rbac\/roles\/:roleId\/display-label/);
  assert.match(server, /\/api\/backoffice\/rbac\/roles\/:roleId\/display-label\/reset/);
  assert.deepEqual(routePermissions[WRITE_PATCH], ["ALL_PRIVILEGES"]);
  assert.deepEqual(routePermissions[WRITE_RESET], ["ALL_PRIVILEGES"]);
  assert.equal(PLATFORM_ADMIN_ALLOWED.includes(WRITE_PATCH), true);
  const updateRoleFn = readUtf8("./establishmentRolesService.js");
  const renameFn = updateRoleFn.slice(updateRoleFn.indexOf("async function updateRole("), updateRoleFn.indexOf("async function updateRoleDisplayLabel"));
  assert.doesNotMatch(renameFn, /displayLabel/);
});

test("DL-13 audit ROLE_DISPLAY_LABEL_UPDATE", async () => {
  const { repo, audits } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, SUPER_ADMIN, {});
  const entry = audits.find((row) => row.action === RBAC_AUDIT_ACTIONS.ROLE_DISPLAY_LABEL_UPDATE);
  assert.ok(entry);
  assert.equal(entry.newValue.roleKey, "SCHOOL_ADMIN");
  assert.equal(entry.newValue.oldDisplayLabel, null);
  assert.equal(entry.newValue.newDisplayLabel, "Directeur");
  assert.equal(entry.newValue.actor, "superadmin");
  assert.equal(entry.newValue.jwt, undefined);
  assert.equal(entry.newValue.token, undefined);
});

test("DL-14 audit ROLE_DISPLAY_LABEL_RESET", async () => {
  const { repo, audits } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, SUPER_ADMIN, {});
  await resetRoleDisplayLabel(repo, "role-school", SUPER_ADMIN, {});
  const entry = audits.find((row) => row.action === RBAC_AUDIT_ACTIONS.ROLE_DISPLAY_LABEL_RESET);
  assert.ok(entry);
  assert.equal(entry.newValue.roleKey, "SCHOOL_ADMIN");
  assert.equal(entry.newValue.oldDisplayLabel, "Directeur");
  assert.equal(entry.newValue.newDisplayLabel, null);
});

test("DL-15 contrat API roleKey/defaultLabel/displayLabel/effectiveLabel", async () => {
  const { repo } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, SUPER_ADMIN, {});
  const items = await listRoleDisplayLabels(repo, SUPER_ADMIN);
  const school = items.find((row) => row.roleKey === "SCHOOL_ADMIN");
  assert.deepEqual(school, {
    roleKey: "SCHOOL_ADMIN",
    defaultLabel: "Admin School",
    displayLabel: "Directeur",
    effectiveLabel: "Directeur",
  });
});

test("DL-16 surfaces Web visuelles consomment effectiveLabel, pas le RBAC", () => {
  const page = readUtf8("../../web/src/pages/PermissionsPage.tsx");
  assert.match(page, /Libellé par défaut/);
  assert.match(page, /Libellé affiché/);
  assert.match(page, /Libellé effectif/);
  assert.match(page, /Restaurer le défaut/);
  assert.match(page, /updateRoleDisplayLabel/);
  assert.match(page, /resetRoleDisplayLabel/);
  const topbar = readUtf8("../../web/src/components/layout/Topbar.tsx");
  assert.match(topbar, /visibleRoleLabel/);
  const users = readUtf8("../../web/src/lib/userAccounts.ts");
  assert.match(users, /effectiveRoleLabel/);
});

test("DL-17 surfaces Mobile visuelles consomment effectiveLabel", () => {
  const drawer = readUtf8("../../Mobile/src/components/RoleNavigationDrawer.tsx");
  assert.match(drawer, /visibleRoleLabel/);
  const profile = readUtf8("../../Mobile/src/lib/businessProfile.ts");
  assert.match(profile, /effectiveRoleLabel/);
  const identity = readUtf8("../../Mobile/src/lib/canonicalRoleIdentity.ts");
  assert.doesNotMatch(identity, /effectiveRoleLabel/);
  assert.doesNotMatch(identity, /displayLabel/);
});

test("DL-18 collision SCHOOL_ADMIN/PRINCIPAL acceptée ; toRoleKey n'ingère pas display_label", async () => {
  const { repo, store } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, SUPER_ADMIN, {});
  const school = await store.getRoleById("role-school");
  const principal = await store.getRoleById("role-principal");
  const byName = await store.getRoleByNameOrCode("Directeur");
  assert.equal(school.effectiveLabel, "Directeur");
  assert.equal(principal.effectiveLabel, "Directeur");
  assert.equal(school.roleKey, "SCHOOL_ADMIN");
  assert.equal(principal.roleKey, "PRINCIPAL");
  assert.equal(byName.roleKey, "PRINCIPAL");
  assert.equal(ROLE_TO_DB.Directeur, "PRINCIPAL");
  assert.equal(toRoleKey("Directeur"), "PRINCIPAL");
  assert.equal(toRoleKey("Admin School"), "SCHOOL_ADMIN");
  assert.equal(toRoleLabel("SCHOOL_ADMIN"), "Admin School");
  assert.notEqual(toRoleKey("Directeur"), "SCHOOL_ADMIN");
  const lifecycle = readUtf8("./userRoleLifecycle.js");
  const resolution = readUtf8("./functionalRbacResolution.js");
  assert.doesNotMatch(lifecycle, /displayLabel|effectiveLabel|display_label/);
  assert.doesNotMatch(resolution, /displayLabel|effectiveLabel|display_label/);
});
