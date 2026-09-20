#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const evidenceDir = path.join(ROOT, "docs/release/evidence");
fs.mkdirSync(evidenceDir, { recursive: true });

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node", ["scripts/verify-api-legacy-aliases.js"]);
run("node", ["scripts/audit-api-orphans.test.js"]);
run("node", ["scripts/audit-api-orphans.js", path.join(evidenceDir, "rc1-architecture-api.json")]);
run("node", [
  "scripts/audit-feature-pg-relations.js",
  path.join(evidenceDir, "rc1-architecture-feature-pg.json"),
]);
