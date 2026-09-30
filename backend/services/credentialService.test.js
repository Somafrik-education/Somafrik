"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hashSecret,
  verifySecret,
  isHashedSecret,
  materializeAccountSecretHashes,
} = require("./credentialService");

test("verifySecret refuse un secret stocké en clair", () => {
  assert.equal(verifySecret("1234", "1234"), false);
  assert.equal(verifySecret("secret", "secret"), false);
  assert.equal(verifySecret("Somafrik26!", "Somafrik26!"), false);
  assert.equal(verifySecret("1234", "not-a-hash"), false);
});

test("verifySecret accepte uniquement un hash scrypt", () => {
  const hashed = hashSecret("1234");
  assert.equal(isHashedSecret(hashed), true);
  assert.equal(verifySecret("1234", hashed), true);
  assert.equal(verifySecret("9999", hashed), false);
  assert.equal(verifySecret("1234", "scrypt$"), false);
  assert.equal(verifySecret("1234", "scrypt$salt$"), false);
});

test("materializeAccountSecretHashes hash le clair sans le stripper", () => {
  const user = { identifier: "admin", password: "1234", pin: "1234", temporaryPassword: "" };
  materializeAccountSecretHashes(user);
  assert.equal(user.password, "1234");
  assert.equal(user.pin, "1234");
  assert.equal(isHashedSecret(user.passwordHash), true);
  assert.equal(isHashedSecret(user.pinHash), true);
  assert.equal(verifySecret("1234", user.passwordHash), true);
  assert.equal(verifySecret("1234", user.pinHash), true);
});

test("materializeAccountSecretHashes ne réécrit pas un hash scrypt existant", () => {
  const passwordHash = hashSecret("kept-secret");
  const user = { password: "1234", passwordHash, pinHash: passwordHash };
  materializeAccountSecretHashes(user);
  assert.equal(user.passwordHash, passwordHash);
  assert.equal(user.pinHash, passwordHash);
  assert.equal(verifySecret("kept-secret", user.passwordHash), true);
  assert.equal(verifySecret("1234", user.passwordHash), false);
});

test("materializeAccountSecretHashes ne promeut pas un hash-field resté en clair", () => {
  const user = { passwordHash: "1234", pinHash: "1234" };
  materializeAccountSecretHashes(user);
  assert.equal(user.passwordHash, "1234");
  assert.equal(user.pinHash, "1234");
  assert.equal(isHashedSecret(user.passwordHash), false);
  assert.equal(verifySecret("1234", user.passwordHash), false);
});
