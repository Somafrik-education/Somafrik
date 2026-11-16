"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createReportCardReissuePreview } = require("./reportCardReissue");

const tenant = { schoolId: "school-1", actorSchoolId: "school-1" };
function fixture(overrides = {}) {
  const student = { student_id: "stu-1", subject_totals: { status: "COMPLETE", rows: [{ subject_id: "MATH", points: 12 }] }, slots: [{ slot: "TOTAL", exposed: "12" }] };
  const source = {
    report_card_id: "rc-1", school_id: "school-1", class_id: "class-1",
    academic_year_id: "2026-2027", model_key: "school-model", period_scope: "T1",
    provenance: { template: { id: "legacy-template", version: 1 } }, students: [student],
  };
  const draft = {
    publishable: true, draft_sha256: "draft-1", class_id: source.class_id,
    academic_year_id: source.academic_year_id, model_key: source.model_key,
    period_scope: source.period_scope,
    official_identity: { school_name: "School", logo_sha256: null },
    provenance: { template: { id: "new-template", version: 2 } },
    students: [{
      report_card_id: source.report_card_id, student_id: student.student_id,
      status: "COMPLETE", subject_totals: student.subject_totals, slots: student.slots,
    }],
  };
  const calls = { publication: 0, preview: 0, getTemplate: 0, write: 0 };
  const publication = {
    async lookup() { calls.publication++; return { verification_status: "ACTIVE", snapshot_sha256: "signature-hash" }; },
    async payloadForRender() { return structuredClone(source); },
    publish() { calls.write++; throw new Error("write forbidden"); },
  };
  const classPublication = {
    async preview() { calls.preview++; return structuredClone(draft); },
    publish() { calls.write++; throw new Error("write forbidden"); },
  };
  const getTemplate = async () => {
    calls.getTemplate++;
    return { spec: { presentation: { header: { title: "BULLETIN SCOLAIRE" }, signatures: ["Directeur"] } } };
  };
  Object.assign(source, overrides.source || {});
  Object.assign(draft, overrides.draft || {});
  if (overrides.record) publication.lookup = async () => overrides.record;
  if (overrides.template !== undefined) {
    return { calls, source, draft, publication, classPublication, getTemplate: async () => overrides.template };
  }
  return { calls, source, draft, publication, classPublication, getTemplate };
}
function client(world) {
  return createReportCardReissuePreview(world);
}
test("PR0: read-only reissue preview pins active class template, identity and identical grades", async () => {
  const world = fixture();
  const first = await client(world).preview({ tenant, reportCardId: "rc-1", sourceVersion: 1 });
  const second = await client(world).preview({ tenant, reportCardId: "rc-1", sourceVersion: 1 });
  assert.equal(first.official, false);
  assert.equal(first.proposed_version, 2);
  assert.equal(first.header.title, "BULLETIN SCOLAIRE");
  assert.equal(first.changes.grades, false);
  assert.equal(first.expected_draft_sha256, second.expected_draft_sha256);
  assert.equal(world.calls.write, 0, "preview must never mutate the source");
  assert.equal(world.calls.preview, 2);
  assert.equal(first.proposed_template.id, "new-template");
});
test("PR0: rejects cross-tenant before touching any publication", async () => {
  const world = fixture();
  await assert.rejects(client(world).preview({
    tenant: { schoolId: "school-1", actorSchoolId: "school-2" },
    reportCardId: "rc-1", sourceVersion: 1,
  }), { code: "TENANT_MISMATCH" });
  assert.equal(world.calls.publication, 0);
});
test("PR0: refuses inactive historical version", async () => {
  const world = fixture({ record: { verification_status: "SUPERSEDED" } });
  await assert.rejects(client(world).preview({ tenant, reportCardId: "rc-1", sourceVersion: 1 }), { code: "REISSUE_SOURCE_NOT_ACTIVE" });
  assert.equal(world.calls.preview, 0);
});
test("PR0: refuses changed grade cells and missing official header", async () => {
  const changed = fixture();
  changed.draft.students[0].subject_totals = { status: "COMPLETE", rows: [{ subject_id: "MATH", points: 11 }] };
  await assert.rejects(client(changed).preview({ tenant, reportCardId: "rc-1", sourceVersion: 1 }), { code: "REISSUE_GRADES_CHANGED" });
  const missing = fixture({ template: { spec: { presentation: {} } } });
  await assert.rejects(client(missing).preview({ tenant, reportCardId: "rc-1", sourceVersion: 1 }), { code: "REISSUE_HEADER_MISSING" });
  assert.equal(missing.calls.write, 0);
});
test("PR0: rejects missing student or incomplete class, no partial approval", async () => {
  const other = fixture();
  other.draft.students[0].student_id = "different-student";
  await assert.rejects(client(other).preview({ tenant, reportCardId: "rc-1", sourceVersion: 1 }), { code: "REISSUE_STUDENT_MISMATCH" });
  const incomplete = fixture();
  incomplete.draft.publishable = false;
  await assert.rejects(client(incomplete).preview({ tenant, reportCardId: "rc-1", sourceVersion: 1 }), { code: "REPORT_CARD_INCOMPLETE" });
});
