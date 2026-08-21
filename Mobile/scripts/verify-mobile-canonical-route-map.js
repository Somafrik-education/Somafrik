/**
 * Une entité = un écran canonique. SchoolManagement ne doit plus ouvrir AdminCrud
 * pour users/teachers/students/payments/announcements.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const SRC = path.join(MOBILE, "src");

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

function main() {
  const unit = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", "canonicalRouteMap.test.ts")], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (unit.status !== 0) {
    throw new Error(unit.stderr || unit.stdout || "canonicalRouteMap.test.ts failed");
  }
  process.stdout.write(unit.stdout || "");

  const school = read(path.join("screens", "SchoolManagementScreen.tsx"));
  assert.match(school, /route:\s*"Users"/);
  assert.match(school, /route:\s*"Teachers"/);
  assert.match(school, /route:\s*"Payments"/);
  assert.match(school, /route:\s*"Announcements"/);
  assert.match(school, /item\.route/);
  assert.doesNotMatch(school, /entity:\s*"users"\s*\}/);
  console.log("OK: SchoolManagement route vers écrans canoniques Users/Teachers/Payments/Announcements");

  const users = read(path.join("screens", "UsersScreen.tsx"));
  const home = read(path.join("screens", "HomeScreen.tsx"));
  const context = read(path.join("context", "AdminDataContext.tsx"));
  assert.match(users, /usersSnapshot/);
  assert.match(users, /loadUsers/);
  assert.match(home, /usersSnapshot/);
  assert.match(context, /getCanonicalUsers/);
  console.log("OK: Accueil et Utilisateurs partagent usersSnapshot");

  const rbac = spawnSync(process.execPath, [path.join("scripts", "verify-mobile-rbac-live.js")], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (rbac.status !== 0) {
    throw new Error(rbac.stderr || rbac.stdout || "verify-mobile-rbac-live.js failed");
  }
  process.stdout.write(rbac.stdout || "");
}

main();
