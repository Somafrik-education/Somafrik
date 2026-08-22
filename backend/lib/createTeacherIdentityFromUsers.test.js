"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { USER_ROLE_ERROR } = require("./userRoleLifecycle");
const { toIsoDate } = require("./clientsManagement");
const { createTeacherIdentityFromUsers } = require("./createTeacherIdentityFromUsers");

function memoryRepository(store) {
  return {
    getClientsStore: () => store,
    createTransactionalClientsStore: () => store,
    withTransaction: (fn) => store.withTransaction(() => fn(null)),
  };
}

test("createTeacherIdentityFromUsers : Users puis GRANT Enseignant, secret remis", async () => {
  const calls = [];
  const store = {
    async createUser(payload) {
      calls.push(["create", payload]);
      return {
        id: "user-1",
        publicId: "USR-2026-00099",
        identifier: "USR-2026-00099",
        temporaryPassword: "TempPass12",
      };
    },
    async grantUserRole(userId, payload) {
      calls.push(["grant", userId, payload]);
      return { id: userId, publicId: "USR-2026-00099", roleKeys: ["TEACHER"] };
    },
  };
  const repository = {
    async withTransaction(fn) {
      return fn({});
    },
    createTransactionalClientsStore() {
      return store;
    },
  };

  const result = await createTeacherIdentityFromUsers(
    repository,
    { firstName: "Fatou", lastName: "Sow" },
    { role: "Admin School" },
    {},
  );

  assert.deepEqual(calls[0], ["create", { firstName: "Fatou", lastName: "Sow" }]);
  assert.deepEqual(calls[1], ["grant", "user-1", { role: "Enseignant" }]);
  assert.equal(result.credentials.login, "USR-2026-00099");
  assert.equal(result.credentials.temporarySecret, "TempPass12");
  assert.deepEqual(result.user.roleKeys, ["TEACHER"]);
});

test("createTeacherIdentityFromUsers : secret absent => 500, pas de succès inventé", async () => {
  const store = {
    async createUser() {
      return { id: "user-3", publicId: "USR-2026-00101" };
    },
    async grantUserRole(userId) {
      return { id: userId, publicId: "USR-2026-00101", roleKeys: ["TEACHER"] };
    },
  };
  const repository = {
    async withTransaction(fn) {
      return fn({});
    },
    createTransactionalClientsStore() {
      return store;
    },
  };
  await assert.rejects(
    () => createTeacherIdentityFromUsers(repository, {}, {}, {}),
    /secret temporaire du compte enseignant/,
  );
});

test("createTeacherIdentityFromUsers : GRANT échoué rollback, pas d'état partiel", async () => {
  const users = [];
  const store = {
    async createUser() {
      const user = { id: "user-2", publicId: "USR-2026-00100", temporaryPassword: "TempPass12" };
      users.push(user);
      return user;
    },
    async grantUserRole() {
      throw new Error("Identité enseignant ambiguë.");
    },
  };
  const repository = {
    async withTransaction(fn) {
      const snapshot = users.map((row) => ({ ...row }));
      try {
        return await fn({});
      } catch (error) {
        users.splice(0, users.length, ...snapshot);
        throw error;
      }
    },
    createTransactionalClientsStore() {
      return store;
    },
  };
  await assert.rejects(
    () => createTeacherIdentityFromUsers(repository, {}, {}, {}),
    /Identité enseignant ambiguë/,
  );
  assert.equal(users.length, 0, "rollback : aucune ligne users");
});

test("createTeacherIdentityFromUsers mémoire : TEACHER_PROFILE_AMBIGUOUS rollback total", async () => {
  const store = createClientsMemoryStore({
    platformSchools: [
      { id: "school-cd", code: "CD-2026-0001", school_code: "CD-2026-0001", name: "CD", countryCode: "CD" },
    ],
  });
  const repository = memoryRepository(store);
  const principal = { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "memory-atomic" };
  const civil = {
    firstName: "Awa",
    lastName: "Ndiaye",
    birthDate: "1990-05-01",
    gender: "F",
  };

  await createTeacherIdentityFromUsers(
    repository,
    { ...civil, email: "awa.one@test.local", phone: "+243811000001", temporaryPassword: "TempPass12" },
    principal,
    auditMeta,
  );

  const usersBefore = store._tables.users.length;
  const rolesBefore = store._tables.userRoles.length;
  const teachersBefore = store._tables.teachers.length;
  const auditsBefore = store.getAuditLog().length;

  await assert.rejects(
    () =>
      createTeacherIdentityFromUsers(
        repository,
        { ...civil, email: "awa.two@test.local", phone: "+243811000002", temporaryPassword: "TempPass12" },
        principal,
        auditMeta,
      ),
    (error) => error.code === USER_ROLE_ERROR.TEACHER_PROFILE_AMBIGUOUS,
  );

  assert.equal(store._tables.users.length, usersBefore, "rollback users");
  assert.equal(store._tables.userRoles.length, rolesBefore, "rollback user_roles");
  assert.equal(store._tables.teachers.length, teachersBefore, "rollback teachers");
  assert.equal(store.getAuditLog().length, auditsBefore, "rollback audit_logs");
  assert.equal(
    store._tables.users.some((row) => row.email === "awa.two@test.local"),
    false,
  );
});

test("toIsoDate : Date JS pg-like → YYYY-MM-DD (régression TEACHER_PROFILE_AMBIGUOUS)", () => {
  const pgDate = new Date("1990-05-01T00:00:00.000Z");
  assert.notEqual(String(pgDate).slice(0, 10), "1990-05-01");
  assert.equal(toIsoDate(pgDate), "1990-05-01");
  assert.equal(toIsoDate(new Date("invalid")), null);
});

test("GRANT Enseignant : birth_date Date JS détecte TEACHER_PROFILE_AMBIGUOUS", async () => {
  const store = createClientsMemoryStore({
    platformSchools: [
      { id: "school-cd", code: "CD-2026-0001", school_code: "CD-2026-0001", name: "CD", countryCode: "CD" },
    ],
  });
  const repository = memoryRepository(store);
  const principal = { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "memory-pg-date" };
  const civil = {
    firstName: "Awa",
    lastName: "Ndiaye",
    birthDate: "1990-05-01",
    gender: "F",
  };

  await createTeacherIdentityFromUsers(
    repository,
    { ...civil, email: "awa.one@test.local", phone: "+243811000001", temporaryPassword: "TempPass12" },
    principal,
    auditMeta,
  );

  const second = await store.createUser(
    { ...civil, email: "awa.two@test.local", phone: "+243811000002", temporaryPassword: "TempPass12" },
    principal,
    auditMeta,
  );
  const row = store._tables.users.find((user) => user.id === second.id);
  assert.ok(row);
  row.birth_date = new Date("1990-05-01T00:00:00.000Z");
  assert.notEqual(String(row.birth_date).slice(0, 10), "1990-05-01");

  const teachersBefore = store._tables.teachers.length;
  const rolesBefore = store._tables.userRoles.length;

  await assert.rejects(
    () => store.grantUserRole(second.id, { role: "Enseignant" }, principal, auditMeta),
    (error) => error.code === USER_ROLE_ERROR.TEACHER_PROFILE_AMBIGUOUS,
  );

  assert.equal(store._tables.teachers.length, teachersBefore);
  assert.equal(store._tables.userRoles.length, rolesBefore);
});

test("createTeacherIdentityFromUsers : une transaction, pas createClientsUser hors scope", () => {
  const source = fs
    .readFileSync(path.join(__dirname, "createTeacherIdentityFromUsers.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.match(source, /createTransactionalClientsStore/);
  assert.match(source, /withTransaction/);
  assert.doesNotMatch(source, /createClientsUser/);
  assert.doesNotMatch(source, /grantClientsUserRole/);
  assert.doesNotMatch(source, /sans rôle Enseignant/);

  const lifecycle = fs.readFileSync(path.join(__dirname, "userRoleLifecycleService.js"), "utf8");
  assert.match(lifecycle, /toIsoDate\(user\.birth_date\)/);
  assert.doesNotMatch(lifecycle, /String\(user\.birth_date\)\.slice\(0,\s*10\)/);
});
