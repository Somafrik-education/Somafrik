"use strict";

const assert = require("node:assert/strict");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { CLIENTS_ERROR } = require("./clientsManagement");

function buildStore() {
  return createClientsMemoryStore({
    platformSchools: [
      { id: "school-cd", code: "CD-IC-26-001", loginCode: "CD-IC-26-001", login_code: "CD-IC-26-001", name: "Institut CD", countryId: "country-cd", countryCode: "CD", country: "RDC" },
      { id: "school-bi", code: "BI-IB-26-001", loginCode: "BI-IB-26-001", login_code: "BI-IB-26-001", name: "Institut BI", countryId: "country-bi", countryCode: "BI", country: "Burundi" },
    ],
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
  const store = buildStore();
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
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "tenant-scope-test" };

  const nominal = await store.createUser(
    {
      firstName: "Grace",
      lastName: "Ndayishimiye",
      email: "grace.bi@test.local",
      schoolCode: "BI-IB-26-001",
      countryCode: "BI",
    },
    superAdmin,
    auditMeta,
  );
  assert.equal(nominal.schoolCode, "BI-IB-26-001");
  assert.equal(nominal.countryCode, "BI");
  const granted = await store.grantUserRole(nominal.id, { role: "Admin School" }, superAdmin, auditMeta);
  assert.ok((granted.roleKeys || []).includes("SCHOOL_ADMIN"));
  const roleRow = store._tables.userRoles.find(
    (row) => row.user_id === nominal.id && row.role_key === "SCHOOL_ADMIN" && row.status === "active",
  );
  assert.equal(roleRow?.school_id, "school-bi");
  const persisted = await store.getUserById(nominal.id);
  assert.equal(persisted.school_id, "school-bi");
  assert.equal(persisted.country_code, "BI");

  await expectRejection(
    store.createUser(
      {
        firstName: "Wrong",
        lastName: "Tenant",
        email: "wrong.tenant@test.local",
        schoolCode: "CD-IC-26-001",
        countryCode: "BI",
      },
      superAdmin,
      auditMeta,
    ),
    { status: 409, code: CLIENTS_ERROR.SCHOOL_COUNTRY_MISMATCH },
  );

  const unscoped = await store.createUser(
    {
      firstName: "Global",
      lastName: "Identity",
      email: "global.identity@test.local",
      countryCode: "BI",
    },
    superAdmin,
    auditMeta,
  );
  const unscopedRow = await store.getUserById(unscoped.id);
  assert.equal(unscoped.schoolId ?? unscopedRow.school_id ?? null, null);
  assert.notEqual(unscopedRow.country_code, "CD");
  await expectRejection(
    store.grantUserRole(unscoped.id, { role: "Admin School" }, superAdmin, auditMeta),
    { status: 400, code: CLIENTS_ERROR.INVALID_TENANT_SCOPE },
  );

  const countryIdentity = await store.createUser(
    {
      firstName: "Amina",
      lastName: "Pays",
      email: "amina.pays@test.local",
      countryCode: "BI",
      countryScope: "BI",
    },
    superAdmin,
    auditMeta,
  );
  const countryGranted = await store.grantUserRole(
    countryIdentity.id,
    { role: "Admin Pays" },
    superAdmin,
    auditMeta,
  );
  assert.ok((countryGranted.roleKeys || []).includes("COUNTRY_ADMIN"));

  await expectRejection(
    store.createUser(
      {
        firstName: "No",
        lastName: "School",
        email: "country.noschool@test.local",
      },
      countryAdmin,
      auditMeta,
    ),
    { status: 400, code: CLIENTS_ERROR.INVALID_TENANT_SCOPE },
  );

  const countryScoped = await store.createUser(
    {
      firstName: "Patrick",
      lastName: "School",
      email: "patrick.school@test.local",
      schoolCode: "CD-IC-26-001",
    },
    countryAdmin,
    auditMeta,
  );
  assert.equal(countryScoped.schoolCode, "CD-IC-26-001");

  const biAdmin = {
    sub: nominal.id,
    role: "Admin School",
    schoolCode: "BI-IB-26-001",
    countryCode: "BI",
    identifier: "admin-bi",
  };
  const ignoredCdPayload = await store.createUser(
    {
      firstName: "Kept",
      lastName: "Burundi",
      email: "kept.bi@test.local",
      schoolCode: "CD-IC-26-001",
    },
    biAdmin,
    auditMeta,
  );
  assert.equal(ignoredCdPayload.schoolCode, "BI-IB-26-001");
  assert.notEqual(ignoredCdPayload.schoolCode, "CD-IC-26-001");

  const cdVictim = await store.createUser(
    {
      firstName: "Victim",
      lastName: "CD",
      email: "victim.cd@test.local",
      schoolCode: "CD-IC-26-001",
    },
    superAdmin,
    auditMeta,
  );
  await expectRejection(
    store.updateUser(cdVictim.id, { firstName: "Hacked" }, biAdmin, auditMeta),
    { status: 403, code: CLIENTS_ERROR.TENANT_MISMATCH },
  );

  console.log("clientsTenantScope.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
