"use strict";

/**
 * LOT 10 — catalogue de qualification A/B (runtime).
 * Charge des fixtures versionnées + goldens attendus figés.
 * Aucune branche pays/école, aucun harness PG, aucun appel au moteur.
 */

const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_ID } = require("../../contracts/reportCard/contract");
const { validateSpec: validateProfileSpec, specSha256: profileSpecSha256 } = require("./academicRuleProfile");
const { validateSpec: validateSchemaSpec, specSha256: schemaSpecSha256 } = require("./reportCardSchema");
const { normalizeRenderingTemplate, specSha256: templateSpecSha256 } = require("./renderingTemplate");

const QUALIFICATION_A = "fixture.qualification.burundi-model-a";
const QUALIFICATION_B = "fixture.qualification.burundi-model-b";
const CATALOG_DIR = path.join(__dirname, "qualification");

function catalogFiles() {
  return fs
    .readdirSync(CATALOG_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(CATALOG_DIR, name));
}

function readCatalogEntry(id) {
  for (const file of catalogFiles()) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && raw.id === id) return { raw, file };
  }
  const err = new Error("QUALIFICATION_NOT_FOUND");
  err.code = "QUALIFICATION_NOT_FOUND";
  throw err;
}

function layerRef(base, specSha) {
  return {
    id: String(base.id),
    version: Number(base.version) || 1,
    spec_sha256: specSha,
  };
}

function canonicalCell(cell) {
  return {
    subject_id: cell.subject_id,
    period_id: cell.period_id,
    score_component_id: cell.score_component_id,
    kind: cell.kind,
    internal: cell.internal,
    exposed: cell.exposed,
  };
}

function canonicalSlot(slot) {
  return {
    section_id: slot.section_id,
    column_id: slot.column_id,
    slot: slot.slot,
    period_id: slot.period_id == null ? null : slot.period_id,
    score_component_id: slot.score_component_id == null ? null : slot.score_component_id,
    kind: slot.kind,
    internal: slot.internal,
    exposed: slot.exposed,
    passed: slot.passed == null ? null : slot.passed,
  };
}

function canonicalResult(computedOrPayload) {
  const students = Array.isArray(computedOrPayload?.students) ? computedOrPayload.students : [];
  return students.map((student) => ({
    student_id: student.student_id,
    cells: (Array.isArray(student.cells) ? student.cells : []).map(canonicalCell),
    slots: (Array.isArray(student.slots) ? student.slots : []).map(canonicalSlot),
  }));
}

const SNAPSHOT_DYNAMIC_KEYS = Object.freeze([
  "published_at",
  "report_card_id",
  "academic_year_id",
  "class_id",
  "school_id",
  "public_id",
  "token",
  "token_hash",
  "token_ciphertext",
  "snapshot_signature",
  "snapshot_sha256",
  "canonical_bytes",
  "signing_key_id",
  "wrapping_key_id",
  "verification_status",
]);

function layerFingerprint(ref) {
  if (!ref || typeof ref !== "object") return null;
  return {
    version: ref.version,
    spec_sha256: ref.spec_sha256,
  };
}

function normalizePublishedSnapshot(payload) {
  const clone = JSON.parse(JSON.stringify(payload || {}));
  for (const key of SNAPSHOT_DYNAMIC_KEYS) {
    delete clone[key];
  }
  clone.provenance = {
    profile: layerFingerprint(clone.provenance && clone.provenance.profile),
    schema: layerFingerprint(clone.provenance && clone.provenance.schema),
    template: layerFingerprint(clone.provenance && clone.provenance.template),
  };
  clone.students = Array.isArray(clone.students) ? clone.students : [];
  return clone;
}

function loadExpected(catalogFile) {
  const expectedFile = path.join(path.dirname(catalogFile), "expected", path.basename(catalogFile));
  if (!fs.existsSync(expectedFile)) {
    const err = new Error("QUALIFICATION_EXPECTED_MISSING");
    err.code = "QUALIFICATION_EXPECTED_MISSING";
    throw err;
  }
  const expected = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
  if (!expected || !Array.isArray(expected.canonical) || expected.canonical.length < 1) {
    const err = new Error("QUALIFICATION_EXPECTED_INVALID");
    err.code = "QUALIFICATION_EXPECTED_INVALID";
    throw err;
  }
  if (!expected.snapshot || !Array.isArray(expected.snapshot.students) || expected.snapshot.students.length < 1) {
    const err = new Error("QUALIFICATION_EXPECTED_INVALID");
    err.code = "QUALIFICATION_EXPECTED_INVALID";
    throw err;
  }
  return { canonical: expected.canonical, snapshot: expected.snapshot };
}

function hydrateQualification(raw, catalogFile) {
  const profile = validateProfileSpec(raw.profile);
  const schema = validateSchemaSpec(raw.schema);
  const template = normalizeRenderingTemplate(raw.template);
  const facts = Array.isArray(raw.facts) ? raw.facts.map((row) => ({ ...row })) : [];
  const tenant = {
    schoolId: raw.tenant.schoolId,
    actorSchoolId: raw.tenant.actorSchoolId,
  };
  const provenance = {
    profile: layerRef(raw.provenance.profile, profileSpecSha256(profile)),
    schema: layerRef(raw.provenance.schema, schemaSpecSha256(schema)),
    template: layerRef(raw.provenance.template, templateSpecSha256(template)),
  };
  return {
    id: raw.id,
    title: raw.title,
    engine_id: ENGINE_ID,
    qualification_only: true,
    not_a_country_pack: true,
    modelKey: raw.modelKey,
    profile,
    schema,
    template,
    facts,
    provenance,
    tenant,
    expected: loadExpected(catalogFile),
  };
}

function loadQualification(id) {
  const { raw, file } = readCatalogEntry(id);
  return hydrateQualification(raw, file);
}

function listQualifications() {
  return catalogFiles()
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")))
    .map((raw) => ({
      id: raw.id,
      title: raw.title,
      engine_id: ENGINE_ID,
      qualification_only: true,
      not_a_country_pack: true,
      modelKey: raw.modelKey,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

async function activateQualificationBinding(configuration, schoolId, { modelKey, profile, schema, templateSpec } = {}) {
  const submitter = {
    actorId: "lot10-submit",
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_SUBMIT_MODEL"],
  };
  const approver = {
    actorId: "lot10-approve",
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_SCHOOL_APPROVE_TEMPLATE"],
  };
  const superadmin = {
    actorId: "lot10-sa",
    permissions: ["REPORT_CARD_CONFIGURE"],
    platform: { privileged: true },
  };
  const submitted = await configuration.submitModel({
    actor: submitter,
    schoolId,
    modelKey,
    description: "lot10 qualification bundle",
  });
  await configuration.startReview({ actor: superadmin, schoolId, requestId: submitted.id });
  await configuration.startConfiguring({ actor: superadmin, schoolId, requestId: submitted.id });
  const template = await configuration.saveRenderingTemplate({
    actor: superadmin,
    schoolId,
    requestId: submitted.id,
    spec: templateSpec,
  });
  await configuration.bindBundle({
    actor: superadmin,
    schoolId,
    requestId: submitted.id,
    profile,
    schema,
    template: { id: template.template_id, version: template.version },
  });
  await configuration.markReadyForReview({ actor: superadmin, schoolId, requestId: submitted.id });
  await configuration.approve({ actor: approver, schoolId, requestId: submitted.id });
  const active = await configuration.activate({
    actor: superadmin,
    schoolId,
    requestId: submitted.id,
    commandId: `act-${modelKey}`,
  });
  return { active, template };
}

module.exports = {
  QUALIFICATION_A,
  QUALIFICATION_B,
  SNAPSHOT_DYNAMIC_KEYS,
  loadQualification,
  listQualifications,
  canonicalResult,
  normalizePublishedSnapshot,
  activateQualificationBinding,
};
