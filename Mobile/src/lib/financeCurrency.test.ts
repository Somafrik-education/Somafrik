import assert from "node:assert/strict";
import { formatFinanceAmount, formatFinanceDate, resolveFinanceCurrency } from "./financeCurrency";
import {
  financeObligationStatusLabel,
  financeObligationStatusKey,
} from "./financeObligationStatus";

assert.equal(resolveFinanceCurrency("", "cdf"), "CDF");
assert.equal(resolveFinanceCurrency(), "");
assert.equal(formatFinanceAmount(12000, ""), "—");
assert.match(formatFinanceAmount(25000, "CDF"), /25[\s\u00a0]?000 CDF/);
assert.equal(formatFinanceDate("2026-08-19"), "19/08/2026");
assert.equal(financeObligationStatusLabel("Partiellement payé"), "Partiellement payé");
assert.equal(financeObligationStatusLabel("À payer"), "Impayé");
assert.equal(financeObligationStatusKey("Annulé"), "cancelled");
console.log("financeCurrency + obligation status OK");
