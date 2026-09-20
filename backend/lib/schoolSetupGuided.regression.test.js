"use strict";

/**
 * GREEN — gardes anti-régression du chantier guidé.
 * Ne neutralise aucun test historique.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("LOT 0 intact : GET /api/v2/school-setup/status et pas de setup_status", () => {
  const schema = read("backend/db/schema.sql");
  const server = read("backend/server.js");
  const status = read("backend/lib/schoolSetupStatus.js");
  assert.ok(!schema.includes("setup_status"));
  assert.ok(server.includes('app.get("/api/v2/school-setup/status"'));
  assert.match(status, /NOT_STARTED|IN_PROGRESS|READY/);
  assert.match(status, /coreTotal: CORE_TOTAL/);
});

test("aucun endpoint Student legacy ni création globale élève dans le guidé", () => {
  const files = [
    "backend/lib/schoolSetupGuided.js",
    "web/src/components/schoolSetup/GuidedSchoolSetupWizard.tsx",
    "web/src/lib/schoolSetupGuidedWeb.ts",
    "Mobile/src/components/schoolSetup/GuidedSchoolSetupWizard.tsx",
    "Mobile/src/lib/schoolSetupGuidedMobile.ts",
  ];
  const joined = files.map((file) => read(file)).join("\n");
  assert.doesNotMatch(joined, /POST\s+\/api\/students["'`]/);
  assert.doesNotMatch(joined, /\/api\/backoffice\/students/);
  assert.doesNotMatch(joined, /POST\s+\/api\/teachers["'`]/);
  assert.doesNotMatch(joined, /backoffice_state|BackOffice\/app\.js/);
});

test("RBAC guidé réutilise Paramètres Établissement (pas de nouveau moteur RBAC)", () => {
  const rbac = read("backend/services/rbacService.js");
  const getLine = rbac.split("\n").find((line) => line.includes('"GET /api/v2/school-setup/guided"'));
  const postLine = rbac
    .split("\n")
    .find((line) => line.includes('"POST /api/v2/school-setup/guided/steps/:stepKey/complete"'));
  assert.ok(getLine && getLine.includes("Paramètres Établissement:READ"));
  assert.ok(postLine && postLine.includes("Paramètres Établissement:UPDATE"));
});
