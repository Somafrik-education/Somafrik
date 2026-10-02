"use strict";

/**
 * ADMIN-06B2 — Conformité établissement A2 school-only.
 * C06B2-01 → C06B2-28 (service / RBAC / guard / source) + fallback parity.
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
const {
  createErasureRequest,
  executeErasureRequest,
  PRIVACY_ERROR,
} = require("./privacyErasure");
const { listSchoolPrivacyRequests, resolveSchoolComplianceScope } = require("./schoolCompliance");
const { getPlatformCompliance } = require("./platformCompliance");
const { exportSchoolData } = require("./dataExportService");
const { assertDataExportRead, resolveExportSchoolCode } = require("./dataExportManagement");

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
  permissions: ["Rapports:READ", "Utilisateurs:READ", "Utilisateurs:UPDATE", "Paramètres Établissement:READ"],
  schoolCode: "CD-2026-0001",
};

const SCHOOL_B = {
  sub: "admin-b",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Rapports:READ", "Utilisateurs:READ", "Utilisateurs:UPDATE", "Paramètres Établissement:READ"],
  schoolCode: "BI-2026-0002",
};

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

async function seedRequests(repo) {
  const aPending = await createErasureRequest(repo, {
    schoolCode: "CD-2026-0001",
    identifier: "ident-a-pending",
    email: "a.pending@example.test",
    reason: "reason-a-pending",
  });
  const aProcessed = await createErasureRequest(repo, {
    schoolCode: "CD-2026-0001",
    identifier: "ident-a-processed",
    email: "a.processed@example.test",
    reason: "reason-a-processed",
  });
  await executeErasureRequest(repo, aProcessed.id, SCHOOL_A);
  const bPending = await createErasureRequest(repo, {
    schoolCode: "BI-2026-0002",
    identifier: "ident-b-pending",
    email: "b.pending@example.test",
    reason: "reason-b-pending",
  });
  return { aPending, aProcessed, bPending };
}

test("C06B2-01 Superadmin conserve dashboard A1", () => {
  const page = readUtf8("../../web/src/pages/ReportsPage.tsx");
  assert.match(page, /PlatformComplianceDashboard/);
  assert.match(page, /getPlatformCompliance/);
  assert.match(page, /SchoolComplianceDashboard/);
  assert.doesNotMatch(page, /MVP_COVERAGE|SchoolMvpCoverageFacade/);
});

test("C06B2-02 Country Admin canReadView(reports) reste false", () => {
  const permissions = readUtf8("../../web/src/lib/permissions.ts");
  assert.match(permissions, /if \(feature && !COUNTRY_SCOPE_MODULES\.has\(feature\)\)/);
  assert.doesNotMatch(permissions, /feature !== "Rapports"/);
});

test("C06B2-04 / C06B2-05 / C06B2-06 isolation liste privacy", async () => {
  const repo = new FallbackRepository();
  const seeded = await seedRequests(repo);
  const listedA = await listSchoolPrivacyRequests(repo, SCHOOL_A);
  const listedB = await listSchoolPrivacyRequests(repo, SCHOOL_B);
  assert.equal(listedA.some((row) => row.id === seeded.aPending.id), true);
  assert.equal(listedA.some((row) => row.id === seeded.bPending.id), false);
  assert.equal(listedB.some((row) => row.id === seeded.bPending.id), true);
  assert.equal(listedB.some((row) => row.id === seeded.aPending.id), false);
  assert.equal(listedA.every((row) => row.schoolCode === "CD-2026-0001"), true);
  assert.equal(listedB.every((row) => row.schoolCode === "BI-2026-0002"), true);
});

test("C06B2-07 schoolCode client ne change pas scope liste", async () => {
  const repo = new FallbackRepository();
  await seedRequests(repo);
  const listed = await listSchoolPrivacyRequests(repo, SCHOOL_A);
  assert.equal(listed.every((row) => row.schoolCode === "CD-2026-0001"), true);
  const handler = readUtf8("../server.js").slice(
    readUtf8("../server.js").indexOf('app.get("/api/privacy/erasure-requests"'),
    readUtf8("../server.js").indexOf('app.post("/api/privacy/erasure-requests/self/execute"'),
  );
  assert.match(handler, /listSchoolPrivacyRequests\(repository, req\.principal\)/);
  assert.doesNotMatch(handler, /req\.query|req\.body|req\.headers/);
  const helper = readUtf8("./schoolCompliance.js");
  assert.doesNotMatch(helper, /req\.query|requestedSchoolCode|clientSchool/);
});

test("C06B2-14 cross-school execute → 403", async () => {
  const repo = new FallbackRepository();
  const seeded = await seedRequests(repo);
  await assert.rejects(
    () => executeErasureRequest(repo, seeded.bPending.id, SCHOOL_A),
    (error) => error.statusCode === 403 && error.code === PRIVACY_ERROR.FORBIDDEN,
  );
  const stillB = await repo.getPrivacyRequest(seeded.bPending.id);
  assert.equal(stillB.status, "pending");
});

test("C06B2 execute A pending → processed, fallback parity", async () => {
  const repo = new FallbackRepository();
  const seeded = await seedRequests(repo);
  const executed = await executeErasureRequest(repo, seeded.aPending.id, SCHOOL_A);
  assert.equal(executed.request.status, "processed");
  assert.equal(executed.schoolRecordsRetained, true);
  const listedB = await listSchoolPrivacyRequests(repo, SCHOOL_B);
  assert.equal(listedB.find((row) => row.id === seeded.bPending.id)?.status, "pending");
});

test("C06B2-24 / C06B2-25 / C06B2-26 export JWT + plateforme denied", () => {
  assert.equal(resolveExportSchoolCode(SCHOOL_A, "BI-2026-0002"), "CD-2026-0001");
  assert.throws(() => assertDataExportRead(SUPER), (error) => error.statusCode === 403);
  assert.throws(() => assertDataExportRead(COUNTRY), (error) => error.statusCode === 403);
  assert.throws(() => resolveSchoolComplianceScope(SUPER), (error) => error.statusCode === 403);
  assert.throws(() => resolveSchoolComplianceScope(COUNTRY), (error) => error.statusCode === 403);
  assert.throws(() => resolveSchoolComplianceScope({ ...SCHOOL_A, schoolCode: "*" }), (error) => error.statusCode === 403);
  assert.throws(() => resolveSchoolComplianceScope({ ...SCHOOL_A, schoolCode: "" }), (error) => error.statusCode === 403);
});

test("C06B2-27 A1 platform-compliance reste non-PII", async () => {
  const repo = new FallbackRepository();
  await seedRequests(repo);
  const payload = await getPlatformCompliance(repo, SUPER);
  assert.equal(payload.scope, "platform");
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /ident-a|ident-b|example\.test|reason-a|reason-b|CD-2026-0001|BI-2026-0002/);
});

test("C06B2-28 /api/audit inchangé / plateforme denied", () => {
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/audit"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/audit"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(COUNTRY, "GET", "/api/audit"), true);
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/privacy/erasure-requests"), true);
  assert.equal(
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("POST /api/privacy/erasure-requests/:requestId/execute"),
    true,
  );
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/data-export"), true);
});

test("C06B2 RBAC catalogue A2 inchangé", () => {
  assert.deepEqual(routePermissions["GET /api/privacy/erasure-requests"], ["Utilisateurs:READ", "Gérer utilisateurs"]);
  assert.deepEqual(routePermissions["POST /api/privacy/erasure-requests/:requestId/execute"], [
    "Utilisateurs:UPDATE",
    "Gérer utilisateurs",
  ]);
  assert.equal(rbac.canAccess(SUPER, "GET /api/privacy/erasure-requests"), false);
  assert.equal(rbac.canAccess(COUNTRY, "GET /api/data-export"), false);
  assert.equal(rbac.canAccess(SCHOOL_A, "GET /api/privacy/erasure-requests"), true);
});

test("C06B2 audit privacy_erasure / export_school_data sans secret", async () => {
  const repo = new FallbackRepository();
  const created = await createErasureRequest(repo, {
    schoolCode: "CD-2026-0001",
    identifier: "admin",
    email: "admin@example.test",
  });
  await executeErasureRequest(repo, created.id, SCHOOL_A);
  const audits = [...(repo.auditLogs?.values?.() ?? repo.audits ?? [])];
  const listed = typeof repo.getAuditLogs === "function" ? await repo.getAuditLogs({ schoolCode: "CD-2026-0001" }) : [];
  const rows = audits.length ? audits : listed;
  const erasure = rows.find((row) => (row.action ?? row.Action) === "privacy_erasure")
    ?? listed.find?.((row) => row.action === "privacy_erasure");
  const pgSrc = readUtf8("../db/postgresRepository.js");
  const fallbackSrc = readUtf8("../db/fallbackRepository.js");
  const exportSrc = readUtf8("./dataExportService.js");
  assert.match(pgSrc, /action: "privacy_erasure"/);
  assert.match(fallbackSrc, /action: "privacy_erasure"/);
  assert.match(pgSrc, /schoolRecordsRetained: true/);
  assert.match(pgSrc, /newValue: \{ requestId, sessionsRevoked, schoolRecordsRetained: true \}/);
  assert.doesNotMatch(
    pgSrc.slice(pgSrc.indexOf('action: "privacy_erasure"'), pgSrc.indexOf("return { request, sessionsRevoked")),
    /password|PIN|token|jwt/,
  );
  assert.match(exportSrc, /action: "export_school_data"/);
  assert.match(exportSrc, /includedDomains: envelope\.includedDomains/);
  assert.match(exportSrc, /generatedAt: envelope\.generatedAt/);
  assert.doesNotMatch(exportSrc, /domains: envelope\.domains/);
  if (erasure) {
    const payload = JSON.stringify(erasure);
    assert.doesNotMatch(payload, /password|PIN|jwt|token/i);
  }
});

test("C06B2 export A ignore query B — fallback", async () => {
  const repo = new FallbackRepository();
  const envelope = await exportSchoolData(repo, SCHOOL_A, "BI-2026-0002");
  assert.equal(envelope.schoolCode, "CD-2026-0001");
  assert.ok(Array.isArray(envelope.includedDomains));
});

test("C06B2 pas de nouvelle route compliance", () => {
  const serverSrc = readUtf8("../server.js");
  assert.doesNotMatch(serverSrc, /school-compliance-v2|compliance-school|privacy\/admin-v2/);
  assert.match(serverSrc, /app\.get\("\/api\/privacy\/erasure-requests"/);
  assert.match(serverSrc, /app\.post\("\/api\/privacy\/erasure-requests\/:requestId\/execute"/);
  assert.match(serverSrc, /app\.get\("\/api\/data-export"/);
});
