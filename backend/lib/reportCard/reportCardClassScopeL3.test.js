"use strict";

/**
 * BULLETIN-CLASSE-01 / L3 — en-tête et signatures : gabarit, présentation, HTML du PDF (sans base).
 * Parcours HTTP + PostgreSQL réels : reportCardClassScopeL3.http.pg.test.js.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRenderingTemplate, specSha256 } = require("./renderingTemplate");
const { buildStudentPresentation } = require("./reportCardPresentation");
const { renderPresentationStudent } = require("./reportCardPdf");
const { buildConfiguration, sampleConfiguration } = require("./reportCardCatalog");

const MODEL = { model_id: "colombiere", version: 1, name: "Colombière", presentation_style: "simple", status: "active" };
const HEADER = {
  layout: "logo_left",
  show: ["logo", "establishment_name", "country", "class", "period", "student_name"],
  lines: ["République <démocratique> du Congo"],
  title: "Bulletin scolaire",
};
const IDENTITY = {
  establishment_name: "Lycée Lumière",
  establishment_address: "12 avenue du Fleuve",
  establishment_country: "RDC",
  logo_sha256: "a".repeat(64),
  logo_media_type: "image/png",
};

function view({ header = HEADER, identity = IDENTITY, official = true } = {}) {
  const built = sampleConfiguration(MODEL, "TJ_EX");
  const presentation = { ...built.templateSpec.presentation, ...(header ? { header } : {}) };
  const sample = require("./reportCardCatalog").samplePresentation({ ...built, templateSpec: { ...built.templateSpec, presentation } }, { identity });
  return { ...sample, official };
}

test("gabarit : en-tête optionnel, empreinte inchangée sans en-tête", () => {
  const baseSpec = sampleConfiguration(MODEL, "TJ_EX").templateSpec;
  const before = specSha256(normalizeRenderingTemplate(baseSpec));
  assert.equal(specSha256(normalizeRenderingTemplate(JSON.parse(JSON.stringify(baseSpec)))), before);
  const withHeader = normalizeRenderingTemplate({ ...baseSpec, presentation: { ...baseSpec.presentation, header: HEADER } });
  assert.deepEqual(withHeader.presentation.header.show, HEADER.show);
  assert.notEqual(specSha256(withHeader), before);
});

test("présentation : éléments choisis dans l'ordre, identité utilisée, logo par empreinte", () => {
  const v = view();
  assert.deepEqual(v.header.items.map((item) => item.id), ["establishment_name", "country", "class", "period", "student_name"]);
  assert.equal(v.header.items[0].value, "Lycée Lumière");
  assert.equal(v.header.items[1].value, "RDC");
  assert.equal(v.header.items[3].value, "Bilan annuel");
  assert.equal(v.header.logo.sha256, "a".repeat(64));
  assert.equal(v.school.name, "Lycée Lumière");
  const noLogo = view({ header: { ...HEADER, layout: "no_logo", show: HEADER.show.filter((id) => id !== "logo") } });
  assert.equal(noLogo.header.logo, null);
  assert.equal(noLogo.header.logo_requested, false);
  assert.equal(view({ header: null }).header, undefined, "sans en-tête configuré : rendu actuel");
});

test("PDF : en-tête, lignes échappées, logo uniquement en data URI vérifiée, signatures", () => {
  const v = view();
  const logo = `data:image/png;base64,${Buffer.from("png").toString("base64")}`;
  const html = renderPresentationStudent(v, logo);
  assert.match(html, /data-header-logo src="data:image\/png;base64,/);
  assert.match(html, /data-header-title>Bulletin scolaire</);
  assert.match(html, /République &lt;démocratique&gt; du Congo/);
  assert.match(html, /data-header-item="establishment_name"><dt>Établissement<\/dt><dd>Lycée Lumière/);
  assert.match(html, /data-signatures/);
  for (const unsafe of ["https://evil.example/logo.png", "data:text/html;base64,PHNjcmlwdD4=", "javascript:alert(1)"]) {
    assert.doesNotMatch(renderPresentationStudent(v, unsafe), /data-header-logo/, unsafe);
  }
  const legacy = renderPresentationStudent(view({ header: null }));
  assert.doesNotMatch(legacy, /data-header/);
  assert.match(legacy, /<dl class="identity">/);
});

test("assistant : en-tête et signatures conservés dans le gabarit de la configuration", () => {
  const sample = sampleConfiguration(MODEL, "TJ_EX");
  const input = {
    structure: "TJ_EX",
    subjects: sample.profileSpec.subjects.filter((s) => s.components).map((s) => ({ code: s.id, components: s.components })),
    factSources: Object.fromEntries(Object.entries(sample.profileSpec.fact_sources.components).map(([id, c]) => [id, { evaluationTypes: c.evaluation_types, aggregation: c.aggregation }])),
    periods: Object.fromEntries(Object.entries(sample.profileSpec.fact_sources.periods).map(([id, p]) => [id, { termNames: p.term_names }])),
    signatures: ["Le titulaire", "Le parent"],
    header: HEADER,
  };
  const context = {
    schoolId: "s",
    subjects: sample.profileSpec.subjects.map((s) => ({ code: s.id, name: s.id, status: "active", parent_code: s.parent_id || null })),
    evaluationTypes: Object.values(sample.profileSpec.fact_sources.components).flatMap((c) => c.evaluation_types).map((code) => ({ code, status: "active" })),
    terms: Object.values(sample.profileSpec.fact_sources.periods).flatMap((p) => p.term_names),
  };
  const built = buildConfiguration(MODEL, input, context);
  assert.deepEqual(built.templateSpec.presentation.header, { layout: "logo_left", show: HEADER.show, lines: HEADER.lines, title: "Bulletin scolaire" });
  assert.deepEqual(built.templateSpec.presentation.signatures, ["Le titulaire", "Le parent"]);
  assert.doesNotThrow(() => normalizeRenderingTemplate(built.templateSpec));
});

test("migration des logos officiels : jamais exécutée au démarrage, immuable, sans suppression", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const backend = path.resolve(__dirname, "../..");
  for (const rel of ["db/postgresRepository.js", "server.js", "db/repositoryFactory.js", "db/reportCardOfficialIdentityStore.js"]) {
    const file = path.join(backend, rel);
    if (!fs.existsSync(file)) continue;
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /20261106_report_card_official_assets\.sql["'`]|CREATE TABLE IF NOT EXISTS report_card_official_assets/, rel);
  }
  const sql = fs.readFileSync(path.join(backend, "db/migrations/20261106_report_card_official_assets.sql"), "utf8");
  assert.match(sql, /BEFORE UPDATE OR DELETE ON report_card_official_assets/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /BYPASSRLS/);
  const rollback = fs.readFileSync(path.join(backend, "db/migrations/20261106_report_card_official_assets.rollback.sql"), "utf8");
  assert.match(rollback, /OFFICIAL_ASSETS_ROLLBACK_REFUSED/);
});
