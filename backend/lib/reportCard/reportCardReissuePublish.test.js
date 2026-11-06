"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createReportCardReissuePublisher } = require("./reportCardReissuePublish");

const tenant = { schoolId: "school-A", actorSchoolId: "school-A" };
const actor = { actorId: "director-1" };
const command = {
  tenant, actor, reportCardId: "rc-1", sourceVersion: 1,
  reason: "Nouvel en-tête officiel", commandId: "reissue-cmd-1",
};

function world() {
  const student = {
    student_id: "S-1",
    subject_totals: { status: "COMPLETE", rows: [{ subject_id: "MATH", periods: { T1: { points: 12 } } }] },
    slots: [{ slot: "TOTAL", exposed: "12" }],
    cells: [], presence: [],
  };
  const identity = { school_name: "Institut A", logo_sha256: null };
  const provenance = {
    profile: { id: "profile-2", version: 1, spec_sha256: "a".repeat(64) },
    schema: { id: "schema-2", version: 1, spec_sha256: "b".repeat(64) },
    template: { id: "template-2", version: 2, spec_sha256: "c".repeat(64) },
  };
  const source = {
    report_card_id: "rc-1", school_id: tenant.schoolId, class_id: "class-1",
    academic_year_id: "year-1", model_key: "model-1", period_scope: "T1",
    provenance: { template: { id: "template-1", version: 1 } },
    students: [student],
  };
  const content = {
    school_id: tenant.schoolId, class_id: "class-1",
    academic_year_id: "year-1", model_key: "model-1", period_scope: "T1",
    engine_id: "somafrik.report_card.v1", provenance, official_identity: identity,
  };
  const draft = {
    publishable: true, draft_sha256: "draft-hash",
    class_id: "class-1", academic_year_id: "year-1", model_key: "model-1", period_scope: "T1",
    provenance, official_identity: identity,
    students: [{ report_card_id: "rc-1", student_id: "S-1", status: "COMPLETE", subject_totals: student.subject_totals, slots: student.slots }],
  };
  const state = {
    active: true, writes: [], commands: new Map(), records: [],
    originalSnapshot: JSON.stringify(source),
  };
  const publication = {
    async lookup() { return { verification_status: state.active ? "ACTIVE" : "SUPERSEDED", snapshot_sha256: "signed-1" }; },
    async payloadForRender() { return structuredClone(source); },
    async findCommand({ commandId }) { return state.commands.get(commandId) || null; },
    async findByCommand({ commandId }) { return state.records.find(x => x.commandId === commandId)?.record || null; },
    async publish({ payload, lineage, command }) {
      assert.equal(state.active, true);
      assert.equal(lineage.corrected_from_version, 1);
      assert.equal(command.sourceVersion, 1);
      state.active = false;
      const record = { published_snapshot_version: payload.published_snapshot_version, public_id: "new-qr-token-id" };
      state.writes.push(payload);
      state.records.push({ record, commandId: command.commandId });
      state.commands.set(command.commandId, { reason: command.reason, source_version: command.sourceVersion });
      return record;
    },
  };
  const classPublication = {
    async preview() { return structuredClone(draft); },
    async prepareReissueCandidate() {
      return {
        schoolId: tenant.schoolId, draftSha256: draft.draft_sha256,
        item: {
          report_card_id: "rc-1", student, content,
          content_sha256: "calculated-hash",
        },
        officialLogo: null,
      };
    },
  };
  const getTemplate = async () => ({ spec: { presentation: { header: { title: "Bulletin scolaire" }, signatures: ["Directeur"] } } });
  const svc = createReportCardReissuePublisher({ publication, classPublication, getTemplate });
  return { state, source, draft, classPublication, svc };
}

test("PR1: creates signed v2 intent without ever mutating v1 source; idempotent command replay", async () => {
  const w = world();
  const { createReportCardReissuePreview } = require("./reportCardReissue");
  const proposal = await createReportCardReissuePreview({
    publication: {
      lookup: async () => ({ verification_status: "ACTIVE", snapshot_sha256: "signed-1" }),
      payloadForRender: async () => structuredClone(w.source),
    },
    classPublication: w.classPublication,
    getTemplate: async () => ({ spec: { presentation: { header: { title: "Bulletin scolaire" } } } }),
  }).preview({ tenant, reportCardId: "rc-1", sourceVersion: 1 });
  const args = { ...command, expectedDraftSha256: proposal.expected_draft_sha256 };
  const first = await w.svc.publish(args);
  assert.equal(first.status, "REISSUED");
  assert.equal(first.published_snapshot_version, 2);
  assert.equal(first.public_id, "new-qr-token-id");
  assert.equal(w.state.writes[0].provenance.template.id, "template-2");
  assert.equal(w.state.writes[0].official_identity.school_name, "Institut A");
  assert.equal(w.state.writes[0].students[0].student_id, "S-1");
  assert.equal(w.state.writes[0].published_snapshot_version, 2);
  assert.equal(JSON.stringify(w.source), w.state.originalSnapshot, "v1 source immutable");
  const again = await w.svc.publish(args);
  assert.equal(again.status, "ALREADY_REISSUED");
  assert.equal(again.public_id, first.public_id);
  assert.equal(w.state.writes.length, 1);
  await assert.rejects(w.svc.publish({ ...args, reason: "different reason" }), { code: "REISSUE_COMMAND_CONFLICT" });
});
test("PR1: stale draft hash is rejected before write", async () => {
  const w = world();
  await assert.rejects(w.svc.publish({ ...command, expectedDraftSha256: "stale" }), { code: "DRAFT_CHANGED" });
  assert.equal(w.state.writes.length, 0);
  assert.equal(w.state.active, true);
});
test("PR1: rejects cross-tenant / missing command / source superseded", async () => {
  const w = world();
  await assert.rejects(w.svc.publish({ ...command, expectedDraftSha256: "x", tenant: { schoolId: "school-A", actorSchoolId: "school-B" } }), { code: "TENANT_MISMATCH" });
  await assert.rejects(w.svc.publish({ ...command, expectedDraftSha256: "x", commandId: "" }), { code: "REISSUE_COMMAND_REQUIRED" });
  w.state.active = false;
  await assert.rejects(w.svc.publish({ ...command, expectedDraftSha256: "x" }), { code: "REISSUE_SOURCE_NOT_ACTIVE" });
  assert.equal(w.state.writes.length, 0);
});
