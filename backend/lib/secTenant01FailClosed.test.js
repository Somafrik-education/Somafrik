"use strict";

/**
 * SEC-TENANT-01 — portée établissement fail-closed.
 * Un rôle scolaire sans rattachement n'est jamais traité comme schoolCode "*".
 */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  isPlatformScopePrincipal,
  isSchoolRolePrincipal,
  hasConcreteSchoolCode,
} = require("./platformScopePrincipal");
const { resolveEffectiveSchoolScope } = require("./principalSchoolScope");
const { resolveRefreshSchoolCode } = require("./refreshSchoolAttachment");
const { hydrateCanonicalSchoolAttachment } = require("./canonicalSchoolAttachment");
const { AuthService, BusinessError } = require("../services/authService");
const { BackOfficeAccessService } = require("../services/backOfficeAccessService");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");

const OTHER_SCHOOL = {
  id: "school-other",
  login_code: "CD-AUT-26-002",
  school_code: "CD-2026-0002",
  country_code: "CD",
  countryCode: "CD",
};

const SCHOOL_ROLE_PRINCIPALS = {
  "Admin School": { role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] },
  Directeur: { role: "Proviseur / Directeur", roleKeys: ["PRINCIPAL"] },
  Secrétaire: { role: "Secrétaire", roleKeys: ["SECRETARY"] },
  Enseignant: { role: "Enseignant", roleKeys: ["TEACHER"] },
  Parent: { role: "Parent", roleKeys: ["PARENT"] },
};

function assertAttachmentRequired(fn) {
  assert.throws(fn, (error) => error.statusCode === 403 && error.code === "SCHOOL_SCOPE_ATTACHMENT_REQUIRED");
}

test("helpers: seuls Superadmin et Admin Pays portent la portée plateforme", () => {
  assert.equal(isPlatformScopePrincipal({ role: "Super Administrateur Somafrik" }), true);
  assert.equal(isPlatformScopePrincipal({ role: "Admin Pays" }), true);
  assert.equal(isPlatformScopePrincipal({ roleKeys: ["COUNTRY_ADMIN"] }), true);
  for (const principal of Object.values(SCHOOL_ROLE_PRINCIPALS)) {
    assert.equal(isPlatformScopePrincipal({ ...principal, schoolCode: "*" }), false);
    assert.equal(isSchoolRolePrincipal(principal), true);
  }
  assert.equal(isSchoolRolePrincipal({ role: "Sans affectation", roleKeys: [] }), false);
  assert.equal(hasConcreteSchoolCode("*"), false);
  assert.equal(hasConcreteSchoolCode(""), false);
  assert.equal(hasConcreteSchoolCode("CD-IN-26-001"), true);
});

for (const [label, principal] of Object.entries(SCHOOL_ROLE_PRINCIPALS)) {
  test(`résolveur: ${label} avec schoolCode "*" est refusé, avec ou sans sélection d'établissement`, () => {
    const scoped = { ...principal, schoolCode: "*", countryCode: "CD" };
    assertAttachmentRequired(() => resolveEffectiveSchoolScope({ principal: scoped }));
    assertAttachmentRequired(() =>
      resolveEffectiveSchoolScope({ principal: scoped, requestedSchoolCode: OTHER_SCHOOL.login_code, school: OTHER_SCHOOL }),
    );
  });

  test(`résolveur: ${label} sans école (schoolCode vide) est refusé`, () => {
    assertAttachmentRequired(() =>
      resolveEffectiveSchoolScope({ principal: { ...principal, schoolCode: "", countryCode: "CD" } }),
    );
  });
}

test("résolveur: rôle scolaire rattaché ne peut pas sélectionner un autre établissement", () => {
  assert.throws(
    () =>
      resolveEffectiveSchoolScope({
        principal: { role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: "CD-2026-0001" },
        requestedSchoolCode: OTHER_SCHOOL.login_code,
        school: OTHER_SCHOOL,
      }),
    (error) => error.statusCode === 403 && error.code === "SCHOOL_SCOPE_OVERRIDE_FORBIDDEN",
  );
});

test("résolveur: profil multi-rôles scolaire rattaché conserve son établissement", () => {
  const principal = { role: "Admin School", roleKeys: ["SCHOOL_ADMIN", "TEACHER"], schoolCode: "CD-2026-0001" };
  assert.equal(resolveEffectiveSchoolScope({ principal }).schoolCode, "CD-2026-0001");
});

test("résolveur: compte sans affectation n'hérite jamais de \"*\"", () => {
  const principal = { role: "Sans affectation", roleKeys: [], schoolCode: "*" };
  assert.equal(resolveEffectiveSchoolScope({ principal }).schoolCode, "");
  assert.throws(
    () => resolveEffectiveSchoolScope({ principal, requestedSchoolCode: OTHER_SCHOOL.login_code, school: OTHER_SCHOOL }),
    (error) => error.statusCode === 403 && error.code === "SCHOOL_SCOPE_OVERRIDE_FORBIDDEN",
  );
});

test("résolveur: Superadmin conserve la sélection d'établissement", () => {
  const principal = { role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], schoolCode: "*" };
  const scoped = resolveEffectiveSchoolScope({ principal, requestedSchoolCode: OTHER_SCHOOL.login_code, school: OTHER_SCHOOL });
  assert.equal(scoped.effectiveSchoolCode, OTHER_SCHOOL.login_code);
  assert.equal(resolveEffectiveSchoolScope({ principal }).schoolCode, "*");
});

test("résolveur: Admin Pays reste borné à son pays", () => {
  const principal = { role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"], schoolCode: "*", countryCode: "CD" };
  const scoped = resolveEffectiveSchoolScope({ principal, requestedSchoolCode: OTHER_SCHOOL.login_code, school: OTHER_SCHOOL });
  assert.equal(scoped.effectiveSchoolCode, OTHER_SCHOOL.login_code);
  assert.throws(
    () =>
      resolveEffectiveSchoolScope({
        principal: { ...principal, countryCode: "BI" },
        requestedSchoolCode: OTHER_SCHOOL.login_code,
        school: OTHER_SCHOOL,
      }),
    (error) => error.statusCode === 403 && error.code === "SCHOOL_SCOPE_COUNTRY_FORBIDDEN",
  );
});

function loginFixture() {
  const school = {
    id: "school-1",
    code: "SCH-TEST",
    loginCode: "CD-IN-26-001",
    publicId: "CD-IN-26-001",
    name: "Institut Nuru",
    city: "Kinshasa",
    country: "RDC",
    countryCode: "CD",
    status: "Actif",
    validationStatus: "Validé",
  };
  const orphanSchoolAdmin = {
    id: "USR-ORPHAN",
    identifier: "orphan",
    firstName: "Sans",
    lastName: "Ecole",
    role: "Admin School",
    schoolCode: "*",
    countryCode: "CD",
    accessChannel: "Application",
    status: "Actif",
    password: "Orphan-Pass-2026",
    pin: "481516",
  };
  const superadmin = {
    id: "USR-SUPER",
    identifier: "super-test",
    firstName: "Super",
    lastName: "Admin",
    role: "Super Administrateur Somafrik",
    schoolCode: "*",
    accessChannel: "Application",
    status: "Actif",
    password: "Super-Pass-2026",
  };
  return { school, orphanSchoolAdmin, superadmin };
}

test("connexion Mobile: rôle scolaire avec schoolCode \"*\" ne correspond à aucun établissement", async () => {
  attachMemoryLoginLockoutStore();
  const { school, orphanSchoolAdmin, superadmin } = loginFixture();
  const service = new AuthService({
    school,
    schools: [school],
    teachers: [],
    students: [],
    userAccounts: [orphanSchoolAdmin, superadmin],
    countries: [{ name: "RDC", code: "CD", status: "Actif" }],
    subscriptions: [],
  });
  assert.equal(service.findManagedUser("orphan", school.code), undefined);
  assert.equal(service.findManagedUser("super-test", school.code)?.id, "USR-SUPER");
  await assert.rejects(
    () => service.login({ role: "school_admin", schoolCode: school.loginCode, identifier: "orphan", pin: "481516" }),
    (error) => error instanceof BusinessError && error.statusCode === 401,
  );
});

test("connexion Web: rôle scolaire avec schoolCode \"*\" n'est pas un repli plateforme", () => {
  attachMemoryLoginLockoutStore();
  const { school, orphanSchoolAdmin, superadmin } = loginFixture();
  const service = new BackOfficeAccessService({
    school,
    schools: [school],
    userAccounts: [orphanSchoolAdmin, superadmin],
    students: [],
    countries: [],
    subscriptions: [],
  });
  assert.equal(service.findUserAccount("orphan", school.code), undefined);
  assert.equal(service.findUserAccount("super-test", school.code)?.id, "USR-SUPER");
});

function refreshRepository({ attached }) {
  const revoked = [];
  return {
    revoked,
    async isUserAttachedToSessionSchool() {
      return attached;
    },
    async revokeSession(sessionId, reason) {
      revoked.push({ sessionId, reason });
    },
  };
}

test("refresh: rôle scolaire rattaché conserve son établissement", async () => {
  const repository = refreshRepository({ attached: true });
  const schoolCode = await resolveRefreshSchoolCode({
    repository,
    session: { role: "Admin School", school_code: "CD-2026-0001", school_id: "s1", user_id: "u1" },
    payload: { sessionId: "sess-1" },
    roleKeys: ["SCHOOL_ADMIN"],
  });
  assert.equal(schoolCode, "CD-2026-0001");
  assert.deepEqual(repository.revoked, []);
});

test("refresh: rôle scolaire retiré de son établissement → session révoquée", async () => {
  const repository = refreshRepository({ attached: false });
  await assert.rejects(
    () =>
      resolveRefreshSchoolCode({
        repository,
        session: { role: "Secrétaire", school_code: "CD-2026-0001", school_id: "s1", user_id: "u1" },
        payload: { sessionId: "sess-2" },
        roleKeys: ["SECRETARY"],
      }),
    (error) => error.statusCode === 401 && error.code === "SESSION_SCHOOL_ATTACHMENT_MISSING",
  );
  assert.deepEqual(repository.revoked, [{ sessionId: "sess-2", reason: "school_attachment_missing" }]);
});

test("refresh: rôle scolaire sans établissement de session → jamais \"*\", session révoquée", async () => {
  const repository = refreshRepository({ attached: true });
  await assert.rejects(
    () =>
      resolveRefreshSchoolCode({
        repository,
        session: { role: "Enseignant", school_code: null, school_id: null, user_id: "u1" },
        payload: { sessionId: "sess-3" },
        roleKeys: ["TEACHER"],
      }),
    (error) => error.statusCode === 401,
  );
  assert.equal(repository.revoked.length, 1);
});

test("refresh: rôles plateforme conservent leur portée", async () => {
  const repository = refreshRepository({ attached: false });
  assert.equal(
    await resolveRefreshSchoolCode({ repository, session: { role: "SUPER_ADMIN", school_code: null }, roleKeys: ["SUPER_ADMIN"] }),
    "*",
  );
  assert.equal(
    await resolveRefreshSchoolCode({ repository, session: { role: "COUNTRY_ADMIN", school_code: null }, roleKeys: ["COUNTRY_ADMIN"] }),
    "*",
  );
  assert.deepEqual(repository.revoked, []);
});

test("attribution: aucun rôle scolaire n'est accordé à un compte sans établissement", async () => {
  const store = createClientsMemoryStore({
    platformSchools: [
      { id: "school-cd", code: "CD-2026-0001", name: "Institut CD", countryId: "country-cd", countryCode: "CD", country: "RDC" },
    ],
  });
  const superAdmin = { sub: "super", role: "Super Administrateur Somafrik", schoolCode: "*", identifier: "superadmin" };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "sec-tenant-01" };
  const orphan = await store.createUser(
    { firstName: "Sans", lastName: "Ecole", email: "sans.ecole@test.local" },
    superAdmin,
    auditMeta,
  );
  const countryAdmin = { sub: "admin-pays", role: "Admin Pays", countryCode: "CD", schoolCode: "*", identifier: "admin-rdc" };
  for (const principal of [superAdmin, countryAdmin]) {
    for (const roleKey of ["SCHOOL_ADMIN", "PRINCIPAL", "SECRETARY", "ACCOUNTANT", "TEACHER"]) {
      await assert.rejects(
        store.grantUserRole(orphan.id, { roleKey }, principal, auditMeta),
        (error) => [400, 403].includes(error.statusCode),
        `${principal.role} → ${roleKey}`,
      );
    }
  }
  const roles = (store._tables.userRoles || []).filter((row) => row.user_id === orphan.id);
  assert.deepEqual(roles, []);
});

test("refresh: dépôt sans vérification de rattachement → refus (fail-closed)", async () => {
  const revoked = [];
  const repository = {
    async revokeSession(sessionId, reason) {
      revoked.push({ sessionId, reason });
    },
  };
  await assert.rejects(
    () =>
      resolveRefreshSchoolCode({
        repository,
        session: { role: "Admin School", school_code: "CD-2026-0001", school_id: "s1", user_id: "u1" },
        payload: { sessionId: "sess-4" },
        roleKeys: ["SCHOOL_ADMIN"],
      }),
    (error) => error.statusCode === 401 && error.code === "SESSION_SCHOOL_ATTACHMENT_MISSING",
  );
  assert.deepEqual(revoked, [{ sessionId: "sess-4", reason: "school_attachment_missing" }]);
});

test("refresh: claim schoolCode du refresh token différent de la session → refus", async () => {
  const repository = refreshRepository({ attached: true });
  await assert.rejects(
    () =>
      resolveRefreshSchoolCode({
        repository,
        session: {
          role: "Admin School",
          school_code: "CD-2026-0001",
          school_login_code: "CD-IN-26-001",
          school_id: "s1",
          user_id: "u1",
        },
        payload: { sessionId: "sess-5", schoolCode: "CD-2026-0002" },
        roleKeys: ["SCHOOL_ADMIN"],
      }),
    (error) => error.statusCode === 401,
  );
  for (const schoolCode of ["CD-2026-0001", "CD-IN-26-001", ""]) {
    assert.equal(
      await resolveRefreshSchoolCode({
        repository,
        session: {
          role: "Admin School",
          school_code: "CD-2026-0001",
          school_login_code: "CD-IN-26-001",
          school_id: "s1",
          user_id: "u1",
        },
        payload: { sessionId: "sess-6", schoolCode },
        roleKeys: ["SCHOOL_ADMIN"],
      }),
      "CD-2026-0001",
    );
  }
});

test("hydratation: claim vide d'un rôle scolaire relu depuis users.school_id (GP-003)", async () => {
  const repository = {
    async findUserCanonicalSchool(userId) {
      return userId === "attached" ? { schoolId: "s1", schoolCode: "CD-2026-0001" } : null;
    },
  };
  const attached = await hydrateCanonicalSchoolAttachment(
    { sub: "attached", role: "Comptable", roleKeys: ["ACCOUNTANT"], schoolCode: "" },
    repository,
  );
  assert.equal(attached.schoolCode, "CD-2026-0001");
  assert.equal(attached.schoolAttachmentSource, "users.school_id");
  assert.equal(resolveEffectiveSchoolScope({ principal: attached }).schoolCode, "CD-2026-0001");

  const orphan = await hydrateCanonicalSchoolAttachment(
    { sub: "orphan", role: "Comptable", roleKeys: ["ACCOUNTANT"], schoolCode: "*" },
    repository,
  );
  assertAttachmentRequired(() => resolveEffectiveSchoolScope({ principal: orphan }));

  const noReader = await hydrateCanonicalSchoolAttachment(
    { sub: "attached", role: "Comptable", roleKeys: ["ACCOUNTANT"], schoolCode: "" },
    {},
  );
  assertAttachmentRequired(() => resolveEffectiveSchoolScope({ principal: noReader }));

  const platform = { sub: "attached", role: "Super Administrateur Somafrik", schoolCode: "*" };
  assert.equal(await hydrateCanonicalSchoolAttachment(platform, repository), platform);
  const concrete = { sub: "attached", role: "Comptable", roleKeys: ["ACCOUNTANT"], schoolCode: "CD-2026-0009" };
  assert.equal(await hydrateCanonicalSchoolAttachment(concrete, repository), concrete);
});

const { assertAccessSessionAccount } = require("./accessSessionAccountGuard");

function guardRepository(canonical = null) {
  const revoked = [];
  return {
    revoked,
    async revokeSession(sessionId, reason) {
      revoked.push({ sessionId, reason });
    },
    async findUserCanonicalSchool() {
      return canonical;
    },
  };
}

const ACTIVE_SESSION_A = {
  user_status: "active",
  user_school_id: "s-a",
  user_school_code: "CD-2026-0001",
  user_school_login_code: "CD-IN-26-001",
};

test("session: compte non actif → 401 et session révoquée, tous rôles", async () => {
  for (const [status, principal] of [
    ["inactive", { role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: "CD-2026-0001" }],
    ["archived", { role: "Secrétaire", roleKeys: ["SECRETARY"], schoolCode: "CD-2026-0001" }],
    ["suspended", { role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], schoolCode: "*" }],
    [null, { role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"], schoolCode: "*" }],
  ]) {
    const repository = guardRepository();
    await assert.rejects(
      () =>
        assertAccessSessionAccount({
          principal,
          activeSession: { ...ACTIVE_SESSION_A, user_status: status },
          repository,
          sessionId: "sess-x",
        }),
      (error) => error.statusCode === 401 && error.code === "SESSION_ACCOUNT_INACTIVE",
      String(status),
    );
    assert.deepEqual(repository.revoked, [{ sessionId: "sess-x", reason: "account_inactive" }]);
  }
});

test("session: ancien jeton A après transfert du compte vers B → 401 et révocation", async () => {
  const repository = guardRepository();
  await assert.rejects(
    () =>
      assertAccessSessionAccount({
        principal: { role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: "CD-2026-0001", schoolId: "s-a" },
        activeSession: { user_status: "active", user_school_id: "s-b", user_school_code: "CD-2026-0002" },
        repository,
        sessionId: "sess-y",
      }),
    (error) => error.statusCode === 401 && error.code === "SESSION_SCHOOL_ATTACHMENT_MISSING",
  );
  assert.deepEqual(repository.revoked, [{ sessionId: "sess-y", reason: "school_attachment_changed" }]);
});

test("session: compte retiré de tout établissement → 401", async () => {
  await assert.rejects(
    () =>
      assertAccessSessionAccount({
        principal: { role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: "CD-2026-0001" },
        activeSession: { user_status: "active", user_school_id: null, user_school_code: null },
        repository: guardRepository(),
        sessionId: "sess-z",
      }),
    (error) => error.statusCode === 401,
  );
});

test("session: établissement canonique inchangé (code interne ou login_code) → accepté", async () => {
  for (const schoolCode of ["CD-2026-0001", "CD-IN-26-001"]) {
    const repository = guardRepository();
    await assertAccessSessionAccount({
      principal: { role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode },
      activeSession: ACTIVE_SESSION_A,
      repository,
      sessionId: "sess-ok",
    });
    assert.deepEqual(repository.revoked, []);
  }
  const platform = guardRepository();
  await assertAccessSessionAccount({
    principal: { role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], schoolCode: "*" },
    activeSession: { user_status: "active", user_school_id: null },
    repository: platform,
    sessionId: "sess-sa",
  });
  assert.deepEqual(platform.revoked, []);
});

test("session: dépôt sans projection de compte → rattachement relu (findUserCanonicalSchool)", async () => {
  await assertAccessSessionAccount({
    principal: { role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: "SCH-MEM" },
    activeSession: { session_code: "mem" },
    repository: guardRepository({ schoolId: "", schoolCode: "SCH-MEM" }),
    sessionId: "mem",
  });
  await assert.rejects(
    () =>
      assertAccessSessionAccount({
        principal: { role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: "SCH-MEM" },
        activeSession: { session_code: "mem" },
        repository: guardRepository(null),
        sessionId: "mem",
      }),
    (error) => error.statusCode === 401,
  );
});

test("refresh: compte non actif → 401 et session révoquée, même plateforme", async () => {
  const repository = refreshRepository({ attached: true });
  await assert.rejects(
    () =>
      resolveRefreshSchoolCode({
        repository,
        session: { role: "SUPER_ADMIN", user_status: "inactive", school_code: null },
        payload: { sessionId: "sess-r" },
        roleKeys: ["SUPER_ADMIN"],
      }),
    (error) => error.statusCode === 401 && error.code === "SESSION_ACCOUNT_INACTIVE",
  );
  assert.deepEqual(repository.revoked, [{ sessionId: "sess-r", reason: "account_inactive" }]);
});
