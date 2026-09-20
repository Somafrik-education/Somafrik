#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node", ["scripts/audit-date-ui-contract.js"]);
run("npm", ["--prefix", "web", "run", "test", "--", "src/lib/dates.contract.test.ts"]);
run("npx", ["--yes", "tsx", "Mobile/src/lib/dates.test.ts"]);
