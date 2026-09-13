"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { canonicalize } = require("../../contracts/reportCard/jcs");
const { ENGINE_ID, LAYERS } = require("../../contracts/reportCard/contract");
const { validateSpec: validateProfileSpec } = require("./academicRuleProfile");
const { validateSpec: validateSchemaSpec } = require("./reportCardSchema");
const { scanEngineSources, scanText } = require("../../contracts/reportCard/noCountrySchoolBranch");

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";

function loadLot3() {
  try {
    return require("./reportCardEngine");
  } catch {
    return null;
  }
}

function validProfile(overrides = {}) {
  return validateProfileSpec({
    periods: ["T1", "T2", "T3"],
    annual: true,
    score_components: [
      { id: "TJ", applicability: "always", max: 20, coefficient: 1 },
      { id: "EX", applicability: "per_subject", max: 20, coefficient: 1 },
    ],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up" },
    ranking: { enabled: false, ties: "competition" },
    ...overrides,
  });
}

function validSchema(overrides = {}) {
  return validateSchemaSpec({
    sections: [
      {
        id: "SUBJECTS",
        order: 1,
        kind: "subject_rows",
        rows: [{ id: "SUBJECT_LINE", order: 1, kind: "subject" }],
        columns: [
          {
            id: "COL_T1_TJ",
            order: 1,
            kind: "score_component",
            score_component_id: "TJ",
            period_id: "T1",
          },
          {
            id: "COL_T1_EX",
            order: 2,
            kind: "score_component",
            score_component_id: "EX",
            period_id: "T1",
          },
        ],
      },
    ],
    ...overrides,
  });
}

function schemaWithSlot(slot) {
  return validSchema({
    sections: [
      {
        id: "SUBJECTS",
        order: 1,
        kind: "subject_rows",
        columns: [
          {
            id: "COL_T1_TJ",
            order: 1,
            kind: "score_component",
            score_component_id: "TJ",
            period_id: "T1",
          },
          { id: "COL_SLOT", order: 2, kind: "computed_slot", slot },
        ],
      },
    ],
  });
}

function schemaWithContextualSlot(slot, extra = {}) {
  return validateSchemaSpec({
    sections: [
      {
        id: "SUMMARY",
        order: 1,
        kind: "totals",
        columns: [{ id: "COL_SLOT", order: 1, kind: "computed_slot", slot, ...extra }],
      },
    ],
  });
}

function rankingProfile(ties) {
  return calculableProfile({
    ranking: { enabled: true, ties, metric: "PERCENTAGE" },
  });
}

function calculableProfileWithoutMax(overrides = {}) {
  return calculableProfile({
    score_components: [
      { id: "TJ", applicability: "always", coefficient: 2 },
      { id: "EX", applicability: "per_subject", max: 20, coefficient: 1 },
    ],
    ...overrides,
  });
}

function calculableProfile(overrides = {}) {
  return validateProfileSpec({
    periods: ["T1", "T2", "T3"],
    annual: true,
    score_components: [
      { id: "TJ", applicability: "always", max: 20, coefficient: 2 },
      { id: "EX", applicability: "per_subject", max: 20, coefficient: 1 },
    ],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up", stage: "display_only" },
    ranking: { enabled: false, ties: "competition" },
    aggregation: {
      mode: "weighted_sum",
      coefficient_default: 1,
      percentage: "points_over_max_100",
    },
    ...overrides,
  });
}

function findSlot(student, match) {
  return (student.slots || []).find(
    (entry) =>
      (match.section_id == null || entry.section_id === match.section_id) &&
      (match.column_id == null || entry.column_id === match.column_id) &&
      (match.slot == null || entry.slot === match.slot) &&
      (match.period_id == null || entry.period_id === match.period_id)
  );
}

function findPresence(student, match) {
  return (student.presence || []).find(
    (entry) =>
      (match.section_id == null || entry.section_id === match.section_id) &&
      (match.column_id == null || entry.column_id === match.column_id) &&
      (match.row_id == null || entry.row_id === match.row_id) &&
      (match.field_id == null || entry.field_id === match.field_id) &&
      (match.field_kind == null || entry.field_kind === match.field_kind)
  );
}

function fact(overrides = {}) {
  return {
    student_id: "STU-1",
    subject_id: "MATH",
    period_id: "T1",
    score_component_id: "TJ",
    raw_score: 12,
    subject_applicable: true,
    ...overrides,
  };
}

function compute(api, overrides = {}) {
  return api.computeReportCard({
    profile: validProfile(),
    schema: validSchema(),
    facts: [fact()],
    provenance: {
      profile: { id: "PROF-1", version: 1, spec_sha256: "aa" },
      schema: { id: "SCH-1", version: 1, spec_sha256: "bb" },
    },
    ...overrides,
  });
}

test("report-card-engine-calculability-pregate", () => {
  const profile = validProfile({
    ranking: { enabled: true, ties: "min" },
    pass_rule: { min_average: 10 },
    score_components: [{ id: "TJ", applicability: "always", coefficient: 2 }],
  });
  assert.equal(profile.layer, LAYERS[0]);
  assert.equal(profile.pass_rule.min_average, 10);
  assert.equal(profile.pass_rule.scale, undefined);
  assert.equal(profile.pass_rule.metric, undefined);
  assert.equal(profile.ranking.metric, undefined);
  assert.equal(profile.rounding.stage, undefined);
  assert.equal(profile.aggregation, undefined);
  assert.equal(profile.score_components[0].max, undefined);
  const note = fs.readFileSync(path.join(__dirname, "../../../docs/project/REPORT-CARD-LOT3-CALCULABILITY.md"), "utf8");
  assert.match(note, /CALCULABILITY_COEFFICIENT_AGGREGATION/);
  assert.match(note, /CALCULABILITY_PASS_RULE_SCALE/);
  assert.match(note, /HOLD/);
  assert.match(note, /LOT 1\.1/);
});

test("report-card-engine-deterministic", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const a = compute(api);
  const b = compute(api);
  assert.equal(a.engine_id, ENGINE_ID);
  assert.equal(canonicalize(a), canonicalize(b));
});

test("report-card-engine-input-order-independent", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const factsA = [
    fact({ subject_id: "MATH", raw_score: 10 }),
    fact({ subject_id: "PHYS", raw_score: 14 }),
  ];
  const factsB = [factsA[1], factsA[0]];
  const a = compute(api, { facts: factsA });
  const b = compute(api, { facts: factsB });
  assert.equal(canonicalize(a), canonicalize(b));
});

test("report-card-engine-profile-schema-compatible", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const badSchema = validateSchemaSpec({
    sections: [
      {
        id: "SUBJECTS",
        order: 1,
        kind: "subject_rows",
        columns: [{ id: "COL_T9", order: 1, kind: "period", period_id: "T9" }],
      },
    ],
  });
  assert.throws(
    () => compute(api, { schema: badSchema }),
    (err) => err.code === "INVALID_PROFILE_REFERENCE"
  );
});

test("report-card-engine-period-component-intersection", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const result = compute(api, {
    facts: [fact({ raw_score: 11 }), fact({ score_component_id: "EX", raw_score: 15 })],
  });
  const tj = result.students[0].cells.find(
    (cell) => cell.period_id === "T1" && cell.score_component_id === "TJ" && cell.subject_id === "MATH"
  );
  const ex = result.students[0].cells.find(
    (cell) => cell.period_id === "T1" && cell.score_component_id === "EX"
  );
  assert.equal(tj.kind, "NUMERIC");
  assert.equal(tj.internal, 11);
  assert.equal(ex.kind, "NUMERIC");
  assert.equal(ex.internal, 15);
});

test("report-card-engine-na-is-not-zero", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const result = compute(api, {
    facts: [fact({ score_component_id: "EX", subject_applicable: false, raw_score: 0 })],
  });
  const ex = result.students[0].cells.find((cell) => cell.score_component_id === "EX");
  assert.equal(ex.kind, "NOT_APPLICABLE");
  assert.equal(ex.internal, null);
  assert.notEqual(ex.internal, 0);
});

test("report-card-engine-zero-is-numeric", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const result = compute(api, { facts: [fact({ raw_score: 0 })] });
  const tj = result.students[0].cells.find((cell) => cell.score_component_id === "TJ");
  assert.equal(tj.kind, "NUMERIC");
  assert.equal(tj.internal, 0);
});

test("report-card-engine-component-applicability", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const na = compute(api, {
    facts: [fact({ score_component_id: "EX", subject_applicable: false, raw_score: 18 })],
  });
  const ok = compute(api, {
    facts: [fact({ score_component_id: "EX", subject_applicable: true, raw_score: 18 })],
  });
  assert.equal(na.students[0].cells.find((cell) => cell.score_component_id === "EX").kind, "NOT_APPLICABLE");
  assert.equal(ok.students[0].cells.find((cell) => cell.score_component_id === "EX").kind, "NUMERIC");
});

test("report-card-engine-weighted-points-max", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  assert.throws(
    () => compute(api, { schema: schemaWithSlot("PERIOD_POINTS") }),
    (err) => err.code === "CALCULABILITY_COEFFICIENT_AGGREGATION"
  );
  assert.throws(
    () => compute(api, { schema: schemaWithSlot("PERIOD_MAX") }),
    (err) => err.code === "CALCULABILITY_COEFFICIENT_AGGREGATION"
  );
  assert.throws(
    () =>
      compute(api, {
        profile: calculableProfile(),
        schema: schemaWithContextualSlot("PERIOD_POINTS"),
        facts: [fact({ raw_score: 12 })],
      }),
    (err) => err.code === "INVALID_SLOT_CONTEXT"
  );
  const points = compute(api, {
    profile: calculableProfile(),
    schema: schemaWithContextualSlot("PERIOD_POINTS", { period_id: "T1" }),
    facts: [fact({ raw_score: 12 })],
  });
  assert.equal(findSlot(points.students[0], { slot: "PERIOD_POINTS", period_id: "T1" }).internal, 24);
  const max = compute(api, {
    profile: calculableProfile(),
    schema: schemaWithContextualSlot("PERIOD_MAX", { period_id: "T1" }),
    facts: [fact({ raw_score: 12 })],
  });
  assert.equal(findSlot(max.students[0], { slot: "PERIOD_MAX", period_id: "T1" }).internal, 40);
});

test("report-card-engine-period-aggregates", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  assert.throws(
    () => compute(api, { schema: schemaWithSlot("TOTAL") }),
    (err) => err.code === "CALCULABILITY_COEFFICIENT_AGGREGATION"
  );
  assert.throws(
    () =>
      compute(api, {
        profile: calculableProfile(),
        schema: schemaWithContextualSlot("SUBTOTAL"),
        facts: [fact({ raw_score: 12 })],
      }),
    (err) => err.code === "INVALID_SLOT_CONTEXT"
  );
  const total = compute(api, {
    profile: calculableProfile(),
    schema: schemaWithContextualSlot("TOTAL", { period_id: "T1" }),
    facts: [fact({ raw_score: 12 })],
  });
  assert.equal(findSlot(total.students[0], { slot: "TOTAL", period_id: "T1" }).internal, 24);
  const subtotal = compute(api, {
    profile: calculableProfile(),
    schema: schemaWithContextualSlot("SUBTOTAL", { period_id: "T1", score_component_id: "TJ" }),
    facts: [fact({ raw_score: 12 })],
  });
  assert.equal(findSlot(subtotal.students[0], { slot: "SUBTOTAL" }).internal, 24);
  const canonical = compute(api, {
    profile: calculableProfile(),
    facts: [fact({ period_id: "T1", raw_score: 10 }), fact({ period_id: "T2", raw_score: 20 })],
  });
  const t1 = canonical.students[0].period_aggregates.find((row) => row.period_id === "T1");
  const t2 = canonical.students[0].period_aggregates.find((row) => row.period_id === "T2");
  assert.equal(t1.points, 20);
  assert.equal(t1.max_points, 40);
  assert.equal(t2.points, 40);
  assert.equal(t2.max_points, 40);
});

test("report-card-engine-annual-aggregates", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  assert.throws(
    () => compute(api, { schema: schemaWithSlot("ANNUAL_POINTS") }),
    (err) => err.code === "CALCULABILITY_COEFFICIENT_AGGREGATION"
  );
  assert.throws(
    () => compute(api, { schema: schemaWithSlot("ANNUAL_MAX") }),
    (err) => err.code === "CALCULABILITY_COEFFICIENT_AGGREGATION"
  );
  const facts = [fact({ period_id: "T1", raw_score: 10 }), fact({ period_id: "T2", raw_score: 20 })];
  const points = compute(api, {
    profile: calculableProfile(),
    schema: schemaWithContextualSlot("ANNUAL_POINTS"),
    facts,
  });
  assert.equal(findSlot(points.students[0], { slot: "ANNUAL_POINTS" }).internal, 60);
  const max = compute(api, {
    profile: calculableProfile(),
    schema: schemaWithContextualSlot("ANNUAL_MAX"),
    facts,
  });
  assert.equal(findSlot(max.students[0], { slot: "ANNUAL_MAX" }).internal, 80);
  const annual = compute(api, { profile: calculableProfile(), facts });
  assert.equal(annual.students[0].annual.points, 60);
  assert.equal(annual.students[0].annual.max_points, 80);
});

test("report-card-engine-points-without-max", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const profile = calculableProfileWithoutMax();
  const facts = [fact({ raw_score: 12 })];
  const points = compute(api, {
    profile,
    schema: schemaWithContextualSlot("PERIOD_POINTS", { period_id: "T1" }),
    facts,
  });
  assert.equal(findSlot(points.students[0], { slot: "PERIOD_POINTS", period_id: "T1" }).internal, 24);
  const total = compute(api, {
    profile,
    schema: schemaWithContextualSlot("TOTAL", { period_id: "T1" }),
    facts,
  });
  assert.equal(findSlot(total.students[0], { slot: "TOTAL", period_id: "T1" }).internal, 24);
  const subtotal = compute(api, {
    profile,
    schema: schemaWithContextualSlot("SUBTOTAL", { period_id: "T1", score_component_id: "TJ" }),
    facts,
  });
  assert.equal(findSlot(subtotal.students[0], { slot: "SUBTOTAL" }).internal, 24);
  const annualPoints = compute(api, {
    profile,
    schema: schemaWithContextualSlot("ANNUAL_POINTS"),
    facts,
  });
  assert.equal(findSlot(annualPoints.students[0], { slot: "ANNUAL_POINTS" }).internal, 24);
  assert.throws(
    () =>
      compute(api, {
        profile,
        schema: schemaWithContextualSlot("PERIOD_MAX", { period_id: "T1" }),
        facts,
      }),
    (err) => err.code === "CALCULABILITY_PERCENTAGE_WITHOUT_MAX"
  );
  assert.throws(
    () => compute(api, { profile, schema: schemaWithContextualSlot("ANNUAL_MAX"), facts }),
    (err) => err.code === "CALCULABILITY_PERCENTAGE_WITHOUT_MAX"
  );
  assert.throws(
    () => compute(api, { profile, schema: schemaWithContextualSlot("PERCENTAGE", { period_id: "T1" }), facts }),
    (err) => err.code === "CALCULABILITY_PERCENTAGE_WITHOUT_MAX"
  );
  assert.throws(
    () =>
      compute(api, {
        profile: calculableProfileWithoutMax({ pass_rule: { metric: "PERCENTAGE", threshold: 50 } }),
        schema: schemaWithContextualSlot("DECISION", { period_id: "T1" }),
        facts,
      }),
    (err) => err.code === "CALCULABILITY_PERCENTAGE_WITHOUT_MAX"
  );
  assert.throws(
    () =>
      compute(api, {
        profile: calculableProfileWithoutMax({ ranking: { enabled: true, ties: "competition", metric: "PERCENTAGE" } }),
        schema: schemaWithContextualSlot("RANK"),
        facts,
        cohort: facts,
      }),
    (err) => err.code === "CALCULABILITY_PERCENTAGE_WITHOUT_MAX"
  );
  const mixed = [
    fact({ raw_score: 12 }),
    fact({ score_component_id: "EX", raw_score: 10, subject_applicable: true }),
  ];
  const canonical = compute(api, { profile, facts: mixed });
  const t1 = canonical.students[0].period_aggregates.find((row) => row.period_id === "T1");
  assert.equal(t1.points, 34);
  assert.equal(t1.max_points, null);
  assert.equal(canonical.students[0].annual.points, 34);
  assert.equal(canonical.students[0].annual.max_points, null);
});

test("report-card-engine-percentage", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const noMax = validProfile({
    score_components: [{ id: "TJ", applicability: "always", coefficient: 1 }],
  });
  assert.throws(
    () => compute(api, { profile: noMax, schema: schemaWithSlot("PERCENTAGE") }),
    (err) =>
      err.code === "CALCULABILITY_PERCENTAGE_WITHOUT_MAX" || err.code === "CALCULABILITY_COEFFICIENT_AGGREGATION"
  );
  assert.throws(
    () => compute(api, { schema: schemaWithSlot("PERCENTAGE") }),
    (err) => err.code === "CALCULABILITY_COEFFICIENT_AGGREGATION"
  );
  const result = compute(api, {
    profile: calculableProfile(),
    schema: schemaWithContextualSlot("PERCENTAGE", { period_id: "T1" }),
    facts: [fact({ raw_score: 10 })],
  });
  const pct = findSlot(result.students[0], { slot: "PERCENTAGE", period_id: "T1" });
  assert.equal(pct.kind, "NUMERIC");
  assert.equal(pct.internal, 50);
});

test("report-card-engine-rounding-half-up", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const profile = validProfile({ rounding: { decimals: 1, mode: "half_up" } });
  const result = compute(api, { profile, facts: [fact({ raw_score: 1.25 })] });
  const cell = result.students[0].cells.find((item) => item.score_component_id === "TJ");
  assert.equal(cell.internal, 1.25);
  assert.equal(cell.exposed, 1.3);
});

test("report-card-engine-rounding-half-even", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const profile = validProfile({ rounding: { decimals: 1, mode: "half_even" } });
  const result = compute(api, { profile, facts: [fact({ raw_score: 1.25 })] });
  const cell = result.students[0].cells.find((item) => item.score_component_id === "TJ");
  assert.equal(cell.internal, 1.25);
  assert.equal(cell.exposed, 1.2);
});

test("report-card-engine-rounding-down", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const profile = validProfile({ rounding: { decimals: 1, mode: "down" } });
  const result = compute(api, { profile, facts: [fact({ raw_score: 1.29 })] });
  const cell = result.students[0].cells.find((item) => item.score_component_id === "TJ");
  assert.equal(cell.internal, 1.29);
  assert.equal(cell.exposed, 1.2);
});

test("report-card-engine-ranking-disabled", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const result = compute(api, {
    profile: validProfile({ ranking: { enabled: false, ties: "competition" } }),
    schema: schemaWithSlot("RANK"),
  });
  const rank = findSlot(result.students[0], { slot: "RANK", column_id: "COL_SLOT" });
  assert.equal(rank.kind, "NOT_APPLICABLE");
  assert.equal(rank.reason, "RANKING_DISABLED");
  assert.equal(rank.section_id, "SUBJECTS");
});

test("report-card-engine-ranking-ties", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  assert.throws(
    () =>
      compute(api, {
        profile: validProfile({ ranking: { enabled: true, ties: "competition" } }),
        schema: schemaWithSlot("RANK"),
        cohort: [fact(), fact({ student_id: "STU-2", raw_score: 12 })],
      }),
    (err) => err.code === "CALCULABILITY_RANKING_METRIC" || err.code === "CALCULABILITY_ROUNDING_STAGE"
  );
  const schema = schemaWithContextualSlot("RANK");
  const factsA = [
    fact({ student_id: "STU-1", raw_score: 10 }),
    fact({ student_id: "STU-2", raw_score: 20 }),
    fact({ student_id: "STU-3", raw_score: 20 }),
  ];
  const factsB = [factsA[2], factsA[0], factsA[1]];
  assert.throws(
    () => compute(api, { profile: rankingProfile("competition"), schema, facts: factsA }),
    (err) => err.code === "COHORT_REQUIRED"
  );
  const ranked = (ties, facts) =>
    compute(api, { profile: rankingProfile(ties), schema, facts, cohort: facts });
  const competition = ranked("competition", factsA);
  const dense = ranked("dense", factsA);
  const min = ranked("min", factsA);
  const rankOf = (result, studentId) =>
    findSlot(
      result.students.find((row) => row.student_id === studentId),
      { slot: "RANK" }
    ).internal;
  assert.equal(rankOf(competition, "STU-2"), 1);
  assert.equal(rankOf(competition, "STU-3"), 1);
  assert.equal(rankOf(competition, "STU-1"), 3);
  assert.equal(rankOf(dense, "STU-2"), 1);
  assert.equal(rankOf(dense, "STU-3"), 1);
  assert.equal(rankOf(dense, "STU-1"), 2);
  assert.equal(rankOf(min, "STU-2"), 1);
  assert.equal(rankOf(min, "STU-3"), 1);
  assert.equal(rankOf(min, "STU-1"), 3);
  assert.equal(canonicalize(ranked("competition", factsA)), canonicalize(ranked("competition", factsB)));
});

test("report-card-engine-cohort-mismatch", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const schema = schemaWithContextualSlot("RANK");
  const profile = rankingProfile("competition");
  const facts = [fact({ student_id: "STU-1", raw_score: 20 })];
  const divergentCohort = [
    fact({ student_id: "STU-1", raw_score: 10 }),
    fact({ student_id: "STU-2", raw_score: 15 }),
  ];
  assert.throws(
    () => compute(api, { profile, schema, facts, cohort: divergentCohort }),
    (err) => err.code === "COHORT_MISMATCH"
  );
  const factsOrdered = [
    fact({ student_id: "STU-1", raw_score: 20 }),
    fact({ student_id: "STU-2", raw_score: 10 }),
  ];
  const factsReversed = [factsOrdered[1], factsOrdered[0]];
  const cohortOrdered = [
    fact({ student_id: "STU-1", raw_score: 20 }),
    fact({ student_id: "STU-2", raw_score: 10 }),
    fact({ student_id: "STU-3", raw_score: 15 }),
  ];
  const cohortReversed = [
    fact({ student_id: "STU-3", raw_score: 15 }),
    fact({ student_id: "STU-2", raw_score: 10 }),
    fact({ student_id: "STU-1", raw_score: 20 }),
  ];
  const rankOf = (result, studentId) =>
    findSlot(
      result.students.find((row) => row.student_id === studentId),
      { slot: "RANK" }
    ).internal;
  const left = compute(api, { profile, schema, facts: factsOrdered, cohort: cohortOrdered });
  const right = compute(api, { profile, schema, facts: factsReversed, cohort: cohortReversed });
  assert.equal(rankOf(left, "STU-1"), 1);
  assert.equal(rankOf(left, "STU-2"), 3);
  assert.equal(canonicalize(left), canonicalize(right));
});

test("report-card-engine-pass-rule", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  assert.throws(
    () =>
      compute(api, {
        profile: validProfile({ pass_rule: { min_average: 10 } }),
        schema: schemaWithSlot("DECISION"),
      }),
    (err) => err.code === "CALCULABILITY_PASS_RULE_SCALE" || err.code === "CALCULABILITY_ROUNDING_STAGE"
  );
  const schema = schemaWithContextualSlot("DECISION", { period_id: "T1" });
  const profile = calculableProfile({ pass_rule: { metric: "PERCENTAGE", threshold: 50 } });
  const pass = compute(api, { profile, schema, facts: [fact({ raw_score: 10 })] });
  const fail = compute(api, { profile, schema, facts: [fact({ raw_score: 9 })] });
  const passSlot = findSlot(pass.students[0], { slot: "DECISION" });
  const failSlot = findSlot(fail.students[0], { slot: "DECISION" });
  assert.equal(passSlot.kind, "DECISION");
  assert.equal(passSlot.metric, "PERCENTAGE");
  assert.equal(passSlot.threshold, 50);
  assert.equal(passSlot.internal, 50);
  assert.equal(passSlot.passed, true);
  assert.equal(failSlot.internal, 45);
  assert.equal(failSlot.passed, false);
});

test("report-card-engine-presence-condition", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const schema = validateSchemaSpec({
    sections: [
      {
        id: "SUBJECTS",
        order: 1,
        kind: "subject_rows",
        presence: { when: { period_id: "T1" } },
        columns: [
          {
            id: "COL_T1_TJ",
            order: 1,
            kind: "score_component",
            score_component_id: "TJ",
            period_id: "T1",
            presence: { when: { period_id: "T1", score_component_id: "TJ" } },
          },
        ],
      },
    ],
  });
  const t1 = compute(api, { schema, facts: [fact({ period_id: "T1" })] });
  assert.equal(findPresence(t1.students[0], { section_id: "SUBJECTS" }).applicable, true);
  assert.equal(findPresence(t1.students[0], { section_id: "SUBJECTS", column_id: "COL_T1_TJ" }).applicable, true);
  const t2 = compute(api, { schema, facts: [fact({ period_id: "T2", raw_score: 8 })] });
  assert.equal(findPresence(t2.students[0], { section_id: "SUBJECTS" }).applicable, false);
});

test("report-card-engine-invalid-facts-fail-closed", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  assert.throws(() => compute(api, { facts: [fact({ raw_score: "x" })] }), (err) => err.code === "INVALID_FACTS");
  assert.throws(() => compute(api, { facts: [fact({ period_id: "T9" })] }), (err) => err.code === "INVALID_FACTS");
  assert.throws(
    () => compute(api, { facts: [fact({ score_component_id: "UNKNOWN_COMP" })] }),
    (err) => err.code === "INVALID_FACTS"
  );
});

test("report-card-engine-no-country-school-branch", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  assert.throws(
    () => compute(api, { facts: [fact({ country: "BI" })] }),
    (err) => err.code === "COUNTRY_SCHOOL_BRANCH_FORBIDDEN"
  );
  const hits = scanEngineSources();
  assert.deepEqual(hits, []);
  assert.ok(scanText('if (country === "CD") {}').length > 0);
});

test("report-card-engine-no-rendering-publication-side-effects", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const result = compute(api);
  assert.equal(result.snapshot, undefined);
  assert.equal(result.qr, undefined);
  assert.equal(result.pdf, undefined);
  assert.equal(result.signature, undefined);
  assert.equal(result.token, undefined);
  const src = fs.readFileSync(path.join(__dirname, "reportCardEngine.js"), "utf8");
  assert.equal(/\b(signSnapshot|mintToken|renderPdf|publishJournal)\b/.test(src), false);
  assert.equal(/\bfs\.writeFile|\bfetch\s*\(|\bDate\.now\s*\(|\brandomUUID\s*\(/.test(src), false);
});

test("report-card-engine-tenant-envelope", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  assert.throws(
    () => compute(api, { tenant: { schoolId: SCHOOL_A } }),
    (err) => err.code === "TENANT_REQUIRED"
  );
  assert.throws(
    () =>
      compute(api, {
        tenant: { schoolId: SCHOOL_A, actorSchoolId: SCHOOL_B },
        facts: [fact({ school_id: SCHOOL_A })],
      }),
    (err) => err.code === "TENANT_MISMATCH"
  );
  assert.throws(
    () =>
      compute(api, {
        tenant: { schoolId: SCHOOL_A, actorSchoolId: SCHOOL_A },
        facts: [fact({ school_id: SCHOOL_A }), fact({ student_id: "STU-2", school_id: SCHOOL_B })],
      }),
    (err) => err.code === "MIXED_TENANT_FACTS"
  );
  const ok = compute(api, {
    tenant: { schoolId: SCHOOL_A, actorSchoolId: SCHOOL_A },
    facts: [fact({ school_id: SCHOOL_A })],
  });
  assert.equal(ok.tenant.school_id, SCHOOL_A);
});

test("report-card-engine-duplicate-facts-fail-closed", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const dupA = [fact({ raw_score: 10 }), fact({ raw_score: 14 })];
  const dupB = [dupA[1], dupA[0]];
  assert.throws(
    () => compute(api, { facts: dupA }),
    (err) => err.code === "DUPLICATE_FACT"
  );
  assert.throws(
    () => compute(api, { facts: dupB }),
    (err) => err.code === "DUPLICATE_FACT"
  );
});

test("report-card-engine-slot-presence-identity-no-collision", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  const schema = validateSchemaSpec({
    sections: [
      {
        id: "SEC_A",
        order: 1,
        kind: "totals",
        columns: [{ id: "COL_X", order: 1, kind: "computed_slot", slot: "PERCENTAGE", period_id: "T1" }],
      },
      {
        id: "SEC_B",
        order: 2,
        kind: "totals",
        columns: [{ id: "COL_X", order: 1, kind: "computed_slot", slot: "PERCENTAGE", period_id: "T2" }],
      },
    ],
  });
  const result = compute(api, {
    profile: calculableProfile(),
    schema,
    facts: [
      fact({ period_id: "T1", raw_score: 10 }),
      fact({ period_id: "T2", raw_score: 20 }),
    ],
  });
  const student = result.students[0];
  assert.ok(Array.isArray(student.slots));
  assert.ok(Array.isArray(student.presence));
  const pctT1 = findSlot(student, { section_id: "SEC_A", column_id: "COL_X", slot: "PERCENTAGE", period_id: "T1" });
  const pctT2 = findSlot(student, { section_id: "SEC_B", column_id: "COL_X", slot: "PERCENTAGE", period_id: "T2" });
  assert.ok(pctT1);
  assert.ok(pctT2);
  assert.equal(pctT1.kind, "NUMERIC");
  assert.equal(pctT2.kind, "NUMERIC");
  assert.notEqual(pctT1.internal, pctT2.internal);
  const presenceA = findPresence(student, { section_id: "SEC_A", column_id: "COL_X" });
  const presenceB = findPresence(student, { section_id: "SEC_B", column_id: "COL_X" });
  assert.ok(presenceA);
  assert.ok(presenceB);
  assert.notEqual(presenceA, presenceB);
});

test("report-card-engine-facts-presence-validation-fail-closed", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  assert.throws(
    () => compute(api, { facts: [fact({ student_id: "" })] }),
    (err) => err.code === "INVALID_FACTS"
  );
  assert.throws(
    () => compute(api, { facts: [fact({ subject_id: "" })] }),
    (err) => err.code === "INVALID_FACTS"
  );
  assert.throws(
    () => compute(api, { facts: [fact({ score_component_id: "EX", subject_applicable: undefined, raw_score: 12 })] }),
    (err) => err.code === "INVALID_FACTS"
  );
  assert.throws(
    () => compute(api, { facts: [fact({ raw_score: 21 })] }),
    (err) => err.code === "SCORE_OUT_OF_BOUNDS" || err.code === "INVALID_FACTS"
  );
  assert.throws(
    () => compute(api, { facts: [fact({ raw_score: -1 })] }),
    (err) => err.code === "INVALID_SCORE" || err.code === "INVALID_FACTS" || err.code === "SCORE_OUT_OF_BOUNDS"
  );
  assert.throws(
    () => compute(api, { profile: { layer: "AcademicRuleProfile" } }),
    (err) => err.code === "INVALID_SPEC" || err.code === "INVALID_PERIODS" || err.code === "INVALID_PROFILE"
  );
  const schema = validateSchemaSpec({
    sections: [
      {
        id: "SUBJECTS",
        order: 1,
        kind: "subject_rows",
        rows: [{ id: "SUBJECT_LINE", order: 1, kind: "subject", presence: { when: { period_id: "T1" } } }],
        columns: [
          {
            id: "COL_T1_TJ",
            order: 1,
            kind: "score_component",
            score_component_id: "TJ",
            period_id: "T1",
          },
        ],
      },
    ],
    identity_fields: [{ id: "STUDENT_NAME", order: 1, presence: { when: { period_id: "T1" } } }],
    metadata_fields: [{ id: "SCHOOL_YEAR", order: 1, presence: { when: { period_id: "T2" } } }],
  });
  const result = compute(api, { schema, facts: [fact({ period_id: "T1" })] });
  const student = result.students[0];
  assert.ok(Array.isArray(student.presence));
  assert.equal(findPresence(student, { section_id: "SUBJECTS", row_id: "SUBJECT_LINE" }).applicable, true);
  assert.equal(findPresence(student, { field_kind: "identity", field_id: "STUDENT_NAME" }).applicable, true);
  assert.equal(findPresence(student, { field_kind: "metadata", field_id: "SCHOOL_YEAR" }).applicable, false);
});

test("report-card-engine-historical-profile-not-calculable", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  assert.throws(
    () => compute(api, { profile: validProfile(), schema: schemaWithSlot("PERCENTAGE") }),
    (err) => err.code === "CALCULABILITY_COEFFICIENT_AGGREGATION" || err.code === "CALCULABILITY_PERCENTAGE_WITHOUT_MAX"
  );
  assert.throws(
    () =>
      compute(api, {
        profile: validProfile({ pass_rule: { min_average: 10 } }),
        schema: schemaWithSlot("DECISION"),
      }),
    (err) => err.code === "CALCULABILITY_PASS_RULE_SCALE"
  );
});
