"use strict";

/**
 * P0 GREEN — Isolation du catalogue Utilisateurs plateforme.
 * SUPER_ADMIN / COUNTRY_ADMIN ne doivent jamais lister ni muter le staff métier.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const {
  sqlUsersScope,
  filterUsersRows,
  resolveUsersSchoolScope,
  assertUsersTargetAccess,
} = require("./usersSchoolScope");

const SCHOOL_ID_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID_B = "22222222-2222-4222-8222-222222222222";

function buildStore() {
  return createClientsMemoryStore({
    platformSchools: [
      {
        id: "school-cd",
        code: "CD-2026-0001",
        name: "Institut Bukavu",
        countryId: "country-cd",
        countryCode: "CD",
        country: "RDC",
        login_code: "CD-IB-26-002",
      },
      {
        id: "school-bi",
        code: "BI-2026-0001",
        name: "Ecole Kanyosha",
        countryId: "country-bi",
        countryCode: "BI",
        country: "Burundi",
        login_code: "BI-EK-26-001",
      },
    ],
    countries: [
      { id: "country-cd", iso_code: "CD", name: "RDC" },
      { id: "country-bi", iso_code: "BI", name: "Burundi" },
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

test("sqlUsersScope Superadmin n'est plus TRUE : EXISTS IN catalogue plateforme", () => {
  const params = [];
  const pred = sqlUsersScope({ mode: "all" }, params);
  assert.notEqual(pred, "TRUE");
  assert.match(pred, /EXISTS/i);
  assert.match(pred, /user_roles/);
  assert.match(pred, /COUNTRY_ADMIN/);
  assert.match(pred, /SCHOOL_ADMIN/);
  assert.match(pred, /role_key IN/);
  assert.doesNotMatch(pred, /\sOR\s/i);
  assert.deepEqual(params, []);
});

test("sqlUsersScope Admin Pays = pays + SCHOOL_ADMIN uniquement", () => {
  const params = [];
  const pred = sqlUsersScope({ mode: "country", countryCode: "CD" }, params);
  assert.match(pred, /profile_payload->>'countryCode'/);
  assert.match(pred, /SCHOOL_ADMIN/);
  assert.match(pred, /EXISTS/i);
  assert.doesNotMatch(pred, /COUNTRY_ADMIN/);
  assert.doesNotMatch(pred, /\sOR\s/i);
  assert.deepEqual(params, ["CD"]);
});

test("filterUsersRows Superadmin : Admin Pays / Admin School, jamais métier ni identité école vide", () => {
  const rows = [
    { id: "pays", roleKeys: ["COUNTRY_ADMIN"], countryCode: "CD" },
    { id: "admin-a", roleKeys: ["SCHOOL_ADMIN"], schoolId: SCHOOL_ID_A, countryCode: "CD" },
    { id: "sec", roleKeys: ["SECRETARY"], schoolId: SCHOOL_ID_A, countryCode: "CD" },
    { id: "teacher", roleKeys: ["TEACHER"], schoolId: SCHOOL_ID_A, countryCode: "CD" },
    { id: "student", roleKeys: ["STUDENT"], schoolId: SCHOOL_ID_A, countryCode: "CD" },
    { id: "parent", roleKeys: ["PARENT"], schoolId: SCHOOL_ID_A, countryCode: "CD" },
    { id: "empty-school", roleKeys: [], schoolId: SCHOOL_ID_A, countryCode: "CD" },
  ];
  assert.deepEqual(
    filterUsersRows(rows, { mode: "all" }).map((row) => row.id),
    ["pays", "admin-a"],
  );
});

test("filterUsersRows Admin Pays : SCHOOL_ADMIN du pays, jamais métier ni autre pays", () => {
  const rows = [
    { id: "admin-cd", roleKeys: ["SCHOOL_ADMIN"], schoolId: SCHOOL_ID_A, countryCode: "CD" },
    { id: "pays-cd", roleKeys: ["COUNTRY_ADMIN"], countryCode: "CD" },
    { id: "sec-cd", roleKeys: ["SECRETARY"], schoolId: SCHOOL_ID_A, countryCode: "CD" },
    { id: "admin-bi", roleKeys: ["SCHOOL_ADMIN"], schoolId: SCHOOL_ID_B, countryCode: "BI" },
  ];
  assert.deepEqual(
    filterUsersRows(rows, { mode: "country", countryCode: "CD" }).map((row) => row.id),
    ["admin-cd"],
  );
});

test("filterUsersRows Admin School conserve le staff métier du tenant", () => {
  const rows = [
    { id: "admin-a", roleKeys: ["SCHOOL_ADMIN"], schoolId: SCHOOL_ID_A },
    { id: "sec-a", roleKeys: ["SECRETARY"], schoolId: SCHOOL_ID_A },
    { id: "sec-b", roleKeys: ["SECRETARY"], schoolId: SCHOOL_ID_B },
  ];
  assert.deepEqual(
    filterUsersRows(rows, { mode: "school", schoolId: SCHOOL_ID_A }).map((row) => row.id),
    ["admin-a", "sec-a"],
  );
});

test("assertUsersTargetAccess Superadmin refuse un compte métier / sans rôle", () => {
  const superadmin = { role: "Super Administrateur Somafrik", schoolCode: "*" };
  assert.equal(resolveUsersSchoolScope(superadmin).mode, "all");
  assert.doesNotThrow(() =>
    assertUsersTargetAccess(superadmin, { roleKeys: ["SCHOOL_ADMIN"], schoolId: SCHOOL_ID_A, countryCode: "CD" }),
  );
  assert.doesNotThrow(() =>
    assertUsersTargetAccess(superadmin, { roleKeys: ["COUNTRY_ADMIN"], countryCode: "CD" }),
  );
  assert.throws(
    () => assertUsersTargetAccess(superadmin, { roleKeys: ["SECRETARY"], schoolId: SCHOOL_ID_A, countryCode: "CD" }),
    (error) => error.statusCode === 403,
  );
  assert.throws(
    () => assertUsersTargetAccess(superadmin, { roleKeys: [], schoolId: SCHOOL_ID_A, countryCode: "CD" }),
    (error) => error.statusCode === 403,
  );
});

test("catalogue mémoire : GET Superadmin / Admin Pays / Admin School + mutations", async () => {
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
  const schoolAdmin = {
    sub: "admin-school",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    usersLoginCode: "CD-IB-26-002",
    usersSchoolId: "school-cd",
    countryCode: "CD",
    identifier: "admin-cd",
  };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "platform-catalog-test" };

  const paysCd = await store.provisionUser(
    {
      firstName: "Admin",
      lastName: "PaysCD",
      email: "pays.cd@test.local",
      roleKey: "COUNTRY_ADMIN",
      countryCode: "CD",
    },
    superAdmin,
    auditMeta,
  );
  const paysBi = await store.provisionUser(
    {
      firstName: "Admin",
      lastName: "PaysBI",
      email: "pays.bi@test.local",
      roleKey: "COUNTRY_ADMIN",
      countryCode: "BI",
    },
    superAdmin,
    auditMeta,
  );
  const adminA = await store.provisionUser(
    {
      firstName: "Admin",
      lastName: "SchoolA",
      email: "admin.a@test.local",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    superAdmin,
    auditMeta,
  );
  const adminB = await store.provisionUser(
    {
      firstName: "Admin",
      lastName: "SchoolB",
      email: "admin.b@test.local",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "BI",
      schoolCode: "BI-2026-0001",
    },
    superAdmin,
    auditMeta,
  );

  const secretary = await store.createUser(
    { firstName: "Serge", lastName: "Secretaire", email: "serge.sec@test.local" },
    schoolAdmin,
    auditMeta,
  );
  await store.grantUserRole(secretary.id, { role: "Secrétaire" }, schoolAdmin, auditMeta);

  const teacher = await store.createUser(
    { firstName: "Tina", lastName: "Enseignante", email: "tina.ens@test.local" },
    schoolAdmin,
    auditMeta,
  );
  await store.grantUserRole(teacher.id, { role: "Enseignant" }, schoolAdmin, auditMeta);

  const emptySchool = await store.createUser(
    { firstName: "Idem", lastName: "Vide", email: "idem.vide@test.local" },
    schoolAdmin,
    auditMeta,
  );
  store._tables.userRoles.push({
    user_id: emptySchool.id,
    school_id: "school-cd",
    role_key: "STUDENT",
    status: "active",
    revoked_at: null,
  });
  const student = emptySchool;
  const parent = await store.createUser(
    { firstName: "Papa", lastName: "Parent", email: "papa.parent@test.local" },
    schoolAdmin,
    auditMeta,
  );
  store._tables.userRoles.push({
    user_id: parent.id,
    school_id: "school-cd",
    role_key: "PARENT",
    status: "active",
    revoked_at: null,
  });
  const unassigned = await store.createUser(
    { firstName: "Sans", lastName: "Role", email: "sans.role@test.local" },
    schoolAdmin,
    auditMeta,
  );

  const superScope = resolveUsersSchoolScope(superAdmin);
  const superListed = store.listUsers(superScope).map((row) => row.id);
  assert.ok(superListed.includes(paysCd.id), "SUPER_ADMIN voit COUNTRY_ADMIN");
  assert.ok(superListed.includes(adminA.id), "SUPER_ADMIN voit SCHOOL_ADMIN A");
  assert.ok(superListed.includes(adminB.id), "SUPER_ADMIN voit SCHOOL_ADMIN B");
  assert.equal(superListed.includes(secretary.id), false, "SUPER_ADMIN ne voit pas secrétaire");
  assert.equal(superListed.includes(teacher.id), false, "SUPER_ADMIN ne voit pas enseignant");
  assert.equal(superListed.includes(student.id), false, "SUPER_ADMIN ne voit pas élève");
  assert.equal(superListed.includes(parent.id), false, "SUPER_ADMIN ne voit pas parent");
  assert.equal(superListed.includes(unassigned.id), false, "SUPER_ADMIN ne voit pas school_id sans rôle");

  const countryScope = resolveUsersSchoolScope(countryAdmin);
  const countryListed = store.listUsers(countryScope).map((row) => row.id);
  assert.ok(countryListed.includes(adminA.id), "COUNTRY_ADMIN voit SCHOOL_ADMIN de son pays");
  assert.equal(countryListed.includes(paysCd.id), false, "COUNTRY_ADMIN ne voit pas Admin Pays");
  assert.equal(countryListed.includes(secretary.id), false, "COUNTRY_ADMIN ne reçoit pas le staff métier");
  assert.equal(countryListed.includes(adminB.id), false, "COUNTRY_ADMIN ne voit pas l'autre pays");
  assert.equal(countryListed.includes(paysBi.id), false, "COUNTRY_ADMIN ne voit pas Admin Pays étranger");

  const schoolScope = resolveUsersSchoolScope(schoolAdmin);
  const schoolListed = store.listUsers(schoolScope).map((row) => row.id);
  assert.ok(schoolListed.includes(secretary.id), "SCHOOL_ADMIN conserve le staff A");
  assert.ok(schoolListed.includes(unassigned.id), "SCHOOL_ADMIN voit l'identité sans rôle de son établissement");
  assert.equal(schoolListed.includes(adminB.id), false, "SCHOOL_ADMIN ne voit pas B");

  await expectRejection(
    store.updateUser(secretary.id, { firstName: "Nope" }, superAdmin, auditMeta),
    { status: 403 },
  );
  await expectRejection(
    store.updateUser(unassigned.id, { firstName: "Nope" }, superAdmin, auditMeta),
    { status: 403 },
  );
  await expectRejection(
    store.updateUser(secretary.id, { firstName: "Nope" }, countryAdmin, auditMeta),
    { status: 403 },
  );
  await expectRejection(
    store.grantUserRole(secretary.id, { role: "Admin School" }, superAdmin, auditMeta),
    { status: 403 },
  );
  await expectRejection(
    store.grantUserRole(unassigned.id, { role: "Enseignant" }, superAdmin, auditMeta),
    { status: 403 },
  );
  await expectRejection(
    store.grantUserRole(unassigned.id, { role: "Enseignant" }, countryAdmin, auditMeta),
    { status: 403 },
  );

  const granted = await store.grantUserRole(unassigned.id, { role: "Admin School" }, superAdmin, auditMeta);
  assert.ok((granted.roleKeys || []).includes("SCHOOL_ADMIN"));

  const patched = await store.updateUser(adminA.id, { firstName: "Aline" }, superAdmin, auditMeta);
  assert.equal(patched.firstName, "Aline");

  const superRoles = await store.listAssignableUserRoles(superAdmin);
  assert.deepEqual(
    superRoles.map((row) => row.roleKey).sort(),
    ["COUNTRY_ADMIN", "SCHOOL_ADMIN"],
  );
  const countryRoles = await store.listAssignableUserRoles(countryAdmin);
  assert.deepEqual(
    countryRoles.map((row) => row.roleKey),
    ["SCHOOL_ADMIN"],
  );
});
