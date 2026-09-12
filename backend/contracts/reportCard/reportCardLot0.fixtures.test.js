"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_ID } = require("./contract");

const DIR = path.join(__dirname, "fixtures");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

test("Burundi A and B share the same engine_id (not a country pack)", () => {
  const a = load("burundi-a.json");
  const b = load("burundi-b.json");
  assert.equal(a.engine_id, ENGINE_ID);
  assert.equal(b.engine_id, ENGINE_ID);
  assert.equal(a.engine_id, b.engine_id);
  assert.equal(a.qualification_only, true);
  assert.equal(b.qualification_only, true);
  assert.equal(a.not_a_country_pack, true);
  assert.equal(b.not_a_country_pack, true);
});

test("model A is grouped subjects; model B is TJ/EX/Total with N/A EX", () => {
  const a = load("burundi-a.json");
  const b = load("burundi-b.json");
  assert.equal(a.academic_rule_profile.subject_groups, true);
  assert.equal(a.report_card_schema.layout, "grouped_subjects");
  assert.ok(a.report_card_schema.groups.length >= 2);
  assert.equal(b.academic_rule_profile.subject_groups, false);
  assert.equal(b.report_card_schema.layout, "flat_subject_rows");
  const ids = b.academic_rule_profile.score_components.map((c) => c.id);
  assert.ok(ids.includes("TJ"));
  assert.ok(ids.includes("EX"));
  const ex = b.academic_rule_profile.score_components.find((c) => c.id === "EX");
  assert.equal(ex.applicability, "per_subject");
  assert.equal(b.academic_rule_profile.missing_score, "NOT_APPLICABLE_not_zero");
  assert.equal(a.rendering_template.qr_required, true);
  assert.equal(b.rendering_template.qr_required, true);
});

test("fixtures do not encode country or school branches", () => {
  const raw = fs.readFileSync(path.join(DIR, "burundi-a.json"), "utf8")
    + fs.readFileSync(path.join(DIR, "burundi-b.json"), "utf8");
  assert.doesNotMatch(raw, /if\s*\(\s*country/);
  assert.doesNotMatch(raw, /country_pack_bi/);
  assert.doesNotMatch(raw, /La Colombière/);
});
