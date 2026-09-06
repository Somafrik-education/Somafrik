"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { USER_ROLE_ERROR } = require("./userRoleLifecycle");
const {
  STUDENT_ROLE_LOCKED_MESSAGE,
  findCanonicalLinkedStudent,
  assertStudentRoleMutation,
  SELECT_CANONICAL_LINKED_STUDENT_SQL,
} = require("./studentRoleLock");
const { parseArgs, AUDIT_SQL, extraRoleFlags, summarize } = require("../scripts/audit-student-role-lock");

const CODE_LOGIN = "6654 1324";
const CODE_MATRICULE = "CD-IN-61-26-00017";

function buildStore() {
  return createClientsMemoryStore({
    platformSchools: [
      { id: "school-cd", code: "CD-2026-0001", name: "CD", countryId: "country-cd", countryCode: "CD" },
      { id: "school-bi", code: "BI-2026-0001", name: "BI", countryId: "country-bi", countryCode: "BI" },
    ],
    students: [],
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

test("preuve FK uniquement : code égal ne verrouille pas", () => {
  const students = [
    {
      id: "st-code",
      school_id: "school-cd",
      student_code: "CD-ITS-MR-26-00003",
      status: "active",
    },
  ];
  assert.equal(findCanonicalLinkedStudent(students, "user-1"), null);
});

test("preuve FK : students.user_id = users.id", () => {
  const students = [
    {
      id: "st-fk",
      school_id: "school-cd",
      student_code: CODE_MATRICULE,
      status: "active",
      user_id: "user-fk",
    },
  ];
  const hit = findCanonicalLinkedStudent(students, "user-fk");
  assert.equal(hit.id, "st-fk");
  assert.notEqual(CODE_LOGIN, CODE_MATRICULE);
});

test("grant STUDENT sur fiche liée autorisé (bootstrap) ; autre rôle 409", () => {
  const linked = { id: "st-1", student_code: CODE_MATRICULE, user_id: "u1", status: "active" };
  assert.doesNotThrow(() =>
    assertStudentRoleMutation({ linkedStudent: linked, operation: "grant", roleKey: "STUDENT" }),
  );
  assert.throws(
    () => assertStudentRoleMutation({ linkedStudent: linked, operation: "grant", roleKey: "PRINCIPAL" }),
    (error) => error.code === USER_ROLE_ERROR.STUDENT_ROLE_LOCKED && error.statusCode === 409,
  );
  assert.throws(
    () => assertStudentRoleMutation({ linkedStudent: linked, operation: "revoke", roleKey: "STUDENT" }),
    (error) => error.code === USER_ROLE_ERROR.STUDENT_ROLE_LOCKED,
  );
  assert.throws(
    () =>
      assertStudentRoleMutation({
        linkedStudent: linked,
        operation: "replace",
        payload: { roles: ["Directeur"] },
      }),
    (error) => error.code === USER_ROLE_ERROR.STUDENT_ROLE_LOCKED,
  );
});

test("SQL canonique : user_id via to_jsonb, pas de student_code / login_code", () => {
  assert.match(SELECT_CANONICAL_LINKED_STUDENT_SQL, /to_jsonb\(st\)->>'user_id'/);
  assert.match(SELECT_CANONICAL_LINKED_STUDENT_SQL, /\$1::text/);
  assert.doesNotMatch(SELECT_CANONICAL_LINKED_STUDENT_SQL, /st\.user_id = \$1/);
  assert.doesNotMatch(SELECT_CANONICAL_LINKED_STUDENT_SQL, /student_code\s*=\s*u\.user_code/);
  assert.doesNotMatch(SELECT_CANONICAL_LINKED_STUDENT_SQL, /login_code/);
  assert.doesNotMatch(SELECT_CANONICAL_LINKED_STUDENT_SQL, /identity_code/);
});

test("lifecycle : student lié + STUDENT reste ; grants staff 409 STUDENT_ROLE_LOCKED", async () => {
  const store = buildStore();
  const schoolAdmin = { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "lock-test" };
  const created = await store.createUser(
    { firstName: "Marc", lastName: "Rumba", email: "marc.lock@test.local" },
    schoolAdmin,
    auditMeta,
  );
  const row = store._tables.users.find((item) => item.id === created.id);
  row.user_code = CODE_LOGIN;
  row.identity_code = CODE_LOGIN;
  row.login_code = CODE_LOGIN;
  store._tables.students.push({
    id: "18181818-1818-4818-8818-181818181818",
    school_id: "school-cd",
    student_code: CODE_MATRICULE,
    status: "active",
    user_id: created.id,
  });
  store._tables.userRoles.push({
    user_id: created.id,
    school_id: "school-cd",
    role_key: "STUDENT",
    status: "active",
    revoked_at: null,
  });

  const listed = store.listProjection().users.find((item) => item.id === created.id);
  assert.equal(listed.accountKind, "student_login");
  assert.deepEqual(listed.roleKeys, ["STUDENT"]);
  assert.notEqual(listed.identifier || row.user_code, listed.linkedStudent.studentCode);

  await expectRejection(store.grantUserRole(created.id, { role: "Directeur" }, schoolAdmin, auditMeta), {
    status: 409,
    code: USER_ROLE_ERROR.STUDENT_ROLE_LOCKED,
  });
  await expectRejection(store.grantUserRole(created.id, { role: "Enseignant" }, schoolAdmin, auditMeta), {
    status: 409,
    code: USER_ROLE_ERROR.STUDENT_ROLE_LOCKED,
  });
  await expectRejection(store.grantUserRole(created.id, { role: "Admin School" }, schoolAdmin, auditMeta), {
    status: 409,
    code: USER_ROLE_ERROR.STUDENT_ROLE_LOCKED,
  });
  await expectRejection(store.revokeUserRole(created.id, { role: "Élève / Étudiant" }, schoolAdmin, auditMeta), {
    status: 409,
    code: USER_ROLE_ERROR.STUDENT_ROLE_LOCKED,
  });
  await expectRejection(store.grantUserRole(created.id, { roles: ["Directeur"] }, schoolAdmin, auditMeta), {
    status: 409,
    code: USER_ROLE_ERROR.STUDENT_ROLE_LOCKED,
  });
  await expectRejection(
    store.grantUserRole(created.id, { roles: ["Élève / Étudiant", "Directeur"] }, schoolAdmin, auditMeta),
    { status: 409, code: USER_ROLE_ERROR.STUDENT_ROLE_LOCKED },
  );

  const still = store.listProjection().users.find((item) => item.id === created.id);
  assert.deepEqual(still.roleKeys, ["STUDENT"]);
  assert.equal(
    store._tables.userRoles.filter((item) => item.user_id === created.id && item.role_key === "TEACHER" && item.status === "active")
      .length,
    0,
  );
});

test("non-élève : attribution Enseignant conservée", async () => {
  const store = buildStore();
  const schoolAdmin = { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "lock-test" };
  const staff = await store.createUser(
    { firstName: "Paul", lastName: "Prof", email: "paul.prof@test.local" },
    schoolAdmin,
    auditMeta,
  );
  const granted = await store.grantUserRole(staff.id, { role: "Enseignant" }, schoolAdmin, auditMeta);
  assert.deepEqual(granted.roleKeys, ["TEACHER"]);
});

test("tenant : élève CD ne bloque pas un staff BI", async () => {
  const store = buildStore();
  const schoolAdmin = { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
  const biAdmin = { sub: "admin-bi", role: "Admin School", schoolCode: "BI-2026-0001", identifier: "admin-bi" };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "lock-test" };
  const linked = await store.createUser(
    { firstName: "Awa", lastName: "CD", email: "awa.cd@test.local" },
    schoolAdmin,
    auditMeta,
  );
  store._tables.students.push({
    id: "st-cd-lock",
    school_id: "school-cd",
    student_code: "CD-ITS-MR-26-00011",
    status: "active",
    user_id: linked.id,
  });
  const biStaff = await store.createUser(
    { firstName: "Isolé", lastName: "BI", email: "isole.bi@test.local", schoolCode: "BI-2026-0001" },
    biAdmin,
    auditMeta,
  );
  const granted = await store.grantUserRole(biStaff.id, { role: "Enseignant" }, biAdmin, auditMeta);
  assert.deepEqual(granted.roleKeys, ["TEACHER"]);
  await expectRejection(store.grantUserRole(linked.id, { role: "Secrétaire" }, schoolAdmin, auditMeta), {
    status: 409,
    code: USER_ROLE_ERROR.STUDENT_ROLE_LOCKED,
  });
});

test("garde branchée sur grantRole / revokeRole", () => {
  const src = fs.readFileSync(path.join(__dirname, "userRoleLifecycleService.js"), "utf8");
  assert.match(src, /assertCanonicalStudentRolesLocked/);
  const grantAt = src.indexOf("async function grantRole");
  const revokeAt = src.indexOf("async function revokeRole");
  assert.ok(grantAt >= 0 && revokeAt >= 0);
  assert.match(src.slice(grantAt, revokeAt), /assertCanonicalStudentRolesLocked/);
  assert.match(src.slice(revokeAt), /assertCanonicalStudentRolesLocked/);
  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert.match(server, /grantClientsUserRole/);
  assert.match(server, /revokeClientsUserRole/);
  assert.match(server, /app\.post\("\/api\/backoffice\/users\/:userId\/roles\/grant"/);
  assert.match(server, /app\.post\("\/api\/backoffice\/users\/:userId\/roles\/revoke"/);
  assert.match(server, /app\.patch\("\/api\/backoffice\/users\/:userId"/);
  const patchAt = server.indexOf('app.patch("/api/backoffice/users/:userId"');
  const grantRouteAt = server.indexOf('app.post("/api/backoffice/users/:userId/roles/grant"');
  assert.ok(patchAt >= 0 && grantRouteAt > patchAt);
  assert.match(server.slice(patchAt, grantRouteAt), /updateClientsUser/);
  assert.doesNotMatch(server.slice(patchAt, grantRouteAt), /grantClientsUserRole/);
  const lifecycle = fs.readFileSync(path.join(__dirname, "userRoleLifecycle.js"), "utf8");
  assert.match(lifecycle, /FORBIDDEN_IDENTITY_PATCH_KEYS[\s\S]*"role"/);
  const clients = fs.readFileSync(path.join(__dirname, "clientsService.js"), "utf8");
  const reassignAt = clients.indexOf("async function reassignUserSchool");
  assert.match(clients.slice(reassignAt), /assertCanonicalStudentRolesLocked/);
  const migration = fs.readFileSync(
    path.join(__dirname, "../db/migrations/20260908_student_role_lock.sql"),
    "utf8",
  );
  assert.match(migration, /BEFORE INSERT OR DELETE OR UPDATE/);
  assert.doesNotMatch(migration, /student_code\s*=/);
});

test("sans FK user_id : attribution Directeur conservée (codes égaux ne verrouillent pas)", async () => {
  const store = buildStore();
  const schoolAdmin = { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "lock-test" };
  const staff = await store.createUser(
    { firstName: "Lina", lastName: "Code", email: "lina.code@test.local" },
    schoolAdmin,
    auditMeta,
  );
  const row = store._tables.users.find((item) => item.id === staff.id);
  row.user_code = "CD-ITS-MR-26-00003";
  row.identity_code = "CD-ITS-MR-26-00003";
  store._tables.students.push({
    id: "st-code-only",
    school_id: "school-cd",
    student_code: "CD-ITS-MR-26-00003",
    status: "active",
  });
  const granted = await store.grantUserRole(staff.id, { role: "Directeur" }, schoolAdmin, auditMeta);
  assert.deepEqual(granted.roleKeys, ["PRINCIPAL"]);
});

test("audit SQL : FK only, lecture seule", () => {
  assert.throws(() => parseArgs(["--fix"]), (error) => error.code === "AUDIT_WRITE_FORBIDDEN");
  assert.match(AUDIT_SQL, /st\.user_id IS NOT NULL/);
  assert.doesNotMatch(AUDIT_SQL, /student_code\s*=\s*u\.user_code/);
  assert.doesNotMatch(AUDIT_SQL, /\bUPDATE\b/i);
  assert.doesNotMatch(AUDIT_SQL, /\bDELETE\b/i);
  const flags = extraRoleFlags(["STUDENT", "PRINCIPAL"]);
  assert.equal(flags.hasDirector, true);
  assert.equal(flags.missingStudent, false);
  const summary = summarize([
    { school_code: "CD-IN-26-001", role_keys: ["STUDENT", "TEACHER"] },
    { school_code: "CD-IN-26-001", role_keys: [] },
  ]);
  assert.equal(summary.anomalyCount, 2);
  assert.equal(summary.bySchool[0].teacher, 1);
  assert.equal(summary.bySchool[0].missingStudent, 1);
});

test("message utilisateur stable", () => {
  assert.equal(STUDENT_ROLE_LOCKED_MESSAGE, "Les rôles d'un compte lié à un élève ne peuvent pas être modifiés.");
});
