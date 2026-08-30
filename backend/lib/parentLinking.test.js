"use strict";

const assert = require("node:assert/strict");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { CLIENTS_ERROR } = require("./clientsManagement");
const { findActiveUserByLoginIdentity, PARENT_IDENTITY_AMBIGUOUS } = require("./usersLoginIdentity");
const { AuthService } = require("../services/authService");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");
const { hashSecret } = require("../services/credentialService");

function seedStore() {
  return createClientsMemoryStore({
    school: {
      id: "school-a",
      code: "CD-2026-0001",
      loginCode: "CD-IN-26-001",
      name: "INSTITUT NURU",
      countryId: "country-1",
      countryCode: "CD",
    },
    platformSchools: [
      {
        id: "school-a",
        code: "CD-2026-0001",
        loginCode: "CD-IN-26-001",
        name: "INSTITUT NURU",
        countryId: "country-1",
        countryCode: "CD",
      },
      {
        id: "school-b",
        code: "BI-2026-0002",
        loginCode: "BI-KG-26-002",
        name: "KIGOBE",
        countryId: "country-2",
        countryCode: "BI",
      },
    ],
    students: [
      { id: "student-esther", school_id: "school-a", first_name: "Esther", last_name: "OKITO", studentCode: "STU-EST" },
      { id: "student-2", school_id: "school-a", first_name: "Sarah", last_name: "OKITO", studentCode: "STU-SAR" },
      { id: "student-b", school_id: "school-b", first_name: "Cross", last_name: "Tenant", studentCode: "STU-B" },
    ],
  });
}

const principal = {
  sub: "actor-1",
  role: "Admin School",
  schoolCode: "CD-IN-26-001",
  identifier: "admin",
};
const auditMeta = { ipAddress: "127.0.0.1", userAgent: "test" };

async function counts(store, userId) {
  const tables = store._tables;
  return {
    users: tables.users.filter((row) => !userId || row.id === userId).length,
    contacts: tables.contacts.filter((row) => !userId || row.user_id === userId).length,
    parentRoles: tables.userRoles.filter(
      (row) => row.role_key === "PARENT" && row.status === "active" && (!userId || row.user_id === userId),
    ).length,
    relations: tables.relations.filter((row) => (row.status ?? "active") === "active").length,
    activeRelationsForUser(uid) {
      const contactIds = new Set(tables.contacts.filter((row) => row.user_id === uid).map((row) => row.id));
      return tables.relations.filter(
        (row) => contactIds.has(row.contact_id) && (row.status ?? "active") === "active",
      ).length;
    },
  };
}

async function main() {
  const store = seedStore();

  const first = await store.linkParent(
    {
      studentId: "student-esther",
      firstName: "Baudouin",
      lastName: "OKITO",
      phone: "+243811111111",
      email: "baudouin.okito@test.local",
      relationType: "parent_student",
    },
    principal,
    auditMeta,
  );
  assert.equal(first.created, true);
  assert.equal(first.createdUser, true);
  assert.ok(first.temporaryPassword);
  const baudouinId = first.user.id;
  let snapshot = await counts(store, baudouinId);
  assert.equal(snapshot.users, 1);
  assert.equal(snapshot.contacts, 1);
  assert.equal(snapshot.parentRoles, 1);
  assert.equal(snapshot.activeRelationsForUser(baudouinId), 1);

  const secondChild = await store.linkParent(
    {
      studentId: "student-2",
      firstName: "Baudouin",
      lastName: "OKITO",
      phone: "+243811111111",
      email: "baudouin.okito@test.local",
      relationType: "parent_student",
    },
    principal,
    auditMeta,
  );
  assert.equal(secondChild.created, true);
  assert.equal(secondChild.user.id, baudouinId);
  snapshot = await counts(store, baudouinId);
  assert.equal(snapshot.users, 1);
  assert.equal(snapshot.contacts, 1);
  assert.equal(snapshot.parentRoles, 1);
  assert.equal(snapshot.activeRelationsForUser(baudouinId), 2);

  const idempotent = await store.linkParent(
    {
      studentId: "student-esther",
      phone: "+243811111111",
      email: "baudouin.okito@test.local",
    },
    principal,
    auditMeta,
  );
  assert.equal(idempotent.created, false);
  snapshot = await counts(store, baudouinId);
  assert.equal(snapshot.activeRelationsForUser(baudouinId), 2);

  const otherParent = await store.linkParent(
    {
      studentId: "student-esther",
      firstName: "Marie",
      lastName: "OKITO",
      phone: "+243822222222",
      email: "marie.okito@test.local",
    },
    principal,
    auditMeta,
  );
  assert.equal(otherParent.created, true);
  assert.notEqual(otherParent.user.id, baudouinId);
  assert.equal(
    store._tables.relations.filter(
      (row) => row.student_id === "student-esther" && (row.status ?? "active") === "active",
    ).length,
    2,
  );

  const teacher = await store.bind().insertUser({
    schoolId: "school-a",
    userCode: "USR-TEACH-1",
    firstName: "Paul",
    lastName: "Enseignant",
    email: "paul.teacher@test.local",
    phone: "+243833333333",
    role: "TEACHER",
    status: "active",
    passwordHash: hashSecret("TeacherPin1!"),
    profile: { identifier: "paul.teacher@test.local" },
  });
  await store.bind().insertUserRole({
    userId: teacher.id,
    schoolId: "school-a",
    roleKey: "TEACHER",
  });
  const teacherLink = await store.linkParent(
    {
      studentId: "student-esther",
      firstName: "Paul",
      lastName: "Enseignant",
      phone: "+243833333333",
      email: "paul.teacher@test.local",
    },
    principal,
    auditMeta,
  );
  assert.equal(teacherLink.user.id, teacher.id);
  const teacherKeys = await store.bind().listActiveUserRoleKeys(teacher.id);
  assert.ok(teacherKeys.includes("TEACHER"));
  assert.ok(teacherKeys.includes("PARENT"));
  assert.equal(store._tables.users.filter((row) => row.email === "paul.teacher@test.local").length, 1);

  attachMemoryLoginLockoutStore();
  const hydratedTeacher = store.listProjection().users.find((row) => row.id === teacher.id);
  const authUser = {
    ...hydratedTeacher,
    identifier: teacher.email,
    phone: teacher.phone,
    email: teacher.email,
    schoolCode: "CD-IN-26-001",
    status: "Actif",
    passwordHash: store._tables.users.find((row) => row.id === teacher.id).password_hash,
  };
  const auth = new AuthService({
    school: { code: "CD-2026-0001", loginCode: "CD-IN-26-001", status: "Actif", validationStatus: "Validé" },
    schools: [{ code: "CD-2026-0001", loginCode: "CD-IN-26-001", status: "Actif", validationStatus: "Validé" }],
    teachers: [],
    students: store._tables.students.map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      schoolCode: "CD-IN-26-001",
    })),
    relations: store.listProjection().relations,
    userAccounts: [authUser],
    countries: [],
    subscriptions: [],
    assignments: [],
  });
  const parentLogin = await auth.login({
    role: "parent_student",
    schoolCode: "CD-IN-26-001",
    identifier: "paul.teacher@test.local",
    pin: "TeacherPin1!",
  });
  assert.equal(parentLogin.role, "parent_student");
  assert.equal(parentLogin.user.role, "Parent");
  const teacherLogin = await auth.login({
    role: "teacher",
    schoolCode: "CD-IN-26-001",
    identifier: "paul.teacher@test.local",
    pin: "TeacherPin1!",
  });
  assert.equal(teacherLogin.user.role, "Enseignant");

  const userA = await store.bind().insertUser({
    schoolId: "school-a",
    userCode: "USR-A-AMB",
    firstName: "Alice",
    lastName: "Mail",
    email: "alice@test.local",
    phone: "+243844444444",
    role: "PARENT",
    status: "active",
    passwordHash: hashSecret("x"),
    profile: {},
  });
  const userB = await store.bind().insertUser({
    schoolId: "school-a",
    userCode: "USR-B-AMB",
    firstName: "Bob",
    lastName: "Phone",
    email: "bob@test.local",
    phone: "+243855555555",
    role: "PARENT",
    status: "active",
    passwordHash: hashSecret("x"),
    profile: {},
  });
  await assert.rejects(
    () =>
      store.linkParent(
        {
          studentId: "student-2",
          firstName: "Ambigu",
          lastName: "Parent",
          email: "alice@test.local",
          phone: "+243855555555",
        },
        principal,
        auditMeta,
      ),
    (error) => error.statusCode === 409 && error.code === CLIENTS_ERROR.PARENT_IDENTITY_AMBIGUOUS,
  );
  assert.equal(store._tables.users.some((row) => row.id === userA.id), true);
  assert.equal(store._tables.users.some((row) => row.id === userB.id), true);

  await assert.rejects(
    () =>
      store.linkParent(
        {
          studentId: "student-b",
          firstName: "Baudouin",
          lastName: "OKITO",
          phone: "+243811111111",
          email: "baudouin.okito@test.local",
        },
        principal,
        auditMeta,
      ),
    (error) => error.statusCode === 404 && error.code === CLIENTS_ERROR.STUDENT_NOT_FOUND,
  );

  const beforeRollbackUsers = store._tables.users.length;
  const originalWithTx = store.withTransaction.bind(store);
  const txApi = store.bind();
  const originalInsertRelation = txApi.insertRelation.bind(txApi);
  store.withTransaction = async (fn) =>
    originalWithTx(async (tx) => {
      tx.insertRelation = async () => {
        throw Object.assign(new Error("simulated relation failure"), { statusCode: 500 });
      };
      try {
        return await fn(tx);
      } finally {
        tx.insertRelation = originalInsertRelation;
      }
    });
  try {
    await assert.rejects(
      () =>
        store.linkParent(
          {
            studentId: "student-2",
            firstName: "Rollback",
            lastName: "User",
            phone: "+243866666666",
            email: "rollback@test.local",
          },
          principal,
          auditMeta,
        ),
      (error) => error.statusCode === 500 || error.message.includes("simulated"),
    );
  } finally {
    store.withTransaction = originalWithTx;
    txApi.insertRelation = originalInsertRelation;
  }
  assert.equal(store._tables.users.length, beforeRollbackUsers);
  assert.equal(store._tables.users.some((row) => row.email === "rollback@test.local"), false);

  const uiAliases = await store.createRelation(
    { fromContactId: first.contact.id, toStudentId: "student-2" },
    principal,
    auditMeta,
  );
  assert.equal(uiAliases.created, false);
  assert.equal(uiAliases.relation.toStudentId, "student-2");

  const archived = await store.archiveParentRelation(first.relation.id, { status: "archived" }, principal, auditMeta);
  assert.equal(archived.archived, true);
  const relink = await store.linkParent(
    {
      studentId: "student-esther",
      phone: "+243811111111",
      email: "baudouin.okito@test.local",
    },
    principal,
    auditMeta,
  );
  assert.equal(relink.created, true);
  assert.equal(relink.user.id, baudouinId);

  const tx = {
    async lookup() {},
  };
  const fakeTx = {
    calls: [],
    async one() {
      return null;
    },
  };
  void fakeTx;
  void tx;
  const identityTx = {
    async one(sql) {
      if (String(sql).includes("trim(u.email)")) return { id: "user-email", user_code: "A" };
      if (String(sql).includes("trim(u.phone)")) return { id: "user-phone", user_code: "B" };
      return null;
    },
  };
  await assert.rejects(
    () => findActiveUserByLoginIdentity(identityTx, { schoolId: "school-a", email: "a@b.c", phone: "+243" }),
    (error) => error.statusCode === 409 && error.code === PARENT_IDENTITY_AMBIGUOUS,
  );

  const sameTx = {
    async one() {
      return { id: "same-user", user_code: "S" };
    },
  };
  const same = await findActiveUserByLoginIdentity(sameTx, {
    schoolId: "school-a",
    email: "a@b.c",
    phone: "+243",
  });
  assert.equal(same.id, "same-user");

  const lookup = await store.lookupParentIdentity(
    { phone: "+243811111111", email: "baudouin.okito@test.local" },
    principal,
  );
  assert.equal(lookup.found, true);
  assert.equal(lookup.user.id, baudouinId);

  console.log("parentLinking.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
