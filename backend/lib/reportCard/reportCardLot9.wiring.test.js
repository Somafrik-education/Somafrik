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
const { createReportCardHttpBindings } = require("../reportCardHttpRuntime");
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
  };
  const signingKey = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
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
    assert.deepEqual(body.payload.provenance.profile, provenance.profile);
  } finally {
    await bound.close();
  }
});
