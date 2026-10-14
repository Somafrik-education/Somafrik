/**
 * FIN-SIMPLE-02 — Test-first UI contract (Web + Mobile).
 * Run: npx tsx Mobile/src/lib/finSimplePresentation.test.ts
 * RED on develop@7acfbe595f; GREEN only after the three-KPI presentation.
 * This is an inspection of rendered label declarations, not financial calculations.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const labels = ["Obligation", "Encaissé", "Reste à payer"];

describe("FIN-SIMPLE-02 — three presentation indicators", () => {
  it("FIN-12 Web main payments has only the three requested cards", () => {
    const source = read("web/src/components/payments/FinancePaymentsOverview.tsx");
    const actual = [...source.matchAll(/<Kpi label="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(actual, labels);
    assert.match(source, /value=\{cashLabel\}/);
    assert.match(source, /value=\{remainingLabel\}/);
  });

  it("FIN-12 Web parent finance uses the same three cash/debt labels", () => {
    const source = read("web/src/pages/finances/ParentFinancePage.tsx");
    const actual = [...source.matchAll(/<Metric label="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(actual, labels);
    assert.match(source, /value=\{model\.collectedLabel\}/);
    assert.match(source, /value=\{model\.remainingLabel\}/);
  });

  it("FIN-12 Mobile payments hero is only Obligation, Encaissé, Reste à payer", () => {
    const source = read("Mobile/src/screens/PaymentsScreen.tsx");
    const hero = source.slice(source.indexOf("<View style={[styles.financeHero"), source.indexOf("<Text style={styles.sectionTitle}>Paiements récents"));
    assert.ok(hero.length > 0);
    const actual = [...hero.matchAll(/<Text style=\{styles\.summaryLabel(?:Dark)?\}>([^<]+)<\/Text>/g)]
      .map((match) => match[1]);
    assert.deepEqual(actual, labels);
    assert.doesNotMatch(hero, /Non imputés|Imputé \{paymentsReady/);
    assert.match(hero, /cashOverview\.collectedLabel/);
    assert.match(hero, /remainingLabel/);
  });

  it("FIN-12 Mobile student hero has one Obligation plus two mini cards", () => {
    const source = read("Mobile/src/screens/StudentPaymentsScreen.tsx");
    assert.match(source, /<Text style=\{localStyles\.heroLabel\}>Obligation<\/Text>/);
    const actual = [...source.matchAll(/<KpiMiniCard\s+label="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(actual, ["Encaissé", "Reste à payer"]);
    assert.match(source, /cashOverview\.collectedLabel/);
    assert.match(source, /paymentAmountOverview\.remainingLabel/);
  });

  it("FIN-10 Home / unpaid copy uses Reste à payer, receipts and payment selection untouched", () => {
    const home = read("Mobile/src/screens/HomeScreen.tsx");
    const unpaid = read("Mobile/src/screens/UnpaidScreen.tsx");
    assert.match(home, /receivableLabel, "Reste à payer"/);
    assert.doesNotMatch(unpaid, /Reste dû/);
    assert.match(unpaid, /Reste à payer/);
    assert.match(read("Mobile/src/components/PaymentMutationControls.tsx"), /label: "Non imputé"/);
    assert.match(read("Mobile/src/components/PaymentReceiptCard.tsx"), /Non imputé/);
  });
});
