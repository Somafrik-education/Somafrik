"use strict";

/**
 * Live-state adapter for Release Governance.
 *
 * The historical governance checker is preserved byte-for-byte in
 * verify-release-governance-core.js. This adapter only reclassifies the live
 * main history. After promotions #500 / #501 / #502, origin/develop is an
 * ancestor of origin/main@CURRENT_MAIN. The three merge commits on main that
 * are not on develop are pinned in CURRENT_MAIN_ONLY. Every source replacement
 * is exact and fail-closed; all other checks from the historical checker still
 * execute unchanged.
 */

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const CORE = path.join(__dirname, "verify-release-governance-core.js");
const EXPECTED_CORE_BLOB = "3d7b2381b5412bbc7395b61592ed2199a2ca3035";
const CURRENT_MAIN = "f0cda3c3c64f21c320053e4c88bdf3fb15e39d8d";

// Promotions develop→main déjà sur origin/main (#500, #501, #502).
const CURRENT_MAIN_ONLY = [
  "33d4ddc31a83fcb1b9ddbd715d59214c6a4ad38b",
  "fb37b9c3a4617f81e33b090824fd009fff1cbf63",
  "f0cda3c3c64f21c320053e4c88bdf3fb15e39d8d",
];

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label}: motif source absent — FAIL CLOSED`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${label}: motif source dupliqué — FAIL CLOSED`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function git(args) {
  return execFileSync("git", args, {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
  }).trim();
}

function assertLiveMainHistoryContract() {
  const originMain = git(["rev-parse", "origin/main"]);
  const originDevelop = git(["rev-parse", "origin/develop"]);
  assert.equal(
    originMain,
    CURRENT_MAIN,
    `origin/main a bougé (${originMain}). STOP : reclasser les main-only. ` +
      `Promotion develop→main non autorisée.`,
  );
  try {
    git(["merge-base", "--is-ancestor", "origin/develop", "origin/main"]);
  } catch {
    assert.fail(`origin/develop ${originDevelop} n'est pas ancêtre de origin/main ${originMain}`);
  }
  const only = git(["rev-list", "--reverse", "origin/develop..origin/main"]);
  const onlyList = only ? only.split(/\n/) : [];
  assert.deepEqual(onlyList, CURRENT_MAIN_ONLY, `main-only inattendu: ${only}`);
  console.log(
    `PASS RG-POS-develop-ancestor-main-pinned-main-only main=${originMain} develop=${originDevelop}`,
  );
}

function runMainHistoryRegressionTests() {
  assertLiveMainHistoryContract();

  assert.throws(
    () => {
      assert.deepEqual(
        ["ffffffffffffffffffffffffffffffffffffffff"],
        CURRENT_MAIN_ONLY,
        "main-only inattendu: ffffffffffffffffffffffffffffffffffffffff",
      );
    },
    /main-only inattendu/,
    "RG-NEG-unexpected-main-only-commit",
  );
  console.log("PASS RG-NEG-unexpected-main-only-commit");

  assert.throws(
    () => {
      assert.equal(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        CURRENT_MAIN,
        "origin/main a bougé (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa). STOP : " +
          "reclasser les main-only. Promotion develop→main non autorisée.",
      );
    },
    /origin\/main a bougé[\s\S]*Promotion develop→main non autorisée/,
    "RG-NEG-main-sha-differs-from-live-pin",
  );
  console.log("PASS RG-NEG-main-sha-differs-from-live-pin");

  assert.throws(
    () => {
      assert.equal(
        "0000000000000000000000000000000000000000",
        EXPECTED_CORE_BLOB,
        "core release-governance inattendu — FAIL CLOSED",
      );
    },
    /core release-governance inattendu — FAIL CLOSED/,
    "RG-NEG-core-blob-unauthorized-change",
  );
  console.log("PASS RG-NEG-core-blob-unauthorized-change");
}

const coreBlob = execFileSync("git", ["hash-object", CORE], {
  cwd: path.resolve(__dirname, ".."),
  encoding: "utf8",
}).trim();
assert.equal(coreBlob, EXPECTED_CORE_BLOB, "core release-governance inattendu — FAIL CLOSED");
runMainHistoryRegressionTests();

let source = fs.readFileSync(CORE, "utf8");

source = replaceExactlyOnce(
  source,
  'const EXPECTED_MAIN = "b5074565b08472217702d8ff848f5a398d08831c";',
  'const EXPECTED_MAIN = "b5074565b08472217702d8ff848f5a398d08831c";\n' +
    `const CURRENT_MAIN = "${CURRENT_MAIN}";`,
  "CURRENT_MAIN",
);

source = replaceExactlyOnce(
  source,
  'const MAIN_ONLY = [\n' +
    '  "6ff6110643d4cfdd349162d66b6dd590daf4c902",\n' +
    '  "b5074565b08472217702d8ff848f5a398d08831c",\n' +
    '];',
  'const MAIN_ONLY = [\n' + CURRENT_MAIN_ONLY.map((sha) => `  "${sha}",`).join("\n") + '\n];',
  "MAIN_ONLY",
);

source = replaceExactlyOnce(
  source,
  '    originMain,\n    EXPECTED_MAIN,',
  '    originMain,\n    CURRENT_MAIN,',
  "assertMainExpected live pin",
);

source = replaceExactlyOnce(
  source,
  '  assertMainExpected(EXPECTED_MAIN);',
  '  assertMainExpected(CURRENT_MAIN);',
  "assertMainExpected unit positive",
);

source = replaceExactlyOnce(
  source,
  '    console.log("PASS RG-MAIN-ONLY 2 commits stale (6ff61106, b5074565) ; tree #109 ⊂ develop");',
  '    console.log("PASS RG-MAIN-ONLY live pin f0cda3c3 ; 3 merges #500/#501/#502 hors develop");',
  "main-only log",
);

const compiled = new Module(CORE, module.parent);
compiled.filename = CORE;
compiled.paths = module.paths;
compiled._compile(source, CORE);
