/**
 * Contrat de scope métriques — [] n'est pas un dataset global.
 * Cartes Payés / Impayés : un reçu Annulé n'est ni l'un ni l'autre.
 *   npx tsx Mobile/src/domain/metrics/schoolMetrics.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  EMPTY_SCOPED_IDS_MUST_NOT_FALLBACK_TO_GLOBAL,
  getPaymentStats,
  getPresenceStats,
  scopeRowsByStudentIds,
} from "./schoolMetrics";
import type { PaymentItem } from "../../data/catalog";

const SOURCE = fs.readFileSync(path.join("src", "domain", "metrics", "schoolMetrics.ts"), "utf8");

function presence(id: string, studentId: string, status: string) {
  return {
    id,
    publicId: id,
    studentId,
    date: "2026-08-24",
    present: status === "Présent" || status === "Retard",
    status,
  };
}

function payment(id: string, studentId: string, status = "PAYE", amount = 1000): PaymentItem {
  return { id, studentId, amount, status };
}

function run() {
  assert.match(SOURCE, /studentIds === undefined/);
  assert.doesNotMatch(SOURCE, /studentIds\?\.length/);
  assert.match(SOURCE, /scopeRowsByStudentIds/);
  assert.match(SOURCE, /isCancelledPayment/);
  assert.doesNotMatch(
    SOURCE,
    /pendingRows = scopedRows\.filter\(\(payment\) => !isPaidPayment\(payment\)\)/,
    "Impayés ne doit plus être !isPaidStatus",
  );

  const globalPresences = [
    presence("p1", "s1", "Présent"),
    presence("p2", "s2", "Présent"),
    presence("p3", "s3", "Présent"),
    presence("p4", "s4", "Présent"),
    presence("p5", "s5", "Présent"),
    presence("p6", "s6", "Absent"),
    presence("p7", "s7", "Absent"),
  ];
  const globalStats = getPresenceStats(globalPresences);
  assert.equal(globalStats.total, 7);
  assert.equal(globalStats.attended, 5);
  assert.equal(globalStats.rate, 71, "dataset global 5/7 = 71 %");

  const emptyScope = getPresenceStats(globalPresences, []);
  assert.equal(emptyScope.total, 0, EMPTY_SCOPED_IDS_MUST_NOT_FALLBACK_TO_GLOBAL);
  assert.equal(emptyScope.attended, 0, EMPTY_SCOPED_IDS_MUST_NOT_FALLBACK_TO_GLOBAL);
  assert.equal(emptyScope.rate, 0, EMPTY_SCOPED_IDS_MUST_NOT_FALLBACK_TO_GLOBAL);
  assert.deepEqual(
    scopeRowsByStudentIds(globalPresences, []),
    [],
    "empty scoped ids MUST NOT fallback to global dataset",
  );

  const scoped = getPresenceStats(globalPresences, ["s1", "s6"]);
  assert.equal(scoped.total, 2);
  assert.equal(scoped.attended, 1);
  assert.equal(scoped.rate, 50);

  const undefinedScope = getPresenceStats(globalPresences, undefined);
  assert.equal(undefinedScope.rate, 71);

  const globalPayments = [
    payment("pay1", "s1"),
    payment("pay2", "s2"),
    payment("pay3", "s3", "EN_ATTENTE"),
  ];
  assert.equal(getPaymentStats(globalPayments).rate, 67);
  const emptyPayments = getPaymentStats(globalPayments, []);
  assert.equal(emptyPayments.total, 0, EMPTY_SCOPED_IDS_MUST_NOT_FALLBACK_TO_GLOBAL);
  assert.equal(emptyPayments.paid, 0, EMPTY_SCOPED_IDS_MUST_NOT_FALLBACK_TO_GLOBAL);
  assert.equal(emptyPayments.rate, 0, EMPTY_SCOPED_IDS_MUST_NOT_FALLBACK_TO_GLOBAL);
  assert.deepEqual(
    scopeRowsByStudentIds(globalPayments, []),
    [],
    "empty scoped ids MUST NOT fallback to global dataset",
  );
  assert.equal(getPaymentStats(globalPayments, ["s1", "s3"]).rate, 50);

  const paidOnly = getPaymentStats([payment("p1", "stu-1", "Payé", 200)]);
  assert.equal(paidOnly.paid, 1);
  assert.equal(paidOnly.pending, 0);
  assert.equal(paidOnly.paidAmount, 200);

  const cancelled = getPaymentStats([payment("p-cancel", "stu-1", "Annulé", 200)]);
  assert.equal(cancelled.paid, 0, "Annulé exclu de Payés");
  assert.equal(cancelled.pending, 0, "Annulé exclu de Impayés");
  assert.equal(cancelled.pendingAmount, 0);
  assert.equal(cancelled.paidAmount, 0);
  assert.equal(cancelled.total, 0);

  const cancelledEnglish = getPaymentStats([payment("p-cancel-en", "stu-1", "cancelled", 200)]);
  assert.equal(cancelledEnglish.pending, 0);
  assert.equal(cancelledEnglish.paid, 0);

  const mix = getPaymentStats([
    payment("p-paid", "stu-1", "Payé", 200),
    payment("p-cancel", "stu-1", "Annulé", 200),
    payment("p-wait", "stu-1", "En attente", 150),
  ]);
  assert.equal(mix.paid, 1);
  assert.equal(mix.pending, 1, "seul En attente reste impayé");
  assert.equal(mix.pendingAmount, 150);
  assert.equal(mix.total, 2);

  const leftover = getPaymentStats([payment("p-left", "stu-1", "Non imputé", 150)]);
  assert.equal(leftover.paid, 0, "Non imputé n'est pas Payé");
  assert.equal(leftover.pending, 0, "Non imputé n'est pas Impayé");
  assert.equal(leftover.unallocated, 1);
  assert.equal(leftover.unallocatedAmount, 150);

  console.log("OK: schoolMetrics empty scoped ids MUST NOT fallback to global dataset");
  console.log("OK: getPaymentStats Annulé hors Payés et Impayés");
  console.log("OK: getPaymentStats Non imputé hors Payés et Impayés");
}

run();
