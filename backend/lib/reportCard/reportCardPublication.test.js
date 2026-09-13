"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { canonicalize } = require("../../contracts/reportCard/jcs");
const { ENGINE_ID, PUBLISH, QR_STRATEGY } = require("../../contracts/reportCard/contract");
const {
  canonicalBytes,
  snapshotSha256,
  generateSigningKey,
  verifyCanonicalBytes,
  hashCanonical,
  payloadForRender,
  SnapshotIntegrityError,
  SnapshotSignatureInvalidError,
} = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey, hashToken } = require("../../contracts/reportCard/verificationSecret");
const { scanEngineSources } = require("../../contracts/reportCard/noCountrySchoolBranch");
const { computeReportCard } = require("./reportCardEngine");
const { validateSpec: validateProfileSpec } = require("./academicRuleProfile");
const { validateSpec: validateSchemaSpec } = require("./reportCardSchema");

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const TENANT_A = { schoolId: SCHOOL_A, actorSchoolId: SCHOOL_A };
const TENANT_B = { schoolId: SCHOOL_B, actorSchoolId: SCHOOL_B };

function loadLot4() {
  try {
    return require("./reportCardPublication");
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

function reorder(value) {
  if (Array.isArray(value)) return value.map(reorder);
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort().reverse();
    const out = {};
    for (const key of keys) out[key] = reorder(value[key]);
    return out;
  }
  return value;
}

function boot(api, overrides = {}) {
  const signingKey = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  const publication = api.createReportCardPublication({
    signingKey,
    wrapping,
    wrappingKeys: [wrapping],
    signingKeys: [signingKey],
    ...overrides,
  });
  return { publication, signingKey, wrapping };
}

test("report-card-snapshot-deterministic-bytes", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication } = boot(api);
  const a = publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  const b = publication.publish({ tenant: TENANT_A, payload: reorder(snapshotPayload()) });
  assert.equal(a.snapshot_sha256, b.snapshot_sha256);
  assert.deepEqual(Buffer.from(a.sealed.canonical_bytes), Buffer.from(b.sealed.canonical_bytes));
  assert.equal(a.public_id, b.public_id);
});

test("report-card-snapshot-jcs-rfc8785", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const payload = snapshotPayload();
  const { publication } = boot(api);
  const published = publication.publish({ tenant: TENANT_A, payload });
  const jcs = canonicalize(payload);
  assert.notEqual(JSON.stringify(payload), jcs);
  assert.equal(Buffer.from(published.sealed.canonical_bytes).toString("utf8"), jcs);
  assert.deepEqual(
    Buffer.from(published.sealed.canonical_bytes),
    Buffer.from(canonicalBytes(reorder(payload)))
  );
});

test("report-card-snapshot-sha256-same-bytes", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const payload = snapshotPayload();
  const { publication } = boot(api);
  const published = publication.publish({ tenant: TENANT_A, payload });
  assert.equal(published.snapshot_sha256, snapshotSha256(payload));
  assert.equal(published.snapshot_sha256, hashCanonical(published.sealed.canonical_bytes));
  assert.equal(published.snapshot_sha256.length, 64);
});

test("report-card-snapshot-ed25519-same-bytes", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication, signingKey } = boot(api);
  const published = publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  assert.equal(published.signing_key_id, "rc-ed25519-1");
  assert.ok(
    verifyCanonicalBytes(published.sealed.canonical_bytes, published.snapshot_signature, signingKey.publicKey)
  );
  const other = generateSigningKey("other");
  assert.equal(
    verifyCanonicalBytes(published.sealed.canonical_bytes, published.snapshot_signature, other.publicKey),
    false
  );
});

test("report-card-snapshot-tamper-detected", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication, signingKey } = boot(api);
  const published = publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  const rendered = publication.payloadForRender({
    tenant: TENANT_A,
    reportCardId: "rc-1",
    version: 1,
  });
  assert.equal(rendered.engine_id, ENGINE_ID);
  const marker = Buffer.from("STU-1", "utf8");
  const idx = published.sealed.canonical_bytes.indexOf(marker);
  assert.ok(idx >= 0);
  published.sealed.canonical_bytes[idx] = "X".charCodeAt(0);
  assert.throws(
    () => payloadForRender(published.sealed, require("../../contracts/reportCard/snapshot").signingKeyRing(signingKey)),
    (err) => err.code === "SNAPSHOT_INTEGRITY" && err instanceof SnapshotIntegrityError
  );
  const rehashed = {
    ...published.sealed,
    snapshot_sha256: hashCanonical(published.sealed.canonical_bytes),
  };
  assert.throws(
    () => payloadForRender(rehashed, require("../../contracts/reportCard/snapshot").signingKeyRing(signingKey)),
    (err) => err.code === "SNAPSHOT_SIGNATURE_INVALID" && err instanceof SnapshotSignatureInvalidError
  );
});

test("report-card-publication-atomic", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication } = boot(api);
  const published = publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.verification_status, "ACTIVE");
  assert.ok(published.sealed.canonical_bytes.length > 0);
  assert.ok(published.snapshot_sha256);
  assert.ok(published.snapshot_signature);
  assert.ok(published.public_id);
  assert.ok(published.token_hash);
  assert.ok(published.token_ciphertext);
  const outbox = publication.listOutbox({ tenant: TENANT_A });
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].event, PUBLISH.outbox_event);
  assert.equal(outbox[0].public_id, published.public_id);
  assert.throws(
    () =>
      publication.publish({
        tenant: TENANT_A,
        payload: snapshotPayload({ students: [] }),
      }),
    (err) => err.code === "IDEMPOTENCY_CONFLICT"
  );
  assert.equal(publication.listOutbox({ tenant: TENANT_A }).length, 1);
});

test("report-card-publication-idempotent", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication } = boot(api);
  const payload = snapshotPayload();
  const first = publication.publish({ tenant: TENANT_A, payload });
  const second = publication.publish({ tenant: TENANT_A, payload: reorder(payload) });
  assert.equal(first.public_id, second.public_id);
  assert.equal(first.snapshot_sha256, second.snapshot_sha256);
  assert.equal(first.token_hash, second.token_hash);
  const urlA = publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  const urlB = publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(urlA, urlB);
  assert.equal(publication.listOutbox({ tenant: TENANT_A }).length, 1);
});

test("report-card-publication-concurrency-safe", async () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication } = boot(api);
  const payload = snapshotPayload();
  const [left, right] = await Promise.all([
    Promise.resolve(publication.publish({ tenant: TENANT_A, payload })),
    Promise.resolve(publication.publish({ tenant: TENANT_A, payload: reorder(payload) })),
  ]);
  assert.equal(left.public_id, right.public_id);
  assert.equal(left.snapshot_sha256, right.snapshot_sha256);
  assert.equal(publication.listOutbox({ tenant: TENANT_A }).length, 1);
});

test("report-card-publication-immutable", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication } = boot(api);
  const published = publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  assert.throws(() => {
    published.sealed.payload.students[0].student_id = "MUTATED";
  });
  const rendered = publication.payloadForRender({
    tenant: TENANT_A,
    reportCardId: "rc-1",
    version: 1,
  });
  assert.equal(rendered.students[0].student_id, "STU-1");
});

test("report-card-publication-tenant-isolation", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication } = boot(api);
  publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  assert.throws(
    () => publication.publish({ tenant: TENANT_B, payload: snapshotPayload() }),
    (err) => err.code === "TENANT_MISMATCH"
  );
  assert.throws(
    () => publication.reprintUrl({ tenant: TENANT_B, reportCardId: "rc-1", version: 1 }),
    (err) => err.code === "TENANT_MISMATCH" || err.code === "PUBLICATION_NOT_FOUND"
  );
  assert.throws(
    () => publication.payloadForRender({ tenant: TENANT_B, reportCardId: "rc-1", version: 1 }),
    (err) => err.code === "TENANT_MISMATCH" || err.code === "PUBLICATION_NOT_FOUND"
  );
  assert.throws(
    () => publication.publish({ tenant: { schoolId: SCHOOL_A }, payload: snapshotPayload() }),
    (err) => err.code === "TENANT_REQUIRED"
  );
});

test("report-card-publication-no-cross-school-fallback", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication } = boot(api);
  publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  assert.throws(
    () => publication.lookup({ tenant: TENANT_B, reportCardId: "rc-1", version: 1 }),
    (err) => err.code === "TENANT_MISMATCH" || err.code === "PUBLICATION_NOT_FOUND"
  );
  assert.throws(
    () => publication.reprintUrl({ tenant: TENANT_B, reportCardId: "rc-1", version: 1 }),
    (err) => err.code === "TENANT_MISMATCH" || err.code === "PUBLICATION_NOT_FOUND"
  );
  assert.throws(
    () => publication.payloadForRender({ tenant: TENANT_B, reportCardId: "rc-1", version: 1 }),
    (err) => err.code === "TENANT_MISMATCH" || err.code === "PUBLICATION_NOT_FOUND"
  );
});

test("report-card-qr-strategy-a-stable-url", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const signingKey = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  const pub = api.createReportCardPublication({
    signingKey,
    wrapping,
    wrappingKeys: [wrapping],
    signingKeys: [signingKey],
  });
  const published = pub.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  const url = pub.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.match(url, /^https:\/\/somafrik\.app\/verify\/rc\/[^.]+\.[A-Za-z0-9_-]+$/);
  assert.ok(url.includes(published.public_id));
  assert.equal(url.includes("STU-1"), false);
  assert.equal(url.includes(published.snapshot_signature), false);
  assert.equal(QR_STRATEGY.id, "A");
  assert.equal(QR_STRATEGY.invariant, "same_version_same_url_same_qr");
  const dump = pub.persistWithoutSecrets();
  const restored = api.createReportCardPublication({
    signingKey,
    wrapping,
    wrappingKeys: [wrapping],
    signingKeys: [signingKey],
    dump,
  });
  assert.equal(restored.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 }), url);
  assert.equal(dump[0].token_hash, hashToken(url.split(".").pop()));
  assert.equal("token" in dump[0], false);
});

test("report-card-new-version-new-public-id", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication } = boot(api);
  const v1 = publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  const v2 = publication.publish({
    tenant: TENANT_A,
    payload: snapshotPayload({ published_snapshot_version: 2, published_at: "2026-09-13T01:00:00.000Z" }),
  });
  assert.notEqual(v1.public_id, v2.public_id);
  const url1 = publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  const url2 = publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 2 });
  assert.notEqual(url1, url2);
  assert.ok(url1.includes(v1.public_id));
  assert.ok(url2.includes(v2.public_id));
  const previous = publication.lookup({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(previous.verification_status, "SUPERSEDED");
  assert.equal(v2.verification_status, "ACTIVE");
  const stillV1 = publication.payloadForRender({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  assert.equal(stillV1.published_snapshot_version, 1);
});

test("report-card-publication-signed-provenance", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication } = boot(api);
  const missingEngine = snapshotPayload();
  delete missingEngine.engine_id;
  assert.throws(
    () => publication.publish({ tenant: TENANT_A, payload: missingEngine }),
    (err) => err.code === "INVALID_ENGINE"
  );
  assert.throws(
    () =>
      publication.publish({
        tenant: TENANT_A,
        payload: snapshotPayload({ engine_id: "other.engine" }),
      }),
    (err) => err.code === "INVALID_ENGINE"
  );
  assert.throws(
    () => publication.publish({ tenant: TENANT_A, payload: snapshotPayload({ provenance: null }) }),
    (err) => err.code === "INVALID_PROVENANCE"
  );
  assert.throws(
    () =>
      publication.publish({
        tenant: TENANT_A,
        payload: snapshotPayload({ provenance: { profile: { id: "P", version: 1, spec_sha256: "aa" } } }),
      }),
    (err) => err.code === "INVALID_PROVENANCE"
  );
  assert.throws(
    () =>
      publication.publish({
        tenant: TENANT_A,
        payload: snapshotPayload({
          provenance: {
            profile: { id: "P", spec_sha256: "aa" },
            schema: { id: "S", version: 1, spec_sha256: "bb" },
          },
        }),
      }),
    (err) => err.code === "INVALID_PROVENANCE"
  );
  assert.throws(
    () => publication.publish({ tenant: TENANT_A, payload: snapshotPayload({ students: null }) }),
    (err) => err.code === "INVALID_SNAPSHOT"
  );
  assert.throws(
    () => publication.publish({ tenant: TENANT_A, payload: snapshotPayload({ students: [{ student_id: "STU-1" }] }) }),
    (err) => err.code === "INVALID_SNAPSHOT"
  );
  assert.throws(
    () =>
      publication.publish({
        tenant: TENANT_A,
        payload: snapshotPayload({ published_snapshot_version: 0 }),
      }),
    (err) => err.code === "INVALID_SNAPSHOT"
  );
  assert.throws(
    () =>
      publication.publish({
        tenant: TENANT_A,
        payload: snapshotPayload({ published_snapshot_version: 1.5 }),
      }),
    (err) => err.code === "INVALID_SNAPSHOT"
  );
  assert.equal(publication.listOutbox({ tenant: TENANT_A }).length, 0);
  const published = publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  assert.equal(published.sealed.payload.engine_id, ENGINE_ID);
  assert.match(published.sealed.canonical_bytes.toString("utf8"), /"engine_id":"somafrik\.report_card\.v1"/);
  assert.equal(published.sealed.payload.provenance.profile.spec_sha256, "aa");
  assert.equal(published.sealed.payload.provenance.schema.spec_sha256, "bb");
  assert.ok(Array.isArray(published.sealed.payload.students));
});

test("report-card-qr-public-lookup-autonomous", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication } = boot(api);
  const published = publication.publish({ tenant: TENANT_A, payload: snapshotPayload() });
  const url = publication.reprintUrl({ tenant: TENANT_A, reportCardId: "rc-1", version: 1 });
  const token = url.split(".").pop();
  const found = publication.lookupPublic({ publicId: published.public_id, token });
  assert.equal(found.ok, true);
  assert.equal(found.payload.school_id, SCHOOL_A);
  assert.equal(found.payload.engine_id, ENGINE_ID);
  assert.equal(found.record, undefined);
  const badToken = publication.lookupPublic({ publicId: published.public_id, token: "nope" });
  assert.equal(badToken.ok, false);
  assert.equal(badToken.reason, "not_found");
  assert.equal(badToken.payload, undefined);
  assert.equal(badToken.record, undefined);
  const badId = publication.lookupPublic({ publicId: "missing", token });
  assert.equal(badId.ok, false);
  assert.equal(badId.reason, "not_found");
  assert.equal(badId.payload, undefined);
  assert.throws(
    () => publication.lookup({ tenant: TENANT_B, reportCardId: "rc-1", version: 1 }),
    (err) => err.code === "TENANT_MISMATCH" || err.code === "PUBLICATION_NOT_FOUND"
  );
});

test("report-card-no-country-school-branch", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const { publication } = boot(api);
  assert.throws(
    () => publication.publish({ tenant: TENANT_A, payload: snapshotPayload({ country: "BI" }) }),
    (err) => err.code === "COUNTRY_SCHOOL_BRANCH_FORBIDDEN"
  );
  assert.deepEqual(scanEngineSources(), []);
});

test("report-card-lot4-no-pdf-ui-side-effects", () => {
  const api = loadLot4();
  assert.ok(api, "LOT 4 publication missing (RED)");
  const src = fs.readFileSync(path.join(__dirname, "reportCardPublication.js"), "utf8");
  assert.equal(/\brenderPdf\b|\bmintToken\b|\bfetch\s*\(|\bDate\.now\s*\(/.test(src), false);
  assert.equal(/\bexpress\b|\brouter\.(get|post)\b|\/verify\b/.test(src), false);
  assert.equal(PUBLISH.pdf_mints_token, false);
  const note = fs.readFileSync(path.join(__dirname, "../../../docs/project/REPORT-CARD-LOT4.md"), "utf8");
  assert.match(note, /LOT 5/);
  assert.match(note, /interdit/i);
  assert.match(note, /sealSnapshot/);
  const web = path.join(__dirname, "../../../web/src/lib/reportCardsApi.ts");
  const mobile = path.join(__dirname, "../../../Mobile/src/screens/ReportCardsScreen.tsx");
  assert.equal(fs.existsSync(web), true);
  assert.equal(fs.existsSync(mobile), true);
});
