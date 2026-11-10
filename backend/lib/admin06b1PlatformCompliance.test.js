"use strict";

/**
 * ADMIN-06B1 — Conformité plateforme A1 non-PII.
 * C06B1-01 → C06B1-22 (couche service / RBAC / guard / source).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FallbackRepository } = require("../db/fallbackRepository");
const { RbacService, routePermissions } = require("../services/rbacService");
const {
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  PLATFORM_ADMIN_ALLOWED,
  isPlatformPersonalDataForbidden,
  isPlatformPersonalDataForbiddenHttp,
} = require("./platformPersonalDataGuard");
const {
  PLATFORM_COMPLIANCE_DENIED,
  PLATFORM_COMPLIANCE_ROUTE,
  PLATFORM_COMPLIANCE_KEY_PATHS,
  PLATFORM_COMPLIANCE_CAPABILITY_SURFACES,
  REQUIRED_PLATFORM_PROTECTION_ROUTES,
  assertPlatformComplianceRead,
  collectObjectKeyPaths,
  getPlatformCompliance,
} = require("./platformCompliance");

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

const SCHOOL_ADMIN = {
  sub: "admin-nuru",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Rapports:READ"],
  schoolCode: "CD-2026-0001",
};

const SCHOOL_ALL_PRIVILEGES = {
  sub: "admin-spoof",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "CD-2026-0001",
};

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

function expectedA1Http(principal) {
  if (!rbac.canAccess(principal, PLATFORM_COMPLIANCE_ROUTE)) {
    return { status: 403, code: "PERMISSION_DENIED", layer: "requirePermission" };
  }
  try {
    assertPlatformComplianceRead(principal);
    return { status: 200, code: null, layer: "service" };
  } catch (error) {
    return { status: error.statusCode ?? 403, code: error.code, layer: "service" };
  }
}

const FORBIDDEN_PII_KEYS = [
  "email",
  "contactEmail",
  "contact_email",
  "phone",
  "telephone",
  "name",
  "firstName",
  "lastName",
  "prenom",
  "nom",
  "userId",
  "user_id",
  "studentId",
  "student_id",
  "identifier",
  "requestCode",
  "request_code",
  "reason",
  "schoolCode",
  "school_code",
  "schoolId",
  "school_id",
  "oldValue",
  "old_value",
  "newValue",
  "new_value",
  "ipAddress",
  "ip_address",
  "userAgent",
  "user_agent",
  "jwt",
  "token",
  "secret",
];

test("C06B1-01 SUPER_ADMIN vue reports plateforme (pas feature Rapports)", () => {
  const access = readUtf8("../../web/src/lib/superAdminAccess.ts");
  assert.match(access, /SUPER_ADMIN_PLATFORM_VIEWS[\s\S]*"reports"/);
  assert.doesNotMatch(access, /SUPER_ADMIN_ALLOWED_FEATURES[\s\S]*"Rapports"/);
  assert.doesNotMatch(access, /"Rapports"/);
});

test("C06B1-02 COUNTRY_ADMIN reste hors Conformité", () => {
  const permissions = readUtf8("../../web/src/lib/permissions.ts");
  assert.match(permissions, /if \(feature && !COUNTRY_SCOPE_MODULES\.has\(feature\)\)/);
  assert.doesNotMatch(permissions, /feature !== "Rapports"/);
});

test("C06B1-03 SCHOOL_ADMIN Rapports:READ inchangé", () => {
  const defaults = readUtf8("../../web/src/lib/internalRoleDefaults.ts");
  assert.match(defaults, /"Admin School"[\s\S]*"Rapports:READ"/);
});

test("C06B1-04 SUPER_ADMIN endpoint A1 = 200", async () => {
  assert.deepEqual(routePermissions[PLATFORM_COMPLIANCE_ROUTE], ["ALL_PRIVILEGES"]);
  assert.equal(rbac.canAccess(SUPER, PLATFORM_COMPLIANCE_ROUTE), true);
  assert.equal(isPlatformPersonalDataForbidden(SUPER, PLATFORM_COMPLIANCE_ROUTE), false);
  assert.equal(PLATFORM_ADMIN_ALLOWED.includes(PLATFORM_COMPLIANCE_ROUTE), true);
  const result = expectedA1Http(SUPER);
  assert.equal(result.status, 200);
  const payload = await getPlatformCompliance(new FallbackRepository(), SUPER);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.scope, "platform");
});

test("C06B1-05 COUNTRY_ADMIN endpoint A1 = 403", () => {
  assert.equal(rbac.canAccess(COUNTRY, PLATFORM_COMPLIANCE_ROUTE), false);
  const result = expectedA1Http(COUNTRY);
  assert.equal(result.status, 403);
  assert.equal(result.code, "PERMISSION_DENIED");
  assert.throws(() => assertPlatformComplianceRead(COUNTRY), (error) => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, PLATFORM_COMPLIANCE_DENIED);
    return true;
  });
});

test("C06B1-06 SCHOOL_ADMIN endpoint A1 = 403", () => {
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, PLATFORM_COMPLIANCE_ROUTE), false);
  const result = expectedA1Http(SCHOOL_ADMIN);
  assert.equal(result.status, 403);
  assert.throws(() => assertPlatformComplianceRead(SCHOOL_ADMIN), (error) => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, PLATFORM_COMPLIANCE_DENIED);
    return true;
  });
});

test("C06B1-07 rôle école + ALL_PRIVILEGES artificiel = 403 service", () => {
  assert.equal(rbac.canAccess(SCHOOL_ALL_PRIVILEGES, PLATFORM_COMPLIANCE_ROUTE), true);
  const result = expectedA1Http(SCHOOL_ALL_PRIVILEGES);
  assert.equal(result.status, 403);
  assert.equal(result.code, PLATFORM_COMPLIANCE_DENIED);
  assert.equal(result.layer, "service");
});

test("C06B1-08 payload A1 whitelist exacte", async () => {
  const repo = new FallbackRepository();
  const extra = {
    getPlatformPrivacyRequestCounts: async () => ({
      total: 0,
      pending: 0,
      processed: 0,
      rejected: 0,
      identifier: "should-not-leak",
      schoolCode: "CD-2026-0001",
    }),
  };
  const payload = await getPlatformCompliance(extra, SUPER);
  const keys = collectObjectKeyPaths(payload).sort();
  assert.deepEqual(keys, [...PLATFORM_COMPLIANCE_KEY_PATHS].sort());
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "identifier"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.privacyRequests, "identifier"), false);
  const serviceSrc = readUtf8("./platformCompliance.js");
  assert.match(serviceSrc, /privacyRequests: Object\.freeze\(\{/);
  assert.match(serviceSrc, /total: asCount\(counts\.total\)/);
  assert.doesNotMatch(serviceSrc, /\.\.\.counts/);
});

test("C06B1-09 payload ne contient aucun email/phone/name/userId/studentId", async () => {
  const payload = await getPlatformCompliance(new FallbackRepository(), SUPER);
  const keys = collectObjectKeyPaths(payload);
  for (const forbidden of ["email", "phone", "name", "userId", "studentId", "firstName", "lastName"]) {
    assert.equal(keys.some((key) => key.toLowerCase().includes(forbidden.toLowerCase())), false, forbidden);
  }
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /email|phone|userId|studentId|firstName|lastName/i);
});

test("C06B1-10 payload ne contient aucun schoolId/schoolCode", async () => {
  const payload = await getPlatformCompliance(new FallbackRepository(), SUPER);
  const keys = collectObjectKeyPaths(payload);
  for (const forbidden of ["schoolId", "schoolCode", "school_id", "school_code"]) {
    assert.equal(keys.some((key) => key.toLowerCase() === forbidden.toLowerCase()), false, forbidden);
  }
  assert.doesNotMatch(JSON.stringify(payload), /schoolId|schoolCode|school_id|school_code/i);
});

test("C06B1-11 payload ne contient aucun oldValue/newValue", async () => {
  const payload = await getPlatformCompliance(new FallbackRepository(), SUPER);
  const keys = collectObjectKeyPaths(payload);
  for (const forbidden of ["oldValue", "newValue", "old_value", "new_value"]) {
    assert.equal(keys.includes(forbidden) || keys.some((key) => key.endsWith(`.${forbidden}`)), false, forbidden);
  }
});

test("C06B1-12 counts privacy = agrégats uniquement", async () => {
  const repo = new FallbackRepository();
  await repo.createPrivacyRequest({
    id: "prv-1",
    requestCode: "PRV-1",
    schoolCode: "CD-2026-0001",
    identifier: "alice.pii",
    contactEmail: "alice@example.test",
    reason: "supprimer mon compte",
    status: "pending",
  });
  await repo.createPrivacyRequest({
    id: "prv-2",
    requestCode: "PRV-2",
    schoolCode: "BI-2026-0002",
    identifier: "bob.pii",
    contactEmail: "bob@example.test",
    reason: "accès dossier",
    status: "processed",
  });
  await repo.createPrivacyRequest({
    id: "prv-3",
    requestCode: "PRV-3",
    schoolCode: "CD-2026-0001",
    identifier: "carol.pii",
    contactEmail: "carol@example.test",
    reason: "rectification",
    status: "rejected",
  });
  const counts = await repo.getPlatformPrivacyRequestCounts();
  assert.deepEqual(Object.keys(counts).sort(), ["pending", "processed", "rejected", "total"]);
  assert.deepEqual(counts, { total: 3, pending: 1, processed: 1, rejected: 1 });
  const payload = await getPlatformCompliance(repo, SUPER);
  assert.deepEqual(payload.privacyRequests, { total: 3, pending: 1, processed: 1, rejected: 1 });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /alice|bob|carol|example\.test|PRV-1|supprimer mon compte/);
});

test("C06B1-13 aucun listPrivacyRequests utilisé pour A1", () => {
  const serviceSrc = readUtf8("./platformCompliance.js");
  const pgSrc = readUtf8("../db/postgresRepository.js");
  const fallbackSrc = readUtf8("../db/fallbackRepository.js");
  const serverSrc = readUtf8("../server.js");
  const handler = serverSrc.slice(
    serverSrc.indexOf('app.get("/api/backoffice/platform-compliance"'),
    serverSrc.indexOf('app.get("/api/backoffice/notifications"'),
  );
  assert.doesNotMatch(serviceSrc, /listPrivacyRequests/);
  assert.doesNotMatch(handler, /listPrivacyRequests/);
  const pgMethod = pgSrc.slice(
    pgSrc.indexOf("async getPlatformPrivacyRequestCounts"),
    pgSrc.indexOf("async createTrialAccessRequest"),
  );
  assert.match(pgMethod, /COUNT\(\*\)/);
  assert.doesNotMatch(pgMethod, /listPrivacyRequests|identifier|contact_email|reason|request_code|user_id|school_id|GROUP BY/);
  const fallbackMethod = fallbackSrc.slice(
    fallbackSrc.indexOf("async getPlatformPrivacyRequestCounts"),
    fallbackSrc.indexOf("async createTrialAccessRequest"),
  );
  assert.doesNotMatch(fallbackMethod, /listPrivacyRequests/);
  assert.match(fallbackMethod, /return \{ total, pending, processed, rejected \}/);
});

test("C06B1-14 audit route reste plateforme-denied", () => {
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/audit"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/audit"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(COUNTRY, "GET", "/api/audit"), true);
});

test("C06B1-15 privacy details restent plateforme-denied", () => {
  assert.equal(
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/privacy/erasure-requests"),
    true,
  );
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/privacy/erasure-requests"), true);
});

test("C06B1-16 privacy execute école reste plateforme-denied", () => {
  assert.equal(
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(
      "POST /api/privacy/erasure-requests/:requestId/execute",
    ),
    true,
  );
  assert.equal(
    isPlatformPersonalDataForbiddenHttp(SUPER, "POST", "/api/privacy/erasure-requests/abc/execute"),
    true,
  );
});

test("C06B1-17 data-export reste plateforme-denied", () => {
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/data-export"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/data-export"), true);
});

test("C06B1-18 advanced reports reste plateforme-denied", () => {
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/v2/reports/advanced"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/v2/reports/advanced"), true);
});

test("C06B1 protections dérivées du guard, jamais la liste complète", async () => {
  const payload = await getPlatformCompliance(new FallbackRepository(), SUPER);
  for (const [flag, routeKey] of Object.entries(REQUIRED_PLATFORM_PROTECTION_ROUTES)) {
    assert.equal(payload.protections[flag], true, flag);
    assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(routeKey), true);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM"), false);
  assert.doesNotMatch(JSON.stringify(payload), /SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM/);
});

test("C06B1 capabilities correspondent aux surfaces produit", () => {
  const appSrc = readUtf8("../../web/src/App.tsx");
  const serverSrc = readUtf8("../server.js");
  assert.match(appSrc, /path="\/confidentialite"/);
  assert.match(appSrc, /path="\/suppression-compte"/);
  assert.match(serverSrc, /app\.post\("\/api\/privacy\/erasure-requests"/);
  assert.match(serverSrc, /app\.post\("\/api\/privacy\/erasure-requests\/self\/execute"/);
  assert.match(serverSrc, /app\.get\("\/api\/data-export"/);
  assert.equal(PLATFORM_COMPLIANCE_CAPABILITY_SURFACES.privacyPolicy, "/confidentialite");
  assert.equal(PLATFORM_COMPLIANCE_CAPABILITY_SURFACES.accountDeletionPage, "/suppression-compte");
  assert.equal(PLATFORM_COMPLIANCE_CAPABILITY_SURFACES.erasureRequestIntake, "POST /api/privacy/erasure-requests");
  assert.equal(PLATFORM_COMPLIANCE_CAPABILITY_SURFACES.selfErasure, "POST /api/privacy/erasure-requests/self/execute");
  assert.equal(PLATFORM_COMPLIANCE_CAPABILITY_SURFACES.schoolDataExport, "GET /api/data-export");
});

test("C06B1 service n'utilise aucun schoolCode query/body/header", () => {
  const serviceSrc = readUtf8("./platformCompliance.js");
  assert.doesNotMatch(serviceSrc, /schoolCode|schoolId|countryCode|req\.query|req\.body|req\.headers/);
  const serverSrc = readUtf8("../server.js");
  const handler = serverSrc.slice(
    serverSrc.indexOf('app.get("/api/backoffice/platform-compliance"'),
    serverSrc.indexOf('app.get("/api/backoffice/notifications"'),
  );
  assert.match(handler, /requireAuth/);
  assert.match(handler, /requirePermission\("GET \/api\/backoffice\/platform-compliance"\)/);
  assert.match(handler, /getPlatformCompliance\(repository, req\.principal\)/);
  assert.doesNotMatch(handler, /schoolCode|req\.query|req\.body/);
});

test("C06B1-08/15 no-PII scan fail-closed sur clés interdites", async () => {
  const payload = await getPlatformCompliance(new FallbackRepository(), SUPER);
  const keys = new Set(collectObjectKeyPaths(payload));
  for (const forbidden of FORBIDDEN_PII_KEYS) {
    assert.equal(keys.has(forbidden), false, forbidden);
    assert.equal([...keys].some((key) => key.split(".").pop() === forbidden), false, forbidden);
  }
});

test("C06B1 fallback agrège sans exposer l'objet privacy request", async () => {
  const repo = new FallbackRepository();
  await repo.createPrivacyRequest({
    id: "prv-mem",
    requestCode: "PRV-MEM",
    contactEmail: "secret@example.test",
    status: "pending",
  });
  const counts = await repo.getPlatformPrivacyRequestCounts();
  assert.deepEqual(counts, { total: 1, pending: 1, processed: 0, rejected: 0 });
  assert.equal(Object.keys(counts).includes("contact_email"), false);
  assert.equal(typeof counts.id, "undefined");
});
