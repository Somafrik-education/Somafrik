/**
 * L8 — revalidation des permissions live au retour foreground.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const SRC = path.join(MOBILE, "src");

function readSrc(rel) {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function main() {
  const unit = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", "mobileLivePermissionsRefresh.test.ts")], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (unit.status !== 0) {
    throw new Error(unit.stderr || unit.stdout || "mobileLivePermissionsRefresh.test.ts failed");
  }
  process.stdout.write(unit.stdout || "");

  const auth = readSrc(path.join("context", "AuthContext.tsx"));
  const navigator = readSrc(path.join("navigation", "AppNavigator.tsx"));
  const adminCtx = stripComments(readSrc(path.join("context", "AdminDataContext.tsx")));
  const refresh = readSrc(path.join("lib", "livePermissionsRefresh.ts"));
  const permissions = stripComments(readSrc(path.join("domain", "security", "permissions.ts")));
  const outbox = stripComments(readSrc(path.join("components", "OutboxRuntime.tsx")));
  const identity = readSrc(path.join("lib", "canonicalRoleIdentity.ts"));
  const permissionsScreen = readSrc(path.join("screens", "PermissionsScreen.tsx"));
  const identityLib = stripComments(identity);
  const tests = readSrc(path.join("lib", "mobileLivePermissionsRefresh.test.ts"));

  assert.match(auth, /AppState\.addEventListener\("change"/);
  assert.match(auth, /planForegroundRefresh/);
  assert.match(auth, /createEffectivePermissionsRefresher/);
  assert.match(auth, /getEffectivePermissions/);
  assert.match(auth, /refreshEffectivePermissions/);
  assert.doesNotMatch(stripComments(auth), /setInterval/);

  assert.match(refresh, /status === 401 \|\| status === 403/);
  assert.match(refresh, /onBootstrap\("loading"/);
  assert.match(refresh, /onBootstrap\("ready"/);
  assert.match(refresh, /onBootstrap\("error"/);
  assert.match(refresh, /applyLivePermissionsToSession/);
  assert.doesNotMatch(stripComments(refresh), /setInterval/);
  assert.doesNotMatch(stripComments(refresh), /\.push\(/);
  assert.doesNotMatch(
    stripComments(refresh),
    /\[\.\.\.\(session\.permissions[^\]]*\)[^\]]*payload\.permissions/,
    "interdit d'unionner l'ancien snapshot avec la réponse live",
  );

  assert.match(navigator, /permissionsBootstrap === "idle" \|\| permissionsBootstrap === "loading"/);
  assert.match(navigator, /permissionsBootstrap === "error"/);
  assert.match(navigator, /permissionsBootstrap !== "ready"/);

  assert.doesNotMatch(
    adminCtx,
    /getEffectivePermissions/,
    "AdminDataContext ne doit pas fetcher effective-permissions",
  );
  assert.doesNotMatch(adminCtx, /session\.permissions\.push/);
  assert.doesNotMatch(adminCtx, /setSession\(/);
  assert.doesNotMatch(adminCtx, /AppState/, "AdminDataContext ne doit pas devenir une 2e autorité AppState");
  assert.doesNotMatch(adminCtx, /refreshEffectivePermissions/);
  assert.match(refresh, /attachCanonicalRoleIdentity/);

  assert.doesNotMatch(
    permissions,
    /if \(Array\.isArray\(userPermissions\)\) \{[\s\S]{0,200}getInternalRoleDefaults/,
    "un tableau live ne doit pas retomber sur la matrice locale",
  );

  assert.match(outbox, /permissionsBootstrap !== "ready"/);
  assert.match(permissionsScreen, /GRANT\/REVOKE ne sont plus simulés localement/);

  assert.match(identity, /hasAuthoritativeRoleKeys/);
  assert.match(identity, /UNAFFECTED_ROLE_LABEL = "Sans affectation"/);
  assert.match(identity, /UNAFFECTED_SESSION_ROLE = "unassigned"/);
  assert.match(identityLib, /if \(authoritative && roleKeys\.length === 0\)/);
  assert.doesNotMatch(
    identityLib,
    /if \(fromArrays\.length\) return fromArrays/,
    "roleKeys: [] ne doit plus être traité comme une absence d'information",
  );
  assert.match(refresh, /Array\.isArray\(payload\.roleKeys\)/);
  assert.match(tests, /roleKeys: \[\]/);
  assert.match(tests, /permissions: \[\]/);
  assert.match(tests, /super_admin/);
  assert.match(tests, /Sans affectation/);
  assert.match(tests, /unassigned/);

  console.log("OK: permissions live revalidées au foreground, fail-closed, AuthContext unique");
}

main();
