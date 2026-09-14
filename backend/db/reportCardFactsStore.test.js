"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { weightedAverage } = require("../lib/gradesCanonical");
const {
  aggregateCanonicalFacts,
  resolveFacts,
  identitiesFromSnapshot,
  factKey,
} = require("./reportCardFactsStore");

function gradeRow(overrides = {}) {
  return {
    student_id: "STU-1",
    subject_id: "MATH",
    period_id: "T1",
    score_component_id: "TJ",
    score: 10,
    max_score: 20,
    coefficient: 1,
    grade_status: "graded",
    ...overrides,
  };
}

test("report-card-lot9-facts-resolve-refuses-missing-live-identity", () => {
  const identity = {
    student_id: "STU-1",
    subject_id: "MATH",
    period_id: "T1",
    score_component_id: "TJ",
  };
  assert.equal(resolveFacts([identity], []), null);
  assert.equal(resolveFacts([identity], null), null);
  const live = [{ ...identity, raw_score: 16, subject_applicable: true, subject_id: "PHYS" }];
  assert.equal(resolveFacts([identity], live), null);
});

test("report-card-lot9-facts-aggregate-weighted-average-not-latest-wins", () => {
  const newerHigh = gradeRow({
    score: 20,
    max_score: 20,
    coefficient: 1,
    updated_at: "2026-09-14T12:00:00.000Z",
  });
  const olderWeighted = gradeRow({
    score: 8,
    max_score: 10,
    coefficient: 3,
    updated_at: "2026-09-01T12:00:00.000Z",
  });
  const expected = weightedAverage(
    [
      { score: 20, maxScore: 20, coefficient: 1, gradeStatus: "graded" },
      { score: 8, maxScore: 10, coefficient: 3, gradeStatus: "graded" },
    ],
    { displayScale: 20 }
  ).average;
  const forward = aggregateCanonicalFacts([newerHigh, olderWeighted]);
  const reversed = aggregateCanonicalFacts([olderWeighted, newerHigh]);
  assert.equal(forward.length, 1);
  assert.equal(forward[0].raw_score, expected);
  assert.equal(reversed[0].raw_score, expected);
  assert.notEqual(expected, 20);
  assert.equal(factKey(forward[0]), factKey(newerHigh));
});

test("report-card-lot9-facts-snapshot-identities-ignore-historical-scores", () => {
  const payload = {
    students: [
      {
        student_id: "STU-1",
        cells: [
          {
            subject_id: "MATH",
            period_id: "T1",
            score_component_id: "TJ",
            kind: "NUMERIC",
            internal: 12,
            exposed: "12",
          },
        ],
      },
    ],
  };
  const identities = identitiesFromSnapshot(payload);
  assert.equal(identities.length, 1);
  assert.equal("raw_score" in identities[0], false);
  assert.equal(identities[0].student_id, "STU-1");
});
