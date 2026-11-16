"use strict";

/**
 * ROLE-LABELS — replay final RLF-01 → RLF-16.
 * AUDIT-ONLY. Réutilise les services déjà mergés (#872/#873/#874).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { updateRoleDisplayLabel } = require("./establishmentRolesService");
const { resolveEffectiveRoleLabel } = require("./roleDisplayLabels");
const { toRoleKey } = require("./userRoleLifecycle");
const { listRequiredSystemRoles } = require("./canonicalSystemRoles");
const { createEstablishmentRolesMemoryStore } = require("../db/establishmentRolesMemoryStore");

const SUPER = { role: "Super Administrateur Somafrik", identifier: "superadmin", roleKeys: ["SUPER_ADMIN"] };
const COUNTRY = { role: "Admin Pays", identifier: "country-admin", roleKeys: ["COUNTRY_ADMIN"] };
const SCHOOL = { role: "Admin School", identifier: "school-admin", roleKeys: ["SCHOOL_ADMIN"] };

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

function rolesRepo(extra = []) {
  const catalog = listRequiredSystemRoles({ includePlatform: true }).map((role) => ({
    id: `role-${role.roleKey.toLowerCase()}`,
    roleCode: role.roleCode,
    roleName: role.roleName,
    scope: role.scope,
    schoolAssignable: role.schoolAssignable,
  }));
  const store = createEstablishmentRolesMemoryStore({
    roles: [
      ...catalog,
      {
        id: "role-resp-ped",
        roleCode: "RESP_PED",
        roleName: "Coordinateur pédagogique",
        scope: "school",
        schoolAssignable: true,
      },
      ...extra,
    ],
  });
  const repo = {
    getEstablishmentRolesStore: () => store,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async () => true,
  };
  return { repo, store };
}

test("RLF-01 evidence pointe develop@f95c3f38 et verdict CLOSED", () => {
  const evidence = JSON.parse(readUtf8("../../docs/audits/evidence/role-labels-final-closure.json"));
  assert.equal(evidence.verdict, "ROLE_LABELS_CLOSED");
  assert.equal(evidence.base, "f95c3f3864d7841fd0ee9a6ec2ea30a251528dbf");
  assert.equal(evidence.doNotOpenProductPr, true);
  assert.deepEqual(
    evidence.chain.map((row) => row.pr),
    ["#871", "#872", "#873", "#874"],
  );
  assert.equal(evidence.leftoverAdministrative[0].pr, "#856");
  assert.equal(evidence.leftoverAdministrative[0].recommendation, "CLOSE_WITHOUT_MERGE");
});

test("RLF-02 defaults figés SCHOOL_ADMIN / TEACHER / STUDENT", () => {
  assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: null }), "Admin School");
  assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Enseignant", displayLabel: "Professeur" }), "Professeur");
  assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Élève / Étudiant", displayLabel: "Étudiant" }), "Étudiant");
});

test("RLF-03 édition displayLabel Superadmin only", async () => {
  const { repo } = rolesRepo();
  const saved = await updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "Directeur" }, SUPER, {});
  assert.equal(saved.effectiveLabel, "Directeur");
  await assert.rejects(
    () => updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "X" }, COUNTRY, {}),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    () => updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "X" }, SCHOOL, {}),
    (error) => error.statusCode === 403,
  );
});

test("RLF-04 SCHOOL_ADMIN → Directeur conserve roleKey", async () => {
  const { repo, store } = rolesRepo();
  const saved = await updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "Directeur" }, SUPER, {});
  const row = await store.getRoleById("role-school_admin");
  assert.equal(saved.roleKey, "SCHOOL_ADMIN");
  assert.equal(row.roleCode, "SCHOOL_ADMIN");
  assert.equal(row.roleName, "Admin School");
  assert.equal(toRoleKey("Directeur"), "PRINCIPAL");
  assert.notEqual(toRoleKey("Directeur"), "SCHOOL_ADMIN");
});

test("RLF-05 collision Directeur SCHOOL_ADMIN / PRINCIPAL", async () => {
  const { repo, store } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school_admin", { displayLabel: "Directeur" }, SUPER, {});
  const school = await store.getRoleById("role-school_admin");
  const principal = await store.getRoleById("role-principal");
  assert.equal(school.effectiveLabel, "Directeur");
  assert.equal(principal.effectiveLabel, "Directeur");
  assert.equal(school.roleKey, "SCHOOL_ADMIN");
  assert.equal(principal.roleKey, "PRINCIPAL");
});

test("RLF-06 custom RESP_PED conserve roleKey", async () => {
  const { repo, store } = rolesRepo();
  const saved = await updateRoleDisplayLabel(repo, "role-resp-ped", { displayLabel: "Responsable académique" }, SUPER, {});
  const row = await store.getRoleById("role-resp-ped");
  assert.equal(saved.roleKey, "RESP_PED");
  assert.equal(row.roleCode, "RESP_PED");
  assert.equal(row.roleName, "Coordinateur pédagogique");
  assert.equal(saved.effectiveLabel, "Responsable académique");
});

test("RLF-07 Web/Mobile attribution fail-closed", () => {
  const webHelper = readUtf8("../../web/src/lib/roleDisplayLabels.ts");
  assert.match(webHelper, /if \(input\.apiAvailable\)/);
  assert.match(webHelper, /return fromApi;/);
  const mobileLoad = readUtf8("../../Mobile/src/lib/userRoleAssignment.ts");
  assert.match(mobileLoad, /failClosedAssignableRolesLoad/);
  assert.match(mobileLoad, /catalogReady: false/);
  const mobileUi = readUtf8("../../Mobile/src/components/UserMutationControls.tsx");
  assert.match(mobileUi, /canCommitAssignableRoles/);
  assert.doesNotMatch(mobileUi, /setCatalogReady\(true\)/);
});

test("RLF-08 Messages roleKey/kind, jamais le libellé", () => {
  const mobile = readUtf8("../../Mobile/src/lib/messagesRoleIdentity.ts");
  const web = readUtf8("../../web/src/lib/messagesRoleIdentity.ts");
  assert.match(mobile, /roleKey === "STUDENT"/);
  assert.match(web, /asRoleKey\(value\.roleKey\) === "STUDENT"/);
  assert.match(web, /asKind\(value\.kind\) === "student"/);
  assert.doesNotMatch(mobile, /roleLabel === /);
  assert.doesNotMatch(web, /roleLabel === /);
  assert.doesNotMatch(mobile, /canonicalizeRoleKey\([^)]*roleLabel/);
  assert.doesNotMatch(web, /toRoleKey\([^)]*roleLabel/);
});

test("RLF-09 JWT/RBAC n'ingèrent pas display_label", () => {
  const lifecycle = readUtf8("./userRoleLifecycle.js");
  const resolution = readUtf8("./functionalRbacResolution.js");
  assert.doesNotMatch(lifecycle, /displayLabel|effectiveLabel|display_label/);
  assert.doesNotMatch(resolution, /displayLabel|effectiveLabel|display_label/);
});

test("RLF-10 ADJOINT hors catalogue seed 12 rôles", () => {
  const keys = listRequiredSystemRoles({ includePlatform: true }).map((role) => role.roleKey).sort();
  assert.equal(keys.length, 12);
  assert.equal(keys.includes("ADJOINT"), false);
  assert.equal(keys.includes("SCHOOL_ADMIN"), true);
});

test("RLF-11 Web visibleRoleLabel + Users fail-closed", () => {
  const topbar = readUtf8("../../web/src/components/layout/Topbar.tsx");
  const users = readUtf8("../../web/src/pages/UsersPage.tsx");
  const accounts = readUtf8("../../web/src/lib/userAccounts.ts");
  assert.match(topbar, /visibleRoleLabel/);
  assert.match(users, /formatAccessRolesDisplay/);
  assert.match(accounts, /formatVisibleRoleLabels|effectiveRoleLabel/);
  assert.match(users, /apiAvailable: assignableApiAvailable !== false/);
});

test("RLF-12 Mobile Drawer/Users consomment le contrat", () => {
  const drawer = readUtf8("../../Mobile/src/components/RoleNavigationDrawer.tsx");
  const users = readUtf8("../../Mobile/src/screens/UsersScreen.tsx");
  assert.match(drawer, /visibleRoleLabel\(session\?\.user\)/);
  assert.doesNotMatch(drawer, /school_admin: "Admin établissement"/);
  assert.match(users, /formatVisibleRoleLabels\(user\)/);
  assert.doesNotMatch(users, /displayRoleName\(/);
});

test("RLF-13 identify / login n'utilisent pas un remap local", () => {
  const login = readUtf8("../../Mobile/src/screens/LoginScreen.tsx");
  assert.match(login, /identity\?\.roleLabel/);
  assert.doesNotMatch(login, /displayRoleName\(/);
});

test("RLF-14 PATCH display-label dédié, pas le rename ADMIN-02", () => {
  const service = readUtf8("./establishmentRolesService.js");
  assert.match(service, /async function updateRoleDisplayLabel/);
  assert.match(service, /assertSuperAdmin\(principal\)/);
  const routes = readUtf8("../server.js");
  assert.match(routes, /roles\/:roleId\/display-label/);
});

test("RLF-15 doc de clôture et preuve alignées", () => {
  const doc = readUtf8("../../docs/audits/ROLE-LABELS-final-closure.md");
  assert.match(doc, /ROLE_LABELS_CLOSED/);
  assert.match(doc, /f95c3f3864d7841fd0ee9a6ec2ea30a251528dbf/);
  assert.match(doc, /CLOSE WITHOUT MERGE/);
  assert.match(doc, /#857 AUDIT-CARTE-01/);
});

test("RLF-16 aucun produit ROLE-LABELS dans ce lot", () => {
  const evidence = JSON.parse(readUtf8("../../docs/audits/evidence/role-labels-final-closure.json"));
  assert.equal(evidence.doNotOpenProductPr, true);
  assert.equal(evidence.nextChantier.pr, "#857");
});
