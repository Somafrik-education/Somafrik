"use strict";

const crypto = require("node:crypto");
const { QR_STRATEGY } = require("./contract");
const { canonicalize } = require("./jcs");

const TOKEN_BYTES = QR_STRATEGY.token_min_bits / 8;

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, Buffer.alloc(left.length));
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function generateWrappingKey(wrappingKeyId = "rc-wrap-1") {
  return {
    wrapping_key_id: wrappingKeyId,
    key: crypto.randomBytes(32),
  };
}

function encryptionContext(binding) {
  const ctx = {};
  for (const key of QR_STRATEGY.aad_fields) {
    if (binding?.[key] == null || binding[key] === "") {
      throw new Error(`token wrap requires ${QR_STRATEGY.aad_fields.join(", ")}`);
    }
    ctx[key] = binding[key];
  }
  return Buffer.from(canonicalize(ctx), "utf8");
}

function wrapToken(token, wrapping, binding) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", wrapping.key, iv);
  cipher.setAAD(encryptionContext(binding));
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    wrapping_key_id: wrapping.wrapping_key_id,
    token_ciphertext: Buffer.concat([iv, tag, enc]).toString("base64"),
  };
}

function unwrapToken(tokenCiphertext, wrapping, binding) {
  const buf = Buffer.from(tokenCiphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", wrapping.key, iv);
  decipher.setAAD(encryptionContext(binding));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    const err = new Error("CIPHERTEXT_BINDING");
    err.code = "CIPHERTEXT_BINDING";
    throw err;
  }
}

function verificationUrl(publicId, token) {
  return `https://somafrik.app/verify/rc/${publicId}.${token}`;
}

module.exports = {
  TOKEN_BYTES,
  generateToken,
  hashToken,
  constantTimeEqual,
  generateWrappingKey,
  encryptionContext,
  wrapToken,
  unwrapToken,
  verificationUrl,
};
