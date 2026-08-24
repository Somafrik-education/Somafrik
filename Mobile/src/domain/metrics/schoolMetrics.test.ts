/**
 * Contrat de scope métriques — [] n'est pas un dataset global.
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

function payment(id: string, studentId: string, status = "PAYE") {
  return { id, studentId, amount: 1000, status };
}

function run() {
  assert.match(SOURCE, /studentIds === undefined/);
  assert.doesNotMatch(SOURCE, /studentIds\?\.length/);
  assert.match(SOURCE, /scopeRowsByStudentIds/);

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

  console.log("OK: schoolMetrics empty scoped ids MUST NOT fallback to global dataset");
}

run();
