import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeUnpaidLedger } from "./unpaidLedger";
import { financeSummaryColumns } from "./financeListUx";

const SCHOOL = "CD-2026-0001";
const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const paymentsScreen = read("screens/PaymentsScreen.tsx");
const receiptCard = read("components/PaymentReceiptCard.tsx");
const unpaidScreen = read("screens/UnpaidScreen.tsx");
const expandableCard = read("components/ExpandableFinanceCard.tsx");

// Maquette Mobile v7 : résumé financier en deux colonnes, replié à 360 dp.
assert.match(paymentsScreen, /useWindowDimensions/);
assert.match(paymentsScreen, /financeSummaryColumns/);
assert.match(paymentsScreen, /styles\.financeHero/);
assert.equal(financeSummaryColumns(360), 1);
assert.equal(financeSummaryColumns(390), 2);
assert.equal(financeSummaryColumns(430), 2);

// Paiements récents : résumé compact, détails et actions uniquement au dépliage.
assert.match(receiptCard, /ExpandableFinanceCard/);
assert.match(expandableCard, /accessibilityState/);
assert.match(receiptCard, /Référence/);
assert.match(receiptCard, /Moyen/);
assert.match(receiptCard, /Libellés/);
assert.match(receiptCard, /Non imputé/);

// Impayés : même grammaire de carte dépliable et conservation des données métier.
assert.match(unpaidScreen, /ExpandableFinanceCard/);
assert.match(unpaidScreen, /Montant attendu/);
assert.match(unpaidScreen, /Montant payé/);
assert.match(unpaidScreen, /Reste dû/);
assert.match(unpaidScreen, /Échéance/);

// Une synthèse ne doit jamais additionner des monnaies différentes sous une seule devise.
const mixed = normalizeUnpaidLedger(
  {
    rows: [
      { studentId: "usd", studentName: "USD", schoolCode: SCHOOL, amountDue: 50, currency: "USD" },
      { studentId: "cdf", studentName: "CDF", schoolCode: SCHOOL, amountDue: 120_000, currency: "CDF" },
    ],
  },
  SCHOOL,
);
assert.deepEqual((mixed as unknown as { totalsByCurrency: unknown }).totalsByCurrency, [
  { currency: "CDF", amount: 120_000 },
  { currency: "USD", amount: 50 },
]);
assert.equal(mixed.currency, "", "un ledger multidevise ne publie pas une devise globale trompeuse");
assert.equal(mixed.totalAmountDue, 0, "un ledger multidevise ne publie pas une somme arithmétique trompeuse");

console.log("OK L1 UX Finance : maquette Paiements/Impayés et totaux séparés par devise");
