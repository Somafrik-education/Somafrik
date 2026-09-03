"use strict";

/**
 * Live-state adapter for Release Governance.
 *
 * The historical governance checker is preserved byte-for-byte in
 * verify-release-governance-core.js. This adapter only reclassifies the exact
 * main history created by the controlled G5/G6 promotions (#479 and #485).
 * Every source replacement is exact and fail-closed; all other checks from the
 * historical checker still execute unchanged.
 */

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const CORE = path.join(__dirname, "verify-release-governance-core.js");
const EXPECTED_CORE_BLOB = "3d7b2381b5412bbc7395b61592ed2199a2ca3035";
const CURRENT_MAIN = "41ce090a2dca57d19ee08f74059afeff871ad2f5";

// Après la réconciliation d'historique, CURRENT_MAIN et ses promotions G5/G6
// sont désormais ancêtres de develop : origin/develop..origin/main est vide.
const CURRENT_MAIN_ONLY = [];

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label}: motif source absent — FAIL CLOSED`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${label}: motif source dupliqué — FAIL CLOSED`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const coreBlob = execFileSync("git", ["hash-object", CORE], {
  cwd: path.resolve(__dirname, ".."),
  encoding: "utf8",
}).trim();
assert.equal(coreBlob, EXPECTED_CORE_BLOB, "core release-governance inattendu — FAIL CLOSED");

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
  '    console.log("PASS RG-MAIN-ONLY reconciled : origin/main est ancêtre de develop ; aucun commit main-only");',
  "main-only log",
);

const compiled = new Module(CORE, module.parent);
compiled.filename = CORE;
compiled.paths = module.paths;
compiled._compile(source, CORE);
