"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeWriteItems,
  decoratePaymentWithItems,
  inventoryHistoricalPayments,
  resolvePaymentMethod,
} = require("./financePaymentItems");
const { FINANCE_ERROR } = require("./financeManagement");

test("items vides refusés", () => {
  assert.throws(
    () => normalizeWriteItems({ items: [] }),
    (error) => error.code === FINANCE_ERROR.PAYMENT_ITEMS_REQUIRED,
  );
});

test("legacy feeType+amount devient une ligne", () => {
  const items = normalizeWriteItems({ feeType: "Minerval / scolarité", amount: 500 });
  assert.equal(items.length, 1);
  assert.equal(items[0].amount, 500);
});

test("total client ignoré — decorate somme les lignes", () => {
  const payment = decoratePaymentWithItems(
    { amount: 1, reference: "PAY-0004", feeType: "x" },
    [
      { fee_label: "Minerval", amount: 500 },
      { fee_label: "Examen", amount: 1 },
      { fee_label: "Cantine", amount: 40 },
    ],
  );
  assert.equal(payment.totalAmount, 541);
  assert.equal(payment.itemCount, 3);
  assert.equal(payment.itemsDetail, "3 libellés");
});

test("FIN-L3-06-C GET /payments : decorate écrase amount persisté par SUM(items)", () => {
  const payment = decoratePaymentWithItems(
    {
      id: "FIX-L306-CDF-COUNTED",
      reference: "FIX-L306-CDF-COUNTED",
      amount: 754_250,
      totalAmount: 754_250,
      status: "Payé",
      currency: "CDF",
    },
    [
      { fee_label: "Minerval", amount: 754_250 },
      { fee_label: "Ligne items", amount: 200 },
    ],
  );
  assert.equal(payment.amount, 754_450, "API amount final = SUM(items), pas payments.amount");
  assert.equal(payment.totalAmount, 754_450);
  assert.notEqual(payment.amount, 754_250);
  assert.equal(payment.items.length, 2);
});

test("inventaire historique : pas de fusion élève+date", () => {
  const report = inventoryHistoricalPayments({ payments: 10, paymentsWithItems: 10, paymentsWithoutItems: 0 });
  assert.equal(report.mergeByStudentAndDate, false);
  assert.equal(report.backfillStrategy, "one-payment-one-item");
});

test("paymentMethod cash → Espèces", () => {
  assert.equal(resolvePaymentMethod({ paymentMethod: "cash" }), "Espèces");
});

test("FIN-L3-06-C chemin GET /payments → listFinanceProjection → decoratePaymentWithItems", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.resolve(__dirname, "../..");
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

  const server = read("backend/server.js");
  const getStart = server.indexOf('app.get("/api/payments"');
  const getEnd = server.indexOf('app.post("/api/payments"');
  const getHandler = server.slice(getStart, getEnd);
  assert.match(getHandler, /loadCanonicalFinanceForPrincipal/, "handler GET /api/payments");
  assert.doesNotMatch(getHandler, /decoratePaymentWithItems/, "le handler HTTP ne décore pas lui-même");

  const loader = server.slice(
    server.indexOf("async function loadCanonicalFinanceForPrincipal"),
    server.indexOf("async function getAuthoritativeBackOfficeState"),
  );
  assert.match(loader, /repository\.listFinanceProjection/);

  const pgRepo = read("backend/db/postgresRepository.js");
  assert.match(pgRepo, /listFinanceProjection\(\) \{\s*return this\.getFinanceStore\(\)\.listProjection\(\);/s);

  const pgStore = read("backend/db/financePgStore.js");
  const listStart = pgStore.indexOf("async listProjection()");
  const listFn = pgStore.slice(listStart, listStart + 4500);
  assert.match(listFn, /decoratePaymentWithItems\(mapPaymentRow\(row\), itemsByPayment\.get\(row\.id\) \|\| \[\]\)/);
  assert.match(listFn, /SELECT \* FROM payment_items/);

  const memoryStore = read("backend/db/financeMemoryStore.js");
  assert.match(memoryStore, /decoratePaymentWithItems\(/);

  const web = read("web/src/lib/financeApi.ts");
  assert.match(web, /listPayments: \(\) => api\.get<FinancePayment\[\]>\("\/payments"\)/);

  const mobile = read("Mobile/src/services/api.ts");
  assert.match(mobile, /request<unknown>\("\/payments"\)\.then\(\(payload\) => unwrapList\(payload\)\.map\(normalizePaymentRow\)\)/);
});
