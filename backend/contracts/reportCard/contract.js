"use strict";

/**
 * LOT 0 — contrats figés (aucune route, aucune table).
 * Les lots 1–10 consomment ces constantes ; ils ne les réinventent pas.
 */

const ENGINE_ID = "somafrik.report_card.v1";

const LAYERS = Object.freeze([
  "AcademicRuleProfile",
  "ReportCardSchema",
  "RenderingTemplate",
]);

const PIPELINE = Object.freeze([
  "grades_postgresql",
  "engine_server",
  "snapshot_immutable",
  "web_mobile_pdf_verify",
]);

const CANONICALIZATION = Object.freeze({
  scheme: "RFC_8785_JCS",
  hash: "SHA-256",
  forbid: Object.freeze(["JSON.stringify", "jsonb::text", "key-reorder-roundtrip"]),
});

const QR_STRATEGY = Object.freeze({
  id: "A",
  token_min_bits: 128,
  token_hash: "SHA-256",
  token_ciphertext: "AES-256-GCM envelope",
  aad_fields: Object.freeze([
    "public_id",
    "report_card_id",
    "published_snapshot_version",
    "school_id",
  ]),
  wrapping_key_location: "outside_postgresql",
  invariant: "same_version_same_url_same_qr",
});

const AUTHENTICITY = Object.freeze({
  fields: Object.freeze(["snapshot_sha256", "snapshot_signature", "signing_key_id"]),
  alg: "Ed25519",
  private_key_location: "outside_postgresql",
  resign_published: false,
});

const CARD_STATES = Object.freeze([
  "DRAFT",
  "CALCULATED",
  "VALIDATED",
  "PUBLISHED",
  "ARCHIVED",
]);

const VERIFICATION_STATES = Object.freeze(["ACTIVE", "SUPERSEDED", "REVOKED"]);

const TEMPLATE_REQUEST_STATES = Object.freeze([
  "SUBMITTED",
  "UNDER_REVIEW",
  "CONFIGURING",
  "READY_FOR_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "ACTIVE",
  "REJECTED",
  "ARCHIVED",
]);

const RBAC_TOKENS = Object.freeze([
  "REPORT_CARD_CONFIGURE",
  "REPORT_CARD_SUBMIT_MODEL",
  "REPORT_CARD_GENERATE",
  "REPORT_CARD_VALIDATE",
  "REPORT_CARD_PUBLISH",
  "REPORT_CARD_READ",
  "REPORT_CARD_REPRINT",
  "REPORT_CARD_CORRECT",
  "REPORT_CARD_REVOKE",
  "REPORT_CARD_SCHOOL_APPROVE_TEMPLATE",
]);

const PUBLISH = Object.freeze({
  atomic_parts: Object.freeze([
    "PUBLISHED",
    "snapshot",
    "snapshot_sha256",
    "snapshot_signature",
    "verification_ACTIVE",
    "outbox",
  ]),
  unique: "(report_card_id, published_snapshot_version)",
  outbox_event: "pedagogy.report_card.published",
  pdf_mints_token: false,
});

const VERIFY_HEADERS = Object.freeze({
  cache_control: "no-store, no-cache, private, max-age=0",
  referrer_policy: "no-referrer",
  csp: "strict",
  third_party: false,
});

const PRINT_CONTRACT = Object.freeze({
  min_size_mm: 20,
  quiet_zone_modules: 4,
  ecc: "Q",
  ecc_forbidden: "L",
  post_render_scan_required: true,
});

const GATES = Object.freeze([
  "no-country-school-branch",
  "snapshot-immutability",
  "snapshot-canonical-bytes-tamper-fails-closed",
  "snapshot-canonical-jcs",
  "snapshot-signature",
  "publish-idempotent-qr",
  "publish-idempotency-rejects-payload-mismatch",
  "reprint-after-restart-keeps-same-qr",
  "token-not-in-logs",
  "token-ciphertext-bound-to-version",
  "tenant-isolation",
]);

const ENGINE_SCAN_ROOTS = Object.freeze([
  "backend/contracts/reportCard",
  "backend/lib/reportCard",
  "backend/lib/reportCardEngine",
]);

module.exports = {
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
  ENGINE_SCAN_ROOTS,
};
