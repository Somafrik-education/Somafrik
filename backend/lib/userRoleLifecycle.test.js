"use strict";

const assert = require("node:assert/strict");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { toIsoDate } = require("./clientsManagement");
const {
  USER_ROLE_ERROR,
  displayRoles,
  sortRoleLabelsByPrivilege,
  assertNoClientPrivilegeKeys,
  FORBIDDEN_CREATE_KEYS,
} = require("./userRoleLifecycle");

function storedPrimaryRole(store, userId) {
  const row = store._tables.users.find((user) => user.id === userId);
  return row?.role ?? null;
}

function buildStore() {
  return createClientsMemoryStore({
    platformSchools: [
      { id: "school-cd", code: "CD-2026-0001", name: "CD", countryId: "country-cd", countryCode: "CD" },
      { id: "school-bi", code: "BI-2026-0001", name: "BI", countryId: "country-bi", countryCode: "BI" },
    ],
    users: [
      { id: "admin-cd", school_id: "school-cd", first_name: "Admin", last_name: "CD", email: "admin-cd@test.local", role: "SCHOOL_ADMIN", status: "active" },
      { id: "admin-bi", school_id: "school-bi", first_name: "Admin", last_name: "BI", email: "admin-bi@test.local", role: "SCHOOL_ADMIN", status: "active" },
    ],
    students: [
      { id: "student-cd", school_id: "school-cd", first_name: "Jean", last_name: "CD", studentCode: "STU-CD" },
    ],
  });
}

async function expectRejection(promise, { status, code }) {
  try {
    await promise;
    throw new Error(`Expected rejection ${code}`);
  } catch (error) {
    assert.equal(error.statusCode, status, error.message);
    if (code) assert.equal(error.code, code, error.message);
  }
}

async function main() {
  const pgDate = new Date("1990-05-01T00:00:00.000Z");
  assert.notEqual(String(pgDate).slice(0, 10), "1990-05-01");
  assert.equal(toIsoDate(pgDate), "1990-05-01");

  assert.deepEqual(sortRoleLabelsByPrivilege(["Enseignant", "Préfet des études", "Secrétaire"]), [
    "Préfet des études",
    "Secrétaire",
    "Enseignant",
  ]);
  assert.equal(displayRoles([]).assignmentStatus, "Sans affectation");
  assert.throws(
    () => assertNoClientPrivilegeKeys({ id: "client-id" }, FORBIDDEN_CREATE_KEYS, USER_ROLE_ERROR.ROLE_NOT_ALLOWED_ON_CREATE),
    (error) => error.code === USER_ROLE_ERROR.CLIENT_IDENTITY_FIELD_FORBIDDEN,
  );

  const store = buildStore();
  const schoolAdmin = { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
  const biAdmin = { sub: "admin-bi", role: "Admin School", schoolCode: "BI-2026-0001", identifier: "admin-bi" };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "lifecycle-test" };

  const created = await store.createUser(
    { firstName: "Marie", lastName: "Kabeya", email: "marie.kabeya@test.local", phone: "+243900111000" },
    schoolAdmin,
    auditMeta,
  );
  assert.match(created.id, /^[0-9a-f-]{36}$/i);
  assert.match(created.publicId, /^USR-\d{4}-\d{5}$/);
  assert.equal(created.assignmentStatus, "Sans affectation");
  assert.deepEqual(created.roleKeys, []);
  assert.equal(storedPrimaryRole(store, created.id), null);
  assert.ok(store.getAuditLog().some((row) => row.action === "create_user"));

  await expectRejection(
    store.createUser({ firstName: "A", lastName: "B", id: "forged" }, schoolAdmin, auditMeta),
    { status: 400, code: USER_ROLE_ERROR.CLIENT_IDENTITY_FIELD_FORBIDDEN },
  );
  await expectRejection(
    store.createUser({ firstName: "A", lastName: "B", user_code: "USR-1999-00001" }, schoolAdmin, auditMeta),
    { status: 400, code: USER_ROLE_ERROR.CLIENT_IDENTITY_FIELD_FORBIDDEN },
  );
  await expectRejection(
    store.createUser({ firstName: "A", lastName: "B", role: "Secrétaire" }, schoolAdmin, auditMeta),
    { status: 400, code: USER_ROLE_ERROR.ROLE_NOT_ALLOWED_ON_CREATE },
  );
  await expectRejection(
    store.createUser({ firstName: "A", lastName: "B", roles: ["Secrétaire"] }, schoolAdmin, auditMeta),
    { status: 400, code: USER_ROLE_ERROR.ROLE_NOT_ALLOWED_ON_CREATE },
  );

  const granted = await store.grantUserRole(created.id, { role: "Secrétaire" }, schoolAdmin, auditMeta);
  assert.deepEqual(granted.roleKeys, ["SECRETARY"]);
  assert.equal(storedPrimaryRole(store, created.id), "SECRETARY");
  assert.ok(store.getAuditLog().some((row) => row.action === "grant_role" && row.newValue?.operation === "GRANT"));

  const multi = await store.grantUserRole(created.id, { role: "Enseignant" }, schoolAdmin, auditMeta);
  assert.deepEqual(multi.roleKeys, ["SECRETARY", "TEACHER"]);
  assert.equal(multi.roles[0], "Secrétaire");
  assert.equal(storedPrimaryRole(store, created.id), "SECRETARY");
  assert.ok(store._tables.teachers.some((row) => row.user_id === created.id));

  await expectRejection(
    store.grantUserRole(created.id, { role: "Secrétaire" }, schoolAdmin, auditMeta),
    { status: 409, code: USER_ROLE_ERROR.ROLE_ALREADY_GRANTED },
  );
  await expectRejection(
    store.grantUserRole(created.id, { roles: ["Comptable"] }, schoolAdmin, auditMeta),
    { status: 400, code: USER_ROLE_ERROR.REPLACE_ROLES_FORBIDDEN },
  );
  await expectRejection(
    store.grantUserRole(created.id, { role: "Parent" }, schoolAdmin, auditMeta),
    { status: 403, code: USER_ROLE_ERROR.PARENT_ROLE_FORBIDDEN },
  );
  await expectRejection(
    store.grantUserRole(created.id, { role: "STUDENT" }, schoolAdmin, auditMeta),
    { status: 403, code: USER_ROLE_ERROR.STUDENT_ROLE_FORBIDDEN },
  );
  await expectRejection(
    store.grantUserRole(created.id, { role: "Super Administrateur Somafrik" }, schoolAdmin, auditMeta),
    { status: 403, code: USER_ROLE_ERROR.PLATFORM_ROLE_FORBIDDEN },
  );
  await expectRejection(
    store.grantUserRole(created.id, { role: "InconnuXYZ" }, schoolAdmin, auditMeta),
    { status: 400, code: USER_ROLE_ERROR.ROLE_UNKNOWN },
  );
  await expectRejection(
    store.grantUserRole(created.id, { role: "Comptable" }, { ...schoolAdmin, sub: created.id }, auditMeta),
    { status: 403, code: USER_ROLE_ERROR.AUTO_GRANT_FORBIDDEN },
  );
  await expectRejection(
    store.grantUserRole(created.id, { role: "Comptable" }, biAdmin, auditMeta),
    { status: 403, code: "TENANT_MISMATCH" },
  );

  const revoked = await store.revokeUserRole(created.id, { role: "Secrétaire" }, schoolAdmin, auditMeta);
  assert.deepEqual(revoked.roleKeys, ["TEACHER"]);
  assert.equal(storedPrimaryRole(store, created.id), "TEACHER");
  assert.ok(store.getAuditLog().some((row) => row.action === "revoke_role" && row.oldValue?.operation === "REVOKE"));

  const last = await store.revokeUserRole(created.id, { role: "Enseignant" }, schoolAdmin, auditMeta);
  assert.deepEqual(last.roleKeys, []);
  assert.equal(last.assignmentStatus, "Sans affectation");
  assert.equal(storedPrimaryRole(store, created.id), null);
  assert.equal(store._tables.teachers.find((row) => row.user_id === created.id)?.status, "inactive");

  const regranted = await store.grantUserRole(created.id, { role: "Enseignant" }, schoolAdmin, auditMeta);
  assert.deepEqual(regranted.roleKeys, ["TEACHER"]);
  assert.equal(storedPrimaryRole(store, created.id), "TEACHER");
  assert.equal(store._tables.teachers.filter((row) => row.user_id === created.id).length, 1);

  const contact = await store.createContact(
    {
      firstName: "Marie",
      lastName: "Kabeya",
      contactType: "Parent",
      phone: "+243900111000",
      email: "marie.kabeya@test.local",
      schoolCode: "CD-2026-0001",
    },
    schoolAdmin,
    auditMeta,
  );
  const provisioned = await store.provisionContactAccount(
    contact.id,
    { role: "Parent", studentId: "student-cd" },
    schoolAdmin,
    auditMeta,
  );
  assert.equal(provisioned.reused, true);
  assert.equal(provisioned.user.id, created.id);
  assert.equal(store.listProjection().users.filter((row) => row.email === "marie.kabeya@test.local").length, 1);

  const [raceA, raceB] = await Promise.allSettled([
    store.grantUserRole(created.id, { role: "Comptable" }, schoolAdmin, auditMeta),
    store.grantUserRole(created.id, { role: "Comptable" }, schoolAdmin, auditMeta),
  ]);
  const fulfilled = [raceA, raceB].filter((item) => item.status === "fulfilled");
  const rejected = [raceA, raceB].filter((item) => item.status === "rejected");
  assert.equal(fulfilled.length, 1, "un seul GRANT concurrent réussit");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, USER_ROLE_ERROR.ROLE_ALREADY_GRANTED);

  const [createA, createB] = await Promise.all([
    store.createUser({ firstName: "A", lastName: "Un", email: "a.un@test.local" }, schoolAdmin, auditMeta),
    store.createUser({ firstName: "B", lastName: "Deux", email: "b.deux@test.local" }, schoolAdmin, auditMeta),
  ]);
  assert.notEqual(createA.id, createB.id);
  assert.notEqual(createA.publicId, createB.publicId);

  console.log("userRoleLifecycle.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
