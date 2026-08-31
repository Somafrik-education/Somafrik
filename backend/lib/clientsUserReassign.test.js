"use strict";

const assert = require("node:assert/strict");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { CLIENTS_ERROR } = require("./clientsManagement");
const { USER_ROLE_ERROR } = require("./userRoleLifecycle");

function buildStore(seed = {}) {
  return createClientsMemoryStore({
    platformSchools: [
      { id: "school-cd", code: "CD-2026-0001", name: "Institut CD", countryId: "country-cd", countryCode: "CD", country: "RDC" },
      { id: "school-bi", code: "BI-2026-0001", name: "Ecole Kanyosha", countryId: "country-bi", countryCode: "BI", country: "Burundi" },
    ],
    users: [
      { id: "admin-cd", school_id: "school-cd", first_name: "Admin", last_name: "CD", email: "admin-cd@test.local", role: "SCHOOL_ADMIN", status: "active" },
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

async function createSchoolAdmin(store, principal, auditMeta, { firstName, lastName, email, schoolCode, countryCode }) {
  const created = await store.createUser(
    { firstName, lastName, email, schoolCode, countryCode },
    principal,
    auditMeta,
  );
  const granted = await store.grantUserRole(created.id, { role: "Admin School" }, principal, auditMeta);
  assert.ok((granted.roleKeys || []).includes("SCHOOL_ADMIN"));
  return granted;
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
  const schoolAdminCd = {
    sub: "admin-cd",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    countryCode: "CD",
    identifier: "admin-cd",
  };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "reassign-test" };

  const store = buildStore();
  const target = await createSchoolAdmin(store, superAdmin, auditMeta, {
    firstName: "Aline",
    lastName: "Ndayishimiye",
    email: "aline.kanyosha@test.local",
    schoolCode: "CD-2026-0001",
    countryCode: "CD",
  });
  assert.equal(target.schoolCode, "CD-2026-0001");
  const before = await store.getUserById(target.id);
  assert.equal(before.school_id, "school-cd");
  const beforeRole = store._tables.userRoles.find(
    (row) => row.user_id === target.id && row.role_key === "SCHOOL_ADMIN" && row.status === "active",
  );
  assert.equal(beforeRole?.school_id, "school-cd");

  store._tables.sessions.push({
    user_id: target.id,
    session_code: "sess-cd-1",
    revoked_at: null,
    expires_at: new Date(Date.now() + 86_400_000),
  });

  // Régression #222 : PATCH identité d'un utilisateur existant, sans changer le tenant → 200.
  const identityOnly = await store.updateUser(
    target.id,
    { firstName: "Aline-Edit" },
    superAdmin,
    auditMeta,
  );
  assert.equal(identityOnly.firstName, "Aline-Edit");
  assert.equal(identityOnly.schoolCode, "CD-2026-0001");
  assert.equal((await store.getUserById(target.id)).school_id, "school-cd");

  // A. PATCH identité n'écrit jamais users.school_id, même si schoolCode/countryCode sont envoyés.
  const patched = await store.updateUser(
    target.id,
    {
      firstName: "Aline-Maj",
      schoolCode: "BI-2026-0001",
      countryCode: "BI",
      countryScope: "Burundi",
    },
    superAdmin,
    auditMeta,
  );
  assert.equal(patched.firstName, "Aline-Maj");
  assert.equal(patched.schoolCode, "CD-2026-0001");
  const afterIgnored = await store.getUserById(target.id);
  assert.equal(afterIgnored.school_id, "school-cd");
  const afterIgnoredRole = store._tables.userRoles.find(
    (row) => row.user_id === target.id && row.role_key === "SCHOOL_ADMIN" && row.status === "active",
  );
  assert.equal(afterIgnoredRole?.school_id, "school-cd");
  assert.equal(parsePayloadSchool(afterIgnored.profile_payload).schoolCode, undefined);

  // Cause du toast préprod : GET hydrate userCode, le PATCH identité historique le renvoie.
  await expectRejection(
    store.updateUser(
      target.id,
      { firstName: "Aline", userCode: afterIgnored.user_code },
      superAdmin,
      auditMeta,
    ),
    { status: 400, code: USER_ROLE_ERROR.CLIENT_IDENTITY_FIELD_FORBIDDEN },
  );
  const stillCd = await store.getUserById(target.id);
  assert.equal(stillCd.school_id, "school-cd");

  await expectRejection(
    store.reassignUserSchool(target.id, { schoolCode: "BI-2026-0001", countryCode: "CD" }, superAdmin, auditMeta),
    { status: 409, code: CLIENTS_ERROR.SCHOOL_COUNTRY_MISMATCH },
  );
  assert.equal((await store.getUserById(target.id)).school_id, "school-cd");

  await expectRejection(
    store.reassignUserSchool(target.id, { schoolCode: "BI-2026-0001" }, schoolAdminCd, auditMeta),
    { status: 403, code: CLIENTS_ERROR.USER_TENANT_REASSIGN_FORBIDDEN },
  );

  await expectRejection(
    store.reassignUserSchool(target.id, { schoolCode: "BI-2026-0001" }, countryAdmin, auditMeta),
    { status: 403, code: CLIENTS_ERROR.TENANT_MISMATCH },
  );

  const reassigned = await store.reassignUserSchool(
    target.id,
    { schoolCode: "BI-2026-0001", countryCode: "BI" },
    superAdmin,
    auditMeta,
  );
  assert.equal(reassigned.schoolCode, "BI-2026-0001");
  assert.equal(reassigned.countryCode, "BI");
  const after = await store.getUserById(target.id);
  assert.equal(after.school_id, "school-bi");
  const afterRole = store._tables.userRoles.find(
    (row) => row.user_id === target.id && row.role_key === "SCHOOL_ADMIN" && row.status === "active",
  );
  assert.equal(afterRole?.school_id, "school-bi");
  assert.equal(String(after.school_id), String(afterRole.school_id));
  const session = store._tables.sessions.find((row) => row.session_code === "sess-cd-1");
  assert.ok(session?.revoked_at, "session ancienne révoquée");
  assert.equal(session.revoke_reason, "tenant_reassign");
  const audit = store.getAuditLog().find((entry) => entry.action === "reassign_user_school");
  assert.ok(audit, "audit before/after obligatoire");
  assert.equal(audit.oldValue?.schoolCode, "CD-2026-0001");
  assert.equal(audit.newValue?.schoolCode, "BI-2026-0001");
  assert.equal(parsePayloadSchool(after.profile_payload).schoolCode, undefined);
  assert.equal(parsePayloadSchool(after.profile_payload).countryCode, undefined);

  await expectRejection(
    store.reassignUserSchool(target.id, { schoolCode: "BI-2026-0001", countryCode: "BI" }, superAdmin, auditMeta),
    { status: 409, code: CLIENTS_ERROR.CONFLICT },
  );

  const countryIdentity = await store.createUser(
    {
      firstName: "Amina",
      lastName: "Pays",
      email: "amina.pays@test.local",
      countryCode: "CD",
      countryScope: "RDC",
    },
    superAdmin,
    auditMeta,
  );
  await store.grantUserRole(countryIdentity.id, { role: "Admin Pays" }, superAdmin, auditMeta);
  await expectRejection(
    store.reassignUserSchool(countryIdentity.id, { schoolCode: "BI-2026-0001" }, superAdmin, auditMeta),
    { status: 409, code: CLIENTS_ERROR.ROLE_SCOPE_CONFLICT },
  );

  const rollbackStore = buildStore();
  const rollbackUser = await createSchoolAdmin(rollbackStore, superAdmin, auditMeta, {
    firstName: "Rollback",
    lastName: "Case",
    email: "rollback.case@test.local",
    schoolCode: "CD-2026-0001",
    countryCode: "CD",
  });
  rollbackStore._tables.sessions.push({
    user_id: rollbackUser.id,
    session_code: "sess-rollback",
    revoked_at: null,
    expires_at: new Date(Date.now() + 86_400_000),
  });
  const inner = rollbackStore.withTransaction.bind(rollbackStore);
  rollbackStore.withTransaction = (fn) =>
    inner(async (tx) => {
      const original = tx.recordClientsAudit.bind(tx);
      tx.recordClientsAudit = async (entry) => {
        if (entry.action === "reassign_user_school") {
          throw new Error("audit failed");
        }
        return original(entry);
      };
      return fn(tx);
    });
  try {
    await rollbackStore.reassignUserSchool(
      rollbackUser.id,
      { schoolCode: "BI-2026-0001", countryCode: "BI" },
      superAdmin,
      auditMeta,
    );
    throw new Error("Expected audit failure");
  } catch (error) {
    assert.equal(error.message, "audit failed");
  }
  const rolled = await rollbackStore.getUserById(rollbackUser.id);
  assert.equal(rolled.school_id, "school-cd");
  const rolledRole = rollbackStore._tables.userRoles.find(
    (row) => row.user_id === rollbackUser.id && row.role_key === "SCHOOL_ADMIN" && row.status === "active",
  );
  assert.equal(rolledRole?.school_id, "school-cd");
  const rolledSession = rollbackStore._tables.sessions.find((row) => row.session_code === "sess-rollback");
  assert.equal(rolledSession?.revoked_at, null);
  assert.equal(
    rollbackStore.getAuditLog().some((entry) => entry.action === "reassign_user_school"),
    false,
  );

  const biAdmin = {
    sub: target.id,
    role: "Admin School",
    schoolCode: "BI-2026-0001",
    countryCode: "BI",
    identifier: "admin-bi",
  };
  const cdVictim = await store.createUser(
    {
      firstName: "Victim",
      lastName: "CD",
      email: "victim.stay.cd@test.local",
      schoolCode: "CD-2026-0001",
    },
    superAdmin,
    auditMeta,
  );
  await expectRejection(
    store.updateUser(cdVictim.id, { firstName: "Hacked" }, biAdmin, auditMeta),
    { status: 403, code: CLIENTS_ERROR.TENANT_MISMATCH },
  );

  console.log("clientsUserReassign.test.js OK");
}

function parsePayloadSchool(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
