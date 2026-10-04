"use strict";

/**
 * ADMIN-07 — replay final A07-01 → A07-36.
 * AUDIT-ONLY. Appelle les fonctions produit déjà mergées (ADMIN-01 → ADMIN-02C → ADMIN-06C).
 * Preuves profondes : fichiers ADMIN-* existants (coveredBy dans chaque titre).
 */

const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { listFunctionalModules } = require("./functionalModulesCatalog");
const { FallbackRepository } = require("../db/fallbackRepository");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { createDocumentsExamsMemoryStore } = require("../db/documentsExamsMemoryStore");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");
const { createEstablishmentRolesMemoryStore } = require("../db/establishmentRolesMemoryStore");
const { RbacService } = require("../services/rbacService");
const { TenantScopeService } = require("../services/tenantScopeService");
const {
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  isPlatformPersonalDataForbidden,
  isPlatformPersonalDataForbiddenHttp,
} = require("./platformPersonalDataGuard");
const { CLIENTS_ERROR } = require("./clientsManagement");
const { resolveUsersSchoolScope } = require("./usersSchoolScope");
const { toRoleKey } = require("./userRoleLifecycle");
const { resolveEffectiveRoleLabel } = require("./roleDisplayLabels");
const { updateRoleDisplayLabel } = require("./establishmentRolesService");
const {
  getConfiguredPermissions,
  patchConfiguredPermissions,
  resetConfiguredPermissionOverrides,
} = require("./functionalRbacService");
const { resolveEffectivePermissionSet } = require("./functionalRbacResolution");
const { listSchoolDocuments, createSchoolDocument } = require("./documentsExamsService");
const { DOCUMENTS_EXAMS_ERROR } = require("./documentsExamsManagement");
const { createErasureRequest, executeErasureRequest, PRIVACY_ERROR } = require("./privacyErasure");
const { listSchoolPrivacyRequests, resolveSchoolComplianceScope } = require("./schoolCompliance");
const { assertDataExportRead, resolveExportSchoolCode, DATA_EXPORT_ERROR } = require("./dataExportManagement");
const { exportSchoolData } = require("./dataExportService");
const {
  AUDIT_ERROR,
  assertSchoolAuditRead,
  listSchoolAuditSummaries,
  projectAuditSummary,
} = require("./schoolAudit");
const {
  resolveAdvancedReportsSchoolId,
  getAdvancedReportsForPrincipal,
  buildMemoryAdvancedReports,
} = require("./advancedReportsScope");
const {
  PLATFORM_COMPLIANCE_ROUTE,
  assertPlatformComplianceRead,
  getPlatformCompliance,
} = require("./platformCompliance");

const rbac = new RbacService();
const tenantScope = new TenantScopeService();

const SUPER = {
  sub: "super-1",
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
};

const SUPER_SPOOF = {
  ...SUPER,
  permissions: ["ALL_PRIVILEGES", "Relations:READ", "Documents:READ", "Utilisateurs:READ", "Audit:READ"],
  schoolCode: "CD-2026-0001",
};

const COUNTRY = {
  sub: "pays-1",
  role: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES", "Relations:READ", "Documents:READ", "Utilisateurs:READ", "Audit:READ"],
  schoolCode: "*",
  countryCode: "CD",
};

const SCHOOL_A = {
  sub: "admin-a",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: [
    "Relations:READ",
    "Relations:CREATE",
    "Relations:UPDATE",
    "Documents:READ",
    "Documents:CREATE",
    "Utilisateurs:READ",
    "Utilisateurs:UPDATE",
    "Paramètres Établissement:READ",
    "Paramètres Établissement:UPDATE",
    "Rapports:READ",
    "Gérer utilisateurs",
  ],
  schoolCode: "CD-2026-0001",
  schoolId: "school-a",
};

const SCHOOL_A_AUDIT = {
  ...SCHOOL_A,
  permissions: [...SCHOOL_A.permissions, "Audit:READ"],
};

const SCHOOL_B = {
  sub: "admin-b",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: SCHOOL_A.permissions,
  schoolCode: "BI-2026-0002",
  schoolId: "school-b",
};

const SECRETARY = {
  sub: "sec-1",
  role: "Secrétaire",
  roleKeys: ["SECRETARY"],
  permissions: ["Paramètres Établissement:READ", "Paramètres Établissement:UPDATE", "Audit:READ"],
  schoolCode: "CD-2026-0001",
};

const RELATIONS_ROUTES = [
  "GET /api/backoffice/relations",
  "POST /api/backoffice/relations",
  "PATCH /api/backoffice/relations/:relationId",
  "POST /api/backoffice/relations/:relationId/archive",
  "GET /api/parents/relations",
  "POST /api/parents/link",
];

const SCHOOL_PII_ROUTES = [
  ...RELATIONS_ROUTES,
  "GET /api/school-documents",
  "GET /api/privacy/erasure-requests",
  "POST /api/privacy/erasure-requests/:requestId/execute",
  "GET /api/data-export",
  "GET /api/audit",
  "GET /api/v2/reports/advanced",
];

const AUDIT_META = { ipAddress: "127.0.0.1", userAgent: "admin07-replay" };
const SCHOOL_A_ID = "550e8400-e29b-41d4-a716-446655440001";
const SCHOOL_B_ID = "SCHOOL-BI-2026-0002";

function forbidden(error, code) {
  return error.statusCode === 403 && (!code || error.code === code);
}

function seedRelationsStore() {
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
      { id: "student-a", school_id: "school-a", first_name: "Esther", last_name: "OKITO", studentCode: "STU-A" },
      { id: "student-b", school_id: "school-b", first_name: "Cross", last_name: "Tenant", studentCode: "STU-B" },
    ],
  });
}

function seedUsersStore() {
  return createClientsMemoryStore({
    platformSchools: [
      {
        id: "school-a",
        code: "CD-2026-0001",
        name: "Institut Nuru",
        countryId: "country-cd",
        countryCode: "CD",
        country: "RDC",
        login_code: "CD-IN-26-001",
      },
      {
        id: "school-b",
        code: "BI-2026-0002",
        name: "Kigobe",
        countryId: "country-bi",
        countryCode: "BI",
        country: "Burundi",
        login_code: "BI-KG-26-002",
      },
    ],
  });
}

function seedDocumentsRepo() {
  const store = createDocumentsExamsMemoryStore({
    schools: [
      { id: "school-a", school_code: "CD-2026-0001" },
      { id: "school-b", school_code: "BI-2026-0002" },
    ],
    students: [
      { id: "student-a", school_id: "school-a", student_code: "STU-A", first_name: "Esther", last_name: "OKITO" },
      { id: "student-b", school_id: "school-b", student_code: "STU-B", first_name: "Cross", last_name: "Tenant" },
    ],
  });
  const repo = {
    getDocumentsExamsStore: () => store,
    createTxScope() {
      return repo;
    },
    withTransaction: async (fn) => fn(repo),
    recordAudit: async () => true,
  };
  return { repo, store };
}

function rbacMemoryRepo() {
  const rbacStore = createFunctionalRbacMemoryStore({
    resolveCountryAndSchool: async ({ schoolCode }) => {
      if (schoolCode === "BI-2026-0002") {
        return {
          country: { id: "bi", code: "BI" },
          school: { id: "kigobe", school_code: "BI-2026-0002", country_id: "bi", country_code: "BI" },
        };
      }
      return {
        country: { id: "cd", code: "CD" },
        school: { id: "nuru", school_code: "CD-2026-0001", country_id: "cd", country_code: "CD" },
      };
    },
  });
  const repo = {
    getFunctionalRbacStore: () => rbacStore,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async () => true,
    listEstablishmentRoles: async () => [
      { id: "r1", roleCode: "SUPER_ADMIN", roleName: "Super Administrateur Somafrik", scope: "platform", status: "active" },
      { id: "r2", roleCode: "PREFET_ETUDES", roleName: "Préfet des études", scope: "school", status: "active" },
    ],
  };
  return { repo, rbacStore };
}

test("A07-01 Superadmin Relations PII denied (R03B-07)", () => {
  for (const route of RELATIONS_ROUTES) {
    assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(route), true, route);
    assert.equal(isPlatformPersonalDataForbidden(SUPER, route), true, route);
    assert.equal(isPlatformPersonalDataForbidden(SUPER_SPOOF, route), true, route);
    assert.equal(rbac.canAccess(SUPER, route), false, route);
    assert.equal(rbac.canAccess(SUPER_SPOOF, route), false, route);
  }
});

test("A07-02 Country Relations denied (R03B-11)", () => {
  for (const route of RELATIONS_ROUTES) {
    assert.equal(isPlatformPersonalDataForbidden(COUNTRY, route), true, route);
    assert.equal(rbac.canAccess(COUNTRY, route), false, route);
  }
});

test("A07-03 School A Relations A only (R03B-01/02)", async () => {
  const store = seedRelationsStore();
  const contact = await store.createContact(
    { firstName: "Baudouin", lastName: "OKITO", contactType: "Parent", phone: "+243811111111" },
    SCHOOL_A,
    AUDIT_META,
  );
  const created = await store.createRelation(
    { fromContactId: contact.id, toStudentId: "student-a", isPrincipal: "Oui" },
    SCHOOL_A,
    AUDIT_META,
  );
  const listed = tenantScope.filterRows(store.listProjection().relations, SCHOOL_A);
  assert.equal(listed.some((row) => row.id === created.relation.id), true);
  assert.equal(listed.every((row) => row.schoolCode === "CD-2026-0001" || !row.schoolCode), true);
  assert.equal(rbac.canAccess(SCHOOL_A, "GET /api/backoffice/relations"), true);
});

test("A07-04 School A ne lit pas B (R03B-06)", async () => {
  const store = seedRelationsStore();
  const contactB = await store.createContact(
    { firstName: "Cross", lastName: "Parent", contactType: "Parent", phone: "+257611111111" },
    SCHOOL_B,
    AUDIT_META,
  );
  const createdB = await store.createRelation(
    { fromContactId: contactB.id, toStudentId: "student-b", isPrincipal: "Oui" },
    SCHOOL_B,
    AUDIT_META,
  );
  const fromA = tenantScope.filterRows(store.listProjection().relations, SCHOOL_A);
  assert.equal(fromA.some((row) => row.id === createdB.relation.id), false);
  await assert.rejects(
    () => store.updateRelation(createdB.relation.id, { toStudentId: "student-b" }, SCHOOL_A, AUDIT_META),
    (error) => forbidden(error, CLIENTS_ERROR.TENANT_MISMATCH),
  );
});

test("A07-05 Superadmin Documents denied (D05-02)", async () => {
  assert.equal(isPlatformPersonalDataForbidden(SUPER, "GET /api/school-documents"), true);
  assert.equal(rbac.canAccess(SUPER, "GET /api/school-documents"), false);
  const { repo } = seedDocumentsRepo();
  await assert.rejects(
    () => listSchoolDocuments(repo, { ...SUPER, schoolCode: "CD-2026-0001" }),
    (error) => forbidden(error, DOCUMENTS_EXAMS_ERROR.FORBIDDEN),
  );
});

test("A07-06 School documents own tenant (D05-06)", async () => {
  const { repo } = seedDocumentsRepo();
  const created = await createSchoolDocument(
    repo,
    { title: "Attestation A", documentType: "attestation", studentId: "student-a" },
    SCHOOL_A,
    AUDIT_META,
  );
  const listed = await listSchoolDocuments(repo, SCHOOL_A);
  assert.equal(listed.some((row) => row.id === created.id || row.title === "Attestation A"), true);
  assert.equal(listed.every((row) => row.schoolCode === "CD-2026-0001" || row.schoolId === "school-a"), true);
});

test("A07-07 Superadmin privacy detail denied (C06B2 / C06A-09)", async () => {
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/privacy/erasure-requests"), true);
  assert.equal(rbac.canAccess(SUPER, "GET /api/privacy/erasure-requests"), false);
  assert.throws(() => resolveSchoolComplianceScope(SUPER), (error) => forbidden(error, PRIVACY_ERROR.FORBIDDEN));
  const repo = new FallbackRepository();
  const request = await createErasureRequest(repo, {
    schoolCode: "CD-2026-0001",
    identifier: "ident-a07",
    email: "a07.privacy@example.test",
    reason: "replay",
  });
  await assert.rejects(
    () => executeErasureRequest(repo, request.id, SUPER),
    (error) => forbidden(error, PRIVACY_ERROR.FORBIDDEN),
  );
  await assert.rejects(() => listSchoolPrivacyRequests(repo, SUPER), (error) => forbidden(error, PRIVACY_ERROR.FORBIDDEN));
});

test("A07-08 Country privacy denied (C06B2)", async () => {
  assert.equal(isPlatformPersonalDataForbiddenHttp(COUNTRY, "GET", "/api/privacy/erasure-requests"), true);
  assert.equal(rbac.canAccess(COUNTRY, "GET /api/privacy/erasure-requests"), false);
  assert.throws(() => resolveSchoolComplianceScope(COUNTRY), (error) => forbidden(error, PRIVACY_ERROR.FORBIDDEN));
  const repo = new FallbackRepository();
  const request = await createErasureRequest(repo, {
    schoolCode: "CD-2026-0001",
    identifier: "ident-country",
    email: "country.privacy@example.test",
    reason: "replay",
  });
  await assert.rejects(
    () => executeErasureRequest(repo, request.id, COUNTRY),
    (error) => forbidden(error, PRIVACY_ERROR.FORBIDDEN),
  );
});

test("A07-09 School privacy own tenant (C06B2-04/05)", async () => {
  const repo = new FallbackRepository();
  const aPending = await createErasureRequest(repo, {
    schoolCode: "CD-2026-0001",
    identifier: "ident-a",
    email: "a@example.test",
    reason: "reason-a",
  });
  const bPending = await createErasureRequest(repo, {
    schoolCode: "BI-2026-0002",
    identifier: "ident-b",
    email: "b@example.test",
    reason: "reason-b",
  });
  const listedA = await listSchoolPrivacyRequests(repo, SCHOOL_A);
  assert.equal(listedA.some((row) => row.id === aPending.id), true);
  assert.equal(listedA.some((row) => row.id === bPending.id), false);
  assert.equal(listedA.every((row) => row.schoolCode === "CD-2026-0001"), true);
});

test("A07-10 Superadmin export denied (EX06B2 / C06B2-26)", () => {
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/data-export"), true);
  assert.equal(rbac.canAccess(SUPER, "GET /api/data-export"), false);
  assert.throws(() => assertDataExportRead(SUPER), (error) => forbidden(error, DATA_EXPORT_ERROR.FORBIDDEN));
  assert.throws(() => assertDataExportRead(SUPER_SPOOF), (error) => forbidden(error, DATA_EXPORT_ERROR.FORBIDDEN));
});

test("A07-11 non-SCHOOL_ADMIN export denied (EX06B2-01)", () => {
  assert.throws(() => assertDataExportRead(SECRETARY), (error) => forbidden(error, DATA_EXPORT_ERROR.FORBIDDEN));
  assert.throws(
    () =>
      assertDataExportRead({
        role: "Proviseur",
        roleKeys: ["PRINCIPAL"],
        permissions: ["Paramètres Établissement:READ", "Paramètres Établissement:UPDATE"],
        schoolCode: "CD-2026-0001",
      }),
    (error) => forbidden(error, DATA_EXPORT_ERROR.FORBIDDEN),
  );
});

test("A07-12 SCHOOL_ADMIN export own tenant (C06B2-24)", async () => {
  assert.doesNotThrow(() => assertDataExportRead(SCHOOL_A));
  assert.equal(resolveExportSchoolCode(SCHOOL_A, "BI-2026-0002"), "CD-2026-0001");
  const repo = new FallbackRepository();
  const snapshot = await exportSchoolData(repo, SCHOOL_A);
  assert.ok(snapshot);
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /BI-2026-0002/);
});

test("A07-13 Superadmin audit denied (C06C-01)", () => {
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/audit"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/audit"), true);
  assert.equal(rbac.canAccess(SUPER, "GET /api/audit"), false);
  assert.throws(() => assertSchoolAuditRead(SUPER), (error) => forbidden(error, AUDIT_ERROR.FORBIDDEN));
  assert.throws(() => assertSchoolAuditRead(SUPER_SPOOF), (error) => forbidden(error, AUDIT_ERROR.FORBIDDEN));
});

test("A07-14 Country audit denied (C06C-02)", () => {
  assert.equal(isPlatformPersonalDataForbiddenHttp(COUNTRY, "GET", "/api/audit"), true);
  assert.equal(rbac.canAccess(COUNTRY, "GET /api/audit"), false);
  assert.throws(() => assertSchoolAuditRead(COUNTRY), (error) => forbidden(error, AUDIT_ERROR.FORBIDDEN));
});

test("A07-15 SCHOOL_ADMIN sans Audit:READ denied (C06C-03)", () => {
  assert.equal(isPlatformPersonalDataForbiddenHttp(SCHOOL_A, "GET", "/api/audit"), false);
  assert.equal(rbac.canAccess(SCHOOL_A, "GET /api/audit"), false);
  assert.throws(() => assertSchoolAuditRead(SCHOOL_A), (error) => forbidden(error, AUDIT_ERROR.FORBIDDEN));
});

test("A07-16 SCHOOL_ADMIN + Audit:READ allowed (C06C-04)", async () => {
  assert.equal(rbac.canAccess(SCHOOL_A_AUDIT, "GET /api/audit"), true);
  assert.doesNotThrow(() => assertSchoolAuditRead(SCHOOL_A_AUDIT));
  const repo = new FallbackRepository();
  repo.auditLogs.push({
    id: "AUD-A07-A",
    schoolCode: "CD-2026-0001",
    action: "user_update",
    entityType: "user",
    entityId: "USER-A",
    actorFirstName: "Admin",
    actorLastName: "Alpha",
    oldValue: { email: "secret.a@example.test" },
    newValue: { phone: "+243600000001" },
    ipAddress: "203.0.113.10",
    userAgent: "Injected-UA-A",
    createdAt: "2026-10-04T12:00:00.000Z",
  });
  const rows = await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT);
  assert.ok(rows.length >= 1);
});

test("A07-17 Audit projection sans old/new/IP/userAgent (C06C-11)", () => {
  const projected = projectAuditSummary({
    id: "AUD-RAW",
    schoolCode: "CD-2026-0001",
    userId: "USER-A",
    action: "user_update",
    entityType: "user",
    entityId: "USER-A",
    actorFirstName: "Admin",
    actorLastName: "Alpha",
    oldValue: { email: "secret.a@example.test" },
    newValue: { phone: "+243600000001" },
    ipAddress: "203.0.113.10",
    userAgent: "Injected-UA-A",
    createdAt: "2026-10-04T12:00:00.000Z",
  });
  assert.deepEqual(Object.keys(projected).sort(), ["action", "actor", "createdAt", "entityId", "entityType", "id"]);
  const serialized = JSON.stringify(projected);
  assert.doesNotMatch(serialized, /oldValue|newValue|ipAddress|userAgent|secret\.a|203\.0\.113|Injected-UA/);
});

test("A07-18 Advanced reports A != B (R06B0-03)", () => {
  const a = buildMemoryAdvancedReports({
    schoolId: SCHOOL_A_ID,
    school: { id: SCHOOL_A_ID, code: "CD-2026-0001", schoolCode: "CD-2026-0001" },
    students: [{ id: "sa1", schoolCode: "CD-2026-0001" }, { id: "sa2", schoolCode: "CD-2026-0001" }],
    teachers: [{ id: "ta1", schoolCode: "CD-2026-0001" }],
    classes: [{ id: "ca1", name: "6ème A", schoolCode: "CD-2026-0001" }],
    notes: [{ id: "na1", studentId: "sa1", schoolCode: "CD-2026-0001", value: 14 }],
    payments: [{ id: "pa1", studentId: "sa1", schoolCode: "CD-2026-0001", amount: 1000, status: "PAYE" }],
    presences: [{ id: "pra1", studentId: "sa1", schoolCode: "CD-2026-0001", present: true, status: "Present" }],
    exams: [{ id: "ea1", schoolCode: "CD-2026-0001", examType: "Contrôle A" }],
    subscriptions: [{ id: "suba", schoolCode: "CD-2026-0001", status: "Actif" }],
  });
  const b = buildMemoryAdvancedReports({
    schoolId: SCHOOL_B_ID,
    school: { id: SCHOOL_B_ID, code: "BI-2026-0002", schoolCode: "BI-2026-0002" },
    students: [{ id: "sb1", schoolCode: "BI-2026-0002" }],
    teachers: [{ id: "tb1", schoolCode: "BI-2026-0002" }, { id: "tb2", schoolCode: "BI-2026-0002" }],
    classes: [{ id: "cb1", name: "5ème B", schoolCode: "BI-2026-0002" }],
    notes: [{ id: "nb1", studentId: "sb1", schoolCode: "BI-2026-0002", value: 8 }],
    payments: [{ id: "pb1", studentId: "sb1", schoolCode: "BI-2026-0002", amount: 777, status: "PAYE" }],
    presences: [{ id: "prb1", studentId: "sb1", schoolCode: "BI-2026-0002", present: false, status: "Absent" }],
    exams: [{ id: "eb1", schoolCode: "BI-2026-0002", examType: "Examen B" }],
    subscriptions: [{ id: "subb", schoolCode: "BI-2026-0002", status: "Actif" }],
  });
  assert.notEqual(a.global.students, b.global.students);
  assert.notEqual(a.financial.paid, b.financial.paid);
  assert.equal(a.academic.some((row) => row.label === "5ème B"), false);
  assert.equal(b.academic.some((row) => row.label === "6ème A"), false);
});

test("A07-19 query override ne change pas tenant (R06B0-12)", async () => {
  const repo = {
    async getSchoolByCode(code) {
      if (String(code).toUpperCase() === "CD-2026-0001") {
        return { id: SCHOOL_A_ID, school_code: "CD-2026-0001" };
      }
      if (String(code).toUpperCase() === "BI-2026-0002") {
        return { id: SCHOOL_B_ID, school_code: "BI-2026-0002" };
      }
      return null;
    },
    async getAdvancedReportsV2(schoolId) {
      return { schoolId };
    },
  };
  const schoolId = await resolveAdvancedReportsSchoolId(repo, SCHOOL_A);
  assert.equal(schoolId, SCHOOL_A_ID);
  const payload = await getAdvancedReportsForPrincipal({ repository: repo, principal: SCHOOL_A });
  assert.equal(payload.schoolId, SCHOOL_A_ID);
  assert.notEqual(payload.schoolId, SCHOOL_B_ID);
  assert.equal(resolveExportSchoolCode(SCHOOL_A, "BI-2026-0002"), "CD-2026-0001");
});

test("A07-20 A1 Superadmin non-PII (C06B1-08)", async () => {
  assert.doesNotThrow(() => assertPlatformComplianceRead(SUPER));
  assert.equal(rbac.canAccess(SUPER, PLATFORM_COMPLIANCE_ROUTE), true);
  const repo = new FallbackRepository();
  await createErasureRequest(repo, {
    schoolCode: "CD-2026-0001",
    identifier: "ident-a07-a1",
    email: "pii.a1@example.test",
    reason: "reason-secret",
  });
  const payload = await getPlatformCompliance(repo, SUPER);
  assert.equal(payload.scope, "platform");
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /ident-a07-a1|pii\.a1|reason-secret|CD-2026-0001|example\.test/);
});

test("A07-21 Country A1 denied (C06B1-05)", () => {
  assert.equal(rbac.canAccess(COUNTRY, PLATFORM_COMPLIANCE_ROUTE), false);
  assert.throws(() => assertPlatformComplianceRead(COUNTRY), (error) => error.statusCode === 403);
  assert.throws(() => assertPlatformComplianceRead(SCHOOL_A), (error) => error.statusCode === 403);
});

test("A07-22 alias rôle n'altère pas roleKey (DL-11 / ADMIN-02B)", async () => {
  assert.equal(toRoleKey("Directeur"), "PRINCIPAL");
  assert.notEqual(toRoleKey("Directeur"), "SCHOOL_ADMIN");
  const store = createEstablishmentRolesMemoryStore({
    roles: [
      {
        id: "role-principal",
        roleCode: "PRINCIPAL",
        roleName: "Directeur",
        scope: "school",
        schoolAssignable: true,
      },
    ],
  });
  const repo = {
    getEstablishmentRolesStore: () => store,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async () => true,
  };
  const saved = await updateRoleDisplayLabel(repo, "role-principal", { displayLabel: "Admin School" }, SUPER, {});
  assert.equal(saved.roleKey, "PRINCIPAL");
  assert.equal(saved.roleName, "Directeur");
  assert.equal(saved.displayLabel, "Admin School");
  const row = await store.getRoleById("role-principal");
  assert.equal(row.roleCode, "PRINCIPAL");
  assert.equal(toRoleKey("Directeur"), "PRINCIPAL");
});

test("A07-23 display_label n'altère pas permission (DL-18 / U04-18)", () => {
  const effectiveLabel = resolveEffectiveRoleLabel({
    defaultLabel: "Directeur",
    displayLabel: "Audit:READ",
  });
  assert.equal(effectiveLabel, "Audit:READ");
  assert.equal(
    rbac.canAccess(
      {
        role: "Directeur",
        roleKeys: ["PRINCIPAL"],
        permissions: [],
        displayLabel: "Audit:READ",
        schoolCode: "CD-2026-0001",
      },
      "GET /api/audit",
    ),
    false,
  );
  const resolved = resolveEffectivePermissionSet(["PRINCIPAL"], [], { schoolId: "nuru", countryId: "cd" });
  assert.equal(resolved.permissions.includes("Audit:READ"), false);
});

test("A07-24 override RBAC school (ADMIN-01 DENY école)", async () => {
  const { repo, rbacStore } = rbacMemoryRepo();
  await rbacStore.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    countryId: null,
    schoolId: null,
    moduleKey: "students",
    canCreate: false,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    updatedBy: "bootstrap",
  });
  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "students", canCreate: false, canRead: false, canUpdate: false, canDelete: false }],
    },
    SUPER,
    {},
  );
  const schoolRow = (
    await rbacStore.listGrantsForScope({
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      countryId: "cd",
      schoolId: "nuru",
    })
  ).find((row) => row.moduleKey === "students");
  assert.ok(schoolRow);
  assert.equal(schoolRow.canRead, false);
  const matrix = await getConfiguredPermissions(
    repo,
    { roleKey: "PREFET_ETUDES", countryCode: "CD", schoolCode: "CD-2026-0001" },
    SUPER,
  );
  const students = matrix.modules.find((row) => row.moduleKey === "students");
  assert.equal(students.canRead, false);
  assert.equal(students.source, "school");
});

test("A07-25 reset override (ADMIN-01 reset)", async () => {
  const { repo, rbacStore } = rbacMemoryRepo();
  await rbacStore.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    countryId: null,
    schoolId: null,
    moduleKey: "students",
    canCreate: false,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    updatedBy: "bootstrap",
  });
  const created = await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: false, canDelete: false }],
    },
    SUPER,
    {},
  );
  const reset = await resetConfiguredPermissionOverrides(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      moduleKey: "students",
      expectedUpdatedAt: created.updatedAt,
    },
    SUPER,
    {},
  );
  const students = reset.modules.find((row) => row.moduleKey === "students");
  assert.equal(students.source, "global");
  assert.equal(students.configured, false);
  assert.equal(students.canUpdate, true);
  const schoolRows = await rbacStore.listGrantsForScope({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
  });
  assert.equal(schoolRows.find((row) => row.moduleKey === "students"), undefined);
});

test("A07-26 deny par défaut (C06C-RBAC / pickGrant vide)", () => {
  const resolved = resolveEffectivePermissionSet(["SECRETARY"], [], { schoolId: "nuru", countryId: "cd" });
  assert.equal(resolved.permissions.includes("Audit:READ"), false);
  assert.deepEqual(resolved.modules.audit, {
    canCreate: false,
    canRead: false,
    canUpdate: false,
    canDelete: false,
  });
  assert.equal(rbac.canAccess(SCHOOL_A, "GET /api/audit"), false);
});

test("A07-27 relations cross-school denied (R03B-06)", async () => {
  const store = seedRelationsStore();
  const contact = await store.createContact(
    { firstName: "Baudouin", lastName: "OKITO", contactType: "Parent", phone: "+243811111111" },
    SCHOOL_A,
    AUDIT_META,
  );
  const created = await store.createRelation(
    { fromContactId: contact.id, toStudentId: "student-a", isPrincipal: "Oui" },
    SCHOOL_A,
    AUDIT_META,
  );
  await assert.rejects(
    () => store.archiveRelation(created.relation.id, SCHOOL_B, AUDIT_META),
    (error) => forbidden(error, CLIENTS_ERROR.TENANT_MISMATCH),
  );
});

test("A07-28 utilisateurs cross-school denied (U04-02/14)", async () => {
  const store = seedUsersStore();
  const local = await store.provisionUser(
    {
      firstName: "Local",
      lastName: "Admin",
      email: "a07.local@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
    },
    SUPER,
    AUDIT_META,
  );
  await store.provisionUser(
    {
      firstName: "Foreign",
      lastName: "Admin",
      email: "a07.foreign@test.local",
      temporaryPassword: "SchoolAdmin!2026",
      roleKey: "SCHOOL_ADMIN",
      countryCode: "BI",
      schoolCode: "BI-2026-0002",
    },
    SUPER,
    AUDIT_META,
  );
  const schoolAUsers = {
    ...SCHOOL_A,
    usersLoginCode: "CD-IN-26-001",
    usersSchoolId: "school-a",
    countryCode: "CD",
  };
  const listed = store.listUsers(resolveUsersSchoolScope(schoolAUsers));
  assert.ok(listed.some((row) => String(row.id) === String(local.id)));
  assert.ok(!listed.some((row) => String(row.email) === "a07.foreign@test.local"));
  await assert.rejects(
    () => store.reassignUserSchool(local.id, { schoolCode: "BI-2026-0002" }, schoolAUsers, AUDIT_META),
    (error) => error.statusCode === 403,
  );
});

test("A07-29 documents cross-school denied (D05-12)", async () => {
  const { repo } = seedDocumentsRepo();
  await createSchoolDocument(
    repo,
    { title: "Doc B", documentType: "attestation", studentId: "student-b" },
    SCHOOL_B,
    AUDIT_META,
  );
  const listedA = await listSchoolDocuments(repo, SCHOOL_A);
  assert.equal(listedA.some((row) => row.title === "Doc B"), false);
});

test("A07-30 aucun ALL_PRIVILEGES ne contourne les protections école (P0-2)", () => {
  const allPrivSchool = {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["ALL_PRIVILEGES"],
    schoolCode: "*",
  };
  for (const route of SCHOOL_PII_ROUTES) {
    assert.equal(isPlatformPersonalDataForbidden(SUPER, route), true, route);
    assert.equal(rbac.canAccess(SUPER, route), false, route);
    assert.equal(rbac.canAccess({ ...SUPER, schoolCode: "CD-2026-0001" }, route), false, route);
  }
  assert.throws(() => assertSchoolAuditRead({ ...SUPER, permissions: ["ALL_PRIVILEGES", "Audit:READ"] }), (error) =>
    forbidden(error, AUDIT_ERROR.FORBIDDEN),
  );
  assert.throws(() => assertDataExportRead({ ...SUPER, permissions: ["ALL_PRIVILEGES", "Paramètres Établissement:READ"] }), (error) =>
    forbidden(error, DATA_EXPORT_ERROR.FORBIDDEN),
  );
  assert.throws(() => assertDataExportRead(allPrivSchool), (error) => forbidden(error, DATA_EXPORT_ERROR.FORBIDDEN));
  assert.throws(() => resolveSchoolComplianceScope(allPrivSchool), (error) => forbidden(error, PRIVACY_ERROR.FORBIDDEN));
});

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

test("A07-31 PermissionsPage n'a plus de sélecteur Module fonctionnel (ADMIN-02C / MATRIX-01)", () => {
  const page = readUtf8("../../web/src/pages/PermissionsPage.tsx");
  assert.doesNotMatch(page, /id="rbac-module"|Module fonctionnel|selectedModuleKey/);
  assert.match(page, /id="rbac-country"/);
  assert.match(page, /id="rbac-school"/);
  assert.match(page, /id="rbac-role"/);
});

test("A07-32 Pays + Établissement + Rôle → matrice complète (ADMIN-02C / MATRIX-02)", () => {
  const page = readUtf8("../../web/src/pages/PermissionsPage.tsx");
  assert.match(page, /const pathComplete = Boolean\(countryCode && schoolCode && selectedRoleKey\)/);
  assert.match(page, /data-testid="rbac-permissions-matrix"/);
  assert.match(page, /rbacApi\.getConfigured\(\{ roleKey: selectedRoleKey, countryCode, schoolCode \}\)/);
});

test("A07-33 31 modules du catalogue visibles dans une seule matrice (ADMIN-02C / MATRIX-03/04)", () => {
  const modules = listFunctionalModules();
  assert.equal(modules.length, 31);
  assert.ok(modules.some((row) => row.moduleKey === "users"));
  assert.ok(modules.some((row) => row.moduleKey === "students"));
  assert.ok(modules.some((row) => row.moduleKey === "classes"));
  assert.ok(modules.some((row) => row.moduleKey === "audit"));
  const page = readUtf8("../../web/src/pages/PermissionsPage.tsx");
  assert.match(page, /matrixModules\.map/);
  assert.match(page, /sortModules\(matrix\?\.modules \?\? \[\], catalog\?\.modules \?\? \[\]\)/);
});

test("A07-34 édition de plusieurs modules → un seul PATCH grants[] (ADMIN-02C / MATRIX-06/07)", () => {
  const page = readUtf8("../../web/src/pages/PermissionsPage.tsx");
  assert.match(page, /const grants = dirtyModuleKeys\.map/);
  assert.match(page, /rbacApi\.patchPermissions\(\{[\s\S]*grants,/);
  assert.doesNotMatch(page, /for \(const moduleKey of dirtyModuleKeys\) \{\s*await rbacApi\.patchPermissions/);
});

test("A07-35 reset d'une ligne ne détruit pas les drafts dirty des autres modules (ADMIN-02C / MATRIX-17A/17B)", () => {
  const page = readUtf8("../../web/src/pages/PermissionsPage.tsx");
  assert.match(page, /const preservedDirtyDrafts = dirtyModuleKeys\.reduce/);
  assert.match(page, /if \(dirtyModuleKey !== moduleKey && draftByModule\[dirtyModuleKey\]\)/);
  assert.match(page, /for \(const \[dirtyModuleKey, preservedDraft\] of Object\.entries\(preservedDirtyDrafts\)\)/);
});

test("A07-36 reset met à jour expectedUpdatedAt pour le PATCH suivant (ADMIN-02C / MATRIX-18B)", () => {
  const page = readUtf8("../../web/src/pages/PermissionsPage.tsx");
  assert.match(page, /expectedUpdatedAt: matrix\?\.updatedAt \?\? null/);
  assert.match(page, /const next = await rbacApi\.resetOverride/);
  assert.match(page, /setMatrix\(next\)/);
});
