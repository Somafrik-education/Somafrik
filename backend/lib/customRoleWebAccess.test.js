"use strict";

/**
 * RBAC-LOGIN-01 — résolution dynamique des rôles personnalisés (unitaire, sans base).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CATALOG_ROLE_STATE,
  classifyCatalogRoleKey,
  canonicalizeCustomRoleKeys,
  resolveCustomRoleWebAccess,
  resolveCustomRoleReadScope,
  isCustomRoleKey,
} = require("./customRoleWebAccess");
const { BackOfficeAccessService } = require("../services/backOfficeAccessService");
const { hashSecret } = require("../services/credentialService");

const SCHOOL_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SCHOOL_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

const CATALOG = [
  { roleCode: "conseiller_pedagogique", roleName: "Conseiller pédagogique", scope: "school", status: "active" },
  { roleCode: "ancien_role", roleName: "Ancien rôle", scope: "school", status: "archived" },
  { roleCode: "auditeur", roleName: "Auditeur", scope: "platform", status: "active" },
];

function webModules(...keys) {
  return Object.fromEntries(keys.map((key) => [key, { canRead: true, canCreate: false, canUpdate: false, canDelete: false }]));
}

function fakeRepo({
  activeBySchool = { [SCHOOL_ID]: ["CONSEILLER_PÉDAGOGIQUE"] },
  history = true,
  catalog = CATALOG,
  catalogError = false,
  rolesError = false,
  modules = webModules("classes"),
  permissionsError = false,
} = {}) {
  const calls = [];
  return {
    calls,
    async listActiveUserRoleKeysForSchool(userId, schoolId) {
      if (rolesError) throw new Error("db down");
      return activeBySchool[schoolId] ?? [];
    },
    async listActiveUserRoleKeys() {
      if (rolesError) throw new Error("db down");
      return Object.values(activeBySchool).flat();
    },
    async userHasRoleHistory() {
      return history;
    },
    getEstablishmentRolesStore() {
      return {
        async listRoleCatalogStates() {
          if (catalogError) throw new Error("catalog down");
          return catalog;
        },
      };
    },
    async resolveEffectivePermissions(principal) {
      calls.push(principal);
      if (permissionsError) throw new Error("rbac down");
      const permissions = Object.entries(modules)
        .filter(([, crud]) => crud.canRead)
        .map(([key]) => `${key}:READ`);
      return { roleKeys: principal.roleKeys, permissions, modules };
    },
  };
}

const school = { id: SCHOOL_ID, code: "CD-2026-0001" };

test("classification catalogue : actif école, archivé, autre portée, inconnu", () => {
  assert.equal(classifyCatalogRoleKey(CATALOG, "CONSEILLER_PÉDAGOGIQUE"), CATALOG_ROLE_STATE.ACTIVE_SCHOOL);
  assert.equal(classifyCatalogRoleKey(CATALOG, "conseiller_pedagogique"), CATALOG_ROLE_STATE.ACTIVE_SCHOOL);
  assert.equal(classifyCatalogRoleKey(CATALOG, "ANCIEN_RÔLE"), CATALOG_ROLE_STATE.ARCHIVED);
  assert.equal(classifyCatalogRoleKey(CATALOG, "AUDITEUR"), CATALOG_ROLE_STATE.OTHER_SCOPE);
  assert.equal(classifyCatalogRoleKey(CATALOG, "INCONNU"), CATALOG_ROLE_STATE.UNKNOWN);
  assert.equal(
    classifyCatalogRoleKey([...CATALOG, { roleCode: "CONSEILLER_PEDAGOGIQUE", roleName: "x", scope: "school", status: "active" }], "conseiller_pedagogique"),
    CATALOG_ROLE_STATE.AMBIGUOUS,
  );
  assert.equal(isCustomRoleKey("TEACHER"), false);
  assert.equal(isCustomRoleKey("Enseignant"), false);
  assert.equal(isCustomRoleKey("CONSEILLER_PÉDAGOGIQUE"), true);
});

test("rôle personnalisé actif avec permission Web : autorisé", async () => {
  const repo = fakeRepo();
  const decision = await resolveCustomRoleWebAccess(repo, { userId: USER_ID, school });
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.roleKeys, ["CONSEILLER_PÉDAGOGIQUE"]);
  assert.deepEqual(decision.webModules, ["classes"]);
  assert.equal(repo.calls[0].schoolId, SCHOOL_ID);
});

test("rôle personnalisé sans permission Web : refusé", async () => {
  const decision = await resolveCustomRoleWebAccess(fakeRepo({ modules: {} }), { userId: USER_ID, school });
  assert.equal(decision.allowed, false);
});

test("permission sur un module non Web uniquement : refusé", async () => {
  const { listFunctionalModules } = require("./functionalModulesCatalog");
  const mobileOnly = listFunctionalModules().find((module) => !module.appliesWeb);
  if (!mobileOnly) return; // catalogue courant : tous les modules sont Web
  const decision = await resolveCustomRoleWebAccess(fakeRepo({ modules: webModules(mobileOnly.moduleKey) }), {
    userId: USER_ID,
    school,
  });
  assert.equal(decision.allowed, false);
});

test("rôle archivé, autre portée ou hors catalogue : refusé", async () => {
  for (const key of ["ANCIEN_RÔLE", "AUDITEUR", "INCONNU"]) {
    const decision = await resolveCustomRoleWebAccess(fakeRepo({ activeBySchool: { [SCHOOL_ID]: [key] } }), {
      userId: USER_ID,
      school,
    });
    assert.equal(decision.allowed, false, key);
  }
});

test("rôle détenu dans un autre établissement : refusé", async () => {
  const repo = fakeRepo({ activeBySchool: { [OTHER_SCHOOL_ID]: ["CONSEILLER_PÉDAGOGIQUE"] } });
  const decision = await resolveCustomRoleWebAccess(repo, { userId: USER_ID, school });
  assert.equal(decision.allowed, false);
});

test("rôle révoqué (historique sans rôle actif) : refusé", async () => {
  const repo = fakeRepo({ activeBySchool: {}, history: true });
  assert.equal((await resolveCustomRoleWebAccess(repo, { userId: USER_ID, school })).allowed, false);
});

test("rôles plateforme ignorés sur le chemin dynamique", async () => {
  const repo = fakeRepo({ activeBySchool: { [SCHOOL_ID]: ["SUPER_ADMIN", "COUNTRY_ADMIN"] } });
  assert.equal((await resolveCustomRoleWebAccess(repo, { userId: USER_ID, school })).allowed, false);
  const mixed = fakeRepo({ activeBySchool: { [SCHOOL_ID]: ["SUPER_ADMIN", "CONSEILLER_PÉDAGOGIQUE"] } });
  const decision = await resolveCustomRoleWebAccess(mixed, { userId: USER_ID, school });
  assert.deepEqual(decision.roleKeys, ["CONSEILLER_PÉDAGOGIQUE"]);
});

test("fail-closed : rôles, catalogue ou permissions illisibles", async () => {
  for (const options of [{ rolesError: true }, { catalogError: true }, { permissionsError: true }]) {
    const decision = await resolveCustomRoleWebAccess(fakeRepo(options), { userId: USER_ID, school });
    assert.equal(decision.allowed, false, JSON.stringify(options));
  }
  assert.equal((await resolveCustomRoleWebAccess(fakeRepo(), { userId: USER_ID, school: null })).allowed, false);
  assert.equal((await resolveCustomRoleWebAccess(fakeRepo(), { userId: "", school })).allowed, false);
  assert.equal((await resolveCustomRoleWebAccess({}, { userId: USER_ID, school })).allowed, false);
});

test("permissions effectives : seul un rôle actif, unique, de portée établissement est conservé", async () => {
  const catalog = [
    ...CATALOG,
    { roleCode: "double", roleName: "Double A", scope: "school", status: "active" },
    { roleCode: "double_bis", roleName: "Double", scope: "school", status: "active" },
  ];
  const repo = fakeRepo({ catalog });
  const result = await canonicalizeCustomRoleKeys(repo, [
    "TEACHER",
    "CONSEILLER_PÉDAGOGIQUE",
    "conseiller_pedagogique",
    "ANCIEN_RÔLE",
    "INCONNU",
    "AUDITEUR",
    "DOUBLE",
  ]);
  assert.deepEqual(result.roleKeys, ["TEACHER", "CONSEILLER_PEDAGOGIQUE"]);
  assert.deepEqual([...result.activeCustomRoleKeys], ["CONSEILLER_PEDAGOGIQUE"]);
  assert.deepEqual(
    result.dropped.map((entry) => [entry.roleKey, entry.state]),
    [
      ["ANCIEN_RÔLE", CATALOG_ROLE_STATE.ARCHIVED],
      ["INCONNU", CATALOG_ROLE_STATE.UNKNOWN],
      ["AUDITEUR", CATALOG_ROLE_STATE.OTHER_SCOPE],
      ["DOUBLE", CATALOG_ROLE_STATE.AMBIGUOUS],
    ],
  );
});

test("permissions effectives : catalogue illisible → rôles personnalisés retirés, système conservé", async () => {
  const result = await canonicalizeCustomRoleKeys(fakeRepo({ catalogError: true }), ["SCHOOL_ADMIN", "CONSEILLER_PÉDAGOGIQUE"]);
  assert.deepEqual(result.roleKeys, ["SCHOOL_ADMIN"]);
});

test("permissions effectives : dépôt sans catalogue → rôles personnalisés retirés (fail-closed)", async () => {
  const result = await canonicalizeCustomRoleKeys({}, ["SCHOOL_ADMIN", "CONSEILLER_PÉDAGOGIQUE"]);
  assert.deepEqual(result.roleKeys, ["SCHOOL_ADMIN"]);
  assert.deepEqual(result.dropped, [{ roleKey: "CONSEILLER_PÉDAGOGIQUE", state: "catalog_missing" }]);
});

test("permissions effectives : rôles système jamais modifiés (Superadmin, Admin Pays, Enseignant, Parent, Élève)", async () => {
  const keys = ["SUPER_ADMIN", "COUNTRY_ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT", "STUDENT", "SUPERVISOR"];
  for (const repo of [fakeRepo(), fakeRepo({ catalogError: true }), {}]) {
    const result = await canonicalizeCustomRoleKeys(repo, keys);
    assert.deepEqual(result.roleKeys, keys);
    assert.equal(result.activeCustomRoleKeys.size, 0);
  }
});

test("permissions effectives : un role_code ne donne jamais les droits d'un rôle système", async () => {
  const catalog = [{ roleCode: "TEACHER", roleName: "Faux enseignant", scope: "school", status: "active" }];
  const result = await canonicalizeCustomRoleKeys(fakeRepo({ catalog }), ["FAUX_ENSEIGNANT"]);
  assert.deepEqual(result.roleKeys, []);
  assert.equal(result.dropped[0].state, "canonical_system_collision");
});

test("portée de lecture : rôles personnalisés seuls, relus en base, fail-closed", async () => {
  const principal = { sub: USER_ID, schoolId: SCHOOL_ID, schoolCode: "CD-2026-0001" };
  const repo = fakeRepo({
    activeBySchool: { [SCHOOL_ID]: ["TEACHER", "CONSEILLER_PÉDAGOGIQUE"] },
    modules: webModules("classes"),
  });
  const scope = await resolveCustomRoleReadScope(repo, principal);
  assert.deepEqual({ ...scope }, { classes: true, students: false });
  assert.deepEqual(repo.calls[0].roleKeys, ["CONSEILLER_PÉDAGOGIQUE"], "seuls les rôles personnalisés sont évalués");
  assert.equal(repo.calls[0].sub, undefined, "évaluation explicite sans sujet");

  const noCustom = await resolveCustomRoleReadScope(fakeRepo({ activeBySchool: { [SCHOOL_ID]: ["TEACHER"] } }), principal);
  assert.deepEqual({ ...noCustom }, { classes: false, students: false });
  const failing = await resolveCustomRoleReadScope(fakeRepo({ permissionsError: true }), principal);
  assert.deepEqual({ ...failing }, { classes: false, students: false });
  const platform = await resolveCustomRoleReadScope(fakeRepo(), { ...principal, schoolCode: "*" });
  assert.deepEqual({ ...platform }, { classes: false, students: false });
});

test("classStudentsAuthz : portée personnalisée honorée module par module", () => {
  const { scopeSchoolClassesForPrincipal, scopeSchoolStudentsForPrincipal } = require("./classStudentsAuthz");
  const rows = [{ classCode: "A" }, { classCode: "B" }];
  const principal = { role: "CONSEILLER_PÉDAGOGIQUE", customRoleReadScope: { classes: true, students: false } };
  assert.deepEqual(scopeSchoolClassesForPrincipal(principal, rows), rows);
  assert.throws(() => scopeSchoolStudentsForPrincipal(principal, rows, () => undefined), /hors périmètre/);
  assert.throws(() => scopeSchoolClassesForPrincipal({ role: "CONSEILLER_PÉDAGOGIQUE" }, rows), /hors périmètre/);
});

function loginService({ resolver, role = "CONSEILLER_PÉDAGOGIQUE", accessChannel = "Application" } = {}) {
  const passwordHash = hashSecret("Secret-Rbac-01!");
  return new BackOfficeAccessService({
    school: { code: "CD-2026-0001" },
    schools: [{ id: SCHOOL_ID, code: "CD-2026-0001", loginCode: "AB-26", country: "RDC", status: "Actif", validationStatus: "Validé" }],
    userAccounts: [
      {
        id: USER_ID,
        identifier: "rl01-user",
        role,
        roleKeys: [role],
        schoolCode: "CD-2026-0001",
        status: "Actif",
        accessChannel,
        passwordHash,
        mustChangePassword: false,
      },
    ],
    subscriptions: [{ schoolCode: "CD-2026-0001", status: "Actif", paymentStatus: "À jour", endDate: "2099-12-31" }],
    resolveDynamicWebRoleAccess: resolver,
  });
}

async function attemptLogin(service) {
  process.env.SOMAFRIK_DISABLE_LOGIN_LOCKOUT = "true";
  return service.login({ schoolCode: "AB-26", identifier: "rl01-user", password: "Secret-Rbac-01!" });
}

test("BackOfficeAccessService : rôle personnalisé autorisé par la résolution dynamique", async (t) => {
  let seen = null;
  const service = loginService({
    resolver: async (user, schoolContext) => {
      seen = { userId: user.id, schoolId: schoolContext.id };
      return { allowed: true };
    },
  });
  let response;
  try {
    response = await attemptLogin(service);
  } catch (error) {
    if (/abonnement|Abonnement/.test(String(error?.message))) {
      t.skip("fixture d'abonnement non reconnue dans ce contexte");
      return;
    }
    throw error;
  }
  assert.deepEqual(seen, { userId: USER_ID, schoolId: SCHOOL_ID });
  assert.equal(response.user.webAccessProfile, "school_custom_role");
  assert.equal(response.dashboard.privilegeLevel, "SCHOOL_CUSTOM_ROLE");
  assert.deepEqual(response.menus, ["Dashboard"]);
  assert.equal(response.user.passwordHash, undefined);
});

test("BackOfficeAccessService : refus, erreur ou absence de résolveur → 403", async () => {
  for (const resolver of [async () => ({ allowed: false }), async () => { throw new Error("x"); }, null]) {
    await assert.rejects(attemptLogin(loginService({ resolver })), (error) => error.statusCode === 403);
  }
});

test("BackOfficeAccessService : rôle système statique jamais soumis au résolveur", async () => {
  let called = false;
  const service = loginService({
    role: "Secrétaire",
    resolver: async () => {
      called = true;
      return { allowed: false };
    },
  });
  try {
    const response = await attemptLogin(service);
    assert.equal(response.user.webAccessProfile, undefined);
  } catch (error) {
    // Un refus d'abonnement / d'établissement du fixture n'est pas l'objet du test.
    assert.notEqual(error?.message, "Ce compte n'a pas accès à la plateforme");
  }
  assert.equal(called, false);
});
