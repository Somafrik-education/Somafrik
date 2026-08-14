"use strict";

const assert = require("node:assert/strict");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { CLIENTS_ERROR, parsePayload } = require("./clientsManagement");
const { TEACHER_ACCOUNT_ENTRY_ERROR } = require("./clientsRolePolicy");

function buildStore() {
  return createClientsMemoryStore({
    platformSchools: [
      { id: "school-cd", code: "CD-2026-0001", name: "CD", countryId: "country-cd", countryCode: "CD" },
      { id: "school-bi", code: "BI-2026-0001", name: "BI", countryId: "country-bi", countryCode: "BI" },
    ],
    students: [
      { id: "student-cd", school_id: "school-cd", first_name: "Jean", last_name: "CD", studentCode: "STU-CD" },
      { id: "student-bi", school_id: "school-bi", first_name: "Eric", last_name: "BI", studentCode: "STU-BI" },
    ],
  });
}

async function expectRejection(promise, { status, code }) {
  try {
    await promise;
    throw new Error("Expected rejection");
  } catch (error) {
    assert.equal(error.statusCode, status, error.message);
    if (code) {
      assert.equal(error.code, code, error.message);
    }
  }
}

async function main() {
  const store = buildStore();
  const schoolAdmin = { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
  const countryAdmin = { sub: "admin-pays", role: "Admin Pays", countryCode: "CD", schoolCode: "*", identifier: "admin-rdc" };
  const superAdmin = { sub: "super", role: "Super Administrateur Somafrik", identifier: "superadmin" };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "security-test" };

  // Un compte TEACHER ne doit jamais pouvoir être créé par le module Utilisateurs.
  // La création canonique est réservée à /teachers, qui persiste users + teachers atomiquement.
  for (const principal of [schoolAdmin, countryAdmin, superAdmin]) {
    store.clearAuditLog();
    const beforeUsers = store.listProjection().users.length;
    await expectRejection(
      store.createUser(
        {
          firstName: "Teacher",
          lastName: "Orphan",
          role: principal === schoolAdmin ? "Enseignant" : "TEACHER",
          schoolCode: "CD-2026-0001",
          phone: "+243810099999",
        },
        principal,
        auditMeta,
      ),
      { status: 403, code: TEACHER_ACCOUNT_ENTRY_ERROR },
    );
    assert.equal(store.listProjection().users.length, beforeUsers, "aucun user TEACHER orphelin persisté");
    assert.equal(store.getAuditLog().length, 0, "rejet TEACHER : aucun audit de mutation");
  }

  store.clearAuditLog();
  await expectRejection(
    store.createUser(
      {
        firstName: "Global",
        lastName: "Admin",
        role: "Super Administrateur Somafrik",
        schoolCode: "CD-2026-0001",
      },
      schoolAdmin,
      auditMeta,
    ),
    { status: 403, code: CLIENTS_ERROR.FORBIDDEN },
  );
  assert.equal(store.getAuditLog().length, 0, "createUser privilégié : aucun audit");

  store.clearAuditLog();
  await expectRejection(
    store.createUser(
      {
        firstName: "Pays",
        lastName: "Admin",
        role: "Admin Pays",
        schoolCode: "CD-2026-0001",
      },
      schoolAdmin,
      auditMeta,
    ),
    { status: 403, code: CLIENTS_ERROR.FORBIDDEN },
  );
  assert.equal(store.getAuditLog().length, 0);

  store.clearAuditLog();
  await expectRejection(
    store.createUser(
      {
        firstName: "Global",
        lastName: "Admin",
        role: "Super Administrateur Somafrik",
        schoolCode: "CD-2026-0001",
      },
      countryAdmin,
      auditMeta,
    ),
    { status: 403, code: CLIENTS_ERROR.FORBIDDEN },
  );
  assert.equal(store.getAuditLog().length, 0);

  const staff = await store.createUser(
    {
      firstName: "Sec",
      lastName: "Ret",
      role: "Secrétaire",
      schoolCode: "CD-2026-0001",
    },
    schoolAdmin,
    auditMeta,
  );

  store.clearAuditLog();
  await expectRejection(
    store.updateUser(staff.id, { role: "Super Administrateur Somafrik" }, schoolAdmin, auditMeta),
    { status: 403, code: CLIENTS_ERROR.FORBIDDEN },
  );
  assert.equal(store.getAuditLog().length, 0, "updateUser privilégié : aucun audit");

  store.clearAuditLog();
  await expectRejection(
    store.updateUser(staff.id, { role: "TEACHER" }, schoolAdmin, auditMeta),
    { status: 403, code: TEACHER_ACCOUNT_ENTRY_ERROR },
  );
  assert.equal(store.getAuditLog().length, 0, "promotion TEACHER générique : aucun audit");

  store.clearAuditLog();
  await expectRejection(
    store.updateUser(
      staff.id,
      { profile: { permissions: ["ALL_PRIVILEGES"] } },
      schoolAdmin,
      auditMeta,
    ),
    { status: 403, code: CLIENTS_ERROR.FORBIDDEN },
  );
  assert.equal(store.getAuditLog().length, 0, "profile.permissions : aucun audit");
  const staffAfter = store.getUserById(staff.id);
  assert.equal(parsePayload(staffAfter.profile_payload).permissions, undefined, "aucune permission persistée");

  store.clearAuditLog();
  await expectRejection(
    store.updateUser(staff.id, { permissions: ["ALL_PRIVILEGES"] }, schoolAdmin, auditMeta),
    { status: 403, code: CLIENTS_ERROR.FORBIDDEN },
  );
  assert.equal(store.getAuditLog().length, 0, "permissions top-level : aucun audit");

  const contact = await store.createContact(
    {
      firstName: "Paul",
      lastName: "Parent",
      contactType: "Parent",
      phone: "+243900000111",
      schoolCode: "CD-2026-0001",
    },
    schoolAdmin,
    auditMeta,
  );

  store.clearAuditLog();
  await expectRejection(
    store.provisionContactAccount(contact.id, { role: "Enseignant" }, schoolAdmin, auditMeta),
    { status: 403, code: CLIENTS_ERROR.FORBIDDEN },
  );
  assert.equal(store.getAuditLog().length, 0, "provision rôle non Parent : aucun audit");

  const provisioned = await store.provisionContactAccount(
    contact.id,
    { role: "Parent", studentId: "student-cd" },
    schoolAdmin,
    auditMeta,
  );
  assert.equal(provisioned.created, true);

  store.clearAuditLog();
  await expectRejection(
    store.provisionContactAccount(contact.id, { role: "Parent", studentId: "student-bi" }, schoolAdmin, auditMeta),
    { status: 404, code: CLIENTS_ERROR.STUDENT_NOT_FOUND },
  );
  assert.equal(store.getAuditLog().length, 0, "relation cross-tenant : aucun audit");
  assert.equal(store.listProjection().relations.length, 1, "aucune relation BI ajoutée");

  const biUser = await store.createUser(
    {
      firstName: "User",
      lastName: "BI",
      role: "Secrétaire",
      schoolCode: "BI-2026-0001",
    },
    superAdmin,
    auditMeta,
  );
  const cdSender = await store.createUser(
    {
      firstName: "Sender",
      lastName: "CD",
      role: "Secrétaire",
      schoolCode: "CD-2026-0001",
    },
    schoolAdmin,
    auditMeta,
  );

  store.clearAuditLog();
  await expectRejection(
    store.sendMessage(
      {
        message: "Hello",
        schoolCode: "CD-2026-0001",
        participantUserIds: [biUser.id],
      },
      { ...schoolAdmin, sub: cdSender.id },
      auditMeta,
    ),
    { status: 403, code: CLIENTS_ERROR.FORBIDDEN },
  );
  assert.equal(store.getAuditLog().length, 0, "participant hors tenant : aucun audit");
  assert.equal(store.listProjection().messages.length, 0, "aucun message créé");

  store.clearAuditLog();
  await expectRejection(
    store.sendMessage(
      {
        message: "Hello",
        schoolCode: "CD-2026-0001",
        participantUserIds: ["00000000-0000-0000-0000-000000000099"],
      },
      { ...schoolAdmin, sub: cdSender.id },
      auditMeta,
    ),
    { status: 404, code: CLIENTS_ERROR.USER_NOT_FOUND },
  );
  assert.equal(store.getAuditLog().length, 0, "participant inexistant : aucun audit");

  console.log("clientsSecurity.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
