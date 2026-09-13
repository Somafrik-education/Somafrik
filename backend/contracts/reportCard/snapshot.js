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

class SnapshotIntegrityError extends Error {
  constructor(message = "SNAPSHOT_INTEGRITY") {
    super(message);
    this.name = "SnapshotIntegrityError";
    this.code = "SNAPSHOT_INTEGRITY";
  }
}

class SnapshotSignatureInvalidError extends Error {
  constructor(message = "SNAPSHOT_SIGNATURE_INVALID") {
    super(message);
    this.name = "SnapshotSignatureInvalidError";
    this.code = "SNAPSHOT_SIGNATURE_INVALID";
  }
}

class SnapshotSigningKeyUnknownError extends Error {
  constructor(message = "SNAPSHOT_SIGNING_KEY_UNKNOWN") {
    super(message);
    this.name = "SnapshotSigningKeyUnknownError";
    this.code = "SNAPSHOT_SIGNING_KEY_UNKNOWN";
  }
}

class SigningKeyRing {
  constructor(keys = []) {
    this.keys = new Map();
    for (const key of keys) {
      if (!key?.signing_key_id || !key.publicKey) {
        throw new Error("signing key requires signing_key_id and publicKey");
      }
      this.keys.set(key.signing_key_id, key);
    }
  }

  publicKeyFor(signingKeyId) {
    const key = this.keys.get(signingKeyId);
    if (!key) {
      throw new SnapshotSigningKeyUnknownError();
    }
    return key.publicKey;
  }
}

function signingKeyRing(keys) {
  return new SigningKeyRing(Array.isArray(keys) ? keys : [keys]);
}

function hashCanonical(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function payloadFromCanonicalBytes(bytes) {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

function assertCanonicalIntegrity(sealed) {
  if (!sealed?.canonical_bytes || !sealed.snapshot_sha256) {
    throw new SnapshotIntegrityError();
  }
  if (hashCanonical(sealed.canonical_bytes) !== sealed.snapshot_sha256) {
    throw new SnapshotIntegrityError();
  }
}

function assertAuthentic(sealed, keyRing) {
  assertCanonicalIntegrity(sealed);
  if (!sealed.snapshot_signature || !sealed.signing_key_id) {
    throw new SnapshotSignatureInvalidError();
  }
  if (!(keyRing instanceof SigningKeyRing)) {
    throw new SnapshotSigningKeyUnknownError();
  }
  const publicKey = keyRing.publicKeyFor(sealed.signing_key_id);
  if (!verifyCanonicalBytes(sealed.canonical_bytes, sealed.snapshot_signature, publicKey)) {
    throw new SnapshotSignatureInvalidError();
  }
}

function sealSnapshot(payload, key) {
  const copy = structuredClone(payload);
  const bytes = canonicalBytes(copy);
  const sha256 = hashCanonical(bytes);
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

function payloadForRender(sealed, keyRing) {
  assertAuthentic(sealed, keyRing);
  return payloadFromCanonicalBytes(sealed.canonical_bytes);
}

function assertImmutable(sealed) {
  if (!sealed?.frozen) throw new Error("snapshot not frozen");
  assertCanonicalIntegrity(sealed);
  const fromBytes = payloadFromCanonicalBytes(sealed.canonical_bytes);
  const again = snapshotSha256(fromBytes);
  if (again !== sealed.snapshot_sha256) {
    throw new SnapshotIntegrityError();
  }
  if (snapshotSha256(sealed.payload) !== sealed.snapshot_sha256) {
    throw new SnapshotIntegrityError();
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
  assertCanonicalIntegrity,
  assertAuthentic,
  assertImmutable,
  hashCanonical,
  signingKeyRing,
  SigningKeyRing,
  SnapshotIntegrityError,
  SnapshotSignatureInvalidError,
  SnapshotSigningKeyUnknownError,
};
