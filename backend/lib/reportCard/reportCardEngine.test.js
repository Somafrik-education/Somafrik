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
});

test("report-card-engine-period-aggregates", () => {
  const api = loadLot3();
  assert.ok(api, "LOT 3 engine missing (RED)");
  assert.throws(
    () => compute(api, { schema: schemaWithSlot("TOTAL") }),
    (err) => err.code === "CALCULABILITY_COEFFICIENT_AGGREGATION"
  );
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
  assert.equal(result.students[0].slots.RANK.kind, "NOT_APPLICABLE");
  assert.equal(result.students[0].slots.RANK.reason, "RANKING_DISABLED");
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
  assert.equal(t1.students[0].presence.SUBJECTS.applicable, true);
  assert.equal(t1.students[0].presence.COL_T1_TJ.applicable, true);
  const t2 = compute(api, { schema, facts: [fact({ period_id: "T2", raw_score: 8 })] });
  assert.equal(t2.students[0].presence.SUBJECTS.applicable, false);
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
