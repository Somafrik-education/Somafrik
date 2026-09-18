import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UNPAID_UNKNOWN_CURRENCY_LABEL,
  classOptionsFromUnpaid,
  filterUnpaidRows,
  periodOptionsFromUnpaid,
  unpaidTotalsByCurrency,
} from "./unpaidFilters";

const rows = [
  {
    studentId: "A",
    studentName: "Amina K.",
    matricule: "STU-001",
    className: "1ère A",
    periodLabel: "T1 2026",
    amountDue: 55000,
    currency: "CDF",
  },
  {
    studentId: "B",
    studentName: "Ben L.",
    className: "2nde B",
    periodLabel: "T2 2026",
    amountDue: 80,
    currency: "USD",
  },
  {
    studentId: "C",
    studentName: "Chloé M.",
    className: "1ère A",
    periodLabel: "T1 2026",
    amountDue: 100000,
    currency: "CDF",
  },
];

test("filterUnpaidRows — recherche / classe / période sans toucher amountDue", () => {
  const byClass = filterUnpaidRows(rows, { className: "1ère A" });
  assert.equal(byClass.length, 2);
  assert.equal(byClass[0]?.amountDue, 55000);
  assert.equal(byClass[1]?.amountDue, 100000);

  const byPeriod = filterUnpaidRows(rows, { period: "T2 2026" });
  assert.equal(byPeriod.length, 1);
  assert.equal(byPeriod[0]?.studentId, "B");

  const bySearch = filterUnpaidRows(rows, { search: "stu-001" });
  assert.equal(bySearch.length, 1);
  assert.equal(bySearch[0]?.studentName, "Amina K.");
});

test("unpaidTotalsByCurrency — pas de somme multi-devise, devise absente explicite", () => {
  const mixed = unpaidTotalsByCurrency(rows);
  assert.deepEqual(mixed.totalsByCurrency, [
    { currency: "CDF", amount: 155000 },
    { currency: "USD", amount: 80 },
  ]);
  assert.equal(mixed.totalAmountDue, 0);
  assert.equal(mixed.currency, "");

  const unknown = unpaidTotalsByCurrency([{ amountDue: 10, currency: "" }]);
  assert.equal(unknown.totalsByCurrency[0]?.currency, UNPAID_UNKNOWN_CURRENCY_LABEL);
  assert.equal(unknown.totalAmountDue, 0);

  const single = unpaidTotalsByCurrency(rows.filter((row) => row.currency === "CDF"));
  assert.equal(single.currency, "CDF");
  assert.equal(single.totalAmountDue, 155000);
});

test("options classe / période depuis le ledger DTO", () => {
  assert.deepEqual(classOptionsFromUnpaid(rows), ["1ère A", "2nde B"]);
  assert.deepEqual(periodOptionsFromUnpaid(rows), ["T1 2026", "T2 2026"]);
});
