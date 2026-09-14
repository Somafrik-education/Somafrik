"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { ENGINE_ID } = require("../../contracts/reportCard/contract");
const { resolveReportCardActorFromPrincipal } = require("../reportCardHttpActor");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const { createReportCardPublication } = require("./reportCardPublication");
const { computeReportCard } = require("./reportCardEngine");
const { validateSpec: validateProfileSpec } = require("./academicRuleProfile");
const { validateSpec: validateSchemaSpec } = require("./reportCardSchema");

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const TENANT_A = { schoolId: SCHOOL_A, actorSchoolId: SCHOOL_A };
const TENANT_B = { schoolId: SCHOOL_B, actorSchoolId: SCHOOL_B };
const ROOT = path.resolve(__dirname, "../../..");
const HTTP_SRC = path.join(__dirname, "reportCardHttp.js");
const PUB_SRC = path.join(__dirname, "reportCardPublication.js");

const READ = "REPORT_CARD_READ";
const REPRINT = "REPORT_CARD_REPRINT";
const CORRECT = "REPORT_CARD_CORRECT";
const REVOKE = "REPORT_CARD_REVOKE";

function schoolRead(schoolId = SCHOOL_A) {
  return {
    actorId: `read-${schoolId}`,
    actorSchoolId: schoolId,
    permissions: [READ, REPRINT],
  };
}

function schoolCorrect(schoolId = SCHOOL_A) {
  return {
    actorId: `correct-${schoolId}`,
    actorSchoolId: schoolId,
    permissions: [READ, REPRINT, CORRECT, REVOKE],
  };
}

function parentRead(studentId = "STU-1", schoolId = SCHOOL_A) {
  return {
    actorId: `parent-${studentId}`,
    actorSchoolId: schoolId,
    permissions: [READ, REPRINT],
    studentIds: [studentId],
  };
}

const TEMPLATE = {
  paper: "A4",
  orientation: "portrait",
  qr_required: true,
  sections: [
    { id: "SUMMARY", order: 1, label: "Totaux LOT9", source: "slots" },
    { id: "SUBJECTS", order: 2, label: "Disciplines LOT9", source: "cells" },
    { id: "APPLICABILITY", order: 3, label: "Presence LOT9", source: "presence" },
  ],
};

function engineResult(rawScore = 12, provenanceExtra = {}) {
  const profile = validateProfileSpec({
    periods: ["T1", "T2"],
    annual: true,
    score_components: [{ id: "TJ", applicability: "always", max: 20, coefficient: 1 }],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up" },
    ranking: { enabled: false, ties: "competition" },
  });
  const schema = validateSpecSchema();
  return computeReportCard({
    profile,
    schema,
    facts: [
      {
        student_id: "STU-1",
        subject_id: "MATH",
        period_id: "T1",
        score_component_id: "TJ",
        raw_score: rawScore,
        subject_applicable: true,
      },
    ],
    provenance: {
      profile: { id: "PROF-1", version: 1, spec_sha256: "aa" },
      schema: { id: "SCH-1", version: 1, spec_sha256: "bb" },
      ...provenanceExtra,
    },
    tenant: TENANT_A,
  });
}

function validateSpecSchema() {
  return validateSchemaSpec({
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
}

function snapshotPayload(overrides = {}, rawScore = 12) {
  const result = engineResult(rawScore, {
    template: { id: "TPL-1", version: 1, spec_sha256: "cc" },
  });
  return {
    report_card_id: "rc-1",
    published_snapshot_version: 1,
    school_id: SCHOOL_A,
    published_at: "2026-09-14T00:00:00.000Z",
    engine_id: result.engine_id,
    provenance: result.provenance,
    students: result.students,
    ...overrides,
  };
}

function bootPublication() {
  const signingKey = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  const publication = createReportCardPublication({
    signingKey,
    wrapping,
    wrappingKeys: [wrapping],
    signingKeys: [signingKey],
  });
  return { publication, signingKey, wrapping };
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

function secretLeak(row) {
  if (!row || typeof row !== "object") return [];
  return Object.keys(row).filter((key) => /token_|ciphertext|private/i.test(key));
}

function capabilityFromQrUrl(url) {
  const marker = "/verify/rc/";
  const text = String(url || "");
  const idx = text.indexOf(marker);
  assert.ok(idx >= 0, "QR must reuse LOT 4/5 capability URL");
  return text.slice(idx + marker.length);
}

function loadHttp() {
  try {
    return require("./reportCardHttp");
  } catch {
    return null;
  }
}

async function harness(overrides = {}) {
  const lot = loadHttp();
  assert.ok(lot && typeof lot.registerReportCardHttp === "function", "LOT HTTP missing (RED)");
  const pub = bootPublication();
  let actor = overrides.actor !== undefined ? overrides.actor : schoolCorrect();
  const pdfCalls = [];
  const factCalls = [];
  const app = express();
  app.use(express.json());
  lot.registerReportCardHttp(app, {
    publication: pub.publication,
    resolveActor: () => actor,
    getFacts: async (args) => {
      factCalls.push(args);
      return [
        {
          student_id: "STU-1",
          subject_id: "MATH",
          period_id: "T1",
          score_component_id: "TJ",
          raw_score: 16,
          subject_applicable: true,
        },
      ];
    },
    getPdf: () => ({
      render: async (args) => {
        const payload =
          args.payload ||
          (await pub.publication.payloadForRender({
            tenant: args.tenant,
            reportCardId: args.reportCardId,
            version: args.version,
          }));
        const qrUrl = await Promise.resolve(
          pub.publication.reprintUrl({
            tenant: args.tenant,
            reportCardId: args.reportCardId,
            version: args.version,
          })
        );
        pdfCalls.push({ ...args, payload, qrUrl });
        return {
          pdf: Buffer.from("%PDF-1.4 lot9-test\n"),
          payload,
          qr: { url: qrUrl },
        };
      },
    }),
    getTemplate: async () => ({ spec: TEMPLATE, spec_sha256: "cc" }),
    getProfile: async () =>
      validateProfileSpec({
        periods: ["T1", "T2"],
        annual: true,
        score_components: [{ id: "TJ", applicability: "always", max: 20, coefficient: 1 }],
        missing_score: "NOT_APPLICABLE_not_zero",
        rounding: { decimals: 2, mode: "half_up" },
        ranking: { enabled: false, ties: "competition" },
      }),
    getSchema: async () => validateSpecSchema(),
  });
  const bound = await listen(app);
  return {
    publication: pub.publication,
    pdfCalls,
    factCalls,
    setActor(next) {
      actor = next;
    },
    close: bound.close,
    async json(method, urlPath, body, headers = {}) {
      const res = await fetch(`${bound.base}${urlPath}`, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
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
    async bin(method, urlPath) {
      const res = await fetch(`${bound.base}${urlPath}`, { method });
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: res.headers, buf };
    },
  };
}

function twoStudentPayload() {
  const base = snapshotPayload();
  const other = JSON.parse(JSON.stringify(base.students[0]));
  other.student_id = "STU-2";
  return snapshotPayload({ students: [base.students[0], other] });
}

test("report-card-lot9-history-tenant-scoped", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.publication.publish({
      tenant: TENANT_B,
      payload: snapshotPayload({ report_card_id: "rc-b", school_id: SCHOOL_B }),
    });
    h.setActor(schoolRead(SCHOOL_A));
    const listed = await h.json("GET", "/api/report-card/publications/rc-1/history");
    assert.equal(listed.status, 200);
    assert.equal(listed.data.ok, true);
    const versions = listed.data.versions;
    assert.ok(Array.isArray(versions));
    assert.equal(versions.length, 1);
    assert.equal(versions[0].report_card_id, "rc-1");
    assert.equal(versions[0].school_id, SCHOOL_A);
    assert.equal(versions[0].published_snapshot_version, 1);
    assert.ok(versions[0].public_id);
    assert.ok(versions[0].snapshot_sha256);
    assert.ok(versions[0].signing_key_id);
    assert.deepEqual(secretLeak(versions[0]), []);
    h.setActor(schoolRead(SCHOOL_B));
    const other = await h.json("GET", "/api/report-card/publications/rc-1/history");
    assert.ok([403, 404].includes(other.status));
  } finally {
    await h.close();
  }
});

test("report-card-lot9-history-student-scoped", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: twoStudentPayload() });
    h.setActor(parentRead("STU-1"));
    const ok = await h.json("GET", "/api/report-card/publications/rc-1/history");
    assert.equal(ok.status, 200);
    assert.equal(ok.data.versions.length, 1);
    h.setActor(parentRead("STU-MISSING"));
    const hidden = await h.json("GET", "/api/report-card/publications/rc-1/history");
    assert.ok([200, 403, 404].includes(hidden.status));
    if (hidden.status === 200) {
      assert.equal((hidden.data.versions || []).length, 0);
    }
  } finally {
    await h.close();
  }
});

test("report-card-lot9-history-orders-versions", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.setActor(schoolCorrect());
    const corrected = await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
      sourceVersion: 1,
      reason: "Erreur de saisie TJ",
      commandId: "cmd-order-1",
    });
    assert.equal(corrected.status, 201);
    const history = await h.json("GET", "/api/report-card/publications/rc-1/history");
    assert.equal(history.status, 200);
    const versions = history.data.versions.map((row) => row.published_snapshot_version);
    assert.deepEqual(versions, [1, 2]);
    assert.equal(history.data.versions[0].verification_status, "SUPERSEDED");
    assert.equal(history.data.versions[1].verification_status, "ACTIVE");
  } finally {
    await h.close();
  }
});

test("report-card-lot9-current-exposes-active-only", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.setActor(schoolCorrect());
    const corrected = await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
      sourceVersion: 1,
      reason: "Correction notes",
      commandId: "cmd-current-1",
    });
    assert.equal(corrected.status, 201);
    h.setActor(schoolRead());
    const listed = await h.json("GET", "/api/report-card/publications");
    assert.equal(listed.status, 200);
    assert.equal(listed.data.publications.length, 1);
    assert.equal(listed.data.publications[0].published_snapshot_version, 2);
    assert.equal(listed.data.publications[0].verification_status, "ACTIVE");
  } finally {
    await h.close();
  }
});

test("report-card-lot9-superseded-remains-verifiable", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    const v1Url = await Promise.resolve(
      h.publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 })
    );
    h.setActor(schoolCorrect());
    const corrected = await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
      sourceVersion: 1,
      reason: "Correction",
      commandId: "cmd-verify-1",
    });
    assert.equal(corrected.status, 201);
    const v1Again = await Promise.resolve(
      h.publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 })
    );
    assert.equal(v1Again, v1Url);
    const verified = await h.json("POST", "/api/public/report-cards/verify", {
      capability: capabilityFromQrUrl(v1Url),
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.data.ok, true);
    assert.equal(verified.data.verification_status, "superseded");
    assert.equal(verified.data.payload.published_snapshot_version, 1);
    assert.equal(verified.data.payload.engine_id, ENGINE_ID);
  } finally {
    await h.close();
  }
});

test("report-card-lot9-historical-pdf-keeps-original-qr", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    const originalUrl = await Promise.resolve(
      h.publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 })
    );
    h.setActor(schoolCorrect());
    assert.equal(
      (
        await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
          sourceVersion: 1,
          reason: "Correction PDF",
          commandId: "cmd-pdf-1",
        })
      ).status,
      201
    );
    h.setActor(schoolRead());
    const pdf = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=1");
    assert.equal(pdf.status, 200);
    assert.equal(h.pdfCalls.at(-1).qrUrl, originalUrl);
    const currentPdf = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=2");
    assert.equal(currentPdf.status, 200);
    assert.notEqual(h.pdfCalls.at(-1).qrUrl, originalUrl);
  } finally {
    await h.close();
  }
});

test("report-card-lot9-correction-requires-rbac-and-reason", async () => {
  const h = await harness({ actor: schoolRead() });
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    const denied = await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
      sourceVersion: 1,
      reason: "Sans droit",
      commandId: "cmd-rbac-1",
    });
    assert.equal(denied.status, 403);
    h.setActor(schoolCorrect());
    const missing = await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
      sourceVersion: 1,
      reason: "   ",
      commandId: "cmd-rbac-2",
    });
    assert.ok([400, 403].includes(missing.status));
    const actor = resolveReportCardActorFromPrincipal({
      sub: "prov",
      schoolId: SCHOOL_A,
      role: "Proviseur",
      permissions: ["Bulletins:READ", "Bulletins:SUSPEND", "Bulletins:DELETE"],
    });
    assert.equal(actor.permissions.includes(CORRECT), true);
    assert.equal(actor.permissions.includes(REVOKE), true);
    assert.equal(actor.permissions.includes("REPORT_CARD_SUBMIT_MODEL"), false);
    const readOnly = resolveReportCardActorFromPrincipal({
      sub: "t",
      schoolId: SCHOOL_A,
      role: "Enseignant",
      permissions: ["Bulletins:READ"],
    });
    assert.equal(readOnly.permissions.includes(CORRECT), false);
    assert.equal(readOnly.permissions.includes(REVOKE), false);
  } finally {
    await h.close();
  }
});

test("report-card-lot9-correction-does-not-mutate-source", async () => {
  const h = await harness();
  try {
    const published = h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    const before = h.publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
    h.setActor(schoolCorrect());
    assert.equal(
      (
        await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
          sourceVersion: 1,
          reason: "Ne pas muter v1",
          commandId: "cmd-immut-1",
        })
      ).status,
      201
    );
    const after = h.publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
    assert.equal(after.snapshot_sha256, before.snapshot_sha256);
    assert.equal(after.snapshot_signature, before.snapshot_signature);
    assert.equal(after.public_id, published.public_id);
    assert.equal(after.token_hash, before.token_hash);
    assert.equal(after.token_ciphertext, before.token_ciphertext);
    assert.equal(after.verification_status, "SUPERSEDED");
  } finally {
    await h.close();
  }
});

test("report-card-lot9-correction-server-recalculates-from-pg", async () => {
  const h = await harness();
  try {
    const v1 = snapshotPayload();
    const v1Exposed = v1.students[0].cells[0].exposed;
    h.publication.publish({ tenant: TENANT_A, payload: v1 });
    h.setActor(schoolCorrect());
    const corrected = await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
      sourceVersion: 1,
      reason: "Note TJ corrigee en PG",
      commandId: "cmd-engine-1",
    });
    assert.equal(corrected.status, 201);
    assert.ok(h.factCalls.length >= 1);
    const snap = await h.json("GET", "/api/report-card/publications/rc-1/versions/2");
    assert.equal(snap.status, 200);
    const exposed = snap.data.payload.students[0].cells[0].exposed;
    assert.notEqual(exposed, v1Exposed);
    const httpSrc = fs.readFileSync(HTTP_SRC, "utf8");
    assert.equal(/\bgenerateToken\b/.test(httpSrc), false);
    const corrSrc = path.join(__dirname, "reportCardCorrection.js");
    assert.equal(fs.existsSync(corrSrc), true, "reportCardCorrection.js missing (RED)");
    assert.match(fs.readFileSync(corrSrc, "utf8"), /computeReportCard/);
  } finally {
    await h.close();
  }
});

test("report-card-lot9-correction-pins-original-provenance", async () => {
  const h = await harness();
  try {
    const v1 = snapshotPayload();
    h.publication.publish({ tenant: TENANT_A, payload: v1 });
    h.setActor(schoolCorrect());
    assert.equal(
      (
        await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
          sourceVersion: 1,
          reason: "Pin provenance",
          commandId: "cmd-prov-1",
        })
      ).status,
      201
    );
    const snap = await h.json("GET", "/api/report-card/publications/rc-1/versions/2");
    assert.equal(snap.status, 200);
    assert.deepEqual(snap.data.payload.provenance.profile, v1.provenance.profile);
    assert.deepEqual(snap.data.payload.provenance.schema, v1.provenance.schema);
    assert.deepEqual(snap.data.payload.provenance.template, v1.provenance.template);
  } finally {
    await h.close();
  }
});

test("report-card-lot9-correction-creates-new-version-public-id-token", async () => {
  const h = await harness();
  try {
    const published = h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    const v1Url = await Promise.resolve(
      h.publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 })
    );
    h.setActor(schoolCorrect());
    const corrected = await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
      sourceVersion: 1,
      reason: "Nouvelle identite",
      commandId: "cmd-id-1",
    });
    assert.equal(corrected.status, 201);
    const v2 = h.publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 2 });
    assert.notEqual(v2.public_id, published.public_id);
    const v2Url = await Promise.resolve(
      h.publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 2 })
    );
    assert.notEqual(v2Url, v1Url);
    assert.equal(v2.published_snapshot_version, 2);
  } finally {
    await h.close();
  }
});

test("report-card-lot9-correction-supersedes-old-atomically", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.setActor(schoolCorrect());
    assert.equal(
      (
        await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
          sourceVersion: 1,
          reason: "Atomic",
          commandId: "cmd-atom-1",
        })
      ).status,
      201
    );
    const v1 = h.publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
    const v2 = h.publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 2 });
    assert.equal(v1.verification_status, "SUPERSEDED");
    assert.equal(v2.verification_status, "ACTIVE");
    const current = await h.publication.listCurrent({ tenant: TENANT_A });
    assert.equal(current.filter((row) => row.report_card_id === "rc-1").length, 1);
    assert.equal(current.find((row) => row.report_card_id === "rc-1").published_snapshot_version, 2);
  } finally {
    await h.close();
  }
});

test("report-card-lot9-correction-idempotent", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.setActor(schoolCorrect());
    const body = { sourceVersion: 1, reason: "Idempotent", commandId: "cmd-idem-1" };
    const first = await h.json("POST", "/api/report-card/publications/rc-1/corrections", body);
    const second = await h.json("POST", "/api/report-card/publications/rc-1/corrections", body);
    assert.equal(first.status, 201);
    assert.ok([200, 201].includes(second.status));
    const v2a = first.data.publication.public_id;
    const v2b = second.data.publication.public_id;
    assert.equal(v2a, v2b);
    const conflict = await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
      sourceVersion: 1,
      reason: "Autre motif",
      commandId: "cmd-idem-1",
    });
    assert.equal(conflict.status, 409);
  } finally {
    await h.close();
  }
});

test("report-card-lot9-correction-concurrency-safe", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.setActor(schoolCorrect());
    const [a, b] = await Promise.all([
      h.json("POST", "/api/report-card/publications/rc-1/corrections", {
        sourceVersion: 1,
        reason: "Concurrent A",
        commandId: "cmd-conc-a",
      }),
      h.json("POST", "/api/report-card/publications/rc-1/corrections", {
        sourceVersion: 1,
        reason: "Concurrent B",
        commandId: "cmd-conc-b",
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.equal(statuses.includes(201), true);
    assert.equal(statuses.includes(409), true);
    const current = await h.publication.listCurrent({ tenant: TENANT_A });
    assert.equal(current.filter((row) => row.report_card_id === "rc-1").length, 1);
  } finally {
    await h.close();
  }
});

test("report-card-lot9-correction-cross-tenant-forbidden", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.setActor(schoolCorrect(SCHOOL_B));
    const denied = await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
      sourceVersion: 1,
      reason: "Spoof tenant",
      commandId: "cmd-x-1",
    });
    assert.ok([403, 404].includes(denied.status));
    assert.notEqual(denied.status, 201);
    const v1 = h.publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
    assert.equal(v1.verification_status, "ACTIVE");
    assert.match(fs.readFileSync(HTTP_SRC, "utf8"), /\/corrections/);
  } finally {
    await h.close();
  }
});

test("report-card-lot9-revoke-requires-rbac-and-reason", async () => {
  const h = await harness({ actor: schoolRead() });
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    const denied = await h.json("POST", "/api/report-card/publications/rc-1/versions/1/revoke", {
      reason: "Fraude",
    });
    assert.equal(denied.status, 403);
    h.setActor(schoolCorrect());
    const missing = await h.json("POST", "/api/report-card/publications/rc-1/versions/1/revoke", {
      reason: "",
    });
    assert.ok([400, 403].includes(missing.status));
  } finally {
    await h.close();
  }
});

test("report-card-lot9-revoke-does-not-mutate-snapshot-or-token", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    const before = h.publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
    const url = await Promise.resolve(
      h.publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 })
    );
    h.setActor(schoolCorrect());
    const revoked = await h.json("POST", "/api/report-card/publications/rc-1/versions/1/revoke", {
      reason: "Fraude avérée",
      commandId: "cmd-rev-1",
    });
    assert.equal(revoked.status, 200);
    const after = h.publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
    assert.equal(after.snapshot_sha256, before.snapshot_sha256);
    assert.equal(after.snapshot_signature, before.snapshot_signature);
    assert.equal(after.public_id, before.public_id);
    assert.equal(after.token_hash, before.token_hash);
    assert.equal(after.token_ciphertext, before.token_ciphertext);
    assert.equal(after.verification_status, "REVOKED");
    const urlAfter = await Promise.resolve(
      h.publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 })
    );
    assert.equal(urlAfter, url);
  } finally {
    await h.close();
  }
});

test("report-card-lot9-revoked-remains-publicly-verifiable-as-revoked", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    const url = await Promise.resolve(
      h.publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 })
    );
    h.setActor(schoolCorrect());
    assert.equal(
      (
        await h.json("POST", "/api/report-card/publications/rc-1/versions/1/revoke", {
          reason: "Annulation",
          commandId: "cmd-rev-pub-1",
        })
      ).status,
      200
    );
    const verified = await h.json("POST", "/api/public/report-cards/verify", {
      capability: capabilityFromQrUrl(url),
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.data.ok, true);
    assert.equal(verified.data.verification_status, "revoked");
  } finally {
    await h.close();
  }
});

test("report-card-lot9-revoked-not-current", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.setActor(schoolCorrect());
    assert.equal(
      (
        await h.json("POST", "/api/report-card/publications/rc-1/versions/1/revoke", {
          reason: "Hors circulation",
          commandId: "cmd-rev-cur-1",
        })
      ).status,
      200
    );
    h.setActor(schoolRead());
    const listed = await h.json("GET", "/api/report-card/publications");
    assert.equal(listed.status, 200);
    assert.equal(
      listed.data.publications.some((row) => row.report_card_id === "rc-1"),
      false
    );
  } finally {
    await h.close();
  }
});

test("report-card-lot9-revoke-idempotent-terminal", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.setActor(schoolCorrect());
    const body = { reason: "Terminal", commandId: "cmd-rev-id-1" };
    const first = await h.json("POST", "/api/report-card/publications/rc-1/versions/1/revoke", body);
    const second = await h.json("POST", "/api/report-card/publications/rc-1/versions/1/revoke", body);
    assert.equal(first.status, 200);
    assert.ok([200, 201].includes(second.status));
    const after = h.publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
    assert.equal(after.verification_status, "REVOKED");
    const resurrect = await h.json("POST", "/api/report-card/publications/rc-1/corrections", {
      sourceVersion: 1,
      reason: "Interdit depuis REVOKED",
      commandId: "cmd-rev-corr-1",
    });
    assert.ok([400, 403, 409].includes(resurrect.status));
    assert.equal(
      h.publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 }).verification_status,
      "REVOKED"
    );
  } finally {
    await h.close();
  }
});

test("report-card-lot9-no-client-recalculation", () => {
  const httpSrc = fs.readFileSync(HTTP_SRC, "utf8");
  assert.equal(/\bgenerateToken\b/.test(httpSrc), false);
  assert.equal(httpSrc.includes("createReportCardPdf"), false);
  assert.match(httpSrc, /REPORT_CARD_CORRECT/);
  assert.match(httpSrc, /REPORT_CARD_REVOKE/);
  assert.match(httpSrc, /\/history/);
  assert.match(httpSrc, /corrections/);
  assert.match(httpSrc, /revoke/);
  const pubSrc = fs.readFileSync(PUB_SRC, "utf8");
  assert.match(pubSrc, /listHistory|listVersions/);
});

test("report-card-lot9-correction-idempotent-recovers-after-command-crash", async () => {
  const { createMemoryStore } = require("./reportCardPublication");
  const inner = createMemoryStore();
  let crashRemaining = 1;
  const store = new Proxy(inner, {
    get(target, prop, receiver) {
          if (prop === "insertPublication") {
            return (args) => {
              if (args.command && crashRemaining > 0) {
                const inserted = target.insertPublication({ ...args, command: null });
                crashRemaining -= 1;
                throw new Error("CRASH_AFTER_PUBLISH");
              }
              return target.insertPublication(args);
            };
          }
      return Reflect.get(target, prop, receiver);
    },
  });
  const signingKey = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  const publication = createReportCardPublication({
    signingKey,
    wrapping,
    wrappingKeys: [wrapping],
    signingKeys: [signingKey],
    store,
  });
  const { createReportCardCorrection } = require("./reportCardCorrection");
  const correction = createReportCardCorrection({
    publication,
    getFacts: async () => [
      {
        student_id: "STU-1",
        subject_id: "MATH",
        period_id: "T1",
        score_component_id: "TJ",
        raw_score: 16,
        subject_applicable: true,
      },
    ],
    getProfile: async () =>
      validateProfileSpec({
        periods: ["T1", "T2"],
        annual: true,
        score_components: [{ id: "TJ", applicability: "always", max: 20, coefficient: 1 }],
        missing_score: "NOT_APPLICABLE_not_zero",
        rounding: { decimals: 2, mode: "half_up" },
        ranking: { enabled: false, ties: "competition" },
      }),
    getSchema: async () => validateSpecSchema(),
  });
  publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  const actor = schoolCorrect();
  await assert.rejects(
    () =>
      correction.correct({
        tenant: TENANT_A,
        actor,
        reportCardId: "rc-1",
        sourceVersion: 1,
        reason: "Crash puis retry",
        commandId: "cmd-crash-1",
      }),
    (err) => err && err.message === "CRASH_AFTER_PUBLISH"
  );
  const retried = await correction.correct({
    tenant: TENANT_A,
    actor,
    reportCardId: "rc-1",
    sourceVersion: 1,
    reason: "Crash puis retry",
    commandId: "cmd-crash-1",
  });
  const v2 = publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 2 });
  assert.equal(retried.public_id, v2.public_id);
  const current = publication.listCurrent({ tenant: TENANT_A });
  assert.equal(current.filter((row) => row.report_card_id === "rc-1").length, 1);
  assert.equal(current[0].published_snapshot_version, 2);
});
