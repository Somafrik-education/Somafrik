"use strict";

/**
 * ADMIN-03A — audit de périmètre Relations.
 * Lecture seule du comportement actuel. Aucune mutation métier.
 * Ne pas modifier ce fichier pour « verdir » un élargissement Superadmin.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { RbacService, routePermissions } = require("../services/rbacService");
const { TenantScopeService } = require("../services/tenantScopeService");
const {
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  PLATFORM_ADMIN_ALLOWED,
  PLATFORM_PERSONAL_DATA_DENY,
  isPlatformPersonalDataForbidden,
  isPlatformPersonalDataForbiddenHttp,
  matchForbiddenPersonalDataRouteKey,
} = require("./platformPersonalDataGuard");
const { assertSchoolScope, CLIENTS_ERROR, mapRelationRow } = require("./clientsManagement");

const rbac = new RbacService();
const tenantScope = new TenantScopeService();

const RELATIONS_PERSONAL_ROUTES = Object.freeze([
  "GET /api/backoffice/relations",
  "POST /api/backoffice/relations",
  "GET /api/parents/identity",
  "GET /api/parents/relations",
  "POST /api/parents/link",
  "PATCH /api/parents/relations/:relationId",
]);

const RELATED_PII_ROUTES = Object.freeze([
  "GET /api/backoffice/contacts",
  "POST /api/backoffice/contacts",
  "PATCH /api/backoffice/contacts/:contactId",
  "GET /api/students",
  "GET /api/students/:id",
  "GET /api/data-export",
  "GET /api/audit",
]);

const SUPER = {
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES", "Relations:READ", "Relations:CREATE", "Relations:UPDATE"],
  schoolCode: "*",
};

const SUPER_WITH_SCHOOL = {
  ...SUPER,
  schoolCode: "CD-2026-0001",
};

const COUNTRY = {
  role: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES", "Relations:READ", "Relations:CREATE"],
  schoolCode: "*",
  countryCode: "CD",
};

const SCHOOL_A = {
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Relations:READ", "Relations:CREATE", "Relations:UPDATE", "Gérer utilisateurs"],
  schoolCode: "CD-2026-0001",
  schoolId: "school-a",
};

const SCHOOL_B = {
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Relations:READ", "Relations:CREATE", "Relations:UPDATE", "Gérer utilisateurs"],
  schoolCode: "BI-2026-0002",
  schoolId: "school-b",
};

const TEACHER = {
  role: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: ["Élèves:READ", "Voir élèves"],
  schoolCode: "CD-2026-0001",
  schoolId: "school-a",
};

const RELATION_ROWS = Object.freeze([
  {
    id: "rel-a",
    schoolCode: "CD-2026-0001",
    schoolId: "school-a",
    fromContactName: "Parent A",
    toStudentName: "Élève A",
    relationType: "Parent → Élève",
  },
  {
    id: "rel-b",
    schoolCode: "BI-2026-0002",
    schoolId: "school-b",
    fromContactName: "Parent B",
    toStudentName: "Élève B",
    relationType: "Parent → Élève",
  },
]);

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

test("ADMIN-03A catalogue : Relations est personnelle pour Superadmin / Admin Pays", () => {
  const dataSrc = readUtf8("../data.js");
  const relationsBlock = dataSrc.slice(dataSrc.indexOf("  Relations: {"), dataSrc.indexOf("  Classes: {"));
  assert.match(relationsBlock, /"Super Administrateur Somafrik": "-"/);
  assert.match(relationsBlock, /"Admin Pays": "-"/);
  assert.match(relationsBlock, /"Admin School": "CRUD"/);
  assert.match(relationsBlock, /"Préfet des études": "R"/);
  assert.match(relationsBlock, /Enseignant: "-"/);
});

test("ADMIN-03A endpoints Relations listés et classés FORBIDDEN, pas ALLOWED", () => {
  for (const route of RELATIONS_PERSONAL_ROUTES) {
    assert.equal(Boolean(routePermissions[route]), true, route);
    assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(route), true, route);
    assert.equal(PLATFORM_ADMIN_ALLOWED.includes(route), false, route);
  }
});

test("REL-01 SUPER_ADMIN : UI allowlist ≠ API — GET Relations refusé", () => {
  const webAllowlist = readUtf8("../../web/src/lib/superAdminAccess.ts");
  assert.match(webAllowlist, /"relations"/);
  assert.match(webAllowlist, /"Relations"/);
  assert.equal(rbac.canAccess(SUPER, "GET /api/backoffice/relations"), false);
  assert.equal(rbac.canAccess(SUPER_WITH_SCHOOL, "GET /api/backoffice/relations"), false);
  assert.equal(isPlatformPersonalDataForbidden(SUPER, "GET /api/backoffice/relations"), true);
});

test("REL-02 SUPER_ADMIN GET données personnelles école (Relations + contournements)", () => {
  for (const route of [...RELATIONS_PERSONAL_ROUTES.filter((key) => key.startsWith("GET ")), ...RELATED_PII_ROUTES.filter((key) => key.startsWith("GET "))]) {
    assert.equal(isPlatformPersonalDataForbidden(SUPER, route), true, route);
    assert.equal(rbac.canAccess(SUPER, route), false, route);
    assert.equal(rbac.canAccess(SUPER_WITH_SCHOOL, route), false, `school ${route}`);
    assert.equal(rbac.canAccess(COUNTRY, route), false, `country ${route}`);
  }
  assert.equal(matchForbiddenPersonalDataRouteKey("GET", "/api/backoffice/relations?schoolCode=CD-2026-0001"), "GET /api/backoffice/relations");
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/parents/relations?studentId=abc"), true);
});

test("REL-03 SUPER_ADMIN POST relation refusé (ALL_PRIVILEGES + schoolCode ignorés)", () => {
  assert.equal(rbac.canAccess(SUPER, "POST /api/backoffice/relations"), false);
  assert.equal(rbac.canAccess(SUPER_WITH_SCHOOL, "POST /api/backoffice/relations"), false);
  assert.equal(rbac.canAccess(SUPER, "POST /api/parents/link"), false);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "POST", "/api/backoffice/relations"), true);
  assert.equal(PLATFORM_PERSONAL_DATA_DENY, "PLATFORM_PERSONAL_DATA_DENIED");
});

test("REL-04 SUPER_ADMIN PATCH : pas de PATCH backoffice ; parents PATCH refusé", () => {
  const serverSrc = readUtf8("../server.js");
  assert.doesNotMatch(serverSrc, /app\.(patch|put)\("\/api\/backoffice\/relations/);
  assert.equal(routePermissions["PATCH /api/backoffice/relations"], undefined);
  assert.equal(routePermissions["PATCH /api/backoffice/relations/:relationId"], undefined);
  assert.equal(rbac.canAccess(SUPER, "PATCH /api/parents/relations/:relationId"), false);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "PATCH", "/api/parents/relations/rel-1"), true);
});

test("REL-05 SUPER_ADMIN DELETE/archive : pas de DELETE backoffice ; archive parents refusée", () => {
  const serverSrc = readUtf8("../server.js");
  assert.doesNotMatch(serverSrc, /app\.delete\("\/api\/backoffice\/relations/);
  assert.equal(routePermissions["DELETE /api/backoffice/relations"], undefined);
  assert.equal(routePermissions["DELETE /api/backoffice/relations/:relationId"], undefined);
  assert.equal(rbac.canAccess(SUPER, "PATCH /api/parents/relations/:relationId"), false);
});

test("REL-06 SCHOOL_ADMIN lit uniquement son école (filterRows)", () => {
  const scoped = tenantScope.filterRows(RELATION_ROWS, SCHOOL_A);
  assert.deepEqual(scoped.map((row) => row.id), ["rel-a"]);
  assert.equal(rbac.canAccess(SCHOOL_A, "GET /api/backoffice/relations"), true);
});

test("REL-07 SCHOOL_ADMIN CREATE autorisé côté RBAC ; persist createRelation présent", () => {
  assert.equal(rbac.canAccess(SCHOOL_A, "POST /api/backoffice/relations"), true);
  assert.equal(rbac.canAccess(SCHOOL_A, "POST /api/parents/link"), true);
  const clientsService = readUtf8("./clientsService.js");
  assert.match(clientsService, /async function createRelation/);
  assert.match(clientsService, /ensureActiveParentRelation/);
  const serverSrc = readUtf8("../server.js");
  assert.match(serverSrc, /app\.post\("\/api\/backoffice\/relations"/);
  assert.match(serverSrc, /repository\.createClientsRelation/);
});

test("REL-08 SCHOOL_ADMIN école B : assertSchoolScope fail-closed", () => {
  assert.throws(
    () => assertSchoolScope(SCHOOL_A, SCHOOL_B.schoolCode),
    (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.TENANT_MISMATCH,
  );
  assert.doesNotThrow(() => assertSchoolScope(SCHOOL_A, SCHOOL_A.schoolCode));
});

test("REL-09 relation école A inaccessible depuis école B", () => {
  const fromB = tenantScope.filterRows(RELATION_ROWS, SCHOOL_B);
  assert.deepEqual(fromB.map((row) => row.id), ["rel-b"]);
  assert.equal(fromB.some((row) => row.id === "rel-a"), false);
});

test("REL-10 absence schoolId / scope invalide → fail-closed SCHOOL_ADMIN", () => {
  assert.throws(
    () => assertSchoolScope(SCHOOL_A, ""),
    (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.TENANT_MISMATCH,
  );
  assert.throws(
    () => assertSchoolScope(SCHOOL_A, "*"),
    (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.TENANT_MISMATCH,
  );
  assert.throws(
    () => assertSchoolScope(TEACHER, ""),
    (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.TENANT_MISMATCH,
  );
  const parentsGet = readUtf8("../server.js");
  assert.match(parentsGet, /studentId requis/);
});

test("ADMIN-03A latent : sans le guard, Superadmin filterRows / assertSchoolScope restent ouverts", () => {
  const unfiltered = tenantScope.filterRows(RELATION_ROWS, SUPER);
  assert.deepEqual(unfiltered.map((row) => row.id), ["rel-a", "rel-b"]);
  assert.doesNotThrow(() => assertSchoolScope(SUPER, ""));
  assert.doesNotThrow(() => assertSchoolScope(SUPER, "*"));
  assert.doesNotThrow(() => assertSchoolScope(COUNTRY, ""));
});

test("ADMIN-03A autre rôle : Enseignant sans jeton Relations", () => {
  assert.equal(rbac.canAccess(TEACHER, "GET /api/backoffice/relations"), false);
  assert.equal(rbac.canAccess(TEACHER, "POST /api/backoffice/relations"), false);
});

test("ADMIN-03A projection relation : noms + type + école, pas téléphone/email", () => {
  const mapped = mapRelationRow({
    id: "rel-1",
    relation_type: "parent_student",
    contact_id: "c1",
    student_id: "s1",
    school_code: "CD-2026-0001",
    status: "active",
    contact_name: "Awa Okito",
    student_name: "Esther Okito",
    created_at: "2026-01-01",
    profile_payload: {},
  });
  assert.equal(mapped.fromContactName, "Awa Okito");
  assert.equal(mapped.toStudentName, "Esther Okito");
  assert.equal(mapped.relationType, "Parent → Élève");
  assert.equal("phone" in mapped, false);
  assert.equal("email" in mapped, false);
  assert.equal("address" in mapped, false);
});

test("ADMIN-03A parents list expose téléphone/email contact — aussi FORBIDDEN plateforme", () => {
  const parentLinking = readUtf8("./parentLinking.js");
  assert.match(parentLinking, /phone: row\.contact_phone/);
  assert.match(parentLinking, /email: row\.contact_email/);
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/parents/relations"), true);
});

test("ADMIN-03A pas de bypass HTTP Relations hors catalogue FORBIDDEN", () => {
  const serverSrc = readUtf8("../server.js");
  const extra = [...serverSrc.matchAll(/app\.(get|post|patch|put|delete)\("(\/api\/(?:backoffice\/relations|parents)[^"]*)"/g)].map(
    (match) => `${match[1].toUpperCase()} ${match[2]}`,
  );
  for (const route of extra) {
    const catalogKey = route.replace(/\/:[^/]+/g, (segment) => {
      if (route.includes("/parents/relations/") && segment === "/:relationId") return "/:relationId";
      return segment;
    });
    const normalized =
      catalogKey === "PATCH /api/parents/relations/:relationId"
        ? catalogKey
        : RELATIONS_PERSONAL_ROUTES.find((key) => key === catalogKey) || catalogKey;
    assert.equal(
      RELATIONS_PERSONAL_ROUTES.includes(normalized) || RELATIONS_PERSONAL_ROUTES.includes(catalogKey),
      true,
      `route Relations hors inventaire : ${route}`,
    );
  }
});

test("ADMIN-03A requirePermission nie avant some() ; PUT state strip relations", () => {
  const rbacSrc = readUtf8("../services/rbacService.js");
  assert.match(rbacSrc, /isPlatformPersonalDataForbidden\(principal, routeKey\)/);
  const stripSrc = readUtf8("../../web/src/lib/stripClientClients.ts");
  assert.match(stripSrc, /"relations"/);
  const entityPage = readUtf8("../../web/src/pages/EntityPage.tsx");
  assert.match(entityPage, /clientsApi\.createRelation/);
  assert.doesNotMatch(entityPage, /clientsApi\.updateRelation/);
  assert.doesNotMatch(entityPage, /clientsApi\.deleteRelation/);
});
