"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { specSha256 } = require("./academicRuleProfile");
const { createMemoryFactsStore } = require("../../db/reportCardFactsStore");
const { createReportCardHttpBindings } = require("../reportCardHttpRuntime");
const { createInMemoryConfigurationPersistence } = require("./reportCardConfiguration");
const { validateSpec: validateProfileSpec } = require("./academicRuleProfile");
const { validateSpec: validateSchemaSpec } = require("./reportCardSchema");
const { computeReportCard } = require("./reportCardEngine");

const SCHOOL_A = "school-a";
const TENANT_A = { schoolId: SCHOOL_A, actorSchoolId: SCHOOL_A };
const ROOT = path.resolve(__dirname, "../../..");

function profileSpec() {
  return validateProfileSpec({
    periods: ["T1", "T2"],
    annual: true,
    score_components: [{ id: "TJ", applicability: "always", max: 20, coefficient: 1 }],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up" },
    ranking: { enabled: false, ties: "competition" },
  });
}

function schemaSpec() {
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

function fact(rawScore) {
  return {
    student_id: "STU-1",
    subject_id: "MATH",
    period_id: "T1",
    score_component_id: "TJ",
    raw_score: rawScore,
    subject_applicable: true,
  };
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

test("report-card-lot9-server-js-wires-correction-resolvers", () => {
  const serverSrc = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const runtimeSrc = fs.readFileSync(path.join(ROOT, "backend/lib/reportCardHttpRuntime.js"), "utf8");
  assert.match(serverSrc, /createReportCardHttpBindings/);
  assert.match(runtimeSrc, /getFacts/);
  assert.match(runtimeSrc, /getProfile/);
  assert.match(runtimeSrc, /getSchema/);
  assert.match(runtimeSrc, /publishInitial/);
  assert.equal(/liveByKey\.get\(factKey\(row\)\) \|\| row/.test(runtimeSrc), false);
  const factsSrc = fs.readFileSync(path.join(ROOT, "backend/db/reportCardFactsStore.js"), "utf8");
  assert.match(factsSrc, /weightedAverage/);
  assert.match(factsSrc, /FACTS_REQUIRED/);
  assert.match(factsSrc, /throw schemaUnavailable/);
  assert.match(factsSrc, /resolveCohort/);
  const pubSrc = fs.readFileSync(path.join(ROOT, "backend/lib/reportCard/reportCardPublication.js"), "utf8");
  assert.match(pubSrc, /payload\.academic_year_id/);
  assert.match(pubSrc, /payload\.class_id/);
  const initialSrc = fs.readFileSync(path.join(ROOT, "backend/lib/reportCard/reportCardInitialPublication.js"), "utf8");
  assert.match(initialSrc, /resolveCohort/);
  assert.match(initialSrc, /lookupActiveBinding/);
  assert.match(initialSrc, /template: bundle\.template\.ref/);
  assert.equal(/rows\[0\]/.test(initialSrc), false);
  assert.equal(/listProfiles/.test(initialSrc), false);
  assert.equal(/firstActiveLayer/.test(initialSrc), false);
});

test("report-card-lot9-production-wiring-corrects-to-next-version", async () => {
  const { registerReportCardHttp } = require("./reportCardHttp");
  const profileStore = createAcademicRuleProfileStore();
  const schemaStore = createReportCardSchemaStore();
  const createdP = profileStore.createProfile({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileKey: "lot9-wire",
    spec: profileSpec(),
    activate: true,
  });
  const createdS = schemaStore.createSchema({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaKey: "lot9-wire",
    spec: schemaSpec(),
    activate: true,
  });
  const provenance = {
    profile: {
      id: createdP.profile.id,
      version: createdP.version.version,
      spec_sha256: createdP.version.spec_sha256 || specSha256(createdP.version.spec),
    },
    schema: {
      id: createdS.schema.id,
      version: createdS.version.version,
      spec_sha256: createdS.version.spec_sha256 || specSha256(createdS.version.spec),
    },
    template: { id: "TPL-1", version: 1, spec_sha256: "cc" },
  };
  const computedV1 = computeReportCard({
    profile: createdP.version.spec,
    schema: createdS.version.spec,
    facts: [fact(12)],
    provenance,
    tenant: TENANT_A,
  });
  const payloadV1 = {
    report_card_id: "rc-wire-1",
    published_snapshot_version: 1,
    school_id: SCHOOL_A,
    published_at: "2026-09-14T00:00:00.000Z",
    engine_id: computedV1.engine_id,
    provenance,
    students: computedV1.students,
    academic_year_id: "year-1",
    class_id: "class-1",
  };
  const signingKey = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  const factsStore = createMemoryFactsStore([{ schoolId: SCHOOL_A, facts: [fact(16)] }]);
  const env = {
    SOMAFRIK_REPORT_CARD_SIGNING_PRIVATE_KEY_PEM: signingKey.privateKey.export({ type: "pkcs8", format: "pem" }),
    SOMAFRIK_REPORT_CARD_SIGNING_KEY_ID: "rc-ed25519-1",
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_B64: wrapping.key.toString("base64"),
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_ID: "rc-wrap-1",
  };
  const actor = {
    actorId: "wire-correct",
    actorSchoolId: SCHOOL_A,
    permissions: ["REPORT_CARD_READ", "REPORT_CARD_REPRINT", "REPORT_CARD_CORRECT", "REPORT_CARD_REVOKE"],
  };
  const app = express();
  app.use(express.json());
  const bindings = createReportCardHttpBindings({
    env,
    resolveActor: () => actor,
    getTemplate: async () => ({
      spec: {
        paper: "A4",
        orientation: "portrait",
        qr_required: true,
        sections: [{ id: "SUBJECTS", order: 1, label: "Disciplines", source: "cells" }],
      },
      spec_sha256: "cc",
    }),
    overrides: {
      profileStore,
      schemaStore,
      factsStore,
      keys: { signingKey, wrapping, wrappingKeys: [wrapping], signingKeys: [signingKey] },
    },
  });
  assert.equal(typeof bindings.getFacts, "function");
  assert.equal(typeof bindings.getProfile, "function");
  assert.equal(typeof bindings.getSchema, "function");
  registerReportCardHttp(app, bindings);
  assert.equal("getFacts" in bindings, true);
  const publication = bindings.getPublication();
  const published = publication.publish({ tenant: TENANT_A, payload: payloadV1 });
  const bound = await listen(app);
  try {
    const res = await fetch(`${bound.base}/api/report-card/publications/rc-wire-1/corrections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceVersion: 1,
        reason: "Wiring production",
        commandId: "cmd-wire-1",
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 201, JSON.stringify(data));
    assert.ok(data.publication.public_id);
    assert.notEqual(data.publication.public_id, published.public_id);
    const snap = await fetch(`${bound.base}/api/report-card/publications/rc-wire-1/versions/2`);
    const body = await snap.json();
    assert.equal(snap.status, 200);
    assert.equal(body.payload.published_snapshot_version, 2);
    assert.notEqual(body.payload.students[0].cells[0].exposed, payloadV1.students[0].cells[0].exposed);
    assert.deepEqual(body.payload.provenance.profile, provenance.profile);
  } finally {
    await bound.close();
  }
});

function calculableProfileSpec(componentMax = 20) {
  return validateProfileSpec({
    periods: ["T1", "T2"],
    annual: true,
    score_components: [{ id: "TJ", applicability: "always", max: componentMax, coefficient: 1 }],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up", stage: "display_only" },
    ranking: { enabled: false, ties: "competition" },
    aggregation: { mode: "weighted_sum", coefficient_default: 1, percentage: "points_over_max_100" },
    pass_rule: { metric: "PERCENTAGE", threshold: 50 },
  });
}

function lot9TemplateSpec() {
  return {
    paper: "A4",
    orientation: "portrait",
    qr_required: true,
    sections: [{ id: "SUBJECTS", order: 1, label: "Disciplines", source: "cells" }],
  };
}

async function activateBoundModel(configuration, schoolId, { modelKey, profile, schema }) {
  const submitter = {
    actorId: "lot9-submit",
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_SUBMIT_MODEL"],
  };
  const approver = {
    actorId: "lot9-approve",
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_SCHOOL_APPROVE_TEMPLATE"],
  };
  const superadmin = {
    actorId: "lot9-sa",
    permissions: ["REPORT_CARD_CONFIGURE"],
    platform: { privileged: true },
  };
  const submitted = await configuration.submitModel({
    actor: submitter,
    schoolId,
    modelKey,
    description: "lot9 bundle",
  });
  await configuration.startReview({ actor: superadmin, schoolId, requestId: submitted.id });
  await configuration.startConfiguring({ actor: superadmin, schoolId, requestId: submitted.id });
  const template = await configuration.saveRenderingTemplate({
    actor: superadmin,
    schoolId,
    requestId: submitted.id,
    spec: lot9TemplateSpec(),
  });
  await configuration.bindBundle({
    actor: superadmin,
    schoolId,
    requestId: submitted.id,
    profile,
    schema,
    template: { id: template.template_id, version: template.version },
  });
  await configuration.markReadyForReview({ actor: superadmin, schoolId, requestId: submitted.id });
  await configuration.approve({ actor: approver, schoolId, requestId: submitted.id });
  await configuration.activate({
    actor: superadmin,
    schoolId,
    requestId: submitted.id,
    commandId: `act-${modelKey}`,
  });
  return template;
}

test("report-card-lot9-initial-publish-uses-targeted-lot6-binding", async () => {
  const profileStore = createAcademicRuleProfileStore();
  const schemaStore = createReportCardSchemaStore();
  const decoyP = profileStore.createProfile({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileKey: "decoy-first",
    spec: calculableProfileSpec(20),
    activate: true,
  });
  const decoyS = schemaStore.createSchema({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaKey: "decoy-first",
    spec: schemaSpec(),
    activate: true,
  });
  const wantedP = profileStore.createProfile({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileKey: "wanted",
    spec: calculableProfileSpec(10),
    activate: true,
  });
  const wantedS = schemaStore.createSchema({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaKey: "wanted",
    spec: schemaSpec(),
    activate: true,
  });
  assert.equal(profileStore.listProfiles(SCHOOL_A, SCHOOL_A)[0].id, decoyP.profile.id);
  assert.equal(schemaStore.listSchemas(SCHOOL_A, SCHOOL_A)[0].id, decoyS.schema.id);
  const signingKey = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  const factsStore = createMemoryFactsStore([{ schoolId: SCHOOL_A, facts: [fact(8)] }]);
  const env = {
    SOMAFRIK_REPORT_CARD_SIGNING_PRIVATE_KEY_PEM: signingKey.privateKey.export({ type: "pkcs8", format: "pem" }),
    SOMAFRIK_REPORT_CARD_SIGNING_KEY_ID: "rc-ed25519-1",
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_B64: wrapping.key.toString("base64"),
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_ID: "rc-wrap-1",
  };
  const bindings = createReportCardHttpBindings({
    env,
    resolveActor: () => ({
      actorId: "wire-publish",
      actorSchoolId: SCHOOL_A,
      permissions: ["REPORT_CARD_READ"],
    }),
    overrides: {
      profileStore,
      schemaStore,
      factsStore,
      configurationPersistence: createInMemoryConfigurationPersistence(),
      keys: { signingKey, wrapping, wrappingKeys: [wrapping], signingKeys: [signingKey] },
    },
  });
  const template = await activateBoundModel(bindings.getConfiguration(), SCHOOL_A, {
    modelKey: "trimestriel",
    profile: { id: wantedP.profile.id, version: wantedP.version.version },
    schema: { id: wantedS.schema.id, version: wantedS.version.version },
  });
  await bindings.publishInitial({
    tenant: TENANT_A,
    reportCardId: "rc-wire-lot6",
    classId: "class-1",
    academicYearId: "year-1",
    modelKey: "trimestriel",
  });
  const payload = await bindings.getPublication().payloadForRender({
    tenant: TENANT_A,
    reportCardId: "rc-wire-lot6",
    version: 1,
  });
  assert.equal(payload.provenance.profile.id, wantedP.profile.id);
  assert.notEqual(payload.provenance.profile.id, decoyP.profile.id);
  assert.equal(payload.provenance.schema.id, wantedS.schema.id);
  assert.equal(payload.provenance.template.id, template.template_id);
  assert.equal(payload.provenance.template.spec_sha256, template.spec_sha256);
  assert.equal(payload.students[0].cells[0].internal, 8);
  assert.notEqual(payload.students[0].cells[0].internal, 16);
  await assert.rejects(
    () =>
      bindings.publishInitial({
        tenant: TENANT_A,
        reportCardId: "rc-wire-missing",
        classId: "class-1",
        academicYearId: "year-1",
        modelKey: "absent",
      }),
    (err) => err && err.code === "FACTS_REQUIRED"
  );
});
