"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateSpec,
  specSha256,
  AcademicRuleProfileError,
} = require("./academicRuleProfile");

function loadCalculability() {
  return require("./academicRuleProfile");
}

function baseSpec(overrides = {}) {
  return {
    period_mode: "term",
    periods: ["T1", "T2", "T3"],
    annual: true,
    score_components: [
      { id: "TJ", applicability: "always", max: 20, coefficient: 2 },
      { id: "EX", applicability: "per_subject", max: 20 },
    ],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up" },
    ranking: { enabled: false, ties: "competition" },
    ...overrides,
  };
}

function calculableSpec(overrides = {}) {
  return baseSpec({
    aggregation: {
      mode: "weighted_sum",
      coefficient_default: 1,
      percentage: "points_over_max_100",
    },
    rounding: { decimals: 2, mode: "half_up", stage: "display_only" },
    ranking: { enabled: true, ties: "competition", metric: "PERCENTAGE" },
    pass_rule: { metric: "PERCENTAGE", threshold: 50 },
    ...overrides,
  });
}

test("academic-rule-profile-aggregation-contract", () => {
  const api = loadCalculability();
  assert.equal(typeof api.componentWeight, "function", "LOT 1.1 calculability missing (RED)");
  assert.equal(typeof api.weightedContribution, "function", "LOT 1.1 calculability missing (RED)");
  const spec = validateSpec(calculableSpec({ ranking: { enabled: false, ties: "competition" } }));
  assert.equal(spec.aggregation.mode, "weighted_sum");
  assert.equal(spec.aggregation.percentage, "points_over_max_100");
  const tj = spec.score_components[0];
  const ex = spec.score_components[1];
  assert.equal(api.componentWeight(tj, spec.aggregation), 2);
  assert.equal(api.componentWeight(ex, spec.aggregation), 1);
  const points = api.weightedContribution({ numericScore: 12, component: tj, aggregation: spec.aggregation });
  assert.equal(points.points, 24);
  assert.equal(points.max_points, 40);
  const zero = api.weightedContribution({ numericScore: 0, component: tj, aggregation: spec.aggregation });
  assert.equal(zero.points, 0);
  assert.equal(zero.max_points, 40);
  assert.throws(
    () =>
      validateSpec(
        calculableSpec({
          aggregation: { mode: "weighted_average", coefficient_default: 1, percentage: "points_over_max_100" },
          ranking: { enabled: false, ties: "competition" },
        })
      ),
    (err) => err.code === "INVALID_AGGREGATION"
  );
  const historical = validateSpec(baseSpec());
  assert.equal(historical.aggregation, undefined);
  assert.notEqual(specSha256(spec), specSha256(historical));
});

test("academic-rule-profile-coefficient-default-explicit", () => {
  assert.throws(
    () =>
      validateSpec(
        calculableSpec({
          aggregation: { mode: "weighted_sum", percentage: "points_over_max_100" },
          ranking: { enabled: false, ties: "competition" },
        })
      ),
    (err) => err instanceof AcademicRuleProfileError && err.code === "INVALID_AGGREGATION"
  );
  const spec = validateSpec(calculableSpec({ ranking: { enabled: false, ties: "competition" } }));
  assert.equal(spec.aggregation.coefficient_default, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(spec.aggregation, "coefficient_default"), true);
});

test("academic-rule-profile-percentage-contract", () => {
  const api = loadCalculability();
  assert.equal(typeof api.percentageFromWeighted, "function", "LOT 1.1 calculability missing (RED)");
  const spec = validateSpec(calculableSpec({ ranking: { enabled: false, ties: "competition" } }));
  assert.equal(spec.aggregation.percentage, "points_over_max_100");
  assert.equal(api.percentageFromWeighted({ points: 10, max_points: 20 }), 50);
  assert.throws(
    () => api.percentageFromWeighted({ points: 1, max_points: 0 }),
    (err) => err.code === "WEIGHTED_MAX_ZERO"
  );
  assert.throws(
    () =>
      validateSpec(
        calculableSpec({
          aggregation: { mode: "weighted_sum", coefficient_default: 1, percentage: "base_20" },
          ranking: { enabled: false, ties: "competition" },
        })
      ),
    (err) => err.code === "INVALID_AGGREGATION"
  );
});

test("academic-rule-profile-pass-rule-typed", () => {
  const spec = validateSpec(
    calculableSpec({
      ranking: { enabled: false, ties: "competition" },
      pass_rule: { metric: "PERCENTAGE", threshold: 50 },
    })
  );
  assert.equal(spec.pass_rule.metric, "PERCENTAGE");
  assert.equal(spec.pass_rule.threshold, 50);
  assert.equal(spec.pass_rule.min_average, undefined);
  assert.throws(
    () =>
      validateSpec(
        calculableSpec({
          ranking: { enabled: false, ties: "competition" },
          pass_rule: { metric: "POINTS", threshold: 10 },
        })
      ),
    (err) => err.code === "INVALID_PASS_RULE"
  );
  assert.throws(
    () =>
      validateSpec(
        calculableSpec({
          ranking: { enabled: false, ties: "competition" },
          pass_rule: { metric: "PERCENTAGE", threshold: 101 },
        })
      ),
    (err) => err.code === "INVALID_PASS_RULE"
  );
  assert.throws(
    () =>
      validateSpec(
        calculableSpec({
          ranking: { enabled: false, ties: "competition" },
          pass_rule: { metric: "PERCENTAGE", threshold: 50, min_average: 10 },
        })
      ),
    (err) => err.code === "INVALID_PASS_RULE"
  );
});

test("academic-rule-profile-legacy-pass-rule-remains-readable-but-untyped", () => {
  const spec = validateSpec(baseSpec({ pass_rule: { min_average: 10 } }));
  assert.equal(spec.pass_rule.min_average, 10);
  assert.equal(spec.pass_rule.metric, undefined);
  assert.equal(spec.pass_rule.threshold, undefined);
  const api = loadCalculability();
  assert.equal(typeof api.isCalculablePassRule, "function", "LOT 1.1 calculability missing (RED)");
  assert.equal(api.isCalculablePassRule(spec), false);
  assert.equal(api.isCalculablePassRule(validateSpec(calculableSpec({ ranking: { enabled: false } }))), true);
});

test("academic-rule-profile-rounding-stage-display-only", () => {
  const spec = validateSpec(calculableSpec({ ranking: { enabled: false, ties: "competition" } }));
  assert.equal(spec.rounding.stage, "display_only");
  const historical = validateSpec(baseSpec());
  assert.equal(historical.rounding.stage, undefined);
  assert.throws(
    () =>
      validateSpec(
        calculableSpec({
          rounding: { decimals: 2, mode: "half_up", stage: "rank_on_exposed" },
          ranking: { enabled: false, ties: "competition" },
        })
      ),
    (err) => err.code === "INVALID_ROUNDING"
  );
  assert.throws(
    () =>
      validateSpec(
        calculableSpec({
          rounding: { decimals: 2, mode: "half_up" },
          ranking: { enabled: false, ties: "competition" },
        })
      ),
    (err) => err.code === "INVALID_ROUNDING"
  );
});

test("academic-rule-profile-ranking-metric-required-when-calculable", () => {
  assert.throws(
    () =>
      validateSpec(
        calculableSpec({
          ranking: { enabled: true, ties: "competition" },
        })
      ),
    (err) => err.code === "INVALID_RANKING"
  );
  const spec = validateSpec(calculableSpec());
  assert.equal(spec.ranking.metric, "PERCENTAGE");
  const historical = validateSpec(baseSpec({ ranking: { enabled: true, ties: "min" } }));
  assert.equal(historical.ranking.enabled, true);
  assert.equal(historical.ranking.metric, undefined);
});

test("academic-rule-profile-ranking-ties-semantics-contract", () => {
  const api = loadCalculability();
  assert.equal(typeof api.assignRanks, "function", "LOT 1.1 calculability missing (RED)");
  assert.deepEqual(api.assignRanks([10, 9, 9, 8], "competition"), [1, 2, 2, 4]);
  assert.deepEqual(api.assignRanks([10, 9, 9, 8], "dense"), [1, 2, 2, 3]);
  assert.deepEqual(api.assignRanks([10, 9, 9, 8], "min"), [1, 2, 2, 4]);
  const competition = validateSpec(calculableSpec({ ranking: { enabled: true, ties: "competition", metric: "PERCENTAGE" } }));
  const min = validateSpec(calculableSpec({ ranking: { enabled: true, ties: "min", metric: "PERCENTAGE" } }));
  assert.equal(competition.ranking.ties, "competition");
  assert.equal(min.ranking.ties, "min");
  assert.deepEqual(api.TIE_SEMANTICS.min.alias_of, "competition");
});

test("academic-rule-profile-score-bounds-contract", () => {
  const api = loadCalculability();
  assert.equal(typeof api.assertScoreBounds, "function", "LOT 1.1 calculability missing (RED)");
  assert.doesNotThrow(() => api.assertScoreBounds({ numericScore: 0, max: 20 }));
  assert.doesNotThrow(() => api.assertScoreBounds({ numericScore: 20, max: 20 }));
  assert.doesNotThrow(() => api.assertScoreBounds({ numericScore: 100 }));
  assert.throws(() => api.assertScoreBounds({ numericScore: -0.01 }), (err) => err.code === "INVALID_SCORE");
  assert.throws(
    () => api.assertScoreBounds({ numericScore: 20.01, max: 20 }),
    (err) => err.code === "SCORE_OUT_OF_BOUNDS"
  );
  const before = 21;
  try {
    api.assertScoreBounds({ numericScore: before, max: 20 });
  } catch {
    /* reject, never clamp */
  }
  assert.equal(before, 21);
});

test("academic-rule-profile-no-country-school-branch", () => {
  assert.throws(
    () => validateSpec(calculableSpec({ aggregation: { mode: "weighted_sum", coefficient_default: 1, percentage: "points_over_max_100", country: "BI" } })),
    (err) => err.code === "COUNTRY_SCHOOL_BRANCH_FORBIDDEN"
  );
  const spec = validateSpec(calculableSpec({ ranking: { enabled: false, ties: "competition" } }));
  assert.equal(spec.layer, "AcademicRuleProfile");
});
