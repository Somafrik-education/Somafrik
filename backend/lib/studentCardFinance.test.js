"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  STUDENT_CARD_FINANCE_ERROR,
  hasFinanceIntent,
  assertStudentCardScanIntents,
  assertStudentCardFinanceEnabled,
  classifyStudentCardFinance,
  scanStudentCardFinance,
} = require("./studentCardFinance");

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const FUTURE = "2026-11-06";
const PAST = "2026-09-01";
const TODAY = "2026-10-06";

function fee(overrides) {
  return {
    status: "À payer",
    balance: 100,
    amountDue: 100,
    amountPaid: 0,
    exemption: 0,
    currency: "CDF",
    dueDate: FUTURE,
    ...overrides,
  };
}

function classify(fees, extras = {}) {
  return classifyStudentCardFinance({
    fees,
    payments: extras.payments || [],
    applicableGrid: extras.applicableGrid || false,
    now: extras.now || NOW,
  });
}

test("CARTE-PR5 — finance:true seul est une intention", () => {
  assert.equal(hasFinanceIntent({ cardToken: "pub.secret", finance: true }), true);
  assert.equal(hasFinanceIntent({ cardToken: "pub.secret" }), false);
  assert.equal(hasFinanceIntent({ cardToken: "pub.secret", finance: false }), false);
  assert.equal(hasFinanceIntent({ cardToken: "pub.secret", finance: null }), false);
  assert.equal(hasFinanceIntent({ finance: { studentId: "forged" } }), false);
  assert.equal(hasFinanceIntent(null), false);
});

test("CARTE-PR5 — attendance et finance dans le même body sont en conflit", () => {
  assert.throws(
    () => assertStudentCardScanIntents({
      cardToken: "pub.secret",
      attendance: { date: TODAY, status: "present" },
      finance: true,
    }),
    (error) => error.statusCode === 400 && error.code === STUDENT_CARD_FINANCE_ERROR.INTENTS_CONFLICT,
  );
  assert.doesNotThrow(() => assertStudentCardScanIntents({ cardToken: "pub.secret", finance: false }));
  assert.doesNotThrow(() => assertStudentCardScanIntents({ cardToken: "pub.secret", finance: null }));
  assert.doesNotThrow(() => assertStudentCardScanIntents({
    cardToken: "pub.secret",
    attendance: { date: TODAY, status: "present" },
    finance: false,
  }));
});

test("CARTE-PR5 — un objet finance forgé est refusé", () => {
  assert.throws(
    () => assertStudentCardScanIntents({
      cardToken: "pub.secret",
      finance: { studentId: "other", schoolId: "other-school" },
    }),
    (error) => error.statusCode === 400 && error.code === STUDENT_CARD_FINANCE_ERROR.INTENT_INVALID,
  );
  assert.throws(
    () => assertStudentCardScanIntents({ finance: "true" }),
    (error) => error.code === STUDENT_CARD_FINANCE_ERROR.INTENT_INVALID,
  );
});

test("CARTE-PR5 — D2 future À payer, soldé, exonéré, annulé et vide restent À jour", () => {
  assert.equal(classify([]).code, "UP_TO_DATE");
  assert.equal(classify([fee({ dueDate: FUTURE })]).code, "UP_TO_DATE");
  assert.equal(classify([fee({ dueDate: TODAY })]).code, "UP_TO_DATE");
  assert.equal(classify([fee({ status: "Payé", balance: 0, amountPaid: 100 })]).code, "UP_TO_DATE");
  assert.equal(classify([fee({ status: "Exonéré", balance: 0, exemption: 100 })]).code, "UP_TO_DATE");
  assert.equal(classify([fee({ status: "Annulé", balance: 100, dueDate: PAST })]).code, "UP_TO_DATE");
  assert.equal(classify([fee()]).label, "À jour");
});

test("CARTE-PR5 — partiel avant échéance et échéance impayée", () => {
  const partial = classify([fee({
    status: "Partiellement payé",
    balance: 40,
    amountPaid: 60,
    dueDate: FUTURE,
  })]);
  assert.equal(partial.code, "PARTIAL");
  assert.equal(partial.label, "Paiement partiel");

  assert.equal(classify([fee({ status: "À payer", dueDate: PAST })]).code, "OVERDUE");
  assert.equal(classify([fee({ status: "En retard", dueDate: PAST })]).code, "OVERDUE");
  assert.equal(classify([fee({
    status: "Partiellement payé",
    balance: 40,
    amountPaid: 60,
    dueDate: PAST,
  })]).code, "OVERDUE");
  assert.equal(classify([fee({ status: "En retard" })]).label, "Échéance impayée");
});

test("CARTE-PR5 — priorité REVIEW > OVERDUE > PARTIAL > UP_TO_DATE", () => {
  const mixed = [
    fee({ status: "Payé", balance: 0, amountPaid: 100 }),
    fee({ status: "Partiellement payé", balance: 20, amountPaid: 80, dueDate: FUTURE }),
    fee({ status: "En retard", balance: 50, dueDate: PAST }),
  ];
  assert.equal(classify(mixed).code, "OVERDUE");
  assert.equal(classify(mixed, {
    payments: [{ status: "Non imputé", amount: 500, unallocatedAmount: 500 }],
  }).code, "REVIEW");
  assert.equal(classify(mixed, {
    payments: [{ status: "Non imputé", amount: 500, unallocatedAmount: 500 }],
  }).label, "Situation à vérifier");
});

test("CARTE-PR5 — Non imputé, devises mixtes et grille sans obligation", () => {
  assert.equal(classify([fee()], {
    payments: [{ status: "Non imputé", amount: 1000, unallocatedAmount: 1000, currency: "CDF" }],
  }).code, "REVIEW");
  assert.equal(classify([fee()], {
    payments: [{ status: "Payé", amount: 1000, unallocatedAmount: 200 }],
  }).code, "REVIEW");
  assert.equal(classify([fee()], {
    payments: [{ status: "Annulé", amount: 1000, unallocatedAmount: 1000, cancelledAt: "2026-10-01" }],
  }).code, "UP_TO_DATE");
  assert.equal(classify([
    fee({ currency: "CDF" }),
    fee({ currency: "USD", status: "Payé", balance: 0 }),
  ]).code, "REVIEW");
  assert.equal(classify([], { applicableGrid: true }).code, "REVIEW");
  assert.equal(classify([], { applicableGrid: false }).code, "UP_TO_DATE");
  assert.equal(classify(null).code, "REVIEW");
});

test("CARTE-PR5 — le flag finance réutilise la capacité existante", async () => {
  const disabled = {
    getSchoolSettingsStore() {
      return { getSettings: async () => ({ student_card_enabled: true, student_card_finance_check_enabled: false }) };
    },
  };
  await assert.rejects(
    () => assertStudentCardFinanceEnabled(disabled, "school-a"),
    (error) => error.statusCode === 404 && error.code === STUDENT_CARD_FINANCE_ERROR.DISABLED,
  );
  const masterOff = {
    getSchoolSettingsStore() {
      return { getSettings: async () => ({ student_card_enabled: false, student_card_finance_check_enabled: true }) };
    },
  };
  await assert.rejects(
    () => assertStudentCardFinanceEnabled(masterOff, "school-a"),
    (error) => error.code === STUDENT_CARD_FINANCE_ERROR.DISABLED,
  );
});

test("CARTE-PR5 — la lecture passe l'élève du resolver et masque l'erreur SQL", async () => {
  const calls = [];
  const repo = {
    async listFinanceStudentFees(_principal, options) {
      calls.push(["fees", options]);
      return [fee({ dueDate: FUTURE })];
    },
    async listFinanceStudentPayments(_principal, options) {
      calls.push(["payments", options]);
      return [];
    },
    async hasApplicableActiveFeeGrid(_principal, options) {
      calls.push(["grid", options]);
      return false;
    },
  };
  const resolved = { student: { id: "student-a" }, class: { id: "class-a" } };
  const badge = await scanStudentCardFinance(repo, resolved, { sub: "admin" }, { now: NOW });
  assert.equal(badge.code, "UP_TO_DATE");
  assert.deepEqual(calls, [
    ["fees", { studentId: "student-a" }],
    ["payments", { studentId: "student-a" }],
    ["grid", { classId: "class-a" }],
  ]);

  repo.listFinanceStudentFees = async () => {
    throw new Error("select * from student_fee_obligations failed");
  };
  const hidden = await scanStudentCardFinance(repo, resolved, { sub: "admin" }, { now: NOW });
  assert.equal(hidden.code, "REVIEW");
  assert.equal(JSON.stringify(hidden).includes("student_fee_obligations"), false);
});

test("CARTE-PR5 — l'adaptateur ne répare pas la finance et ne fige pas la lecture", () => {
  const source = fs.readFileSync(path.join(__dirname, "studentCardFinance.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const store = fs.readFileSync(path.join(__dirname, "../db/financePgStore.js"), "utf8");
  const scanRoute = server.slice(
    server.indexOf('app.post("/api/student-cards/scan"'),
    server.indexOf('app.post("/api/student-cards/:id/replace"'),
  );
  const financeBranch = scanRoute.slice(scanRoute.indexOf("if (hasFinanceIntent(req.body))"));
  assert.match(source, /isDueDatePast/);
  assert.match(source, /isOverdueStudentFee/);
  assert.match(source, /studentCardFinanceCheckEnabled/);
  assert.match(source, /listFinanceStudentPayments/);
  assert.doesNotMatch(source, /ensureEnrollmentObligations|applyFinanceFeeGrid|reconcileFinancePaymentAllocations|createSchoolPayment|adjustFinanceStudentFee|listFinanceProjection|withIdempotency|last_scan_at|student_card_scanned/);
  assert.match(store, /listFinanceStudentFees: async \(principal, options = \{\}\)/);
  assert.match(store, /options\?\.studentId/);
  assert.match(financeBranch, /requirePermission\("GET \/api\/finance\/student-fees"\)/);
  assert.match(financeBranch, /scanStudentCardFinance/);
  assert.doesNotMatch(financeBranch, /withIdempotency|write_presence|upsertSchoolAttendanceBatch|listFinanceProjection/);
  assert.doesNotMatch(server, /write_student_card_finance|finance_scan|Cartes:FINANCE|Cartes:SCAN_FINANCE/);
});
