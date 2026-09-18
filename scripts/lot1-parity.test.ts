/**
 * Contrats LOT 1 — PARITY-018/019 (frontière) + 029/037 (correction).
 *
 *   npx --yes tsx --test scripts/lot1-parity.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { shouldAutoOpenSchoolSetupWizard as webAutoOpen } from "../web/src/lib/schoolSetupWeb.ts";
import { shouldAutoOpenSchoolSetupWizard as mobileAutoOpen } from "../Mobile/src/lib/schoolSetupMobile.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const notStarted = {
  status: "NOT_STARTED" as const,
  core: { academicYear: false, structure: false, classes: false },
  progress: { coreDone: 0, coreTotal: 3 },
};

test("PARITY-029 auto-open Web === Mobile (Admin School, NOT_STARTED)", () => {
  assert.equal(
    webAutoOpen({ payload: notStarted, role: "Admin School", mustChangePassword: false }),
    true,
  );
  assert.equal(
    mobileAutoOpen({ payload: notStarted, role: "school_admin", mustChangePassword: false }),
    true,
  );
  assert.equal(
    mobileAutoOpen({ payload: notStarted, role: "Admin School", mustChangePassword: false }),
    true,
  );
  assert.equal(
    mobileAutoOpen({ payload: notStarted, role: "teacher", mustChangePassword: false }),
    false,
  );
  assert.equal(
    mobileAutoOpen({ payload: notStarted, role: "school_admin", mustChangePassword: true }),
    false,
  );
});

test("PARITY-029 auto-open seulement NOT_STARTED, pas IN_PROGRESS", () => {
  const inProgress = {
    status: "IN_PROGRESS" as const,
    core: { academicYear: true, structure: false, classes: false },
    progress: { coreDone: 1, coreTotal: 3 },
  };
  assert.equal(
    webAutoOpen({ payload: inProgress, role: "Admin School", mustChangePassword: false }),
    false,
  );
  assert.equal(
    mobileAutoOpen({ payload: inProgress, role: "school_admin", mustChangePassword: false }),
    false,
  );
});

test("PARITY-029 LoginScreen Mobile consomme GET /v2/school-setup/status", () => {
  const login = read("Mobile/src/screens/LoginScreen.tsx");
  assert.match(login, /schoolSetupStatusApi/);
  assert.match(login, /shouldAutoOpenSchoolSetupWizard/);
  assert.match(login, /SchoolSetup/);
  assert.doesNotMatch(login, /useFocusEffect[\s\S]*shouldAutoOpenSchoolSetupWizard/);
});

test("PARITY-029 Accueil Mobile expose un CTA setup fail-soft", () => {
  const home = read("Mobile/src/screens/HomeScreen.tsx");
  assert.match(home, /SchoolSetupDashboardWidget|school-setup-widget/);
  assert.match(home, /schoolSetupStatusApi/);
  assert.match(home, /SCHOOL_SETUP_ROUTE|SchoolSetup/);
});

test("PARITY-037 clients consomment GET /education-reference/catalog", () => {
  const webApi = read("web/src/lib/educationReferenceApi.ts");
  const mobileApi = read("Mobile/src/services/schoolSettingsApi.ts");
  assert.match(webApi, /\/education-reference\/catalog/);
  assert.doesNotMatch(
    webApi,
    /backoffice\/establishments\/\$\{[^}]+}\/education-reference\/catalog/,
  );
  assert.doesNotMatch(
    webApi,
    /backoffice\/establishments\/\$\{[^}]+}\/education-reference\/school-activation/,
  );
  assert.match(mobileApi, /\/education-reference\/catalog/);
  assert.match(mobileApi, /\/education-reference\/school-activation/);
});

test("PARITY-037 alias backoffice déprécié, store unique", () => {
  const server = read("backend/server.js");
  assert.match(server, /resolveEducationCatalogSchoolCode/);
  assert.match(server, /applyEducationCatalogDeprecationHeaders/);
  assert.match(server, /getEducationSchoolCatalog\(schoolCode\)/);
});

test("LOT 1 CI gate exécute test:lot1-parity", () => {
  const gates = read(".github/workflows/pr-gates.yml");
  assert.match(gates, /name: LOT 1 parity/);
  assert.match(gates, /npm run test:lot1-parity/);
  assert.match(gates, /needs: \[scope, quality, secrets, core, targeted, lot0, lot1\]/);
});
