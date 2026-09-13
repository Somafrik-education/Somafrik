"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_ID, PUBLISH, PRINT_CONTRACT } = require("../../contracts/reportCard/contract");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const { scanEngineSources } = require("../../contracts/reportCard/noCountrySchoolBranch");
const { computeReportCard } = require("./reportCardEngine");
const { validateSpec: validateProfileSpec } = require("./academicRuleProfile");
const { validateSpec: validateSchemaSpec } = require("./reportCardSchema");
const { createReportCardPublication } = require("./reportCardPublication");

const SCHOOL_A = "school-a";
const TENANT_A = { schoolId: SCHOOL_A, actorSchoolId: SCHOOL_A };
const TENANT_B = { schoolId: "school-b", actorSchoolId: "school-b" };
const SRC = path.join(__dirname, "reportCardPdf.js");

function loadLot5() {
  try {
    return require("./reportCardPdf");
  } catch {
    return null;
  }
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
    tenant: { schoolId: SCHOOL_A, actorSchoolId: SCHOOL_A },
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

function boot(api, overrides = {}) {
  const signingKey = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  const publication = createReportCardPublication({
    signingKey,
    wrapping,
    wrappingKeys: [wrapping],
    signingKeys: [signingKey],
  });
  const launches = [];
  const pdf = api.createReportCardPdf({
    publication,
    pdfDriver: async ({ html }) => {
      launches.push("puppeteer");
      return Buffer.from(`%PDF-mock\n${html}`);
    },
    ...overrides,
  });
  return { publication, pdf, signingKey, wrapping, launches };
}

function publish(publication, payload = snapshotPayload()) {
  return publication.publish({ tenant: TENANT_A, payload });
}

test("report-card-pdf-authenticated-payload-only", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  publish(publication);
  const rendered = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(rendered.payload.engine_id, ENGINE_ID);
  assert.equal(rendered.payload.students[0].student_id, "STU-1");
  assert.match(rendered.html, /STU-1/);
  assert.match(rendered.html, /12/);
  assert.equal(rendered.html.includes("payloadForRender"), false);
  await assert.rejects(
    () => pdf.render({ tenant: TENANT_B, reportCardId: "rc-1", version: 1 }),
    (err) => err.code === "TENANT_MISMATCH" || err.code === "PUBLICATION_NOT_FOUND"
  );
});

test("report-card-pdf-rejects-tampered-snapshot", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  publish(publication);
  const record = publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  record.sealed.canonical_bytes[0] ^= 0xff;
  await assert.rejects(
    () => pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 }),
    (err) =>
      err.code === "SNAPSHOT_INTEGRITY" ||
      err.code === "SNAPSHOT_SIGNATURE_INVALID" ||
      err.code === "SNAPSHOT_SIGNING_KEY_UNKNOWN"
  );
});

test("report-card-pdf-no-live-data-fallback", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  publish(publication);
  const rendered = await pdf.render({
    tenant: TENANT_A,
    reportCardId: "rc-1",
    version: 1,
    live: { students: [{ student_id: "LIVE-HACK", cells: [{ exposed: 99 }] }] },
  });
  const htmlWithoutQr = rendered.html.replace(/data:image\/png;base64,[^"']+/g, "");
  assert.equal(htmlWithoutQr.includes("LIVE-HACK"), false);
  assert.equal(rendered.payload.students.some((row) => row.student_id === "LIVE-HACK"), false);
  assert.match(rendered.html, /STU-1/);
});

test("report-card-pdf-puppeteer-after-commit", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf, launches } = boot(api);
  assert.equal(launches.length, 0);
  publish(publication);
  assert.equal(publication.listOutbox({ tenant: TENANT_A }).length, 1);
  const rendered = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(launches.length, 1);
  assert.equal(launches[0], "puppeteer");
  assert.match(Buffer.from(rendered.pdf).toString("utf8"), /^%PDF/);
  const src = fs.readFileSync(SRC, "utf8");
  assert.match(src, /puppeteer/);
  assert.equal(/\bBEGIN\b|\bCOMMIT\b|\bwithTx\b/.test(src), false);
  assert.equal(/\bpublish\s*\(/.test(src), false);
});

test("report-card-pdf-render-failure-does-not-mutate-publication", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api, {
    pdfDriver: async () => {
      const err = new Error("RENDER_FAIL");
      err.code = "PDF_RENDER_FAILED";
      throw err;
    },
  });
  const published = publish(publication);
  await assert.rejects(
    () => pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 }),
    (err) => err.code === "PDF_RENDER_FAILED"
  );
  const again = publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(again.public_id, published.public_id);
  assert.equal(again.snapshot_sha256, published.snapshot_sha256);
  assert.equal(publication.listOutbox({ tenant: TENANT_A }).length, 1);
});

test("report-card-pdf-deterministic-business-content", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  publish(publication);
  const a = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  const b = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(a.html, b.html);
  assert.equal(a.qr.url, b.qr.url);
  assert.equal(a.payload.published_at, "2026-09-13T00:00:00.000Z");
  const src = fs.readFileSync(SRC, "utf8");
  assert.equal(/\bDate\.now\s*\(|\bnew Date\s*\(/.test(src), false);
});

test("report-card-pdf-no-country-school-branch", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const src = fs.readFileSync(SRC, "utf8");
  assert.equal(/\bcountryCode\b|\biso_code\b|\bschoolName\b/.test(src), false);
  assert.deepEqual(scanEngineSources(), []);
});

test("report-card-pdf-no-external-network-assets", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  publish(publication);
  const rendered = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(/src\s*=\s*["']https?:/i.test(rendered.html), false);
  assert.equal(/href\s*=\s*["']https?:\/\/(?!somafrik\.app\/verify\/)/i.test(rendered.html), false);
  assert.equal(/url\(\s*["']?https?:/i.test(rendered.html), false);
  const src = fs.readFileSync(SRC, "utf8");
  assert.equal(/\bfetch\s*\(/.test(src), false);
});

test("report-card-pdf-escapes-untrusted-text", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  const payload = snapshotPayload();
  payload.students = [
    {
      student_id: "<img src=x onerror=alert(1)>",
      cells: payload.students[0].cells,
      slots: payload.students[0].slots,
      presence: payload.students[0].presence,
    },
  ];
  publication.publish({ tenant: TENANT_A, payload });
  const rendered = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(rendered.html.includes("<img src=x onerror=alert(1)>"), false);
  assert.match(rendered.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(/<script/i.test(rendered.html), false);
});

test("report-card-qr-reuses-existing-capability-token", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  const published = publish(publication);
  const expected = publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  const rendered = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(rendered.qr.url, expected);
  assert.ok(expected.includes(published.public_id));
  assert.match(expected, /^https:\/\/somafrik\.app\/verify\/rc\/[^.]+\.[A-Za-z0-9_-]+$/);
});

test("report-card-qr-never-mints-token", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const src = fs.readFileSync(SRC, "utf8");
  assert.equal(/\bgenerateToken\b|\bmintToken\b/.test(src), false);
  assert.equal(PUBLISH.pdf_mints_token, false);
  const { publication, pdf } = boot(api);
  const published = publish(publication);
  const first = publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  const second = publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(first, second);
  assert.equal(publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 }).public_id, published.public_id);
});

test("report-card-qr-same-version-same-url", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  publish(publication);
  const a = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  const b = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(a.qr.url, b.qr.url);
  publication.publish({
    tenant: TENANT_A,
    payload: snapshotPayload({ published_snapshot_version: 2, published_at: "2026-09-13T01:00:00.000Z" }),
  });
  const v2 = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 2 });
  assert.notEqual(v2.qr.url, a.qr.url);
});

test("report-card-qr-ecc-q", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  publish(publication);
  const rendered = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(PRINT_CONTRACT.ecc, "Q");
  assert.equal(PRINT_CONTRACT.ecc_forbidden, "L");
  assert.equal(rendered.qr.ecc, "Q");
  const src = fs.readFileSync(SRC, "utf8");
  assert.match(src, /errorCorrectionLevel:\s*["']Q["']|PRINT_CONTRACT\.ecc/);
  assert.equal(/errorCorrectionLevel:\s*["']L["']/.test(src), false);
});

test("report-card-qr-quiet-zone-four-modules", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  publish(publication);
  const rendered = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.ok(rendered.qr.quietZoneModules >= PRINT_CONTRACT.quiet_zone_modules);
  assert.ok(rendered.qr.quietZoneModules >= 4);
});

test("report-card-qr-min-print-size", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  publish(publication);
  const rendered = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.ok(rendered.qr.printSizeMm >= 30);
  assert.ok(rendered.qr.printSizeMm >= 25);
  assert.match(rendered.html, /30mm/);
});

test("report-card-qr-roundtrip-scan-exact-url", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  publish(publication);
  const expected = publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  const rendered = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.ok(Buffer.isBuffer(rendered.qr.png) && rendered.qr.png.length > 0);
  assert.equal(rendered.qr.decoded, expected);
  assert.equal(rendered.qr.decoded, rendered.qr.url);
});

test("report-card-pdf-qr-not-clipped-or-page-split", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const { publication, pdf } = boot(api);
  publish(publication);
  const rendered = await pdf.render({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.match(rendered.html, /@page/);
  assert.match(rendered.html, /page-break-inside:\s*avoid/);
  assert.match(rendered.html, /class="[^"]*qr/);
});

test("report-card-lot5-no-lot6-plus-side-effects", async () => {
  const api = loadLot5();
  assert.ok(api, "LOT 5 pdf missing (RED)");
  const src = fs.readFileSync(SRC, "utf8");
  assert.equal(/\bexpress\b|\brouter\.(get|post)\b|\/verify\b/.test(src), false);
  assert.equal(/\bgenerateToken\b|\bmintToken\b|\bpublish\s*\(/.test(src), false);
  const note = fs.readFileSync(path.join(__dirname, "../../../docs/project/REPORT-CARD-LOT5.md"), "utf8");
  assert.match(note, /LOT 6/);
  assert.match(note, /interdit/i);
  const web = path.join(__dirname, "../../../web/src/lib/reportCardsApi.ts");
  const mobile = path.join(__dirname, "../../../Mobile/src/screens/ReportCardsScreen.tsx");
  assert.equal(fs.existsSync(web), true);
  assert.equal(fs.existsSync(mobile), true);
});
