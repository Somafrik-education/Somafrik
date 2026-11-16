"use strict";

/**
 * AUDIT-ROLE-LABELS-01 — RL-01 → RL-16 + catalogue + JWT + bootstrap + scan.
 * AUDIT ONLY. Stores mémoire. Aucune mutation prod.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const {
  updateRoleDisplayLabel,
  resetRoleDisplayLabel,
  listRoleDisplayLabels,
} = require("./establishmentRolesService");
const {
  resolveEffectiveRoleLabel,
  applyRoleDisplayContract,
  normalizeDisplayLabel,
  decorateUserWithRoleDisplay,
  indexRoleDisplayContracts,
} = require("./roleDisplayLabels");
const { toRoleKey, toRoleLabel } = require("./userRoleLifecycle");
const { RBAC_AUDIT_ACTIONS } = require("./functionalRbacManagement");
const { createEstablishmentRolesMemoryStore } = require("../db/establishmentRolesMemoryStore");
const { listRequiredSystemRoles } = require("./canonicalSystemRoles");
const { RbacService, routePermissions } = require("../services/rbacService");

const SUPER_ADMIN = {
  role: "Super Administrateur Somafrik",
  identifier: "superadmin",
  roleKeys: ["SUPER_ADMIN"],
};
const COUNTRY_ADMIN = { role: "Admin Pays", identifier: "country-admin", roleKeys: ["COUNTRY_ADMIN"] };
const SCHOOL_ADMIN = { role: "Admin School", identifier: "school-admin", roleKeys: ["SCHOOL_ADMIN"] };
const TEACHER = { role: "Enseignant", identifier: "teacher", roleKeys: ["TEACHER"] };
const PARENT = { role: "Parent", identifier: "parent", roleKeys: ["PARENT"] };
const STUDENT = { role: "Élève / Étudiant", identifier: "student", roleKeys: ["STUDENT"] };
const SECRETARY = { role: "Secrétaire", identifier: "secretary", roleKeys: ["SECRETARY"] };

const WRITE_PATCH = "PATCH /api/backoffice/rbac/roles/:roleId/display-label";

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

function rolesRepo() {
  const catalog = listRequiredSystemRoles({ includePlatform: true }).map((role) => ({
    id: `role-${role.roleKey.toLowerCase()}`,
    roleCode: role.roleCode,
    roleName: role.roleName,
    scope: role.scope,
    schoolAssignable: role.schoolAssignable,
  }));
  const store = createEstablishmentRolesMemoryStore({ roles: catalog });
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

test("RL-01 NULL → défaut actuel", () => {
  assert.equal(normalizeDisplayLabel(null), null);
  assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: null }), "Admin School");
  assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Élève / Étudiant", displayLabel: null }), "Élève / Étudiant");
  assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Enseignant", displayLabel: null }), "Enseignant");
});

test("RL-02 displayLabel → effectiveLabel personnalisé", () => {
  assert.equal(
    resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: "Directeur" }),
    "Directeur",
  );
  assert.equal(
    resolveEffectiveRoleLabel({ defaultLabel: "Élève / Étudiant", displayLabel: "Étudiant" }),
    "Étudiant",
  );
  assert.equal(
    resolveEffectiveRoleLabel({ defaultLabel: "Enseignant", displayLabel: "Professeur" }),
    "Professeur",
  );
});

test("RL-03 reset → défaut", async () => {
  const { repo, store } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "Directeur" }, SUPER_ADMIN, {});
  const reset = await resetRoleDisplayLabel(repo, "role-school_admin", SUPER_ADMIN, {});
  assert.equal(reset.displayLabel, null);
  assert.equal(reset.effectiveLabel, "Admin School");
  const row = await store.getRoleById("role-school_admin");
  assert.equal(row.displayLabel, null);
});

test("RL-04 SCHOOL_ADMIN → Directeur sans changer roleKey", async () => {
  const { repo, store } = rolesRepo();
  const saved = await updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "Directeur" }, SUPER_ADMIN, {});
  assert.equal(saved.roleKey, "SCHOOL_ADMIN");
  assert.equal(saved.defaultLabel, "Admin School");
  assert.equal(saved.displayLabel, "Directeur");
  assert.equal(saved.effectiveLabel, "Directeur");
  const row = await store.getRoleById("role-school_admin");
  assert.equal(row.roleCode, "SCHOOL_ADMIN");
  assert.equal(row.roleName, "Admin School");
  assert.equal(toRoleKey("Admin School"), "SCHOOL_ADMIN");
  assert.equal(toRoleKey("Directeur"), "PRINCIPAL");
});

test("RL-05 STUDENT → Étudiant sans changer roleKey", async () => {
  const { repo, store } = rolesRepo();
  const saved = await updateRoleDisplayLabel(repo, "role-student", { displayLabel: "Étudiant" }, SUPER_ADMIN, {});
  assert.equal(saved.roleKey, "STUDENT");
  assert.equal(saved.effectiveLabel, "Étudiant");
  const row = await store.getRoleById("role-student");
  assert.equal(row.roleCode, "STUDENT");
  assert.equal(row.roleName, "Élève / Étudiant");
  assert.equal(toRoleKey("Élève / Étudiant"), "STUDENT");
});

test("RL-06 TEACHER → Professeur sans changer roleKey", async () => {
  const { repo, store } = rolesRepo();
  const saved = await updateRoleDisplayLabel(repo, "role-teacher", { displayLabel: "Professeur" }, SUPER_ADMIN, {});
  assert.equal(saved.roleKey, "TEACHER");
  assert.equal(saved.effectiveLabel, "Professeur");
  const row = await store.getRoleById("role-teacher");
  assert.equal(row.roleCode, "TEACHER");
  assert.equal(row.roleName, "Enseignant");
  assert.equal(toRoleKey("Enseignant"), "TEACHER");
});

test("RL-07 Country Admin PATCH → 403", async () => {
  const { repo } = rolesRepo();
  await assert.rejects(
    () => updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "Directeur" }, COUNTRY_ADMIN, {}),
    (error) => error.statusCode === 403,
  );
});

test("RL-08 School Admin PATCH → 403", async () => {
  const { repo } = rolesRepo();
  await assert.rejects(
    () => updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "Directeur" }, SCHOOL_ADMIN, {}),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    () => updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "X" }, TEACHER, {}),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    () => updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "X" }, PARENT, {}),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    () => updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "X" }, STUDENT, {}),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    () => updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "X" }, SECRETARY, {}),
    (error) => error.statusCode === 403,
  );
});

test("RL-09 Superadmin PATCH → autorisé", async () => {
  const { repo } = rolesRepo();
  const saved = await updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "Directeur" }, SUPER_ADMIN, {});
  assert.equal(saved.effectiveLabel, "Directeur");
  const rbac = new RbacService();
  assert.equal(rbac.canAccess({ role: "Super Administrateur Somafrik", permissions: ["ALL_PRIVILEGES"] }, WRITE_PATCH), true);
  assert.deepEqual(routePermissions[WRITE_PATCH], ["ALL_PRIVILEGES"]);
});

test("RL-10 displayLabel jamais envoyé à toRoleKey", () => {
  const lifecycle = readUtf8("./userRoleLifecycle.js");
  const resolution = readUtf8("./functionalRbacResolution.js");
  const token = readUtf8("../services/tokenService.js");
  assert.doesNotMatch(lifecycle, /displayLabel|effectiveLabel|display_label/);
  assert.doesNotMatch(resolution, /displayLabel|effectiveLabel|display_label/);
  assert.doesNotMatch(token, /displayLabel|effectiveRoleLabel|display_label/);
  assert.equal(toRoleKey("Directeur"), "PRINCIPAL");
  assert.notEqual(toRoleKey("Directeur"), "SCHOOL_ADMIN");
});

test("RL-11 JWT canonique inchangé", () => {
  const principal = readUtf8("../server.js");
  const build = principal.slice(principal.indexOf("function buildPrincipal"), principal.indexOf("function buildPrincipal") + 2500);
  assert.match(build, /toRoleKey/);
  assert.doesNotMatch(build, /effectiveRoleLabel|displayLabel|display_label/);
  const refresh = readUtf8("../services/tokenService.js");
  assert.match(refresh, /role: subject\.role/);
  assert.doesNotMatch(refresh, /effectiveRoleLabel/);
});

test("RL-12 permissions inchangées", async () => {
  const { repo, store } = rolesRepo();
  const before = await store.getRoleById("role-teacher");
  await updateRoleDisplayLabel(repo, "role-teacher", { displayLabel: "Professeur" }, SUPER_ADMIN, {});
  const after = await store.getRoleById("role-teacher");
  assert.deepEqual(after.permissions ?? before.permissions, before.permissions);
  assert.equal(after.roleCode, "TEACHER");
  assert.equal(toRoleLabel("TEACHER"), "Enseignant");
});

test("RL-13 multi-rôle labels distincts (contrat primaire only aujourd'hui)", () => {
  const index = indexRoleDisplayContracts([
    { role_code: "TEACHER", role_name: "Enseignant", display_label: "Professeur" },
    { role_code: "SCHOOL_ADMIN", role_name: "Admin School", display_label: "Directeur" },
  ]);
  const teacher = decorateUserWithRoleDisplay({ role: "Enseignant", roleKey: "TEACHER", roleKeys: ["TEACHER", "SCHOOL_ADMIN"] }, index);
  const school = decorateUserWithRoleDisplay({ role: "Admin School", roleKey: "SCHOOL_ADMIN", roleKeys: ["TEACHER", "SCHOOL_ADMIN"] }, index);
  assert.equal(teacher.effectiveRoleLabel, "Professeur");
  assert.equal(school.effectiveRoleLabel, "Directeur");
  assert.equal(teacher.roleKey, "TEACHER");
  assert.equal(school.roleKey, "SCHOOL_ADMIN");
  assert.ok(!Object.prototype.hasOwnProperty.call(teacher, "effectiveLabels"));
});

test("RL-14 bootstrap ne supprime pas display_label", () => {
  const recon = readUtf8("./systemRolesReconciliation.js");
  assert.doesNotMatch(recon, /display_label|displayLabel/);
  const insert = recon.slice(recon.indexOf("const created = await store.insertRole"), recon.indexOf("result.createdRoles.push"));
  assert.doesNotMatch(insert, /display_label|displayLabel/);
});

test("RL-15 audit UPDATE écrit", async () => {
  const { repo, audits } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "Directeur" }, SUPER_ADMIN, {});
  const entry = audits.find((row) => row.action === RBAC_AUDIT_ACTIONS.ROLE_DISPLAY_LABEL_UPDATE);
  assert.ok(entry);
  assert.equal(entry.newValue.roleKey, "SCHOOL_ADMIN");
  assert.equal(entry.newValue.oldDisplayLabel, null);
  assert.equal(entry.newValue.newDisplayLabel, "Directeur");
  assert.equal(entry.newValue.actor, "superadmin");
});

test("RL-16 audit RESET écrit", async () => {
  const { repo, audits } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "Directeur" }, SUPER_ADMIN, {});
  await resetRoleDisplayLabel(repo, "role-school_admin", SUPER_ADMIN, {});
  const entry = audits.find((row) => row.action === RBAC_AUDIT_ACTIONS.ROLE_DISPLAY_LABEL_RESET);
  assert.ok(entry);
  assert.equal(entry.newValue.roleKey, "SCHOOL_ADMIN");
  assert.equal(entry.newValue.oldDisplayLabel, "Directeur");
  assert.equal(entry.newValue.newDisplayLabel, null);
});

test("RL-catalogue 12 rôles seed, pas d'invention", () => {
  const roles = listRequiredSystemRoles({ includePlatform: true });
  const keys = roles.map((role) => role.roleKey).sort();
  assert.deepEqual(keys, [
    "ACCOUNTANT",
    "COUNTRY_ADMIN",
    "PARENT",
    "PREFET_ETUDES",
    "PRINCIPAL",
    "PROVISEUR",
    "SCHOOL_ADMIN",
    "SECRETARY",
    "STUDENT",
    "SUPERVISOR",
    "SUPER_ADMIN",
    "TEACHER",
  ]);
  const school = roles.find((role) => role.roleKey === "SCHOOL_ADMIN");
  const student = roles.find((role) => role.roleKey === "STUDENT");
  assert.equal(school.roleName, "Admin School");
  assert.equal(student.roleName, "Élève / Étudiant");
  assert.ok(!roles.some((role) => role.roleKey === "ADJOINT"));
});

test("RL-identify hard-code ignore display_label (écart documenté)", () => {
  const auth = readUtf8("../services/authService.js");
  const map = auth.slice(auth.indexOf("const managedMobileRoles"), auth.indexOf("function normalizeText"));
  assert.match(map, /Admin Établissement/);
  assert.match(map, /roleLabel: "Élève"/);
  assert.doesNotMatch(map, /display_label|effectiveRoleLabel/);
});

test("RL-25 scan hard-coded documenté (classe A)", () => {
  const webFormat = readUtf8("../../web/src/lib/format.ts");
  const mobileDrawer = readUtf8("../../Mobile/src/components/RoleNavigationDrawer.tsx");
  const mobileIdentity = readUtf8("../../Mobile/src/lib/canonicalRoleIdentity.ts");
  assert.match(webFormat, /"admin school": "Administrateur d’établissement"/);
  assert.match(mobileDrawer, /visibleRoleLabel/);
  assert.doesNotMatch(mobileDrawer, /school_admin: "Admin établissement"/);
  assert.match(mobileIdentity, /SCHOOL_ADMIN: "Admin School"/);
  assert.match(mobileIdentity, /TEACHER: "Enseignant"/);
  const evidence = JSON.parse(readUtf8("../../docs/audits/evidence/role-label-surfaces.json"));
  assert.equal(evidence.verdict, "OPTION_B");
  assert.equal(evidence.roles.length, 12);
});

test("RL-chaîne vide → NULL pas de libellé vide", () => {
  assert.equal(normalizeDisplayLabel(""), null);
  assert.equal(normalizeDisplayLabel("   "), null);
  const contract = applyRoleDisplayContract({
    role_code: "TEACHER",
    role_name: "Enseignant",
    display_label: "   ",
  });
  assert.equal(contract.displayLabel, null);
  assert.equal(contract.effectiveLabel, "Enseignant");
});
