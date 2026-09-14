"use strict";

/**
 * LOT 10 — preuves publication / PDF / verify / correction sur les qualifications A/B.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { ENGINE_ID } = require("../../contracts/reportCard/contract");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const { canonicalize } = require("../../contracts/reportCard/jcs");
const { computeReportCard } = require("./reportCardEngine");
const { createReportCardPublication } = require("./reportCardPublication");
const { createReportCardPdf } = require("./reportCardPdf");
const { createReportCardCorrection } = require("./reportCardCorrection");
const { createReportCardInitialPublication } = require("./reportCardInitialPublication");
const { createMemoryFactsStore } = require("../../db/reportCardFactsStore");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { createReportCardConfiguration, createInMemoryConfigurationPersistence } = require("./reportCardConfiguration");
const { registerReportCardHttp } = require("./reportCardHttp");

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const TENANT_A = { schoolId: SCHOOL_A, actorSchoolId: SCHOOL_A };
const TENANT_B = { schoolId: SCHOOL_B, actorSchoolId: SCHOOL_B };
const ROOT = path.resolve(__dirname, "../../..");

function loadLot10() {
  try {
    return require("./reportCardQualification");
  } catch {
    return null;
  }
}

function requireLot10() {
  const lot10 = loadLot10();
  assert.ok(lot10 && typeof lot10.loadQualification === "function", "RED: reportCardQualification missing");
  return lot10;
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

function bootKeys() {
  const signingKey = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  return { signingKey, wrapping, wrappingKeys: [wrapping], signingKeys: [signingKey] };
}

function snapshotFromQualification(bundle, reportCardId, { academicYearId, classId }) {
  const computed = computeReportCard({
    profile: bundle.profile,
    schema: bundle.schema,
    facts: bundle.facts,
    provenance: bundle.provenance,
    tenant: bundle.tenant,
  });
  return {
    report_card_id: reportCardId,
    published_snapshot_version: 1,
    school_id: bundle.tenant.schoolId,
    published_at: "2026-09-14T08:00:00.000Z",
    engine_id: computed.engine_id,
    provenance: {
      profile: computed.provenance.profile,
      schema: computed.provenance.schema,
      template: bundle.provenance.template,
    },
    students: computed.students,
    academic_year_id: academicYearId,
    class_id: classId,
  };
}

test("report-card-lot10-published-snapshot-deterministic", () => {
  const lot10 = requireLot10();
  const a = lot10.loadQualification(lot10.QUALIFICATION_A);
  const first = computeReportCard({
    profile: a.profile,
    schema: a.schema,
    facts: a.facts,
    provenance: a.provenance,
    tenant: a.tenant,
  });
  const second = computeReportCard({
    profile: a.profile,
    schema: a.schema,
    facts: a.facts,
    provenance: a.provenance,
    tenant: a.tenant,
  });
  assert.equal(canonicalize(lot10.canonicalResult(first)), canonicalize(lot10.canonicalResult(second)));
  const keys = bootKeys();
  const publication = createReportCardPublication(keys);
  const payload = snapshotFromQualification(a, "rc-lot10-a", {
    academicYearId: "year-a",
    classId: "class-a",
  });
  const published = publication.publish({ tenant: TENANT_A, payload });
  const again = publication.publish({ tenant: TENANT_A, payload });
  assert.equal(again.public_id, published.public_id);
  const rendered = publication.payloadForRender({ tenant: TENANT_A, reportCardId: "rc-lot10-a", version: 1 });
  assert.equal(rendered.engine_id, ENGINE_ID);
  assert.equal(rendered.academic_year_id, "year-a");
  assert.equal(rendered.class_id, "class-a");
});

test("report-card-lot10-pdf-web-mobile-same-snapshot", async () => {
  const lot10 = requireLot10();
  const a = lot10.loadQualification(lot10.QUALIFICATION_A);
  const keys = bootKeys();
  const publication = createReportCardPublication(keys);
  const payload = snapshotFromQualification(a, "rc-lot10-pdf", {
    academicYearId: "year-a",
    classId: "class-a",
  });
  publication.publish({ tenant: TENANT_A, payload });
  const pdf = createReportCardPdf({
    publication,
    pdfDriver: async ({ html }) => Buffer.from(`%PDF-mock\n${html}`),
  });
  const rendered = await pdf.render({
    tenant: TENANT_A,
    reportCardId: "rc-lot10-pdf",
    version: 1,
    renderingTemplate: a.template,
  });
  assert.equal(rendered.payload.engine_id, ENGINE_ID);
  const cell = payload.students[0].cells[0];
  assert.match(rendered.html, new RegExp(String(cell.subject_id)));
  if (cell.exposed != null) assert.match(rendered.html, new RegExp(String(cell.exposed)));
  const webView = fs.readFileSync(path.join(ROOT, "web/src/components/bulletin/ReportCardSnapshotView.tsx"), "utf8");
  assert.match(webView, /payload\.students/);
  assert.equal(webView.includes("computeReportCard"), false);
  const mobileView = fs.readFileSync(path.join(ROOT, "Mobile/src/components/bulletin/ReportCardSnapshotView.tsx"), "utf8");
  assert.match(mobileView, /payload\.students/);
  assert.equal(mobileView.includes("computeReportCard"), false);
});

test("report-card-lot10-verify-authenticates-published-version", async () => {
  const lot10 = requireLot10();
  const a = lot10.loadQualification(lot10.QUALIFICATION_A);
  const keys = bootKeys();
  const publication = createReportCardPublication(keys);
  const payload = snapshotFromQualification(a, "rc-lot10-verify", {
    academicYearId: "year-a",
    classId: "class-a",
  });
  publication.publish({ tenant: TENANT_A, payload });
  const url = publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-lot10-verify", version: 1 });
  const capability = String(url).split("/").pop();
  const app = express();
  app.use(express.json());
  registerReportCardHttp(app, {
    getPublication: () => publication,
    resolveActor: () => ({
      actorId: "read-a",
      actorSchoolId: SCHOOL_A,
      permissions: ["REPORT_CARD_READ"],
    }),
  });
  const bound = await listen(app);
  try {
    const res = await fetch(`${bound.base}/api/public/report-cards/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.verification_status, "authentic");
    assert.equal(body.payload.engine_id, ENGINE_ID);
    assert.equal(body.payload.academic_year_id, "year-a");
    assert.deepEqual(lot10.canonicalResult(body.payload), lot10.canonicalResult(payload));
  } finally {
    await bound.close();
  }
});

test("report-card-lot10-correction-pins-qualified-provenance", async () => {
  const lot10 = requireLot10();
  const a = lot10.loadQualification(lot10.QUALIFICATION_A);
  const keys = bootKeys();
  const publication = createReportCardPublication(keys);
  const payload = snapshotFromQualification(a, "rc-lot10-corr", {
    academicYearId: "year-a",
    classId: "class-a",
  });
  publication.publish({ tenant: TENANT_A, payload });
  const liveFacts = a.facts.map((row) =>
    row.score_component_id === "COMPONENT_PERIOD" && row.subject_id === a.facts[0].subject_id
      ? { ...row, raw_score: row.raw_score + 1 }
      : row
  );
  const correction = createReportCardCorrection({
    publication,
    getFacts: async () => liveFacts,
    getProfile: async () => a.profile,
    getSchema: async () => a.schema,
  });
  await correction.correct({
    tenant: TENANT_A,
    actor: { actorId: "corr", actorSchoolId: SCHOOL_A, permissions: ["REPORT_CARD_CORRECT"] },
    reportCardId: "rc-lot10-corr",
    sourceVersion: 1,
    reason: "Qualification A",
    commandId: "cmd-lot10-a",
  });
  const v2 = publication.payloadForRender({ tenant: TENANT_A, reportCardId: "rc-lot10-corr", version: 2 });
  assert.equal(v2.published_snapshot_version, 2);
  assert.deepEqual(v2.provenance.profile, payload.provenance.profile);
  assert.deepEqual(v2.provenance.schema, payload.provenance.schema);
  assert.deepEqual(v2.provenance.template, payload.provenance.template);
  assert.equal(v2.academic_year_id, "year-a");
  assert.equal(v2.class_id, "class-a");
});

test("report-card-lot10-tenant-isolation", () => {
  const lot10 = requireLot10();
  const a = lot10.loadQualification(lot10.QUALIFICATION_A);
  const keys = bootKeys();
  const publication = createReportCardPublication(keys);
  const payload = snapshotFromQualification(a, "rc-lot10-iso", {
    academicYearId: "year-a",
    classId: "class-a",
  });
  publication.publish({ tenant: TENANT_A, payload });
  assert.throws(
    () => publication.payloadForRender({ tenant: TENANT_B, reportCardId: "rc-lot10-iso", version: 1 }),
    (err) => err && (err.code === "TENANT_MISMATCH" || err.code === "PUBLICATION_NOT_FOUND")
  );
});

test("report-card-lot10-initial-publication-stamps-class-year", async () => {
  const lot10 = requireLot10();
  assert.equal(typeof lot10.activateQualificationBinding, "function");
  const a = lot10.loadQualification(lot10.QUALIFICATION_A);
  const keys = bootKeys();
  const profileStore = createAcademicRuleProfileStore();
  const schemaStore = createReportCardSchemaStore();
  const createdP = profileStore.createProfile({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileKey: "qual-a",
    spec: a.profile,
    activate: true,
  });
  const createdS = schemaStore.createSchema({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaKey: "qual-a",
    spec: a.schema,
    activate: true,
  });
  const configuration = createReportCardConfiguration({
    profileStore,
    schemaStore,
    persistence: createInMemoryConfigurationPersistence(),
  });
  const bound = await lot10.activateQualificationBinding(configuration, SCHOOL_A, {
    modelKey: a.modelKey,
    profile: { id: createdP.profile.id, version: createdP.version.version },
    schema: { id: createdS.schema.id, version: createdS.version.version },
    templateSpec: a.template,
  });
  const publication = createReportCardPublication(keys);
  const factsStore = createMemoryFactsStore([
    {
      schoolId: SCHOOL_A,
      facts: a.facts,
    },
  ]);
  factsStore.resolveCohort = ({ classId, academicYearId }) => {
    if (classId === "class-a" && academicYearId === "year-a") {
      return { classId, academicYearId };
    }
    return null;
  };
  const initial = createReportCardInitialPublication({ publication, factsStore, configuration });
  await initial.publishInitial({
    tenant: TENANT_A,
    reportCardId: "rc-lot10-init",
    classId: "class-a",
    academicYearId: "year-a",
    modelKey: a.modelKey,
  });
  const v1 = publication.payloadForRender({ tenant: TENANT_A, reportCardId: "rc-lot10-init", version: 1 });
  assert.equal(v1.academic_year_id, "year-a");
  assert.equal(v1.class_id, "class-a");
  assert.equal(v1.provenance.profile.id, createdP.profile.id);
  assert.equal(v1.provenance.schema.id, createdS.schema.id);
  assert.equal(v1.provenance.template.id, bound.template.template_id);
  assert.equal(v1.provenance.template.spec_sha256, bound.template.spec_sha256);
});
