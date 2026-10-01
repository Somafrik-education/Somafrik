"use strict";

/**
 * AUDIT Administration — tests ROUGES de complétude.
 * Affirment la chaîne Superadmin attendue. Doivent échouer aujourd'hui.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM } = require("./platformPersonalDataGuard");

const ROOT = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("RED-ADM-REL Superadmin n'est pas bloqué sur GET/POST /backoffice/relations", () => {
  assert.equal(
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/backoffice/relations"),
    false,
    "GET relations est deny plateforme : l'onglet Superadmin est une façade",
  );
  assert.equal(
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("POST /api/backoffice/relations"),
    false,
    "POST relations est deny plateforme",
  );
});

test("RED-ADM-DOC Superadmin n'est pas bloqué sur /school-documents", () => {
  assert.equal(
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/school-documents"),
    false,
    "GET school-documents est deny plateforme",
  );
});

test("RED-ADM-CONF Conformité Administration consomme GET /api/audit ou un workflow persisté", () => {
  const page = read("web/src/pages/ReportsPage.tsx");
  assert.match(
    page,
    /\/api\/audit|erasure-requests|reports\/advanced/,
    "ReportsPage n'appelle aucun journal/workflow persisté",
  );
});

test("RED-ADM-REL-DELETE une API d'archivage/suppression Relations existe sous /backoffice/relations", () => {
  const server = read("backend/server.js");
  assert.equal(
    /app\.(delete|patch)\("\/api\/backoffice\/relations/.test(server),
    true,
    "pas de mutation DELETE/PATCH backoffice/relations : le bouton Supprimer EntityPage est local",
  );
});

test("RED-ADM-DROITS-RESET un endpoint retire l'override école sans DENY substitutif", () => {
  const server = read("backend/server.js");
  const api = read("web/src/lib/rbacApi.ts");
  assert.equal(
    /app\.(delete|post)\("\/api\/backoffice\/rbac\/permissions\/reset/.test(server),
    true,
    "aucun endpoint reset d'override RBAC",
  );
  assert.equal(/resetOverride|resetPermissions/.test(api), true, "rbacApi n'expose pas de reset");
});
