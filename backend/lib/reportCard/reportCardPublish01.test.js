"use strict";

/**
 * BULLETIN-PUBLISH-01 — tests purs : correspondances explicites, notes réelles →
 * faits, périmètre trimestriel / annuel, classement tenant-safe, brouillon,
 * validation et publication (stores mémoire). Oracles calculés à la main.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateSpec, specSha256 } = require("./academicRuleProfile");
const { computeReportCard } = require("./reportCardEngine");
const { buildPublicationFacts } = require("./reportCardFactBuilder");
const { createReportCardClassPublication } = require("./reportCardClassPublication");
const { createReportCardPublication } = require("./reportCardPublication");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { createReportCardConfiguration, createInMemoryConfigurationPersistence } = require("./reportCardConfiguration");
const { activateQualificationBinding } = require("./reportCardQualification");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const support = require("./reportCardPublish01.support");

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const YEAR = "33333333-3333-4333-8333-333333333333";
const CLASS = "44444444-4444-4444-8444-444444444444";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

async function expectRejects(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `code ${error.code}`);
    return true;
  });
}

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label} : ${actual} ≠ ${expected}`);
}

const simpleSpec = () => validateSpec(support.simpleProfile());
const cohortSimple = [
  { student_uuid: "uuid-STU1", student_code: "STU1", student_school_id: SCHOOL },
  { student_uuid: "uuid-STU2", student_code: "STU2", student_school_id: SCHOOL },
];

function simpleRows() {
  return support.gradeRowsFor(support.simpleProfile(), support.simpleFixture.facts, { mode: "sum", schoolId: SCHOOL, yearId: YEAR });
}

function build(rows, { periods = ["T1", "T2", "T3"], profile = simpleSpec(), cohort = cohortSimple } = {}) {
  return buildPublicationFacts({ profile, schoolId: SCHOOL, classAcademicYearId: YEAR, periods, cohort, gradeRows: rows });
}

function codes(issues) {
  return issues.map((item) => `${item.severity}:${item.code}`);
}

// ---------------------------------------------------------------------------
// Correspondances explicites (profil).
// ---------------------------------------------------------------------------

test("sources : correspondances normalisées, exhaustives et sans ambiguïté", () => {
  const spec = simpleSpec();
  assert.deepEqual(spec.fact_sources.components.TJ, { evaluation_types: ["devoir", "interrogation"], aggregation: "sum" });
  assert.deepEqual(spec.fact_sources.periods.T2.term_names, ["deuxieme trimestre", "trimestre 2"]);
  const variant = (mutate) => {
    const raw = support.simpleProfile();
    mutate(raw);
    return () => validateSpec(raw);
  };
  expectCode(variant((p) => p.fact_sources.components.EX.evaluation_types.push("Devoir")), "AMBIGUOUS_FACT_SOURCE");
  expectCode(variant((p) => p.fact_sources.periods.T3.term_names.push("trimestre 1")), "AMBIGUOUS_FACT_SOURCE");
  expectCode(variant((p) => delete p.fact_sources.components.EX), "FACT_SOURCE_COMPONENT_MISSING");
  expectCode(variant((p) => delete p.fact_sources.periods.T2), "FACT_SOURCE_PERIOD_MISSING");
  expectCode(variant((p) => { p.fact_sources.components.TJ.aggregation = "max"; }), "INVALID_FACT_AGGREGATION");
  expectCode(variant((p) => { p.fact_sources.periods.T9 = { term_names: ["x"] }; }), "UNKNOWN_FACT_SOURCE_PERIOD");
  expectCode(variant((p) => { p.fact_sources.components.ORAL = { evaluation_types: ["oral"], aggregation: "sum" }; }), "UNKNOWN_FACT_SOURCE_COMPONENT");
  expectCode(variant((p) => { p.fact_sources.components.TJ.evaluation_types = []; }), "INVALID_FACT_SOURCES");
  expectCode(variant((p) => { delete p.subjects; }), "FACT_SOURCES_REQUIRE_SUBJECTS");
  assert.deepEqual(validateSpec(clone(spec)), spec, "normalisation idempotente");
  const without = support.simpleProfile();
  delete without.fact_sources;
  assert.equal(specSha256(validateSpec(without)), specSha256(validateSpec(clone(support.simpleFixture.profile))), "profil MODEL-01 inchangé");
});

// ---------------------------------------------------------------------------
// Notes réelles → faits.
// ---------------------------------------------------------------------------

test("faits : trimestres et types reconnus explicitement ; TJ = somme de deux interrogations", () => {
  const { facts, issues, roster } = build(simpleRows());
  assert.deepEqual(issues, []);
  assert.deepEqual(roster, ["STU1", "STU2"]);
  const geoT1 = facts.find((f) => f.student_id === "STU1" && f.subject_id === "GEOGRAPHIE" && f.period_id === "T1" && f.score_component_id === "TJ");
  assert.equal(geoT1.raw_score, 24, "12 + 12");
  assert.equal(facts.filter((f) => f.period_id === "T3").length, 10, "« TRIMESTRE   3 » → T3");
  assert.ok(facts.every((f) => f.school_id === SCHOOL));
});

test("faits : valeur inconnue = anomalie bloquante, jamais une conversion silencieuse", () => {
  const rows = simpleRows();
  rows[0] = { ...rows[0], term_name: "Trimestre spécial" };
  rows[1] = { ...rows[1], evaluation_type_code: null, evaluation_type_text: "projet" };
  const { issues } = build(rows);
  assert.deepEqual(codes(issues).sort(), ["blocking:EVALUATION_TYPE_UNMAPPED", "blocking:PERIOD_UNKNOWN"]);
  assert.equal(issues.find((i) => i.code === "PERIOD_UNKNOWN").term_name, "Trimestre spécial");
  const legacyText = simpleRows();
  const interrogation = legacyText.findIndex((r) => r.evaluation_type_code === "interrogation");
  legacyText[interrogation] = { ...legacyText[interrogation], evaluation_type_code: null, evaluation_type_text: "Interrogation" };
  assert.deepEqual(build(legacyText).issues, [], "type texte hérité normalisé comme evaluation_types.code");
});

test("faits : agrégation explicite — somme contrôlée par les maxima, moyenne pondérée canonique", () => {
  const rows = simpleRows();
  const target = rows.findIndex((r) => r.subject_code === "GEOGRAPHIE" && r.term_name === "Trimestre 1" && r.evaluation_type_code === "interrogation");
  const badMax = clone(rows);
  badMax[target] = { ...badMax[target], max_score: 10 };
  assert.ok(codes(build(badMax).issues).includes("blocking:MAX_INCONSISTENT"));
  const badCoef = clone(rows);
  badCoef[target] = { ...badCoef[target], coefficient: 2 };
  assert.ok(codes(build(badCoef).issues).includes("blocking:COEFFICIENT_NOT_SUPPORTED"));
  const absent = clone(rows);
  absent[target] = { ...absent[target], score: null, grade_status: "absent" };
  const absentFact = build(absent).facts.find((f) => f.student_id === absent[target].student_code && f.subject_id === "GEOGRAPHIE" && f.period_id === "T1" && f.score_component_id === "TJ");
  assert.equal(absentFact.raw_score, null, "absent : note manquante, jamais 0");
  // Moyenne pondérée : 8/10 et 6/10, cellule /20 → 14.
  const avgProfile = support.simpleProfile();
  avgProfile.fact_sources.components.TJ.aggregation = "weighted_average";
  const avg = clone(rows)
    .filter((r) => !(r.student_code === "STU1" && r.subject_code === "GEOGRAPHIE" && r.term_name === "Trimestre 1" && r.evaluation_type_code === "interrogation"))
    .concat([
      { ...rows[target], grade_id: "w1", student_code: "STU1", student_uuid: "uuid-STU1", max_score: 10, score: 8 },
      { ...rows[target], grade_id: "w2", student_code: "STU1", student_uuid: "uuid-STU1", max_score: 10, score: 6 },
    ]);
  const avgFact = build(avg, { profile: validateSpec(avgProfile) }).facts.find(
    (f) => f.student_id === "STU1" && f.subject_id === "GEOGRAPHIE" && f.period_id === "T1" && f.score_component_id === "TJ"
  );
  close(avgFact.raw_score, 21, "(0,8 + 0,6) / 2 × 30");
});

test("faits : notes brouillon exclues, évaluations annulées signalées", () => {
  const rows = simpleRows();
  const cell = (r) => r.student_code === "STU1" && r.subject_code === "MATHEMATIQUES" && r.term_name === "Trimestre 1";
  const draft = rows.map((r) => (cell(r) && r.evaluation_type_code === "examen" ? { ...r, evaluation_status: "draft" } : r));
  const draftFact = build(draft).facts.find((f) => f.student_id === "STU1" && f.subject_id === "MATHEMATIQUES" && f.period_id === "T1" && f.score_component_id === "EX");
  assert.equal(draftFact.fact_status, "UNPUBLISHED");
  assert.equal(draftFact.raw_score, null);
  const unpublishedGrade = rows.map((r) => (cell(r) && r.evaluation_type_code === "examen" ? { ...r, publication_status: "draft" } : r));
  assert.equal(build(unpublishedGrade).facts.find((f) => f.student_id === "STU1" && f.subject_id === "MATHEMATIQUES" && f.period_id === "T1" && f.score_component_id === "EX").fact_status, "UNPUBLISHED");
  const cancelled = rows.map((r) => (cell(r) && r.evaluation_type_code === "examen" ? { ...r, evaluation_status: "archived" } : r));
  assert.equal(build(cancelled).facts.find((f) => f.student_id === "STU1" && f.subject_id === "MATHEMATIQUES" && f.period_id === "T1" && f.score_component_id === "EX").fact_status, "CANCELLED");
  // Une interrogation brouillon de plus dans une cellule publiée : cellule non publiée (bulletin incomplet).
  const extra = rows.concat([{ ...rows.find((r) => cell(r) && r.evaluation_type_code === "interrogation"), grade_id: "draft-x", evaluation_id: "e-draft", evaluation_status: "draft", score: 3 }]);
  assert.equal(build(extra).facts.find((f) => f.student_id === "STU1" && f.subject_id === "MATHEMATIQUES" && f.period_id === "T1" && f.score_component_id === "TJ").fact_status, "UNPUBLISHED");
});

test("faits : établissement, inscription, évaluation, matière, cours, composante et année vérifiés", () => {
  const rows = simpleRows();
  const variants = [
    [(r) => ({ ...r, grade_school_id: OTHER }), "blocking:FOREIGN_SCHOOL_DATA"],
    [(r) => ({ ...r, subject_school_id: OTHER }), "blocking:FOREIGN_SCHOOL_DATA"],
    [(r) => ({ ...r, student_uuid: "uuid-INCONNU", student_code: "EX-ELEVE" }), "warning:ENROLLMENT_INVALID"],
    [(r) => ({ ...r, evaluation_id: null }), "blocking:GRADE_WITHOUT_EVALUATION"],
    [(r) => ({ ...r, subject_code: "LATIN" }), "blocking:SUBJECT_NOT_CONFIGURED"],
    [(r) => ({ ...r, course_id: null }), "blocking:COURSE_NOT_FOUND"],
    [(r) => ({ ...r, term_year_id: "autre-annee" }), "blocking:TERM_NOT_IN_ACADEMIC_YEAR"],
    [(r) => ({ ...r, subject_code: "EDUCATION_PHYSIQUE", evaluation_type_code: "examen" }), "blocking:COMPONENT_NOT_APPLICABLE"],
  ];
  for (const [mutate, expected] of variants) {
    const changed = clone(rows);
    changed[0] = mutate(changed[0]);
    assert.ok(codes(build(changed).issues).includes(expected), expected);
  }
  const composite = support.gradeRowsFor(support.compositeProfile(), support.compositeFixture.facts, { mode: "weighted_average", schoolId: SCHOOL, yearId: YEAR });
  composite[0] = { ...composite[0], subject_code: "FRANCAIS" };
  const built = buildPublicationFacts({
    profile: validateSpec(support.compositeProfile()),
    schoolId: SCHOOL,
    classAcademicYearId: YEAR,
    periods: ["T1", "T2", "T3"],
    cohort: [{ student_uuid: "uuid-STU1", student_code: "STU1", student_school_id: SCHOOL }],
    gradeRows: composite,
  });
  assert.ok(codes(built.issues).includes("blocking:SUBJECT_IS_COMPOSITE"));
  const foreignStudent = build(rows, { cohort: [{ ...cohortSimple[0], student_school_id: OTHER }, cohortSimple[1]] });
  assert.ok(codes(foreignStudent.issues).includes("blocking:FOREIGN_SCHOOL_DATA"));
});

test("faits : période hors périmètre ignorée (bulletin du 1er trimestre)", () => {
  const { facts, issues } = build(simpleRows(), { periods: ["T1"] });
  assert.deepEqual(issues, []);
  assert.ok(facts.every((f) => f.period_id === "T1"));
});

// ---------------------------------------------------------------------------
// Moteur : périmètre, élèves sans note, classement.
// ---------------------------------------------------------------------------

function computeSimple({ facts, roster, scope, schema = support.simpleFixture.schema }) {
  return computeReportCard({
    profile: support.simpleProfile(),
    schema,
    facts,
    cohort: facts,
    roster,
    scope,
    tenant: { schoolId: SCHOOL, actorSchoolId: SCHOOL },
  });
}

test("moteur : bulletin trimestriel = périodes du périmètre, sans bilan annuel ; slots hors périmètre non calculés", () => {
  const { facts, roster } = build(simpleRows(), { periods: ["T1"] });
  const result = computeSimple({ facts, roster, scope: { periods: ["T1"], annual: false } });
  const stu1 = result.students.find((s) => s.student_id === "STU1");
  assert.deepEqual(stu1.subject_totals.scope, { periods: ["T1"], annual: false });
  assert.deepEqual(Object.keys(stu1.subject_totals.periods), ["T1"]);
  assert.equal("annual" in stu1.subject_totals, false);
  close(stu1.subject_totals.periods.T1.points.internal, 195, "T1");
  assert.equal(stu1.subject_totals.status, "COMPLETE");
  const t3Max = stu1.slots.find((s) => s.column_id === "COL_T3_MAX");
  assert.deepEqual([t3Max.kind, t3Max.reason], ["NOT_APPLICABLE", "OUT_OF_SCOPE"]);
  const annualMax = stu1.slots.find((s) => s.column_id === "COL_ANNUAL_MAX");
  assert.equal(annualMax.reason, "OUT_OF_SCOPE");
  expectCode(() => computeSimple({ facts: build(simpleRows()).facts, roster, scope: { periods: ["T1"], annual: false } }), "OUT_OF_SCOPE_FACT");
  expectCode(() => computeSimple({ facts, roster, scope: { periods: ["T1"], annual: true } }), "INVALID_PERIOD_SCOPE");
});

test("moteur : bilan annuel = Σ points / Σ maxima ; rang et effectif de la classe", () => {
  const { facts, roster } = build(simpleRows());
  const result = computeSimple({ facts, roster, scope: { periods: ["T1", "T2", "T3"], annual: true } });
  const t1 = result.students.find((s) => s.student_id === "STU1").subject_totals;
  close(t1.annual.points.internal, 623, "annuel");
  close(t1.annual.max_points.internal, 770, "annuel max");
  assert.deepEqual(t1.annual.rank, { kind: "RANK", internal: 1, exposed: 1, ranked: 2 });
  assert.equal(t1.cohort_size, 2);
  assert.equal(result.students.find((s) => s.student_id === "STU2").subject_totals.annual.rank.internal, 2);
});

test("moteur : élève incomplet jamais classé ; élève inscrit sans note présent et non classé ; ex æquo", () => {
  const { facts } = build(simpleRows());
  const withNewcomer = computeSimple({ facts, roster: ["STU1", "STU2", "STU3"], scope: { periods: ["T1", "T2", "T3"], annual: true } });
  const newcomer = withNewcomer.students.find((s) => s.student_id === "STU3");
  assert.equal(newcomer.subject_totals.status, "INCOMPLETE");
  close(newcomer.subject_totals.annual.points.internal, 0, "aucun point, jamais un zéro attribué");
  close(newcomer.subject_totals.annual.max_points.internal, 770, "maxima attendus");
  assert.deepEqual(newcomer.subject_totals.annual.rank, { kind: "NOT_RANKED", reason: "INCOMPLETE" });
  assert.equal(newcomer.slots.find((s) => s.column_id === "COL_RANK").reason, "INCOMPLETE");
  assert.equal(withNewcomer.students.find((s) => s.student_id === "STU1").subject_totals.annual.rank.ranked, 2);
  // Ex æquo (competition) : STU3 = copie exacte de STU1 → 1, 1, 3.
  const twin = facts.filter((f) => f.student_id === "STU1").map((f) => ({ ...f, student_id: "STU3" }));
  const tied = computeSimple({ facts: facts.concat(twin), roster: ["STU1", "STU2", "STU3"], scope: { periods: ["T1", "T2", "T3"], annual: true } });
  const ranks = tied.students.map((s) => [s.student_id, s.subject_totals.annual.rank.internal]);
  assert.deepEqual(ranks, [["STU1", 1], ["STU2", 3], ["STU3", 1]]);
});

// ---------------------------------------------------------------------------
// Service : brouillon, validation, publication (mémoire).
// ---------------------------------------------------------------------------

function memoryHarness({ rows = simpleRows(), cohort = cohortSimple } = {}) {
  const profileStore = createAcademicRuleProfileStore();
  const schemaStore = createReportCardSchemaStore();
  const createdP = profileStore.createProfile({ schoolId: SCHOOL, actorSchoolId: SCHOOL, profileKey: "pub01", spec: support.simpleProfile(), activate: true });
  const createdS = schemaStore.createSchema({ schoolId: SCHOOL, actorSchoolId: SCHOOL, schemaKey: "pub01", spec: support.simpleFixture.schema, activate: true });
  const configuration = createReportCardConfiguration({ profileStore, schemaStore, persistence: createInMemoryConfigurationPersistence() });
  const signingKey = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  const publication = createReportCardPublication({ signingKey, wrapping, wrappingKeys: [wrapping], signingKeys: [signingKey] });
  const state = { rows, cohort };
  const factsStore = {
    resolveCohort: ({ schoolId, classId, academicYearId }) => (schoolId === SCHOOL && classId === CLASS && academicYearId === YEAR ? { classId, academicYearId } : null),
    listClassCohort: () => state.cohort,
    listClassGradeSources: () => state.rows,
  };
  const catalogStore = {
    listSchoolSubjectCatalog: () =>
      validateSpec(support.simpleProfile()).subjects.map((s) => ({ school_id: SCHOOL, subject_code: s.id, parent_subject_code: s.parent_id ?? null, status: "active" })),
  };
  const service = createReportCardClassPublication({ publication, factsStore, configuration, catalogStore });
  const tenant = { schoolId: SCHOOL, actorSchoolId: SCHOOL };
  const args = { tenant, classId: CLASS, academicYearId: YEAR, modelKey: "pub01", period: "ANNUAL" };
  return {
    state,
    service,
    publication,
    tenant,
    args,
    async activate() {
      await activateQualificationBinding(configuration, SCHOOL, {
        modelKey: "pub01",
        profile: { id: createdP.profile.id, version: createdP.version.version },
        schema: { id: createdS.schema.id, version: createdS.version.version },
        templateSpec: { paper: "A4", orientation: "portrait", qr_required: true, sections: [{ id: "CELLS", order: 1, source: "cells", label: "Matières" }] },
      });
    },
  };
}

test("service : brouillon non officiel déterministe ; publication de l'empreinte validée uniquement", async () => {
  const h = memoryHarness();
  await expectRejects(h.service.preview(h.args), "MODEL_NOT_BOUND");
  await h.activate();
  const draft = await h.service.preview(h.args);
  assert.equal(draft.official, false);
  assert.equal(draft.publishable, true);
  assert.equal((await h.service.preview(h.args)).draft_sha256, draft.draft_sha256, "empreinte stable");
  await expectRejects(h.service.publish({ ...h.args, actor: { actorId: "u1" } }), "DRAFT_CONFIRMATION_REQUIRED");
  await expectRejects(h.service.publish({ ...h.args, actor: { actorId: "u1" }, expectedDraftSha256: "0".repeat(64) }), "DRAFT_CHANGED");
  const published = await h.service.publish({ ...h.args, actor: { actorId: "u1" }, expectedDraftSha256: draft.draft_sha256 });
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.publications.length, 2, "un bulletin par élève");
  const payload = await h.publication.payloadForRender({ tenant: h.tenant, reportCardId: published.publications[0].report_card_id, version: 1 });
  assert.equal(payload.students.length, 1);
  assert.equal(payload.published_by, "u1");
  assert.equal(payload.period_scope, "ANNUAL");
  assert.ok(payload.provenance.profile.spec_sha256 && payload.provenance.template.spec_sha256);
  close(payload.students[0].subject_totals.annual.points.internal, 623, "snapshot STU1");
  const again = await h.service.publish({ ...h.args, actor: { actorId: "u1" }, expectedDraftSha256: draft.draft_sha256 });
  assert.equal(again.status, "ALREADY_PUBLISHED", "double publication maîtrisée");
  // Notes modifiées après publication : le bulletin publié ne change pas ; la republication est refusée.
  h.state.rows = h.state.rows.map((r) => (r.student_code === "STU1" && r.subject_code === "GEOGRAPHIE" && r.term_name === "Trimestre 1" && r.evaluation_type_code === "examen" ? { ...r, score: 60 } : r));
  const changed = await h.service.preview(h.args);
  assert.notEqual(changed.draft_sha256, draft.draft_sha256);
  await expectRejects(h.service.publish({ ...h.args, actor: { actorId: "u1" }, expectedDraftSha256: changed.draft_sha256 }), "PUBLICATION_ALREADY_EXISTS");
  const unchanged = await h.publication.payloadForRender({ tenant: h.tenant, reportCardId: published.publications[0].report_card_id, version: 1 });
  assert.deepEqual(unchanged, payload, "snapshot officiel figé");
});

test("service : bulletin incomplet refusé avec le détail ; brouillon affichable", async () => {
  const h = memoryHarness();
  await h.activate();
  h.state.rows = h.state.rows.filter((r) => !(r.student_code === "STU2" && r.subject_code === "MATHEMATIQUES" && r.term_name === "TRIMESTRE   3"));
  const draft = await h.service.preview(h.args);
  assert.equal(draft.publishable, false);
  assert.equal(draft.students.find((s) => s.student_id === "STU2").status, "INCOMPLETE");
  assert.equal(draft.students.find((s) => s.student_id === "STU2").subject_totals.annual.rank.kind, "NOT_RANKED");
  await assert.rejects(h.service.publish({ ...h.args, actor: { actorId: "u1" }, expectedDraftSha256: draft.draft_sha256 }), (error) => {
    assert.equal(error.code, "REPORT_CARD_INCOMPLETE");
    assert.equal(error.details[0].student_id, "STU2");
    assert.ok(error.details[0].issues.some((i) => i.code === "MISSING_SCORE" && i.subject_id === "MATHEMATIQUES"));
    return true;
  });
  assert.deepEqual(await h.publication.listCurrent({ tenant: h.tenant }), [], "aucune ligne officielle");
});

test("service : périmètre, établissement et modèle contrôlés", async () => {
  const h = memoryHarness();
  await h.activate();
  await expectRejects(h.service.preview({ ...h.args, period: "T9" }), "INVALID_PERIOD_SCOPE");
  await expectRejects(h.service.preview({ ...h.args, tenant: { schoolId: SCHOOL, actorSchoolId: OTHER } }), "TENANT_MISMATCH");
  await expectRejects(h.service.preview({ ...h.args, tenant: { schoolId: OTHER, actorSchoolId: OTHER } }), "CLASS_NOT_FOUND");
  const t2 = await h.service.preview({ ...h.args, period: "T2" });
  assert.deepEqual(t2.students[0].subject_totals.scope, { periods: ["T1", "T2"], annual: false });
  assert.notEqual(t2.students[0].report_card_id, (await h.service.preview(h.args)).students[0].report_card_id, "bulletin T2 ≠ bulletin annuel");
});

test("publication par lot (mémoire) : un conflit annule tout le lot", async () => {
  const h = memoryHarness();
  const base = (id) => ({
    report_card_id: id,
    published_snapshot_version: 1,
    school_id: SCHOOL,
    published_at: "2026-11-03T00:00:00.000Z",
    engine_id: "somafrik.report_card.v1",
    provenance: { profile: { id: "p", version: 1, spec_sha256: "a" }, schema: { id: "s", version: 1, spec_sha256: "b" } },
    students: [{ student_id: "S", cells: [], slots: [], presence: [] }],
    academic_year_id: YEAR,
    class_id: CLASS,
  });
  await h.publication.publish({ tenant: h.tenant, payload: base("rc-b") });
  await assert.rejects(
    h.publication.publishBatch({ tenant: h.tenant, payloads: [base("rc-a"), { ...base("rc-b"), published_at: "2026-11-04T00:00:00.000Z" }] }),
    (error) => error.name === "IdempotencyConflict" || error.code === "IDEMPOTENCY_CONFLICT"
  );
  assert.deepEqual((await h.publication.listCurrent({ tenant: h.tenant })).map((r) => r.report_card_id), ["rc-b"], "rc-a non publié");
});
