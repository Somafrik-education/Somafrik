"use strict";

const crypto = require("node:crypto");
const { canonicalize } = require("./jcs");
const { AUTHENTICITY } = require("./contract");

function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }
  return Object.freeze(value);
}

function assertIdentityFields(payload) {
  for (const key of ["report_card_id", "published_snapshot_version", "school_id", "published_at"]) {
    if (payload[key] == null || payload[key] === "") {
      throw new Error(`snapshot missing ${key}`);
    }
  }
}

function canonicalBytes(payload) {
  assertIdentityFields(payload);
  return Buffer.from(canonicalize(payload), "utf8");
}

function snapshotSha256(payload) {
  return crypto.createHash("sha256").update(canonicalBytes(payload)).digest("hex");
}

function generateSigningKey(signingKeyId = "rc-ed25519-1") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    signing_key_id: signingKeyId,
    alg: AUTHENTICITY.alg,
    publicKey,
    privateKey,
  };
}

function signCanonicalBytes(bytes, key) {
  const signature = crypto.sign(null, bytes, key.privateKey);
  return {
    snapshot_signature: signature.toString("base64"),
    signing_key_id: key.signing_key_id,
    signature_alg: AUTHENTICITY.alg,
  };
}

function verifyCanonicalBytes(bytes, signatureB64, publicKey) {
  return crypto.verify(null, bytes, publicKey, Buffer.from(signatureB64, "base64"));
}

function payloadFromCanonicalBytes(bytes) {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

function sealSnapshot(payload, key) {
  const copy = structuredClone(payload);
  const bytes = canonicalBytes(copy);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const signed = signCanonicalBytes(bytes, key);
  const frozenPayload = deepFreeze(copy);
  return Object.freeze({
    payload: frozenPayload,
    canonical_bytes: bytes,
    snapshot_sha256: sha256,
    ...signed,
    frozen: true,
  });
}

function payloadForRender(sealed) {
  if (!sealed?.canonical_bytes) {
    throw new Error("snapshot missing canonical_bytes");
  }
  return payloadFromCanonicalBytes(sealed.canonical_bytes);
}

function assertImmutable(sealed) {
  if (!sealed?.frozen) throw new Error("snapshot not frozen");
  const fromBytes = payloadFromCanonicalBytes(sealed.canonical_bytes);
  const again = snapshotSha256(fromBytes);
  if (again !== sealed.snapshot_sha256) {
    throw new Error("snapshot mutated");
  }
  if (snapshotSha256(sealed.payload) !== sealed.snapshot_sha256) {
    throw new Error("payload diverges from canonical bytes");
  }
}

module.exports = {
  deepFreeze,
  canonicalBytes,
  snapshotSha256,
  generateSigningKey,
  signCanonicalBytes,
  verifyCanonicalBytes,
  sealSnapshot,
  payloadForRender,
  payloadFromCanonicalBytes,
  assertImmutable,
};
