"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_ID, TEMPLATE_REQUEST_STATES, RBAC_TOKENS, PUBLISH } = require("../../contracts/reportCard/contract");
const { canonicalize } = require("../../contracts/reportCard/jcs");
const { scanEngineSources, scanText } = require("../../contracts/reportCard/noCountrySchoolBranch");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { isCalculablePassRule } = require("./academicRuleProfile");

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const ROOT = path.resolve(__dirname, "../../..");

function loadLot6() {
  try {
    return require("./reportCardConfiguration");
  } catch {
    return null;
  }
}

function loadRenderingTemplate() {
  try {
    return require("./renderingTemplate");
  } catch {
    return null;
  }
}

function schoolSubmit(schoolId = SCHOOL_A) {
  return {
    actorId: `submit-${schoolId}`,
    actorSchoolId: schoolId,
    permissions: [RBAC_TOKENS[1]],
  };
}

function schoolApprove(schoolId = SCHOOL_A) {
  return {
    actorId: `approve-${schoolId}`,
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_SCHOOL_APPROVE_TEMPLATE"],
  };
}

function superadmin() {
  return {
    actorId: "superadmin-1",
    permissions: ["REPORT_CARD_CONFIGURE"],
    platform: { privileged: true },
  };
}

function calculableProfile(overrides = {}) {
  return {
    period_mode: "term",
    periods: ["T1", "T2", "T3"],
    annual: true,
    score_components: [
      { id: "TJ", applicability: "always", max: 20, coefficient: 2 },
      { id: "EX", applicability: "per_subject", max: 20 },
    ],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up", stage: "display_only" },
    aggregation: {
      mode: "weighted_sum",
      coefficient_default: 1,
      percentage: "points_over_max_100",
    },
    ranking: { enabled: true, ties: "competition", metric: "PERCENTAGE" },
    pass_rule: { metric: "PERCENTAGE", threshold: 50 },
    ...overrides,
  };
}

function draftProfile(overrides = {}) {
  return {
    periods: ["T1", "T2", "T3"],
    score_components: [
      { id: "TJ", applicability: "always", max: 20, coefficient: 1 },
      { id: "EX", applicability: "per_subject", max: 20, coefficient: 1 },
    ],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up" },
    ranking: { enabled: true, ties: "competition" },
    pass_rule: { min_average: 10 },
    ...overrides,
  };
}

function compatibleSchema(overrides = {}) {
  return {
    sections: [
      {
        id: "IDENTITY",
        order: 1,
        kind: "identity",
        columns: [{ id: "STUDENT_NAME", order: 1, kind: "identity" }],
      },
      {
        id: "SUBJECTS",
        order: 2,
        kind: "subject_rows",
        rows: [{ id: "SUBJECT_LINE", order: 1, kind: "subject" }],
        columns: [
          { id: "COL_TJ", order: 1, kind: "score_component", score_component_id: "TJ" },
          { id: "COL_EX", order: 2, kind: "score_component", score_component_id: "EX" },
          { id: "COL_T1", order: 3, kind: "period", period_id: "T1" },
          { id: "COL_TOTAL", order: 4, kind: "computed_slot", slot: "TOTAL" },
        ],
      },
      {
        id: "RANK",
        order: 3,
        kind: "rank",
        columns: [{ id: "COL_RANK", order: 1, kind: "computed_slot", slot: "RANK" }],
      },
      {
        id: "DECISION",
        order: 4,
        kind: "decision",
        columns: [{ id: "COL_DECISION", order: 1, kind: "computed_slot", slot: "DECISION" }],
      },
    ],
    identity_fields: [{ id: "STUDENT_NAME", order: 1 }],
    metadata_fields: [{ id: "SCHOOL_YEAR", order: 1 }],
    ...overrides,
  };
}

function validTemplate(overrides = {}) {
  return {
    paper: "A4",
    orientation: "portrait",
    qr_required: true,
    sections: [
      { id: "SUMMARY", order: 1, label: "Totaux", source: "slots" },
      { id: "SUBJECTS", order: 2, label: "Disciplines", source: "cells" },
      { id: "APPLICABILITY", order: 3, label: "Presence", source: "presence" },
    ],
    ...overrides,
  };
}

function world() {
  const lot6 = loadLot6();
  assert.ok(lot6 && typeof lot6.createReportCardConfiguration === "function", "LOT 6 configuration missing (RED)");
  const profileStore = createAcademicRuleProfileStore();
  const schemaStore = createReportCardSchemaStore();
  const sideEffects = [];
  const api = lot6.createReportCardConfiguration({
    profileStore,
    schemaStore,
    clock: { now: () => "2026-09-13T12:00:00.000Z" },
    publication: {
      publish: async () => {
        sideEffects.push("publish");
        return { status: "PUBLISHED" };
      },
    },
    pdf: {
      render: async () => {
        sideEffects.push("pdf");
        return { pdf: Buffer.from("%PDF") };
      },
    },
    tokenMint: {
      generateToken: () => {
        sideEffects.push("mint");
        return "token";
      },
    },
  });
  return { api, profileStore, schemaStore, sideEffects, lot6 };
}

function seedBundle(profileStore, schemaStore, schoolId, profileSpec = calculableProfile()) {
  const createdP = profileStore.createProfile({
    schoolId,
    actorSchoolId: schoolId,
    profileKey: `core-${crypto.randomUUID()}`,
    spec: profileSpec,
    activate: true,
  });
  const createdS = schemaStore.createSchema({
    schoolId,
    actorSchoolId: schoolId,
    schemaKey: `core-${crypto.randomUUID()}`,
    spec: compatibleSchema(),
    activate: true,
  });
  return {
    profile: { id: createdP.profile.id, version: createdP.version.version },
    schema: { id: createdS.schema.id, version: createdS.version.version },
    profileRow: createdP.version,
    schemaRow: createdS.version,
  };
}

async function toConfiguring(api, { schoolId = SCHOOL_A, modelKey = "trimestriel" } = {}) {
  const submitted = await api.submitModel({
    actor: schoolSubmit(schoolId),
    schoolId,
    modelKey,
    description: "modele A4 generique",
  });
  await api.startReview({ actor: superadmin(), schoolId, requestId: submitted.id });
  return api.startConfiguring({ actor: superadmin(), schoolId, requestId: submitted.id });
}

async function bindValidBundle(api, profileStore, schemaStore, request, schoolId = SCHOOL_A) {
  const refs = seedBundle(profileStore, schemaStore, schoolId);
  const template = await api.saveRenderingTemplate({
    actor: superadmin(),
    schoolId,
    requestId: request.id,
    spec: validTemplate(),
  });
  await api.bindBundle({
    actor: superadmin(),
    schoolId,
    requestId: request.id,
    profile: refs.profile,
    schema: refs.schema,
    template: { id: template.template_id, version: template.version },
  });
  return { ...refs, template };
}

async function toReady(api, profileStore, schemaStore, opts = {}) {
  const request = await toConfiguring(api, opts);
  await bindValidBundle(api, profileStore, schemaStore, request, opts.schoolId || SCHOOL_A);
  return api.markReadyForReview({
    actor: superadmin(),
    schoolId: opts.schoolId || SCHOOL_A,
    requestId: request.id,
  });
}

async function toApproved(api, profileStore, schemaStore, opts = {}) {
  const ready = await toReady(api, profileStore, schemaStore, opts);
  const schoolId = opts.schoolId || SCHOOL_A;
  return api.approve({
    actor: schoolApprove(schoolId),
    schoolId,
    requestId: ready.id,
  });
}

function code(err, expected) {
  return Boolean(err && expected.includes(err.code));
}

test("report-card-lot6-submit-model-tenant-scoped", async () => {
  const { api } = world();
  const created = await api.submitModel({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    modelKey: "trimestriel",
    description: "modele A4",
  });
  assert.ok(created.id);
  assert.equal(created.school_id, SCHOOL_A);
  assert.equal(created.model_key, "trimestriel");
  assert.equal(created.status, "SUBMITTED");
  assert.ok(TEMPLATE_REQUEST_STATES.includes(created.status));
  assert.equal(created.created_at, "2026-09-13T12:00:00.000Z");
  await assert.rejects(
    () =>
      api.submitModel({
        actor: schoolSubmit(SCHOOL_A),
        schoolId: SCHOOL_B,
        modelKey: "trimestriel",
      }),
    (err) => code(err, ["TENANT_MISMATCH", "RBAC_DENIED"])
  );
  await assert.rejects(
    () => api.getRequest({ actor: schoolSubmit(SCHOOL_B), schoolId: SCHOOL_B, requestId: created.id }),
    (err) => code(err, ["REQUEST_NOT_FOUND", "TENANT_MISMATCH"])
  );
  const listedB = await api.listRequests({ actor: schoolSubmit(SCHOOL_B), schoolId: SCHOOL_B });
  assert.equal(listedB.some((row) => row.id === created.id), false);
});

test("report-card-lot6-submit-requires-rbac", async () => {
  const { api } = world();
  await assert.rejects(
    () =>
      api.submitModel({
        actor: { actorId: "no-perm", actorSchoolId: SCHOOL_A, permissions: [] },
        schoolId: SCHOOL_A,
        modelKey: "trimestriel",
      }),
    (err) => err && err.code === "RBAC_DENIED"
  );
  await assert.rejects(
    () =>
      api.submitModel({
        actor: schoolApprove(SCHOOL_A),
        schoolId: SCHOOL_A,
        modelKey: "trimestriel",
      }),
    (err) => err && err.code === "RBAC_DENIED"
  );
});

test("report-card-lot6-school-cannot-configure", async () => {
  const { api } = world();
  const submitted = await api.submitModel({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    modelKey: "trimestriel",
  });
  await assert.rejects(
    () => api.startReview({ actor: schoolSubmit(SCHOOL_A), schoolId: SCHOOL_A, requestId: submitted.id }),
    (err) => err && err.code === "RBAC_DENIED"
  );
  await assert.rejects(
    () => api.startConfiguring({ actor: schoolApprove(SCHOOL_A), schoolId: SCHOOL_A, requestId: submitted.id }),
    (err) => err && err.code === "RBAC_DENIED"
  );
  await assert.rejects(
    () => api.activate({ actor: schoolSubmit(SCHOOL_A), schoolId: SCHOOL_A, requestId: submitted.id }),
    (err) => code(err, ["RBAC_DENIED", "INVALID_TRANSITION"])
  );
});

test("report-card-lot6-superadmin-configure-requires-rbac", async () => {
  const { api } = world();
  const submitted = await api.submitModel({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    modelKey: "trimestriel",
  });
  await assert.rejects(
    () =>
      api.startReview({
        actor: { actorId: "sa-no", permissions: [], platform: { privileged: true } },
        schoolId: SCHOOL_A,
        requestId: submitted.id,
      }),
    (err) => err && err.code === "RBAC_DENIED"
  );
  await assert.rejects(
    () =>
      api.startReview({
        actor: { actorId: "sa-no-platform", permissions: ["REPORT_CARD_CONFIGURE"] },
        schoolId: SCHOOL_A,
        requestId: submitted.id,
      }),
    (err) => code(err, ["RBAC_DENIED", "PLATFORM_CONTEXT_REQUIRED"])
  );
});

test("report-card-lot6-valid-state-transitions", async () => {
  const { api, profileStore, schemaStore } = world();
  const submitted = await api.submitModel({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    modelKey: "annuel",
  });
  assert.equal(submitted.status, "SUBMITTED");
  const reviewed = await api.startReview({ actor: superadmin(), schoolId: SCHOOL_A, requestId: submitted.id });
  assert.equal(reviewed.status, "UNDER_REVIEW");
  const configuring = await api.startConfiguring({ actor: superadmin(), schoolId: SCHOOL_A, requestId: submitted.id });
  assert.equal(configuring.status, "CONFIGURING");
  await bindValidBundle(api, profileStore, schemaStore, configuring);
  const ready = await api.markReadyForReview({ actor: superadmin(), schoolId: SCHOOL_A, requestId: submitted.id });
  assert.equal(ready.status, "READY_FOR_REVIEW");
  const approved = await api.approve({ actor: schoolApprove(SCHOOL_A), schoolId: SCHOOL_A, requestId: submitted.id });
  assert.equal(approved.status, "APPROVED");
  const active = await api.activate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: submitted.id,
    commandId: "act-1",
  });
  assert.equal(active.status, "ACTIVE");
  assert.equal(active.engine_id, ENGINE_ID);

  const other = await api.submitModel({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    modelKey: "reject-path",
  });
  const rejected = await api.reject({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: other.id,
    reason: "hors contrat",
  });
  assert.equal(rejected.status, "REJECTED");
});

test("report-card-lot6-invalid-transition-fails-closed", async () => {
  const { api, profileStore, schemaStore } = world();
  const submitted = await api.submitModel({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    modelKey: "locked",
  });
  const before = await api.getRequest({ actor: schoolSubmit(SCHOOL_A), schoolId: SCHOOL_A, requestId: submitted.id });
  await assert.rejects(
    () => api.markReadyForReview({ actor: superadmin(), schoolId: SCHOOL_A, requestId: submitted.id }),
    (err) => err && err.code === "INVALID_TRANSITION"
  );
  await assert.rejects(
    () => api.approve({ actor: schoolApprove(SCHOOL_A), schoolId: SCHOOL_A, requestId: submitted.id }),
    (err) => err && err.code === "INVALID_TRANSITION"
  );
  const after = await api.getRequest({ actor: schoolSubmit(SCHOOL_A), schoolId: SCHOOL_A, requestId: submitted.id });
  assert.equal(after.status, "SUBMITTED");
  assert.equal(after.concurrency_version, before.concurrency_version);

  const approved = await toApproved(api, profileStore, schemaStore, { modelKey: "term-ok" });
  await api.activate({ actor: superadmin(), schoolId: SCHOOL_A, requestId: approved.id, commandId: "act-ok" });
  await assert.rejects(
    () => api.startReview({ actor: superadmin(), schoolId: SCHOOL_A, requestId: approved.id }),
    (err) => err && err.code === "INVALID_TRANSITION"
  );

  const rejected = await api.submitModel({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    modelKey: "dead",
  });
  await api.reject({ actor: superadmin(), schoolId: SCHOOL_A, requestId: rejected.id, reason: "stop" });
  await assert.rejects(
    () => api.startReview({ actor: superadmin(), schoolId: SCHOOL_A, requestId: rejected.id }),
    (err) => err && err.code === "INVALID_TRANSITION"
  );
  const stillRejected = await api.getRequest({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: rejected.id,
  });
  assert.equal(stillRejected.status, "REJECTED");
});

test("report-card-lot6-ready-for-review-requires-valid-bundle", async () => {
  const { api, profileStore, schemaStore } = world();
  const configuring = await toConfiguring(api, { modelKey: "need-bundle" });
  await assert.rejects(
    () => api.markReadyForReview({ actor: superadmin(), schoolId: SCHOOL_A, requestId: configuring.id }),
    (err) => code(err, ["INVALID_BUNDLE", "RENDERING_TEMPLATE_REQUIRED"])
  );

  const draft = seedBundle(profileStore, schemaStore, SCHOOL_A, draftProfile());
  assert.equal(isCalculablePassRule(draft.profileRow.spec), false);
  const template = await api.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: configuring.id,
    spec: validTemplate(),
  });
  await assert.rejects(
    () =>
      api.bindBundle({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: configuring.id,
        profile: draft.profile,
        schema: draft.schema,
        template: { id: template.template_id, version: template.version },
      }),
    (err) => code(err, ["INVALID_BUNDLE", "PROFILE_NOT_CALCULABLE"])
  );

  const ok = seedBundle(profileStore, schemaStore, SCHOOL_A);
  await assert.rejects(
    () =>
      api.bindBundle({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: configuring.id,
        profile: { id: ok.profile.id, version: 99 },
        schema: ok.schema,
        template: { id: template.template_id, version: template.version },
      }),
    (err) => code(err, ["INVALID_BUNDLE", "VERSION_NOT_FOUND"])
  );

  const ready = await toReady(api, profileStore, schemaStore, { modelKey: "no-live" });
  assert.equal(ready.status, "READY_FOR_REVIEW");
  assert.equal(ready.facts, undefined);
  assert.equal(ready.students, undefined);
});

test("report-card-lot6-school-approve-own-request-only", async () => {
  const { api, profileStore, schemaStore } = world();
  const ready = await toReady(api, profileStore, schemaStore, { modelKey: "own-only" });
  await assert.rejects(
    () => api.approve({ actor: schoolApprove(SCHOOL_B), schoolId: SCHOOL_A, requestId: ready.id }),
    (err) => code(err, ["TENANT_MISMATCH", "RBAC_DENIED"])
  );
  await assert.rejects(
    () => api.approve({ actor: schoolApprove(SCHOOL_B), schoolId: SCHOOL_B, requestId: ready.id }),
    (err) => code(err, ["REQUEST_NOT_FOUND", "TENANT_MISMATCH"])
  );
  await assert.rejects(
    () => api.approve({ actor: schoolSubmit(SCHOOL_A), schoolId: SCHOOL_A, requestId: ready.id }),
    (err) => err && err.code === "RBAC_DENIED"
  );
  const approved = await api.approve({
    actor: schoolApprove(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ready.id,
  });
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.school_id, SCHOOL_A);
});

test("report-card-lot6-changes-requested-roundtrip", async () => {
  const { api, profileStore, schemaStore } = world();
  const ready = await toReady(api, profileStore, schemaStore, { modelKey: "roundtrip" });
  const changes = await api.requestChanges({
    actor: schoolApprove(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ready.id,
    comment: "section totaux trop dense",
  });
  assert.equal(changes.status, "CHANGES_REQUESTED");
  const again = await api.resumeConfiguring({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ready.id,
  });
  assert.equal(again.status, "CONFIGURING");
  const ready2 = await api.markReadyForReview({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ready.id,
  });
  assert.equal(ready2.status, "READY_FOR_REVIEW");
  const approved = await api.approve({
    actor: schoolApprove(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ready.id,
  });
  assert.equal(approved.status, "APPROVED");
});

test("report-card-lot6-rendering-template-jcs-sha256", async () => {
  const rt = loadRenderingTemplate();
  assert.ok(rt && typeof rt.normalizeRenderingTemplate === "function" && typeof rt.specSha256 === "function", "LOT 6 renderingTemplate missing (RED)");
  const left = rt.normalizeRenderingTemplate({
    sections: validTemplate().sections,
    qr_required: true,
    orientation: "portrait",
    paper: "A4",
  });
  const right = rt.normalizeRenderingTemplate({
    paper: "A4",
    orientation: "portrait",
    qr_required: true,
    sections: validTemplate().sections,
  });
  assert.equal(rt.specSha256(left), rt.specSha256(right));
  const expected = crypto.createHash("sha256").update(canonicalize(left), "utf8").digest("hex");
  assert.equal(rt.specSha256(left), expected);
  assert.match(expected, /^[a-f0-9]{64}$/);
});

test("report-card-lot6-rendering-template-version-immutable", async () => {
  const { api, profileStore, schemaStore } = world();
  const configuring = await toConfiguring(api, { modelKey: "immut" });
  const saved = await api.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: configuring.id,
    spec: validTemplate(),
  });
  const refs = seedBundle(profileStore, schemaStore, SCHOOL_A);
  await api.bindBundle({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: configuring.id,
    profile: refs.profile,
    schema: refs.schema,
    template: { id: saved.template_id, version: saved.version },
  });
  await api.markReadyForReview({ actor: superadmin(), schoolId: SCHOOL_A, requestId: configuring.id });
  await assert.rejects(
    () =>
      api.updateRenderingTemplateSpec({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        templateId: saved.template_id,
        version: saved.version,
        spec: validTemplate({ sections: [{ id: "ONLY", order: 1, label: "Mut", source: "cells" }] }),
      }),
    (err) => err && err.code === "VERSION_IMMUTABLE"
  );
  const frozen = await api.getRenderingTemplateVersion({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    templateId: saved.template_id,
    version: saved.version,
  });
  assert.equal(frozen.spec_sha256, saved.spec_sha256);
  assert.notEqual(frozen.status, "DRAFT");
});

test("report-card-lot6-rendering-template-reuses-lot5-validator", async () => {
  const rt = loadRenderingTemplate();
  assert.ok(rt && typeof rt.normalizeRenderingTemplate === "function", "LOT 6 renderingTemplate missing (RED)");
  const pdf = require("./reportCardPdf");
  assert.equal(pdf.normalizeRenderingTemplate, rt.normalizeRenderingTemplate);
  assert.equal(rt.normalizeRenderingTemplate(validTemplate()).paper, "A4");
  assert.throws(
    () => rt.normalizeRenderingTemplate(null),
    (err) => err && err.code === "RENDERING_TEMPLATE_REQUIRED"
  );
  assert.throws(
    () => rt.normalizeRenderingTemplate(validTemplate({ qr_required: false })),
    (err) => err && err.code === "QR_REQUIRED"
  );
  assert.throws(
    () => rt.normalizeRenderingTemplate({}),
    (err) => err && (err.code === "RENDERING_TEMPLATE_INVALID" || err.code === "RENDERING_TEMPLATE_REQUIRED")
  );
});

test("report-card-lot6-profile-schema-template-compatible", async () => {
  const { api, profileStore, schemaStore } = world();
  const configuring = await toConfiguring(api, { modelKey: "compat" });
  const ok = seedBundle(profileStore, schemaStore, SCHOOL_A);
  const template = await api.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: configuring.id,
    spec: validTemplate(),
  });
  const bound = await api.bindBundle({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: configuring.id,
    profile: ok.profile,
    schema: ok.schema,
    template: { id: template.template_id, version: template.version },
  });
  assert.equal(bound.engine_id, ENGINE_ID);
  assert.ok(bound.profile_spec_sha256);
  assert.ok(bound.schema_spec_sha256);
  assert.ok(bound.rendering_template_spec_sha256);

  const badSchema = schemaStore.createSchema({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaKey: `bad-${crypto.randomUUID()}`,
    spec: compatibleSchema({
      sections: [
        {
          id: "SUBJECTS",
          order: 1,
          kind: "subject_rows",
          columns: [{ id: "COL_T9", order: 1, kind: "period", period_id: "T9" }],
        },
      ],
    }),
    activate: true,
  });
  const other = await toConfiguring(api, { modelKey: "incompat" });
  const otherTemplate = await api.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: other.id,
    spec: validTemplate(),
  });
  await assert.rejects(
    () =>
      api.bindBundle({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: other.id,
        profile: ok.profile,
        schema: { id: badSchema.schema.id, version: badSchema.version.version },
        template: { id: otherTemplate.template_id, version: otherTemplate.version },
      }),
    (err) => code(err, ["INVALID_BUNDLE", "INVALID_PROFILE_REFERENCE"])
  );
  await assert.rejects(
    () =>
      api.saveRenderingTemplate({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: other.id,
        spec: validTemplate({ school: "x" }),
      }),
    (err) => err && err.code === "COUNTRY_SCHOOL_BRANCH_FORBIDDEN"
  );
});

test("report-card-lot6-bundle-rejects-mutable-draft-versions", async () => {
  const { api, profileStore, schemaStore } = world();
  const configuring = await toConfiguring(api, { modelKey: "draft-prof" });
  const draftProf = profileStore.createProfile({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileKey: `draft-p-${crypto.randomUUID()}`,
    spec: calculableProfile(),
    activate: false,
  });
  assert.equal(draftProf.version.status, "DRAFT");
  const frozenSchema = schemaStore.createSchema({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaKey: `ok-s-${crypto.randomUUID()}`,
    spec: compatibleSchema(),
    activate: true,
  });
  const template = await api.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: configuring.id,
    spec: validTemplate(),
  });
  await assert.rejects(
    () =>
      api.bindBundle({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: configuring.id,
        profile: { id: draftProf.profile.id, version: draftProf.version.version },
        schema: { id: frozenSchema.schema.id, version: frozenSchema.version.version },
        template: { id: template.template_id, version: template.version },
      }),
    (err) => err && err.code === "BUNDLE_VERSION_MUTABLE"
  );

  const frozenProf = profileStore.createProfile({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileKey: `ok-p-${crypto.randomUUID()}`,
    spec: calculableProfile(),
    activate: true,
  });
  const draftSchema = schemaStore.createSchema({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaKey: `draft-s-${crypto.randomUUID()}`,
    spec: compatibleSchema(),
    activate: false,
  });
  assert.equal(draftSchema.version.status, "DRAFT");
  const configuringSchema = await toConfiguring(api, { modelKey: "draft-schema" });
  const template2 = await api.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: configuringSchema.id,
    spec: validTemplate(),
  });
  await assert.rejects(
    () =>
      api.bindBundle({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: configuringSchema.id,
        profile: { id: frozenProf.profile.id, version: frozenProf.version.version },
        schema: { id: draftSchema.schema.id, version: draftSchema.version.version },
        template: { id: template2.template_id, version: template2.version },
      }),
    (err) => err && err.code === "BUNDLE_VERSION_MUTABLE"
  );

  const approved = await toApproved(api, profileStore, schemaStore, { modelKey: "frozen-active" });
  const active = await api.activate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: approved.id,
    commandId: "frozen-1",
  });
  assert.equal(active.status, "ACTIVE");
  assert.throws(
    () =>
      profileStore.updateDraftSpec({
        schoolId: SCHOOL_A,
        actorSchoolId: SCHOOL_A,
        profileId: active.profile_id,
        version: active.profile_version,
        spec: calculableProfile({ rounding: { decimals: 1, mode: "half_up", stage: "display_only" } }),
      }),
    (err) => err && err.code === "VERSION_IMMUTABLE"
  );
  assert.throws(
    () =>
      schemaStore.updateDraftSpec({
        schoolId: SCHOOL_A,
        actorSchoolId: SCHOOL_A,
        schemaId: active.schema_id,
        version: active.schema_version,
        spec: compatibleSchema({ metadata_fields: [{ id: "SCHOOL_YEAR", order: 1 }, { id: "CLASS_ID", order: 2 }] }),
      }),
    (err) => err && err.code === "VERSION_IMMUTABLE"
  );
  await assert.rejects(
    () =>
      api.updateRenderingTemplateSpec({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        templateId: active.rendering_template_id,
        version: active.rendering_template_version,
        spec: validTemplate({ sections: [{ id: "ONLY", order: 1, label: "Mut", source: "cells" }] }),
      }),
    (err) => err && err.code === "VERSION_IMMUTABLE"
  );
  const binding = await api.getActiveBinding({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    modelKey: "frozen-active",
  });
  assert.equal(binding.profile_spec_sha256, active.profile_spec_sha256);
  assert.equal(binding.schema_spec_sha256, active.schema_spec_sha256);
  assert.equal(binding.rendering_template_spec_sha256, active.rendering_template_spec_sha256);
});

test("report-card-lot6-activation-atomic", async () => {
  const { api, profileStore, schemaStore } = world();
  const approved = await toApproved(api, profileStore, schemaStore, { modelKey: "atomic" });
  const active = await api.activate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: approved.id,
    commandId: "atomic-1",
  });
  assert.equal(active.status, "ACTIVE");
  assert.equal(active.engine_id, ENGINE_ID);
  assert.ok(active.profile_id && Number.isInteger(active.profile_version));
  assert.ok(active.schema_id && Number.isInteger(active.schema_version));
  assert.ok(active.rendering_template_id && Number.isInteger(active.rendering_template_version));
  assert.match(active.profile_spec_sha256, /^[a-f0-9]{64}$/);
  assert.match(active.schema_spec_sha256, /^[a-f0-9]{64}$/);
  assert.match(active.rendering_template_spec_sha256, /^[a-f0-9]{64}$/);
  const binding = await api.getActiveBinding({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    modelKey: "atomic",
  });
  assert.equal(binding.request_id, active.id);
  assert.equal(binding.engine_id, ENGINE_ID);
  assert.equal(binding.profile_id, active.profile_id);
  assert.equal(binding.schema_id, active.schema_id);
  assert.equal(binding.rendering_template_id, active.rendering_template_id);
});

test("report-card-lot6-lookup-active-binding-no-actor-fail-closed", async () => {
  const { api, profileStore, schemaStore } = world();
  const approved = await toApproved(api, profileStore, schemaStore, { modelKey: "lookup" });
  const active = await api.activate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: approved.id,
    commandId: "lookup-1",
  });
  const row = await api.lookupActiveBinding({ schoolId: SCHOOL_A, modelKey: "lookup" });
  assert.equal(row.request_id, active.id);
  assert.equal(row.profile_id, active.profile_id);
  assert.equal(row.profile_version, active.profile_version);
  assert.equal(row.profile_spec_sha256, active.profile_spec_sha256);
  assert.equal(row.schema_id, active.schema_id);
  assert.equal(row.schema_version, active.schema_version);
  assert.equal(row.schema_spec_sha256, active.schema_spec_sha256);
  assert.equal(row.rendering_template_id, active.rendering_template_id);
  assert.equal(row.rendering_template_version, active.rendering_template_version);
  assert.equal(row.rendering_template_spec_sha256, active.rendering_template_spec_sha256);
  assert.equal(await api.lookupActiveBinding({ schoolId: SCHOOL_A, modelKey: "missing" }), null);
  assert.equal(await api.lookupActiveBinding({ schoolId: SCHOOL_A, modelKey: "BAD KEY" }), null);
});

test("report-card-lot6-one-active-per-school-model-key", async () => {
  const { api, profileStore, schemaStore } = world();
  const first = await toApproved(api, profileStore, schemaStore, { modelKey: "shared" });
  await api.activate({ actor: superadmin(), schoolId: SCHOOL_A, requestId: first.id, commandId: "shared-1" });
  const second = await toApproved(api, profileStore, schemaStore, { modelKey: "shared" });
  const replacement = await api.activate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: second.id,
    commandId: "shared-2",
  });
  assert.equal(replacement.status, "ACTIVE");
  const archived = await api.getRequest({ actor: superadmin(), schoolId: SCHOOL_A, requestId: first.id });
  assert.equal(archived.status, "ARCHIVED");
  const binding = await api.getActiveBinding({ actor: superadmin(), schoolId: SCHOOL_A, modelKey: "shared" });
  assert.equal(binding.request_id, second.id);
  const otherModel = await toApproved(api, profileStore, schemaStore, { modelKey: "other" });
  const otherActive = await api.activate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: otherModel.id,
    commandId: "other-1",
  });
  assert.equal(otherActive.status, "ACTIVE");
  const still = await api.getActiveBinding({ actor: superadmin(), schoolId: SCHOOL_A, modelKey: "shared" });
  assert.equal(still.request_id, second.id);
});

test("report-card-lot6-activation-idempotent", async () => {
  const { api, profileStore, schemaStore } = world();
  const approved = await toApproved(api, profileStore, schemaStore, { modelKey: "idem" });
  const first = await api.activate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: approved.id,
    commandId: "idem-1",
  });
  const retry = await api.activate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: approved.id,
    commandId: "idem-1",
  });
  assert.equal(retry.id, first.id);
  assert.equal(retry.status, "ACTIVE");
  assert.equal(retry.profile_spec_sha256, first.profile_spec_sha256);
  const listed = await api.listRequests({ actor: superadmin(), schoolId: SCHOOL_A });
  assert.equal(listed.filter((row) => row.status === "ACTIVE" && row.model_key === "idem").length, 1);
});

test("report-card-lot6-cross-tenant-read-write-forbidden", async () => {
  const { api, profileStore, schemaStore } = world();
  const approved = await toApproved(api, profileStore, schemaStore, { modelKey: "iso" });
  await assert.rejects(
    () => api.getRequest({ actor: schoolSubmit(SCHOOL_B), schoolId: SCHOOL_A, requestId: approved.id }),
    (err) => code(err, ["TENANT_MISMATCH", "RBAC_DENIED"])
  );
  await assert.rejects(
    () => api.getRequest({ actor: schoolSubmit(SCHOOL_B), requestId: approved.id }),
    (err) => code(err, ["TENANT_REQUIRED", "TENANT_MISMATCH", "REQUEST_NOT_FOUND"])
  );
  await assert.rejects(
    () =>
      api.activate({
        actor: schoolSubmit(SCHOOL_B),
        schoolId: SCHOOL_B,
        requestId: approved.id,
        commandId: "steal",
      }),
    (err) => code(err, ["RBAC_DENIED", "REQUEST_NOT_FOUND", "TENANT_MISMATCH"])
  );
  const still = await api.getRequest({ actor: schoolSubmit(SCHOOL_A), schoolId: SCHOOL_A, requestId: approved.id });
  assert.equal(still.status, "APPROVED");
});

test("report-card-lot6-superadmin-cross-tenant-explicit-audited", async () => {
  const { api, profileStore, schemaStore } = world();
  const ready = await toReady(api, profileStore, schemaStore, { modelKey: "x-tenant" });
  const approved = await api.approve({
    actor: schoolApprove(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ready.id,
  });
  const active = await api.activate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: approved.id,
    commandId: "x-1",
  });
  assert.equal(active.school_id, SCHOOL_A);
  const audit = await api.listAudit({ actor: superadmin(), schoolId: SCHOOL_A, requestId: approved.id });
  const activation = audit.find((row) => row.to_state === "ACTIVE");
  assert.ok(activation);
  assert.equal(activation.school_id, SCHOOL_A);
  assert.equal(activation.actor_id, "superadmin-1");
  assert.equal(activation.permission, "REPORT_CARD_CONFIGURE");
  await assert.rejects(
    () =>
      api.startReview({
        actor: {
          actorId: "spoof",
          actorSchoolId: SCHOOL_A,
          permissions: ["REPORT_CARD_CONFIGURE"],
        },
        schoolId: SCHOOL_A,
        requestId: approved.id,
      }),
    (err) => code(err, ["RBAC_DENIED", "PLATFORM_CONTEXT_REQUIRED", "INVALID_TRANSITION"])
  );
});

test("report-card-lot6-audit-append-only", async () => {
  const { api, profileStore, schemaStore } = world();
  const ready = await toReady(api, profileStore, schemaStore, { modelKey: "audit" });
  await api.requestChanges({
    actor: schoolApprove(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ready.id,
    comment: "revoir totaux",
  });
  const audit = await api.listAudit({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ready.id });
  assert.ok(audit.length >= 5);
  const copy = audit.map((row) => row.id);
  assert.equal(typeof api.deleteAudit, "undefined");
  if (typeof api.rewriteAudit === "function") {
    await assert.rejects(() => api.rewriteAudit({ requestId: ready.id }), (err) => err && err.code === "AUDIT_IMMUTABLE");
  }
  const again = await api.listAudit({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ready.id });
  assert.deepEqual(
    again.map((row) => row.id),
    copy
  );
  assert.equal(again[0].from_state, null);
  assert.equal(again[0].to_state, "SUBMITTED");
  assert.ok(again.every((row) => row.school_id === SCHOOL_A && row.request_id === ready.id && row.created_at));
  const comment = again.find((row) => row.to_state === "CHANGES_REQUESTED");
  assert.equal(comment.reason, "revoir totaux");
  assert.equal(comment.permission, "REPORT_CARD_SCHOOL_APPROVE_TEMPLATE");
});

test("report-card-lot6-no-country-school-branch", async () => {
  const hits = scanEngineSources();
  assert.equal(hits.length, 0, JSON.stringify(hits));
  const files = [
    "backend/lib/reportCard/reportCardConfiguration.js",
    "backend/lib/reportCard/renderingTemplate.js",
    "backend/db/reportCardConfigurationSql.js",
    "backend/db/reportCardConfigurationPgStore.js",
  ];
  const scannerSrc = fs.readFileSync(path.join(ROOT, "backend/contracts/reportCard/noCountrySchoolBranch.js"), "utf8");
  assert.match(scannerSrc, /reportCardConfigurationSql/);
  assert.match(scannerSrc, /reportCardConfigurationPgStore/);
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    assert.ok(fs.existsSync(abs), `LOT 6 file missing (RED): ${rel}`);
    assert.equal(scanText(fs.readFileSync(abs, "utf8")).length, 0, rel);
  }
  const { api } = world();
  await assert.rejects(
    () =>
      api.submitModel({
        actor: schoolSubmit(SCHOOL_A),
        schoolId: SCHOOL_A,
        modelKey: "trimestriel",
        description: "ok",
        spec: { country: "BI" },
      }),
    (err) => err && err.code === "COUNTRY_SCHOOL_BRANCH_FORBIDDEN"
  );
});

test("report-card-lot6-no-publication-token-pdf-side-effects", async () => {
  const { api, profileStore, schemaStore, sideEffects } = world();
  const approved = await toApproved(api, profileStore, schemaStore, { modelKey: "no-side" });
  await api.activate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: approved.id,
    commandId: "no-side-1",
  });
  assert.deepEqual(sideEffects, []);
  assert.equal(PUBLISH.pdf_mints_token, false);
  const src = fs.readFileSync(path.join(__dirname, "reportCardConfiguration.js"), "utf8");
  assert.equal(/\bcreateReportCardPdf\b/.test(src), false);
  assert.equal(/\bgenerateToken\b/.test(src), false);
  assert.equal(/\bpublish\s*\(/.test(src), false);
  assert.equal(/\brenderPdfAfterCommit\b/.test(src), false);
});

test("report-card-lot6-no-web-mobile-lot7-plus", async () => {
  const lot6Files = [
    "backend/lib/reportCard/reportCardConfiguration.js",
    "backend/lib/reportCard/renderingTemplate.js",
    "backend/db/reportCardConfigurationSql.js",
    "backend/db/reportCardConfigurationPgStore.js",
  ];
  for (const rel of lot6Files) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.equal(/\/verify\b/.test(src), false, rel);
    assert.equal(/web\/src|Mobile\/src/.test(src), false, rel);
  }
  assert.equal(fs.existsSync(path.join(ROOT, "web/src/pages/reportCardConfiguration")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardVerify.tsx")), false);
});
