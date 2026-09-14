"use strict";

/**
 * LOT 10 — preuves publication / PDF / verify / correction sur les qualifications A et B.
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

const ROOT = path.resolve(__dirname, "../../..");
const CATALOG_DIR = path.join(__dirname, "qualification");

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

function catalogFileFor(id) {
  for (const name of fs.readdirSync(CATALOG_DIR)) {
    if (!name.endsWith(".json")) continue;
    const abs = path.join(CATALOG_DIR, name);
    const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    if (raw && raw.id === id) return abs;
  }
  return null;
}

function loadStaticGolden(id) {
  const catalogFile = catalogFileFor(id);
  assert.ok(catalogFile, `RED: catalog fixture missing for ${id}`);
  const expectedFile = path.join(CATALOG_DIR, "expected", path.basename(catalogFile));
  assert.equal(fs.existsSync(expectedFile), true, `RED: static golden missing ${expectedFile}`);
  const golden = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
  assert.ok(Array.isArray(golden.canonical) && golden.canonical.length > 0, "RED: golden.canonical required");
  assert.ok(
    golden.snapshot && Array.isArray(golden.snapshot.students) && golden.snapshot.students.length > 0,
    `RED: golden.snapshot required ${expectedFile}`
  );
  return golden;
}

function both(lot10) {
  return [lot10.QUALIFICATION_A, lot10.QUALIFICATION_B].map((id) => {
    const bundle = lot10.loadQualification(id);
    return {
      id,
      bundle,
      golden: loadStaticGolden(id),
      tenant: { schoolId: bundle.tenant.schoolId, actorSchoolId: bundle.tenant.actorSchoolId },
    };
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

function bumpFirstNumericFact(facts) {
  let done = false;
  return facts.map((row) => {
    if (!done && row.raw_score != null && Number.isFinite(Number(row.raw_score))) {
      done = true;
      return { ...row, raw_score: Number(row.raw_score) + 1 };
    }
    return { ...row };
  });
}

test("report-card-lot10-published-snapshot-deterministic", () => {
  const lot10 = requireLot10();
  for (const row of both(lot10)) {
    const first = computeReportCard({
      profile: row.bundle.profile,
      schema: row.bundle.schema,
      facts: row.bundle.facts,
      provenance: row.bundle.provenance,
      tenant: row.bundle.tenant,
    });
    const second = computeReportCard({
      profile: row.bundle.profile,
      schema: row.bundle.schema,
      facts: row.bundle.facts,
      provenance: row.bundle.provenance,
      tenant: row.bundle.tenant,
    });
    assert.equal(canonicalize(lot10.canonicalResult(first)), canonicalize(lot10.canonicalResult(second)));
    assert.deepEqual(lot10.canonicalResult(first), row.golden.canonical);
    const keys = bootKeys();
    const publication = createReportCardPublication(keys);
    const cardId = `rc-lot10-snap-${row.bundle.modelKey}`;
    const payload = snapshotFromQualification(row.bundle, cardId, {
      academicYearId: `year-${row.bundle.modelKey}`,
      classId: `class-${row.bundle.modelKey}`,
    });
    const published = publication.publish({ tenant: row.tenant, payload });
    const again = publication.publish({ tenant: row.tenant, payload });
    assert.equal(again.public_id, published.public_id);
    const rendered = publication.payloadForRender({ tenant: row.tenant, reportCardId: cardId, version: 1 });
    assert.equal(rendered.engine_id, ENGINE_ID);
    assert.equal(rendered.academic_year_id, `year-${row.bundle.modelKey}`);
    assert.equal(rendered.class_id, `class-${row.bundle.modelKey}`);
    assert.deepEqual(lot10.canonicalResult(rendered), row.golden.canonical);
    assert.equal(typeof lot10.normalizePublishedSnapshot, "function", "RED: normalizePublishedSnapshot missing");
    assert.deepEqual(lot10.normalizePublishedSnapshot(rendered), row.golden.snapshot);
    assert.deepEqual(lot10.normalizePublishedSnapshot(payload), row.golden.snapshot);
  }
});

test("report-card-lot10-pdf-web-mobile-same-snapshot", async () => {
  const lot10 = requireLot10();
  for (const row of both(lot10)) {
    const keys = bootKeys();
    const publication = createReportCardPublication(keys);
    const cardId = `rc-lot10-pdf-${row.bundle.modelKey}`;
    const payload = snapshotFromQualification(row.bundle, cardId, {
      academicYearId: `year-${row.bundle.modelKey}`,
      classId: `class-${row.bundle.modelKey}`,
    });
    publication.publish({ tenant: row.tenant, payload });
    const pdf = createReportCardPdf({
      publication,
      pdfDriver: async ({ html }) => Buffer.from(`%PDF-mock\n${html}`),
    });
    const rendered = await pdf.render({
      tenant: row.tenant,
      reportCardId: cardId,
      version: 1,
      renderingTemplate: row.bundle.template,
    });
    assert.equal(rendered.payload.engine_id, ENGINE_ID);
    assert.deepEqual(lot10.canonicalResult(rendered.payload), row.golden.canonical);
    assert.deepEqual(lot10.normalizePublishedSnapshot(rendered.payload), row.golden.snapshot);
    const cell = payload.students[0].cells[0];
    assert.match(rendered.html, new RegExp(String(cell.subject_id)));
    if (cell.exposed != null) assert.match(rendered.html, new RegExp(String(cell.exposed)));
  }
  const webView = fs.readFileSync(path.join(ROOT, "web/src/components/bulletin/ReportCardSnapshotView.tsx"), "utf8");
  assert.match(webView, /payload\.students/);
  assert.equal(webView.includes("computeReportCard"), false);
  const mobileView = fs.readFileSync(path.join(ROOT, "Mobile/src/components/bulletin/ReportCardSnapshotView.tsx"), "utf8");
  assert.match(mobileView, /payload\.students/);
  assert.equal(mobileView.includes("computeReportCard"), false);
});

test("report-card-lot10-verify-authenticates-published-version", async () => {
  const lot10 = requireLot10();
  for (const row of both(lot10)) {
    const keys = bootKeys();
    const publication = createReportCardPublication(keys);
    const cardId = `rc-lot10-verify-${row.bundle.modelKey}`;
    const payload = snapshotFromQualification(row.bundle, cardId, {
      academicYearId: `year-${row.bundle.modelKey}`,
      classId: `class-${row.bundle.modelKey}`,
    });
    publication.publish({ tenant: row.tenant, payload });
    const url = publication.reprintUrl({ tenant: row.tenant, reportCardId: cardId, version: 1 });
    const capability = String(url).split("/").pop();
    const app = express();
    app.use(express.json());
    registerReportCardHttp(app, {
      getPublication: () => publication,
      resolveActor: () => ({
        actorId: `read-${row.bundle.modelKey}`,
        actorSchoolId: row.tenant.schoolId,
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
      assert.equal(body.payload.academic_year_id, `year-${row.bundle.modelKey}`);
      assert.deepEqual(lot10.canonicalResult(body.payload), row.golden.canonical);
      assert.deepEqual(lot10.canonicalResult(body.payload), lot10.canonicalResult(payload));
      assert.deepEqual(lot10.normalizePublishedSnapshot(body.payload), row.golden.snapshot);
    } finally {
      await bound.close();
    }
  }
});

test("report-card-lot10-correction-pins-qualified-provenance", async () => {
  const lot10 = requireLot10();
  for (const row of both(lot10)) {
    const keys = bootKeys();
    const publication = createReportCardPublication(keys);
    const cardId = `rc-lot10-corr-${row.bundle.modelKey}`;
    const yearId = `year-${row.bundle.modelKey}`;
    const classId = `class-${row.bundle.modelKey}`;
    const payload = snapshotFromQualification(row.bundle, cardId, { academicYearId: yearId, classId });
    publication.publish({ tenant: row.tenant, payload });
    const liveFacts = bumpFirstNumericFact(row.bundle.facts);
    const correction = createReportCardCorrection({
      publication,
      getFacts: async () => liveFacts,
      getProfile: async () => row.bundle.profile,
      getSchema: async () => row.bundle.schema,
    });
    await correction.correct({
      tenant: row.tenant,
      actor: {
        actorId: `corr-${row.bundle.modelKey}`,
        actorSchoolId: row.tenant.schoolId,
        permissions: ["REPORT_CARD_CORRECT"],
      },
      reportCardId: cardId,
      sourceVersion: 1,
      reason: `Qualification ${row.bundle.modelKey}`,
      commandId: `cmd-lot10-${row.bundle.modelKey}`,
    });
    const v2 = publication.payloadForRender({ tenant: row.tenant, reportCardId: cardId, version: 2 });
    assert.equal(v2.published_snapshot_version, 2);
    assert.deepEqual(v2.provenance.profile, payload.provenance.profile);
    assert.deepEqual(v2.provenance.schema, payload.provenance.schema);
    assert.deepEqual(v2.provenance.template, payload.provenance.template);
    assert.equal(v2.academic_year_id, yearId);
    assert.equal(v2.class_id, classId);
    assert.notDeepEqual(lot10.canonicalResult(v2), row.golden.canonical);
  }
});

test("report-card-lot10-tenant-isolation", () => {
  const lot10 = requireLot10();
  const keys = bootKeys();
  const publication = createReportCardPublication(keys);
  const rows = both(lot10);
  for (const row of rows) {
    const payload = snapshotFromQualification(row.bundle, `rc-lot10-iso-${row.bundle.modelKey}`, {
      academicYearId: `year-${row.bundle.modelKey}`,
      classId: `class-${row.bundle.modelKey}`,
    });
    publication.publish({ tenant: row.tenant, payload });
  }
  assert.throws(
    () =>
      publication.payloadForRender({
        tenant: rows[1].tenant,
        reportCardId: `rc-lot10-iso-${rows[0].bundle.modelKey}`,
        version: 1,
      }),
    (err) => err && (err.code === "TENANT_MISMATCH" || err.code === "PUBLICATION_NOT_FOUND")
  );
  assert.throws(
    () =>
      publication.payloadForRender({
        tenant: rows[0].tenant,
        reportCardId: `rc-lot10-iso-${rows[1].bundle.modelKey}`,
        version: 1,
      }),
    (err) => err && (err.code === "TENANT_MISMATCH" || err.code === "PUBLICATION_NOT_FOUND")
  );
});

test("report-card-lot10-initial-publication-stamps-class-year", async () => {
  const lot10 = requireLot10();
  assert.equal(typeof lot10.activateQualificationBinding, "function");
  for (const row of both(lot10)) {
    const schoolId = row.tenant.schoolId;
    const keys = bootKeys();
    const profileStore = createAcademicRuleProfileStore();
    const schemaStore = createReportCardSchemaStore();
    const createdP = profileStore.createProfile({
      schoolId,
      actorSchoolId: schoolId,
      profileKey: row.bundle.modelKey,
      spec: row.bundle.profile,
      activate: true,
    });
    const createdS = schemaStore.createSchema({
      schoolId,
      actorSchoolId: schoolId,
      schemaKey: row.bundle.modelKey,
      spec: row.bundle.schema,
      activate: true,
    });
    const configuration = createReportCardConfiguration({
      profileStore,
      schemaStore,
      persistence: createInMemoryConfigurationPersistence(),
    });
    const bound = await lot10.activateQualificationBinding(configuration, schoolId, {
      modelKey: row.bundle.modelKey,
      profile: { id: createdP.profile.id, version: createdP.version.version },
      schema: { id: createdS.schema.id, version: createdS.version.version },
      templateSpec: row.bundle.template,
    });
    const publication = createReportCardPublication(keys);
    const factsStore = createMemoryFactsStore([
      {
        schoolId,
        facts: row.bundle.facts,
      },
    ]);
    const classId = `class-${row.bundle.modelKey}`;
    const academicYearId = `year-${row.bundle.modelKey}`;
    factsStore.resolveCohort = ({ classId: requestedClass, academicYearId: requestedYear }) => {
      if (requestedClass === classId && requestedYear === academicYearId) {
        return { classId, academicYearId };
      }
      return null;
    };
    const initial = createReportCardInitialPublication({ publication, factsStore, configuration });
    await initial.publishInitial({
      tenant: row.tenant,
      reportCardId: `rc-lot10-init-${row.bundle.modelKey}`,
      classId,
      academicYearId,
      modelKey: row.bundle.modelKey,
    });
    const v1 = publication.payloadForRender({
      tenant: row.tenant,
      reportCardId: `rc-lot10-init-${row.bundle.modelKey}`,
      version: 1,
    });
    assert.equal(v1.academic_year_id, academicYearId);
    assert.equal(v1.class_id, classId);
    assert.equal(v1.provenance.profile.id, createdP.profile.id);
    assert.equal(v1.provenance.schema.id, createdS.schema.id);
    assert.equal(v1.provenance.template.id, bound.template.template_id);
    assert.equal(v1.provenance.template.spec_sha256, bound.template.spec_sha256);
    assert.deepEqual(lot10.canonicalResult(v1), row.golden.canonical);
    assert.deepEqual(lot10.normalizePublishedSnapshot(v1), row.golden.snapshot);
  }
});

test("report-card-lot10-a-b-no-mix", () => {
  const lot10 = requireLot10();
  const rows = both(lot10);
  const [rowA, rowB] = rows;
  assert.notEqual(canonicalize(rowA.golden.canonical), canonicalize(rowB.golden.canonical));
  assert.throws(
    () =>
      computeReportCard({
        profile: rowA.bundle.profile,
        schema: rowA.bundle.schema,
        facts: rowB.bundle.facts,
        provenance: rowA.bundle.provenance,
        tenant: rowA.bundle.tenant,
      }),
    (err) => err && err.code === "INVALID_FACTS"
  );
  assert.throws(
    () =>
      computeReportCard({
        profile: rowB.bundle.profile,
        schema: rowB.bundle.schema,
        facts: rowA.bundle.facts,
        provenance: rowB.bundle.provenance,
        tenant: rowB.bundle.tenant,
      }),
    (err) => err && err.code === "INVALID_FACTS"
  );
  const keys = bootKeys();
  const publication = createReportCardPublication(keys);
  const payloadA = snapshotFromQualification(rowA.bundle, "rc-lot10-mix-a", {
    academicYearId: "year-qual-a",
    classId: "class-qual-a",
  });
  const payloadB = snapshotFromQualification(rowB.bundle, "rc-lot10-mix-b", {
    academicYearId: "year-qual-b",
    classId: "class-qual-b",
  });
  publication.publish({ tenant: rowA.tenant, payload: payloadA });
  publication.publish({ tenant: rowB.tenant, payload: payloadB });
  const renderedA = publication.payloadForRender({ tenant: rowA.tenant, reportCardId: "rc-lot10-mix-a", version: 1 });
  const renderedB = publication.payloadForRender({ tenant: rowB.tenant, reportCardId: "rc-lot10-mix-b", version: 1 });
  assert.deepEqual(lot10.canonicalResult(renderedA), rowA.golden.canonical);
  assert.deepEqual(lot10.canonicalResult(renderedB), rowB.golden.canonical);
  assert.deepEqual(lot10.normalizePublishedSnapshot(renderedA), rowA.golden.snapshot);
  assert.deepEqual(lot10.normalizePublishedSnapshot(renderedB), rowB.golden.snapshot);
  assert.notDeepEqual(lot10.canonicalResult(renderedA), rowB.golden.canonical);
  assert.notDeepEqual(lot10.canonicalResult(renderedB), rowA.golden.canonical);
  assert.notDeepEqual(lot10.normalizePublishedSnapshot(renderedA), rowB.golden.snapshot);
  assert.notEqual(renderedA.provenance.template.id, renderedB.provenance.template.id);
  assert.throws(
    () => publication.payloadForRender({ tenant: rowB.tenant, reportCardId: "rc-lot10-mix-a", version: 1 }),
    (err) => err && (err.code === "TENANT_MISMATCH" || err.code === "PUBLICATION_NOT_FOUND")
  );
});
