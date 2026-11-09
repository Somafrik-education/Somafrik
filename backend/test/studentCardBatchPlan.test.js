"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { planStudentCardBatch } = require("../lib/studentCardBatchPlan");

test("classe vide : zéro candidat, aucune mutation", () => {
  assert.deepEqual(planStudentCardBatch([]).counts, { issueCandidates: 0, alreadyActive: 0, ineligible: 0 });
});

test("carte active jamais candidate à un remplacement automatique", () => {
  const plan = planStudentCardBatch([{ studentId: "a", eligible: true, holderKind: "eleve", hasActiveCard: true }]);
  assert.deepEqual(plan.counts, { issueCandidates: 0, alreadyActive: 1, ineligible: 0 });
  assert.equal(plan.entries[0].decision, "already_active");
});

test("n'émet pas si titulaire inconnu ou élève non éligible", () => {
  const plan = planStudentCardBatch([
    { studentId: "a", eligible: true, holderKind: null, hasActiveCard: false },
    { studentId: "b", eligible: false, holderKind: "etudiant", hasActiveCard: false },
    { studentId: "c", eligible: true, holderKind: "etudiant", hasActiveCard: false },
  ]);
  assert.deepEqual(plan.counts, { issueCandidates: 1, alreadyActive: 0, ineligible: 2 });
  assert.deepEqual(plan.entries.map(x => x.reason), ["HOLDER_UNDETERMINED", "NOT_ELIGIBLE", null]);
});

test("doublons et identifiants absents rejetés", () => {
  assert.throws(() => planStudentCardBatch([{}, {}]), /Identifiant élève/);
  assert.throws(() => planStudentCardBatch([{ studentId: "a" }, { studentId: " a " }]), /dupliqué/);
  assert.throws(() => planStudentCardBatch(null), /Liste/);
});

test("état de carte inconnu : fail-closed, aucune émission candidate", () => {
  for (const unknown of [undefined, null, "false", 0]) {
    const plan = planStudentCardBatch([{ studentId: "a", eligible: true, holderKind: "eleve", hasActiveCard: unknown }]);
    assert.equal(plan.counts.issueCandidates, 0);
    assert.equal(plan.entries[0].reason, "CARD_STATE_UNDETERMINED");
  }
});

test("état de carte actif explicite reste non remplaçable même si inéligible", () => {
  const plan = planStudentCardBatch([{ studentId: "a", eligible: false, holderKind: null, hasActiveCard: true }]);
  assert.equal(plan.entries[0].decision, "already_active");
});
