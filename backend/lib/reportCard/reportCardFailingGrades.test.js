"use strict";

/**
 * Notes en échec — affichage uniquement (Web, PDF, impression).
 * Règle : une note est en échec si elle est strictement inférieure à la
 * moitié du maximum de SA cellule (ou `presentation.failing_ratio` configuré).
 * Jamais pour un maximum, une note manquante, une valeur non applicable ou un
 * total incomplet. Les calculs, totaux, rangs et données ne changent pas.
 * Données : moteur canonique réel (computeReportCard).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeReportCard } = require("./reportCardEngine");
const { validateSpec } = require("./academicRuleProfile");
const { buildStudentPresentation } = require("./reportCardPresentation");
const { normalizeRenderingTemplate, specSha256 } = require("./renderingTemplate");
const { renderPresentationStudent } = require("./reportCardPdf");
const simpleFixture = require("./fixtures/model-01/subjects-simple.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const PROFILE = {
  ...clone(simpleFixture.profile),
  subjects: [
    { id: "MATHEMATIQUES", order: 1, components: { TJ: { max: 20 }, EX: { max: 20 } } },
    { id: "FRANCAIS", order: 2, components: { TJ: { max: 20 } } },
    { id: "SCIENCES", order: 3, components: { TJ: { max: 10 }, EX: { max: 10 } } },
    { id: "HISTOIRE", order: 4, components: { TJ: { max: 10 } } },
    { id: "LANGUES", order: 5 },
    { id: "KIRUNDI", parent_id: "LANGUES", order: 1, components: { TJ: { max: 10 } } },
    { id: "ANGLAIS", parent_id: "LANGUES", order: 2, components: { TJ: { max: 10 }, EX: { max: 10 } } },
  ],
};

const FACTS = [
  ["MATHEMATIQUES", "TJ", 9], // 9/20 → échec
  ["MATHEMATIQUES", "EX", 10], // 10/20 → pas d'échec (égal à la moitié)
  ["FRANCAIS", "TJ", 14], // 14/20 → normal
  ["SCIENCES", "TJ", 4], // 4/10 → échec
  ["SCIENCES", "EX", 5], // 5/10 → pas d'échec
  ["HISTOIRE", "TJ", 7], // 7/10 → normal
  ["KIRUNDI", "TJ", 3], // sous-matière 3/10 → échec
  ["ANGLAIS", "TJ", 8], // sous-matière 8/10 ; EX manquant
].flatMap(([subject, component, score]) =>
  ["STU1", "STU2"].map((student) => ({
    student_id: student,
    subject_id: subject,
    period_id: "T1",
    score_component_id: component,
    raw_score: student === "STU1" ? score : Math.min(score + 2, 20),
  }))
);

function run() {
  const facts = clone(FACTS);
  return computeReportCard({
    profile: clone(PROFILE),
    schema: clone(simpleFixture.schema),
    facts,
    cohort: clone(facts),
    tenant: clone(simpleFixture.tenant),
    provenance: { profile: { id: "p", version: 1 }, schema: { id: "s", version: 1 } },
  });
}

function present(student, presentation = {}) {
  return buildStudentPresentation({ student, profile: validateSpec(clone(PROFILE)), presentation, meta: { official: true } });
}

function row(view, subjectId) {
  return view.rows.find((item) => item.subject_id === subjectId);
}

test("9/20 en échec, 10/20 non ; 14/20 normal ; 4/10 en échec, 5/10 non ; 7/10 normal", () => {
  const view = present(run().students.find((s) => s.student_id === "STU1"));
  const t1 = (subject, component) => row(view, subject).periods.T1.components[component];
  assert.equal(t1("MATHEMATIQUES", "TJ").value, 9);
  assert.equal(t1("MATHEMATIQUES", "TJ").failing, true, "9/20");
  assert.equal(t1("MATHEMATIQUES", "EX").failing, false, "10/20 = moitié : pas en échec");
  assert.equal(t1("FRANCAIS", "TJ").failing, false, "14/20");
  assert.equal(t1("SCIENCES", "TJ").failing, true, "4/10");
  assert.equal(t1("SCIENCES", "EX").failing, false, "5/10 = moitié : pas en échec");
  assert.equal(t1("HISTOIRE", "TJ").failing, false, "7/10");
});

test("maxima variables : chaque note est comparée au maximum de SA composante ; totaux complets concernés", () => {
  const view = present(run().students.find((s) => s.student_id === "STU1"));
  // Même valeur 9 : en échec sur /20, pas sur /10 (cf. 7/10 normal).
  assert.equal(row(view, "MATHEMATIQUES").periods.T1.points, 19);
  assert.equal(row(view, "MATHEMATIQUES").periods.T1.max, 40);
  assert.equal(row(view, "MATHEMATIQUES").periods.T1.failing, true, "total 19/40 < 20");
  assert.equal(row(view, "FRANCAIS").periods.T1.failing, false, "total 14/20");
  assert.equal(row(view, "SCIENCES").periods.T1.points, 9);
  assert.equal(row(view, "SCIENCES").periods.T1.failing, true, "total 9/20");
  assert.equal(row(view, "HISTOIRE").periods.T1.failing, false, "total 7/10");
});

test("notes manquantes et valeurs non applicables : jamais colorées ; total incomplet jamais coloré", () => {
  const view = present(run().students.find((s) => s.student_id === "STU1"));
  const anglaisEx = row(view, "ANGLAIS").periods.T1.components.EX;
  assert.equal(anglaisEx.state, "MISSING");
  assert.equal(anglaisEx.failing, false);
  assert.equal(row(view, "FRANCAIS").periods.T1.components.EX.state, "NOT_APPLICABLE");
  assert.equal(row(view, "FRANCAIS").periods.T1.components.EX.failing, false);
  assert.equal(row(view, "ANGLAIS").periods.T1.status, "INCOMPLETE");
  assert.equal(row(view, "ANGLAIS").periods.T1.failing, false, "total incomplet non coloré");
  // Trimestres sans notes : tout manquant, rien de coloré.
  assert.ok(view.rows.every((item) => item.periods.T2.failing === false));
});

test("sous-matières : note de sous-matière en échec ; sous-total de la matière principale incomplet non coloré", () => {
  const view = present(run().students.find((s) => s.student_id === "STU1"));
  assert.equal(row(view, "KIRUNDI").periods.T1.components.TJ.failing, true, "3/10");
  assert.equal(row(view, "KIRUNDI").periods.T1.failing, true, "total sous-matière 3/10");
  assert.equal(row(view, "ANGLAIS").periods.T1.components.TJ.failing, false, "8/10");
  const langues = row(view, "LANGUES");
  assert.equal(langues.kind, "composite");
  assert.equal(langues.periods.T1.status, "INCOMPLETE");
  assert.equal(langues.periods.T1.failing, false);
});

test("seuil configuré (failing_ratio) remplace la moitié ; valeurs invalides refusées", () => {
  const student = run().students.find((s) => s.student_id === "STU1");
  const view = present(student, { failing_ratio: 0.6 });
  assert.equal(view.failing_ratio, 0.6);
  assert.equal(row(view, "SCIENCES").periods.T1.components.EX.failing, true, "5/10 < 6");
  assert.equal(row(view, "HISTOIRE").periods.T1.components.TJ.failing, false, "7/10 ≥ 6");
  assert.equal(row(view, "MATHEMATIQUES").periods.T1.components.EX.failing, true, "10/20 < 12");
  assert.equal(present(student).failing_ratio, 0.5, "défaut : moitié");
  const base = { paper: "A4", orientation: "portrait", qr_required: true, sections: [{ id: "CELLS", order: 1, source: "cells", label: "Matières" }] };
  assert.equal(normalizeRenderingTemplate({ ...base, presentation: { failing_ratio: 0.6 } }).presentation.failing_ratio, 0.6);
  for (const bad of [0, -0.1, 1.5, "0.5", null]) {
    assert.throws(
      () => normalizeRenderingTemplate({ ...base, presentation: { failing_ratio: bad } }),
      (err) => err.code === "RENDERING_TEMPLATE_INVALID",
      String(bad)
    );
  }
  assert.equal(
    specSha256(normalizeRenderingTemplate(clone(base))),
    specSha256({ ...base }),
    "gabarit sans seuil : empreinte inchangée"
  );
});

test("calculs, totaux et rangs inchangés par la présentation", () => {
  const result = run();
  const before = clone(result.students);
  for (const student of result.students) present(student, { failing_ratio: 0.6 });
  assert.deepEqual(clone(result.students), before);
  const stu1 = result.students.find((s) => s.student_id === "STU1").subject_totals;
  assert.equal(stu1.periods.T1.rank.kind, "NOT_RANKED", "rang : règle du moteur inchangée (total incomplet)");
});

test("PDF : seules les notes et les points en échec sont rouges et soulignés, jamais les maxima", () => {
  const view = present(run().students.find((s) => s.student_id === "STU1"));
  const html = renderPresentationStudent(view);
  const failing = [...html.matchAll(/<(td|span) class="[^"]*failing[^"]*" data-failing>([^<]*)</g)].map((m) => m[2]);
  // Composantes 9, 4, 3 ; totaux de ligne 19 (Math), 9 (Sciences), 3 (Kirundi).
  assert.deepEqual(failing.sort(), ["19", "3", "3", "4", "9", "9"].sort());
  assert.doesNotMatch(html, /class="max[^"]*failing/, "aucun maximum coloré");
  assert.doesNotMatch(html, /data-missing[^>]*data-failing|data-failing[^>]*data-missing/);
});
