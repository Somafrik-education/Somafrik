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

test("createUser établissement : membership user_roles si users row absente (seed mémoire)", async () => {
  const store = buildStore();
  store._tables.userRoles.push({
    user_id: "USER-ADMIN1",
    school_id: "school-cd",
    role_key: "SCHOOL_ADMIN",
    status: "active",
    revoked_at: null,
  });
  const resolved = await resolveCreateUserTenant(
    store,
    { sub: "USER-ADMIN1", role: "Admin School", schoolCode: "CD-2026-0001" },
    {},
  );
  assert.equal(resolved.school.id, "school-cd");
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
