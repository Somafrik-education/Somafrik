/**
 * L0 — Vérité RBAC Mobile : permissions effectives PostgreSQL avant rendu métier.
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
  const unit = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", "mobileRbacLive.test.ts")], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (unit.status !== 0) {
    throw new Error(unit.stderr || unit.stdout || "mobileRbacLive.test.ts failed");
  }
  process.stdout.write(unit.stdout || "");

  const auth = read(path.join("context", "AuthContext.tsx"));
  const navigator = read(path.join("navigation", "AppNavigator.tsx"));
  const permissions = read(path.join("domain", "security", "permissions.ts"));

  assert.match(auth, /getEffectivePermissions/);
  assert.match(auth, /permissionsBootstrap: PermissionsBootstrapState/);
  assert.match(auth, /refreshEffectivePermissions: \(\) => Promise<boolean>/);
  assert.match(auth, /setPermissionsBootstrap\("loading"\)/);
  assert.match(auth, /setPermissionsBootstrap\("ready"\)/);
  assert.match(auth, /setPermissionsBootstrap\("error"\)/);
  assert.match(auth, /error\.status === 401 \|\| error\.status === 403/);
  assert.match(auth, /await refreshEffectivePermissions\(\)/);

  assert.match(navigator, /permissionsBootstrap === "idle" \|\| permissionsBootstrap === "loading"/);
  assert.match(navigator, /permissionsBootstrap === "error"/);
  assert.match(navigator, /Permissions indisponibles/);
  assert.match(navigator, /refreshEffectivePermissions/);

  assert.match(permissions, /SUPER_ADMIN_ALLOWED_FEATURES/);
  assert.doesNotMatch(
    permissions,
    /if \(isSuperAdminSessionRole\(session\?\.role\)\) return true;/,
    "Super Admin ne doit plus bypasser tous les modules établissement",
  );
  assert.match(permissions, /return SUPER_ADMIN_ALLOWED_FEATURES\.has\(feature\)/);

  console.log("OK: Mobile bloque le rendu métier jusqu'aux permissions effectives et limite le Super Admin au périmètre Web");
}

main();
