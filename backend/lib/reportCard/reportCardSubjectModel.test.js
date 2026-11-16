"use strict";

/**
 * BULLETIN-MODEL-01 — matières simples / composées, maxima TJ/EX par matière,
 * sous-matière et période, totaux sans double comptage, complétude explicite.
 *
 * Oracles calculés à la main sur des données fictives
 * (fixtures/model-01/subjects-*.json), jamais sur des photographies.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeReportCard } = require("./reportCardEngine");
const { validateSpec, specSha256 } = require("./academicRuleProfile");
function assertProfileSubjectsInCatalog(args) {
  return require("./subjectCatalog").assertProfileSubjectsInCatalog(args);
}
const simpleFixture = require("./fixtures/model-01/subjects-simple.json");
const compositeFixture = require("./fixtures/model-01/subjects-composite.json");
const legacyA = require("./qualification/model-a.json");
const legacyB = require("./qualification/model-b.json");
const legacyExpectedA = require("./qualification/expected/model-a.json");
const legacyExpectedB = require("./qualification/expected/model-b.json");
const legacyEngineOutput = require("./fixtures/model-01/legacy-engine-output.json");
const { canonicalResult } = require("./reportCardQualification");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function run(fixture, patch = {}) {
  const input = {
    profile: clone(fixture.profile),
    schema: clone(fixture.schema),
    facts: clone(fixture.facts),
    tenant: clone(fixture.tenant),
    provenance: { profile: { id: "p", version: 1 }, schema: { id: "s", version: 1 } },
    ...patch,
  };
  const ranked = input.schema.sections.some((s) => s.columns.some((c) => c.slot === "RANK"));
  if (ranked && !("cohort" in patch)) input.cohort = clone(input.facts);
  return computeReportCard(input);
}

function student(result, id = "STU1") {
  return result.students.find((row) => row.student_id === id);
}

function totals(result, id) {
  const st = student(result, id);
  assert.ok(st?.subject_totals, "subject_totals présent");
  return st.subject_totals;
}

function row(subjectTotals, subjectId) {
  const found = subjectTotals.rows.find((item) => item.subject_id === subjectId);
  assert.ok(found, `ligne ${subjectId}`);
  return found;
}

function slot(result, columnId, id = "STU1") {
  return student(result, id).slots.find((item) => item.column_id === columnId);
}

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label} : ${actual} ≠ ${expected}`);
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code, `code ${error.code} (attendu ${code})`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Scénario A — matières simples, maxima variables, trois trimestres, annuel.
// ---------------------------------------------------------------------------

test("A — maxima propres à chaque matière et à chaque période (TJ seul autorisé)", () => {
  const t = totals(run(simpleFixture));
  const geo = row(t, "GEOGRAPHIE");
  assert.equal(geo.kind, "simple");
  close(geo.periods.T1.points.internal, 80, "Géographie T1 points");
  close(geo.periods.T1.max_points.internal, 100, "Géographie T1 max");
  const math = row(t, "MATHEMATIQUES");
  close(math.periods.T3.max_points.internal, 120, "Mathématiques T3 max (EX 80 au T3)");
  close(math.periods.T3.points.internal, 108, "Mathématiques T3 points");
  const eps = row(t, "EDUCATION_PHYSIQUE");
  close(eps.periods.T1.max_points.internal, 50, "EPS : TJ seul");
  assert.equal(eps.periods.T1.components.EX.kind, "NOT_APPLICABLE", "EX non applicable ≠ 0");
});

test("A — totaux trimestriels et annuels ; annuel = Σ points / Σ maxima, pas la moyenne des %", () => {
  const t = totals(run(simpleFixture));
  close(t.periods.T1.points.internal, 195, "T1 points");
  close(t.periods.T1.max_points.internal, 250, "T1 max");
  close(t.periods.T1.percentage.internal, 78, "T1 %");
  close(t.periods.T3.points.internal, 233, "T3 points");
  close(t.periods.T3.max_points.internal, 270, "T3 max");
  close(t.annual.points.internal, 623, "annuel points");
  close(t.annual.max_points.internal, 770, "annuel max");
  close(t.annual.percentage.internal, (100 * 623) / 770, "annuel %");
  assert.equal(t.annual.percentage.exposed, 80.91);
  const meanOfPercentages = (78 + 78 + (100 * 233) / 270) / 3;
  assert.ok(Math.abs(t.annual.percentage.internal - meanOfPercentages) > 0.1, "pas de moyenne des pourcentages");
  assert.equal(t.status, "COMPLETE");
});

test("A — les slots canoniques existants appliquent les maxima par matière ; rang sur le % annuel", () => {
  const result = run(simpleFixture);
  close(slot(result, "COL_T1_POINTS").internal, 195, "PERIOD_POINTS T1");
  close(slot(result, "COL_T3_MAX").internal, 270, "PERIOD_MAX T3");
  close(slot(result, "COL_ANNUAL_MAX").internal, 770, "ANNUAL_MAX");
  close(slot(result, "COL_PERCENTAGE").internal, (100 * 623) / 770, "PERCENTAGE");
  assert.equal(slot(result, "COL_RANK").internal, 1);
  assert.equal(slot(result, "COL_RANK", "STU2").internal, 2);
  close(totals(result, "STU2").annual.percentage.internal, 50, "STU2 annuel 385/770");
});

// ---------------------------------------------------------------------------
// Scénario B — matières composées de sous-matières.
// ---------------------------------------------------------------------------

test("B — sous-matière : points = TJ + EX ; maximum = TJ max + EX max", () => {
  const t = totals(run(compositeFixture));
  const lecture = row(t, "FR_LECTURE");
  assert.equal(lecture.kind, "sub");
  assert.equal(lecture.parent_id, "FRANCAIS");
  close(lecture.periods.T1.points.internal, 39, "Lecture points");
  close(lecture.periods.T1.max_points.internal, 50, "Lecture max");
});

test("B — matière composée = Σ sous-matières ; total général sans double comptage", () => {
  const t = totals(run(compositeFixture));
  const fr = row(t, "FRANCAIS");
  assert.equal(fr.kind, "composite");
  close(fr.periods.T1.points.internal, 153, "Français points");
  close(fr.periods.T1.max_points.internal, 200, "Français max");
  close(row(t, "MATHEMATIQUES").periods.T1.points.internal, 120, "Mathématiques");
  close(row(t, "ARTS").periods.T1.max_points.internal, 60, "Arts (TJ seuls)");
  close(t.periods.T1.points.internal, 358, "T1 = 153 + 120 + 50 + 35");
  close(t.periods.T1.max_points.internal, 460, "T1 max");
  const leaves = t.rows.filter((item) => item.kind !== "composite");
  close(leaves.reduce((acc, item) => acc + item.periods.T1.points.internal, 0), 358, "Σ feuilles = total");
  close(t.annual.points.internal, 1074, "annuel");
  close(t.annual.max_points.internal, 1380, "annuel max");
});

test("B — ordre des lignes : matière principale puis ses sous-matières", () => {
  const t = totals(run(compositeFixture));
  assert.deepEqual(
    t.rows.map((item) => item.subject_id),
    ["FRANCAIS", "FR_ECRIT", "FR_LECTURE", "FR_DICTEE", "MATHEMATIQUES", "MATH_MENTAL", "MATH_ECRIT", "ARTS", "ARTS_PLASTIQUES", "MUSIQUE", "EPS", "ANGLAIS"],
  );
});

test("B — slots existants cohérents avec les totaux par matière", () => {
  const result = run(compositeFixture);
  close(slot(result, "COL_T1_POINTS").internal, 358, "PERIOD_POINTS");
  close(slot(result, "COL_T1_MAX").internal, 460, "PERIOD_MAX");
});

test("B — une note saisie sur la matière principale composée est refusée (double comptage)", () => {
  const facts = clone(compositeFixture.facts);
  facts.push({ student_id: "STU1", subject_id: "FRANCAIS", period_id: "T1", score_component_id: "TJ", raw_score: 10 });
  expectCode(() => run(compositeFixture, { facts }), "COMPOSITE_SUBJECT_FACT");
});

// ---------------------------------------------------------------------------
// Scénario C — isolation des établissements.
// ---------------------------------------------------------------------------

test("C — faits d'un autre établissement refusés, même avec des matières homonymes", () => {
  const facts = clone(compositeFixture.facts).map((fact) => ({ ...fact, school_id: "school-b" }));
  facts[0] = { ...facts[0], school_id: "school-a" };
  expectCode(() => run(compositeFixture, { facts }), "MIXED_TENANT_FACTS");
});

test("C — un modèle ne peut référencer que le catalogue de son établissement", () => {
  const profileSpec = validateSpec(compositeFixture.profile);
  const catalogA = profileSpec.subjects.map((subject) => ({
    school_id: "school-a",
    subject_code: subject.id,
    parent_subject_code: subject.parent_id ?? null,
    status: "active",
  }));
  assert.doesNotThrow(() => assertProfileSubjectsInCatalog({ schoolId: "school-a", profileSpec, catalog: catalogA }));
  // Sous-matière présente seulement dans l'établissement B (homonyme de code ailleurs).
  const withoutLecture = catalogA.filter((item) => item.subject_code !== "FR_LECTURE");
  expectCode(
    () => assertProfileSubjectsInCatalog({ schoolId: "school-a", profileSpec, catalog: withoutLecture }),
    "SUBJECT_NOT_IN_SCHOOL_CATALOG",
  );
  const foreignRow = catalogA.map((item) => (item.subject_code === "FR_LECTURE" ? { ...item, school_id: "school-b" } : item));
  expectCode(
    () => assertProfileSubjectsInCatalog({ schoolId: "school-a", profileSpec, catalog: foreignRow }),
    "CATALOG_TENANT_MISMATCH",
  );
  const wrongParent = catalogA.map((item) => (item.subject_code === "FR_LECTURE" ? { ...item, parent_subject_code: "ARTS" } : item));
  expectCode(
    () => assertProfileSubjectsInCatalog({ schoolId: "school-a", profileSpec, catalog: wrongParent }),
    "SUBJECT_PARENT_MISMATCH",
  );
  const inactive = catalogA.map((item) => (item.subject_code === "MUSIQUE" ? { ...item, status: "archived" } : item));
  expectCode(
    () => assertProfileSubjectsInCatalog({ schoolId: "school-a", profileSpec, catalog: inactive }),
    "SUBJECT_INACTIVE",
  );
});

// ---------------------------------------------------------------------------
// Scénario D — robustesse.
// ---------------------------------------------------------------------------

function withoutFact(fixture, predicate) {
  return clone(fixture.facts).filter((fact) => !predicate(fact));
}

test("D — note non saisie : jamais 0 ; total INCOMPLET ; maximum attendu conservé", () => {
  const facts = withoutFact(compositeFixture, (f) => f.subject_id === "FR_DICTEE" && f.score_component_id === "EX" && f.period_id === "T1");
  const t = totals(run(compositeFixture, { facts }));
  const dictee = row(t, "FR_DICTEE").periods.T1;
  assert.equal(dictee.components.EX.kind, "MISSING");
  assert.equal(dictee.components.EX.internal, null);
  assert.equal(dictee.status, "INCOMPLETE");
  close(dictee.points.internal, 18, "Dictée : TJ seul compté");
  close(dictee.max_points.internal, 50, "maximum attendu conservé");
  assert.equal(row(t, "FRANCAIS").periods.T1.status, "INCOMPLETE");
  assert.equal(t.periods.T1.status, "INCOMPLETE");
  assert.equal(t.periods.T2.status, "COMPLETE");
  assert.equal(t.annual.status, "INCOMPLETE");
  assert.equal(t.status, "INCOMPLETE");
  assert.deepEqual(
    t.issues.filter((issue) => issue.code === "MISSING_SCORE"),
    [{ code: "MISSING_SCORE", reason: "NOT_ENTERED", subject_id: "FR_DICTEE", period_id: "T1", score_component_id: "EX" }],
  );
});

test("D — note vide, non publiée ou évaluation annulée : MISSING avec motif, jamais comptée", () => {
  const facts = clone(compositeFixture.facts).map((fact) => {
    if (fact.period_id !== "T1") return fact;
    if (fact.subject_id === "FR_ECRIT" && fact.score_component_id === "TJ") return { ...fact, raw_score: null };
    if (fact.subject_id === "FR_ECRIT" && fact.score_component_id === "EX") return { ...fact, fact_status: "UNPUBLISHED" };
    if (fact.subject_id === "ANGLAIS" && fact.score_component_id === "EX") return { ...fact, fact_status: "CANCELLED" };
    return fact;
  });
  const t = totals(run(compositeFixture, { facts }));
  const ecrit = row(t, "FR_ECRIT").periods.T1;
  close(ecrit.points.internal, 0, "Écrit : aucune note comptée");
  close(ecrit.max_points.internal, 100, "Écrit : maximum attendu");
  assert.equal(ecrit.components.TJ.kind, "MISSING");
  assert.equal(ecrit.components.EX.kind, "MISSING");
  const reasons = t.issues.filter((issue) => issue.period_id === "T1").map((issue) => `${issue.subject_id}:${issue.score_component_id}:${issue.reason}`);
  assert.deepEqual(reasons.sort(), ["ANGLAIS:EX:CANCELLED", "FR_ECRIT:EX:UNPUBLISHED", "FR_ECRIT:TJ:NOT_ENTERED"]);
  close(t.periods.T1.points.internal, 358 - 75 - 21, "T1 sans ces notes");
});

test("D — sous-matière sans aucune note : toutes ses composantes manquantes", () => {
  const facts = withoutFact(compositeFixture, (f) => f.subject_id === "MUSIQUE" && f.period_id === "T2");
  const t = totals(run(compositeFixture, { facts }));
  const musique = row(t, "MUSIQUE").periods.T2;
  assert.equal(musique.components.TJ.kind, "MISSING");
  assert.equal(musique.status, "INCOMPLETE");
  close(row(t, "ARTS").periods.T2.max_points.internal, 60, "Arts : maximum attendu inchangé");
});

test("D — période entièrement absente : INCOMPLET, jamais zéro", () => {
  const facts = withoutFact(simpleFixture, (f) => f.period_id === "T3");
  const t = totals(run(simpleFixture, { facts, cohort: undefined, schema: { sections: [{ id: "TOTALS", order: 1, kind: "totals", columns: [{ id: "COL_ANNUAL_POINTS", order: 1, kind: "computed_slot", slot: "ANNUAL_POINTS" }] }] } }));
  assert.equal(t.periods.T3.status, "INCOMPLETE");
  close(t.periods.T3.points.internal, 0, "T3 points");
  close(t.periods.T3.max_points.internal, 270, "T3 maximum attendu");
  assert.equal(t.annual.status, "INCOMPLETE");
});

test("D — composante non applicable : une note saisie est refusée ; un fait N/A vide est accepté", () => {
  const withScore = clone(simpleFixture.facts);
  withScore.push({ student_id: "STU1", subject_id: "EDUCATION_PHYSIQUE", period_id: "T1", score_component_id: "EX", raw_score: 10 });
  expectCode(() => run(simpleFixture, { facts: withScore, cohort: withScore }), "FACT_FOR_NOT_APPLICABLE_COMPONENT");
  const withNa = clone(simpleFixture.facts);
  withNa.push({ student_id: "STU1", subject_id: "EDUCATION_PHYSIQUE", period_id: "T1", score_component_id: "EX", raw_score: null });
  close(totals(run(simpleFixture, { facts: withNa, cohort: withNa }), "STU1").periods.T1.points.internal, 195, "N/A vide ignoré");
});

test("D — note négative ou supérieure au maximum de la sous-matière : refusée", () => {
  const negative = clone(compositeFixture.facts);
  negative[0] = { ...negative[0], raw_score: -1 };
  expectCode(() => run(compositeFixture, { facts: negative }), "INVALID_SCORE");
  const above = clone(compositeFixture.facts);
  const lectureTj = above.findIndex((f) => f.subject_id === "FR_LECTURE" && f.score_component_id === "TJ");
  above[lectureTj] = { ...above[lectureTj], raw_score: 25 }; // max 20 pour Lecture, 40 pour Écrit
  expectCode(() => run(compositeFixture, { facts: above }), "SCORE_OUT_OF_BOUNDS");
});

test("D — matière retirée : faits exclus et signalés, sans fausser les totaux", () => {
  const facts = clone(compositeFixture.facts);
  facts.push({ student_id: "STU1", subject_id: "LATIN", period_id: "T1", score_component_id: "TJ", raw_score: 12 });
  const t = totals(run(compositeFixture, { facts }));
  close(t.periods.T1.points.internal, 358, "LATIN non compté");
  assert.ok(t.issues.some((issue) => issue.code === "SUBJECT_NOT_CONFIGURED" && issue.subject_id === "LATIN"));
  assert.equal(t.status, "COMPLETE", "une matière non configurée n'est pas une note manquante");
});

test("D — matière désactivée pour une période : ni attendue, ni comptée", () => {
  const profile = clone(compositeFixture.profile);
  profile.subjects.find((s) => s.id === "ANGLAIS").periods = { exclude: ["T3"] };
  const facts = withoutFact(compositeFixture, (f) => f.subject_id === "ANGLAIS" && f.period_id === "T3");
  const t = totals(run(compositeFixture, { profile, facts }));
  assert.equal(row(t, "ANGLAIS").periods.T3.status, "NOT_APPLICABLE");
  close(t.periods.T3.max_points.internal, 410, "T3 sans Anglais");
  close(t.annual.max_points.internal, 460 + 460 + 410, "annuel");
  assert.equal(t.status, "COMPLETE");
});

test("D — coefficient existant : points et maximum pondérés", () => {
  const profile = clone(simpleFixture.profile);
  profile.subjects.find((s) => s.id === "EDUCATION_PHYSIQUE").components.TJ.coefficient = 2;
  const t = totals(run(simpleFixture, { profile }));
  close(row(t, "EDUCATION_PHYSIQUE").periods.T1.points.internal, 80, "40 × 2");
  close(row(t, "EDUCATION_PHYSIQUE").periods.T1.max_points.internal, 100, "50 × 2");
  close(t.periods.T1.max_points.internal, 300, "T1 max pondéré");
});

test("D — modification des règles d'une année à l'autre : deux versions, résultats distincts et stables", () => {
  const v1 = validateSpec(clone(simpleFixture.profile));
  const raw2 = clone(simpleFixture.profile);
  raw2.subjects.find((s) => s.id === "GEOGRAPHIE").components = { TJ: { max: 40 }, EX: { max: 60 } };
  const v2 = validateSpec(raw2);
  assert.notEqual(specSha256(v1), specSha256(v2));
  assert.deepEqual(validateSpec(clone(v1)), v1, "normalisation idempotente");
  assert.equal(specSha256(validateSpec(clone(v2))), specSha256(v2), "hash stable après re-validation");
  const composite = validateSpec(clone(compositeFixture.profile));
  assert.deepEqual(validateSpec(clone(composite)), composite, "idempotent avec sous-matières et périodes");
  const facts = clone(simpleFixture.facts).map((f) => (f.subject_id === "GEOGRAPHIE" && f.score_component_id === "EX" ? { ...f, raw_score: Math.min(f.raw_score, 60) } : f));
  const r1 = totals(run(simpleFixture, { profile: v1, facts, cohort: facts }));
  const r1Again = totals(run(simpleFixture, { profile: clone(simpleFixture.profile), facts, cohort: facts }));
  const r2 = totals(run(simpleFixture, { profile: raw2, facts, cohort: facts }));
  assert.deepEqual(r1, r1Again, "déterministe");
  close(row(r1, "GEOGRAPHIE").periods.T1.max_points.internal, 100, "v1");
  close(row(r2, "GEOGRAPHIE").periods.T1.max_points.internal, 100, "v2 même total");
  assert.notDeepEqual(row(r1, "GEOGRAPHIE").periods.T1.components, row(r2, "GEOGRAPHIE").periods.T1.components);
});

test("D — validation du modèle : doublons, hiérarchie, maxima et composantes invalides", () => {
  const base = clone(compositeFixture.profile);
  const variant = (mutate) => {
    const raw = clone(base);
    mutate(raw);
    return () => validateSpec(raw);
  };
  expectCode(variant((p) => p.subjects.push({ id: "FR_LECTURE", parent_id: "FRANCAIS", order: 9, components: { TJ: { max: 10 } } })), "DUPLICATE_SUBJECT");
  expectCode(variant((p) => p.subjects.push({ id: "X", parent_id: "INCONNUE", order: 9, components: { TJ: { max: 10 } } })), "UNKNOWN_PARENT_SUBJECT");
  expectCode(variant((p) => p.subjects.push({ id: "X", parent_id: "FR_LECTURE", order: 9, components: { TJ: { max: 10 } } })), "SUBJECT_NESTING_TOO_DEEP");
  expectCode(variant((p) => { p.subjects.find((s) => s.id === "FRANCAIS").components = { TJ: { max: 10 } }; }), "COMPOSITE_WITH_COMPONENTS");
  expectCode(variant((p) => p.subjects.push({ id: "VIDE", order: 9 })), "SUBJECT_WITHOUT_COMPONENTS");
  expectCode(variant((p) => p.subjects.push({ id: "X", order: 9, components: { ORAL: { max: 10 } } })), "UNKNOWN_SUBJECT_COMPONENT");
  for (const max of [0, -5, "abc", null, Number.POSITIVE_INFINITY]) {
    expectCode(variant((p) => p.subjects.push({ id: "X", order: 9, components: { TJ: { max } } })), "INVALID_SUBJECT_MAX");
  }
  expectCode(variant((p) => p.subjects.push({ id: "X", order: 9, components: { TJ: {} } })), "INVALID_SUBJECT_MAX");
  expectCode(variant((p) => p.subjects.push({ id: "X", order: 9, components: { TJ: { max: 10, coefficient: 0 } } })), "INVALID_SUBJECT_COEFFICIENT");
  expectCode(variant((p) => { p.subjects.find((s) => s.id === "ANGLAIS").period_overrides = { T9: { EX: { max: 10 } } }; }), "INVALID_PERIOD_OVERRIDE");
  expectCode(variant((p) => p.subjects.push({ id: "", order: 9, components: { TJ: { max: 10 } } })), "INVALID_SUBJECT_ID");
  expectCode(
    variant((p) => {
      delete p.aggregation;
      delete p.pass_rule;
      p.ranking = { enabled: false, ties: "competition" };
    }),
    "SUBJECT_RULES_REQUIRE_AGGREGATION",
  );
});

// ---------------------------------------------------------------------------
// Scénario E — non-régression des modèles existants.
// ---------------------------------------------------------------------------

test("E — profils sans « subjects » : spécification et hash inchangés", () => {
  const spec = validateSpec(clone(legacyB.profile));
  assert.equal("subjects" in spec, false);
  assert.equal(specSha256(spec), specSha256(validateSpec(clone(legacyB.profile))));
});

test("E — qualification LOT 10 A et B : sortie complète identique au moteur d'avant extension", () => {
  for (const [name, fixture, expected] of [["model-a", legacyA, legacyExpectedA], ["model-b", legacyB, legacyExpectedB]]) {
    const result = computeReportCard({
      profile: fixture.profile,
      schema: fixture.schema,
      facts: fixture.facts,
      provenance: fixture.provenance,
      tenant: fixture.tenant,
    });
    for (const studentResult of result.students) {
      assert.equal("subject_totals" in studentResult, false, "aucun bloc nouveau sur un modèle existant");
    }
    assert.deepEqual(JSON.parse(JSON.stringify(result)), legacyEngineOutput[name], `${name} : sortie complète`);
    assert.deepEqual(canonicalResult(result), expected.canonical, `${name} : golden LOT 10`);
  }
});
