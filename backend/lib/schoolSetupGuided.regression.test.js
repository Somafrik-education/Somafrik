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

test("HOLD — étape 5 exige une affectation active ; étape 6 ignore studentCount orphelin", () => {
  const guided = read("backend/lib/schoolSetupGuided.js");
  assert.match(guided, /case\s+"teachers":[\s\S]*teacherAssignmentCount/);
  assert.match(guided, /teacher_assignments[\s\S]*status\s*=\s*'active'/);
  assert.doesNotMatch(guided, /enrolledStudentCount\s*\|\|/);
  assert.doesNotMatch(guided, /enrolledStudentCount\s*:\s*enrolledStudentCount\s*\|\|\s*asCount\(\s*base\.studentCount\s*\)/);
});

test("HOLD — un seul assistant visible et Terminer quitte vers le tableau de bord", () => {
  const webSettings = read("web/src/pages/parametres/SchoolSetupSettingsPage.tsx");
  const mobileSettings = read("Mobile/src/screens/SchoolSetupSettingsScreen.tsx");
  const webWizard = read("web/src/components/schoolSetup/GuidedSchoolSetupWizard.tsx");
  const mobileWizard = read("Mobile/src/components/schoolSetup/GuidedSchoolSetupWizard.tsx");
  assert.match(webSettings, /guided\s*\?\s*\([\s\S]*<GuidedSchoolSetupWizard[\s\S]*\)\s*:\s*payload\s*\?\s*[\s\S]*<SchoolSetupWizard/);
  assert.match(mobileSettings, /guided\s*\?\s*\([\s\S]*<GuidedSchoolSetupWizard[\s\S]*\)\s*:\s*payload\s*\?\s*[\s\S]*<SchoolSetupWizard/);
  assert.match(webWizard, /onFinish/);
  assert.match(mobileWizard, /onFinish/);
  assert.match(webSettings, /\/tableau-de-bord/);
  assert.match(mobileSettings, /navigate\(\s*["']Home["']/);
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
