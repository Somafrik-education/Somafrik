"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  validateSpec,
  resolveScoreCell,
  componentApplies,
  GENERIC_COMPONENT_IDS,
  AcademicRuleProfileError,
} = require("./academicRuleProfile");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { scanEngineSources } = require("../../contracts/reportCard/noCountrySchoolBranch");

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";

function validSpec(overrides = {}) {
  return {
    period_mode: "term",
    periods: ["T1", "T2", "T3"],
    annual: true,
    score_components: [
      { id: "TJ", applicability: "always", max: 20, coefficient: 1 },
      { id: "EX", applicability: "per_subject", max: 20, coefficient: 1 },
    ],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up" },
    ranking: { enabled: true, ties: "competition" },
    pass_rule: { min_average: 10 },
    ...overrides,
  };
}

test("academic-rule-profile-versioning", () => {
  const store = createAcademicRuleProfileStore();
  const created = store.createProfile({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileKey: "core",
    spec: validSpec(),
  });
  assert.equal(created.version.version, 1);
  assert.equal(created.version.status, "DRAFT");
  store.activateVersion({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileId: created.profile.id,
    version: 1,
  });
  const v2 = store.addVersion({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileId: created.profile.id,
    spec: validSpec({ rounding: { decimals: 1, mode: "half_even" } }),
  });
  assert.equal(v2.version, 2);
  assert.equal(v2.status, "DRAFT");
  store.activateVersion({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileId: created.profile.id,
    version: 2,
  });
  const active = store.getActive({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileId: created.profile.id,
  });
  assert.equal(active.version, 2);
  assert.equal(active.status, "ACTIVE");
  const v1 = store.getVersion({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileId: created.profile.id,
    version: 1,
  });
  assert.equal(v1.status, "SUPERSEDED");
  assert.throws(
    () =>
      store.updateDraftSpec({
        schoolId: SCHOOL_A,
        actorSchoolId: SCHOOL_A,
        profileId: created.profile.id,
        version: 1,
        spec: validSpec(),
      }),
    (err) => err.code === "VERSION_IMMUTABLE"
  );
});

test("academic-rule-profile-tenant-isolation", () => {
  const store = createAcademicRuleProfileStore();
  const created = store.createProfile({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileKey: "core",
    spec: validSpec(),
    activate: true,
  });
  assert.throws(
    () => store.getActive({ schoolId: SCHOOL_B, actorSchoolId: SCHOOL_B, profileId: created.profile.id }),
    (err) => err.code === "PROFILE_NOT_FOUND"
  );
  assert.throws(
    () =>
      store.getActive({
        schoolId: SCHOOL_A,
        actorSchoolId: SCHOOL_B,
        profileId: created.profile.id,
      }),
    (err) => err.code === "TENANT_MISMATCH"
  );
  assert.throws(
    () => store.createProfile({ profileKey: "x", spec: validSpec() }),
    (err) => err.code === "TENANT_REQUIRED"
  );
  assert.equal(store.listProfiles(SCHOOL_B, SCHOOL_B).length, 0);
  assert.equal(store.listProfiles(SCHOOL_A, SCHOOL_A).length, 1);
});

test("academic-rule-profile-no-country-school-branch", () => {
  assert.throws(
    () => validateSpec(validSpec({ country: "BI" })),
    (err) => err.code === "COUNTRY_SCHOOL_BRANCH_FORBIDDEN"
  );
  assert.throws(
    () => validateSpec(validSpec({ school: "La Colombière" })),
    (err) => err.code === "COUNTRY_SCHOOL_BRANCH_FORBIDDEN"
  );
  assert.throws(
    () => validateSpec(validSpec({ school_id: SCHOOL_A })),
    (err) => err.code === "COUNTRY_SCHOOL_BRANCH_FORBIDDEN"
  );
  const hits = scanEngineSources();
  assert.deepEqual(hits, []);
});

test("academic-rule-profile-na-is-not-zero", () => {
  const na = resolveScoreCell({ applicable: false, rawScore: 0 });
  const zero = resolveScoreCell({ applicable: true, rawScore: 0 });
  assert.equal(na.kind, "NOT_APPLICABLE");
  assert.equal(na.numericValue, null);
  assert.notEqual(na.numericValue, 0);
  assert.equal(zero.kind, "NUMERIC");
  assert.equal(zero.numericValue, 0);
  assert.throws(
    () => validateSpec(validSpec({ score_components: [{ id: "EX", applicability: "always", na_equals_zero: true }] })),
    (err) => err.code === "NA_MUST_NOT_BE_ZERO"
  );
});

test("academic-rule-profile-components-generic", () => {
  const a = validateSpec(
    validSpec({
      score_components: [{ id: "COMPONENT_PERIOD", applicability: "always", max: 20 }],
    })
  );
  const b = validateSpec(validSpec());
  assert.equal(a.score_components[0].id, "COMPONENT_PERIOD");
  assert.deepEqual(
    b.score_components.map((c) => c.id),
    ["TJ", "EX"]
  );
  assert.equal(componentApplies(b.score_components[0], { subjectApplicable: false }), true);
  assert.equal(componentApplies(b.score_components[1], { subjectApplicable: false }), false);
  assert.ok(GENERIC_COMPONENT_IDS.includes("TJ"));
  for (const id of ["ORAL", "WRITTEN", "PRACTICAL"]) {
    assert.equal(validateSpec(validSpec({ score_components: [{ id, applicability: "always" }] })).score_components[0].id, id);
  }
  const fixtureA = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../contracts/reportCard/fixtures/burundi-a.json"), "utf8")
  );
  const fixtureB = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../contracts/reportCard/fixtures/burundi-b.json"), "utf8")
  );
  assert.equal(fixtureA.not_a_country_pack, true);
  assert.equal(fixtureB.not_a_country_pack, true);
  assert.doesNotThrow(() => validateSpec(fixtureA.academic_rule_profile));
  assert.doesNotThrow(() => validateSpec(fixtureB.academic_rule_profile));
});

test("academic-rule-profile-rounding-ranking-contract", () => {
  const spec = validateSpec(validSpec());
  assert.equal(spec.rounding.decimals, 2);
  assert.equal(spec.rounding.mode, "half_up");
  assert.equal(spec.ranking.ties, "competition");
  assert.equal(spec.pass_rule.min_average, 10);
  assert.throws(
    () => validateSpec(validSpec({ rounding: { decimals: 2, mode: "bankers_bi" } })),
    (err) => err.code === "INVALID_ROUNDING"
  );
  assert.throws(
    () => validateSpec(validSpec({ ranking: { enabled: true, ties: "country_custom" } })),
    (err) => err.code === "INVALID_RANKING"
  );
});

test("academic-rule-profile-invalid-config-rejected", () => {
  assert.throws(() => validateSpec({}), (err) => err instanceof AcademicRuleProfileError);
  assert.throws(() => validateSpec(validSpec({ periods: [] })), (err) => err.code === "INVALID_PERIODS");
  assert.throws(
    () => validateSpec(validSpec({ score_components: [] })),
    (err) => err.code === "INVALID_COMPONENTS"
  );
  assert.throws(
    () =>
      validateSpec(
        validSpec({
          score_components: [
            { id: "TJ", applicability: "always" },
            { id: "TJ", applicability: "always" },
          ],
        })
      ),
    (err) => err.code === "DUPLICATE_COMPONENT"
  );
});
