"use strict";

/**
 * BULLETIN-UI-01 — adaptateur de présentation (modèles A et B), gabarit de
 * rendu (bloc `presentation` optionnel) et HTML du PDF. Sans base de données.
 * Données : fixtures BULLETIN-MODEL-01 passées par le moteur canonique réel.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeReportCard } = require("./reportCardEngine");
const { validateSpec } = require("./academicRuleProfile");
const { buildStudentPresentation, hasSubjectTotals, ReportCardPresentationError } = require("./reportCardPresentation");
const { normalizeRenderingTemplate, specSha256 } = require("./renderingTemplate");
const { buildHtml, renderPresentationStudent } = require("./reportCardPdf");
const simpleFixture = require("./fixtures/model-01/subjects-simple.json");
const compositeFixture = require("./fixtures/model-01/subjects-composite.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function engine(fixture, { facts, scope } = {}) {
  const input = {
    profile: clone(fixture.profile),
    schema: clone(fixture.schema),
    facts: facts || clone(fixture.facts),
    tenant: clone(fixture.tenant),
    provenance: { profile: { id: "p", version: 1 }, schema: { id: "s", version: 1 } },
    ...(scope ? { scope } : {}),
  };
  if (input.schema.sections.some((s) => s.columns.some((c) => c.slot === "RANK"))) input.cohort = clone(input.facts);
  return computeReportCard(input);
}

function present(fixture, options = {}) {
  const result = engine(fixture, options);
  const student = result.students.find((row) => row.student_id === (options.studentId || "STU1"));
  return {
    student,
    view: buildStudentPresentation({
      student,
      profile: validateSpec(clone(fixture.profile)),
      labels: options.labels || {},
      presentation: options.presentation || {},
      meta: options.meta || {},
    }),
  };
}

test("modèle A (matières simples) : style simple, TJ/EX, maxima du profil, valeurs = moteur", () => {
  const { student, view } = present(simpleFixture, { labels: { subjects: { GEOGRAPHIE: "Géographie" }, school: "École A" } });
  assert.equal(view.style, "simple");
  assert.equal(view.official, false, "officiel seulement si l'appelant l'affirme (snapshot publié)");
  assert.deepEqual(view.components.map((c) => c.id), ["TJ", "EX"]);
  assert.deepEqual(view.periods.map((p) => p.id), ["T1", "T2", "T3"]);
  assert.deepEqual(view.rows.map((r) => r.subject_id), ["GEOGRAPHIE", "MATHEMATIQUES", "EDUCATION_PHYSIQUE"]);
  assert.equal(view.rows[0].label, "Géographie", "libellé de l'établissement");
  assert.equal(view.rows[1].label, "MATHEMATIQUES", "sans libellé : identifiant, jamais un texte inventé");
  const math = view.rows.find((r) => r.subject_id === "MATHEMATIQUES");
  assert.equal(math.periods.T1.components.EX.max, 60);
  assert.equal(math.periods.T3.components.EX.max, 80, "surcharge de période du profil");
  const eps = view.rows.find((r) => r.subject_id === "EDUCATION_PHYSIQUE");
  assert.equal(eps.periods.T1.components.EX.state, "NOT_APPLICABLE");
  const sealed = student.subject_totals;
  for (const periodId of ["T1", "T2", "T3"]) {
    assert.equal(view.totals.periods[periodId].points, sealed.periods[periodId].points.exposed);
    assert.equal(view.totals.periods[periodId].max, sealed.periods[periodId].max_points.exposed);
  }
  assert.equal(view.totals.annual.points, sealed.annual.points.exposed);
  assert.equal(view.totals.annual.percentage, sealed.annual.percentage.exposed);
  assert.equal(view.school.name, "École A");
});

test("modèle B (matières composées) : sous-total du moteur, sous-matières, aucun double comptage", () => {
  const { student, view } = present(compositeFixture);
  assert.equal(view.style, "hierarchical", "auto : composée ⇒ hiérarchique");
  const order = view.rows.map((r) => `${r.level}:${r.subject_id}`);
  assert.deepEqual(order.slice(0, 4), ["0:FRANCAIS", "1:FR_ECRIT", "1:FR_LECTURE", "1:FR_DICTEE"]);
  const francais = view.rows.find((r) => r.subject_id === "FRANCAIS");
  assert.equal(francais.kind, "composite");
  assert.equal(francais.periods.T1.components, undefined, "une matière principale n'a pas de note propre");
  const sealedRow = student.subject_totals.rows.find((r) => r.subject_id === "FRANCAIS");
  assert.equal(francais.periods.T1.points, sealedRow.periods.T1.points.exposed);
  const children = view.rows.filter((r) => r.parent_id === "FRANCAIS");
  const childSum = children.reduce((acc, r) => acc + r.periods.T1.points, 0);
  assert.equal(francais.periods.T1.points, childSum, "sous-total = somme des sous-matières (calculée par le moteur)");
  const topLevel = view.rows.filter((r) => r.level === 0).reduce((acc, r) => acc + r.periods.T1.points, 0);
  assert.equal(view.totals.periods.T1.points, topLevel, "total général = lignes de premier niveau");
  const everything = view.rows.reduce((acc, r) => acc + r.periods.T1.points, 0);
  assert.notEqual(view.totals.periods.T1.points, everything, "matières + sous-matières additionnées = double comptage");
});

test("style configuré « simple » sur un profil composé : sous-matières à plat, sous-totaux absents, total inchangé", () => {
  const { view } = present(compositeFixture, { presentation: { style: "simple" }, labels: { subjects: { FRANCAIS: "Français", FR_ECRIT: "Écrit" } } });
  assert.equal(view.style, "simple");
  assert.ok(view.rows.every((r) => r.kind === "simple" && r.level === 0));
  assert.equal(view.rows.find((r) => r.subject_id === "FR_ECRIT").group_label, "Français");
  const flat = view.rows.reduce((acc, r) => acc + r.periods.T1.points, 0);
  assert.equal(flat, view.totals.periods.T1.points, "aucune ligne comptée deux fois");
  assert.throws(() => present(compositeFixture, { presentation: { style: "fancy" } }), ReportCardPresentationError);
});

test("note manquante : jamais zéro, signalée, élève incomplet et non classé", () => {
  const facts = clone(compositeFixture.facts).filter(
    (f) => !(f.student_id === "STU1" && f.subject_id === "FR_DICTEE" && f.period_id === "T1" && f.score_component_id === "EX")
  );
  const { view } = present(compositeFixture, { facts });
  const dictee = view.rows.find((r) => r.subject_id === "FR_DICTEE");
  assert.equal(dictee.periods.T1.components.EX.state, "MISSING");
  assert.equal(dictee.periods.T1.components.EX.value, null, "aucune valeur inventée");
  assert.equal(dictee.periods.T1.status, "INCOMPLETE");
  assert.equal(view.status, "INCOMPLETE");
  assert.ok(view.issues.some((i) => i.code === "MISSING_SCORE" && i.subject_id === "FR_DICTEE"));
  const html = renderPresentationStudent(view);
  assert.match(html, /data-incomplete/);
  assert.match(html, /data-missing/);
});

test("trimestre seul : colonnes de la période, pas de bilan annuel", () => {
  const facts = clone(compositeFixture.facts).filter((f) => f.period_id === "T1");
  const { view } = present(compositeFixture, { facts, scope: { periods: ["T1"], annual: false } });
  assert.deepEqual(view.periods.map((p) => p.id), ["T1"]);
  assert.equal(view.totals.annual, null);
  assert.ok(view.rows.every((r) => r.annual === null));
});

test("bulletins historiques : sans totaux par matière, pas de présentation (rendu générique conservé)", () => {
  assert.equal(hasSubjectTotals({ students: [{ student_id: "X", cells: [], slots: [] }] }), false);
  assert.equal(hasSubjectTotals({ students: [] }), false);
  assert.throws(() => buildStudentPresentation({ student: { student_id: "X" }, profile: { subjects: [] } }), ReportCardPresentationError);
});

test("gabarit : bloc presentation optionnel ; absent, spec et empreinte strictement inchangées", () => {
  const legacy = { paper: "A4", orientation: "portrait", qr_required: true, sections: [{ id: "CELLS", order: 1, source: "cells", label: "Matières" }] };
  const normalized = normalizeRenderingTemplate(clone(legacy));
  assert.equal("presentation" in normalized, false);
  assert.equal(
    specSha256(normalized),
    specSha256({ paper: "A4", orientation: "portrait", qr_required: true, sections: [{ id: "CELLS", order: 1, source: "cells", label: "Matières" }] })
  );
  const styled = normalizeRenderingTemplate({ ...clone(legacy), presentation: { style: "hierarchical", signatures: [" Le titulaire ", "Le directeur"] } });
  assert.deepEqual(styled.presentation, { style: "hierarchical", signatures: ["Le titulaire", "Le directeur"] });
  assert.equal(normalizeRenderingTemplate({ ...clone(legacy), presentation: {} }).presentation.style, "auto");
  for (const bad of [
    { style: "fancy" },
    { style: "simple", extra: true },
    { signatures: ["a", "b", "c", "d", "e"] },
    { signatures: [""] },
    { signatures: ["x".repeat(61)] },
    { signatures: "Le directeur" },
    [],
    null,
  ]) {
    assert.throws(
      () => normalizeRenderingTemplate({ ...clone(legacy), presentation: bad }),
      (err) => err.code === "RENDERING_TEMPLATE_INVALID",
      JSON.stringify(bad)
    );
  }
});

test("HTML du PDF : libellés échappés, aucune ressource externe, aucun marquage brouillon", () => {
  const { view } = present(compositeFixture, {
    labels: {
      school: '<img src="http://evil.test/x.png">',
      students: { STU1: { name: "<script>alert(1)</script>" } },
      subjects: { FRANCAIS: '"><iframe src="https://evil.test">' },
    },
    presentation: { signatures: ["<b>Le directeur</b>"] },
    meta: { official: true },
  });
  const html = buildHtml(
    { report_card_id: "rc-1", published_snapshot_version: 1, published_at: "2026-11-03", students: [{ student_id: "STU1" }] },
    { dataUrl: "data:image/png;base64,AAAA", url: "https://somafrik.app/verify/rc/x" },
    null,
    [view]
  );
  assert.equal(/<script|<iframe|<img src="http/i.test(html), false, "aucune balise injectée");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const external = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).filter((url) => !url.startsWith("data:"));
  assert.deepEqual(external, [], "seules des ressources data: (police, QR) sont référencées");
  assert.equal(/BROUILLON/i.test(html), false);
  assert.match(html, /data-style="hierarchical"/);
});
