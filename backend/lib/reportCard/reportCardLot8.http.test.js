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
const SERVER_SRC = path.join(ROOT, "backend/server.js");
const RUNTIME_SRC = path.join(ROOT, "backend/lib/reportCardHttpRuntime.js");

const READ = "REPORT_CARD_READ";
const REPRINT = "REPORT_CARD_REPRINT";

function schoolRead(schoolId = SCHOOL_A) {
  return {
    actorId: `read-${schoolId}`,
    actorSchoolId: schoolId,
    permissions: [READ, REPRINT],
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

const LOT8_TEMPLATE = {
  paper: "A4",
  orientation: "portrait",
  qr_required: true,
  sections: [
    { id: "SUMMARY", order: 1, label: "Totaux certifies LOT8", source: "slots" },
    { id: "SUBJECTS", order: 2, label: "Disciplines certifiees LOT8", source: "cells" },
    { id: "APPLICABILITY", order: 3, label: "Presence certifiee LOT8", source: "presence" },
  ],
};

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
  let actor = overrides.actor !== undefined ? overrides.actor : schoolRead();
  const pdfCalls = [];
  const app = express();
  app.use(express.json());
  lot.registerReportCardHttp(app, {
    publication: pub.publication,
    resolveActor: () => actor,
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
          pdf: Buffer.from("%PDF-1.4 lot8-test\n"),
          payload,
          qr: { url: qrUrl },
        };
      },
    }),
    getTemplate: async () => ({ spec: LOT8_TEMPLATE, spec_sha256: "cc" }),
  });
  const bound = await listen(app);
  return {
    publication: pub.publication,
    pdfCalls,
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
    async bin(method, urlPath) {
      const res = await fetch(`${bound.base}${urlPath}`, { method });
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: res.headers, buf };
    },
  };
}

function publishBoth(publication) {
  publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  publication.publish({
    tenant: TENANT_B,
    payload: snapshotPayload({ report_card_id: "rc-b", school_id: SCHOOL_B }),
  });
}

function twoStudentPayload() {
  const base = snapshotPayload();
  const other = JSON.parse(JSON.stringify(base.students[0]));
  other.student_id = "STU-2";
  return snapshotPayload({ students: [base.students[0], other] });
}

function secretLeak(row) {
  if (!row || typeof row !== "object") return [];
  return Object.keys(row).filter((key) => /token_|ciphertext|private/i.test(key));
}

test("report-card-lot8-mobile-list-tenant-scoped", async () => {
  const h = await harness();
  try {
    publishBoth(h.publication);
    h.setActor(schoolRead(SCHOOL_A));
    const listed = await h.json("GET", "/api/report-card/publications");
    assert.equal(listed.status, 200);
    assert.equal(listed.data.ok, true);
    const rows = listed.data.publications;
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].report_card_id, "rc-1");
    assert.equal(rows[0].school_id, SCHOOL_A);
    assert.equal(rows[0].published_snapshot_version, 1);
    assert.ok(rows[0].public_id);
    assert.deepEqual(secretLeak(rows[0]), []);
    h.setActor(schoolRead(SCHOOL_B));
    const listedB = await h.json("GET", "/api/report-card/publications");
    assert.equal(listedB.status, 200);
    assert.equal(listedB.data.publications.length, 1);
    assert.equal(listedB.data.publications[0].report_card_id, "rc-b");
    assert.equal(listedB.data.publications[0].school_id, SCHOOL_B);
  } finally {
    await h.close();
  }
});

test("report-card-lot8-mobile-published-snapshot-only", async () => {
  const h = await harness();
  try {
    const published = h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.setActor(schoolRead(SCHOOL_A));
    const snap = await h.json(
      "GET",
      `/api/report-card/publications/${published.report_card_id}/snapshot?version=1`
    );
    assert.equal(snap.status, 200);
    assert.equal(snap.data.ok, true);
    assert.equal(snap.data.payload.engine_id, ENGINE_ID);
    assert.equal(snap.data.payload.report_card_id, "rc-1");
    assert.equal(snap.data.payload.published_snapshot_version, 1);
    assert.equal(snap.data.payload.students[0].student_id, "STU-1");
    assert.equal(
      snap.data.payload.students[0].cells[0].exposed,
      published.sealed.payload.students[0].cells[0].exposed
    );
    const src = fs.readFileSync(HTTP_SRC, "utf8");
    assert.match(src, /payloadForRender/);
    assert.equal(/\bcomputeReportCard\b/.test(src), false);
    assert.equal(/\braw_score\b/.test(src), false);
  } finally {
    await h.close();
  }
});

test("report-card-lot8-mobile-no-live-grade-fallback", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.setActor(schoolRead(SCHOOL_A));
    const listed = await h.json("GET", "/api/report-card/publications");
    assert.equal(listed.status, 200);
    const src = fs.readFileSync(HTTP_SRC, "utf8");
    assert.equal(/\/api\/report-cards(?!\/verify)/.test(src), false);
    assert.equal(src.includes("/students/") && src.includes("report.pdf"), false);
    assert.equal(/\bgrades\b/.test(src) && /from\s+grades/.test(src), false);
    const pdf = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=1");
    assert.equal(pdf.status, 200);
    assert.equal(h.pdfCalls.length, 1);
    assert.equal(h.pdfCalls[0].reportCardId, "rc-1");
  } finally {
    await h.close();
  }
});

test("report-card-lot8-mobile-no-recalculation", async () => {
  const h = await harness();
  try {
    const payload = snapshotPayload();
    const publishedTotal = payload.students[0].slots.find((slot) => slot.slot === "TOTAL");
    h.publication.publish({ tenant: TENANT_A, payload });
    h.setActor(schoolRead(SCHOOL_A));
    const snap = await h.json("GET", "/api/report-card/publications/rc-1/snapshot?version=1");
    assert.equal(snap.status, 200);
    const returned = snap.data.payload.students[0].slots.find((slot) => slot.slot === "TOTAL");
    if (publishedTotal) {
      assert.equal(returned.exposed, publishedTotal.exposed);
    }
    const src = fs.readFileSync(HTTP_SRC, "utf8");
    assert.equal(/\bcomputeReportCard\b/.test(src), false);
    assert.equal(/\baggregation\b/.test(src), false);
    assert.equal(/\branking\b/.test(src), false);
    assert.equal(/\bpass_rule\b/.test(src), false);
  } finally {
    await h.close();
  }
});

test("report-card-lot8-mobile-pdf-reuses-lot5", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.setActor(schoolRead(SCHOOL_A));
    const pdf = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=1");
    assert.equal(pdf.status, 200);
    assert.match(String(pdf.headers.get("content-type") || ""), /application\/pdf/i);
    assert.equal(pdf.buf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(h.pdfCalls.length, 1);
    assert.deepEqual(h.pdfCalls[0].tenant, TENANT_A);
    assert.equal(h.pdfCalls[0].reportCardId, "rc-1");
    assert.equal(h.pdfCalls[0].version, 1);
    const httpSrc = fs.readFileSync(HTTP_SRC, "utf8");
    assert.equal(/\bcreateReportCardPdf\b/.test(httpSrc), false);
    assert.equal(/\bgenerateToken\b/.test(httpSrc), false);
    const glue = `${fs.readFileSync(SERVER_SRC, "utf8")}\n${fs.readFileSync(RUNTIME_SRC, "utf8")}`;
    assert.match(glue, /createReportCardPdf/);
    assert.match(httpSrc, /getPdf|deps\.pdf|renderPdf/);
  } finally {
    await h.close();
  }
});

test("report-card-lot8-mobile-rbac-server-authoritative", async () => {
  const h = await harness({ actor: null });
  try {
    const listed = await h.json("GET", "/api/report-card/publications");
    assert.equal(listed.status, 403);
    h.setActor({
      actorId: "none",
      actorSchoolId: SCHOOL_A,
      permissions: [],
    });
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    const denied = await h.json("GET", "/api/report-card/publications");
    assert.equal(denied.status, 403);
    const deniedSnap = await h.json("GET", "/api/report-card/publications/rc-1/snapshot?version=1");
    assert.equal(deniedSnap.status, 403);
    const deniedPdf = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=1");
    assert.equal(deniedPdf.status, 403);
    h.setActor({
      actorId: "read-only",
      actorSchoolId: SCHOOL_A,
      permissions: [READ],
    });
    const listedRead = await h.json("GET", "/api/report-card/publications");
    assert.equal(listedRead.status, 200);
    const pdfWithoutReprint = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=1");
    assert.equal(pdfWithoutReprint.status, 403);
    h.setActor(schoolRead(SCHOOL_A));
    const ok = await h.json("GET", "/api/report-card/publications");
    assert.equal(ok.status, 200);
    const snap = await h.json("GET", "/api/report-card/publications/rc-1/snapshot?version=1");
    assert.equal(snap.status, 200);
    const pdf = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=1");
    assert.equal(pdf.status, 200);
    h.setActor({
      actorId: "spoof-write",
      actorSchoolId: SCHOOL_A,
      permissions: [READ, REPRINT],
      role: "Admin School",
    });
    const mint = await h.json("POST", "/api/report-card/publications", { reportCardId: "rc-1" });
    assert.ok([403, 404, 405].includes(mint.status));
    const httpSrc = fs.readFileSync(HTTP_SRC, "utf8");
    assert.equal(/\bgenerateToken\b/.test(httpSrc), false);
    assert.match(httpSrc, /REPORT_CARD_READ/);
    assert.match(httpSrc, /REPORT_CARD_REPRINT/);
  } finally {
    await h.close();
  }
});

test("report-card-lot8-mobile-cross-tenant-forbidden", async () => {
  const h = await harness();
  try {
    publishBoth(h.publication);
    h.setActor(schoolRead(SCHOOL_B));
    const listed = await h.json("GET", "/api/report-card/publications");
    assert.equal(listed.status, 200);
    assert.equal(
      listed.data.publications.some((row) => row.report_card_id === "rc-1"),
      false
    );
    const snap = await h.json("GET", "/api/report-card/publications/rc-1/snapshot?version=1");
    assert.ok([403, 404].includes(snap.status));
    const pdf = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=1");
    assert.ok([403, 404].includes(pdf.status));
  } finally {
    await h.close();
  }
});

test("report-card-lot8-actor-read-maps-bulletins-read", () => {
  const actor = resolveReportCardActorFromPrincipal({
    sub: "parent-1",
    schoolId: SCHOOL_A,
    role: "parent_student",
    permissions: ["Bulletins:READ"],
    user: { children: [{ id: "STU-1", studentId: "STU-1" }] },
  });
  assert.equal(actor.permissions.includes(READ), true);
  assert.equal(actor.permissions.includes(REPRINT), true);
  assert.equal(actor.permissions.includes("REPORT_CARD_SUBMIT_MODEL"), false);
  assert.equal(actor.permissions.includes("REPORT_CARD_SCHOOL_APPROVE_TEMPLATE"), false);
  assert.ok(actor.studentIds.includes("STU-1"));
  const empty = resolveReportCardActorFromPrincipal({
    sub: "none",
    schoolId: SCHOOL_A,
    role: "Admin School",
    permissions: [],
  });
  assert.equal(empty.permissions.includes(READ), false);
  assert.equal(empty.studentIds, undefined);
});

test("report-card-lot8-mobile-student-scope-server-authoritative", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: twoStudentPayload() });
    h.setActor(parentRead("STU-1"));
    const listed = await h.json("GET", "/api/report-card/publications");
    assert.equal(listed.status, 200);
    assert.equal(listed.data.publications.length, 1);
    const snap = await h.json("GET", "/api/report-card/publications/rc-1/snapshot?version=1");
    assert.equal(snap.status, 200);
    const ids = (snap.data.payload.students || []).map((row) => row.student_id);
    assert.deepEqual(ids, ["STU-1"]);
    assert.equal(ids.includes("STU-2"), false);
    const pdf = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=1");
    assert.equal(pdf.status, 200);
    const pdfStudents = (h.pdfCalls.at(-1).payload.students || []).map((row) => row.student_id);
    assert.deepEqual(pdfStudents, ["STU-1"]);
    h.setActor(parentRead("STU-MISSING"));
    const hidden = await h.json("GET", "/api/report-card/publications");
    assert.equal(hidden.status, 200);
    assert.equal(hidden.data.publications.length, 0);
    const denied = await h.json("GET", "/api/report-card/publications/rc-1/snapshot?version=1");
    assert.ok([403, 404].includes(denied.status));
    const deniedPdf = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=1");
    assert.ok([403, 404].includes(deniedPdf.status));
  } finally {
    await h.close();
  }
});

test("report-card-lot8-mobile-current-active-publication-only", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
    h.publication.publish({
      tenant: TENANT_A,
      payload: snapshotPayload({ published_snapshot_version: 2 }),
    });
    h.setActor(schoolRead(SCHOOL_A));
    const listed = await h.json("GET", "/api/report-card/publications");
    assert.equal(listed.status, 200);
    assert.equal(listed.data.publications.length, 1);
    assert.equal(listed.data.publications[0].published_snapshot_version, 2);
    assert.equal(listed.data.publications[0].verification_status, "ACTIVE");
    const stale = await h.json("GET", "/api/report-card/publications/rc-1/snapshot?version=1");
    assert.ok([403, 404].includes(stale.status));
    const current = await h.json("GET", "/api/report-card/publications/rc-1/snapshot?version=2");
    assert.equal(current.status, 200);
    const src = fs.readFileSync(HTTP_SRC, "utf8");
    assert.match(src, /listCurrent/);
    assert.equal(/listOutbox\s*\(/.test(src), false);
  } finally {
    await h.close();
  }
});

test("report-card-lot8-mobile-uses-published-rendering-template", async () => {
  const h = await harness();
  try {
    const payload = snapshotPayload({
      provenance: {
        ...snapshotPayload().provenance,
        template: { id: "TPL-1", version: 1, spec_sha256: "cc" },
      },
    });
    h.publication.publish({ tenant: TENANT_A, payload });
    h.setActor(schoolRead(SCHOOL_A));
    const snap = await h.json("GET", "/api/report-card/publications/rc-1/snapshot?version=1");
    assert.equal(snap.status, 200);
    assert.equal(snap.data.template.sections[0].label, "Totaux certifies LOT8");
    const pdf = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=1");
    assert.equal(pdf.status, 200);
    assert.equal(h.pdfCalls.at(-1).renderingTemplate.sections[0].label, "Totaux certifies LOT8");
  } finally {
    await h.close();
  }
});

function capabilityFromQrUrl(url) {
  const marker = "/verify/rc/";
  const text = String(url || "");
  const idx = text.indexOf(marker);
  assert.ok(idx >= 0, "PDF QR must reuse LOT 4/5 capability URL");
  return text.slice(idx + marker.length);
}

test("report-card-lot8-mobile-pdf-qr-does-not-leak-other-students", async () => {
  const h = await harness();
  try {
    h.publication.publish({ tenant: TENANT_A, payload: twoStudentPayload() });
    h.setActor(parentRead("STU-1"));
    const pdfCallsBefore = h.pdfCalls.length;
    const pdf = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=1");
    if (pdf.status === 200) {
      const qrUrl = h.pdfCalls.at(-1) && h.pdfCalls.at(-1).qrUrl;
      const verified = await h.json("POST", "/api/public/report-cards/verify", {
        capability: capabilityFromQrUrl(qrUrl),
      });
      assert.equal(verified.status, 200);
      assert.equal(verified.data.ok, true);
      const ids = (verified.data.payload.students || []).map((row) => row.student_id);
      assert.equal(ids.includes("STU-1"), true);
      assert.equal(ids.includes("STU-2"), false);
    } else {
      assert.ok([403, 404].includes(pdf.status));
      assert.equal(h.pdfCalls.length, pdfCallsBefore);
    }

    h.setActor(schoolRead(SCHOOL_A));
    const staffPdf = await h.bin("GET", "/api/report-card/publications/rc-1/pdf?version=1");
    assert.equal(staffPdf.status, 200);
    const staffVerified = await h.json("POST", "/api/public/report-cards/verify", {
      capability: capabilityFromQrUrl(h.pdfCalls.at(-1).qrUrl),
    });
    assert.equal(staffVerified.status, 200);
    const staffIds = (staffVerified.data.payload.students || []).map((row) => row.student_id);
    assert.deepEqual(staffIds, ["STU-1", "STU-2"]);

    h.publication.publish({
      tenant: TENANT_A,
      payload: snapshotPayload({ report_card_id: "rc-solo" }),
    });
    h.setActor(parentRead("STU-1"));
    const soloPdf = await h.bin("GET", "/api/report-card/publications/rc-solo/pdf?version=1");
    assert.equal(soloPdf.status, 200);
    const soloVerified = await h.json("POST", "/api/public/report-cards/verify", {
      capability: capabilityFromQrUrl(h.pdfCalls.at(-1).qrUrl),
    });
    assert.equal(soloVerified.status, 200);
    const soloIds = (soloVerified.data.payload.students || []).map((row) => row.student_id);
    assert.deepEqual(soloIds, ["STU-1"]);
    assert.equal(soloIds.includes("STU-2"), false);

    const httpSrc = fs.readFileSync(HTTP_SRC, "utf8");
    assert.equal(/\bgenerateToken\b/.test(httpSrc), false);
    assert.equal(httpSrc.includes("createReportCardPdf"), false);
  } finally {
    await h.close();
  }
});
