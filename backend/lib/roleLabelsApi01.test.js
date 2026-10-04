"use strict";

/**
 * ROLE-LABELS-API-01 — API-RL-01 → API-RL-25.
 * DISPLAY ONLY. JWT / RBAC / roleKey inchangés.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const {
  resolveEffectiveRoleLabel,
  decorateUserWithRoleDisplay,
  decorateIdentifyRole,
  indexRoleDisplayContracts,
  loadRoleDisplayIndexFromRepo,
  resolveVisibleRoleLabel,
} = require("./roleDisplayLabels");
const { toRoleKey, toRoleLabel } = require("./userRoleLifecycle");
const { AuthService } = require("../services/authService");
const { TokenService } = require("../services/tokenService");
const { sanitizePrivacyRequest } = require("./privacyErasure");
const { resolveSchoolComplianceScope } = require("./schoolCompliance");
const { updateRoleDisplayLabel, resetRoleDisplayLabel } = require("./establishmentRolesService");
const { createEstablishmentRolesMemoryStore } = require("../db/establishmentRolesMemoryStore");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

function catalogIndex(overrides = []) {
  const seed = [
    { role_code: "SUPER_ADMIN", role_name: "Super Administrateur Somafrik", display_label: null },
    { role_code: "COUNTRY_ADMIN", role_name: "Admin Pays", display_label: null },
    { role_code: "SCHOOL_ADMIN", role_name: "Admin School", display_label: null },
    { role_code: "TEACHER", role_name: "Enseignant", display_label: null },
    { role_code: "STUDENT", role_name: "Élève / Étudiant", display_label: null },
    { role_code: "PRINCIPAL", role_name: "Directeur", display_label: null },
    { role_code: "SECRETARY", role_name: "Secrétaire", display_label: null },
    { role_code: "PARENT", role_name: "Parent", display_label: null },
    { role_code: "RESPONSABLE_PEDAGOGIQUE", role_name: "Responsable pédagogique", display_label: null },
  ];
  const byKey = new Map(seed.map((row) => [row.role_code, { ...row }]));
  for (const row of overrides) {
    byKey.set(row.role_code, { ...byKey.get(row.role_code), ...row });
  }
  return indexRoleDisplayContracts([...byKey.values()]);
}

function rolesRepo() {
  const store = createEstablishmentRolesMemoryStore({
    roles: [
      {
        id: "role-school",
        roleCode: "SCHOOL_ADMIN",
        roleName: "Admin School",
        scope: "school",
        schoolAssignable: false,
      },
      {
        id: "role-teacher",
        roleCode: "TEACHER",
        roleName: "Enseignant",
        scope: "school",
        schoolAssignable: true,
      },
      {
        id: "role-student",
        roleCode: "STUDENT",
        roleName: "Élève / Étudiant",
        scope: "school",
        schoolAssignable: false,
      },
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

const SUPER = { role: "Super Administrateur Somafrik", identifier: "superadmin", roleKeys: ["SUPER_ADMIN"] };

function schoolAdminUser(extra = {}) {
  return {
    id: "u-sa",
    identifier: "school-admin",
    publicId: "SA-1",
    schoolCode: "CD-2026-0001",
    role: "Admin School",
    roleKey: "SCHOOL_ADMIN",
    roleKeys: ["SCHOOL_ADMIN"],
    accessChannel: "Application",
    status: "Actif",
    password: "Somafrik26!",
    mustChangePassword: false,
    permissions: ["Utilisateurs:READ"],
    ...extra,
  };
}

test("API-RL-01 SCHOOL_ADMIN sans display → Admin School", () => {
  const user = decorateUserWithRoleDisplay(schoolAdminUser(), catalogIndex());
  assert.equal(user.effectiveRoleLabel, "Admin School");
  assert.equal(user.effectiveRoleLabels[0].defaultLabel, "Admin School");
  assert.equal(user.effectiveRoleLabels[0].displayLabel, null);
});

test("API-RL-02 SCHOOL_ADMIN display Directeur → effectiveRoleLabel Directeur", () => {
  const index = catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]);
  const user = decorateUserWithRoleDisplay(schoolAdminUser(), index);
  assert.equal(user.effectiveRoleLabel, "Directeur");
});

test("API-RL-03 roleKey reste SCHOOL_ADMIN", () => {
  const user = decorateUserWithRoleDisplay(
    schoolAdminUser(),
    catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]),
  );
  assert.equal(user.roleKey, "SCHOOL_ADMIN");
  assert.equal(user.role, "Admin School");
});

test("API-RL-04 JWT reste SCHOOL_ADMIN", () => {
  const tokens = new TokenService();
  const user = decorateUserWithRoleDisplay(
    schoolAdminUser(),
    catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]),
  );
  const token = tokens.createAccessToken({
    sub: user.id,
    role: user.role,
    roleKeys: user.roleKeys,
    schoolCode: user.schoolCode,
  });
  const payload = tokens.verify(token, "access");
  assert.equal(payload.role, "Admin School");
  assert.deepEqual(payload.roleKeys, ["SCHOOL_ADMIN"]);
  assert.equal(payload.effectiveRoleLabel, undefined);
  assert.equal(payload.displayLabel, undefined);
  const server = readUtf8("../server.js");
  const send = server.slice(server.indexOf("async function sendAuthenticatedResponse"), server.indexOf("function buildPrincipal"));
  assert.match(send, /createAccessToken\(\{\s*\n\s*\.\.\.principal/);
  assert.ok(send.indexOf("createAccessToken") < send.indexOf("decorateUserWithRoleDisplay"));
});

test("API-RL-05 TEACHER display Professeur", () => {
  const user = decorateUserWithRoleDisplay(
    { role: "Enseignant", roleKey: "TEACHER", roleKeys: ["TEACHER"] },
    catalogIndex([{ role_code: "TEACHER", display_label: "Professeur" }]),
  );
  assert.equal(user.effectiveRoleLabel, "Professeur");
  assert.equal(user.roleKey, "TEACHER");
});

test("API-RL-06 STUDENT display Étudiant", () => {
  const user = decorateUserWithRoleDisplay(
    { role: "Élève / Étudiant", roleKey: "STUDENT", roleKeys: ["STUDENT"] },
    catalogIndex([{ role_code: "STUDENT", display_label: "Étudiant" }]),
  );
  assert.equal(user.effectiveRoleLabel, "Étudiant");
  assert.equal(user.roleKey, "STUDENT");
});

test("API-RL-07 reset display → retour défaut", async () => {
  const { repo } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, SUPER, {});
  const reset = await resetRoleDisplayLabel(repo, "role-school", SUPER, {});
  assert.equal(reset.displayLabel, null);
  assert.equal(reset.effectiveLabel, "Admin School");
});

function identifySchool() {
  return {
    id: "school-1",
    code: "SCH-TEST",
    loginCode: "CD-IN-26-001",
    publicId: "CD-IN-26-001",
    name: "Institut Nuru",
    country: "RDC",
    countryCode: "CD",
    status: "Actif",
    validationStatus: "Validé",
  };
}

function identifyService(userAccounts) {
  attachMemoryLoginLockoutStore();
  const school = identifySchool();
  return new AuthService({
    school,
    schools: [school],
    teachers: [],
    students: [],
    userAccounts,
    countries: [{ name: "RDC", code: "CD", status: "Actif" }],
    subscriptions: [],
  });
}

test("API-RL-08 /identify utilise effective label", () => {
  const service = identifyService([schoolAdminUser({ identifier: "school-admin", schoolCode: "SCH-TEST" })]);
  const identified = service.identify(
    { schoolCode: "CD-IN-26-001", identifier: "school-admin" },
    catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]),
  );
  assert.equal(identified.role, "school_admin");
  assert.equal(identified.roleKey, "SCHOOL_ADMIN");
  assert.equal(identified.roleLabel, "Directeur");
  assert.equal(identified.effectiveRoleLabel, "Directeur");
});

test("API-RL-09 /identify fallback utilise defaultLabel canonique", () => {
  const service = identifyService([schoolAdminUser({ identifier: "school-admin", schoolCode: "SCH-TEST" })]);
  const identified = service.identify({ schoolCode: "CD-IN-26-001", identifier: "school-admin" });
  assert.equal(identified.roleLabel, "Admin School");
  assert.notEqual(identified.roleLabel, "Admin Établissement");
  const studentService = identifyService([
    {
      id: "u-st",
      identifier: "eleve",
      schoolCode: "SCH-TEST",
      role: "Élève / Étudiant",
      roleKeys: ["STUDENT"],
      accessChannel: "Application",
      status: "Actif",
      password: "x",
    },
  ]);
  const student = studentService.identify({ schoolCode: "CD-IN-26-001", identifier: "eleve" });
  assert.equal(student.roleLabel, "Élève / Étudiant");
  assert.notEqual(student.roleLabel, "Élève");
});

test("API-RL-10 login user reçoit effectiveRoleLabel", () => {
  const user = decorateUserWithRoleDisplay(
    schoolAdminUser({ permissions: ["ALL_PRIVILEGES"] }),
    catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]),
  );
  assert.equal(user.effectiveRoleLabel, "Directeur");
  assert.equal(user.role, "Admin School");
});

test("API-RL-11 / API-RL-12 multi-rôle effectiveRoleLabels", () => {
  const index = catalogIndex([
    { role_code: "TEACHER", display_label: "Professeur" },
    { role_code: "SCHOOL_ADMIN", display_label: "Directeur" },
  ]);
  const user = decorateUserWithRoleDisplay(
    { role: "Enseignant", roleKey: "TEACHER", roleKeys: ["TEACHER", "SCHOOL_ADMIN"] },
    index,
  );
  assert.equal(user.effectiveRoleLabel, "Professeur");
  assert.deepEqual(
    user.effectiveRoleLabels.map((row) => `${row.roleKey}:${row.effectiveLabel}`),
    ["TEACHER:Professeur", "SCHOOL_ADMIN:Directeur"],
  );
});

test("API-RL-13 aucun toRoleKey(displayLabel)", () => {
  const lifecycle = readUtf8("./userRoleLifecycle.js");
  const resolution = readUtf8("./functionalRbacResolution.js");
  assert.doesNotMatch(lifecycle, /toRoleKey\(.*displayLabel|toRoleKey\(.*effectiveLabel/);
  assert.doesNotMatch(resolution, /displayLabel|effectiveLabel|display_label/);
  assert.equal(toRoleKey("Directeur"), "PRINCIPAL");
});

test("API-RL-14 collision Directeur / PRINCIPAL ne change pas SCHOOL_ADMIN", () => {
  const index = catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]);
  const user = decorateUserWithRoleDisplay(schoolAdminUser(), index);
  assert.equal(user.effectiveRoleLabel, "Directeur");
  assert.equal(user.roleKey, "SCHOOL_ADMIN");
  assert.equal(toRoleKey(user.effectiveRoleLabel), "PRINCIPAL");
  assert.notEqual(toRoleKey(user.effectiveRoleLabel), user.roleKey);
});

test("API-RL-15 / API-RL-16 messages roleLabel décoré, roleKey inchangé", () => {
  const messages = readUtf8("./communicationsMessagesService.js");
  assert.match(messages, /decorateMessageRole/);
  assert.match(messages, /roleKey/);
  const index = catalogIndex([{ role_code: "TEACHER", display_label: "Professeur" }]);
  assert.equal(resolveVisibleRoleLabel("TEACHER", index, "Enseignant"), "Professeur");
  assert.equal(toRoleKey("Enseignant"), "TEACHER");
});

test("API-RL-17 / API-RL-18 compliance roleLabel décoré, guards inchangés", () => {
  const index = catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]);
  const row = sanitizePrivacyRequest({ role_label: "Admin School", school_code: "CD-1", identifier: "x" }, index);
  assert.equal(row.roleLabel, "Directeur");
  assert.equal(row.roleKey, "SCHOOL_ADMIN");
  const school = { role: "Admin School", schoolCode: "CD-1", roleKeys: ["SCHOOL_ADMIN"] };
  assert.equal(resolveSchoolComplianceScope(school), "CD-1");
  assert.throws(() => resolveSchoolComplianceScope({ role: "Super Administrateur Somafrik", schoolCode: "*" }), (error) => error.statusCode === 403);
  const privacy = readUtf8("./privacyErasure.js");
  assert.match(privacy, /function assertCanExecuteSchoolErasure/);
  assert.match(privacy, /isPlatformAdminPrincipal/);
});

test("API-RL-19 fallback/memory user décoré", async () => {
  const { repo } = rolesRepo();
  await updateRoleDisplayLabel(repo, "role-school", { displayLabel: "Directeur" }, SUPER, {});
  const index = await loadRoleDisplayIndexFromRepo(repo);
  const user = decorateUserWithRoleDisplay(schoolAdminUser(), index);
  assert.equal(user.effectiveRoleLabel, "Directeur");
  const fallback = readUtf8("../db/fallbackRepository.js");
  assert.match(fallback, /listClientsUsers[\s\S]*decorateUserWithRoleDisplay/);
});

test("API-RL-20 PG user non-régression", () => {
  const pg = readUtf8("../db/clientsPgStore.js");
  assert.match(pg, /decorateUserWithRoleDisplay/);
  assert.match(pg, /loadRoleDisplayIndex/);
});

test("API-RL-21 rôle métier custom supporté", () => {
  const index = catalogIndex([
    { role_code: "RESPONSABLE_PEDAGOGIQUE", role_name: "Responsable pédagogique", display_label: "Coordinateur académique" },
  ]);
  const user = decorateUserWithRoleDisplay(
    { role: "Responsable pédagogique", roleKey: "RESPONSABLE_PEDAGOGIQUE", roleKeys: ["RESPONSABLE_PEDAGOGIQUE"] },
    index,
  );
  assert.equal(user.effectiveRoleLabel, "Coordinateur académique");
  assert.equal(user.roleKey, "RESPONSABLE_PEDAGOGIQUE");
});

test("API-RL-22 Country Admin identité inchangée", () => {
  const user = decorateUserWithRoleDisplay(
    { role: "Admin Pays", roleKey: "COUNTRY_ADMIN", roleKeys: ["COUNTRY_ADMIN"] },
    catalogIndex(),
  );
  assert.equal(user.roleKey, "COUNTRY_ADMIN");
  assert.equal(user.effectiveRoleLabel, "Admin Pays");
  assert.equal(toRoleLabel("COUNTRY_ADMIN"), "Admin Pays");
});

test("API-RL-23 Superadmin identité inchangée", () => {
  const user = decorateUserWithRoleDisplay(
    { role: "Super Administrateur Somafrik", roleKey: "SUPER_ADMIN", roleKeys: ["SUPER_ADMIN"] },
    catalogIndex(),
  );
  assert.equal(user.roleKey, "SUPER_ADMIN");
  assert.equal(user.effectiveRoleLabel, "Super Administrateur Somafrik");
});

test("API-RL-24 permissions identiques avant/après display change", () => {
  const before = schoolAdminUser({ permissions: ["Utilisateurs:READ", "Audit:READ"] });
  const after = decorateUserWithRoleDisplay(
    before,
    catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]),
  );
  assert.deepEqual(after.permissions, before.permissions);
});

test("API-RL-25 roleKeys multi-rôle identiques avant/après", () => {
  const before = { role: "Enseignant", roleKey: "TEACHER", roleKeys: ["TEACHER", "SCHOOL_ADMIN"] };
  const after = decorateUserWithRoleDisplay(
    before,
    catalogIndex([
      { role_code: "TEACHER", display_label: "Professeur" },
      { role_code: "SCHOOL_ADMIN", display_label: "Directeur" },
    ]),
  );
  assert.deepEqual(after.roleKeys, ["TEACHER", "SCHOOL_ADMIN"]);
});

test("API-RL fallback unique = defaultLabel pas Admin Établissement", () => {
  assert.equal(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: null }), "Admin School");
  assert.equal(toRoleLabel("SCHOOL_ADMIN"), "Admin School");
  assert.equal(toRoleLabel("STUDENT"), "Élève / Étudiant");
});

test("API-RL identify conserve le slug technique", () => {
  const payload = decorateIdentifyRole(
    { role: "school_admin", roleLabel: "Admin Établissement" },
    schoolAdminUser(),
    catalogIndex([{ role_code: "SCHOOL_ADMIN", display_label: "Directeur" }]),
  );
  assert.equal(payload.role, "school_admin");
  assert.equal(payload.roleLabel, "Directeur");
});
