"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM } = require("./platformPersonalDataGuard");
const { routePermissions } = require("../services/rbacService");

const ROOT = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("VERT — APIs Administration réellement câblées (Utilisateurs / Rôles / Droits)", () => {
  assert.ok(routePermissions["GET /api/backoffice/users"]);
  assert.ok(routePermissions["POST /api/backoffice/users/provision"]);
  assert.ok(routePermissions["PATCH /api/backoffice/users/:userId"]);
  assert.ok(routePermissions["POST /api/backoffice/users/:userId/roles/grant"]);
  assert.ok(routePermissions["GET /api/backoffice/rbac/catalog"]);
  assert.ok(routePermissions["PATCH /api/backoffice/rbac/permissions"]);
  assert.ok(routePermissions["GET /api/backoffice/rbac/permissions/effective"]);
  assert.ok(routePermissions["POST /api/backoffice/rbac/roles"]);
});

test("VERT — Relations et documents scolaires existent côté API, deny plateforme documenté", () => {
  assert.ok(routePermissions["GET /api/backoffice/relations"]);
  assert.ok(routePermissions["POST /api/backoffice/relations"]);
  assert.ok(routePermissions["GET /api/school-documents"]);
  assert.ok(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/backoffice/relations"));
  assert.ok(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("POST /api/backoffice/relations"));
  assert.ok(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/school-documents"));
  assert.ok(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/audit"));
});

test("VERT — pas de DELETE /backoffice/relations ni reset override RBAC dans server.js", () => {
  const server = read("backend/server.js");
  assert.equal(/app\.delete\(\s*"\/api\/backoffice\/relations/.test(server), false);
  assert.equal(/app\.delete\(\s*"\/api\/backoffice\/rbac\/permissions/.test(server), false);
  assert.match(server, /app\.get\("\/api\/audit"/);
  assert.match(server, /app\.get\("\/api\/v2\/reports\/advanced"/);
});

test("VERT — tables réelles Documents / Relations présentes dans les migrations", () => {
  const docs = read("backend/db/migrations/20260819_exams_report_cards_documents_canonical.sql");
  const clients = read("backend/db/migrations/20260814_clients_canonical.sql");
  assert.match(docs, /CREATE TABLE IF NOT EXISTS school_documents/);
  assert.match(clients, /CREATE TABLE IF NOT EXISTS contact_relations/);
});
