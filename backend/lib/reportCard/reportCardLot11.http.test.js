"use strict";

/**
 * LOT 11 RED — HTTP upload/preview artefact source.
 * Production code modified: NO.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const ROOT = path.resolve(__dirname, "../../..");
const HTTP_SRC = path.join(__dirname, "reportCardHttp.js");
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

function schoolSubmit(schoolId = SCHOOL_A) {
  return {
    actorId: `submit-${schoolId}`,
    actorSchoolId: schoolId,
    permissions: [PERM_SUBMIT],
  };
}

function superadmin() {
  return {
    actorId: "superadmin-1",
    permissions: [PERM_CONFIGURE],
    platform: { privileged: true },
  };
}

function pdfBytes(marker = "http") {
  return Buffer.from(`%PDF-1.4\n%${marker}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
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

async function harness() {
  const lot11 = requireLot11();
  const lot6 = require("./reportCardConfiguration");
  const lot7 = require("./reportCardHttp");
  const profileStore = createAcademicRuleProfileStore();
  const schemaStore = createReportCardSchemaStore();
  const configuration = lot6.createReportCardConfiguration({
    profileStore,
    schemaStore,
    clock: { now: () => "2026-09-14T12:00:00.000Z" },
  });
  const artifacts = lot11.createReportCardSourceArtifact({
    configuration,
    clock: { now: () => "2026-09-14T12:00:00.000Z" },
  });
  let actor = schoolSubmit(SCHOOL_A);
  const app = express();
  app.use(express.json());
  lot7.registerReportCardHttp(app, {
    configuration,
    sourceArtifact: artifacts,
    resolveActor: () => actor,
  });
  const bound = await listen(app);
  return {
    artifacts,
    configuration,
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
    async upload(requestId, bytes, { filename = "modele.pdf", mime = "application/pdf", idempotencyKey = "http-1" } = {}) {
      const res = await fetch(`${bound.base}/api/report-card/requests/${requestId}/source-artifact`, {
        method: "POST",
        headers: {
          "Content-Type": mime,
          "X-Idempotency-Key": idempotencyKey,
          "X-Somafrik-Original-Filename": filename,
        },
        body: bytes,
      });
      const buffer = Buffer.from(await res.arrayBuffer());
      let data = null;
      try {
        data = JSON.parse(buffer.toString("utf8"));
      } catch {
        data = buffer;
      }
      return { status: res.status, headers: res.headers, data, buffer };
    },
    async download(urlPath) {
      const res = await fetch(`${bound.base}${urlPath}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: res.headers, buffer };
    },
  };
}

test("report-card-lot11-upload-requires-rbac-tenant-http", async () => {
  const h = await harness();
  try {
    const created = await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    assert.equal(created.status, 201);
    h.setActor({ actorId: "none", actorSchoolId: SCHOOL_A, permissions: [] });
    const denied = await h.upload(created.data.request.id, pdfBytes("rbac"));
    assert.equal(denied.status, 403);
    assert.equal(denied.data.code === "RBAC_DENIED" || /RBAC/.test(String(denied.data.code || denied.text)), true);
  } finally {
    await h.close();
  }
});

test("report-card-lot11-download-safe-headers", async () => {
  const h = await harness();
  try {
    const created = await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    const uploaded = await h.upload(created.data.request.id, pdfBytes("headers"), {
      filename: 'modele"; filename="evil.pdf',
      idempotencyKey: "http-headers",
    });
    assert.equal(uploaded.status, 201);
    const artifactId = uploaded.data.artifact.artifact_id || uploaded.data.artifact_id;
    const schoolPreview = await h.download(
      `/api/report-card/requests/${created.data.request.id}/source-artifact/content`
    );
    assert.equal(schoolPreview.status, 200);
    const contentType = schoolPreview.headers.get("content-type") || "";
    const disposition = schoolPreview.headers.get("content-disposition") || "";
    assert.match(contentType, /application\/pdf/);
    assert.doesNotMatch(contentType, /text\/html|image\/svg|javascript/i);
    assert.match(disposition, /inline/i);
    assert.doesNotMatch(disposition, /attachment/i);
    assert.doesNotMatch(disposition, /[\r\n]|filename\*=.*evil/i);
    assert.equal(schoolPreview.headers.get("x-content-type-options"), "nosniff");
    assert.match(schoolPreview.headers.get("cache-control") || "", /private/i);
    assert.match(schoolPreview.headers.get("cache-control") || "", /no-store/i);
    assert.equal(Buffer.compare(schoolPreview.buffer, pdfBytes("headers")), 0);
    const downloaded = await h.download(
      `/api/report-card/requests/${created.data.request.id}/source-artifact/content?download=1`
    );
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get("content-disposition") || "", /attachment/i);
    assert.ok(!schoolPreview.headers.get("location") || !/^https?:\/\//.test(schoolPreview.headers.get("location")));
    void artifactId;
  } finally {
    await h.close();
  }
});

test("report-card-lot11-artifact-not-publicly-enumerable", async () => {
  const h = await harness();
  try {
    const created = await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    const uploaded = await h.upload(created.data.request.id, pdfBytes("public"), {
      idempotencyKey: "http-public",
    });
    assert.equal(uploaded.status, 201);
    const artifactId = uploaded.data.artifact?.artifact_id || uploaded.data.artifact_id;
    const storageKey = uploaded.data.artifact?.storage_key;
    h.setActor(null);
    const guesses = [
      `/api/report-card/artifacts/${artifactId}`,
      `/api/report-card/requests/${created.data.request.id}/source-artifact/content`,
      `/api/public/report-card/source-artifact/${artifactId}`,
    ];
    if (storageKey) guesses.push(`/files/${storageKey}`, `/${storageKey}`);
    for (const urlPath of guesses) {
      const res = await h.download(urlPath);
      assert.notEqual(res.status, 200, urlPath);
      assert.ok([401, 403, 404].includes(res.status), `${urlPath} ${res.status}`);
    }
    const httpSrc = fs.readFileSync(HTTP_SRC, "utf8");
    assert.match(httpSrc, /source-artifact/);
    assert.doesNotMatch(httpSrc, /app\.get\(\s*["']\/api\/public\/report-card\/source-artifact/);
  } finally {
    await h.close();
  }
});

test("report-card-lot11-superadmin-preview-http-privileged-only", async () => {
  const h = await harness();
  try {
    const created = await h.json("POST", "/api/report-card/requests", { modelKey: "trimestriel" });
    const uploaded = await h.upload(created.data.request.id, pdfBytes("admin"), {
      idempotencyKey: "http-admin",
    });
    assert.equal(uploaded.status, 201);
    h.setActor(schoolSubmit(SCHOOL_B));
    const cross = await h.json(
      "GET",
      `/api/report-card/admin/requests/${created.data.request.id}/source-artifact?schoolId=${SCHOOL_A}`
    );
    assert.equal(cross.status, 403);
    h.setActor(superadmin());
    const preview = await h.json(
      "GET",
      `/api/report-card/admin/requests/${created.data.request.id}/source-artifact?schoolId=${SCHOOL_A}`
    );
    assert.equal(preview.status, 200);
    assert.equal(preview.data.artifact.school_id, SCHOOL_A);
    assert.ok(preview.data.artifact.sha256);
    const content = await h.download(
      `/api/report-card/admin/requests/${created.data.request.id}/source-artifact/content?schoolId=${SCHOOL_A}`
    );
    assert.equal(content.status, 200);
    assert.match(content.headers.get("content-type") || "", /application\/pdf/);
    assert.match(content.headers.get("content-disposition") || "", /inline/i);
    assert.doesNotMatch(content.headers.get("content-disposition") || "", /attachment/i);
    assert.equal(content.headers.get("x-content-type-options"), "nosniff");
    assert.match(content.headers.get("cache-control") || "", /private.*no-store|no-store.*private/i);
    assert.equal(Buffer.compare(content.buffer, pdfBytes("admin")), 0);
  } finally {
    await h.close();
  }
});

test("report-card-lot11-http-no-bulletin-secrets-in-logs-or-metadata", async () => {
  const httpSrc = fs.readFileSync(HTTP_SRC, "utf8");
  assert.doesNotMatch(httpSrc, /wrapping_key|signing_private|verification_token/);
  const pkg = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
  assert.match(pkg, /verify:report-card-lot11/);
});
