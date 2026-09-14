"use strict";

/**
 * LOT 10 — qualification Burundi A/B (même moteur, pas un pack pays).
 * P0-A : oracle canonique figé (fichier expected/), jamais fabriqué par le moteur.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_ID } = require("../../contracts/reportCard/contract");
const { validateSpec: validateProfileSpec, isCalculablePassRule } = require("./academicRuleProfile");
const { validateSpec: validateSchemaSpec, validateAgainstProfile } = require("./reportCardSchema");
const { normalizeRenderingTemplate } = require("./renderingTemplate");
const { computeReportCard } = require("./reportCardEngine");
const { scanEngineSources, scanText } = require("../../contracts/reportCard/noCountrySchoolBranch");
const { canonicalize } = require("../../contracts/reportCard/jcs");

const ROOT = path.resolve(__dirname, "../../..");
const ENGINE_SRC = path.join(__dirname, "reportCardEngine.js");
const CATALOG_DIR = path.join(__dirname, "qualification");
const RUNTIME_SRC = path.join(__dirname, "reportCardQualification.js");

function loadLot10() {
  try {
    return require("./reportCardQualification");
  } catch {
    return null;
  }
}

function requireLot10() {
  const lot10 = loadLot10();
  assert.ok(lot10 && typeof lot10.loadQualification === "function", "RED: reportCardQualification missing");
  return lot10;
}

function catalogFileFor(id) {
  for (const name of fs.readdirSync(CATALOG_DIR)) {
    if (!name.endsWith(".json") || name.includes(".expected.")) continue;
    const abs = path.join(CATALOG_DIR, name);
    const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    if (raw && raw.id === id) return abs;
  }
  return null;
}

function loadStaticGolden(id) {
  const catalogFile = catalogFileFor(id);
  assert.ok(catalogFile, `RED: catalog fixture missing for ${id}`);
  const expectedFile = path.join(CATALOG_DIR, "expected", path.basename(catalogFile));
  assert.equal(fs.existsSync(expectedFile), true, `RED: static golden missing ${path.relative(ROOT, expectedFile)}`);
  const golden = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
  assert.ok(Array.isArray(golden.canonical) && golden.canonical.length > 0, "RED: golden.canonical required");
  assert.ok(
    golden.snapshot &&
      typeof golden.snapshot === "object" &&
      Array.isArray(golden.snapshot.students) &&
      golden.snapshot.students.length > 0,
    `RED: golden.snapshot required ${expectedFile}`
  );
  return { expectedFile, golden };
}

test("report-card-lot10-burundi-a-profile-schema-valid", () => {
  const lot10 = requireLot10();
  const a = lot10.loadQualification(lot10.QUALIFICATION_A);
  assert.equal(a.engine_id, ENGINE_ID);
  assert.equal(a.qualification_only, true);
  assert.equal(a.not_a_country_pack, true);
  const profile = validateProfileSpec(a.profile);
  const schema = validateSchemaSpec(a.schema);
  validateAgainstProfile(schema, profile);
  normalizeRenderingTemplate(a.template);
  assert.equal(isCalculablePassRule(profile), true);
  assert.ok(schema.sections.some((section) => section.kind === "subject_groups"));
  assert.ok(profile.score_components.some((component) => component.id === "COMPONENT_PERIOD"));
});

test("report-card-lot10-burundi-b-profile-schema-valid", () => {
  const lot10 = requireLot10();
  const b = lot10.loadQualification(lot10.QUALIFICATION_B);
  assert.equal(b.engine_id, ENGINE_ID);
  assert.equal(b.qualification_only, true);
  assert.equal(b.not_a_country_pack, true);
  const profile = validateProfileSpec(b.profile);
  const schema = validateSchemaSpec(b.schema);
  validateAgainstProfile(schema, profile);
  normalizeRenderingTemplate(b.template);
  assert.equal(isCalculablePassRule(profile), true);
  assert.ok(schema.sections.some((section) => section.kind === "subject_rows"));
  const ids = profile.score_components.map((component) => component.id);
  assert.ok(ids.includes("TJ"));
  assert.ok(ids.includes("EX"));
  const ex = profile.score_components.find((component) => component.id === "EX");
  assert.equal(ex.applicability.subjects.mode, "per_subject");
});

test("report-card-lot10-canonical-oracle-is-static", () => {
  const lot10 = requireLot10();
  const src = fs.readFileSync(RUNTIME_SRC, "utf8");
  assert.doesNotMatch(src, /computeReportCard/);
  assert.doesNotMatch(src, /DROP SCHEMA/);
  assert.doesNotMatch(src, /CREATE DATABASE/);
  assert.equal(typeof lot10.publishQualificationPg, "undefined");
  assert.equal(src.includes("publishQualificationPg"), false);
  for (const id of [lot10.QUALIFICATION_A, lot10.QUALIFICATION_B]) {
    const { golden } = loadStaticGolden(id);
    const bundle = lot10.loadQualification(id);
    assert.deepEqual(bundle.expected.canonical, golden.canonical);
    assert.deepEqual(bundle.expected.snapshot, golden.snapshot);
    assert.equal(typeof lot10.normalizePublishedSnapshot, "function", "RED: normalizePublishedSnapshot missing");
    const normalized = lot10.normalizePublishedSnapshot({
      ...golden.snapshot,
      published_at: "2099-01-01T00:00:00.000Z",
      report_card_id: "dynamic-id",
      academic_year_id: "dynamic-year",
      class_id: "dynamic-class",
      school_id: "dynamic-school",
    });
    assert.deepEqual(normalized, golden.snapshot);
    assert.equal(Object.prototype.hasOwnProperty.call(normalized, "published_at"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(normalized, "report_card_id"), false);
  }
});

test("report-card-lot10-burundi-a-canonical-result", () => {
  const lot10 = requireLot10();
  const a = lot10.loadQualification(lot10.QUALIFICATION_A);
  const { golden } = loadStaticGolden(lot10.QUALIFICATION_A);
  const computed = computeReportCard({
    profile: a.profile,
    schema: a.schema,
    facts: a.facts,
    provenance: a.provenance,
    tenant: a.tenant,
  });
  assert.equal(computed.engine_id, ENGINE_ID);
  assert.deepEqual(lot10.canonicalResult(computed), golden.canonical);
  assert.deepEqual(a.expected.canonical, golden.canonical);
  assert.ok(computed.students[0].cells.some((cell) => cell.score_component_id === "COMPONENT_PERIOD"));
});

test("report-card-lot10-burundi-b-canonical-result", () => {
  const lot10 = requireLot10();
  const b = lot10.loadQualification(lot10.QUALIFICATION_B);
  const { golden } = loadStaticGolden(lot10.QUALIFICATION_B);
  const computed = computeReportCard({
    profile: b.profile,
    schema: b.schema,
    facts: b.facts,
    provenance: b.provenance,
    tenant: b.tenant,
  });
  assert.equal(computed.engine_id, ENGINE_ID);
  assert.deepEqual(lot10.canonicalResult(computed), golden.canonical);
  assert.deepEqual(b.expected.canonical, golden.canonical);
  const na = computed.students[0].cells.filter((cell) => cell.kind === "NOT_APPLICABLE");
  assert.ok(na.some((cell) => cell.score_component_id === "EX"));
});

test("report-card-lot10-canonical-mismatch-fails", () => {
  const lot10 = requireLot10();
  const a = lot10.loadQualification(lot10.QUALIFICATION_A);
  const { golden } = loadStaticGolden(lot10.QUALIFICATION_A);
  const computed = computeReportCard({
    profile: a.profile,
    schema: a.schema,
    facts: a.facts,
    provenance: a.provenance,
    tenant: a.tenant,
  });
  const drifted = JSON.parse(JSON.stringify(golden.canonical));
  drifted[0].cells[0].internal = Number(drifted[0].cells[0].internal) + 99;
  assert.notDeepEqual(lot10.canonicalResult(computed), drifted);
  assert.throws(() => assert.deepEqual(lot10.canonicalResult(computed), drifted));
});

test("report-card-lot10-a-b-same-engine-no-country-branch", () => {
  const lot10 = requireLot10();
  const a = lot10.loadQualification(lot10.QUALIFICATION_A);
  const b = lot10.loadQualification(lot10.QUALIFICATION_B);
  assert.equal(a.engine_id, b.engine_id);
  assert.equal(a.engine_id, ENGINE_ID);
  const listed = lot10.listQualifications();
  assert.equal(listed.length, 2);
  assert.deepEqual(
    listed.map((row) => row.id).sort(),
    [lot10.QUALIFICATION_A, lot10.QUALIFICATION_B].sort()
  );
  const src = fs.readFileSync(path.join(__dirname, "reportCardQualification.js"), "utf8");
  assert.equal(scanText(src).length, 0);
  assert.doesNotMatch(src, /if\s*\(\s*country/);
  assert.doesNotMatch(src, /country_pack_bi/);
});

test("report-card-lot10-a-b-results-isolated", () => {
  const lot10 = requireLot10();
  const a = lot10.loadQualification(lot10.QUALIFICATION_A);
  const b = lot10.loadQualification(lot10.QUALIFICATION_B);
  const computedA = computeReportCard({
    profile: a.profile,
    schema: a.schema,
    facts: a.facts,
    provenance: a.provenance,
    tenant: a.tenant,
  });
  const computedB = computeReportCard({
    profile: b.profile,
    schema: b.schema,
    facts: b.facts,
    provenance: b.provenance,
    tenant: b.tenant,
  });
  assert.notEqual(canonicalize(lot10.canonicalResult(computedA)), canonicalize(lot10.canonicalResult(computedB)));
  assert.equal(
    computedA.students[0].cells.some((cell) => cell.score_component_id === "TJ"),
    false
  );
  assert.equal(
    computedB.students[0].cells.some((cell) => cell.score_component_id === "COMPONENT_PERIOD"),
    false
  );
});

test("report-card-lot10-no-country-school-branch", () => {
  assert.deepEqual(scanEngineSources(), []);
  const lot10 = requireLot10();
  const catalogDir = path.join(__dirname, "qualification");
  assert.equal(fs.existsSync(catalogDir), true);
  const catalogEntries = [];
  for (const name of fs.readdirSync(catalogDir, { withFileTypes: true })) {
    const full = path.join(catalogDir, name.name);
    if (name.isDirectory()) {
      for (const nested of fs.readdirSync(full)) catalogEntries.push(path.join(full, nested));
    } else {
      catalogEntries.push(full);
    }
  }
  for (const file of catalogEntries) {
    if (!file.endsWith(".json") && !file.endsWith(".js")) continue;
    const src = fs.readFileSync(file, "utf8");
    assert.equal(scanText(src).length, 0, file);
    assert.doesNotMatch(src, /"country"/);
    assert.doesNotMatch(src, /La Colombière/);
  }
  for (const id of [lot10.QUALIFICATION_A, lot10.QUALIFICATION_B]) {
    const bundle = lot10.loadQualification(id);
    assert.equal(JSON.stringify(bundle.profile).includes("country"), false);
    assert.equal(JSON.stringify(bundle.schema).includes("iso_code"), false);
  }
});

test("report-card-lot10-no-engine-special-case", () => {
  const src = fs.readFileSync(ENGINE_SRC, "utf8");
  assert.doesNotMatch(src, /burundi/i);
  assert.doesNotMatch(src, /\bBI\b/);
  assert.doesNotMatch(src, /Colombière/);
  assert.doesNotMatch(src, /country_pack/);
  assert.doesNotMatch(src, /if\s*\(\s*country/);
  assert.equal(scanText(src).length, 0);
});

test("report-card-lot10-no-lot11-plus", () => {
  const forbidden = [
    "backend/lib/reportCard/countryPack.js",
    "backend/lib/reportCard/country_pack_bi.js",
    "web/src/pages/ReportCardCountryPackPage.tsx",
    "Mobile/src/screens/ReportCardCountryPack.tsx",
    "docs/project/REPORT-CARD-LOT11.md",
  ];
  for (const rel of forbidden) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), false, rel);
  }
  const pkg = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
  assert.equal(pkg.includes("verify:report-card-lot11"), false);
});
