"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { CLIENTS_ERROR } = require("./clientsManagement");
const { resolveCreateUserTenant } = require("./clientsUserCreateTenant");

function buildStore() {
  return createClientsMemoryStore({
    platformSchools: [
      {
        id: "school-cd",
        code: "CD-2026-0001",
        login_code: "CD-SY-26-001",
        name: "Institut CD",
        countryId: "country-cd",
        countryCode: "CD",
      },
      {
        id: "school-bi",
        code: "BI-2026-0001",
        login_code: "BI-SY-26-002",
        name: "Institut BI",
        countryId: "country-bi",
        countryCode: "BI",
      },
    ],
    users: [
      {
        id: "admin-cd",
        school_id: "school-cd",
        first_name: "Admin",
        last_name: "CD",
        email: "admin-cd@test.local",
        role: "SCHOOL_ADMIN",
        status: "active",
      },
      {
        id: "admin-bi",
        school_id: "school-bi",
        first_name: "Admin",
        last_name: "BI",
        email: "admin-bi@test.local",
        role: "SCHOOL_ADMIN",
        status: "active",
      },
    ],
  });
}

test("createUser établissement : leftover JWT + membership → login_code", async () => {
  const store = buildStore();
  const resolved = await resolveCreateUserTenant(
    store,
    { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001" },
    {},
  );
  assert.equal(resolved.school.id, "school-cd");
  assert.equal(resolved.schoolCode, "CD-SY-26-001");
  assert.notEqual(resolved.schoolCode, "CD-2026-0001");
});

test("createUser établissement : payload leftover ignoré, pas d'usurpation", async () => {
  const store = buildStore();
  const resolved = await resolveCreateUserTenant(
    store,
    { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001" },
    { schoolCode: "CD-2026-0001" },
  );
  assert.equal(resolved.school.id, "school-cd");
  assert.equal(resolved.schoolCode, "CD-SY-26-001");
});

test("createUser établissement : leftover d'un autre tenant ignoré", async () => {
  const store = buildStore();
  const resolved = await resolveCreateUserTenant(
    store,
    { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001" },
    { schoolCode: "BI-2026-0001" },
  );
  assert.equal(resolved.school.id, "school-cd");
  assert.equal(resolved.schoolCode, "CD-SY-26-001");
});

test("createUser Superadmin : leftover body toujours résolu via getSchoolByCode", async () => {
  const store = buildStore();
  const resolved = await resolveCreateUserTenant(
    store,
    { sub: "super", role: "Super Administrateur Somafrik", schoolCode: "*" },
    { schoolCode: "CD-2026-0001" },
  );
  assert.equal(resolved.school.id, "school-cd");
});

test("createUser établissement : payload login_code d'un autre tenant refusé", async () => {
  const store = buildStore();
  await assert.rejects(
    () =>
      resolveCreateUserTenant(
        store,
        { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001" },
        { schoolCode: "BI-SY-26-002" },
      ),
    (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.TENANT_MISMATCH,
  );
});

test("createUser établissement : country_iso membership → country_code", async () => {
  const store = buildStore();
  store.getSchoolForPrincipalUser = async () => ({
    id: "school-cd",
    login_code: "CD-SY-26-001",
    country_iso: "CD",
  });
  const resolved = await resolveCreateUserTenant(
    store,
    { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001" },
    { countryCode: "CD" },
  );
  assert.equal(resolved.school.country_code, "CD");
  assert.equal(resolved.schoolCode, "CD-SY-26-001");
});

test("createUser établissement : sans membership → 404 TENANT_MISMATCH", async () => {
  const store = buildStore();
  await assert.rejects(
    () =>
      resolveCreateUserTenant(
        store,
        { sub: "unknown", role: "Admin School", schoolCode: "CD-2026-0001" },
        {},
      ),
    (error) => error.statusCode === 404 && error.code === CLIENTS_ERROR.TENANT_MISMATCH,
  );
});
