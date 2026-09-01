#!/usr/bin/env node
"use strict";

/**
 * Smoke P0 — périmètre établissement comptes utilisateurs.
 * Ne touche pas au launcher mobile (#454).
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function run(label, command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status}`);
  }
}

function main() {
  run("web users scope", "npm", [
    "--prefix",
    "web",
    "run",
    "test",
    "--",
    "src/lib/scope.schoolAdminCanonical.test.ts",
    "src/lib/domainLoaders.authErrors.test.ts",
    "src/lib/AuthContext.tokenReady.test.tsx",
    "src/pages/UsersPage.schoolAdminCanonical.test.tsx",
    "src/pages/UsersPage.prefetEstablishment.test.tsx",
    "src/lib/AuthContext.permissions.test.tsx",
  ]);
  run("backend users school scope", "node", ["--test", "backend/lib/usersSchoolScope.test.js"]);
  run("mobile scope", "npx", ["--yes", "tsx", "Mobile/src/lib/scope.test.ts"]);
  console.log("verify-school-admin-users-scope.js OK");
}

main();
