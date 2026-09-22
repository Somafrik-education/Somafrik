"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalize } = require("./jcs");

test("RFC 8785 Appendix sample values.json", () => {
  const input = {
    numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
    string: "€$\u000f\nA'B\"\\\\\"/",
    literals: [null, true, false],
  };
  const expected =
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}';
  assert.equal(canonicalize(input), expected);
});

test("RFC 8785 UTF-16 property sort order", () => {
  const input = {
    "\u20ac": "Euro Sign",
    "\r": "Carriage Return",
    "\ufb33": "Hebrew Letter Dalet With Dagesh",
    1: "One",
    "\ud83d\ude00": "Emoji: Grinning Face",
    "\u0080": "Control",
    "\u00f6": "Latin Small Letter O With Diaeresis",
  };
  const canon = canonicalize(input);
  const keyOrder = [...canon.matchAll(/"((?:\\.|[^"\\])*)":/g)].map((m) => JSON.parse(`"${m[1]}"`));
  assert.deepEqual(keyOrder, [
    "\r",
    "1",
    "\u0080",
    "\u00f6",
    "\u20ac",
    "\ud83d\ude00",
    "\ufb33",
  ]);
  assert.equal(
    canon,
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}'
  );
});

test("RFC 8785 Appendix B number samples (IEEE-754 hex)", () => {
  const rows = [
    ["0000000000000000", "0"],
    ["8000000000000000", "0"],
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["c340000000000000", "-9007199254740992"],
    ["7fffffffffffffff", null],
    ["7ff0000000000000", null],
    ["44b52d02c7e14af6", "1e+23"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555555", "333333333.3333333"],
  ];
  for (const [hex, expected] of rows) {
    const num = Buffer.from(hex, "hex").readDoubleBE(0);
    if (expected == null) {
      assert.throws(() => canonicalize(num), /non-finite/);
    } else {
      assert.equal(canonicalize(num), expected, hex);
    }
  }
});

test("I-JSON reject undefined, lone surrogate, non-finite", () => {
  assert.throws(() => canonicalize(undefined), /undefined/);
  assert.throws(() => canonicalize({ a: undefined }), /undefined/);
  assert.throws(() => canonicalize([1, undefined]), /undefined/);
  const sparse = [];
  sparse[1] = { score: 10 };
  assert.throws(() => canonicalize(sparse), /sparse array/);
  assert.throws(() => canonicalize("\uD800"), /surrogate/);
  assert.throws(() => canonicalize({ "\uD800": "x" }), /surrogate/);
  assert.throws(() => canonicalize(Number.NaN), /non-finite/);
  assert.throws(() => canonicalize(Number.POSITIVE_INFINITY), /non-finite/);
});
