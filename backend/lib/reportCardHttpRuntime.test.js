"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateSigningKey } = require("../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../contracts/reportCard/verificationSecret");
const { loadReportCardHttpCrypto, HISTORICAL_SIGNING_ENV } = require("./reportCardHttpRuntime");

test("report-card-lot7-runtime-loads-historical-public-keys", () => {
  const key1 = generateSigningKey("rc-ed25519-1");
  const key2 = generateSigningKey("rc-ed25519-2");
  const wrapping = generateWrappingKey("rc-wrap-1");
  const keys = loadReportCardHttpCrypto({
    SOMAFRIK_REPORT_CARD_SIGNING_PRIVATE_KEY_PEM: key2.privateKey.export({ type: "pkcs8", format: "pem" }),
    SOMAFRIK_REPORT_CARD_SIGNING_KEY_ID: "rc-ed25519-2",
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_B64: wrapping.key.toString("base64"),
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_ID: "rc-wrap-1",
    [HISTORICAL_SIGNING_ENV]: JSON.stringify([
      {
        signing_key_id: "rc-ed25519-1",
        publicKeyPem: key1.publicKey.export({ type: "spki", format: "pem" }),
      },
    ]),
  });
  assert.equal(keys.signingKey.signing_key_id, "rc-ed25519-2");
  assert.equal(keys.signingKeys.map((key) => key.signing_key_id).sort().join(","), "rc-ed25519-1,rc-ed25519-2");
  assert.equal(keys.signingKeys.find((key) => key.signing_key_id === "rc-ed25519-1").privateKey, undefined);
});

test("report-card-lot7-runtime-historical-json-fails-closed", () => {
  const key2 = generateSigningKey("rc-ed25519-2");
  const wrapping = generateWrappingKey("rc-wrap-1");
  assert.throws(
    () =>
      loadReportCardHttpCrypto({
        SOMAFRIK_REPORT_CARD_SIGNING_PRIVATE_KEY_PEM: key2.privateKey.export({ type: "pkcs8", format: "pem" }),
        SOMAFRIK_REPORT_CARD_SIGNING_KEY_ID: "rc-ed25519-2",
        SOMAFRIK_REPORT_CARD_WRAPPING_KEY_B64: wrapping.key.toString("base64"),
        [HISTORICAL_SIGNING_ENV]: "{not-json",
      }),
    (err) => err && err.code === "SIGNING_KEY_RING_INVALID"
  );
});
