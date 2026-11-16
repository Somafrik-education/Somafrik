"use strict";

/**
 * ADMIN-03B — Relations établissement (Option A).
 * Persist update/archive + deny plateforme. Pas de DELETE physique.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { RbacService, routePermissions } = require("../services/rbacService");
const { TenantScopeService } = require("../services/tenantScopeService");
const {
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  PLATFORM_ADMIN_ALLOWED,
  isPlatformPersonalDataForbidden,
} = require("./platformPersonalDataGuard");
const { CLIENTS_ERROR, assertSchoolScope } = require("./clientsManagement");

const rbac = new RbacService();
const tenantScope = new TenantScopeService();

const SCHOOL_A = {
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Relations:READ", "Relations:CREATE", "Relations:UPDATE", "Gérer utilisateurs"],
  schoolCode: "CD-2026-0001",
  schoolId: "school-a",
  sub: "admin-a",
};

const SCHOOL_B = {
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Relations:READ", "Relations:CREATE", "Relations:UPDATE", "Gérer utilisateurs"],
  schoolCode: "BI-2026-0002",
  schoolId: "school-b",
  sub: "admin-b",
};

const SUPER = {
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES", "Relations:READ", "Relations:CREATE", "Relations:UPDATE"],
  schoolCode: "*",
};

const COUNTRY = {
  role: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES", "Relations:READ", "Relations:CREATE", "Relations:UPDATE"],
  schoolCode: "*",
  countryCode: "CD",
};

const NEW_ROUTES = [
  "PATCH /api/backoffice/relations/:relationId",
  "POST /api/backoffice/relations/:relationId/archive",
];

const PARENTS_ROUTES = [
  "GET /api/parents/identity",
  "GET /api/parents/relations",
  "POST /api/parents/link",
  "PATCH /api/parents/relations/:relationId",
];

const BACKOFFICE_ROUTES = [
  "GET /api/backoffice/relations",
  "POST /api/backoffice/relations",
  ...NEW_ROUTES,
];

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

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

const auditMeta = { ipAddress: "127.0.0.1", userAgent: "admin03b" };

async function createSchoolARelation(store) {
  const contact = await store.createContact(
    { firstName: "Baudouin", lastName: "OKITO", contactType: "Parent", phone: "+243811111111" },
    SCHOOL_A,
    auditMeta,
  );
  const created = await store.createRelation(
    { fromContactId: contact.id, toStudentId: "student-esther", isPrincipal: "Oui" },
    SCHOOL_A,
    auditMeta,
  );
  return { contact, relation: created.relation };
}

const PERSON_NAME_KEYS = new Set(["fromContactName", "toStudentName", "contact_name", "student_name"]);
const PERSON_NAME_VALUES = ["Baudouin", "Esther", "Sarah", "OKITO"];

function assertNoPiiSecrets(value) {
  const forbidden = ["password", "pin", "secret", "token", "authorization", "jwt"];
  const walk = (node) => {
    if (node == null) return;
    if (typeof node === "string") {
      assert.equal(forbidden.includes(node.toLowerCase()), false, node);
      assert.equal(node.includes("hunter2"), false);
      for (const name of PERSON_NAME_VALUES) {
        assert.equal(node.includes(name), false, `audit leaked person name ${name}: ${node}`);
      }
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "object") {
      for (const [key, nested] of Object.entries(node)) {
        assert.equal(forbidden.includes(key.toLowerCase()), false, key);
        assert.equal(["phone", "email", "address"].includes(key), false, key);
        assert.equal(PERSON_NAME_KEYS.has(key), false, key);
        walk(nested);
      }
    }
  };
  walk(value);
}

test("ADMIN-03B nouvelles routes FORBIDDEN, pas ALLOWED, présentes au catalogue", () => {
  for (const route of NEW_ROUTES) {
    assert.equal(Boolean(routePermissions[route]), true, route);
    assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(route), true, route);
    assert.equal(PLATFORM_ADMIN_ALLOWED.includes(route), false, route);
  }
});

test("R03B-01 School Admin liste école A", async () => {
  const store = seedStore();
  const { relation } = await createSchoolARelation(store);
  const listed = tenantScope.filterRows(store.listProjection().relations, SCHOOL_A);
  assert.equal(listed.some((row) => row.id === relation.id), true);
  assert.equal(rbac.canAccess(SCHOOL_A, "GET /api/backoffice/relations"), true);
});

test("R03B-02 create persiste", async () => {
  const store = seedStore();
  const { relation } = await createSchoolARelation(store);
  const row = store._tables.relations.find((item) => item.id === relation.id);
  assert.ok(row);
  assert.equal(row.status, "active");
  assert.equal(row.student_id, "student-esther");
});

test("R03B-03 update persiste", async () => {
  const store = seedStore();
  const { relation } = await createSchoolARelation(store);
  const updated = await store.updateRelation(
    relation.id,
    { fromContactId: relation.fromContactId, toStudentId: "student-2", isPrincipal: "Non" },
    SCHOOL_A,
    auditMeta,
  );
  assert.equal(updated.toStudentId, "student-2");
  assert.equal(updated.isPrincipal, "Non");
  const row = store._tables.relations.find((item) => item.id === relation.id);
  assert.equal(row.student_id, "student-2");
});

test("R03B-04 archive persiste", async () => {
  const store = seedStore();
  const { relation } = await createSchoolARelation(store);
  const archived = await store.archiveRelation(relation.id, SCHOOL_A, auditMeta);
  assert.equal(archived.archived, true);
  const row = store._tables.relations.find((item) => item.id === relation.id);
  assert.equal(row.status, "archived");
});

test("R03B-05 reload reflète update/archive", async () => {
  const store = seedStore();
  const { relation } = await createSchoolARelation(store);
  await store.updateRelation(
    relation.id,
    { fromContactId: relation.fromContactId, toStudentId: "student-2", isPrincipal: "Oui" },
    SCHOOL_A,
    auditMeta,
  );
  let listed = store.listProjection().relations.find((row) => row.id === relation.id);
  assert.equal(listed.toStudentId, "student-2");
  assert.equal(listed.isPrincipal, "Oui");
  await store.archiveRelation(relation.id, SCHOOL_A, auditMeta);
  listed = store.listProjection().relations.find((row) => row.id === relation.id);
  assert.equal(listed.status, "Archivé");
});

test("R03B-06 école B interdite", async () => {
  const store = seedStore();
  const { relation } = await createSchoolARelation(store);
  await assert.rejects(
    () => store.updateRelation(relation.id, { toStudentId: "student-2" }, SCHOOL_B, auditMeta),
    (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.TENANT_MISMATCH,
  );
  await assert.rejects(
    () => store.archiveRelation(relation.id, SCHOOL_B, auditMeta),
    (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.TENANT_MISMATCH,
  );
  const fromB = tenantScope.filterRows(store.listProjection().relations, SCHOOL_B);
  assert.equal(fromB.some((row) => row.id === relation.id), false);
});

test("R03B-07 Superadmin GET 403", () => {
  assert.equal(isPlatformPersonalDataForbidden(SUPER, "GET /api/backoffice/relations"), true);
  assert.equal(rbac.canAccess(SUPER, "GET /api/backoffice/relations"), false);
});

test("R03B-08 Superadmin POST 403", () => {
  assert.equal(rbac.canAccess(SUPER, "POST /api/backoffice/relations"), false);
  assert.equal(rbac.canAccess(SUPER, "POST /api/parents/link"), false);
});

test("R03B-09 Superadmin PATCH 403", () => {
  assert.equal(rbac.canAccess(SUPER, "PATCH /api/backoffice/relations/:relationId"), false);
});

test("R03B-10 Superadmin archive 403", () => {
  assert.equal(rbac.canAccess(SUPER, "POST /api/backoffice/relations/:relationId/archive"), false);
});

test("R03B-11 Country Admin idem", () => {
  for (const route of [...BACKOFFICE_ROUTES, ...PARENTS_ROUTES]) {
    assert.equal(rbac.canAccess(COUNTRY, route), false, route);
    assert.equal(isPlatformPersonalDataForbidden(COUNTRY, route), true, route);
  }
});

test("R03B-12 absence school scope fail-closed", () => {
  assert.throws(
    () => assertSchoolScope({ role: "Admin School", schoolCode: "" }, ""),
    (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.TENANT_MISMATCH,
  );
  assert.throws(
    () => assertSchoolScope(SCHOOL_A, "*"),
    (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.TENANT_MISMATCH,
  );
});

test("R03B-13 aucune suppression physique", async () => {
  const store = seedStore();
  const { relation } = await createSchoolARelation(store);
  const before = store._tables.relations.length;
  await store.archiveRelation(relation.id, SCHOOL_A, auditMeta);
  assert.equal(store._tables.relations.length, before);
  assert.equal(store._tables.relations.some((row) => row.id === relation.id && row.status === "archived"), true);
  const serverSrc = readUtf8("../server.js");
  assert.doesNotMatch(serverSrc, /app\.delete\("\/api\/backoffice\/relations/);
  assert.doesNotMatch(readUtf8("./clientsService.js"), /DELETE FROM contact_relations/i);
  assert.doesNotMatch(readUtf8("../db/clientsPgStore.js"), /DELETE FROM contact_relations/i);
});

test("R03B-14 aucun bypass via parents API", () => {
  for (const route of PARENTS_ROUTES) {
    assert.equal(rbac.canAccess(SUPER, route), false, `super ${route}`);
    assert.equal(rbac.canAccess(COUNTRY, route), false, `country ${route}`);
    assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(route), true, route);
  }
});

test("R03B-15 aucun payload PII inutile dans l'audit", async () => {
  const store = seedStore();
  const { relation } = await createSchoolARelation(store);
  await store.updateRelation(
    relation.id,
    { fromContactId: relation.fromContactId, toStudentId: "student-2", isPrincipal: "Oui" },
    SCHOOL_A,
    auditMeta,
  );
  await store.archiveRelation(relation.id, SCHOOL_A, auditMeta);
  const audits = store.getAuditLog().filter((row) => String(row.entityType) === "relation");
  assert.ok(audits.length >= 2);
  for (const entry of audits) {
    assertNoPiiSecrets(entry.oldValue);
    assertNoPiiSecrets(entry.newValue);
    if (entry.newValue) {
      assert.equal(Object.hasOwn(entry.newValue, "fromContactName"), false);
      assert.equal(Object.hasOwn(entry.newValue, "toStudentName"), false);
      assert.ok(entry.newValue.fromContactId);
      assert.ok(entry.newValue.toStudentId);
    }
  }
  const serviceSrc = readUtf8("./clientsService.js");
  assert.match(serviceSrc, /oldValue:\s*mapRelationAuditValue\(existing\)/);
  assert.match(serviceSrc, /newValue:\s*mapRelationAuditValue\(saved\)/);
  assert.doesNotMatch(serviceSrc, /oldValue:\s*mapRelationRow\(/);
  assert.doesNotMatch(serviceSrc, /newValue:\s*mapRelationRow\(/);
  const archiveSrc = readUtf8("./parentLinking.js");
  assert.match(archiveSrc, /oldValue:\s*mapRelationAuditValue\(existing\)/);
  assert.match(archiveSrc, /newValue:\s*mapRelationAuditValue\(saved\)/);
});

test("ADMIN-03B PATCH status=archived est refusé (archive dédiée)", async () => {
  const store = seedStore();
  const { relation } = await createSchoolARelation(store);
  await assert.rejects(
    () => store.updateRelation(relation.id, { status: "archived" }, SCHOOL_A, auditMeta),
    (error) => error.statusCode === 400,
  );
});
