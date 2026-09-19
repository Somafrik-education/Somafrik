/**
 * Contrats LOT 8 — PARITY-035 / 056 / 061 / 027 / 071 Nettoyage legacy.
 *
 *   npx --yes tsx --test scripts/lot8-parity.test.ts
 *
 * Required.needs reste extensible (lot8 n'est pas figé comme dernier).
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

test("PARITY-035 — GET role-permissions lecture compat ; PUT interdit ; admin = rbacApi", () => {
  const server = read("backend/server.js");
  const platformApi = read("web/src/lib/platformApi.ts");
  const loaders = read("web/src/lib/domainLoaders.ts");
  const admin = read("web/src/pages/PermissionsPage.tsx");
  const mobileApi = read("Mobile/src/services/api.ts");
  const evidence = read("docs/audits/evidence/lot8-legacy-red-green.md");
  assert.match(server, /throwLegacyRolePermissionsWrite/);
  assert.match(server, /app\.get\("\/api\/backoffice\/role-permissions"/);
  assert.match(platformApi, /getRolePermissions/);
  assert.doesNotMatch(platformApi, /putRolePermissions|updateRolePermissions/);
  assert.match(loaders, /platformApi\.getRolePermissions/);
  assert.match(admin, /rbacApi\.patchPermissions/);
  assert.match(admin, /rbacApi\.getCatalog/);
  assert.doesNotMatch(admin, /getRolePermissions|role-permissions/);
  assert.doesNotMatch(mobileApi, /role-permissions/);
  assert.match(evidence, /PARITY-035/);
  assert.match(evidence, /Conserver GET lecture/);
});

test("PARITY-056 — paiements Web EntityPage live + Mobile canonique ; pas AdminCrud", () => {
  const app = read("web/src/App.tsx");
  const entity = read("web/src/pages/EntityPage.tsx");
  const navigator = read("Mobile/src/navigation/AppNavigator.tsx");
  const evidence = read("docs/audits/evidence/lot8-legacy-red-green.md");
  assert.match(app, /path="paiements"/);
  assert.match(app, /EntityPage entity="payments"/);
  assert.match(app, /FinanceFeesPage/);
  assert.match(app, /FinanceUnpaidPage/);
  assert.match(entity, /financeApi|FinancePaymentsOverview/);
  assert.match(navigator, /PaymentsScreen/);
  assert.match(navigator, /UnpaidScreen/);
  assert.match(navigator, /FeeGridsScreen/);
  assert.doesNotMatch(navigator, /name=["']AdminCrud["']/);
  assert.match(evidence, /PARITY-056/);
  assert.match(evidence, /Aucun code produit/);
});

test("PARITY-061 — écrans morts absents ; PD_DEAD noms-only ; type AdminCrud retiré", () => {
  const navigator = read("Mobile/src/navigation/AppNavigator.tsx");
  const pd = read("Mobile/src/lib/progressiveDisclosureUxContract.ts");
  const evidence = read("docs/audits/evidence/lot8-legacy-red-green.md");
  assert.equal(exists("Mobile/src/screens/PermissionsScreen.tsx"), false);
  assert.equal(exists("Mobile/src/screens/AdminCrudScreen.tsx"), false);
  assert.equal(exists("Mobile/src/screens/SafeAdminCrudScreen.tsx"), false);
  assert.equal(exists("Mobile/src/screens/MenuScreen.tsx"), false);
  assert.equal(exists("Mobile/src/screens/PlatformNotificationsScreen.tsx"), false);
  assert.match(pd, /AdminCrudScreen/);
  assert.match(pd, /SafeAdminCrudScreen/);
  assert.match(pd, /MenuScreen/);
  assert.match(pd, /PlatformNotificationsScreen/);
  assert.doesNotMatch(navigator, /\bAdminCrud\b/);
  assert.doesNotMatch(navigator, /from ["']\.\.\/screens\/AdminCrudScreen["']/);
  assert.doesNotMatch(navigator, /from ["']\.\.\/screens\/MenuScreen["']/);
  assert.doesNotMatch(navigator, /from ["']\.\.\/screens\/PlatformNotificationsScreen["']/);
  assert.doesNotMatch(navigator, /SafeAdminCrudScreen/);
  assert.doesNotMatch(navigator, /name=["']Permissions["']/);
  assert.match(evidence, /PARITY-061/);
  assert.match(evidence, /[Ss]uppression réelle/);
});

test("PARITY-027 — catalogue PG autorité ; CRUD_PERMISSION_MODULES statiques absents", () => {
  const catalog = read("backend/lib/functionalModulesCatalog.js");
  const navigator = read("Mobile/src/navigation/AppNavigator.tsx");
  const crud = read("Mobile/src/lib/mobileCrudParity.ts");
  const webConstants = read("web/src/lib/constants.ts");
  const mobileConstants = read("Mobile/src/lib/constants.ts");
  const webGov = read("web/src/lib/roleGovernance.ts");
  const mobileGov = read("Mobile/src/lib/roleGovernance.ts");
  const evidence = read("docs/audits/evidence/lot8-legacy-red-green.md");
  assert.match(
    catalog,
    /moduleKey: "role_permissions"[\s\S]{0,80}appliesWeb: true, appliesMobile: false/,
  );
  assert.match(catalog, /moduleKey: "fees"[\s\S]{0,80}appliesWeb: true, appliesMobile: true/);
  assert.match(catalog, /moduleKey: "unpaid"[\s\S]{0,80}appliesWeb: true, appliesMobile: true/);
  assert.match(navigator, /FeeGridsScreen/);
  assert.match(navigator, /UnpaidScreen/);
  assert.doesNotMatch(navigator, /PermissionsScreen/);
  assert.match(crud, /CANONICAL_CRUD_ENTITIES/);
  assert.doesNotMatch(crud, /role_permissions/);
  assert.doesNotMatch(webConstants, /CRUD_PERMISSION_MODULES/);
  assert.doesNotMatch(mobileConstants, /CRUD_PERMISSION_MODULES/);
  assert.doesNotMatch(webGov, /getSuperadminMatrixModules/);
  assert.doesNotMatch(mobileGov, /getSuperadminMatrixModules/);
  assert.match(webGov, /COUNTRY_SCOPE_MODULES/);
  assert.match(mobileGov, /COUNTRY_SCOPE_MODULES/);
  assert.match(evidence, /PARITY-027/);
  assert.match(evidence, /catalogues statiques/);
});

test("PARITY-071 — GradeBookService Mobile orphelin supprimé", () => {
  const metrics = read("Mobile/src/domain/metrics/schoolMetrics.ts");
  const evidence = read("docs/audits/evidence/lot8-legacy-red-green.md");
  assert.equal(exists("Mobile/src/domain/academics/GradeBookService.ts"), false);
  assert.doesNotMatch(metrics, /GradeBookService/);
  assert.doesNotMatch(metrics, /getStudentAcademicSummary/);
  assert.match(evidence, /PARITY-071/);
  assert.match(evidence, /Suppression nette/);
});

test("PARITY-035/056/061/027/071 — gate CI lot8 extensible avec LOT 0–7", () => {
  const pkg = read("package.json");
  const gates = read(".github/workflows/pr-gates.yml");
  const requiredJob = gates.slice(gates.indexOf("name: Required"));
  assert.ok(exists("docs/audits/evidence/lot8-legacy-red-green.md"));
  assert.match(pkg, /"test:lot8-parity"/);
  assert.match(pkg, /"test:lot7-parity"/);
  assert.match(gates, /name: LOT 8 parity/);
  assert.match(gates, /npm run test:lot8-parity/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot7[^\]]*\]/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot8[^\]]*\]/);
  assert.match(requiredJob, /LOT8: \$\{\{ needs\.lot8\.result \}\}/);
  assert.match(requiredJob, /"\$LOT8"/);
});
