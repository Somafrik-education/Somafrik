"use strict";

const crypto = require("node:crypto");
const { canonicalize } = require("./jcs");
const { AUTHENTICITY } = require("./contract");

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

function sealSnapshot(payload, key) {
  const bytes = canonicalBytes(payload);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const signed = signCanonicalBytes(bytes, key);
  return Object.freeze({
    payload: Object.freeze({ ...payload }),
    canonical_bytes: bytes,
    snapshot_sha256: sha256,
    ...signed,
    frozen: true,
  });
}

function assertImmutable(sealed) {
  if (!sealed?.frozen) throw new Error("snapshot not frozen");
  const again = snapshotSha256(sealed.payload);
  if (again !== sealed.snapshot_sha256) {
    throw new Error("snapshot mutated");
  }
}

module.exports = {
  canonicalBytes,
  snapshotSha256,
  generateSigningKey,
  signCanonicalBytes,
  verifyCanonicalBytes,
  sealSnapshot,
  assertImmutable,
};
