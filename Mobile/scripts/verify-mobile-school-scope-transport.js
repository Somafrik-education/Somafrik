/**
 * Gate — transport du tenant école (header request-scoped).
 *
 * Vérifie que activeSchoolCode n'est pas seulement du state React :
 * le client HTTP envoie X-Somafrik-School-Code, le backend le résout
 * via resolveEffectiveSchoolScope, et SCH-* n'est jamais produit.
 *
 * Usage : npm run verify:mobile-school-scope-transport
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "Mobile");
const SRC = path.join(MOBILE, "src");
const BACKEND = path.join(ROOT, "backend");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function source(rel) {
  return read(path.join(SRC, rel));
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout || result.error}`);
  }
  process.stdout.write(result.stdout || "");
}

function main() {
  run("npx", ["--yes", "tsx", path.join("src", "lib", "requestSchoolScope.test.ts")], MOBILE);
  run("node", ["--test", path.join("lib", "principalSchoolScope.test.js")], BACKEND);

  const scopeLib = source(path.join("lib", "requestSchoolScope.ts"));
  assert.match(scopeLib, /export const SCHOOL_SCOPE_HEADER = "X-Somafrik-School-Code"/);
  assert.match(scopeLib, /export function applyAuthenticatedSchoolScopeHeader/);
  assert.match(scopeLib, /export function setRequestSchoolScope/);
  assert.match(scopeLib, /export function clearRequestSchoolScope/);
  assert.match(scopeLib, /isInternalSchoolAlias/);
  assert.match(scopeLib, /isSchoolScopedApiPath/);
  assert.doesNotMatch(scopeLib, /headers\.set\([^)]*SCH-/);
  console.log("OK: store de transport header, distinct du state React");

  const http = source(path.join("services", "httpClient.ts"));
  assert.match(http, /applyAuthenticatedSchoolScopeHeader/);
  assert.match(http, /clearRequestSchoolScope/);
  assert.match(http, /Authorization/);
  console.log("OK: httpClient injecte le header school-scoped + purge au 401");

  const context = source(path.join("context", "AdminDataContext.tsx"));
  assert.match(context, /setRequestSchoolScope/);
  assert.match(context, /clearRequestSchoolScope/);
  assert.match(context, /clearStoredSchoolCode/);
  assert.match(context, /skipTenantUntilSchoolChosen/);
  console.log("OK: AdminDataContext synchronise le transport, pas seulement activeSchoolCode");

  const auth = source(path.join("context", "AuthContext.tsx"));
  assert.match(auth, /clearRequestSchoolScope/);
  assert.match(auth, /clearStoredSchoolCode/);
  const api = source(path.join("services", "api.ts"));
  assert.match(api, /clearRequestSchoolScope/);
  assert.match(api, /clearStoredSchoolCode/);
  console.log("OK: logout A → login B purge le scope HTTP immédiatement");

  const selector = source(path.join("components", "SchoolSelector.tsx"));
  assert.match(selector, /schoolSelectorChoice/);
  assert.doesNotMatch(selector, /SCH-/);
  console.log("OK: SchoolSelector ne produit jamais SCH-*");

  const backendScope = read(path.join(BACKEND, "lib", "principalSchoolScope.js"));
  assert.match(backendScope, /function resolveEffectiveSchoolScope/);
  assert.match(backendScope, /function applyEffectiveSchoolScope/);
  assert.match(backendScope, /SCHOOL_SCOPE_HEADER = "X-Somafrik-School-Code"/);
  assert.match(backendScope, /SCHOOL_SCOPE_INTERNAL_ALIAS_FORBIDDEN/);
  assert.match(backendScope, /SCHOOL_SCOPE_OVERRIDE_FORBIDDEN/);
  assert.match(backendScope, /SCHOOL_SCOPE_COUNTRY_FORBIDDEN/);
  const server = read(path.join(BACKEND, "server.js"));
  assert.match(server, /lookupSchoolForEffectiveScope/);
  assert.match(server, /applyEffectiveSchoolScope\(req, lookupSchoolForEffectiveScope\)/);
  assert.match(server, /function requireAuth/);
  console.log("OK: middleware backend request-scoped, vérifié serveur");

  const backendTest = read(path.join(BACKEND, "lib", "principalSchoolScope.test.js"));
  assert.match(backendTest, /CD-IN-26-001/);
  assert.match(backendTest, /BI-EC-26-001/);
  assert.match(backendTest, /Admin Pays CD \+ école BI/);
  assert.match(backendTest, /Admin School ne peut pas override/);
  assert.match(backendTest, /SCH-\* envoyé par le client/);
  console.log("OK: cas Superadmin / Admin Pays / Admin School / SCH-* couverts");

  console.log("verify:mobile-school-scope-transport OK");
}

main();
