"use strict";

/**
 * LOT 11 RED — artefact source établissement + mapping traçable.
 * Production code modified: NO. GREEN implémente `reportCardSourceArtifact`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_ID, RBAC_TOKENS } = require("../../contracts/reportCard/contract");
const { scanEngineSources, scanText } = require("../../contracts/reportCard/noCountrySchoolBranch");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const ROOT = path.resolve(__dirname, "../../..");
const ENGINE_SRC = path.join(__dirname, "reportCardEngine.js");
const ARTIFACT_SRC = path.join(__dirname, "reportCardSourceArtifact.js");
const PERM_SUBMIT = "REPORT_CARD_SUBMIT_MODEL";
const PERM_CONFIGURE = "REPORT_CARD_CONFIGURE";

function loadLot11() {
  try {
    return require("./reportCardSourceArtifact");
  } catch {
    return null;
  }
}

function requireLot11() {
  const lot11 = loadLot11();
  assert.ok(
    lot11 && typeof lot11.createReportCardSourceArtifact === "function",
    "RED: reportCardSourceArtifact missing"
  );
  return lot11;
}

function loadLot6() {
  try {
    return require("./reportCardConfiguration");
  } catch {
    return null;
  }
}

function schoolSubmit(schoolId = SCHOOL_A) {
  return {
    actorId: `submit-${schoolId}`,
    actorSchoolId: schoolId,
    permissions: [PERM_SUBMIT],
  };
}

function schoolReader(schoolId = SCHOOL_A) {
  return {
    actorId: `read-${schoolId}`,
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_READ"],
  };
}

function superadmin() {
  return {
    actorId: "superadmin-1",
    permissions: [PERM_CONFIGURE],
    platform: { privileged: true },
  };
}

function pdfBytes(marker = "lot11") {
  return Buffer.from(`%PDF-1.4\n%${marker}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
}

function jpegBytes() {
  return Buffer.from("ffd8ffe000104a46494600010101006000600000ffd9", "hex");
}

function pngBytes() {
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex"
  );
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
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
        ],
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

function memoryBlobs() {
  const blobs = new Map();
  return {
    blobs,
    async persist(bytes) {
      const key = `rc-source/${crypto.randomUUID()}`;
      blobs.set(key, Buffer.from(bytes));
      return key;
    },
    async read(storageKey) {
      const found = blobs.get(storageKey);
      if (!found) {
        const err = new Error("ARTIFACT_NOT_FOUND");
        err.code = "ARTIFACT_NOT_FOUND";
        throw err;
      }
      return Buffer.from(found);
    },
    async remove(storageKey) {
      blobs.delete(storageKey);
    },
    corrupt(storageKey) {
      const found = blobs.get(storageKey);
      assert.ok(found, "storage key missing");
      found[0] ^= 0xff;
    },
  };
}

async function world() {
  const lot6 = loadLot6();
  assert.ok(lot6 && typeof lot6.createReportCardConfiguration === "function", "LOT 6 missing");
  const lot11 = requireLot11();
  const profileStore = createAcademicRuleProfileStore();
  const schemaStore = createReportCardSchemaStore();
  const configuration = lot6.createReportCardConfiguration({
    profileStore,
    schemaStore,
    clock: { now: () => "2026-09-14T12:00:00.000Z" },
  });
  const storage = memoryBlobs();
  const artifacts = lot11.createReportCardSourceArtifact({
    configuration,
    storage,
    clock: { now: () => "2026-09-14T12:00:00.000Z" },
  });
  const submitted = await configuration.submitModel({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    modelKey: "trimestriel",
    description: "modele source LOT11",
  });
  return {
    lot11,
    configuration,
    artifacts,
    storage,
    profileStore,
    schemaStore,
    requestId: submitted.id,
    submitted,
  };
}

function isCoded(error, code) {
  return Boolean(error && error.code === code);
}

test("report-card-lot11-upload-requires-rbac-tenant", async () => {
  const ctx = await world();
  const bytes = pdfBytes();
  await assert.rejects(
    () =>
      ctx.artifacts.attachToRequest({
        actor: schoolReader(SCHOOL_A),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes,
        declaredMime: "application/pdf",
        originalFilename: "modele.pdf",
        idempotencyKey: "cmd-rbac-1",
      }),
    (error) => isCoded(error, "RBAC_DENIED")
  );
  await assert.rejects(
    () =>
      ctx.artifacts.attachToRequest({
        actor: schoolSubmit(SCHOOL_A),
        schoolId: null,
        requestId: ctx.requestId,
        bytes,
        declaredMime: "application/pdf",
        originalFilename: "modele.pdf",
        idempotencyKey: "cmd-rbac-2",
      }),
    (error) => isCoded(error, "TENANT_REQUIRED") || isCoded(error, "TENANT_MISMATCH")
  );
});

test("report-card-lot11-upload-cross-tenant-forbidden", async () => {
  const ctx = await world();
  await assert.rejects(
    () =>
      ctx.artifacts.attachToRequest({
        actor: schoolSubmit(SCHOOL_B),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: pdfBytes(),
        declaredMime: "application/pdf",
        originalFilename: "modele.pdf",
        idempotencyKey: "cmd-xtenant",
      }),
    (error) => isCoded(error, "TENANT_MISMATCH")
  );
  await assert.rejects(
    () =>
      ctx.artifacts.attachToRequest({
        actor: schoolSubmit(SCHOOL_A),
        schoolId: SCHOOL_B,
        requestId: ctx.requestId,
        bytes: pdfBytes(),
        declaredMime: "application/pdf",
        originalFilename: "modele.pdf",
        idempotencyKey: "cmd-xtenant-2",
      }),
    (error) =>
      isCoded(error, "TENANT_MISMATCH") ||
      isCoded(error, "REQUEST_NOT_FOUND") ||
      isCoded(error, "RBAC_DENIED")
  );
});

test("report-card-lot11-school-upload-own-request-only", async () => {
  const ctx = await world();
  const other = await ctx.configuration.submitModel({
    actor: schoolSubmit(SCHOOL_B),
    schoolId: SCHOOL_B,
    modelKey: "trimestriel",
    description: "demande ecole B",
  });
  await assert.rejects(
    () =>
      ctx.artifacts.attachToRequest({
        actor: schoolSubmit(SCHOOL_A),
        schoolId: SCHOOL_A,
        requestId: other.id,
        bytes: pdfBytes(),
        declaredMime: "application/pdf",
        originalFilename: "modele.pdf",
        idempotencyKey: "cmd-own-req",
      }),
    (error) => isCoded(error, "REQUEST_NOT_FOUND") || isCoded(error, "TENANT_MISMATCH")
  );
});

test("report-card-lot11-upload-rejects-extension-spoofing", async () => {
  const ctx = await world();
  const exeNamedPdf = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(32, 0)]);
  await assert.rejects(
    () =>
      ctx.artifacts.attachToRequest({
        actor: schoolSubmit(SCHOOL_A),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: exeNamedPdf,
        declaredMime: "application/pdf",
        originalFilename: "modele.pdf",
        idempotencyKey: "cmd-spoof",
      }),
    (error) => isCoded(error, "UNSUPPORTED_MEDIA")
  );
  const pdfNamedExe = pdfBytes();
  await assert.rejects(
    () =>
      ctx.artifacts.attachToRequest({
        actor: schoolSubmit(SCHOOL_A),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: pdfNamedExe,
        declaredMime: "application/pdf",
        originalFilename: "payload.exe",
        idempotencyKey: "cmd-exe-name",
      }),
    (error) => isCoded(error, "UNSUPPORTED_MEDIA")
  );
});

test("report-card-lot11-upload-rejects-unsupported-active-content", async () => {
  const ctx = await world();
  const samples = [
    { bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), name: "x.svg", mime: "image/svg+xml" },
    { bytes: Buffer.from("<html><script>alert(1)</script></html>"), name: "x.html", mime: "text/html" },
    { bytes: Buffer.from("console.log(1)"), name: "x.js", mime: "application/javascript" },
  ];
  for (const sample of samples) {
    await assert.rejects(
      () =>
        ctx.artifacts.attachToRequest({
          actor: schoolSubmit(SCHOOL_A),
          schoolId: SCHOOL_A,
          requestId: ctx.requestId,
          bytes: sample.bytes,
          declaredMime: sample.mime,
          originalFilename: sample.name,
          idempotencyKey: `cmd-active-${sample.name}`,
        }),
      (error) => isCoded(error, "UNSUPPORTED_MEDIA"),
      sample.name
    );
  }
});

test("report-card-lot11-upload-enforces-max-size", async () => {
  const ctx = await world();
  const lot11 = requireLot11();
  assert.ok(Number.isInteger(lot11.MAX_SOURCE_ARTIFACT_BYTES));
  assert.ok(lot11.MAX_SOURCE_ARTIFACT_BYTES > 0);
  assert.ok(lot11.MAX_SOURCE_ARTIFACT_BYTES <= 10 * 1024 * 1024);
  const tooBig = Buffer.alloc(lot11.MAX_SOURCE_ARTIFACT_BYTES + 1, 0x25);
  tooBig[1] = 0x50;
  tooBig[2] = 0x44;
  tooBig[3] = 0x46;
  await assert.rejects(
    () =>
      ctx.artifacts.attachToRequest({
        actor: schoolSubmit(SCHOOL_A),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: tooBig,
        declaredMime: "application/pdf",
        originalFilename: "huge.pdf",
        idempotencyKey: "cmd-size",
      }),
    (error) => isCoded(error, "FILE_TOO_LARGE")
  );
});

test("report-card-lot11-upload-opaque-storage-key", async () => {
  const ctx = await world();
  const attached = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("opaque"),
    declaredMime: "application/pdf",
    originalFilename: "../../etc/passwd.pdf",
    idempotencyKey: "cmd-opaque",
  });
  assert.ok(attached.artifact_id);
  assert.doesNotMatch(String(attached.artifact_id), /passwd|\.\./);
  assert.ok(attached.storage_key);
  assert.doesNotMatch(String(attached.storage_key), /passwd|\.\.|\/etc\//);
  assert.notEqual(attached.storage_key, attached.original_filename);
  assert.equal(attached.original_filename.includes("passwd"), true);
  assert.doesNotMatch(String(attached.storage_key), /^https?:\/\//);
});

test("report-card-lot11-upload-sha256-deterministic", async () => {
  const ctx = await world();
  const bytes = pdfBytes("hash-me");
  const attached = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes,
    declaredMime: "application/pdf",
    originalFilename: "modele.pdf",
    idempotencyKey: "cmd-hash",
  });
  assert.equal(attached.sha256, sha256Hex(bytes));
  assert.match(attached.sha256, /^[a-f0-9]{64}$/);
  assert.equal(attached.byte_size, bytes.length);
  assert.equal(attached.media_type, "application/pdf");
  const jpeg = await ctx.artifacts.replaceCurrent({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: jpegBytes(),
    declaredMime: "image/jpeg",
    originalFilename: "modele.jpg",
    idempotencyKey: "cmd-hash-jpeg",
  });
  assert.equal(jpeg.media_type, "image/jpeg");
  assert.equal(jpeg.sha256, sha256Hex(jpegBytes()));
  const png = await ctx.artifacts.replaceCurrent({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pngBytes(),
    declaredMime: "image/png",
    originalFilename: "modele.png",
    idempotencyKey: "cmd-hash-png",
  });
  assert.equal(png.media_type, "image/png");
});

test("report-card-lot11-replace-creates-new-artifact-version", async () => {
  const ctx = await world();
  const first = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("v1"),
    declaredMime: "application/pdf",
    originalFilename: "v1.pdf",
    idempotencyKey: "cmd-v1",
  });
  const second = await ctx.artifacts.replaceCurrent({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("v2"),
    declaredMime: "application/pdf",
    originalFilename: "v2.pdf",
    idempotencyKey: "cmd-v2",
  });
  assert.notEqual(second.artifact_id, first.artifact_id);
  assert.ok(second.version > first.version);
  assert.equal(second.current, true);
  const current = await ctx.artifacts.getCurrent({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  assert.equal(current.artifact_id, second.artifact_id);
  const archived = await ctx.artifacts.getById({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    artifactId: first.artifact_id,
  });
  assert.equal(archived.current, false);
  assert.equal(archived.status === "ARCHIVED" || archived.status === "SUPERSEDED", true);
});

test("report-card-lot11-replace-concurrency-one-current", async () => {
  const ctx = await world();
  await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("base"),
    declaredMime: "application/pdf",
    originalFilename: "base.pdf",
    idempotencyKey: "cmd-base",
  });
  const results = await Promise.allSettled([
    ctx.artifacts.replaceCurrent({
      actor: schoolSubmit(SCHOOL_A),
      schoolId: SCHOOL_A,
      requestId: ctx.requestId,
      bytes: pdfBytes("c1"),
      declaredMime: "application/pdf",
      originalFilename: "c1.pdf",
      idempotencyKey: "cmd-c1",
    }),
    ctx.artifacts.replaceCurrent({
      actor: schoolSubmit(SCHOOL_A),
      schoolId: SCHOOL_A,
      requestId: ctx.requestId,
      bytes: pdfBytes("c2"),
      declaredMime: "application/pdf",
      originalFilename: "c2.pdf",
      idempotencyKey: "cmd-c2",
    }),
  ]);
  const fulfilled = results.filter((row) => row.status === "fulfilled").map((row) => row.value);
  const rejected = results.filter((row) => row.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(isCoded(rejected[0].reason, "CONCURRENCY_CONFLICT"), true);
  const current = await ctx.artifacts.getCurrent({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  assert.equal(current.artifact_id, fulfilled[0].artifact_id);
  assert.equal(current.current, true);
});

test("report-card-lot11-upload-idempotent-same-hash", async () => {
  const ctx = await world();
  const bytes = pdfBytes("idem");
  const first = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes,
    declaredMime: "application/pdf",
    originalFilename: "idem.pdf",
    idempotencyKey: "cmd-same",
  });
  const second = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes,
    declaredMime: "application/pdf",
    originalFilename: "idem.pdf",
    idempotencyKey: "cmd-same",
  });
  assert.equal(second.artifact_id, first.artifact_id);
  assert.equal(second.sha256, first.sha256);
  assert.equal(second.version, first.version);
});

test("report-card-lot11-upload-idempotency-conflict-different-content", async () => {
  const ctx = await world();
  await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("a"),
    declaredMime: "application/pdf",
    originalFilename: "a.pdf",
    idempotencyKey: "cmd-conflict",
  });
  await assert.rejects(
    () =>
      ctx.artifacts.attachToRequest({
        actor: schoolSubmit(SCHOOL_A),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: pdfBytes("b"),
        declaredMime: "application/pdf",
        originalFilename: "b.pdf",
        idempotencyKey: "cmd-conflict",
      }),
    (error) => isCoded(error, "IDEMPOTENCY_CONFLICT")
  );
});

test("report-card-lot11-activated-artifact-reference-immutable", async () => {
  const ctx = await world();
  const attached = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("pin"),
    declaredMime: "application/pdf",
    originalFilename: "pin.pdf",
    idempotencyKey: "cmd-pin",
  });
  await ctx.configuration.startReview({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  const configuring = await ctx.configuration.startConfiguring({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  const refs = seedBundle(ctx.profileStore, ctx.schemaStore, SCHOOL_A);
  const template = await ctx.configuration.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: configuring.id,
    spec: validTemplate(),
  });
  await ctx.artifacts.mapExplicit({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: configuring.id,
    profile: refs.profile,
    schema: refs.schema,
    template: { id: template.template_id, version: template.version },
    artifact_id: attached.artifact_id,
    artifact_version: attached.version,
  });
  await ctx.artifacts.markReadyForReview({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: configuring.id,
  });
  await ctx.configuration.approve({
    actor: {
      actorId: "approve-a",
      actorSchoolId: SCHOOL_A,
      permissions: ["REPORT_CARD_SCHOOL_APPROVE_TEMPLATE"],
    },
    schoolId: SCHOOL_A,
    requestId: configuring.id,
  });
  await ctx.configuration.activate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: configuring.id,
  });
  await assert.rejects(
    () =>
      ctx.artifacts.replaceCurrent({
        actor: schoolSubmit(SCHOOL_A),
        schoolId: SCHOOL_A,
        requestId: configuring.id,
        bytes: pdfBytes("after-active"),
        declaredMime: "application/pdf",
        originalFilename: "after.pdf",
        idempotencyKey: "cmd-after-active",
      }),
    (error) => isCoded(error, "ARTIFACT_IMMUTABLE")
  );
  const pinned = await ctx.artifacts.getCurrent({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: configuring.id,
  });
  assert.equal(pinned.artifact_id, attached.artifact_id);
  assert.equal(pinned.sha256, attached.sha256);
});

test("report-card-lot11-hash-mismatch-fails-closed", async () => {
  const ctx = await world();
  const attached = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("integrity"),
    declaredMime: "application/pdf",
    originalFilename: "integrity.pdf",
    idempotencyKey: "cmd-integrity",
  });
  ctx.storage.corrupt(attached.storage_key);
  await assert.rejects(
    () =>
      ctx.artifacts.openDownload({
        actor: schoolSubmit(SCHOOL_A),
        schoolId: SCHOOL_A,
        artifactId: attached.artifact_id,
      }),
    (error) => isCoded(error, "HASH_MISMATCH") || isCoded(error, "ARTIFACT_CORRUPT")
  );
  await assert.rejects(
    () =>
      ctx.artifacts.markReadyForReview({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      }),
    (error) =>
      isCoded(error, "HASH_MISMATCH") ||
      isCoded(error, "ARTIFACT_CORRUPT") ||
      isCoded(error, "ARTIFACT_REQUIRED") ||
      isCoded(error, "MAPPING_REQUIRED") ||
      isCoded(error, "INVALID_TRANSITION")
  );
});

test("report-card-lot11-audit-append-only", async () => {
  const ctx = await world();
  await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("audit-1"),
    declaredMime: "application/pdf",
    originalFilename: "a.pdf",
    idempotencyKey: "cmd-audit-1",
  });
  const first = await ctx.artifacts.listAudit({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  assert.ok(Array.isArray(first) && first.length >= 1);
  const snapshot = first.map((row) => ({ ...row }));
  await ctx.artifacts.replaceCurrent({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("audit-2"),
    declaredMime: "application/pdf",
    originalFilename: "b.pdf",
    idempotencyKey: "cmd-audit-2",
  });
  const second = await ctx.artifacts.listAudit({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  assert.ok(second.length > snapshot.length);
  assert.deepEqual(second.slice(0, snapshot.length).map((row) => row.action || row.to_state), snapshot.map((row) => row.action || row.to_state));
  assert.equal(
    second.some((row) => /ATTACH|REPLACE|ARCHIVE/i.test(String(row.action || row.to_state || ""))),
    true
  );
  if (typeof ctx.artifacts.deleteAudit === "function") {
    await assert.rejects(
      () => ctx.artifacts.deleteAudit({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ctx.requestId }),
      (error) => isCoded(error, "AUDIT_APPEND_ONLY") || isCoded(error, "RBAC_DENIED")
    );
  }
});

test("report-card-lot11-superadmin-preview-privileged-only", async () => {
  const ctx = await world();
  const attached = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("preview"),
    declaredMime: "application/pdf",
    originalFilename: "preview.pdf",
    idempotencyKey: "cmd-preview",
  });
  const privileged = await ctx.artifacts.openDownload({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    artifactId: attached.artifact_id,
  });
  assert.ok(Buffer.isBuffer(privileged.bytes));
  assert.equal(privileged.bytes.length, attached.byte_size);
  await assert.rejects(
    () =>
      ctx.artifacts.openDownload({
        actor: schoolSubmit(SCHOOL_B),
        schoolId: SCHOOL_A,
        artifactId: attached.artifact_id,
      }),
    (error) => isCoded(error, "RBAC_DENIED") || isCoded(error, "TENANT_MISMATCH")
  );
  await assert.rejects(
    () =>
      ctx.artifacts.openDownload({
        actor: { actorId: "anon", permissions: [] },
        schoolId: SCHOOL_A,
        artifactId: attached.artifact_id,
      }),
    (error) => isCoded(error, "RBAC_DENIED")
  );
});

test("report-card-lot11-mapping-explicit-no-auto-rules", async () => {
  const ctx = await world();
  const lot11 = requireLot11();
  assert.equal(typeof lot11.autoExtractRules, "undefined");
  assert.equal(typeof lot11.inferBundleFromArtifact, "undefined");
  assert.equal(typeof ctx.artifacts.autoExtractRules, "undefined");
  const src = fs.readFileSync(ARTIFACT_SRC, "utf8");
  assert.doesNotMatch(src, /tesseract|ocr|openai|anthropic|extractRules|countryPack/i);
  const attached = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("map"),
    declaredMime: "application/pdf",
    originalFilename: "map.pdf",
    idempotencyKey: "cmd-map",
  });
  await ctx.configuration.startReview({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ctx.requestId });
  await ctx.configuration.startConfiguring({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ctx.requestId });
  await assert.rejects(
    () =>
      ctx.artifacts.mapExplicit({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        fromArtifact: true,
        artifact_id: attached.artifact_id,
      }),
    (error) => isCoded(error, "MAPPING_NOT_EXPLICIT")
  );
  const refs = seedBundle(ctx.profileStore, ctx.schemaStore, SCHOOL_A);
  const template = await ctx.configuration.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    spec: validTemplate(),
  });
  const mapped = await ctx.artifacts.mapExplicit({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    profile: refs.profile,
    schema: refs.schema,
    template: { id: template.template_id, version: template.version },
    artifact_id: attached.artifact_id,
    artifact_version: attached.version,
  });
  assert.equal(mapped.artifact_id, attached.artifact_id);
  assert.equal(mapped.profile.id, refs.profile.id);
  assert.equal(mapped.schema.id, refs.schema.id);
  assert.equal(mapped.template.id, template.template_id);
  assert.equal(ENGINE_ID, "somafrik.report_card.v1");
});

test("report-card-lot11-mapping-explicit-audit-persists-bundle-refs", async () => {
  const ctx = await world();
  const attached = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("map-audit"),
    declaredMime: "application/pdf",
    originalFilename: "map-audit.pdf",
    idempotencyKey: "cmd-map-audit",
  });
  await ctx.configuration.startReview({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ctx.requestId });
  await ctx.configuration.startConfiguring({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ctx.requestId });
  const refs = seedBundle(ctx.profileStore, ctx.schemaStore, SCHOOL_A);
  const template = await ctx.configuration.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    spec: validTemplate(),
  });
  const mapped = await ctx.artifacts.mapExplicit({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    profile: refs.profile,
    schema: refs.schema,
    template: { id: template.template_id, version: template.version },
    artifact_id: attached.artifact_id,
    artifact_version: attached.version,
  });
  const audit = await ctx.artifacts.listAudit({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  const row = audit.find((item) => item.action === "MAP_EXPLICIT");
  assert.ok(row);
  assert.equal(row.artifact_id, attached.artifact_id);
  assert.equal(row.artifact_sha256, attached.sha256);
  assert.equal(row.artifact_version, attached.version);
  assert.equal(row.profile_id, mapped.request.profile_id);
  assert.equal(row.profile_version, mapped.request.profile_version);
  assert.equal(row.profile_spec_sha256, mapped.request.profile_spec_sha256);
  assert.equal(row.schema_id, mapped.request.schema_id);
  assert.equal(row.schema_version, mapped.request.schema_version);
  assert.equal(row.schema_spec_sha256, mapped.request.schema_spec_sha256);
  assert.equal(row.template_id, mapped.request.rendering_template_id);
  assert.equal(row.template_version, mapped.request.rendering_template_version);
  assert.equal(row.template_spec_sha256, mapped.request.rendering_template_spec_sha256);
});

test("report-card-lot11-map-replace-ready-requires-remap", async () => {
  const ctx = await world();
  const first = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("v1"),
    declaredMime: "application/pdf",
    originalFilename: "v1.pdf",
    idempotencyKey: "cmd-v1",
  });
  await ctx.configuration.startReview({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ctx.requestId });
  await ctx.configuration.startConfiguring({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ctx.requestId });
  const refs = seedBundle(ctx.profileStore, ctx.schemaStore, SCHOOL_A);
  const template = await ctx.configuration.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    spec: validTemplate(),
  });
  await ctx.artifacts.mapExplicit({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    profile: refs.profile,
    schema: refs.schema,
    template: { id: template.template_id, version: template.version },
    artifact_id: first.artifact_id,
    artifact_version: first.version,
  });
  const second = await ctx.artifacts.replaceCurrent({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("v2"),
    declaredMime: "application/pdf",
    originalFilename: "v2.pdf",
    idempotencyKey: "cmd-v2",
  });
  await assert.rejects(
    () =>
      ctx.artifacts.markReadyForReview({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      }),
    (error) => isCoded(error, "MAPPING_REQUIRED") || isCoded(error, "HASH_MISMATCH")
  );
  await ctx.artifacts.mapExplicit({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    profile: refs.profile,
    schema: refs.schema,
    template: { id: template.template_id, version: template.version },
    artifact_id: second.artifact_id,
    artifact_version: second.version,
  });
  const ready = await ctx.artifacts.markReadyForReview({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  assert.equal(ready.status, "READY_FOR_REVIEW");
  assert.equal(ready.artifact_id, second.artifact_id);
  assert.equal(ready.artifact_sha256, second.sha256);
});

test("report-card-lot11-rebind-same-artifact-ready-requires-remap", async () => {
  const ctx = await world();
  const attached = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("rebind"),
    declaredMime: "application/pdf",
    originalFilename: "rebind.pdf",
    idempotencyKey: "cmd-rebind",
  });
  await ctx.configuration.startReview({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ctx.requestId });
  await ctx.configuration.startConfiguring({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ctx.requestId });
  const refsX = seedBundle(ctx.profileStore, ctx.schemaStore, SCHOOL_A);
  const refsY = seedBundle(ctx.profileStore, ctx.schemaStore, SCHOOL_A);
  const template = await ctx.configuration.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    spec: validTemplate(),
  });
  await ctx.artifacts.mapExplicit({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    profile: refsX.profile,
    schema: refsX.schema,
    template: { id: template.template_id, version: template.version },
    artifact_id: attached.artifact_id,
    artifact_version: attached.version,
  });
  await ctx.configuration.bindBundle({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    profile: refsY.profile,
    schema: refsY.schema,
    template: { id: template.template_id, version: template.version },
  });
  await assert.rejects(
    () =>
      ctx.artifacts.markReadyForReview({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      }),
    (error) => isCoded(error, "MAPPING_REQUIRED")
  );
  await ctx.artifacts.mapExplicit({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    profile: refsY.profile,
    schema: refsY.schema,
    template: { id: template.template_id, version: template.version },
    artifact_id: attached.artifact_id,
    artifact_version: attached.version,
  });
  const ready = await ctx.artifacts.markReadyForReview({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  assert.equal(ready.status, "READY_FOR_REVIEW");
  assert.equal(ready.profile_id, refsY.profile.id);
});

test("report-card-lot11-ready-review-references-exact-artifact-version", async () => {
  const ctx = await world();
  await assert.rejects(
    () =>
      ctx.artifacts.markReadyForReview({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      }),
    (error) =>
      isCoded(error, "ARTIFACT_REQUIRED") ||
      isCoded(error, "INVALID_TRANSITION") ||
      isCoded(error, "INVALID_BUNDLE")
  );
  const attached = await ctx.artifacts.attachToRequest({
    actor: schoolSubmit(SCHOOL_A),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    bytes: pdfBytes("ready"),
    declaredMime: "application/pdf",
    originalFilename: "ready.pdf",
    idempotencyKey: "cmd-ready",
  });
  await ctx.configuration.startReview({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ctx.requestId });
  await ctx.configuration.startConfiguring({ actor: superadmin(), schoolId: SCHOOL_A, requestId: ctx.requestId });
  const refs = seedBundle(ctx.profileStore, ctx.schemaStore, SCHOOL_A);
  const template = await ctx.configuration.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    spec: validTemplate(),
  });
  await ctx.artifacts.mapExplicit({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    profile: refs.profile,
    schema: refs.schema,
    template: { id: template.template_id, version: template.version },
    artifact_id: attached.artifact_id,
    artifact_version: attached.version,
  });
  const ready = await ctx.artifacts.markReadyForReview({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  assert.equal(ready.status, "READY_FOR_REVIEW");
  assert.equal(ready.artifact_id, attached.artifact_id);
  assert.equal(ready.artifact_version, attached.version);
  assert.equal(ready.artifact_sha256, attached.sha256);
  const audit = await ctx.artifacts.listAudit({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  assert.equal(
    audit.some(
      (row) =>
        String(row.artifact_id || "") === attached.artifact_id &&
        String(row.artifact_sha256 || row.sha256 || "") === attached.sha256
    ),
    true
  );
});

test("report-card-lot11-pg-replace-uses-db-transaction-lock", () => {
  const storeSrc = fs.readFileSync(path.join(__dirname, "../../db/reportCardSourceArtifactPgStore.js"), "utf8");
  assert.match(storeSrc, /withTx/);
  assert.match(storeSrc, /FOR UPDATE/);
  assert.match(storeSrc, /pg_advisory_xact_lock/);
  const domain = fs.readFileSync(ARTIFACT_SRC, "utf8");
  assert.match(domain, /withTx/);
  assert.match(domain, /compensateBlob|blobs\.remove/);
  const sql = fs.readFileSync(path.join(__dirname, "../../db/reportCardSourceArtifactSql.js"), "utf8");
  assert.match(sql, /profile_spec_sha256/);
  assert.match(sql, /schema_spec_sha256/);
  assert.match(sql, /template_spec_sha256/);
});

test("report-card-lot11-no-country-school-branch", () => {
  const lot11 = requireLot11();
  assert.ok(lot11);
  assert.deepEqual(scanEngineSources(), []);
  const src = fs.readFileSync(ARTIFACT_SRC, "utf8");
  assert.equal(scanText(src).length, 0);
  assert.doesNotMatch(src, /if\s*\(\s*country/);
  assert.doesNotMatch(src, /switch\s*\(\s*school/);
  assert.doesNotMatch(src, /country_pack|countryPack/);
});

test("report-card-lot11-no-engine-recalculation", () => {
  requireLot11();
  const src = fs.readFileSync(ARTIFACT_SRC, "utf8");
  assert.equal(src.includes("computeReportCard"), false);
  const engine = fs.readFileSync(ENGINE_SRC, "utf8");
  assert.doesNotMatch(engine, /sourceArtifact|source_artifact|reportCardSourceArtifact/);
  const webSchool = fs.readFileSync(path.join(ROOT, "web/src/pages/ReportCardSchoolWorkflowPage.tsx"), "utf8");
  const webAdmin = fs.readFileSync(path.join(ROOT, "web/src/pages/ReportCardSuperadminWorkflowPage.tsx"), "utf8");
  assert.equal(webSchool.includes("computeReportCard"), false);
  assert.equal(webAdmin.includes("computeReportCard"), false);
});

test("report-card-lot11-no-mobile-lot12-plus", () => {
  const forbidden = [
    "docs/project/REPORT-CARD-LOT12.md",
    "Mobile/src/screens/ReportCardSourceArtifactUpload.tsx",
    "Mobile/src/screens/ReportCardCountryPack.tsx",
  ];
  for (const rel of forbidden) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), false, rel);
  }
  const pkg = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
  assert.equal(pkg.includes("verify:report-card-lot12"), false);
  assert.equal(RBAC_TOKENS.includes(PERM_SUBMIT), true);
  function walk(dir, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, acc);
      else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.includes(".test.")) acc.push(full);
    }
    return acc;
  }
  const hits = walk(path.join(ROOT, "Mobile/src")).filter((file) => {
    const src = fs.readFileSync(file, "utf8");
    return /source-artifact|sourceArtifact|Envoyer un modèle de bulletin/.test(src);
  });
  assert.deepEqual(hits, []);
});
