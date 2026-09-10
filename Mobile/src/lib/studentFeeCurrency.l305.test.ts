/**
 * FIN-L3-05-A — GET /finance/student-fees.currency doit survivre à la normalisation Mobile.
 *   npx tsx Mobile/src/lib/studentFeeCurrency.l305.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatPaymentOverviewAmounts } from "./paymentAmountBreakdown";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = fs.readFileSync(path.join(srcRoot, "services/api.ts"), "utf8");

function run() {
  const typeStart = api.indexOf("export type CanonicalStudentFee");
  const typeBlock = api.slice(typeStart, api.indexOf("function normalizeStudentFeeRow"));
  assert.match(typeBlock, /currency/, "FIN-L3-05-A4 CanonicalStudentFee.currency");
  const fnStart = api.indexOf("function normalizeStudentFeeRow");
  const fn = api.slice(fnStart, api.indexOf("export function getStudentFees"));
  assert.match(fn, /row\.currency/, "FIN-L3-05-A4 normalize lit row.currency");
  assert.match(fn, /currency:/, "FIN-L3-05-A4 normalize écrit currency");
  assert.doesNotMatch(fn, /catalogCurrency|schoolCurrency/, "jamais fallback école");

  const fees = [
    {
      studentId: "s-cdf",
      amountDue: 1_840_500,
      amountPaid: 750_499,
      exemption: 0,
      status: "À payer",
      currency: "CDF",
    },
    {
      studentId: "s-usd",
      amountDue: 3_100,
      amountPaid: 2_100,
      exemption: 0,
      status: "À payer",
      currency: "USD",
    },
  ];
  const formatted = formatPaymentOverviewAmounts(fees);
  assert.match(formatted.expectedLabel, /1[\s\u00a0\u202f]?840[\s\u00a0\u202f]?500 CDF/, "FIN-L3-05-A1");
  assert.match(formatted.expectedLabel, /3[\s\u00a0\u202f]?100 USD/, "FIN-L3-05-A1");
  assert.equal(/1[\s\u00a0\u202f]?843[\s\u00a0\u202f]?600/.test(formatted.expectedLabel), false);
  assert.match(formatted.remainingLabel, /1[\s\u00a0\u202f]?090[\s\u00a0\u202f]?001 CDF/, "FIN-L3-05-A2");
  assert.match(formatted.remainingLabel, /1[\s\u00a0\u202f]?000 USD/, "FIN-L3-05-A2");
  assert.equal(/1[\s\u00a0\u202f]?091[\s\u00a0\u202f]?001/.test(formatted.remainingLabel), false);

  const mixed = formatPaymentOverviewAmounts([
    fees[0]!,
    { studentId: "s-miss", amountDue: 50, amountPaid: 0, exemption: 0, status: "À payer", currency: "   " },
  ]);
  assert.match(mixed.expectedLabel, /CDF/);
  assert.match(mixed.expectedLabel, /Devise non renseignée/, "FIN-L3-05-A3");
  assert.equal(/1[\s\u00a0\u202f]?840[\s\u00a0\u202f]?550/.test(mixed.expectedLabel), false);
}

run();
console.log("PASS Mobile FIN-L3-05-A studentFeeCurrency");
