"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  CARD_TOKEN_MAX_LENGTH,
  DUMMY_TOKEN_HASH,
  parseCardToken,
  hashCardSecret,
  tokenHashesMatch,
} = require("./studentCardCapability");

const opaquePart = "abcdefghijklmnopqrstuvwxyz012345";
const PUBLIC_ID = "pubidvalue1234567";
const TOKEN = `${PUBLIC_ID}.${opaquePart}`;

function assertInvalid(value) {
  assert.throws(
    () => parseCardToken(value),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "STUDENT_CARD_TOKEN_INVALID");
      assert.equal(String(error.message).includes(String(value ?? "")), value == null || value === "");
      if (typeof value === "string" && value) {
        assert.equal(error.message.includes(value), false);
        assert.equal(error.message.includes(opaquePart), false);
      }
      return true;
    },
  );
}

test("CARTE-PR3 — token valide publicId.secret", () => {
  const parsed = parseCardToken(TOKEN);
  assert.deepEqual(parsed, { publicId: PUBLIC_ID, secret: opaquePart });
});

test("CARTE-PR3 — parser rejette null, vide, forme et caractères", () => {
  assertInvalid(null);
  assertInvalid(undefined);
  assertInvalid("");
  assertInvalid("   ");
  assertInvalid(` ${TOKEN}`);
  assertInvalid(`${TOKEN} `);
  assertInvalid(PUBLIC_ID);
  assertInvalid(`${PUBLIC_ID}.${opaquePart}.extra`);
  assertInvalid(`.${opaquePart}`);
  assertInvalid(`${PUBLIC_ID}.`);
  assertInvalid(`${PUBLIC_ID}.${opaquePart}+/=`);
  assertInvalid(`bad token.${opaquePart}`);
  assertInvalid("a".repeat(CARD_TOKEN_MAX_LENGTH + 1));
  assert.equal(CARD_TOKEN_MAX_LENGTH <= 256, true);
});

test("CARTE-PR3 — erreur parser ne contient jamais le token soumis", () => {
  const leaked = "LEAKTOKEN99.opaquePartLEAK99";
  try {
    parseCardToken(`${leaked}.second`);
    assert.fail("token à plusieurs points");
  } catch (error) {
    assert.equal(error.message.includes("LEAKTOKEN99"), false);
    assert.equal(error.message.includes("opaquePartLEAK99"), false);
    assert.equal(JSON.stringify(error).includes("LEAKTOKEN99"), false);
  }
});

test("CARTE-PR3 — SHA-256 hex et timingSafeEqual bon/mauvais hash", () => {
  const hash = hashCardSecret(opaquePart);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, crypto.createHash("sha256").update(opaquePart, "utf8").digest("hex"));
  const original = crypto.timingSafeEqual;
  const calls = [];
  crypto.timingSafeEqual = (left, right) => {
    calls.push({ leftLength: left.length, rightLength: right.length });
    return original(left, right);
  };
  try {
    assert.equal(tokenHashesMatch(hash, hash), true);
    assert.equal(tokenHashesMatch(hash, hashCardSecret("other-secret-value")), false);
    assert.equal(tokenHashesMatch(hash, DUMMY_TOKEN_HASH), false);
    assert.equal(tokenHashesMatch(hash, null), false);
    assert.equal(tokenHashesMatch(hash, "not-hex"), false);
  } finally {
    crypto.timingSafeEqual = original;
  }
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.leftLength === 32 && call.rightLength === 32));
  assert.match(DUMMY_TOKEN_HASH, /^[0-9a-f]{64}$/);
});

test("CARTE-PR3 — comparaison source timingSafeEqual et hash factice", () => {
  const source = fs.readFileSync(path.join(__dirname, "studentCardCapability.js"), "utf8");
  assert.match(source, /crypto\.timingSafeEqual/);
  assert.match(source, /DUMMY_TOKEN_HASH/);
  assert.doesNotMatch(source, /WHERE token_hash/);
});
