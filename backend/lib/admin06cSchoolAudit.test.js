"use strict";

/**
 * ADMIN-06C — journal d’audit établissement school-only.
 * C06C-01 → C06C-19 (service / RBAC / guard / projection) + fallback parity.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FallbackRepository } = require("../db/fallbackRepository");
const { RbacService, routePermissions } = require("../services/rbacService");
const {
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  isPlatformPersonalDataForbiddenHttp,
} = require("./platformPersonalDataGuard");
const { getPlatformCompliance } = require("./platformCompliance");
const {
  AUDIT_ERROR,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  assertSchoolAuditRead,
  listSchoolAuditSummaries,
  projectAuditSummary,
  sanitizeAuditFilters,
} = require("./schoolAudit");
const { listFunctionalModules, getModuleByKey } = require("./functionalModulesCatalog");
const {
  resolveEffectivePermissionSet,
  parsePermissionStringsToModuleCrud,
} = require("./functionalRbacResolution");
const {
  listRbacCatalog,
  getEffectivePermissionsConfigured,
  patchConfiguredPermissions,
  resetConfiguredPermissionOverrides,
} = require("./functionalRbacService");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");
const { mandatoryPermissionsForRole } = require("./rbacMandatoryPermissions");
const { SUPER_ADMIN_INVARIANT_MODULES } = require("./functionalRbacManagement");

const rbac = new RbacService();

const SUPER = {
  sub: "super-1",
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
};

const COUNTRY = {
  sub: "pays-1",
  role: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES"],
  schoolCode: "*",
  countryCode: "CD",
};

const SCHOOL_A = {
  sub: "admin-a",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Rapports:READ"],
  schoolCode: "CD-2026-0001",
};

const SCHOOL_A_AUDIT = {
  ...SCHOOL_A,
  permissions: ["Rapports:READ", "Audit:READ"],
};

const SCHOOL_B_AUDIT = {
  sub: "admin-b",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Audit:READ"],
  schoolCode: "BI-2026-0002",
};

const SECRETARY_AUDIT = {
  sub: "sec-1",
  role: "Secrétaire",
  roleKeys: ["SECRETARY"],
  permissions: ["Audit:READ"],
  schoolCode: "CD-2026-0001",
};

const ALLOWED_KEYS = Object.freeze(["action", "actor", "createdAt", "entityId", "entityType", "id"]);
const FORBIDDEN_PAYLOAD = Object.freeze([
  "userId",
  "userCode",
  "schoolId",
  "schoolCode",
  "oldValue",
  "newValue",
  "old_value",
  "new_value",
  "ipAddress",
  "ip_address",
  "userAgent",
  "user_agent",
  "email",
  "phone",
  "password",
  "pin",
  "token",
  "jwt",
  "secret",
]);

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

function forbidden(error) {
  return error.statusCode === 403 && error.code === AUDIT_ERROR.FORBIDDEN;
}

function seedAuditRows(repo) {
  repo.auditLogs.push(
    {
      id: "AUD-A-1",
      schoolCode: "CD-2026-0001",
      userId: "USER-A",
      userCode: "USER-A",
      action: "user_update",
      entityType: "user",
      entityId: "USER-A",
      actorFirstName: "Admin",
      actorLastName: "Alpha",
      oldValue: { email: "alice.injected@c06c.test" },
      newValue: { phone: "+243600000001" },
      ipAddress: "203.0.113.10",
      userAgent: "Injected-UA-A",
      createdAt: "2026-10-03T12:00:00.000Z",
    },
    {
      id: "AUD-A-2",
      schoolCode: "CD-2026-0001",
      userId: null,
      action: "privacy_erasure",
      entityType: "privacy_request",
      entityId: "PRV-A",
      oldValue: { email: "alice.injected@c06c.test" },
      newValue: { phone: "+243600000001" },
      ipAddress: "203.0.113.10",
      userAgent: "Injected-UA-A",
      createdAt: "2026-10-03T11:00:00.000Z",
    },
    {
      id: "AUD-A-3",
      schoolCode: "CD-2026-0001",
      userId: "USER-A",
      action: "export_school_data",
      entityType: "school",
      entityId: "CD-2026-0001",
      actorFirstName: "Admin",
      actorLastName: "Alpha",
      oldValue: { email: "alice.injected@c06c.test" },
      newValue: { phone: "+243600000001" },
      ipAddress: "203.0.113.10",
      userAgent: "Injected-UA-A",
      createdAt: "2026-10-03T10:00:00.000Z",
    },
    {
      id: "AUD-B-1",
      schoolCode: "BI-2026-0002",
      userId: "USER-B",
      action: "user_update",
      entityType: "user",
      entityId: "USER-B",
      actorFirstName: "Admin",
      actorLastName: "Beta",
      oldValue: { email: "bob.injected@c06c.test" },
      newValue: { phone: "+243600000002" },
      ipAddress: "203.0.113.20",
      userAgent: "Injected-UA-B",
      createdAt: "2026-10-03T13:00:00.000Z",
    },
  );
}

function assertSafeProjection(rows) {
  assert.ok(Array.isArray(rows));
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [...ALLOWED_KEYS]);
    const serialized = JSON.stringify(row);
    for (const key of FORBIDDEN_PAYLOAD) {
      assert.equal(Object.hasOwn(row, key), false, key);
      assert.doesNotMatch(serialized, new RegExp(key, "i"));
    }
    assert.doesNotMatch(serialized, /alice\.injected|bob\.injected|\+24360000000|Injected-UA|203\.0\.113/);
  }
}

function expectedAuditHttp(principal) {
  if (isPlatformPersonalDataForbiddenHttp(principal, "GET", "/api/audit")) {
    return 403;
  }
  if (!rbac.canAccess(principal, "GET /api/audit")) {
    return 403;
  }
  try {
    assertSchoolAuditRead(principal);
    return 200;
  } catch {
    return 403;
  }
}

test("C06C-01 SUPER_ADMIN GET /api/audit → 403", () => {
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/audit"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/audit"), true);
  assert.equal(rbac.canAccess(SUPER, "GET /api/audit"), false);
  assert.throws(() => assertSchoolAuditRead(SUPER), forbidden);
  assert.equal(expectedAuditHttp(SUPER), 403);
});

test("C06C-02 COUNTRY_ADMIN GET /api/audit → 403", () => {
  assert.equal(isPlatformPersonalDataForbiddenHttp(COUNTRY, "GET", "/api/audit"), true);
  assert.equal(rbac.canAccess(COUNTRY, "GET /api/audit"), false);
  assert.throws(() => assertSchoolAuditRead(COUNTRY), forbidden);
  assert.equal(expectedAuditHttp(COUNTRY), 403);
});

test("C06C-03 SCHOOL_ADMIN sans Audit:READ → 403", () => {
  assert.equal(isPlatformPersonalDataForbiddenHttp(SCHOOL_A, "GET", "/api/audit"), false);
  assert.equal(rbac.canAccess(SCHOOL_A, "GET /api/audit"), false);
  assert.throws(() => assertSchoolAuditRead(SCHOOL_A), forbidden);
  assert.equal(expectedAuditHttp(SCHOOL_A), 403);
});

test("C06C-04 SCHOOL_ADMIN + Audit:READ → 200", async () => {
  assert.equal(rbac.canAccess(SCHOOL_A_AUDIT, "GET /api/audit"), true);
  assert.doesNotThrow(() => assertSchoolAuditRead(SCHOOL_A_AUDIT));
  assert.equal(expectedAuditHttp(SCHOOL_A_AUDIT), 200);
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  const rows = await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT);
  assert.ok(rows.length >= 1);
  assertSafeProjection(rows);
});

test("C06C-05 rôle non-SCHOOL_ADMIN + Audit:READ → 403 service", () => {
  assert.equal(rbac.canAccess(SECRETARY_AUDIT, "GET /api/audit"), true);
  assert.throws(() => assertSchoolAuditRead(SECRETARY_AUDIT), forbidden);
  assert.equal(expectedAuditHttp(SECRETARY_AUDIT), 403);
  for (const role of ["Proviseur", "Préfet des études", "Comptable", "Enseignant", "Parent", "Élève"]) {
    assert.throws(
      () =>
        assertSchoolAuditRead({
          role,
          permissions: ["Audit:READ"],
          schoolCode: "CD-2026-0001",
        }),
      forbidden,
      role,
    );
  }
});

test("C06C-06 schoolCode JWT absent → 403", () => {
  assert.throws(
    () => assertSchoolAuditRead({ ...SCHOOL_A_AUDIT, schoolCode: "" }),
    forbidden,
  );
  assert.throws(
    () => assertSchoolAuditRead({ ...SCHOOL_A_AUDIT, schoolCode: undefined }),
    forbidden,
  );
});

test("C06C-07 schoolCode * → 403", () => {
  assert.throws(
    () => assertSchoolAuditRead({ ...SCHOOL_A_AUDIT, schoolCode: "*" }),
    forbidden,
  );
});

test("C06C-08 école A voit uniquement logs A", async () => {
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  const rows = await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["AUD-A-1", "AUD-A-2", "AUD-A-3"],
  );
  assert.equal(rows.some((row) => row.id === "AUD-B-1"), false);
});

test("C06C-09 école B voit uniquement logs B", async () => {
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  const rows = await listSchoolAuditSummaries(repo, SCHOOL_B_AUDIT);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["AUD-B-1"],
  );
  assert.equal(rows.some((row) => row.id.startsWith("AUD-A")), false);
});

test("C06C-10 A + ?schoolCode=B → jamais B", async () => {
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  const rows = await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT, { schoolCode: "BI-2026-0002" });
  assert.equal(rows.some((row) => row.id === "AUD-B-1"), false);
  assert.equal(rows.every((row) => row.id.startsWith("AUD-A")), true);
  const handler = readUtf8("../server.js").slice(
    readUtf8("../server.js").indexOf('app.get("/api/audit"'),
    readUtf8("../server.js").indexOf('app.get("/api/v2/subjects"'),
  );
  assert.match(handler, /listSchoolAuditSummaries\(repository, req\.principal/);
  assert.doesNotMatch(handler, /req\.query\.schoolCode|req\.body\.schoolCode|req\.headers/);
});

test("C06C-11 projection whitelist exacte", async () => {
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  const rows = await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT);
  assertSafeProjection(rows);
  assert.deepEqual(Object.keys(projectAuditSummary({})).sort(), [...ALLOWED_KEYS]);
});

test("C06C-12 oldValue/newValue absents", async () => {
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  const serialized = JSON.stringify(await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT));
  assert.doesNotMatch(serialized, /oldValue|newValue|old_value|new_value/);
});

test("C06C-13 IP/userAgent absents", async () => {
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  const serialized = JSON.stringify(await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT));
  assert.doesNotMatch(serialized, /ipAddress|ip_address|userAgent|user_agent|203\.0\.113|Injected-UA/);
});

test("C06C-14 email/phone absents", async () => {
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  const serialized = JSON.stringify(await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT));
  assert.doesNotMatch(serialized, /email|phone|alice\.injected|\+24360000000/i);
});

test("C06C-15 password/PIN/token/JWT absents", async () => {
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  const serialized = JSON.stringify(await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT));
  assert.doesNotMatch(serialized, /password|pin|token|jwt|secret/i);
});

test("C06C-16 limit défaut 50", async () => {
  assert.equal(DEFAULT_LIMIT, 50);
  assert.equal(sanitizeAuditFilters({}).limit, 50);
  const repo = new FallbackRepository();
  for (let index = 0; index < 60; index += 1) {
    repo.auditLogs.push({
      id: `AUD-LIM-${index}`,
      schoolCode: "CD-2026-0001",
      action: "user_update",
      entityType: "user",
      entityId: String(index),
      createdAt: `2026-09-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    });
  }
  const rows = await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT);
  assert.equal(rows.length, 50);
});

test("C06C-17 limit >100 clamp à 100", async () => {
  assert.equal(MAX_LIMIT, 100);
  assert.equal(sanitizeAuditFilters({ limit: 250 }).limit, 100);
  const repo = new FallbackRepository();
  for (let index = 0; index < 120; index += 1) {
    repo.auditLogs.push({
      id: `AUD-MAX-${index}`,
      schoolCode: "CD-2026-0001",
      action: "user_update",
      entityType: "user",
      entityId: String(index),
      createdAt: `2026-08-01T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    });
  }
  const rows = await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT, { limit: 250 });
  assert.equal(rows.length, 100);
});

test("C06C-18 ordre createdAt DESC", async () => {
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  const rows = await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT);
  const stamps = rows.map((row) => String(row.createdAt));
  assert.deepEqual(stamps, [...stamps].sort().reverse());
});

test("C06C-19 filtre action reste tenant-scoped", async () => {
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  const rows = await listSchoolAuditSummaries(repo, SCHOOL_A_AUDIT, { action: "user_update" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "AUD-A-1");
  assert.equal(rows.some((row) => row.id === "AUD-B-1"), false);
});

test("C06C catalogue GET /api/audit = Audit:READ uniquement", () => {
  assert.deepEqual(routePermissions["GET /api/audit"], ["Audit:READ"]);
  assert.equal(routePermissions["GET /api/audit"].includes("ALL_PRIVILEGES"), false);
  assert.equal(routePermissions["GET /api/audit"].includes("COUNTRY_PRIVILEGES"), false);
  assert.equal(rbac.canAccess({ ...SCHOOL_A, permissions: ["ALL_PRIVILEGES"] }, "GET /api/audit"), false);
});

test("C06C SQL / fallback ne lisent pas old/new/IP/userAgent", () => {
  const pgSrc = readUtf8("../db/postgresRepository.js");
  const start = pgSrc.indexOf("async listSchoolAuditSummaries");
  const method = pgSrc.slice(start, pgSrc.indexOf("async getAuditLogs", start));
  assert.match(method, /SELECT a\.id, a\.action, a\.entity_type, a\.entity_id, a\.created_at/);
  assert.match(method, /INNER JOIN schools s ON s\.id = a\.school_id/);
  assert.match(method, /WHERE \$\{filters\.join\(" AND "\)\}/);
  assert.match(method, /a\.school_id = \$1/);
  assert.match(method, /ORDER BY a\.created_at DESC/);
  assert.doesNotMatch(method, /old_value|new_value|ip_address|user_agent|a\.\*/);
  const fallbackSrc = readUtf8("../db/fallbackRepository.js");
  const fallback = fallbackSrc.slice(
    fallbackSrc.indexOf("async listSchoolAuditSummaries"),
    fallbackSrc.indexOf("async getAuditLogs"),
  );
  assert.match(fallback, /row\.schoolCode === jwtSchool|toUpperCase\(\) === jwtSchool/);
  assert.doesNotMatch(fallback, /oldValue|newValue|ipAddress|userAgent/);
});

test("C06C lecture du journal n'écrit pas audit_logs", () => {
  const handler = readUtf8("../server.js").slice(
    readUtf8("../server.js").indexOf('app.get("/api/audit"'),
    readUtf8("../server.js").indexOf('app.get("/api/v2/subjects"'),
  );
  const service = readUtf8("./schoolAudit.js");
  assert.doesNotMatch(handler, /recordAudit/);
  assert.doesNotMatch(service, /recordAudit/);
});

test("C06C A2 privacy/export handlers restent inchangés", () => {
  const serverSrc = readUtf8("../server.js");
  assert.match(serverSrc, /listSchoolPrivacyRequests\(repository, req\.principal\)/);
  assert.match(serverSrc, /executeErasureRequest\(repository, req\.params\.requestId, req\.principal\)/);
  assert.match(serverSrc, /exportSchoolData\(\s*repository,\s*req\.principal,\s*req\.query\?\.schoolCode/);
  const privacy = serverSrc.slice(
    serverSrc.indexOf('app.get("/api/privacy/erasure-requests"'),
    serverSrc.indexOf('app.post("/api/privacy/erasure-requests/self/execute"'),
  );
  assert.doesNotMatch(privacy, /listSchoolAuditSummaries/);
});

test("C06C-24 A1 plateforme reste inchangé/non-PII", async () => {
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  const payload = await getPlatformCompliance(repo, SUPER);
  assert.equal(payload.scope, "platform");
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /alice\.injected|bob\.injected|AUD-A-1|CD-2026-0001|BI-2026-0002/);
  const serverSrc = readUtf8("../server.js");
  const a1 = serverSrc.slice(
    serverSrc.indexOf('app.get("/api/backoffice/platform-compliance"'),
    serverSrc.indexOf('app.get("/api/backoffice/notifications"'),
  );
  assert.match(a1, /getPlatformCompliance/);
  assert.doesNotMatch(a1, /listSchoolAuditSummaries|listPrivacyRequests/);
});

test("C06C pas de nouvelle permission ni grant Audit par défaut", () => {
  const rbacSrc = readUtf8("../services/rbacService.js");
  assert.match(rbacSrc, /"GET \/api\/audit": \["Audit:READ"\]/);
  const defaults = readUtf8("../../web/src/lib/internalRoleDefaults.ts");
  assert.doesNotMatch(defaults, /Audit:READ/);
  assert.equal(mandatoryPermissionsForRole("SCHOOL_ADMIN").audit, undefined);
  assert.equal(mandatoryPermissionsForRole("SUPER_ADMIN").audit, undefined);
  assert.equal(SUPER_ADMIN_INVARIANT_MODULES.audit, undefined);
});

test("C06C fallback schoolCode vide ou * fail closed", async () => {
  const repo = new FallbackRepository();
  seedAuditRows(repo);
  assert.deepEqual(await repo.listSchoolAuditSummaries({ schoolCode: "" }), []);
  assert.deepEqual(await repo.listSchoolAuditSummaries({ schoolCode: "*" }), []);
});

function auditRbacRepo() {
  const store = createFunctionalRbacMemoryStore({
    resolveCountryAndSchool: async ({ schoolCode }) => ({
      country: { id: "cd", code: "CD" },
      school: { id: "nuru", school_code: schoolCode || "CD-2026-0001", country_id: "cd", country_code: "CD" },
    }),
  });
  const repo = {
    getFunctionalRbacStore: () => store,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async () => true,
    listEstablishmentRoles: async () => [
      { id: "r-school", roleCode: "SCHOOL_ADMIN", roleName: "Admin School", scope: "school", status: "active" },
    ],
  };
  return { repo, store };
}

const SUPER_PRINCIPAL = {
  role: "Super Administrateur Somafrik",
  identifier: "superadmin",
  roleKeys: ["SUPER_ADMIN"],
};

test("C06C-RBAC-01 catalogue contient moduleKey audit / moduleName Audit", async () => {
  const module = getModuleByKey("audit");
  assert.equal(module.moduleKey, "audit");
  assert.equal(module.moduleName, "Audit");
  assert.equal(module.appliesWeb, true);
  assert.equal(module.appliesMobile, false);
  assert.ok(listFunctionalModules().some((row) => row.moduleKey === "audit" && row.moduleName === "Audit"));
  const { repo } = auditRbacRepo();
  const catalog = await listRbacCatalog(repo, SUPER_PRINCIPAL);
  const listed = catalog.modules.find((row) => row.moduleKey === "audit");
  assert.equal(listed.moduleName, "Audit");
  assert.equal(listed.appliesMobile, false);
});

test("C06C-RBAC-02 SCHOOL_ADMIN sans grant audit → pas Audit:READ", async () => {
  const resolved = resolveEffectivePermissionSet(["SCHOOL_ADMIN"], [], { schoolId: "nuru" });
  assert.equal(resolved.modules.audit.canRead, false);
  assert.equal(resolved.permissions.includes("Audit:READ"), false);
  const live = require("../data").rolePermissionsForLiveRbac();
  const parsed = parsePermissionStringsToModuleCrud(live["Admin School"] || []);
  assert.equal(parsed.audit.canRead, false);
  const { repo } = auditRbacRepo();
  const effective = await getEffectivePermissionsConfigured(
    repo,
    { roleKey: "SCHOOL_ADMIN", countryCode: "CD", schoolCode: "CD-2026-0001" },
    SUPER_PRINCIPAL,
  );
  assert.equal(effective.permissions.includes("Audit:READ"), false);
});

test("C06C-RBAC-03 grant établissement audit canRead=true → Audit:READ", async () => {
  const granted = resolveEffectivePermissionSet(
    ["SCHOOL_ADMIN"],
    [
      {
        roleKey: "SCHOOL_ADMIN",
        scopeType: "school",
        schoolId: "nuru",
        moduleKey: "audit",
        canCreate: false,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      },
    ],
    { schoolId: "nuru" },
  );
  assert.equal(granted.permissions.includes("Audit:READ"), true);
  const { repo } = auditRbacRepo();
  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "audit", canCreate: false, canRead: true, canUpdate: false, canDelete: false }],
    },
    SUPER_PRINCIPAL,
    {},
  );
  const effective = await getEffectivePermissionsConfigured(
    repo,
    { roleKey: "SCHOOL_ADMIN", countryCode: "CD", schoolCode: "CD-2026-0001" },
    SUPER_PRINCIPAL,
  );
  assert.equal(effective.permissions.includes("Audit:READ"), true);
  assert.doesNotThrow(() =>
    assertSchoolAuditRead({
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: effective.permissions,
      schoolCode: "CD-2026-0001",
    }),
  );
});

test("C06C-RBAC-04 canRead=false → pas Audit:READ", async () => {
  const denied = resolveEffectivePermissionSet(
    ["SCHOOL_ADMIN"],
    [
      {
        roleKey: "SCHOOL_ADMIN",
        scopeType: "school",
        schoolId: "nuru",
        moduleKey: "audit",
        canCreate: false,
        canRead: false,
        canUpdate: false,
        canDelete: false,
      },
    ],
    { schoolId: "nuru" },
  );
  assert.equal(denied.permissions.includes("Audit:READ"), false);
  const { repo } = auditRbacRepo();
  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "audit", canCreate: false, canRead: false, canUpdate: false, canDelete: false }],
    },
    SUPER_PRINCIPAL,
    {},
  );
  const effective = await getEffectivePermissionsConfigured(
    repo,
    { roleKey: "SCHOOL_ADMIN", countryCode: "CD", schoolCode: "CD-2026-0001" },
    SUPER_PRINCIPAL,
  );
  assert.equal(effective.permissions.includes("Audit:READ"), false);
});

test("C06C-RBAC-05 reset override → retour deny", async () => {
  const { repo } = auditRbacRepo();
  const saved = await patchConfiguredPermissions(
    repo,
    {
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "audit", canCreate: false, canRead: true, canUpdate: false, canDelete: false }],
    },
    SUPER_PRINCIPAL,
    {},
  );
  const reset = await resetConfiguredPermissionOverrides(
    repo,
    {
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      moduleKey: "audit",
      expectedUpdatedAt: saved.updatedAt,
    },
    SUPER_PRINCIPAL,
    {},
  );
  const audit = reset.modules.find((row) => row.moduleKey === "audit");
  assert.equal(audit.canRead, false);
  assert.equal(audit.configured, false);
  const effective = await getEffectivePermissionsConfigured(
    repo,
    { roleKey: "SCHOOL_ADMIN", countryCode: "CD", schoolCode: "CD-2026-0001" },
    SUPER_PRINCIPAL,
  );
  assert.equal(effective.permissions.includes("Audit:READ"), false);
});

test("C06C-RBAC-06 PermissionsPage expose Audit", () => {
  const page = readUtf8("../../web/src/pages/PermissionsPage.tsx");
  assert.match(page, /modules\.map\(\(module\) => \(\{ value: module\.moduleKey, label: module\.moduleName \}\)\)/);
  assert.match(page, /selectedModule\?\.moduleName/);
  const catalog = readUtf8("./functionalModulesCatalog.js");
  assert.match(catalog, /moduleKey: "audit"/);
  assert.match(catalog, /moduleName: "Audit"/);
});

test("C06C-RBAC-07 Audit:CREATE seul → GET /api/audit refusé", () => {
  const principal = {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Audit:CREATE"],
    schoolCode: "CD-2026-0001",
  };
  assert.equal(rbac.canAccess(principal, "GET /api/audit"), false);
  assert.throws(() => assertSchoolAuditRead(principal), forbidden);
});

test("C06C-RBAC-08 Audit:UPDATE seul → GET /api/audit refusé", () => {
  const principal = {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Audit:UPDATE"],
    schoolCode: "CD-2026-0001",
  };
  assert.equal(rbac.canAccess(principal, "GET /api/audit"), false);
  assert.throws(() => assertSchoolAuditRead(principal), forbidden);
});

test("C06C-RBAC-09 Audit:DELETE seul → GET /api/audit refusé", () => {
  const principal = {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Audit:DELETE"],
    schoolCode: "CD-2026-0001",
  };
  assert.equal(rbac.canAccess(principal, "GET /api/audit"), false);
  assert.throws(() => assertSchoolAuditRead(principal), forbidden);
});

test("C06C-RBAC-10 Audit:READ → autorisé pour SCHOOL_ADMIN", () => {
  const principal = {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Audit:READ"],
    schoolCode: "CD-2026-0001",
  };
  assert.equal(rbac.canAccess(principal, "GET /api/audit"), true);
  assert.doesNotThrow(() => assertSchoolAuditRead(principal));
  assert.throws(
    () =>
      assertSchoolAuditRead({
        ...principal,
        role: "Super Administrateur Somafrik",
        roleKeys: ["SUPER_ADMIN"],
        permissions: ["Audit:READ", "ALL_PRIVILEGES"],
        schoolCode: "*",
      }),
    forbidden,
  );
  assert.throws(
    () =>
      assertSchoolAuditRead({
        ...principal,
        role: "Admin Pays",
        roleKeys: ["COUNTRY_ADMIN"],
        permissions: ["Audit:READ", "COUNTRY_PRIVILEGES"],
        schoolCode: "*",
      }),
    forbidden,
  );
});

test("C06C-RBAC legacy Auditer connexions ne produit pas Audit:READ", () => {
  const parsedSuper = parsePermissionStringsToModuleCrud(["ALL_PRIVILEGES", "Auditer connexions"]);
  const parsedCountry = parsePermissionStringsToModuleCrud(["COUNTRY_PRIVILEGES", "Auditer utilisateurs pays"]);
  assert.equal(parsedSuper.audit.canRead, false);
  assert.equal(parsedCountry.audit.canRead, false);
});
