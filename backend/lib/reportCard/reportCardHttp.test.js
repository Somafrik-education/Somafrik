"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { ENGINE_ID, VERIFY_HEADERS, RBAC_TOKENS } = require("../../contracts/reportCard/contract");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const { assertTokenAbsentFromLogs } = require("../../contracts/reportCard/logRedaction");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { createReportCardConfiguration } = require("./reportCardConfiguration");
const { createReportCardPublication } = require("./reportCardPublication");
const { computeReportCard } = require("./reportCardEngine");
const { validateSpec: validateProfileSpec } = require("./academicRuleProfile");
const { validateSpec: validateSchemaSpec } = require("./reportCardSchema");
const { resolveReportCardActorFromPrincipal } = require("../reportCardHttpActor");
const { loadReportCardHttpCrypto, HISTORICAL_SIGNING_ENV } = require("../reportCardHttpRuntime");

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const ROOT = path.resolve(__dirname, "../../..");
const TENANT_A = { schoolId: SCHOOL_A, actorSchoolId: SCHOOL_A };

function loadLot7() {
  try {
    return require("./reportCardHttp");
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

function calculableProfile() {
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
  };
}

function compatibleSchema() {
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
  };
}

function validTemplate() {
  return {
    paper: "A4",
    orientation: "portrait",
    qr_required: true,
    sections: [
      { id: "SUMMARY", order: 1, label: "Totaux", source: "slots" },
      { id: "SUBJECTS", order: 2, label: "Disciplines", source: "cells" },
      { id: "APPLICABILITY", order: 3, label: "Presence", source: "presence" },
    ],
  };
}

function engineResult() {
  const profile = validateProfileSpec({
    periods: ["T1", "T2"],
    annual: true,
    score_components: [{ id: "TJ", applicability: "always", max: 20, coefficient: 1 }],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up" },
    ranking: { enabled: false, ties: "competition" },
  });
  const schema = validateSchemaSpec({
    sections: [
      {
        id: "SUBJECTS",
        order: 1,
        kind: "subject_rows",
        columns: [
          {
            id: "COL_T1_TJ",
            order: 1,
            kind: "score_component",
            score_component_id: "TJ",
            period_id: "T1",
          },
        ],
      },
    ],
  });
  return computeReportCard({
    profile,
    schema,
    facts: [
      {
        student_id: "STU-1",
        subject_id: "MATH",
        period_id: "T1",
        score_component_id: "TJ",
        raw_score: 12,
        subject_applicable: true,
      },
    ],
    provenance: {
      profile: { id: "PROF-1", version: 1, spec_sha256: "aa" },
      schema: { id: "SCH-1", version: 1, spec_sha256: "bb" },
    },
    tenant: TENANT_A,
  });
}

function snapshotPayload(overrides = {}) {
  const result = engineResult();
  return {
    report_card_id: "rc-1",
    published_snapshot_version: 1,
    school_id: SCHOOL_A,
    published_at: "2026-09-13T00:00:00.000Z",
    engine_id: result.engine_id,
    provenance: result.provenance,
    students: result.students,
    ...overrides,
  };
}

function configurationWorld() {
  const profileStore = createAcademicRuleProfileStore();
  const schemaStore = createReportCardSchemaStore();
  const api = createReportCardConfiguration({
    profileStore,
    schemaStore,
    clock: { now: () => "2026-09-13T12:00:00.000Z" },
  });
  return { api, profileStore, schemaStore };
}

function bootPublication(overrides = {}) {
  const signingKey = overrides.signingKey || generateSigningKey("rc-ed25519-1");
  const wrapping = overrides.wrapping || generateWrappingKey("rc-wrap-1");
  const publication = createReportCardPublication({
    signingKey,
    wrapping,
    wrappingKeys: overrides.wrappingKeys || [wrapping],
    signingKeys: overrides.signingKeys || [signingKey],
    dump: overrides.dump,
  });
  return { publication, signingKey, wrapping };
}

function seedBundle(profileStore, schemaStore, schoolId) {
  const createdP = profileStore.createProfile({
    schoolId,
    actorSchoolId: schoolId,
    profileKey: `core-${crypto.randomUUID()}`,
    spec: calculableProfile(),
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
  };
}

async function toReady(api, profileStore, schemaStore, schoolId = SCHOOL_A) {
  const submitted = await api.submitModel({
    actor: schoolSubmit(schoolId),
    schoolId,
    modelKey: "trimestriel",
    description: "modele A4 generique",
  });
  await api.startReview({ actor: superadmin(), schoolId, requestId: submitted.id });
  const configuring = await api.startConfiguring({
    actor: superadmin(),
    schoolId,
    requestId: submitted.id,
  });
  const refs = seedBundle(profileStore, schemaStore, schoolId);
  const template = await api.saveRenderingTemplate({
    actor: superadmin(),
    schoolId,
    requestId: configuring.id,
    spec: validTemplate(),
  });
  await api.bindBundle({
    actor: superadmin(),
    schoolId,
    requestId: configuring.id,
    profile: refs.profile,
    schema: refs.schema,
    template: { id: template.template_id, version: template.version },
  });
  return api.markReadyForReview({
    actor: superadmin(),
    schoolId,
    requestId: configuring.id,
  });
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((done, fail) => server.close((err) => (err ? fail(err) : done()))),
      });
    });
    server.on("error", reject);
  });
}

function capabilityFromUrl(url) {
  const marker = "/verify/rc/";
  const idx = url.indexOf(marker);
  assert.ok(idx >= 0, "verification URL missing");
  return url.slice(idx + marker.length);
}

async function harness(overrides = {}) {
  const lot7 = loadLot7();
  assert.ok(lot7 && typeof lot7.registerReportCardHttp === "function", "LOT 7 HTTP missing (RED)");
  const { api, profileStore, schemaStore } = configurationWorld();
  const pub = overrides.publication
    ? { publication: overrides.publication, signingKey: null, wrapping: null }
    : bootPublication();
  let actor = overrides.actor || null;
  const logs = [];
  const app = express();
  app.use(express.json());
  lot7.registerReportCardHttp(app, {
    configuration: api,
    publication: pub.publication,
    resolveActor: () => actor,
    logger: {
      info: (...args) => logs.push(args.map(String).join(" ")),
      error: (...args) => logs.push(args.map(String).join(" ")),
    },
  });
  const bound = await listen(app);
  return {
    lot7,
    api,
    profileStore,
    schemaStore,
    publication: pub.publication,
    signingKey: pub.signingKey,
    wrapping: pub.wrapping,
    logs,
    setActor(next) {
      actor = next;
    },
    close: bound.close,
    async json(method, urlPath, body) {
      const res = await fetch(`${bound.base}${urlPath}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { status: res.status, headers: res.headers, data, text };
    },
  };
}

test("report-card-lot7-school-list-own-requests-only", async () => {
  const h = await harness();
  try {
    h.setActor(schoolSubmit(SCHOOL_A));
    const created = await h.json("POST", "/api/report-card/requests", {
      modelKey: "trimestriel",
      description: "modele A",
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.request.school_id, SCHOOL_A);
    const listedA = await h.json("GET", "/api/report-card/requests");
    assert.equal(listedA.status, 200);
    assert.equal(listedA.data.requests.some((row) => row.id === created.data.request.id), true);
    h.setActor(schoolSubmit(SCHOOL_B));
    const listedB = await h.json("GET", "/api/report-card/requests");
    assert.equal(listedB.status, 200);
    assert.equal(listedB.data.requests.some((row) => row.id === created.data.request.id), false);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-school-submit-http-rbac-tenant", async () => {
  const h = await harness();
  try {
    h.setActor({ actorId: "none", actorSchoolId: SCHOOL_A, permissions: [] });
    const denied = await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error.code, "RBAC_DENIED");
    h.setActor(schoolSubmit(SCHOOL_A));
    const spoof = await h.json("POST", "/api/report-card/requests", {
      modelKey: "trimestriel",
      schoolId: SCHOOL_B,
    });
    assert.equal(spoof.status, 201);
    assert.equal(spoof.data.request.school_id, SCHOOL_A);
    assert.notEqual(spoof.data.request.school_id, SCHOOL_B);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-school-approve-http-rbac-tenant", async () => {
  const h = await harness();
  try {
    const ready = await toReady(h.api, h.profileStore, h.schemaStore, SCHOOL_A);
    h.setActor(schoolSubmit(SCHOOL_A));
    const submitter = await h.json("POST", `/api/report-card/requests/${ready.id}/approve`, {});
    assert.equal(submitter.status, 403);
    h.setActor(schoolApprove(SCHOOL_B));
    const foreign = await h.json("POST", `/api/report-card/requests/${ready.id}/approve`, {});
    assert.ok([403, 404].includes(foreign.status));
    h.setActor(schoolApprove(SCHOOL_A));
    const ok = await h.json("POST", `/api/report-card/requests/${ready.id}/approve`, {});
    assert.equal(ok.status, 200);
    assert.equal(ok.data.request.status, "APPROVED");
  } finally {
    await h.close();
  }
});

test("report-card-lot7-superadmin-queue-privileged-only", async () => {
  const h = await harness();
  try {
    h.setActor(schoolSubmit(SCHOOL_A));
    await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    const schoolQueue = await h.json("GET", `/api/report-card/admin/queue?schoolId=${SCHOOL_A}`);
    assert.equal(schoolQueue.status, 403);
    h.setActor({
      actorId: "sa-no-platform",
      permissions: ["REPORT_CARD_CONFIGURE"],
    });
    const unprivileged = await h.json("GET", `/api/report-card/admin/queue?schoolId=${SCHOOL_A}`);
    assert.equal(unprivileged.status, 403);
    assert.equal(unprivileged.data.error.code, "PLATFORM_CONTEXT_REQUIRED");
    h.setActor(superadmin());
    const ok = await h.json("GET", `/api/report-card/admin/queue?schoolId=${SCHOOL_A}`);
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.data.requests));
    assert.ok(ok.data.requests.length >= 1);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-superadmin-transition-http-authoritative", async () => {
  const h = await harness();
  try {
    h.setActor(schoolSubmit(SCHOOL_A));
    const created = await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    h.setActor(superadmin());
    const ignored = await h.json("POST", `/api/report-card/admin/requests/${created.data.request.id}/review`, {
      schoolId: SCHOOL_A,
      status: "ACTIVE",
    });
    assert.equal(ignored.status, 200);
    assert.equal(ignored.data.request.status, "UNDER_REVIEW");
    const reloaded = await h.json(
      "GET",
      `/api/report-card/admin/requests/${created.data.request.id}?schoolId=${SCHOOL_A}`
    );
    assert.equal(reloaded.data.request.status, "UNDER_REVIEW");
  } finally {
    await h.close();
  }
});

test("report-card-lot7-http-invalid-transition-fails-closed", async () => {
  const h = await harness();
  try {
    h.setActor(schoolSubmit(SCHOOL_A));
    const created = await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    h.setActor(schoolApprove(SCHOOL_A));
    const approve = await h.json("POST", `/api/report-card/requests/${created.data.request.id}/approve`, {});
    assert.equal(approve.status, 409);
    assert.equal(approve.data.error.code, "INVALID_TRANSITION");
  } finally {
    await h.close();
  }
});

test("report-card-lot7-http-cross-tenant-forbidden", async () => {
  const h = await harness();
  try {
    h.setActor(schoolSubmit(SCHOOL_A));
    const created = await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    h.setActor(schoolSubmit(SCHOOL_B));
    const get = await h.json("GET", `/api/report-card/requests/${created.data.request.id}`);
    assert.ok([403, 404].includes(get.status));
    const listed = await h.json("GET", "/api/report-card/requests");
    assert.equal(listed.data.requests.some((row) => row.id === created.data.request.id), false);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-http-reload-persists-state", async () => {
  const h = await harness();
  try {
    h.setActor(schoolSubmit(SCHOOL_A));
    const created = await h.json("POST", "/api/report-card/requests", {
      modelKey: "trimestriel",
      description: "persisted",
    });
    const firstId = created.data.request.id;
    const reload = await h.json("GET", `/api/report-card/requests/${firstId}`);
    assert.equal(reload.status, 200);
    assert.equal(reload.data.request.status, "SUBMITTED");
    assert.equal(reload.data.request.description, "persisted");
  } finally {
    await h.close();
  }
});

test("report-card-lot7-http-no-legacy-report-cards-collision", async () => {
  const h = await harness();
  try {
    const src = fs.readFileSync(path.join(__dirname, "reportCardHttp.js"), "utf8");
    assert.match(src, /\/api\/report-card\//);
    assert.match(src, /\/api\/public\/report-cards\/verify/);
    assert.equal(/app\.(get|post|put|patch|delete)\(\s*["'`]\/api\/report-cards(?!\/verify)/.test(src), false);
    h.setActor(schoolSubmit(SCHOOL_A));
    const created = await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    assert.equal(created.status, 201);
    const legacy = await h.json("GET", "/api/report-cards");
    assert.equal(legacy.status, 404);
  } finally {
    await h.close();
  }
});

async function publishFixture(publication) {
  const published = publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  const url = publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  return { published, url, capability: capabilityFromUrl(url) };
}

test("report-card-lot7-verify-valid-capability", async () => {
  const h = await harness();
  try {
    const { published, capability } = await publishFixture(h.publication);
    const res = await h.json("POST", "/api/public/report-cards/verify", { capability });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.payload.report_card_id, "rc-1");
    assert.equal(res.data.payload.engine_id, ENGINE_ID);
    assert.equal(res.data.payload.published_snapshot_version, published.published_snapshot_version);
    assert.ok(["authentic", "ACTIVE"].includes(res.data.verification_status));
  } finally {
    await h.close();
  }
});

test("report-card-lot7-verify-invalid-token-not-found", async () => {
  const h = await harness();
  try {
    const { published } = await publishFixture(h.publication);
    const res = await h.json("POST", "/api/public/report-cards/verify", {
      capability: `${published.public_id}.not-the-token`,
    });
    assert.equal(res.status, 404);
    assert.deepEqual(res.data, { ok: false, reason: "not_found" });
  } finally {
    await h.close();
  }
});

test("report-card-lot7-verify-unknown-public-id-not-found", async () => {
  const h = await harness();
  try {
    const res = await h.json("POST", "/api/public/report-cards/verify", {
      capability: "00000000-0000-4000-8000-000000000000.sometokenvalue",
    });
    assert.equal(res.status, 404);
    assert.deepEqual(res.data, { ok: false, reason: "not_found" });
  } finally {
    await h.close();
  }
});

test("report-card-lot7-verify-malformed-capability-not-found", async () => {
  const h = await harness();
  try {
    const a = await h.json("POST", "/api/public/report-cards/verify", { capability: "" });
    const b = await h.json("POST", "/api/public/report-cards/verify", { capability: "no-dot" });
    const c = await h.json("POST", "/api/public/report-cards/verify", {});
    for (const res of [a, b, c]) {
      assert.equal(res.status, 404);
      assert.deepEqual(res.data, { ok: false, reason: "not_found" });
    }
  } finally {
    await h.close();
  }
});

test("report-card-lot7-verify-tampered-snapshot-fails-closed", async () => {
  const keys = bootPublication();
  const { capability } = await publishFixture(keys.publication);
  const dump = keys.publication.persistWithoutSecrets();
  const row = dump[0];
  const buf = Buffer.from(row.canonical_bytes, "base64");
  buf[0] = buf[0] ^ 0xff;
  row.canonical_bytes = buf.toString("base64");
  row.snapshot_sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const tampered = createReportCardPublication({
    signingKey: keys.signingKey,
    wrapping: keys.wrapping,
    wrappingKeys: [keys.wrapping],
    signingKeys: [keys.signingKey],
    dump,
  });
  const h = await harness({ publication: tampered });
  try {
    const res = await h.json("POST", "/api/public/report-cards/verify", { capability });
    assert.notEqual(res.status, 200);
    assert.equal(res.data.ok, false);
    assert.notEqual(res.data.reason, undefined);
    assert.equal(res.data.payload, undefined);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-verify-historical-signing-key", async () => {
  const key1 = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  const envPublish = {
    SOMAFRIK_REPORT_CARD_SIGNING_PRIVATE_KEY_PEM: key1.privateKey.export({ type: "pkcs8", format: "pem" }),
    SOMAFRIK_REPORT_CARD_SIGNING_KEY_ID: "rc-ed25519-1",
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_B64: wrapping.key.toString("base64"),
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_ID: "rc-wrap-1",
  };
  const publishedCrypto = loadReportCardHttpCrypto(envPublish);
  const first = createReportCardPublication({
    signingKey: publishedCrypto.signingKey,
    wrapping: publishedCrypto.wrapping,
    wrappingKeys: publishedCrypto.wrappingKeys,
    signingKeys: publishedCrypto.signingKeys,
  });
  const { capability } = await publishFixture(first);
  const dump = first.persistWithoutSecrets();
  const key2 = generateSigningKey("rc-ed25519-2");
  const rotatedEnv = {
    SOMAFRIK_REPORT_CARD_SIGNING_PRIVATE_KEY_PEM: key2.privateKey.export({ type: "pkcs8", format: "pem" }),
    SOMAFRIK_REPORT_CARD_SIGNING_KEY_ID: "rc-ed25519-2",
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_B64: wrapping.key.toString("base64"),
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_ID: "rc-wrap-1",
    [HISTORICAL_SIGNING_ENV]: JSON.stringify([
      {
        signing_key_id: "rc-ed25519-1",
        publicKeyPem: key1.publicKey.export({ type: "spki", format: "pem" }),
      },
    ]),
  };
  const rotatedCrypto = loadReportCardHttpCrypto(rotatedEnv);
  assert.equal(rotatedCrypto.signingKey.signing_key_id, "rc-ed25519-2");
  assert.equal(
    rotatedCrypto.signingKeys.some((key) => key.signing_key_id === "rc-ed25519-1"),
    true
  );
  const restored = createReportCardPublication({
    signingKey: rotatedCrypto.signingKey,
    wrapping: rotatedCrypto.wrapping,
    wrappingKeys: rotatedCrypto.wrappingKeys,
    signingKeys: rotatedCrypto.signingKeys,
    dump,
  });
  const h = await harness({ publication: restored });
  try {
    const before = restored.persistWithoutSecrets();
    const res = await h.json("POST", "/api/public/report-cards/verify", { capability });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.payload.report_card_id, "rc-1");
    const after = restored.persistWithoutSecrets();
    assert.equal(after[0].signing_key_id, "rc-ed25519-1");
    assert.equal(after[0].snapshot_sha256, before[0].snapshot_sha256);
    assert.equal(after[0].snapshot_signature, before[0].snapshot_signature);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-verify-unknown-signing-key-fails-closed", async () => {
  const key1 = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  const first = createReportCardPublication({
    signingKey: key1,
    wrapping,
    wrappingKeys: [wrapping],
    signingKeys: [key1],
  });
  const { capability } = await publishFixture(first);
  const dump = first.persistWithoutSecrets();
  const key2 = generateSigningKey("rc-ed25519-2");
  const rotatedCrypto = loadReportCardHttpCrypto({
    SOMAFRIK_REPORT_CARD_SIGNING_PRIVATE_KEY_PEM: key2.privateKey.export({ type: "pkcs8", format: "pem" }),
    SOMAFRIK_REPORT_CARD_SIGNING_KEY_ID: "rc-ed25519-2",
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_B64: wrapping.key.toString("base64"),
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_ID: "rc-wrap-1",
  });
  const restored = createReportCardPublication({
    signingKey: rotatedCrypto.signingKey,
    wrapping: rotatedCrypto.wrapping,
    wrappingKeys: rotatedCrypto.wrappingKeys,
    signingKeys: rotatedCrypto.signingKeys,
    dump,
  });
  const h = await harness({ publication: restored });
  try {
    const res = await h.json("POST", "/api/public/report-cards/verify", { capability });
    assert.notEqual(res.status, 200);
    assert.equal(res.data.ok, false);
    assert.equal(res.data.payload, undefined);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-verify-no-live-grade-fallback", async () => {
  const h = await harness();
  try {
    const { capability } = await publishFixture(h.publication);
    const res = await h.json("POST", "/api/public/report-cards/verify", { capability });
    assert.equal(res.status, 200);
    const blob = JSON.stringify(res.data.payload);
    assert.match(blob, /STU-1/);
    assert.equal(blob.includes("999"), false);
    const src = fs.readFileSync(path.join(__dirname, "reportCardHttp.js"), "utf8");
    assert.equal(/\bcomputeReportCard\b/.test(src), false);
    assert.equal(/\bgenerateToken\b/.test(src), false);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-verify-no-secret-fields", async () => {
  const h = await harness();
  try {
    const { capability } = await publishFixture(h.publication);
    const res = await h.json("POST", "/api/public/report-cards/verify", { capability });
    const blob = JSON.stringify(res.data);
    assert.equal(blob.includes("token_hash"), false);
    assert.equal(blob.includes("token_ciphertext"), false);
    assert.equal(blob.includes("privateKey"), false);
    assert.equal(blob.includes(capability.split(".")[1]), false);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-verify-no-store-no-referrer", async () => {
  const h = await harness();
  try {
    const { capability } = await publishFixture(h.publication);
    const res = await h.json("POST", "/api/public/report-cards/verify", { capability });
    assert.match(res.headers.get("cache-control") || "", /no-store/);
    assert.equal(res.headers.get("referrer-policy"), VERIFY_HEADERS.referrer_policy);
    const unknown = await h.json("POST", "/api/public/report-cards/verify", { capability: "x.y" });
    assert.match(unknown.headers.get("cache-control") || "", /no-store/);
    assert.equal(unknown.headers.get("referrer-policy"), VERIFY_HEADERS.referrer_policy);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-verify-does-not-mint-or-rotate-token", async () => {
  const h = await harness();
  try {
    const { url, capability } = await publishFixture(h.publication);
    const before = h.publication.persistWithoutSecrets();
    const first = await h.json("POST", "/api/public/report-cards/verify", { capability });
    const second = await h.json("POST", "/api/public/report-cards/verify", { capability });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const after = h.publication.persistWithoutSecrets();
    assert.equal(after.length, before.length);
    assert.equal(after[0].token_hash, before[0].token_hash);
    assert.equal(after[0].public_id, before[0].public_id);
    assert.equal(
      h.publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 }),
      url
    );
    const src = fs.readFileSync(path.join(__dirname, "reportCardHttp.js"), "utf8");
    assert.equal(/\bgenerateToken\b/.test(src), false);
    assert.equal(/\bcreateReportCardPdf\b/.test(src), false);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-verify-same-publication-same-capability", async () => {
  const h = await harness();
  try {
    const { capability } = await publishFixture(h.publication);
    const a = await h.json("POST", "/api/public/report-cards/verify", { capability });
    const b = await h.json("POST", "/api/public/report-cards/verify", { capability });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.data.payload.report_card_id, b.data.payload.report_card_id);
    assert.equal(a.data.payload.published_snapshot_version, b.data.payload.published_snapshot_version);
    assert.deepEqual(a.data.payload.students, b.data.payload.students);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-verify-capability-not-logged", async () => {
  const h = await harness();
  try {
    const { capability } = await publishFixture(h.publication);
    const token = capability.split(".").slice(1).join(".");
    await h.json("POST", "/api/public/report-cards/verify", { capability });
    assertTokenAbsentFromLogs(h.logs, token);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-actor-http-read-cannot-submit", async () => {
  const h = await harness();
  try {
    h.setActor(
      resolveReportCardActorFromPrincipal({
        sub: "reader",
        schoolId: SCHOOL_A,
        role: "Enseignant",
        permissions: ["Bulletins:READ"],
      })
    );
    const denied = await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error.code, "RBAC_DENIED");
  } finally {
    await h.close();
  }
});

test("report-card-lot7-actor-http-create-can-submit-update-can-approve", async () => {
  const h = await harness();
  try {
    h.setActor(
      resolveReportCardActorFromPrincipal({
        sub: "creator",
        schoolId: SCHOOL_A,
        role: "Proviseur",
        permissions: ["Bulletins:CREATE", "Bulletins:READ"],
      })
    );
    const created = await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    assert.equal(created.status, 201);
    const ready = await toReady(h.api, h.profileStore, h.schemaStore, SCHOOL_A);
    h.setActor(
      resolveReportCardActorFromPrincipal({
        sub: "creator",
        schoolId: SCHOOL_A,
        role: "Proviseur",
        permissions: ["Bulletins:CREATE", "Bulletins:READ"],
      })
    );
    const cannotApprove = await h.json("POST", `/api/report-card/requests/${ready.id}/approve`, {});
    assert.equal(cannotApprove.status, 403);
    h.setActor(
      resolveReportCardActorFromPrincipal({
        sub: "approver",
        schoolId: SCHOOL_A,
        role: "Proviseur",
        permissions: ["Bulletins:UPDATE"],
      })
    );
    const approved = await h.json("POST", `/api/report-card/requests/${ready.id}/approve`, {});
    assert.equal(approved.status, 200);
    assert.equal(approved.data.request.status, "APPROVED");
  } finally {
    await h.close();
  }
});

test("report-card-lot7-actor-http-admin-school-role-does-not-grant-write", async () => {
  const h = await harness();
  try {
    h.setActor(
      resolveReportCardActorFromPrincipal({
        sub: "admin-school",
        schoolId: SCHOOL_A,
        role: "Admin School",
        permissions: ["Bulletins:READ"],
      })
    );
    const submit = await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    assert.equal(submit.status, 403);
    const ready = await toReady(h.api, h.profileStore, h.schemaStore, SCHOOL_A);
    const approve = await h.json("POST", `/api/report-card/requests/${ready.id}/approve`, {});
    assert.equal(approve.status, 403);
  } finally {
    await h.close();
  }
});

test("report-card-lot7-http-web-path-reaches-ready-approved-active", async () => {
  const h = await harness();
  try {
    const refs = seedBundle(h.profileStore, h.schemaStore, SCHOOL_A);
    h.setActor(schoolSubmit(SCHOOL_A));
    const created = await h.json("POST", "/api/report-card/requests", {
      modelKey: "trimestriel",
      description: "web path",
    });
    assert.equal(created.status, 201);
    const requestId = created.data.request.id;
    h.setActor(superadmin());
    const catalogDenied = await h.json("GET", `/api/report-card/admin/catalog?schoolId=${SCHOOL_B}`);
    assert.equal(catalogDenied.status, 200);
    assert.equal(catalogDenied.data.profiles.some((row) => row.id === refs.profile.id), false);
    const catalog = await h.json("GET", `/api/report-card/admin/catalog?schoolId=${SCHOOL_A}`);
    assert.equal(catalog.status, 200);
    assert.equal(catalog.data.profiles.some((row) => row.id === refs.profile.id), true);
    assert.equal(catalog.data.schemas.some((row) => row.id === refs.schema.id), true);
    const reviewed = await h.json("POST", `/api/report-card/admin/requests/${requestId}/review`, {
      schoolId: SCHOOL_A,
    });
    assert.equal(reviewed.data.request.status, "UNDER_REVIEW");
    const configuring = await h.json("POST", `/api/report-card/admin/requests/${requestId}/configure`, {
      schoolId: SCHOOL_A,
    });
    assert.equal(configuring.data.request.status, "CONFIGURING");
    assert.equal(configuring.data.request.actions.save_template, true);
    assert.equal(configuring.data.request.actions.bind_bundle, true);
    const tooSoon = await h.json("POST", `/api/report-card/admin/requests/${requestId}/ready-for-review`, {
      schoolId: SCHOOL_A,
    });
    assert.equal(tooSoon.status, 400);
    assert.equal(tooSoon.data.error.code, "INVALID_BUNDLE");
    const saved = await h.json("POST", `/api/report-card/admin/requests/${requestId}/save-template`, {
      schoolId: SCHOOL_A,
      spec: validTemplate(),
    });
    assert.equal(saved.status, 200);
    const bound = await h.json("POST", `/api/report-card/admin/requests/${requestId}/bind-bundle`, {
      schoolId: SCHOOL_A,
      profile: refs.profile,
      schema: refs.schema,
      template: { id: saved.data.template.template_id, version: saved.data.template.version },
    });
    assert.equal(bound.status, 200);
    const ready = await h.json("POST", `/api/report-card/admin/requests/${requestId}/ready-for-review`, {
      schoolId: SCHOOL_A,
    });
    assert.equal(ready.status, 200);
    assert.equal(ready.data.request.status, "READY_FOR_REVIEW");
    h.setActor(schoolApprove(SCHOOL_A));
    const schoolBundle = await h.json("GET", `/api/report-card/requests/${requestId}/bundle`);
    assert.equal(schoolBundle.status, 200);
    assert.ok(schoolBundle.data.template);
    assert.equal(schoolBundle.data.template.spec.qr_required, true);
    assert.equal(schoolBundle.data.profile.id, refs.profile.id);
    const audit = await h.json("GET", `/api/report-card/requests/${requestId}/audit`);
    assert.equal(audit.status, 200);
    assert.ok(audit.data.audit.length >= 1);
    const approved = await h.json("POST", `/api/report-card/requests/${requestId}/approve`, {});
    assert.equal(approved.status, 200);
    assert.equal(approved.data.request.status, "APPROVED");
    h.setActor(superadmin());
    const adminBundle = await h.json(
      "GET",
      `/api/report-card/admin/requests/${requestId}/bundle?schoolId=${SCHOOL_A}`
    );
    assert.equal(adminBundle.status, 200);
    assert.ok(adminBundle.data.template.spec.sections.length >= 1);
    const activated = await h.json("POST", `/api/report-card/admin/requests/${requestId}/activate`, {
      schoolId: SCHOOL_A,
    });
    assert.equal(activated.status, 200);
    assert.equal(activated.data.request.status, "ACTIVE");
    h.setActor(schoolApprove(SCHOOL_A));
    const binding = await h.json("GET", "/api/report-card/bindings/trimestriel");
    assert.equal(binding.status, 200);
    assert.equal(binding.data.binding.model_key, "trimestriel");
    assert.equal(binding.data.binding.request_id, requestId);
    h.setActor(superadmin());
    const adminBinding = await h.json(
      "GET",
      `/api/report-card/admin/bindings/trimestriel?schoolId=${SCHOOL_A}`
    );
    assert.equal(adminBinding.status, 200);
    assert.equal(adminBinding.data.binding.request_id, requestId);
  } finally {
    await h.close();
  }
});
