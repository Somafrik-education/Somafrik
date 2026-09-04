/**
 * S2.3 — Vérifications de sécurité du client Mobile.
 *
 * Usage : npm run verify:mobile-security
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { spawnSync } = require("child_process");

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

function assertUploadValidationBehavior() {
  const validationPath = path.join(SRC, "services", "uploadValidation.ts");
  const runner = `
import {
  assertSecureUploadFile,
  DEFAULT_ALLOWED_UPLOAD_MIME_TYPES,
  DEFAULT_UPLOAD_MAX_BYTES,
  SecureUploadValidationError,
} from ${JSON.stringify(pathToFileURL(validationPath).href)};

function expectFail(label, fn) {
  try {
    fn();
    throw new Error("EXPECTED_FAIL:" + label);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("EXPECTED_FAIL:")) throw error;
    if (!(error instanceof SecureUploadValidationError)) {
      throw new Error(label + ": expected SecureUploadValidationError, got " + (error && error.name));
    }
  }
}

const base = {
  uri: "file:///tmp/photo.jpg",
  name: "photo.jpg",
  mimeType: "image/jpeg",
  size: 1024,
};
const options = {
  maxBytes: DEFAULT_UPLOAD_MAX_BYTES,
  allowedMimeTypes: [...DEFAULT_ALLOWED_UPLOAD_MIME_TYPES],
};

expectFail("upload > maxBytes", () => {
  assertSecureUploadFile({ ...base, size: DEFAULT_UPLOAD_MAX_BYTES + 1 }, options);
});

expectFail("upload MIME interdit", () => {
  assertSecureUploadFile({ ...base, mimeType: "application/x-msdownload" }, options);
});

expectFail("upload taille nulle", () => {
  assertSecureUploadFile({ ...base, size: 0 }, options);
});

expectFail("upload taille inconnue", () => {
  assertSecureUploadFile({ ...base, size: Number.NaN }, options);
});

assertSecureUploadFile(base, options);
console.log("OK: upload validation comportementale (maxBytes / MIME / taille)");
`;

  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", runner],
    { encoding: "utf8", cwd: MOBILE },
  );

  if (result.status !== 0) {
    throw new Error(
      `upload behavioral tests failed:\n${result.stderr || result.stdout || result.error}`,
    );
  }
  process.stdout.write(result.stdout);
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
  const httpClientCode = stripComments(httpClient);
  assert.ok(httpClient.includes("Authorization"), "Authorization centralisé");
  assert.ok(httpClient.includes("refreshAccessTokenOnce") || httpClient.includes("auth/refresh"), "refresh centralisé");
  assert.ok(/REQUEST_TIMEOUT_MS\s*=\s*\d+/.test(httpClient), "timeout défini");
  assert.ok(httpClient.includes("AbortController"), "timeout AbortController");
  assert.ok(
    httpClientCode.includes("timeoutMs = REQUEST_TIMEOUT_MS") ||
      /fetchWithTimeout\([\s\S]*REQUEST_TIMEOUT_MS/.test(httpClientCode),
    "REQUEST_TIMEOUT_MS doit être utilisé par les requêtes",
  );
  // Option A : pas de fausse distinction connect timeout
  assert.ok(
    !/\bCONNECT_TIMEOUT_MS\b/.test(httpClientCode),
    "CONNECT_TIMEOUT_MS ne doit pas être déclaré sans usage réel (Option A)",
  );
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
  console.log("OK: Authorization Header centralisé + timeout global unique");

  // 5) HTTPS production / validation URL
  const env = read(path.join(SRC, "config", "env.ts"));
  assert.ok(env.includes("validateApiRootUrl"), "validateApiRootUrl requis");
  assert.ok(/https:\/\//.test(env) && /production/i.test(env), "HTTPS production requis");
  const appConfig = read(path.join(MOBILE, "app.config.js"));
  assert.ok(appConfig.includes("usesCleartextTraffic"), "cleartext configuré");
  assert.ok(appConfig.includes("expo-build-properties"), "cleartext via expo-build-properties, pas le schéma android Expo");
  assert.ok(/profileAllowsCleartext|isProdProfile/.test(appConfig), "cleartext limité hors store");
  assert.doesNotMatch(read(path.join(MOBILE, "app.json")), /usesCleartextTraffic/);
  console.log("OK: validation URL / HTTPS production");

  // 6) Téléchargement sécurisé + adaptateur documenté
  assert.ok(api.includes("downloadAsync") || api.includes("downloadReportCardPdf"), "download PDF");
  assert.ok(api.includes("result.status !== 200") || api.includes("status !== 200"), "status 200 strict");
  assert.ok(/mimeType|application\/pdf|pdf/.test(api), "content-type contrôlé");
  assert.ok(/size\s*<=\s*0|size\s*>\s*0/.test(api), "taille contrôlée");
  assert.ok(
    /adaptateur|FileSystem\.downloadAsync|exception documentée/i.test(api),
    "exception native PDF documentée",
  );
  console.log("OK: téléchargement sécurisé (adaptateur documenté)");

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
  const allowed = new Set(["CAMERA"]);
  const unexpected = permissions.filter((p) => !allowed.has(p));
  assert.deepStrictEqual(unexpected, [], `permissions inattendues: ${unexpected.join(", ")}`);
  assert.ok(!permissions.includes("READ_MEDIA_IMAGES"), "READ_MEDIA_IMAGES doit être absent de app.json");
  assert.ok(!permissions.includes("android.permission.READ_MEDIA_IMAGES"), "READ_MEDIA_IMAGES doit être absent de app.json");
  // Pas de localisation ni galerie large
  assert.ok(!permissions.some((p) => /LOCATION|ACCESS_FINE|ACCESS_COARSE|READ_EXTERNAL|WRITE_EXTERNAL|READ_MEDIA/i.test(p)));
  console.log("OK: permissions minimales (CAMERA uniquement, pas de READ_MEDIA_IMAGES)");

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
  assert.ok(api.includes("revokeCurrentPushDevice"), "logout révoque le jeton push");
  console.log("OK: nettoyage déconnexion");

  // 12) Package deps
  const pkg = JSON.parse(read(path.join(MOBILE, "package.json")));
  assert.ok(pkg.dependencies["expo-secure-store"], "dépendance expo-secure-store");
  assert.ok(pkg.dependencies["expo-notifications"], "dépendance expo-notifications");
  assert.ok(!pkg.dependencies["axios"], "pas d'axios requis (fetch client unique)");
  console.log("OK: dépendances sécurité");

  // 13) Production logs / debug
  assert.ok(read(path.join(SRC, "services", "safeLogger.ts")).includes("isProdRuntime") || read(path.join(SRC, "services", "safeLogger.ts")).includes("__DEV__"));
  console.log("OK: logs verbeux désactivés en production");

  // 14) Upload : contrôles réels (pas de paramètres neutralisés)
  const uploadValidation = read(path.join(SRC, "services", "uploadValidation.ts"));
  assert.ok(uploadValidation.includes("assertSecureUploadFile"), "assertSecureUploadFile requis");
  assert.ok(uploadValidation.includes("SecureUploadFile"), "type SecureUploadFile requis");
  assert.ok(!/void\s+maxBytes/.test(httpClientCode), "maxBytes ne doit pas être neutralisé");
  assert.ok(!/void\s+allowedMimeTypes/.test(httpClientCode), "allowedMimeTypes ne doit pas être neutralisé");
  assert.ok(
    httpClientCode.includes("assertSecureUploadFile(file"),
    "httpUpload doit appeler assertSecureUploadFile",
  );
  assert.ok(
    /function\s+httpUpload\s*\(\s*path:\s*string,\s*file:\s*SecureUploadFile/.test(httpClient) ||
      /httpUpload\(\s*path:\s*string,\s*file:\s*SecureUploadFile/.test(httpClient),
    "httpUpload doit exiger SecureUploadFile (pas FormData brut)",
  );
  assert.ok(api.includes("uploadSecureFile"), "API publique uploadSecureFile");
  assert.ok(!/uploadSecureForm\s*\(\s*path:\s*string,\s*formData:\s*FormData/.test(api), "pas de bypass FormData");
  assertUploadValidationBehavior();

  // 15) Routes publiques précises (pas de préfixe /schools/ trop large)
  assert.ok(httpClientCode.includes("PUBLIC_PATHS"), "liste PUBLIC_PATHS requise");
  assert.ok(
    !/startsWith\(\s*["']\/schools\//.test(httpClientCode),
    "interdit: path.startsWith(\"/schools/\")",
  );
  assert.ok(
    /\/\^\\\/schools\\\/\[\^\/\]\+\$\//.test(httpClient) ||
      /\/\^\\\/schools\\\/\[\^\/\]\+\$/.test(httpClient),
    "lookup /schools/:code précis requis",
  );
  console.log("OK: routes publiques restreintes (pas de préfixe /schools/ large)");

  void allMobileFiles;
  console.log("verify-mobile-security: SUCCESS");
}

main();
