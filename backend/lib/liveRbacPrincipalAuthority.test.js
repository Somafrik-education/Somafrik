"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  LIVE_RBAC_EMPTY_ROLE,
  listAuthoritativeRoleKeys,
  repositoryWithAuthoritativeRoleKeys,
  failClosedLegacyResolution,
} = require("./liveRbacPrincipalAuthority");

test("F6: une session établissement charge uniquement les rôles actifs de ce tenant", async () => {
  const calls = [];
  const repo = {
    async getSchoolByCode(code) {
      calls.push(["school", code]);
      return { id: "school-a", school_code: code };
    },
    async listActiveUserRoleKeysForSchool(userId, schoolId) {
      calls.push(["roles", userId, schoolId]);
      return ["ACCOUNTANT"];
    },
    async listActiveUserRoleKeys() {
      throw new Error("le lookup global ne doit pas être utilisé pour une session école");
    },
  };
  const roles = await listAuthoritativeRoleKeys(repo, {
    sub: "user-1",
    schoolCode: "CD-KIN-001",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
  });
  assert.deepEqual(roles, ["ACCOUNTANT"]);
  assert.deepEqual(calls, [
    ["school", "CD-KIN-001"],
    ["roles", "user-1", "school-a"],
  ]);
});

test("F6: JWT overlay teachers.id résout users.id avant le lookup tenant, sans claims JWT", async () => {
  const calls = [];
  const repo = {
    async getSchoolByCode(code) {
      return { id: "school-a", school_code: code };
    },
    async resolveCanonicalUserIdForSchool(ref, schoolId) {
      calls.push(["canonical", ref, schoolId]);
      assert.equal(ref, "teacher-row-id");
      return "user-1";
    },
    async listActiveUserRoleKeysForSchool(userId, schoolId) {
      calls.push(["roles", userId, schoolId]);
      return ["TEACHER"];
    },
    async listActiveUserRoleKeys() {
      throw new Error("le lookup global ne doit pas être utilisé pour une session école");
    },
  };
  const roles = await listAuthoritativeRoleKeys(repo, {
    sub: "teacher-row-id",
    schoolCode: "CD-KIN-001",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["ALL_PRIVILEGES"],
  });
  assert.deepEqual(roles, ["TEACHER"]);
  assert.deepEqual(calls, [
    ["canonical", "teacher-row-id", "school-a"],
    ["roles", "user-1", "school-a"],
  ]);
});

test("F6: zéro rôle PostgreSQL est un DENY autoritaire, jamais un fallback JWT", async () => {
  const repo = {
    async getSchoolByCode() {
      return { id: "school-a" };
    },
    async listActiveUserRoleKeysForSchool() {
      return [];
    },
  };
  const roles = await listAuthoritativeRoleKeys(repo, {
    sub: "user-1",
    schoolCode: "CD-KIN-001",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["ALL_PRIVILEGES", "Paiements:UPDATE"],
  });
  assert.deepEqual(roles, []);

  const scoped = repositoryWithAuthoritativeRoleKeys({}, roles);
  assert.deepEqual(await scoped.listActiveUserRoleKeys("user-1"), [LIVE_RBAC_EMPTY_ROLE]);
});

test("F6: établissement introuvable ou primitive tenant absente => aucun rôle", async () => {
  assert.deepEqual(
    await listAuthoritativeRoleKeys(
      { async getSchoolByCode() { return null; }, async listActiveUserRoleKeysForSchool() { return ["ACCOUNTANT"]; } },
      { sub: "user-1", schoolCode: "UNKNOWN" },
    ),
    [],
  );
  assert.deepEqual(
    await listAuthoritativeRoleKeys(
      { async listActiveUserRoleKeys() { return ["ACCOUNTANT"]; } },
      { sub: "user-1", schoolCode: "CD-KIN-001" },
    ),
    [],
  );
});

test("F6: un fallback legacy de permissions est neutralisé", () => {
  assert.deepEqual(
    failClosedLegacyResolution(
      {
        roleKeys: ["ACCOUNTANT"],
        permissions: ["Paiements:READ", "Paiements:UPDATE"],
        modules: { payments: { canRead: true, canUpdate: true } },
        source: "role_module_permissions+legacy-role-fallback",
      },
      ["ACCOUNTANT"],
    ).permissions,
    [],
  );

  const live = {
    roleKeys: ["ACCOUNTANT"],
    permissions: ["Paiements:READ"],
    modules: { payments: { canRead: true } },
    source: "role_module_permissions",
  };
  assert.equal(failClosedLegacyResolution(live, ["ACCOUNTANT"]), live);
});
