"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verificationUrl } = require("./verificationSecret");

test("QR domain: production default unchanged for historical publications", () => {
  const previous = process.env.REPORT_CARD_VERIFY_ORIGIN;
  try {
    delete process.env.REPORT_CARD_VERIFY_ORIGIN;
    assert.equal(verificationUrl("public-id", "capability"), "https://somafrik.app/verify/rc/public-id.capability");
  } finally {
    if (previous === undefined) delete process.env.REPORT_CARD_VERIFY_ORIGIN;
    else process.env.REPORT_CARD_VERIFY_ORIGIN = previous;
  }
});

test("QR domain: preprod links only to its matching web verification route", () => {
  const previous = process.env.REPORT_CARD_VERIFY_ORIGIN;
  try {
    process.env.REPORT_CARD_VERIFY_ORIGIN = "https://preprod.somafrik.app";
    assert.equal(verificationUrl("public-id", "capability"), "https://preprod.somafrik.app/verify/rc/public-id.capability");
    for (const invalid of ["http://preprod.somafrik.app", "https://evil.example", "https://preprod.somafrik.app.evil.example", "https://somafrik.app/other"]) {
      process.env.REPORT_CARD_VERIFY_ORIGIN = invalid;
      assert.throws(() => verificationUrl("public-id", "capability"), /REPORT_CARD_VERIFY_ORIGIN_INVALID/);
    }
  } finally {
    if (previous === undefined) delete process.env.REPORT_CARD_VERIFY_ORIGIN;
    else process.env.REPORT_CARD_VERIFY_ORIGIN = previous;
  }
});
