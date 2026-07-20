/**
 * S2.3 — Vérifications de sécurité du client Mobile.
 *
 * Usage : npm run verify:mobile-security
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "Mobile");
const SRC = path.join(MOBILE, "src");

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".expo",
  "android",
  "ios",
  "coverage",
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function rel(file) {
  return path.relative(ROOT, file);
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function main() {
  const srcFiles = walk(SRC);
  const allMobileFiles = walk(MOBILE).filter(
    (f) => !f.includes(`${path.sep}scripts${path.sep}`) && !f.endsWith("verify-mobile-security.js"),
  );

  // 1) SecureStore utilisé
  const secureStorage = read(path.join(SRC, "services", "secureStorage.ts"));
  assert.ok(secureStorage.includes("expo-secure-store"), "SecureStore requis");
  assert.ok(secureStorage.includes("saveTokens"), "saveTokens requis");
  assert.ok(secureStorage.includes("clearSecureSession"), "clearSecureSession requis");
  console.log("OK: SecureStore pour les tokens");

  // 2) Aucun AsyncStorage / MMKV pour tokens
  const tokenStorageHits = [];
  for (const file of srcFiles) {
    const content = stripComments(read(file));
    if (/AsyncStorage\.(setItem|getItem|multiSet)/.test(content) && /token/i.test(content)) {
      tokenStorageHits.push(rel(file));
    }
    if (/\bMMKV\b/.test(content) && /token|secure/i.test(content)) {
      tokenStorageHits.push(rel(file));
    }
  }
  assert.deepStrictEqual(tokenStorageHits, [], `AsyncStorage/MMKV tokens: ${tokenStorageHits.join(", ")}`);
  console.log("OK: aucun AsyncStorage/MMKV pour tokens");

  // 3) Aucun token dans les logs applicatifs
  const logHits = [];
  for (const file of srcFiles) {
    if (file.endsWith("safeLogger.ts") || file.endsWith("verify-mobile-security.js")) continue;
    const content = stripComments(read(file));
    if (/console\.(log|error|warn|debug)\([^\)]*(token|Authorization|headers|response\.config|error\.config)/i.test(content)) {
      logHits.push(rel(file));
    }
  }
  assert.deepStrictEqual(logHits, [], `logs sensibles: ${logHits.join(", ")}`);
  assert.ok(fs.existsSync(path.join(SRC, "services", "safeLogger.ts")), "safeLogger requis");
  console.log("OK: logs sans tokens");

  // 4) Client HTTP centralisé
  const httpClient = read(path.join(SRC, "services", "httpClient.ts"));
  assert.ok(httpClient.includes("Authorization"), "Authorization centralisé");
  assert.ok(httpClient.includes("refreshAccessTokenOnce") || httpClient.includes("auth/refresh"), "refresh centralisé");
  assert.ok(/REQUEST_TIMEOUT_MS\s*=\s*\d+/.test(httpClient), "timeout défini");
  assert.ok(httpClient.includes("AbortController"), "timeout AbortController");
  const api = read(path.join(SRC, "services", "api.ts"));
  assert.ok(api.includes('from "./httpClient"') || api.includes("httpRequest"), "api utilise httpClient");
  // Pas d'Authorization construit dans les écrans
  const screenAuthHits = [];
  for (const file of srcFiles.filter((f) => f.includes(`${path.sep}screens${path.sep}`))) {
    const content = stripComments(read(file));
    if (/Authorization\s*:\s*[`'"]Bearer/.test(content)) {
      screenAuthHits.push(rel(file));
    }
  }
  assert.deepStrictEqual(screenAuthHits, [], `Authorization manuel écrans: ${screenAuthHits.join(", ")}`);
  console.log("OK: Authorization Header centralisé + timeout");

  // 5) HTTPS production / validation URL
  const env = read(path.join(SRC, "config", "env.ts"));
  assert.ok(env.includes("validateApiRootUrl"), "validateApiRootUrl requis");
  assert.ok(/https:\/\//.test(env) && /production/i.test(env), "HTTPS production requis");
  const appConfig = read(path.join(MOBILE, "app.config.js"));
  assert.ok(appConfig.includes("usesCleartextTraffic"), "cleartext configuré");
  assert.ok(/!isProdProfile|isProdProfile/.test(appConfig), "cleartext limité hors prod");
  console.log("OK: validation URL / HTTPS production");

  // 6) Téléchargement sécurisé
  assert.ok(api.includes("downloadAsync") || api.includes("downloadReportCardPdf"), "download PDF");
  assert.ok(api.includes("result.status !== 200") || api.includes("status !== 200"), "status 200 strict");
  assert.ok(/mimeType|application\/pdf|pdf/.test(api), "content-type contrôlé");
  assert.ok(/size\s*<=\s*0|size\s*>\s*0/.test(api), "taille contrôlée");
  console.log("OK: téléchargement sécurisé");

  // 7) Secrets hardcodés
  const secretHits = [];
  const secretPatterns = [
    { name: "Bearer literal token", regex: /Bearer\s+eyJ[A-Za-z0-9_-]+\./ },
    { name: "private key block", regex: /BEGIN (RSA )?PRIVATE KEY/ },
    { name: "client_secret assignment", regex: /client_secret\s*=\s*['"][^'"]+['"]/i },
    { name: "apikey assignment", regex: /api[_-]?key\s*=\s*['"][A-Za-z0-9_\-]{16,}['"]/i },
    { name: "hardcoded https API const", regex: /const\s+API\s*=\s*['"]https?:\/\// },
  ];
  for (const file of srcFiles) {
    const content = stripComments(read(file));
    for (const pattern of secretPatterns) {
      if (pattern.regex.test(content)) {
        secretHits.push(`${rel(file)} → ${pattern.name}`);
      }
    }
  }
  assert.deepStrictEqual(secretHits, [], `secrets: ${secretHits.join(", ")}`);
  console.log("OK: aucun secret embarqué");

  // 8) Permissions minimales
  const appJson = JSON.parse(read(path.join(MOBILE, "app.json")));
  const permissions = appJson?.expo?.android?.permissions ?? [];
  const allowed = new Set(["CAMERA", "READ_MEDIA_IMAGES"]);
  const unexpected = permissions.filter((p) => !allowed.has(p));
  assert.deepStrictEqual(unexpected, [], `permissions inattendues: ${unexpected.join(", ")}`);
  // Pas de localisation
  assert.ok(!permissions.some((p) => /LOCATION|ACCESS_FINE|ACCESS_COARSE/i.test(p)));
  console.log("OK: permissions minimales");

  // 9) Variables d'environnement
  assert.ok(env.includes("EXPO_PUBLIC_API_URL"), "EXPO_PUBLIC_API_URL utilisé");
  assert.ok(appConfig.includes("EXPO_PUBLIC_API_URL"), "app.config lit EXPO_PUBLIC_API_URL");
  console.log("OK: variables d'environnement");

  // 10) Certificate pinning architecture
  const pinning = read(path.join(SRC, "services", "certificatePinning.ts"));
  assert.ok(pinning.includes("CERTIFICATE_PINNING_ARCHITECTURE_READY"), "pinning ready flag");
  assert.ok(pinning.includes("assertTransportSecurity"), "transport security hook");
  console.log("OK: architecture certificate pinning préparée");

  // 11) Logout nettoie
  const authCtx = read(path.join(SRC, "context", "AuthContext.tsx"));
  assert.ok(authCtx.includes("logout"), "logout AuthContext");
  assert.ok(api.includes("clearSecureSession"), "logout clearSecureSession");
  console.log("OK: nettoyage déconnexion");

  // 12) Package deps
  const pkg = JSON.parse(read(path.join(MOBILE, "package.json")));
  assert.ok(pkg.dependencies["expo-secure-store"], "dépendance expo-secure-store");
  assert.ok(!pkg.dependencies["axios"], "pas d'axios requis (fetch client unique)");
  console.log("OK: dépendances sécurité");

  // 13) Production logs / debug
  assert.ok(read(path.join(SRC, "services", "safeLogger.ts")).includes("isProdRuntime") || read(path.join(SRC, "services", "safeLogger.ts")).includes("__DEV__"));
  console.log("OK: logs verbeux désactivés en production");

  void allMobileFiles;
  console.log("verify-mobile-security: SUCCESS");
}

main();
