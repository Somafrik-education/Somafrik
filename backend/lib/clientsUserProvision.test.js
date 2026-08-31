"use strict";

const assert = require("node:assert/strict");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { CLIENTS_ERROR } = require("./clientsManagement");
const { USER_ROLE_ERROR } = require("./userRoleLifecycle");
const clientsService = require("./clientsService");

function buildStore(seed = {}) {
  return createClientsMemoryStore({
    platformSchools: [
      { id: "school-cd", code: "CD-2026-0001", name: "Institut Bukavu", countryId: "country-cd", countryCode: "CD", country: "RDC", login_code: "CD-IB-26-002" },
      { id: "school-bi", code: "BI-2026-0001", name: "Ecole Kanyosha", countryId: "country-bi", countryCode: "BI", country: "Burundi", login_code: "BI-EK-26-001" },
    ],
    countries: [
      { id: "country-cd", iso_code: "CD", name: "RDC" },
      { id: "country-bi", iso_code: "BI", name: "Burundi" },
    ],
    users: [
      { id: "admin-school", school_id: "school-cd", first_name: "Admin", last_name: "School", email: "admin-school@test.local", role: "SCHOOL_ADMIN", status: "active" },
    ],
    ...seed,
  });
}

async function expectRejection(promise, { status, code }) {
  try {
    await promise;
    throw new Error(`Expected rejection ${code || status}`);
  } catch (error) {
    assert.equal(error.statusCode, status, error.message);
    if (code) assert.equal(error.code, code, error.message);
  }
}

async function main() {
  const superAdmin = {
    sub: "super",
    role: "Super Administrateur Somafrik",
    schoolCode: "*",
    identifier: "superadmin",
  };
  const countryAdmin = {
    sub: "admin-pays",
    role: "Admin Pays",
    countryCode: "CD",
    schoolCode: "*",
    identifier: "admin-rdc",
  };
  const schoolAdmin = {
    sub: "admin-school",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    countryCode: "CD",
    identifier: "admin-cd",
  };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "provision-test" };

  const store = buildStore();

  const countryAdminBi = await store.provisionUser(
    {
      firstName: "Amina",
      lastName: "Ndayishimiye",
      email: "amina.pays.bi@test.local",
      temporaryPassword: "CountryAdminBI!2026",
      roleKey: "COUNTRY_ADMIN",
      countryCode: "BI",
    },
    superAdmin,
    auditMeta,
  );
  assert.ok((countryAdminBi.roleKeys || []).includes("COUNTRY_ADMIN"));
  assert.equal(countryAdminBi.countryCode, "BI");
  const countryRow = await store.getUserById(countryAdminBi.id);
  assert.equal(countryRow.school_id, null);
  const countryRole = store._tables.userRoles.find(
    (row) => row.user_id === countryAdminBi.id && row.role_key === "COUNTRY_ADMIN" && row.status === "active",
  );
  assert.ok(countryRole, "user_roles COUNTRY_ADMIN actif manquant");
  assert.equal(countryRole.school_id, null);
  assert.equal(countryRow.role, "COUNTRY_ADMIN");

  const schoolAdminBi = await store.provisionUser(
    {
      firstName: "Grace",
      lastName: "Kanyosha",
      email: "grace.school.bi@test.local",
      temporaryPassword: "SchoolAdminBI!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "BI",
      schoolCode: "BI-2026-0001",
    },
    superAdmin,
    auditMeta,
  );
  assert.ok((schoolAdminBi.roleKeys || []).includes("SCHOOL_ADMIN"));
  assert.equal(schoolAdminBi.schoolCode, "BI-2026-0001");
  assert.equal(schoolAdminBi.countryCode, "BI");
  const schoolRow = await store.getUserById(schoolAdminBi.id);
  assert.equal(schoolRow.school_id, "school-bi");
  const schoolRole = store._tables.userRoles.find(
    (row) => row.user_id === schoolAdminBi.id && row.role_key === "SCHOOL_ADMIN" && row.status === "active",
  );
  assert.equal(schoolRole?.school_id, "school-bi");
  assert.equal(String(schoolRow.school_id), String(schoolRole.school_id));

  const schoolAdminCd = await store.provisionUser(
    {
      firstName: "Awa",
      lastName: "Bukavu",
      email: "awa.school.cd@test.local",
      temporaryPassword: "SchoolAdminCD!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    superAdmin,
    auditMeta,
  );
  assert.ok((schoolAdminCd.roleKeys || []).includes("SCHOOL_ADMIN"));
  assert.equal(schoolAdminCd.schoolCode, "CD-2026-0001");
  assert.equal(schoolAdminCd.countryCode, "CD");
  assert.notEqual(schoolAdminCd.schoolCode, "BI-2026-0001");

  const schoolAdminCdAccent = await store.provisionUser(
    {
      firstName: "Grace",
      lastName: "Accent",
      email: "grace.accent.cd@test.local",
      temporaryPassword: "SchoolAdminCD!2026",
      roleKey: "SCHOOL_ADMIN",
      countryScope: "République Démocratique du Congo",
      schoolCode: "CD-2026-0001",
    },
    superAdmin,
    auditMeta,
  );
  assert.equal(schoolAdminCdAccent.countryCode, "CD");
  assert.equal(schoolAdminCdAccent.schoolCode, "CD-2026-0001");

  const schoolAdminByLoginCode = await store.provisionUser(
    {
      firstName: "Login",
      lastName: "Code",
      email: "login.code.cd@test.local",
      temporaryPassword: "SchoolAdminCD!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-IB-26-002",
    },
    superAdmin,
    auditMeta,
  );
  assert.equal(schoolAdminByLoginCode.schoolCode, "CD-2026-0001");
  assert.notEqual(schoolAdminByLoginCode.schoolCode, "CD-IB-26-002");
  assert.equal(schoolAdminByLoginCode.countryCode, "CD");

  await expectRejection(
    store.provisionUser(
      {
        firstName: "Wrong",
        lastName: "Scope",
        email: "wrong.scope@test.local",
        roleKey: "SCHOOL_ADMIN",
        countryCode: "BI",
        schoolCode: "CD-2026-0001",
      },
      superAdmin,
      auditMeta,
    ),
    { status: 409, code: CLIENTS_ERROR.SCHOOL_COUNTRY_MISMATCH },
  );

  await expectRejection(
    store.provisionUser(
      { firstName: "No", lastName: "Country", email: "no.country.school@test.local", roleKey: "SCHOOL_ADMIN", schoolCode: "BI-2026-0001" },
      superAdmin,
      auditMeta,
    ),
    { status: 400, code: CLIENTS_ERROR.COUNTRY_REQUIRED },
  );

  await expectRejection(
    store.provisionUser(
      { firstName: "No", lastName: "School", email: "no.school@test.local", roleKey: "SCHOOL_ADMIN", countryCode: "BI" },
      superAdmin,
      auditMeta,
    ),
    { status: 400, code: CLIENTS_ERROR.SCHOOL_REQUIRED },
  );

  await expectRejection(
    store.provisionUser(
      { firstName: "No", lastName: "Pays", email: "no.country.admin@test.local", roleKey: "COUNTRY_ADMIN" },
      superAdmin,
      auditMeta,
    ),
    { status: 400, code: CLIENTS_ERROR.COUNTRY_REQUIRED },
  );

  await expectRejection(
    store.provisionUser(
      {
        firstName: "Incoherent",
        lastName: "Pays",
        email: "country.with.school@test.local",
        roleKey: "COUNTRY_ADMIN",
        countryCode: "BI",
        schoolCode: "BI-2026-0001",
      },
      superAdmin,
      auditMeta,
    ),
    { status: 409, code: CLIENTS_ERROR.ROLE_SCOPE_CONFLICT },
  );

  await expectRejection(
    store.provisionUser(
      {
        firstName: "Unknown",
        lastName: "Country",
        email: "unknown.country@test.local",
        roleKey: "COUNTRY_ADMIN",
        countryCode: "ZZ",
      },
      superAdmin,
      auditMeta,
    ),
    { status: 404, code: CLIENTS_ERROR.COUNTRY_NOT_FOUND },
  );

  await expectRejection(
    store.provisionUser(
      {
        firstName: "Teacher",
        lastName: "Nope",
        email: "teacher.provision@test.local",
        roleKey: "TEACHER",
        countryCode: "BI",
        schoolCode: "BI-2026-0001",
      },
      superAdmin,
      auditMeta,
    ),
    { status: 400, code: CLIENTS_ERROR.ROLE_NOT_ALLOWED },
  );

  await expectRejection(
    store.provisionUser(
      {
        firstName: "Denied",
        lastName: "School",
        email: "school.actor.country@test.local",
        roleKey: "COUNTRY_ADMIN",
        countryCode: "BI",
      },
      schoolAdmin,
      auditMeta,
    ),
    { status: 403, code: USER_ROLE_ERROR.PLATFORM_ROLE_FORBIDDEN },
  );

  await expectRejection(
    store.provisionUser(
      {
        firstName: "Denied",
        lastName: "Pays",
        email: "country.actor.country@test.local",
        roleKey: "COUNTRY_ADMIN",
        countryCode: "BI",
      },
      countryAdmin,
      auditMeta,
    ),
    { status: 403, code: USER_ROLE_ERROR.PLATFORM_ROLE_FORBIDDEN },
  );

  await expectRejection(
    store.createUser(
      { firstName: "Role", lastName: "Forbidden", email: "role.on.create@test.local", role: "Admin School", schoolCode: "BI-2026-0001" },
      superAdmin,
      auditMeta,
    ),
    { status: 400, code: USER_ROLE_ERROR.ROLE_NOT_ALLOWED_ON_CREATE },
  );

  await expectRejection(
    store.provisionUser(
      {
        firstName: "Dup",
        lastName: "Email",
        email: "amina.pays.bi@test.local",
        roleKey: "COUNTRY_ADMIN",
        countryCode: "BI",
      },
      superAdmin,
      auditMeta,
    ),
    { status: 409, code: CLIENTS_ERROR.USER_LOGIN_IDENTITY_DUPLICATE },
  );
  assert.equal(
    store._tables.users.filter((row) => row.email === "amina.pays.bi@test.local").length,
    1,
    "doublon login : pas de seconde identité",
  );

  const roleFailStore = {
    ...store,
    withTransaction(fn) {
      return store.withTransaction(async (tx) => {
        const original = tx.insertUserRole;
        tx.insertUserRole = async () => {
          throw new Error("forced user_roles failure");
        };
        try {
          return await fn(tx);
        } finally {
          tx.insertUserRole = original;
        }
      });
    },
  };
  roleFailStore.provisionUser = (...args) => clientsService.provisionUser(roleFailStore, ...args);
  await expectRejection(
    roleFailStore.provisionUser(
      {
        firstName: "Rollback",
        lastName: "Role",
        email: "rollback.role@test.local",
        roleKey: "COUNTRY_ADMIN",
        countryCode: "BI",
      },
      superAdmin,
      auditMeta,
    ),
    { status: 500, code: CLIENTS_ERROR.USER_ROLE_GRANT_FAILED },
  );
  assert.equal(
    store._tables.users.filter((row) => row.email === "rollback.role@test.local").length,
    0,
    "rollback insert user_roles : aucune ligne users",
  );
  assert.equal(
    store._tables.userRoles.filter((row) => row.role_key === "COUNTRY_ADMIN" && row.status === "active").length,
    1,
    "le COUNTRY_ADMIN BI nominal reste seul",
  );

  const auditFailStore = {
    ...store,
    withTransaction(fn) {
      return store.withTransaction(async (tx) => {
        const original = tx.recordClientsAudit;
        tx.recordClientsAudit = async () => {
          throw new Error("audit failed");
        };
        try {
          return await fn(tx);
        } finally {
          tx.recordClientsAudit = original;
        }
      });
    },
  };
  auditFailStore.provisionUser = (...args) => clientsService.provisionUser(auditFailStore, ...args);
  await assert.rejects(
    () =>
      auditFailStore.provisionUser(
        {
          firstName: "Rollback",
          lastName: "Audit",
          email: "rollback.audit@test.local",
          roleKey: "SCHOOL_ADMIN",
          countryCode: "BI",
          schoolCode: "BI-2026-0001",
        },
        superAdmin,
        auditMeta,
      ),
    /audit failed/,
  );
  assert.equal(
    store._tables.users.filter((row) => row.email === "rollback.audit@test.local").length,
    0,
    "rollback audit : aucune ligne users",
  );
  assert.equal(
    store._tables.userRoles.filter((row) => row.role_key === "SCHOOL_ADMIN" && row.status === "active").length,
    4,
    "rollback audit : aucun user_roles orphelin",
  );

  console.log("clientsUserProvision.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
