/**
 * L0 — Vérité RBAC Mobile : permissions effectives PostgreSQL avant rendu métier.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const ROOT = path.join(MOBILE, "..");
const SRC = path.join(MOBILE, "src");

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

function extractStringSet(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker} introuvable`);
  const fragment = source.slice(markerIndex);
  const match = fragment.match(/new Set(?:<[^>]+>)?\(\[([\s\S]*?)\]\)/);
  assert.ok(match, `${marker}: Set littéral introuvable`);
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((entry) => entry[1]).sort();
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
  const webSuperAdmin = fs.readFileSync(path.join(ROOT, "web", "src", "lib", "superAdminAccess.ts"), "utf8");

  assert.match(auth, /getEffectivePermissions/);
  assert.match(auth, /permissionsBootstrap: PermissionsBootstrapState/);
  assert.match(auth, /refreshEffectivePermissions: \(\) => Promise<boolean>/);
  assert.match(auth, /setPermissionsBootstrap\("loading"\)/);
  assert.match(auth, /saveSession\(stripSecrets\(next\)\)/);
  assert.match(auth, /await refreshEffectivePermissions\(\)/);
  assert.match(auth, /createEffectivePermissionsRefresher/);
  const refreshLib = read(path.join("lib", "livePermissionsRefresh.ts"));
  assert.match(refreshLib, /onBootstrap\("ready"/);
  assert.match(refreshLib, /onBootstrap\("error"/);
  assert.match(refreshLib, /onBootstrap\("loading"/);
  assert.match(refreshLib, /status === 401 \|\| status === 403/);

  assert.match(navigator, /permissionsBootstrap === "idle" \|\| permissionsBootstrap === "loading"/);
  assert.match(navigator, /permissionsBootstrap === "error"/);
  assert.match(navigator, /Permissions indisponibles/);
  assert.match(navigator, /refreshEffectivePermissions/);
  assert.match(navigator, /isMetierRenderable/);
  assert.match(navigator, /key=\{session \? "authenticated" : "public"\}/);
  assert.match(navigator, /initialRouteName=\{session \? "Home" : "Welcome"\}/);

  assert.match(permissions, /SUPER_ADMIN_ALLOWED_FEATURES/);
  assert.doesNotMatch(
    permissions,
    /if \(isSuperAdminSessionRole\(session\?\.role\)\) return true;/,
    "Super Admin ne doit plus bypasser tous les modules établissement",
  );
  assert.match(permissions, /return SUPER_ADMIN_ALLOWED_FEATURES\.has\(feature\)/);
  assert.match(permissions, /return SUPER_ADMIN_ALLOWED_VIEWS\.has\(viewName\)/);

  const mobileFeatures = extractStringSet(permissions, "SUPER_ADMIN_ALLOWED_FEATURES");
  const webFeatures = extractStringSet(webSuperAdmin, "SUPER_ADMIN_ALLOWED_FEATURES");
  assert.deepStrictEqual(
    mobileFeatures,
    webFeatures,
    "Le périmètre Super Admin Mobile doit rester identique à la référence Web",
  );

  console.log("OK: Mobile bloque le rendu métier jusqu'aux permissions effectives et limite le Super Admin au périmètre Web");
}

main();
