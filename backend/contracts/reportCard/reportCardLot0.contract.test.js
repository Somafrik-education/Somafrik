"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ENGINE_ID,
  LAYERS,
  PIPELINE,
  CANONICALIZATION,
  QR_STRATEGY,
  AUTHENTICITY,
  CARD_STATES,
  VERIFICATION_STATES,
  TEMPLATE_REQUEST_STATES,
  RBAC_TOKENS,
  PUBLISH,
  VERIFY_HEADERS,
  PRINT_CONTRACT,
  GATES,
} = require("./contract");

test("no-country-school-branch: layers and pipeline are frozen", () => {
  assert.deepEqual(LAYERS, [
    "AcademicRuleProfile",
    "ReportCardSchema",
    "RenderingTemplate",
  ]);
  assert.deepEqual(PIPELINE, [
    "grades_postgresql",
    "engine_server",
    "snapshot_immutable",
    "web_mobile_pdf_verify",
  ]);
  assert.equal(ENGINE_ID, "somafrik.report_card.v1");
});

test("canonicalization is RFC 8785 JCS + SHA-256", () => {
  assert.equal(CANONICALIZATION.scheme, "RFC_8785_JCS");
  assert.equal(CANONICALIZATION.hash, "SHA-256");
});

test("QR strategy A", () => {
  assert.equal(QR_STRATEGY.id, "A");
  assert.equal(QR_STRATEGY.token_min_bits, 128);
  assert.equal(QR_STRATEGY.wrapping_key_location, "outside_postgresql");
  assert.deepEqual(QR_STRATEGY.aad_fields, [
    "public_id",
    "report_card_id",
    "published_snapshot_version",
    "school_id",
  ]);
});

test("authenticity Ed25519 key outside PG", () => {
  assert.equal(AUTHENTICITY.alg, "Ed25519");
  assert.equal(AUTHENTICITY.private_key_location, "outside_postgresql");
  assert.equal(AUTHENTICITY.resign_published, false);
});

test("card and verification lifecycles", () => {
  assert.deepEqual(CARD_STATES, ["DRAFT", "CALCULATED", "VALIDATED", "PUBLISHED", "ARCHIVED"]);
  assert.deepEqual(VERIFICATION_STATES, ["ACTIVE", "SUPERSEDED", "REVOKED"]);
  assert.ok(TEMPLATE_REQUEST_STATES.includes("SUBMITTED"));
  assert.ok(TEMPLATE_REQUEST_STATES.includes("ACTIVE"));
  assert.ok(TEMPLATE_REQUEST_STATES.includes("CHANGES_REQUESTED"));
  assert.ok(!TEMPLATE_REQUEST_STATES.includes("AUTO_ACTIVATED"));
});

test("RBAC tokens frozen", () => {
  assert.ok(RBAC_TOKENS.includes("REPORT_CARD_CONFIGURE"));
  assert.ok(RBAC_TOKENS.includes("REPORT_CARD_SUBMIT_MODEL"));
  assert.ok(RBAC_TOKENS.includes("REPORT_CARD_SCHOOL_APPROVE_TEMPLATE"));
  assert.equal(RBAC_TOKENS.length, 10);
});

test("publish atomic unique key; PDF does not mint token", () => {
  assert.equal(PUBLISH.unique, "(report_card_id, published_snapshot_version)");
  assert.equal(PUBLISH.pdf_mints_token, false);
  assert.ok(PUBLISH.atomic_parts.includes("outbox"));
});

test("verify headers and print contract", () => {
  assert.match(VERIFY_HEADERS.cache_control, /no-store/);
  assert.equal(VERIFY_HEADERS.referrer_policy, "no-referrer");
  assert.equal(VERIFY_HEADERS.third_party, false);
  assert.equal(PRINT_CONTRACT.ecc, "Q");
  assert.equal(PRINT_CONTRACT.ecc_forbidden, "L");
  assert.ok(PRINT_CONTRACT.min_size_mm >= 20);
});

test("LOT 0 gates declared", () => {
  for (const gate of [
    "no-country-school-branch",
    "snapshot-immutability",
    "snapshot-canonical-bytes-tamper-fails-closed",
    "publish-idempotent-qr",
    "publish-idempotency-rejects-payload-mismatch",
    "reprint-after-restart-keeps-same-qr",
    "token-not-in-logs",
    "token-ciphertext-bound-to-version",
    "snapshot-signature",
    "tenant-isolation",
  ]) {
    assert.ok(GATES.includes(gate), gate);
  }
});
