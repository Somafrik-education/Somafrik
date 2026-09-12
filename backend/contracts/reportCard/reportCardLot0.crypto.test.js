"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalize } = require("./jcs");
const {
  canonicalBytes,
  snapshotSha256,
  generateSigningKey,
  verifyCanonicalBytes,
  sealSnapshot,
  payloadForRender,
  assertImmutable,
  SnapshotIntegrityError,
} = require("./snapshot");
const {
  generateToken,
  hashToken,
  generateWrappingKey,
  wrapToken,
  unwrapToken,
  TOKEN_BYTES,
} = require("./verificationSecret");
const { PublishJournal, pdfRendersFromPersisted, IdempotencyConflict } = require("./publishJournal");
const { redactVerifyUrl, assertTokenAbsentFromLogs, rateLimitKey } = require("./logRedaction");

function samplePayload(overrides = {}) {
  return {
    report_card_id: "rc-1",
    published_snapshot_version: 1,
    school_id: "school-a",
    published_at: "2026-09-12T00:00:00.000Z",
    student: { given: "Hope", family: "Okito" },
    cells: [{ subject_id: "math", score: 14.5 }],
    ...overrides,
  };
}

test("snapshot-canonical-jcs: same object different key order → same bytes", () => {
  const a = { z: 1, a: { c: 2, b: 3 } };
  const b = { a: { b: 3, c: 2 }, z: 1 };
  assert.equal(canonicalize(a), canonicalize(b));
  assert.equal(canonicalize(a), '{"a":{"b":3,"c":2},"z":1}');
});

test("snapshot-canonical-jcs: JSON.stringify is not canonical", () => {
  const obj = { b: 1, a: 2 };
  assert.notEqual(JSON.stringify(obj), canonicalize(obj));
});

test("snapshot-immutability: nested mutation is fail-closed; render reads canonical bytes", () => {
  const payload = samplePayload();
  const bytes = canonicalBytes(payload);
  const hex = snapshotSha256(payload);
  assert.equal(hex.length, 64);
  assert.ok(bytes.includes('"school_id":"school-a"'));
  const tampered = samplePayload({ cells: [{ subject_id: "math", score: 15 }] });
  assert.notEqual(snapshotSha256(tampered), hex);

  const key = generateSigningKey();
  const sealed = sealSnapshot(samplePayload(), key);
  assert.throws(() => {
    sealed.payload.cells[0].score = 99;
  });
  assert.throws(() => {
    sealed.payload.student.given = "X";
  });
  assert.equal(payloadForRender(sealed).cells[0].score, 14.5);
  assert.doesNotThrow(() => assertImmutable(sealed));
});

test("snapshot-canonical-bytes-tamper-fails-closed", () => {
  const key = generateSigningKey();
  const sealed = sealSnapshot(samplePayload(), key);
  assert.equal(payloadForRender(sealed).student.given, "Hope");
  const idx = sealed.canonical_bytes.indexOf(Buffer.from("Hope", "utf8"));
  assert.ok(idx >= 0);
  sealed.canonical_bytes[idx] = "N".charCodeAt(0);
  assert.equal(JSON.parse(sealed.canonical_bytes.toString("utf8")).student.given, "Nope");
  assert.throws(
    () => payloadForRender(sealed),
    (err) => err.code === "SNAPSHOT_INTEGRITY" && err instanceof SnapshotIntegrityError
  );
});

test("snapshot-signature: Ed25519 over the same canonical bytes; key rotation does not resign v1", () => {
  const key1 = generateSigningKey("kid-1");
  const key2 = generateSigningKey("kid-2");
  const sealed = sealSnapshot(samplePayload(), key1);
  assert.equal(sealed.signing_key_id, "kid-1");
  assert.ok(verifyCanonicalBytes(sealed.canonical_bytes, sealed.snapshot_signature, key1.publicKey));
  assert.ok(!verifyCanonicalBytes(sealed.canonical_bytes, sealed.snapshot_signature, key2.publicKey));
  assert.doesNotThrow(() => assertImmutable(sealed));
  const mutated = { ...sealed, payload: samplePayload({ cells: [] }) };
  assert.throws(() => assertImmutable(mutated));
});

test("token entropy ≥ 128 bits; hash is not reversible", () => {
  assert.equal(TOKEN_BYTES, 16);
  const token = generateToken();
  assert.ok(Buffer.from(token, "base64url").length >= 16);
  const digest = hashToken(token);
  assert.notEqual(digest, token);
});

test("publish-idempotent-qr: retry same version keeps public_id and token", () => {
  const wrapping = generateWrappingKey();
  const signingKey = generateSigningKey();
  const journal = new PublishJournal({ wrapping, signingKey });
  const first = journal.publish(samplePayload());
  const retry = journal.publish(samplePayload());
  assert.equal(first.public_id, retry.public_id);
  assert.equal(first.token_hash, retry.token_hash);
  assert.equal(first.token_ciphertext, retry.token_ciphertext);
  assert.equal(journal.outbox.length, 1);
});

test("reprint-after-restart-keeps-same-qr", () => {
  const wrapping = generateWrappingKey();
  const signingKey = generateSigningKey();
  const journal = new PublishJournal({ wrapping, signingKey });
  journal.publish(samplePayload());
  const urlBefore = journal.reprintUrl("rc-1", 1);
  const dump = journal.persistWithoutSecrets();
  assert.ok(!JSON.stringify(dump).includes(urlBefore.split(".").pop()));
  const restarted = PublishJournal.restore(dump, { wrapping, signingKey });
  const urlAfter = restarted.reprintUrl("rc-1", 1);
  assert.equal(urlAfter, urlBefore);
  const fromPdf = pdfRendersFromPersisted(restarted, "rc-1", 1);
  assert.equal(fromPdf, urlBefore);
});

test("token-not-in-logs: redact path; rate-limit never uses plaintext prefix", () => {
  const token = generateToken();
  const publicId = "11111111-2222-3333-4444-555555555555";
  const url = `https://somafrik.app/verify/rc/${publicId}.${token}`;
  const redacted = redactVerifyUrl(`GET ${url} 200`);
  assert.ok(redacted.includes("[redacted]"));
  assert.ok(!redacted.includes(token));
  assert.doesNotThrow(() => assertTokenAbsentFromLogs([redacted], token));
  assert.throws(() => assertTokenAbsentFromLogs([url], token));
  const key = rateLimitKey({ publicId, tokenHash: hashToken(token) });
  assert.ok(key.startsWith("hash:"));
  assert.ok(!key.includes(token.slice(0, 8)));
});

test("tenant-isolation: school B cannot bind school A capability", () => {
  const wrapping = generateWrappingKey();
  const signingKey = generateSigningKey();
  const journal = new PublishJournal({ wrapping, signingKey });
  journal.publish(samplePayload({ school_id: "school-a" }));
  const url = journal.reprintUrl("rc-1", 1);
  const [, opaque] = url.split("/verify/rc/");
  const [publicId, token] = opaque.split(".");
  const publicOk = journal.lookupPublic(publicId, token);
  assert.equal(publicOk.ok, true);
  const crossTenant = journal.lookupPublic(publicId, token, { expectedSchoolId: "school-b" });
  assert.equal(crossTenant.ok, false);
  assert.equal(crossTenant.reason, "tenant_mismatch");
});

test("publish-idempotency-rejects-payload-mismatch", () => {
  const wrapping = generateWrappingKey();
  const signingKey = generateSigningKey();
  const journal = new PublishJournal({ wrapping, signingKey });
  journal.publish(samplePayload());
  assert.throws(
    () => journal.publish(samplePayload({ cells: [{ subject_id: "math", score: 1 }] })),
    (err) => err.code === "IDEMPOTENCY_CONFLICT" && err instanceof IdempotencyConflict
  );
  assert.equal(journal.outbox.length, 1);
});

test("token-ciphertext-bound-to-version: swapped ciphertext fails", () => {
  const wrapping = generateWrappingKey();
  const signingKey = generateSigningKey();
  const journal = new PublishJournal({ wrapping, signingKey });
  journal.publish(samplePayload({ report_card_id: "rc-1", school_id: "school-a" }));
  journal.publish(samplePayload({ report_card_id: "rc-2", school_id: "school-b" }));
  const a = journal.records.get("rc-1::1");
  const b = journal.records.get("rc-2::1");
  const swapped = Object.freeze({
    ...b,
    token_ciphertext: a.token_ciphertext,
  });
  journal.records.set("rc-2::1", swapped);
  assert.throws(() => journal.reprintUrl("rc-2", 1), (err) => err.code === "CIPHERTEXT_BINDING");
});

test("ciphertext round-trip uses wrapping key outside the record", () => {
  const wrapping = generateWrappingKey("wrap-prod-1");
  const token = generateToken();
  const binding = {
    public_id: "pid-1",
    report_card_id: "rc-1",
    published_snapshot_version: 1,
    school_id: "school-a",
  };
  const wrapped = wrapToken(token, wrapping, binding);
  assert.equal(wrapped.wrapping_key_id, "wrap-prod-1");
  assert.equal(unwrapToken(wrapped.token_ciphertext, wrapping, binding), token);
  assert.throws(
    () => unwrapToken(wrapped.token_ciphertext, wrapping, { ...binding, school_id: "school-b" }),
    (err) => err.code === "CIPHERTEXT_BINDING"
  );
});
