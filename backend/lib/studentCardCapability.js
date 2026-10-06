"use strict";

const crypto = require("node:crypto");
const { createHttpError } = require("./classesManagement");

const CARD_TOKEN_MAX_LENGTH = 256;
const BASE64URL_PART = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const DUMMY_HASH_SOURCE = "somafrik-student-card-capability-dummy";
const DUMMY_TOKEN_HASH = crypto.createHash("sha256").update(DUMMY_HASH_SOURCE, "utf8").digest("hex");

function invalidTokenError() {
  return createHttpError(400, "Capability carte invalide.", "STUDENT_CARD_TOKEN_INVALID");
}

function parseCardToken(value) {
  if (typeof value !== "string") throw invalidTokenError();
  if (!value || value.length > CARD_TOKEN_MAX_LENGTH) throw invalidTokenError();
  if (value !== value.trim()) throw invalidTokenError();
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".") || dot === value.length - 1) {
    throw invalidTokenError();
  }
  const publicId = value.slice(0, dot);
  const secret = value.slice(dot + 1);
  if (!BASE64URL_PART.test(publicId) || !BASE64URL_PART.test(secret)) {
    throw invalidTokenError();
  }
  return { publicId, secret };
}

function hashCardSecret(secret) {
  return crypto.createHash("sha256").update(String(secret), "utf8").digest("hex");
}

function copyHashBuffer(hex) {
  const target = Buffer.alloc(32);
  if (typeof hex === "string" && SHA256_HEX.test(hex)) {
    Buffer.from(hex, "hex").copy(target);
    return { buffer: target, valid: true };
  }
  Buffer.from(DUMMY_TOKEN_HASH, "hex").copy(target);
  return { buffer: target, valid: false };
}

/**
 * Compare deux hashes SHA-256 hex en temps constant (32 octets).
 * Un hash absent ou mal formé est comparé au hash factice, jamais en retour anticipé.
 */
function tokenHashesMatch(candidateHash, storedHash) {
  const left = copyHashBuffer(candidateHash);
  const right = copyHashBuffer(storedHash);
  const equal = crypto.timingSafeEqual(left.buffer, right.buffer);
  return equal && left.valid && right.valid;
}

module.exports = {
  CARD_TOKEN_MAX_LENGTH,
  DUMMY_TOKEN_HASH,
  parseCardToken,
  hashCardSecret,
  tokenHashesMatch,
  invalidTokenError,
};
