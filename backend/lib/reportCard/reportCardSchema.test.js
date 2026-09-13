"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateSpec: validateProfileSpec } = require("./academicRuleProfile");
const { scanEngineSources, scanText } = require("../../contracts/reportCard/noCountrySchoolBranch");
const { LAYERS } = require("../../contracts/reportCard/contract");

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";

function loadLot2() {
  try {
    return {
      ...require("./reportCardSchema"),
      ...require("./reportCardSchemaStore"),
    };
  } catch {
    return null;
  }
}

function validSchemaSpec(overrides = {}) {
  return {
    sections: [
      {
        id: "IDENTITY",
        order: 1,
        kind: "identity",
        columns: [{ id: "STUDENT_NAME", order: 1, kind: "identity" }],
      },
      {
        id: "SUBJECTS",
        order: 2,
        kind: "subject_rows",
        rows: [{ id: "SUBJECT_LINE", order: 1, kind: "subject" }],
        columns: [
          { id: "COL_TJ", order: 1, kind: "score_component", score_component_id: "TJ" },
          { id: "COL_EX", order: 2, kind: "score_component", score_component_id: "EX" },
          { id: "COL_T1", order: 3, kind: "period", period_id: "T1" },
          { id: "COL_TOTAL", order: 4, kind: "computed_slot", slot: "TOTAL" },
        ],
      },
      {
        id: "RANK",
        order: 3,
        kind: "rank",
        columns: [{ id: "COL_RANK", order: 1, kind: "computed_slot", slot: "RANK" }],
      },
      {
        id: "DECISION",
        order: 4,
        kind: "decision",
        columns: [{ id: "COL_DECISION", order: 1, kind: "computed_slot", slot: "DECISION" }],
      },
      {
        id: "OBSERVATIONS",
        order: 5,
        kind: "observations",
        columns: [{ id: "COL_NOTE", order: 1, kind: "observation" }],
      },
    ],
    identity_fields: [{ id: "STUDENT_NAME", order: 1 }],
    metadata_fields: [{ id: "SCHOOL_YEAR", order: 1 }],
    ...overrides,
  };
}

function validProfile() {
  return validateProfileSpec({
    periods: ["T1", "T2", "T3"],
    score_components: [
      { id: "TJ", applicability: "always" },
      { id: "EX", applicability: "per_subject" },
    ],
    missing_score: "NOT_APPLICABLE_not_zero",
  });
}

test("report-card-schema-versioning", () => {
  const api = loadLot2();
  assert.ok(api, "LOT 2 domain missing (RED)");
  const store = api.createReportCardSchemaStore();
  const created = store.createSchema({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaKey: "core",
    spec: validSchemaSpec(),
  });
  assert.equal(created.version.version, 1);
  assert.equal(created.version.status, "DRAFT");
  store.activateVersion({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaId: created.schema.id,
    version: 1,
  });
  const v2 = store.addVersion({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaId: created.schema.id,
    spec: validSchemaSpec(),
  });
  assert.equal(v2.version, 2);
  assert.equal(v2.status, "DRAFT");
  store.activateVersion({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaId: created.schema.id,
    version: 2,
  });
  const active = store.getActive({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaId: created.schema.id,
  });
  assert.equal(active.version, 2);
  assert.equal(active.status, "ACTIVE");
  const v1 = store.getVersion({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaId: created.schema.id,
    version: 1,
  });
  assert.equal(v1.status, "SUPERSEDED");
});

test("report-card-schema-tenant-isolation", () => {
  const api = loadLot2();
  assert.ok(api, "LOT 2 domain missing (RED)");
  const store = api.createReportCardSchemaStore();
  const created = store.createSchema({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaKey: "core",
    spec: validSchemaSpec(),
    activate: true,
  });
  assert.throws(
    () =>
      store.getActive({
        schoolId: SCHOOL_B,
        actorSchoolId: SCHOOL_B,
        schemaId: created.schema.id,
      }),
    (err) => err.code === "SCHEMA_NOT_FOUND"
  );
  assert.throws(
    () =>
      store.getActive({
        schoolId: SCHOOL_A,
        actorSchoolId: SCHOOL_B,
        schemaId: created.schema.id,
      }),
    (err) => err.code === "TENANT_MISMATCH"
  );
  assert.throws(
    () => store.createSchema({ schemaKey: "x", spec: validSchemaSpec() }),
    (err) => err.code === "TENANT_REQUIRED"
  );
  assert.throws(
    () => store.createSchema({ schoolId: SCHOOL_A, schemaKey: "x", spec: validSchemaSpec() }),
    (err) => err.code === "TENANT_REQUIRED"
  );
  assert.throws(
    () => store.getActive({ schoolId: SCHOOL_A, schemaId: created.schema.id }),
    (err) => err.code === "TENANT_REQUIRED"
  );
  assert.throws(
    () => store.listSchemas(SCHOOL_A),
    (err) => err.code === "TENANT_REQUIRED"
  );
  assert.equal(store.listSchemas(SCHOOL_B, SCHOOL_B).length, 0);
  assert.equal(store.listSchemas(SCHOOL_A, SCHOOL_A).length, 1);
});

test("report-card-schema-no-country-school-branch", () => {
  const api = loadLot2();
  assert.ok(api, "LOT 2 domain missing (RED)");
  assert.throws(
    () => api.validateSpec(validSchemaSpec({ country: "BI" })),
    (err) => err.code === "COUNTRY_SCHOOL_BRANCH_FORBIDDEN"
  );
  assert.throws(
    () => api.validateSpec(validSchemaSpec({ school: "La Colombière" })),
    (err) => err.code === "COUNTRY_SCHOOL_BRANCH_FORBIDDEN"
  );
  assert.throws(
    () => api.validateSpec(validSchemaSpec({ school_id: SCHOOL_A })),
    (err) => err.code === "COUNTRY_SCHOOL_BRANCH_FORBIDDEN"
  );
  const hits = scanEngineSources();
  assert.deepEqual(hits, []);
  for (const snippet of [
    'if (country === "CD") {}',
    'const packs = new Map([["CD", {}]]);',
    "const hit = PACKS[country];",
  ]) {
    assert.ok(scanText(snippet).length > 0, snippet);
  }
});

test("report-card-schema-separation-of-concerns", () => {
  const api = loadLot2();
  assert.ok(api, "LOT 2 domain missing (RED)");
  const spec = api.validateSpec(validSchemaSpec());
  assert.equal(spec.layer, "ReportCardSchema");
  assert.equal(spec.layer, LAYERS[1]);
  assert.notEqual(spec.layer, "AcademicRuleProfile");
  assert.notEqual(spec.layer, "RenderingTemplate");
  assert.equal(spec.rounding, undefined);
  assert.equal(spec.ranking, undefined);
  assert.equal(spec.missing_score, undefined);
  assert.equal(spec.pass_rule, undefined);
  assert.throws(
    () => api.validateSpec(validSchemaSpec({ rounding: { decimals: 2 } })),
    (err) => err.code === "CALCULATION_FORBIDDEN"
  );
  assert.throws(
    () => api.validateSpec(validSchemaSpec({ accent: "pink", paper: "A4" })),
    (err) => err.code === "RENDERING_FORBIDDEN"
  );
});

test("report-card-schema-generic-sections-columns", () => {
  const api = loadLot2();
  assert.ok(api, "LOT 2 domain missing (RED)");
  const spec = api.validateSpec(validSchemaSpec());
  assert.ok(spec.sections.length >= 2);
  const subjects = spec.sections.find((section) => section.id === "SUBJECTS");
  assert.equal(subjects.kind, "subject_rows");
  assert.deepEqual(
    subjects.columns.map((column) => column.id),
    ["COL_TJ", "COL_EX", "COL_T1", "COL_TOTAL"]
  );
  assert.equal(subjects.columns[0].score_component_id, "TJ");
  assert.equal(subjects.columns[2].period_id, "T1");
  assert.equal(subjects.columns[3].slot, "TOTAL");
  const fixtureA = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../contracts/reportCard/fixtures/burundi-a.json"), "utf8")
  );
  const fixtureB = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../contracts/reportCard/fixtures/burundi-b.json"), "utf8")
  );
  assert.equal(fixtureA.not_a_country_pack, true);
  assert.equal(fixtureB.not_a_country_pack, true);
});

test("report-card-schema-stable-ordering", () => {
  const api = loadLot2();
  assert.ok(api, "LOT 2 domain missing (RED)");
  const unordered = validSchemaSpec({
    sections: [
      {
        id: "B",
        order: 2,
        kind: "rank",
        columns: [{ id: "COL_RANK", order: 1, kind: "computed_slot", slot: "RANK" }],
      },
      {
        id: "A",
        order: 1,
        kind: "identity",
        columns: [
          { id: "COL_B", order: 2, kind: "identity" },
          { id: "COL_A", order: 1, kind: "identity" },
        ],
      },
    ],
  });
  const spec = api.validateSpec(unordered);
  assert.deepEqual(
    spec.sections.map((section) => section.id),
    ["A", "B"]
  );
  assert.deepEqual(
    spec.sections[0].columns.map((column) => column.id),
    ["COL_A", "COL_B"]
  );
  assert.throws(
    () =>
      api.validateSpec(
        validSchemaSpec({
          sections: [
            { id: "A", order: 1, kind: "identity", columns: [{ id: "X", order: 1, kind: "identity" }] },
            { id: "B", order: 1, kind: "rank", columns: [{ id: "Y", order: 1, kind: "computed_slot", slot: "RANK" }] },
          ],
        })
      ),
    (err) => err.code === "INVALID_ORDER"
  );
});

test("report-card-schema-duplicate-id-rejected", () => {
  const api = loadLot2();
  assert.ok(api, "LOT 2 domain missing (RED)");
  assert.throws(
    () =>
      api.validateSpec(
        validSchemaSpec({
          sections: [
            {
              id: "DUP",
              order: 1,
              kind: "identity",
              columns: [{ id: "COL", order: 1, kind: "identity" }],
            },
            {
              id: "DUP",
              order: 2,
              kind: "rank",
              columns: [{ id: "COL_RANK", order: 1, kind: "computed_slot", slot: "RANK" }],
            },
          ],
        })
      ),
    (err) => err.code === "DUPLICATE_ID"
  );
  assert.throws(
    () =>
      api.validateSpec(
        validSchemaSpec({
          sections: [
            {
              id: "S",
              order: 1,
              kind: "identity",
              columns: [
                { id: "COL", order: 1, kind: "identity" },
                { id: "COL", order: 2, kind: "identity" },
              ],
            },
          ],
        })
      ),
    (err) => err.code === "DUPLICATE_ID"
  );
});

test("report-card-schema-profile-reference-validation", () => {
  const api = loadLot2();
  assert.ok(api, "LOT 2 domain missing (RED)");
  const spec = api.validateSpec(validSchemaSpec());
  const profile = validProfile();
  assert.doesNotThrow(() => api.validateAgainstProfile(spec, profile));
  const badPeriod = api.validateSpec(
    validSchemaSpec({
      sections: [
        {
          id: "SUBJECTS",
          order: 1,
          kind: "subject_rows",
          columns: [{ id: "COL_T9", order: 1, kind: "period", period_id: "T9" }],
        },
      ],
    })
  );
  assert.throws(
    () => api.validateAgainstProfile(badPeriod, profile),
    (err) => err.code === "INVALID_PROFILE_REFERENCE"
  );
  const badComponent = api.validateSpec(
    validSchemaSpec({
      sections: [
        {
          id: "SUBJECTS",
          order: 1,
          kind: "subject_rows",
          columns: [{ id: "COL_X", order: 1, kind: "score_component", score_component_id: "UNKNOWN_COMP" }],
        },
      ],
    })
  );
  assert.throws(
    () => api.validateAgainstProfile(badComponent, profile),
    (err) => err.code === "INVALID_PROFILE_REFERENCE"
  );
});

test("report-card-schema-period-component-intersection", () => {
  const api = loadLot2();
  assert.ok(api, "LOT 2 domain missing (RED)");
  const spec = api.validateSpec(
    validSchemaSpec({
      sections: [
        {
          id: "SUBJECTS",
          order: 1,
          kind: "subject_rows",
          period_id: "T1",
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
    })
  );
  const cell = spec.sections[0].columns[0];
  assert.equal(spec.sections[0].period_id, "T1");
  assert.equal(cell.period_id, "T1");
  assert.equal(cell.score_component_id, "TJ");
  const profile = validProfile();
  assert.doesNotThrow(() => api.validateAgainstProfile(spec, profile));
  const badPeriod = api.validateSpec(
    validSchemaSpec({
      sections: [
        {
          id: "SUBJECTS",
          order: 1,
          kind: "subject_rows",
          columns: [
            {
              id: "COL_BAD",
              order: 1,
              kind: "score_component",
              score_component_id: "TJ",
              period_id: "T9",
            },
          ],
        },
      ],
    })
  );
  assert.throws(
    () => api.validateAgainstProfile(badPeriod, profile),
    (err) => err.code === "INVALID_PROFILE_REFERENCE"
  );
  const badComponent = api.validateSpec(
    validSchemaSpec({
      sections: [
        {
          id: "SUBJECTS",
          order: 1,
          kind: "subject_rows",
          columns: [
            {
              id: "COL_BAD2",
              order: 1,
              kind: "period",
              period_id: "T1",
              score_component_id: "UNKNOWN_COMP",
            },
          ],
        },
      ],
    })
  );
  assert.throws(
    () => api.validateAgainstProfile(badComponent, profile),
    (err) => err.code === "INVALID_PROFILE_REFERENCE"
  );
});

test("report-card-schema-no-calculation-formulas", () => {
  const api = loadLot2();
  assert.ok(api, "LOT 2 domain missing (RED)");
  assert.throws(
    () =>
      api.validateSpec(
        validSchemaSpec({
          sections: [
            {
              id: "SUBJECTS",
              order: 1,
              kind: "subject_rows",
              columns: [{ id: "COL_SUM", order: 1, kind: "computed_slot", slot: "TOTAL", formula: "TJ+EX" }],
            },
          ],
        })
      ),
    (err) => err.code === "CALCULATION_FORBIDDEN"
  );
  assert.throws(
    () => api.validateSpec(validSchemaSpec({ coefficient: 2 })),
    (err) => err.code === "CALCULATION_FORBIDDEN"
  );
  assert.throws(
    () => api.validateSpec(validSchemaSpec({ ranking: { ties: "competition" } })),
    (err) => err.code === "CALCULATION_FORBIDDEN"
  );
});

test("report-card-schema-non-draft-immutable", () => {
  const api = loadLot2();
  assert.ok(api, "LOT 2 domain missing (RED)");
  const store = api.createReportCardSchemaStore();
  const created = store.createSchema({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaKey: "core",
    spec: validSchemaSpec(),
    activate: true,
  });
  assert.throws(
    () =>
      store.updateDraftSpec({
        schoolId: SCHOOL_A,
        actorSchoolId: SCHOOL_A,
        schemaId: created.schema.id,
        version: 1,
        spec: validSchemaSpec(),
      }),
    (err) => err.code === "VERSION_IMMUTABLE"
  );
  const originalId = created.version.spec.sections[0].id;
  const originalSha = created.version.spec_sha256;
  try {
    created.version.spec.sections[0].id = "HACKED";
  } catch {
    /* freeze may throw */
  }
  const active = store.getActive({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaId: created.schema.id,
  });
  assert.equal(active.spec.sections[0].id, originalId);
  assert.notEqual(active.spec.sections[0].id, "HACKED");
  assert.equal(active.spec_sha256, originalSha);
});
