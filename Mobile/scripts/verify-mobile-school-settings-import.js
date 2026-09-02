/**
 * Lot Mobile Paramètres + Structure pédagogique — garde-fous d'import.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const ROOT = path.join(MOBILE, "..");

function readMobile(rel) {
  return fs.readFileSync(path.join(MOBILE, "src", rel), "utf8");
}

function runTsx(rel) {
  const result = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", rel)], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${rel} failed`);
  }
  process.stdout.write(result.stdout || "");
}

function main() {
  runTsx("schoolSettingsAccess.test.ts");
  runTsx("schoolSettingsApi.guard.test.ts");
  runTsx("schoolAcademicPeriods.test.ts");

  const drawer = readMobile(path.join("navigation", "roleDrawerPreferences.ts"));
  assert.match(drawer, /label:\s*"Paramètres"[\s\S]*route:\s*"Configuration"/);
  assert.match(drawer, /label:\s*"Structure pédagogique"[\s\S]*route:\s*"SchoolPedagogicalStructure"/);
  assert.match(drawer, /structure:\s*\{[\s\S]*label:\s*"Structure pédagogique"/);
  assert.match(drawer, /settings:\s*\{[\s\S]*label:\s*"Paramètres"/);
  const schoolAdmin = drawer.slice(drawer.indexOf("const schoolAdminItems"), drawer.indexOf("const prefetItems"));
  assert.match(schoolAdmin, /I\.structure/);
  assert.match(schoolAdmin, /I\.settings/);
  const teacherItems = drawer.slice(drawer.indexOf("const teacherItems"), drawer.indexOf("const parentItems"));
  assert.doesNotMatch(teacherItems, /I\.structure/);
  assert.doesNotMatch(teacherItems, /I\.settings/);

  const configuration = readMobile(path.join("screens", "ConfigurationScreen.tsx"));
  assert.match(configuration, /route:\s*"Users"/);
  assert.match(configuration, /navigate\(section\.route\)/);
  assert.doesNotMatch(configuration, /Périodes académiques/);
  assert.doesNotMatch(configuration, /Niveaux et filières/);
  assert.doesNotMatch(configuration, /paymentStatuses/);

  const activation = readMobile(path.join("screens", "SchoolPedagogicalStructureScreen.tsx"));
  assert.match(activation, /saveSchoolEducationActivation/);
  assert.match(activation, /Référentiels disponibles pour votre établissement/);
  assert.doesNotMatch(activation, /education_levels/);
  assert.doesNotMatch(activation, /saveAcademicConfig/);

  const yearScreen = readMobile(path.join("screens", "SchoolYearSettingsScreen.tsx"));
  assert.match(yearScreen, /patchSchoolSettings/);
  assert.match(yearScreen, /replaceAcademicPeriods/);
  assert.match(yearScreen, /createAcademicYear/);
  assert.match(yearScreen, /selectCurrentAcademicYear/);
  assert.doesNotMatch(yearScreen, /saveAcademicConfig/);

  const periodsLib = readMobile(path.join("lib", "schoolAcademicPeriods.ts"));
  assert.match(periodsLib, /resolveAcademicYearBounds/);
  assert.match(periodsLib, /selectCurrentAcademicYear/);
  assert.doesNotMatch(periodsLib, /01-09-2025/);
  assert.doesNotMatch(periodsLib, /31-12-2025/);

  const navigator = readMobile(path.join("navigation", "AppNavigator.tsx"));
  assert.match(navigator, /name="Configuration"[\s\S]*title:\s*"Paramètres"/);
  assert.match(navigator, /name="SchoolPedagogicalStructure"/);
  assert.match(navigator, /canReadView\(session, "Configuration"\)/);
  assert.match(navigator, /canReadView\(session, "SchoolPedagogicalStructure"\)/);

  const permissions = readMobile(path.join("domain", "security", "permissions.ts"));
  assert.match(permissions, /isSchoolSettingsOperator/);
  assert.match(permissions, /isSchoolSettingsView/);

  const modules = fs.readFileSync(path.join(ROOT, "backend", "lib", "functionalModulesCatalog.js"), "utf8");
  assert.match(modules, /moduleKey: "education_reference", moduleName: "Référentiels pédagogiques", appliesWeb: true, appliesMobile: false/);

  console.log("verify:mobile-school-settings-import OK");
}

main();
