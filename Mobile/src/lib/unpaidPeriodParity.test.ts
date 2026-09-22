/**
 * HOLD #710 — même élève T1 + T2 : le filtre période Mobile ne doit pas
 * comparer `periodLabel === "Plusieurs périodes"`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { filterUnpaidRows, periodOptionsFromFees, unpaidTotalsByCurrency } from "./unpaidFilters";
import { normalizeUnpaidLedger } from "./unpaidLedger";

const SCHOOL = "CD-2026-0001";
const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const fees = [
  {
    id: "FEE-T1",
    studentId: "ELE-1",
    schoolCode: SCHOOL,
    periodLabel: "T1 2026",
    amountDue: 30_000,
    balance: 30_000,
    currency: "CDF",
  },
  {
    id: "FEE-T2",
    studentId: "ELE-1",
    schoolCode: SCHOOL,
    periodLabel: "T2 2026",
    amountDue: 20_000,
    balance: 20_000,
    currency: "CDF",
  },
];

const unfilteredPayload = {
  rows: [
    {
      studentId: "ELE-1",
      studentName: "Amina K.",
      matricule: "CD-LAC-AE-26-00001",
      schoolCode: SCHOOL,
      periodLabel: "Plusieurs périodes",
      amountDue: 50_000,
      currency: "CDF",
    },
  ],
  fees,
};

const t1Payload = {
  rows: [
    {
      studentId: "ELE-1",
      studentName: "Amina K.",
      matricule: "CD-LAC-AE-26-00001",
      schoolCode: SCHOOL,
      periodLabel: "T1 2026",
      amountDue: 30_000,
      currency: "CDF",
    },
  ],
  fees: [fees[0]],
};

const t2Payload = {
  rows: [
    {
      studentId: "ELE-1",
      studentName: "Amina K.",
      matricule: "CD-LAC-AE-26-00001",
      schoolCode: SCHOOL,
      periodLabel: "T2 2026",
      amountDue: 20_000,
      currency: "CDF",
    },
  ],
  fees: [fees[1]],
};

test("sans filtre serveur — 50 000 CDF / Plusieurs périodes", () => {
  const ledger = normalizeUnpaidLedger(unfilteredPayload, SCHOOL);
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0]?.amountDue, 50_000);
  assert.equal(ledger.rows[0]?.periodLabel, "Plusieurs périodes");
  assert.deepEqual(periodOptionsFromFees(ledger.fees), ["T1 2026", "T2 2026"]);
});

test("filtre client sur periodLabel ne produit pas T1=30 000", () => {
  const ledger = normalizeUnpaidLedger(unfilteredPayload, SCHOOL);
  const clientT1 = filterUnpaidRows(ledger.rows, { period: "T1 2026" });
  assert.equal(clientT1.length, 0, "le row agrégé Plusieurs périodes ne matche pas T1");
});

test("GET unpaid?period=T1 — DTO serveur 30 000, T2 — 20 000", () => {
  const t1 = normalizeUnpaidLedger(t1Payload, SCHOOL);
  assert.equal(t1.rows.length, 1);
  assert.equal(t1.rows[0]?.amountDue, 30_000);
  assert.equal(t1.rows[0]?.periodLabel, "T1 2026");
  assert.equal(unpaidTotalsByCurrency(t1.rows).totalAmountDue, 30_000);

  const t2 = normalizeUnpaidLedger(t2Payload, SCHOOL);
  assert.equal(t2.rows[0]?.amountDue, 20_000);
  assert.equal(unpaidTotalsByCurrency(t2.rows).totalAmountDue, 20_000);
  assert.notEqual(t1.rows[0]?.amountDue, 50_000);
});

test("recherche matricule — DTO live, pas seulement le fixture", () => {
  const ledger = normalizeUnpaidLedger(unfilteredPayload, SCHOOL);
  const found = filterUnpaidRows(ledger.rows, { search: "cd-lac-ae-26-00001" });
  assert.equal(found.length, 1);
  assert.equal(found[0]?.matricule, "CD-LAC-AE-26-00001");
});

test("multi-devise reste séparé après normalisation", () => {
  const mixed = normalizeUnpaidLedger(
    {
      rows: [
        { studentId: "a", schoolCode: SCHOOL, amountDue: 30_000, currency: "CDF", periodLabel: "T1 2026" },
        { studentId: "b", schoolCode: SCHOOL, amountDue: 80, currency: "USD", periodLabel: "T1 2026" },
      ],
      fees: [],
    },
    SCHOOL,
  );
  assert.equal(mixed.totalAmountDue, 0);
  assert.equal(mixed.currency, "");
  assert.deepEqual(mixed.totalsByCurrency, [
    { currency: "CDF", amount: 30_000 },
    { currency: "USD", amount: 80 },
  ]);
});

test("Mobile transmet period au serveur et ne filtre plus la période côté rows agrégés", () => {
  const api = fs.readFileSync(path.join(srcRoot, "services/api.ts"), "utf8");
  const hook = fs.readFileSync(path.join(srcRoot, "hooks/useUnpaidLedger.ts"), "utf8");
  const screen = fs.readFileSync(path.join(srcRoot, "screens/UnpaidScreen.tsx"), "utf8");
  assert.match(api, /period=\$\{encodeURIComponent\(period\)\}/);
  assert.match(hook, /getUnpaidLedger\(requestedSchoolCode, \{ period \}\)/);
  assert.match(screen, /period:\s*periodFilter/);
  assert.match(screen, /periodOptionsFromFees/);
  assert.doesNotMatch(screen, /filterUnpaidRows\([\s\S]*period:\s*periodFilter/);
});
