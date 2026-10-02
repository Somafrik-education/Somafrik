"use strict";

/**
 * ADMIN-06A — caractérisation Conformité (autorité, périmètre, workflows).
 * Aucune correction. Les assertions décrivent l'état réel, y compris
 * GET /api/audit inaccessible à tous les profils typiques.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FallbackRepository } = require("../db/fallbackRepository");
const { RbacService, routePermissions } = require("../services/rbacService");
const {
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  PLATFORM_PERSONAL_DATA_DENY,
  isPlatformPersonalDataForbidden,
  isPlatformPersonalDataForbiddenHttp,
} = require("./platformPersonalDataGuard");
const {
  createErasureRequest,
  executeErasureRequest,
  executeSelfErasure,
} = require("./privacyErasure");
const {
  assertDataExportRead,
  resolveExportSchoolCode,
  DATA_EXPORT_ERROR,
} = require("./dataExportManagement");

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

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
  sub: "USER-ADMIN1",
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Utilisateurs:READ", "Utilisateurs:UPDATE", "Paramètres Établissement:READ", "Rapports:READ"],
  schoolCode: "CD-2026-0001",
};

const SCHOOL_AUDIT_READ = {
  sub: "USER-AUDIT",
  role: "Secrétaire",
  roleKeys: ["SECRETARY"],
  permissions: ["Audit:READ"],
  schoolCode: "CD-2026-0001",
};

const rbac = new RbacService();
const serverSrc = readUtf8("../server.js");
const schemaSrc = readUtf8("../db/schema.sql");
const privacySrc = readUtf8("./privacyErasure.js");
const exportServiceSrc = readUtf8("./dataExportService.js");
const exportSnapshotSrc = readUtf8("./dataExportSnapshot.js");
const pgSrc = readUtf8("../db/postgresRepository.js");
const auditHandler = serverSrc.slice(
  serverSrc.indexOf('app.get("/api/audit"'),
  serverSrc.indexOf('app.get("/api/v2/subjects"'),
);
const advancedHandler = serverSrc.slice(
  serverSrc.indexOf('app.get("/api/v2/reports/advanced"'),
  serverSrc.indexOf('app.get("/api/mvp/readiness"'),
);

function expectedAuditHttp(principal) {
  if (isPlatformPersonalDataForbiddenHttp(principal, "GET", "/api/audit")) {
    return { status: 403, code: PLATFORM_PERSONAL_DATA_DENY, layer: "requireAuth.guard" };
  }
  if (!rbac.canAccess(principal, "GET /api/audit")) {
    return { status: 403, code: "PERMISSION_DENIED", layer: "requirePermission" };
  }
  if (principal.role !== "Super Administrateur Somafrik" && principal.role !== "Admin Pays") {
    return { status: 403, code: "HANDLER_PLATFORM_ONLY", layer: "handler" };
  }
  return { status: 200, code: null, layer: "repository.getAuditLogs" };
}

test("C06A-01 ReportsPage school = MVP_COVERAGE ; Superadmin = A1 (ADMIN-06B1)", () => {
  const page = readUtf8("../../web/src/pages/ReportsPage.tsx");
  const constants = readUtf8("../../web/src/lib/constants.ts");
  assert.match(page, /import \{ MVP_COVERAGE \} from "\.\.\/lib\/constants"/);
  assert.match(page, /MVP_COVERAGE/);
  assert.match(page, /getPlatformCompliance/);
  assert.doesNotMatch(page, /erasure-requests|\/api\/audit|data-export|reports\/advanced/);
  assert.match(constants, /export const MVP_COVERAGE/);
  assert.match(constants, /Authentification par établissement/);
});

test("C06A-AUD-01 SUPER_ADMIN GET /api/audit → 403 guard", () => {
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/audit"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/audit"), true);
  assert.equal(isPlatformPersonalDataForbidden(SUPER, "GET /api/audit"), true);
  assert.deepEqual(routePermissions["GET /api/audit"], ["Audit:READ", "ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"]);
  assert.equal(rbac.canAccess(SUPER, "GET /api/audit"), false);
  assert.match(auditHandler, /isSuperAdminPrincipal\(req\.principal\)/);
  const result = expectedAuditHttp(SUPER);
  assert.equal(result.status, 403);
  assert.equal(result.code, PLATFORM_PERSONAL_DATA_DENY);
  assert.equal(result.layer, "requireAuth.guard");
});

test("C06A-AUD-02 COUNTRY_ADMIN GET /api/audit → 403 guard", () => {
  assert.equal(isPlatformPersonalDataForbiddenHttp(COUNTRY, "GET", "/api/audit"), true);
  assert.equal(rbac.canAccess(COUNTRY, "GET /api/audit"), false);
  const result = expectedAuditHttp(COUNTRY);
  assert.equal(result.status, 403);
  assert.equal(result.code, PLATFORM_PERSONAL_DATA_DENY);
  assert.equal(result.layer, "requireAuth.guard");
});

test("C06A-AUD-03 SCHOOL_ADMIN GET /api/audit → 403 RBAC", () => {
  assert.equal(isPlatformPersonalDataForbiddenHttp(SCHOOL_ADMIN, "GET", "/api/audit"), false);
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, "GET /api/audit"), false);
  const result = expectedAuditHttp(SCHOOL_ADMIN);
  assert.equal(result.status, 403);
  assert.equal(result.code, "PERMISSION_DENIED");
  assert.equal(result.layer, "requirePermission");
});

test("C06A-AUD-04 rôle établissement Audit:READ GET /api/audit → 403 handler", () => {
  assert.equal(isPlatformPersonalDataForbiddenHttp(SCHOOL_AUDIT_READ, "GET", "/api/audit"), false);
  assert.equal(rbac.canAccess(SCHOOL_AUDIT_READ, "GET /api/audit"), true);
  assert.match(auditHandler, /Seuls les administrateurs habilités peuvent consulter l'audit/);
  const result = expectedAuditHttp(SCHOOL_AUDIT_READ);
  assert.equal(result.status, 403);
  assert.equal(result.code, "HANDLER_PLATFORM_ONLY");
  assert.equal(result.layer, "handler");
});

test("C06A-05 / C06A-06 / C06A-07 GET /api/audit résultat réel = 403 partout", () => {
  for (const principal of [SUPER, COUNTRY, SCHOOL_ADMIN, SCHOOL_AUDIT_READ]) {
    assert.equal(expectedAuditHttp(principal).status, 403, principal.role);
  }
  assert.match(auditHandler, /n'est pas un journal plateforme/);
});

test("C06A-08 audit_logs peut contenir des données établissement", () => {
  assert.match(schemaSrc, /CREATE TABLE IF NOT EXISTS audit_logs \([\s\S]*school_id UUID/);
  assert.match(schemaSrc, /old_value JSONB/);
  assert.match(schemaSrc, /new_value JSONB/);
  assert.match(schemaSrc, /ip_address TEXT/);
  assert.match(schemaSrc, /user_agent TEXT/);
  const clients = readUtf8("./clientsService.js");
  assert.match(clients, /hydrateUser\(saved, roleKeys\)/);
  assert.match(clients, /mapContactRow\(/);
  const docs = readUtf8("./documentsExamsManagement.js");
  assert.match(docs, /studentId: doc\.studentId/);
  assert.doesNotMatch(docs, /storageKey: doc\.storageKey/);
  const rbacMgmt = readUtf8("./functionalRbacManagement.js");
  assert.match(rbacMgmt, /"password"/);
  assert.match(rbacMgmt, /"jwt"/);
  assert.doesNotMatch(rbacMgmt.slice(rbacMgmt.indexOf("FORBIDDEN_AUDIT_KEYS"), rbacMgmt.indexOf("SUPER_ADMIN_INVARIANT")), /"email"/);
  assert.match(pgSrc, /SELECT a\.\*, s\.school_code, u\.user_code, u\.first_name, u\.last_name/);
});

test("C06A-09 plateforme ne peut pas exécuter l'effacement école", async () => {
  const repo = new FallbackRepository();
  const created = await createErasureRequest(repo, {
    schoolCode: "CD-2026-0001",
    identifier: "admin",
  });
  await assert.rejects(
    () => executeErasureRequest(repo, created.id, SUPER),
    (error) => error.statusCode === 403 && error.code === "PRIVACY_REQUEST_FORBIDDEN",
  );
  await assert.rejects(
    () => executeErasureRequest(repo, created.id, COUNTRY),
    (error) => error.statusCode === 403 && error.code === "PRIVACY_REQUEST_FORBIDDEN",
  );
  assert.match(privacySrc, /Un administrateur plateforme ne peut pas exécuter l'effacement/);
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("POST /api/privacy/erasure-requests/:requestId/execute"), true);
});

test("C06A-10 school tenant ne voit pas les demandes d'une autre école", async () => {
  const repo = new FallbackRepository();
  await createErasureRequest(repo, { schoolCode: "CD-2026-0001", identifier: "admin-a" });
  await createErasureRequest(repo, { schoolCode: "BI-2026-0002", identifier: "admin-b" });
  const cd = await repo.listPrivacyRequests({ schoolCode: "CD-2026-0001" });
  const bi = await repo.listPrivacyRequests({ schoolCode: "BI-2026-0002" });
  assert.equal(cd.length, 1);
  assert.equal(bi.length, 1);
  assert.equal(cd[0].school_code, "CD-2026-0001");
  assert.equal(bi[0].school_code, "BI-2026-0002");
  assert.match(serverSrc, /listPrivacyRequests\(\{ schoolCode \}\)/);
  assert.match(serverSrc, /if \(!schoolCode \|\| schoolCode === "\*"\)/);
});

test("C06A-11 self-erasure est distinct du workflow admin", async () => {
  assert.match(serverSrc, /app\.post\("\/api\/privacy\/erasure-requests\/self\/execute", requireAuth/);
  assert.equal(
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("POST /api/privacy/erasure-requests/self/execute"),
    false,
  );
  assert.match(privacySrc, /async function executeSelfErasure/);
  assert.match(privacySrc, /return executeErasureRequest\(repository, created\.id, principal\)/);
  const repo = new FallbackRepository();
  const seedData = require("../data");
  const account = seedData.userAccounts.find((row) => row.id === "USER-ADMIN1");
  const snapshot = { ...account, history: [...(account.history ?? [])] };
  try {
    const result = await executeSelfErasure(repo, {
      sub: "USER-ADMIN1",
      identifier: "admin",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
    });
    assert.equal(result.request.status, "processed");
    assert.equal(result.schoolRecordsRetained, true);
    assert.equal(result.accountAnonymized, true);
  } finally {
    Object.assign(account, snapshot);
  }
});

test("C06A-12 data-export scope réel caractérisé", () => {
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/data-export"), true);
  assert.throws(
    () => assertDataExportRead(SUPER),
    (error) => error.statusCode === 403 && error.code === DATA_EXPORT_ERROR.FORBIDDEN,
  );
  assert.throws(
    () => assertDataExportRead(COUNTRY),
    (error) => error.statusCode === 403 && error.code === DATA_EXPORT_ERROR.FORBIDDEN,
  );
  assert.doesNotThrow(() => assertDataExportRead(SCHOOL_ADMIN));
  assert.equal(resolveExportSchoolCode(SCHOOL_ADMIN, "BI-2026-0002"), "CD-2026-0001");
  assert.match(exportServiceSrc, /includeAudit: isSuperAdminPrincipal\(principal\)/);
  assert.match(exportServiceSrc, /action: "export_school_data"/);
  assert.match(exportSnapshotSrc, /domains\.schoolSettings/);
  assert.match(exportSnapshotSrc, /domains\.students/);
  assert.match(exportSnapshotSrc, /domains\.classes/);
  assert.match(exportSnapshotSrc, /domains\.teachers/);
  assert.match(exportSnapshotSrc, /firstName: row\.first_name/);
});

test("C06A-13 advanced reports scope réel caractérisé", () => {
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/v2/reports/advanced"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/v2/reports/advanced"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(COUNTRY, "GET", "/api/v2/reports/advanced"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SCHOOL_ADMIN, "GET", "/api/v2/reports/advanced"), false);
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, "GET /api/v2/reports/advanced"), true);
  assert.equal(rbac.canAccess(SUPER, "GET /api/v2/reports/advanced"), false);
  assert.match(advancedHandler, /getAdvancedReportsForPrincipal/);
  assert.match(advancedHandler, /principal: req\.principal/);
  assert.match(pgSrc, /async getAdvancedReportsV2\(schoolId\)/);
  const start = pgSrc.indexOf("async getAdvancedReportsV2(schoolId)");
  const query = pgSrc.slice(start, pgSrc.indexOf("mapCountry(country)", start));
  assert.match(query, /FROM grades/);
  assert.match(query, /WHERE g\.school_id = \$1/);
  assert.match(query, /WHERE school_id = \$1/);
  assert.match(query, /WHERE ex\.school_id = \$1/);
  assert.match(query, /FROM students WHERE school_id = \$1/);
});

test("C06A-14 routes confidentialité / suppression cohérentes", () => {
  const app = readUtf8("../../web/src/App.tsx");
  const legal = readUtf8("../../web/src/pages/LegalPages.tsx");
  assert.match(app, /path="\/confidentialite" element=\{<PrivacyPolicyPage \/>\}/);
  assert.match(app, /path="\/suppression-compte" element=\{<AccountDeletionPage \/>\}/);
  assert.match(legal, /\/api\/privacy\/erasure-requests/);
  assert.match(legal, /to="\/suppression-compte"/);
  assert.doesNotMatch(legal, /old_value|storageKey|signed URL|access_token/i);
  assert.match(legal, /Ne transmettez jamais votre mot de passe ou votre code PIN/);
  assert.match(serverSrc, /app\.post\("\/api\/privacy\/erasure-requests", loginRateLimiter/);
  assert.doesNotMatch(
    serverSrc.slice(serverSrc.indexOf('app.post("/api/privacy/erasure-requests"'), serverSrc.indexOf('app.post("/api/public/trial-requests"')),
    /requireAuth/,
  );
});

test("C06A-15 aucun endpoint conformité plateforme non-PII canonique", () => {
  assert.doesNotMatch(serverSrc, /app\.(get|post)\("\/api\/(compliance|platform-compliance|conformite)/);
  assert.doesNotMatch(serverSrc, /nonPiiCompliance|platformGovernanceCompliance/);
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/audit"), true);
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/privacy/erasure-requests"), true);
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/data-export"), true);
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/v2/reports/advanced"), true);
});

test("C06A privacy_requests : statuts schéma vs runtime", () => {
  assert.match(schemaSrc, /CONSTRAINT privacy_requests_status_check CHECK \(status IN \('pending', 'processed', 'rejected'\)\)/);
  assert.match(schemaSrc, /CONSTRAINT privacy_requests_type_check CHECK \(request_type IN \('erasure', 'access', 'rectification'\)\)/);
  assert.match(privacySrc, /requestType: "erasure"/);
  assert.match(privacySrc, /status: "pending"/);
  assert.match(privacySrc, /status: "processed"/);
  assert.doesNotMatch(privacySrc, /rejected|cancelled|access|rectification/);
});
