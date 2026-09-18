/**
 * Contrats LOT 4 — PARITY-015 / 016 / 080 Finance.
 *
 *   npx --yes tsx --test scripts/lot4-parity.test.ts
 *
 * Required.needs reste extensible (lot4 n'est pas figé comme dernier).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { formatFinanceDate as webFinanceDate } from "../web/src/lib/financeCurrency.ts";
import { formatFinanceDate as mobileFinanceDate } from "../Mobile/src/lib/financeCurrency.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("PARITY-015 — Mobile consulte GET /finance/fee-grids, sans mutation de grille", () => {
  const screen = read("Mobile/src/screens/FeeGridsScreen.tsx");
  const api = read("Mobile/src/services/api.ts");
  const nav = read("Mobile/src/navigation/AppNavigator.tsx");
  assert.match(api, /export function listFeeGrids/);
  assert.match(api, /["'`]\/finance\/fee-grids["'`]/);
  assert.match(api, /export function getFeeGrid/);
  assert.match(api, /\/finance\/fee-grids\/\$\{/);
  assert.match(screen, /listFeeGrids/);
  assert.match(screen, /getFeeGrid/);
  assert.match(screen, /ExpandableFinanceCard|ExpandableEntityCard/);
  assert.match(screen, /configuration des grilles se fait depuis Somafrik Web/i);
  assert.match(nav, /FeeGrids/);
  assert.doesNotMatch(api, /export function createFeeGrid/);
  assert.doesNotMatch(api, /export function (activate|deactivate|apply)FeeGrid/);
  assert.doesNotMatch(screen, /\/finance\/fee-grids["'`][\s\S]{0,80}method:\s*["'`]POST/);
});

test("PARITY-016 — Impayés Mobile : recherche, classe, période, relance, encaissement", () => {
  const unpaid = read("Mobile/src/screens/UnpaidScreen.tsx");
  const api = read("Mobile/src/services/api.ts");
  const inventory = read("Mobile/src/lib/mobileMutationInventory.ts");
  const filters = read("Mobile/src/lib/unpaidFilters.ts");
  assert.match(unpaid, /unpaid-search|searchQuery|setSearch/);
  assert.match(unpaid, /className|classFilter/);
  assert.match(unpaid, /period|periodFilter/);
  assert.match(unpaid, /period:\s*periodFilter/);
  assert.match(unpaid, /periodOptionsFromFees/);
  assert.doesNotMatch(unpaid, /filterUnpaidRows\([\s\S]*period:\s*periodFilter/);
  assert.match(api, /period=\$\{encodeURIComponent\(period\)\}/);
  assert.match(unpaid, /createUnpaidReminder|Relancer/);
  assert.match(unpaid, /PaymentMutationControls/);
  assert.match(unpaid, /initialStudentId/);
  assert.match(api, /export function createUnpaidReminder/);
  assert.match(api, /\/backoffice\/finance\/unpaid\/\$\{/);
  assert.match(api, /idempotencyKey/);
  assert.match(
    inventory,
    /createUnpaidReminder[\s\S]*?path:\s*["'`]\/backoffice\/finance\/unpaid\/:studentId\/reminders["'`][\s\S]*?outbox:\s*false/,
  );
  assert.match(filters, /export function filterUnpaidRows/);
  assert.match(filters, /export function unpaidTotalsByCurrency/);
  assert.doesNotMatch(unpaid, /outbox/);
});

test("PARITY-080 — formatFinanceDate Web + Mobile = JJ-MM-AAAA", () => {
  assert.equal(webFinanceDate("2026-08-19"), "19-08-2026");
  assert.equal(mobileFinanceDate("2026-08-19"), "19-08-2026");
  assert.equal(webFinanceDate("19-08-2026"), "19-08-2026");
  assert.equal(mobileFinanceDate("19-08-2026"), "19-08-2026");
  assert.equal(webFinanceDate(""), "—");
  assert.equal(mobileFinanceDate(""), "—");
  assert.equal(webFinanceDate("not-a-date"), "—");
  assert.equal(mobileFinanceDate("not-a-date"), "—");
  const web = read("web/src/lib/financeCurrency.ts");
  const mobile = read("Mobile/src/lib/financeCurrency.ts");
  assert.match(web, /formatDateForDisplay/);
  assert.match(mobile, /formatDateForDisplay/);
  assert.doesNotMatch(web, /Intl\.DateTimeFormat\("fr-FR"/);
  assert.doesNotMatch(mobile, /Intl\.DateTimeFormat\("fr-FR"/);
  assert.doesNotMatch(web, /\$\{dmy\[1\]\}\/\$\{dmy\[2\]\}/);
  assert.doesNotMatch(mobile, /\$\{dmy\[1\]\}\/\$\{dmy\[2\]\}/);
});

test("PARITY-080 — aucune attente JJ/MM/AAAA dans Finance live", () => {
  const files = [
    "web/src/lib/financeCurrency.ts",
    "Mobile/src/lib/financeCurrency.ts",
    "web/src/lib/financeCurrency.test.ts",
    "Mobile/src/lib/financeCurrency.test.ts",
    "Mobile/src/screens/UnpaidScreen.tsx",
    "Mobile/src/screens/FeeGridsScreen.tsx",
    "web/src/pages/finances/FinanceUnpaidPage.tsx",
  ];
  for (const rel of files) {
    const src = read(rel);
    assert.doesNotMatch(src, /19\/08\/2026/, rel);
  }
});

test("Finance truth — soldes DTO, pas de somme multi-devise", () => {
  const filters = read("Mobile/src/lib/unpaidFilters.ts");
  const unpaid = read("Mobile/src/screens/UnpaidScreen.tsx");
  assert.match(filters, /amountDue/);
  assert.match(filters, /totalsByCurrency|unpaidTotalsByCurrency/);
  assert.doesNotMatch(unpaid, /amountExpected\s*-\s*amountPaid/);
  assert.doesNotMatch(unpaid, /reduce\(\s*\(sum/);
});

test("Finance tenant/RBAC — endpoints Mobile déjà couverts côté backend", () => {
  const rbac = read("backend/services/rbacService.js");
  const live = read("backend/lib/financeLiveRbac.test.js");
  const pg = read("backend/lib/financeMembershipScope.pg.test.js");
  assert.match(rbac, /GET \/api\/finance\/fee-grids/);
  assert.match(rbac, /POST \/api\/backoffice\/finance\/unpaid\/reminders/);
  assert.match(rbac, /POST \/api\/payments/);
  assert.match(live, /canManageFeeGrids/);
  assert.match(pg, /listFinanceFeeGrids/);
});

test("PARITY-028/015 — gate CI lot4 extensible avec LOT 0–3", () => {
  const pkg = read("package.json");
  const gates = read(".github/workflows/pr-gates.yml");
  const requiredJob = gates.slice(gates.indexOf("name: Required"));
  assert.match(pkg, /"test:lot4-parity"/);
  assert.match(pkg, /"test:lot0-parity"/);
  assert.match(pkg, /"test:lot3-parity"/);
  assert.match(gates, /name: LOT 4 parity/);
  assert.match(gates, /npm run test:lot4-parity/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot0[^\]]*\]/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot3[^\]]*\]/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot4[^\]]*\]/);
  assert.match(requiredJob, /LOT4: \$\{\{ needs\.lot4\.result \}\}/);
  assert.match(requiredJob, /"\$LOT4"/);
});
