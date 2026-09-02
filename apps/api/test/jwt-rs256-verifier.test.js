import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import {
  authorizationDecisionToHttpStatus,
  decodeJwtCompactStrict,
  extractBearerCredential,
  isJwtClaimsPolicySatisfied,
  isJwtTemporalPolicySatisfied,
  verifyJwtRs256Signature,
} from "../src/index.js";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeBase64Url(bytes) {
  let output = "";
  const length = bytes.length;
  let index = 0;
  while (index + 2 < length) {
    const value =
      (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    output +=
      ALPHABET[(value >> 18) & 63] +
      ALPHABET[(value >> 12) & 63] +
      ALPHABET[(value >> 6) & 63] +
      ALPHABET[value & 63];
    index += 3;
  }
  if (index < length) {
    if (length - index === 1) {
      const value = bytes[index] << 16;
      output += ALPHABET[(value >> 18) & 63] + ALPHABET[(value >> 12) & 63];
    } else {
      const value = (bytes[index] << 16) | (bytes[index + 1] << 8);
      output +=
        ALPHABET[(value >> 18) & 63] +
        ALPHABET[(value >> 12) & 63] +
        ALPHABET[(value >> 6) & 63];
    }
  }
  return output;
}

function utf8(text) {
  return new TextEncoder().encode(text);
}

function signingInputFromParts(headerText, payloadText) {
  return `${encodeBase64Url(utf8(headerText))}.${encodeBase64Url(utf8(payloadText))}`;
}

const DEFAULT_SIGNING_INPUT = signingInputFromParts(
  '{"alg":"RS256"}',
  '{"sub":"USR-1"}',
);

async function generateRs256Pair(modulusLength = 2048, hash = "SHA-256") {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash,
    },
    true,
    ["sign", "verify"],
  );
}

async function signRs256(privateKey, signingInput) {
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return new Uint8Array(signature);
}

test("accepts a valid RS256 signature with ephemeral test keys", async () => {
  const { publicKey, privateKey } = await generateRs256Pair(2048);
  const signature = await signRs256(privateKey, DEFAULT_SIGNING_INPUT);
  assert.equal(
    await verifyJwtRs256Signature(DEFAULT_SIGNING_INPUT, signature, publicKey),
    true,
  );
});

test("rejects altered signatures and altered signing inputs", async () => {
  const { publicKey, privateKey } = await generateRs256Pair(2048);
  const signature = await signRs256(privateKey, DEFAULT_SIGNING_INPUT);

  const alteredSignature = new Uint8Array(signature);
  alteredSignature[0] ^= 0xff;
  assert.equal(
    await verifyJwtRs256Signature(
      DEFAULT_SIGNING_INPUT,
      alteredSignature,
      publicKey,
    ),
    false,
  );

  const alteredInput = signingInputFromParts('{"alg":"RS256"}', '{"sub":"USR-2"}');
  assert.equal(
    await verifyJwtRs256Signature(alteredInput, signature, publicKey),
    false,
  );
});

test("rejects the wrong public key", async () => {
  const pairA = await generateRs256Pair(2048);
  const pairB = await generateRs256Pair(2048);
  const signature = await signRs256(pairA.privateKey, DEFAULT_SIGNING_INPUT);
  assert.equal(
    await verifyJwtRs256Signature(
      DEFAULT_SIGNING_INPUT,
      signature,
      pairB.publicKey,
    ),
    false,
  );
});

test("accepts modulus 2048 3072 and 4096 and refuses 1024 before verify", async () => {
  for (const modulusLength of [2048, 3072, 4096]) {
    const { publicKey, privateKey } = await generateRs256Pair(modulusLength);
    const signature = await signRs256(privateKey, DEFAULT_SIGNING_INPUT);
    assert.equal(
      await verifyJwtRs256Signature(
        DEFAULT_SIGNING_INPUT,
        signature,
        publicKey,
      ),
      true,
      `modulus ${modulusLength}`,
    );
  }

  // WebCrypto may refuse generating 1024-bit RSA; if generation works, the
  // verifier must still refuse before subtle.verify.
  let generated1024 = null;
  try {
    generated1024 = await generateRs256Pair(1024);
  } catch {
    generated1024 = null;
  }
  if (generated1024 !== null) {
    const signature = await signRs256(
      generated1024.privateKey,
      DEFAULT_SIGNING_INPUT,
    );
    assert.equal(
      await verifyJwtRs256Signature(
        DEFAULT_SIGNING_INPUT,
        signature,
        generated1024.publicKey,
      ),
      false,
    );
  } else {
    const fakeKey = {
      type: "public",
      usages: ["verify"],
      algorithm: {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 1024,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: { name: "SHA-256" },
      },
    };
    Object.setPrototypeOf(fakeKey, CryptoKey.prototype);
    assert.equal(
      await verifyJwtRs256Signature(
        DEFAULT_SIGNING_INPUT,
        new Uint8Array([1, 2, 3]),
        fakeKey,
      ),
      false,
    );
  }
});

test("rejects wrong public exponent SHA and private keys", async () => {
  const { publicKey, privateKey } = await generateRs256Pair(2048);
  const signature = await signRs256(privateKey, DEFAULT_SIGNING_INPUT);

  assert.equal(
    await verifyJwtRs256Signature(DEFAULT_SIGNING_INPUT, signature, privateKey),
    false,
  );

  const sha384 = await generateRs256Pair(2048, "SHA-384");
  const signature384 = await signRs256(sha384.privateKey, DEFAULT_SIGNING_INPUT);
  assert.equal(
    await verifyJwtRs256Signature(
      DEFAULT_SIGNING_INPUT,
      signature384,
      sha384.publicKey,
    ),
    false,
  );

  // Exponent != 65537 via synthetic key shape (not a real CryptoKey instance).
  const wrongExponent = {
    type: "public",
    usages: ["verify"],
    algorithm: {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 3]),
      hash: { name: "SHA-256" },
    },
  };
  Object.setPrototypeOf(wrongExponent, CryptoKey.prototype);
  assert.equal(
    await verifyJwtRs256Signature(
      DEFAULT_SIGNING_INPUT,
      signature,
      wrongExponent,
    ),
    false,
  );
});

test("rejects RSA-PSS ECDSA HMAC and keys without verify usage", async () => {
  const { publicKey, privateKey } = await generateRs256Pair(2048);
  const signature = await signRs256(privateKey, DEFAULT_SIGNING_INPUT);

  const rsaPss = await crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    false,
    ["sign", "verify"],
  );
  assert.equal(
    await verifyJwtRs256Signature(
      DEFAULT_SIGNING_INPUT,
      signature,
      rsaPss.publicKey,
    ),
    false,
  );

  const ecdsa = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  assert.equal(
    await verifyJwtRs256Signature(
      DEFAULT_SIGNING_INPUT,
      signature,
      ecdsa.publicKey,
    ),
    false,
  );

  const hmac = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
  assert.equal(
    await verifyJwtRs256Signature(DEFAULT_SIGNING_INPUT, signature, hmac),
    false,
  );

  const signOnly = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", signOnly.publicKey);
  const noVerify = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    [],
  );
  assert.equal(
    await verifyJwtRs256Signature(DEFAULT_SIGNING_INPUT, signature, noVerify),
    false,
  );
  assert.equal(publicKey.usages.includes("verify"), true);
});

test("rejects non-canonical empty and extra signingInput segments", async () => {
  const { publicKey, privateKey } = await generateRs256Pair(2048);
  const signature = await signRs256(privateKey, DEFAULT_SIGNING_INPUT);

  assert.equal(await verifyJwtRs256Signature("", signature, publicKey), false);
  assert.equal(await verifyJwtRs256Signature("abc", signature, publicKey), false);
  assert.equal(
    await verifyJwtRs256Signature("abc.def.ghi", signature, publicKey),
    false,
  );
  assert.equal(await verifyJwtRs256Signature(".def", signature, publicKey), false);
  assert.equal(await verifyJwtRs256Signature("abc.", signature, publicKey), false);
  assert.equal(
    await verifyJwtRs256Signature("A.def", signature, publicKey),
    false,
  );
  assert.equal(
    await verifyJwtRs256Signature(
      `${DEFAULT_SIGNING_INPUT.split(".")[0]}._x`,
      signature,
      publicKey,
    ),
    false,
  );
  assert.equal(
    await verifyJwtRs256Signature("a".repeat(4095), signature, publicKey),
    false,
  );
});

test("rejects empty Buffer text array ArrayBuffer and DataView signatures", async () => {
  const { publicKey, privateKey } = await generateRs256Pair(2048);
  const signature = await signRs256(privateKey, DEFAULT_SIGNING_INPUT);

  assert.equal(
    await verifyJwtRs256Signature(DEFAULT_SIGNING_INPUT, new Uint8Array(), publicKey),
    false,
  );
  assert.equal(
    await verifyJwtRs256Signature(
      DEFAULT_SIGNING_INPUT,
      Buffer.from(signature),
      publicKey,
    ),
    false,
  );
  assert.equal(
    await verifyJwtRs256Signature(DEFAULT_SIGNING_INPUT, "signature", publicKey),
    false,
  );
  assert.equal(
    await verifyJwtRs256Signature(DEFAULT_SIGNING_INPUT, [...signature], publicKey),
    false,
  );
  assert.equal(
    await verifyJwtRs256Signature(
      DEFAULT_SIGNING_INPUT,
      signature.buffer,
      publicKey,
    ),
    false,
  );
  assert.equal(
    await verifyJwtRs256Signature(
      DEFAULT_SIGNING_INPUT,
      new DataView(signature.buffer),
      publicKey,
    ),
    false,
  );
});

test("never mutates inputs and never throws or rejects for hostile values", async () => {
  const { publicKey, privateKey } = await generateRs256Pair(2048);
  const signature = await signRs256(privateKey, DEFAULT_SIGNING_INPUT);
  const signatureCopy = new Uint8Array(signature);
  const inputCopy = DEFAULT_SIGNING_INPUT;

  assert.equal(
    await verifyJwtRs256Signature(DEFAULT_SIGNING_INPUT, signature, publicKey),
    true,
  );
  assert.deepEqual([...signature], [...signatureCopy]);
  assert.equal(DEFAULT_SIGNING_INPUT, inputCopy);

  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error("hostile");
      },
    },
  );
  const cases = [
    [undefined, undefined, undefined],
    [null, null, null],
    [1, signature, publicKey],
    [DEFAULT_SIGNING_INPUT, 1, publicKey],
    [DEFAULT_SIGNING_INPUT, signature, 1],
    [hostile, signature, publicKey],
    [DEFAULT_SIGNING_INPUT, hostile, publicKey],
    [DEFAULT_SIGNING_INPUT, signature, hostile],
  ];
  for (const args of cases) {
    const result = await verifyJwtRs256Signature(args[0], args[1], args[2]);
    assert.equal(result, false);
  }

  const originalVerify = globalThis.crypto.subtle.verify;
  globalThis.crypto.subtle.verify = async () => {
    throw new Error("subtle failure");
  };
  try {
    assert.equal(
      await verifyJwtRs256Signature(DEFAULT_SIGNING_INPUT, signature, publicKey),
      false,
    );
  } finally {
    globalThis.crypto.subtle.verify = originalVerify;
  }

  globalThis.crypto.subtle.verify = async () => Promise.reject(new Error("reject"));
  try {
    assert.equal(
      await verifyJwtRs256Signature(DEFAULT_SIGNING_INPUT, signature, publicKey),
      false,
    );
  } finally {
    globalThis.crypto.subtle.verify = originalVerify;
  }
});

test("public API non-regression without PEM JWKS kid resolution or JWT libs", async () => {
  const require = createRequire(import.meta.url);
  const apiPackage = require("../package.json");
  assert.equal(apiPackage.dependencies, undefined);

  assert.equal(typeof authorizationDecisionToHttpStatus, "function");
  assert.equal(typeof extractBearerCredential, "function");
  assert.equal(typeof decodeJwtCompactStrict, "function");
  assert.equal(typeof isJwtClaimsPolicySatisfied, "function");
  assert.equal(typeof isJwtTemporalPolicySatisfied, "function");
  assert.equal(typeof verifyJwtRs256Signature, "function");

  const source = readFileSync(
    new URL("../src/jwt-rs256-verifier.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("decodeJwtCompactStrict"), false);
  assert.equal(source.includes("isJwtClaimsPolicySatisfied"), false);
  assert.equal(source.includes("jsonwebtoken"), false);
  assert.equal(source.includes("jose"), false);
  assert.equal(source.includes("importKey"), false);
  assert.equal(source.includes("JWKS"), false);
  assert.equal(source.includes("Date.now"), false);
});
