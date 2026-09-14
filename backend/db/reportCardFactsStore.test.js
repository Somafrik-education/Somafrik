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
  const opts = { scaleByComponent: { TJ: 20 } };
  const forward = aggregateCanonicalFacts([newerHigh, olderWeighted], opts);
  const reversed = aggregateCanonicalFacts([olderWeighted, newerHigh], opts);
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

test("report-card-lot9-facts-aggregate-uses-pinned-component-max", () => {
  const { scaleByComponentFromProfile } = require("./reportCardFactsStore");
  const rows = [
    gradeRow({ score: 8, max_score: 10, coefficient: 1 }),
    gradeRow({ score: 4, max_score: 10, coefficient: 1 }),
  ];
  const expected = weightedAverage(
    [
      { score: 8, maxScore: 10, coefficient: 1, gradeStatus: "graded" },
      { score: 4, maxScore: 10, coefficient: 1, gradeStatus: "graded" },
    ],
    { displayScale: 10 }
  ).average;
  const scaled = aggregateCanonicalFacts(rows, { scaleByComponent: { TJ: 10 } });
  const twenty = aggregateCanonicalFacts(rows, { scaleByComponent: { TJ: 20 } });
  assert.equal(scaled[0].raw_score, expected);
  assert.equal(Number(scaled[0].raw_score.toFixed(2)), 6);
  assert.notEqual(twenty[0].raw_score, scaled[0].raw_score);
  assert.equal(aggregateCanonicalFacts(rows, {}).length, 0);
  assert.deepEqual(scaleByComponentFromProfile({ score_components: [{ id: "TJ", max: 10 }] }), { TJ: 10 });
});

test("report-card-lot9-facts-resolve-cohort-requires-class-and-year", () => {
  const { createMemoryFactsStore } = require("./reportCardFactsStore");
  const store = createMemoryFactsStore([]);
  assert.equal(store.resolveCohort({ classId: "class-1" }), null);
  assert.deepEqual(store.resolveCohort({ classId: "class-1", academicYearId: "year-1" }), {
    classId: "class-1",
    academicYearId: "year-1",
  });
});
