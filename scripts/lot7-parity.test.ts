/**
 * Contrats LOT 7 — PARITY-021 / 052 / 057 / 081 / 083 Planning / présence / inscription.
 *
 *   npx --yes tsx --test scripts/lot7-parity.test.ts
 *
 * Required.needs reste extensible (lot7 n'est pas figé comme dernier).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel: string) {
  return fs.existsSync(path.join(ROOT, rel));
}

test("PARITY-021 — PermissionsScreen reste mort ; pas de PUT role-permissions Mobile", () => {
  const navigator = read("Mobile/src/navigation/AppNavigator.tsx");
  const permissions = read("Mobile/src/domain/security/permissions.ts");
  const safety = read("Mobile/src/lib/mobileMutationSafety.ts");
  const screen = read("Mobile/src/screens/PermissionsScreen.tsx");
  const lot1 = read("docs/audits/parite-web-mobile-lot1-referentiels-etablissement.md");
  const evidence = read("docs/audits/evidence/lot7-planning-red-green.md");
  assert.doesNotMatch(navigator, /PermissionsScreen/);
  assert.doesNotMatch(navigator, /name=["']Permissions["']/);
  assert.match(permissions, /if \(viewName === "Permissions"\) \{\s*return false;/);
  assert.match(safety, /MOBILE_ROLE_PERMISSION_MUTATION_ENABLED = false/);
  assert.match(screen, /MOBILE_ROLE_PERMISSION_MUTATION_ENABLED/);
  assert.doesNotMatch(screen, /role-permissions|updateRolePermissions|putRolePermissions/i);
  assert.match(lot1, /Ne pas remonter[\s\S]*PermissionsScreen/);
  assert.match(evidence, /PARITY-021/);
  assert.match(evidence, /KEEP DEAD/);
});

test("PARITY-052 — élèves d'une classe déjà fermé par LOT 2 ; pas de nouveau produit", () => {
  const classes = read("Mobile/src/screens/ClassesScreen.tsx");
  const students = read("Mobile/src/screens/StudentsScreen.tsx");
  const webPage = read("web/src/pages/etablissement/ClassStudentsPage.tsx");
  const evidence = read("docs/audits/evidence/lot7-planning-red-green.md");
  assert.match(classes, /SCOLARITE_COPY\.openClassStudents/);
  assert.match(students, /filterStudentsByClassName/);
  assert.match(students, /Toutes les classes/);
  assert.match(webPage, /classStudentsApi/);
  assert.match(evidence, /PARITY-052/);
  assert.match(evidence, /Aucun code produit/);
});

test("PARITY-057 — badge présence classe Web = contrat fail-closed Mobile", () => {
  const webPage = read("web/src/pages/PresencesPage.tsx");
  const helper = read("web/src/lib/classTodayPresenceBadge.ts");
  const mobile = read("Mobile/src/lib/classTodayPresenceBadge.ts");
  assert.match(webPage, /formatClassTodayPresenceBadge/);
  assert.doesNotMatch(webPage, /enregistrement\(s\) aujourd/);
  assert.match(helper, /CLASS_UNSET_PRESENCE_LABEL/);
  assert.match(helper, /Non saisi/);
  assert.match(helper, /Présence —/);
  assert.match(helper, /recorded === 0 \|\| recorded < expected/);
  assert.match(mobile, /CLASS_UNSET_PRESENCE_LABEL = "Non saisi"/);
  assert.match(mobile, /recorded !== expectedStudents\.length/);
});

test("PARITY-081 — hint naissance inscription JJ-MM-AAAA via DISPLAY_DATE_HINT", () => {
  const page = read("web/src/pages/etablissement/ClassStudentsPage.tsx");
  assert.match(page, /DISPLAY_DATE_HINT/);
  assert.match(page, /hint=\{`Format \$\{DISPLAY_DATE_HINT\}`\}/);
  assert.doesNotMatch(page, /Format AAAA-MM-JJ/);
});

test("PARITY-083 — action de masse présence = Tout présent (Web + Mobile)", () => {
  const webPage = read("web/src/pages/PresencesPage.tsx");
  const mobile = read("Mobile/src/screens/TeacherAttendanceScreen.tsx");
  assert.match(webPage, /Tout présent/);
  assert.doesNotMatch(webPage, /Tous présents/);
  assert.match(mobile, /Tout présent/);
});

test("PARITY-021/052/057/081/083 — gate CI lot7 extensible avec LOT 0–6", () => {
  const pkg = read("package.json");
  const gates = read(".github/workflows/pr-gates.yml");
  const requiredJob = gates.slice(gates.indexOf("name: Required"));
  assert.ok(exists("docs/audits/evidence/lot7-planning-red-green.md"));
  assert.match(pkg, /"test:lot7-parity"/);
  assert.match(pkg, /"test:lot6-parity"/);
  assert.match(gates, /name: LOT 7 parity/);
  assert.match(gates, /npm run test:lot7-parity/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot6[^\]]*\]/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot7[^\]]*\]/);
  assert.match(requiredJob, /LOT7: \$\{\{ needs\.lot7\.result \}\}/);
  assert.match(requiredJob, /"\$LOT7"/);
});
