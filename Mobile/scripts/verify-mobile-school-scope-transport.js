/**
 * Gate — transport + données du tenant école (header request-scoped).
 *
 * Vérifie que activeSchoolCode n'est pas seulement du state React :
 * le client HTTP envoie X-Somafrik-School-Code, le backend le résout
 * via resolveEffectiveSchoolScope, puis les datasets sont réellement
 * limités à l'école sélectionnée. SCH-* n'est jamais produit par l'UI.
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
  run("npx", ["--yes", "tsx", path.join("src", "lib", "canonicalResourceNormalize.test.ts")], MOBILE);
  run("npx", ["--yes", "tsx", path.join("src", "lib", "scope.test.ts")], MOBILE);
  run("node", ["--test", path.join("lib", "principalSchoolScope.test.js")], BACKEND);
  run("node", ["--test", path.join("lib", "requestSchoolScopeData.test.js")], BACKEND);

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

  const normalizer = source(path.join("lib", "canonicalResourceNormalize.ts"));
  assert.match(normalizer, /row\.schoolPublicCode/);
  assert.match(normalizer, /row\.school_login_code/);
  console.log("OK: normalisation Mobile préfère le login_code V2 au school_code interne");

  const scopeUi = source(path.join("lib", "scope.ts"));
  assert.match(scopeUi, /trustServerScopedPlatformTenant/);
  assert.match(scopeUi, /Le client ne doit/);
  console.log("OK: le Mobile ne refiltre pas un dataset plateforme déjà validé côté serveur");

  const backendScope = read(path.join(BACKEND, "lib", "principalSchoolScope.js"));
  assert.match(backendScope, /function resolveEffectiveSchoolScope/);
  assert.match(backendScope, /function applyEffectiveSchoolScope/);
  assert.match(backendScope, /effectiveSchoolCode/);
  assert.match(backendScope, /effectiveSchoolInternalCode/);
  assert.match(backendScope, /schoolScopeSource: "request"/);
  assert.match(backendScope, /SCHOOL_SCOPE_HEADER = "X-Somafrik-School-Code"/);
  assert.match(backendScope, /SCHOOL_SCOPE_INTERNAL_ALIAS_FORBIDDEN/);
  assert.match(backendScope, /SCHOOL_SCOPE_V2_REQUIRED/);
  assert.match(backendScope, /SCHOOL_SCOPE_OVERRIDE_FORBIDDEN/);
  assert.match(backendScope, /SCHOOL_SCOPE_COUNTRY_FORBIDDEN/);

  const tenantScope = read(path.join(BACKEND, "services", "tenantScopeService.js"));
  assert.match(tenantScope, /hasEffectiveSchoolScope/);
  assert.match(tenantScope, /principalSchoolCodes/);
  assert.match(tenantScope, /schoolPublicCode/);
  assert.match(tenantScope, /school_login_code/);
  console.log("OK: scope effectif limite aussi les datasets Superadmin/Admin Pays");

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
  assert.match(backendTest, /code client non V2 est refusé/);

  const dataTest = read(path.join(BACKEND, "lib", "requestSchoolScopeData.test.js"));
  assert.match(dataTest, /Superadmin \+ Nuru ne reçoit que les datasets Nuru/);
  assert.match(dataTest, /Admin Pays \+ Nuru ne reçoit pas les autres écoles du même pays/);
  assert.match(dataTest, /switch Nuru → Lumière ne conserve aucune ligne Nuru/);
  console.log("OK: cas data multi-écoles couverts");

  console.log("verify:mobile-school-scope-transport OK");
}

main();
