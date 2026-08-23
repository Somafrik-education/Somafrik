import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = path.join(import.meta.dirname, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(src, rel), "utf8");
}

const screens = [
  "screens/ConfigurationScreen.tsx",
  "screens/EstablishmentProfileScreen.tsx",
  "screens/SchoolYearSettingsScreen.tsx",
  "screens/SchoolPedagogicalStructureScreen.tsx",
  "screens/SchoolAssignableRolesScreen.tsx",
  "services/schoolSettingsApi.ts",
  "lib/schoolSettingsAccess.ts",
];

for (const rel of screens) {
  const source = read(rel);
  assert.doesNotMatch(source, /saveAcademicConfig\s*\(/, `${rel} ne doit pas appeler saveAcademicConfig`);
  assert.doesNotMatch(source, /["'`]\/academic-config["'`]/, `${rel} ne doit pas écrire PUT /academic-config`);
  assert.doesNotMatch(source, /backoffice_state/, `${rel} : legacy interdit`);
  assert.doesNotMatch(source, /OUTBOX_ALLOWED_DOMAINS/, `${rel} : pas d'outbox paramètres`);
  assert.doesNotMatch(source, /DEFAULT_LEVELS|DEFAULT_TRACKS/, `${rel} : pas de fallback JSON niveaux/filières`);
}

const api = read("services/schoolSettingsApi.ts");
assert.match(api, /method:\s*"PATCH"/);
assert.match(api, /\/school-settings/);
assert.match(api, /\/academic-periods/);
assert.match(api, /\/v2\/academic-years/);
assert.match(api, /\/education-reference\/school-activation/);
assert.match(api, /\/education-reference\/catalog/);
assert.match(api, /\/evaluation-types/);
assert.doesNotMatch(api, /persistOutbox/);

const outbox = read("lib/outbox.ts");
assert.match(outbox, /export const OUTBOX_ALLOWED_DOMAINS = \["messages", "presences", "notes", "payments"\]/);

const periods = read("lib/schoolAcademicPeriods.ts");
assert.match(periods, /resolveAcademicYearBounds/);
assert.match(periods, /selectCurrentAcademicYear/);
assert.doesNotMatch(periods, /01-09-2025/, "périodes par défaut : pas de dates 2025–2026");

const catalog = read("../../backend/lib/functionalModulesCatalog.js");
assert.match(
  catalog,
  /moduleKey:\s*"education_reference"[\s\S]*appliesMobile:\s*false/,
  "education_reference reste Web-only",
);
assert.match(catalog, /moduleKey:\s*"school_settings"[\s\S]*appliesMobile:\s*true/);

console.log("schoolSettingsApi.guard.test.ts OK");
