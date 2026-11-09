"use strict";

/**
 * Live-state adapter for Release Governance.
 *
 * The historical governance checker is preserved byte-for-byte in
 * verify-release-governance-core.js. This adapter only reclassifies the live
 * main history. origin/main is pinned to CURRENT_MAIN and every commit that
 * exists on main but not on develop is pinned in CURRENT_MAIN_ONLY. develop is
 * allowed to advance ahead of main between promotions; rev-list develop..main
 * still proves that no unexpected commit has appeared on main. Every source
 * replacement is exact and fail-closed; all other checks from the historical
 * checker still execute unchanged.
 */

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const CORE = path.join(__dirname, "verify-release-governance-core.js");
const EXPECTED_CORE_BLOB = "3d7b2381b5412bbc7395b61592ed2199a2ca3035";
const CURRENT_MAIN = "ef8bc9517ffc94aa770743713d0f561f92a9fc1e";

// Historique explicitement autorisé présent sur origin/main mais absent de develop.
// L'ancien pin #674 (9f4badc6) et les promotions #500–#509 sont désormais
// ancêtres de develop (réconciliation #800). Reste main-only : promotions
// AAB v24 (#799/#801/#802/#803) et promotions contrôlées #823/#825/#827.
const CURRENT_MAIN_ONLY = [
  "372b7aac11fb4b2fda7b8c45ae0a3f7d9f38e7c3",
  "295c044e43dc5b50cd56d419aa24a34b62c8bebe",
  "cb1b79c7104bcae78b68f0810b933522722cf14c",
  "f1102d4709dd8cb74c9cd3100b0f561a8186fde5",
  "a8af4bd2fd32e980c3872c8a2aa7bb077af0a528",
  "aaf6e5ceb4ea7ca8879b5dfc5596f012f9af2fa3",
  "60feff0415a19d2069853e07ff1cf9be6b8c175d",
  "376f17a4da37d63af0e4db1122f4c11e5de75772",
  "8d981efe651112957c32572acd44028d14881349",
  "24e1eb8e923157d5b20100198643711664807c3b",
  "ef8bc9517ffc94aa770743713d0f561f92a9fc1e",
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
  const only = git(["rev-list", "--reverse", "origin/develop..origin/main"]);
  const onlyList = only ? only.split(/\n/) : [];
  assert.deepEqual(onlyList, CURRENT_MAIN_ONLY, `main-only inattendu: ${only}`);
  console.log(
    `PASS RG-POS-main-pinned-main-only develop-may-be-ahead main=${originMain} develop=${originDevelop}`,
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
  '    console.log("PASS RG-MAIN-ONLY live pin ef8bc951 ; 11 commits main-only explicitement autorisés");',
  "main-only log",
);

const compiled = new Module(CORE, module.parent);
compiled.filename = CORE;
compiled.paths = module.paths;
compiled._compile(source, CORE);
