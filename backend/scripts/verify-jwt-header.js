/**
 * S2.1 — Vérifie que l'auth JWT passe exclusivement par Authorization: Bearer.
 *
 * Cas couverts :
 *  - JWT valide dans Authorization → 200
 *  - JWT dans query string (?token= / ?access_token=) → rejet (401)
 *  - JWT absent → 401
 *  - JWT invalide → 401
 *  - report.pdf Bearer → 200 + application/pdf + corps non vide
 *  - audit statique repo (pas de JWT en URL)
 *  - compilation TypeScript Mobile
 *
 * Usage :
 *   npm run verify:jwt-header
 *   SOMAFRIK_API_URL=http://127.0.0.1:5000/api npm run verify:jwt-header
 *
 * Si aucune API n'est joignable, le script démarre un backend mémoire éphémère.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const BACKEND_DIR = path.join(__dirname, "..");
const MOBILE_DIR = path.join(ROOT, "Mobile");

const IGNORE_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".expo",
  "coverage",
  "test-results",
  "android",
  "ios",
  ".turbo",
  ".next",
]);

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
]);

/** Patterns indiquant un JWT (ou access token) passé en query/URL dans du code exécutable. */
const JWT_URL_PATTERNS = [
  {
    name: "auth fallback req.query.access_token",
    regex: /(?:\?\?|\|\|)\s*req\.query(?:\?)?\.access_token\b/,
  },
  {
    name: "auth fallback req.query.token",
    regex: /(?:\?\?|\|\|)\s*req\.query(?:\?)?\.token\b/,
  },
  {
    name: "query access_token assignment",
    regex: /[?&]access_token\s*=/,
  },
  {
    name: "query token assignment",
    regex: /[?&]token\s*=\s*['"`$]/,
  },
  {
    name: "template access_token in URL",
    regex: /access_token=\$\{/,
  },
  {
    name: "template token in URL",
    regex: /[?&]token=\$\{/,
  },
  {
    name: "searchParams token",
    regex: /searchParams\.(set|append)\(\s*['"`](access_token|token)['"`]/,
  },
  {
    name: "URLSearchParams token",
    regex: /URLSearchParams[\s\S]{0,120}['"`](access_token|token)['"`]/,
  },
  {
    name: "encodeURIComponent(accessToken) in query",
    regex: /(?:\?|&|`|&amp;)access_token=\$\{encodeURIComponent\(\s*accessToken/,
  },
];

function stripCommentsAndStringsNoise(source) {
  // Retire commentaires pour ne pas flagger les mentions d'interdiction (?token= dans un commentaire).
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function walkFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORE_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    out.push(full);
  }
  return out;
}

function isSelfVerifyScript(filePath) {
  return path.resolve(filePath) === path.resolve(__filename);
}

function runStaticAudit() {
  const serverSource = readUtf8(path.join(BACKEND_DIR, "server.js"));
  assert.ok(
    !/match\?\.\[1\]\s*\?\?\s*req\.query\.(access_token|token)/.test(serverSource),
    "requireAuth ne doit plus lire le JWT depuis req.query",
  );
  assert.ok(
    serverSource.includes("rejectJwtInQueryString"),
    "middleware rejectJwtInQueryString attendu",
  );
  assert.ok(
    /JWT dans l'URL interdit/.test(serverSource),
    "message de rejet JWT-in-URL attendu",
  );

  const mobileApi = readUtf8(path.join(MOBILE_DIR, "src", "services", "api.ts"));
  assert.ok(
    !/access_token=\$\{/.test(mobileApi) && !/[?&]access_token=/.test(mobileApi),
    "Mobile ne doit plus placer access_token dans l'URL PDF",
  );
  assert.ok(
    /Authorization:\s*`Bearer \$\{(accessToken|token)\}`/.test(mobileApi) ||
      mobileApi.includes("Authorization: `Bearer ${accessToken}`") ||
      mobileApi.includes("Authorization: `Bearer ${token}`"),
    "Mobile doit envoyer Authorization Bearer pour le PDF",
  );
  assert.ok(
    mobileApi.includes("getAccessToken") || /const\s+accessToken\s*=/.test(mobileApi),
    "downloadReportCardPdf doit résoudre le token via SecureStore / getAccessToken",
  );
  assert.ok(
    mobileApi.includes("FileSystem.downloadAsync") || mobileApi.includes("downloadAsync("),
    "downloadReportCardPdf doit utiliser FileSystem.downloadAsync natif",
  );
  assert.ok(
    !/arrayBuffer\s*\(/.test(mobileApi) && !/\bbtoa\s*\(/.test(mobileApi),
    "downloadReportCardPdf ne doit plus convertir arrayBuffer/btoa",
  );
  assert.ok(
    /if\s*\(\s*!(accessToken|token)\s*\)/.test(mobileApi),
    "downloadReportCardPdf doit refuser explicitement l'absence de token",
  );

  const reportScreen = readUtf8(path.join(MOBILE_DIR, "src", "screens", "ReportCardsScreen.tsx"));
  assert.ok(
    reportScreen.includes("downloadReportCardPdf"),
    "ReportCardsScreen doit télécharger le PDF via Bearer (downloadReportCardPdf)",
  );
  assert.ok(
    !reportScreen.includes("getReportCardPdfUrl"),
    "ReportCardsScreen ne doit plus ouvrir une URL portant le JWT",
  );

  const roots = [
    path.join(ROOT, "backend"),
    path.join(ROOT, "Mobile"),
    path.join(ROOT, "web"),
    path.join(ROOT, "BackOffice"),
    path.join(ROOT, "scripts"),
    path.join(ROOT, "docs"),
  ].filter((dir) => fs.existsSync(dir));

  const hits = [];
  for (const root of roots) {
    for (const filePath of walkFiles(root)) {
      if (isSelfVerifyScript(filePath)) continue;
      const relative = path.relative(ROOT, filePath);
      // Le script de vérif et ce fichier source contiennent volontairement les motifs.
      if (relative.replace(/\\/g, "/") === "backend/scripts/verify-jwt-header.js") continue;

      const content = stripCommentsAndStringsNoise(readUtf8(filePath));
      // Autorise uniquement les gardes de rejet explicites (lecture pour refuser, pas pour auth).
      const withoutRejectGuards = content
        .replace(/if\s*\(\s*query\.token\s*!=\s*null\s*\|\|\s*query\.access_token\s*!=\s*null\s*\)/g, "if (false)")
        .replace(
          /if\s*\(\s*req\.query\?\.token\s*!=\s*null\s*\|\|\s*req\.query\?\.access_token\s*!=\s*null\s*\)/g,
          "if (false)",
        );
      for (const pattern of JWT_URL_PATTERNS) {
        if (pattern.regex.test(withoutRejectGuards)) {
          hits.push(`${relative} → ${pattern.name}`);
        }
      }
    }
  }

  assert.deepStrictEqual(
    hits,
    [],
    `Usages JWT-en-URL détectés:\n${hits.map((h) => `  - ${h}`).join("\n")}`,
  );

  console.log("OK static: audit repo — aucun JWT en query/URL (backend/web/mobile/scripts/docs)");
}

function runMobileTypecheck() {
  const tscLocal = path.join(MOBILE_DIR, "node_modules", "typescript", "bin", "tsc");
  const npxAvailable = spawnSync("npx", ["--version"], { encoding: "utf8" });
  const useLocal = fs.existsSync(tscLocal);
  const result = useLocal
    ? spawnSync(process.execPath, [tscLocal, "--noEmit"], {
        cwd: MOBILE_DIR,
        encoding: "utf8",
      })
    : spawnSync("npx", ["tsc", "--noEmit"], {
        cwd: MOBILE_DIR,
        encoding: "utf8",
        shell: process.platform === "win32",
      });

  if (result.status !== 0) {
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    throw new Error(`TypeScript Mobile a échoué (exit ${result.status}):\n${output}`);
  }
  if (npxAvailable.error && !useLocal) {
    throw new Error(`Impossible de lancer tsc Mobile: ${npxAvailable.error.message}`);
  }
  console.log("OK typescript: Mobile tsc --noEmit");
}

async function waitForHealth(baseApiUrl, timeoutMs = 45_000) {
  const healthUrl = `${baseApiUrl.replace(/\/api\/?$/, "")}/api/health`;
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(healthUrl, { signal: controller.signal }).finally(() =>
        clearTimeout(timer),
      );
      if (response.ok) return;
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`API non prête (${healthUrl}): ${lastError?.message ?? "timeout"}`);
}

async function ensureApiBase() {
  const configured = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";
  try {
    await waitForHealth(configured, 2500);
    console.log(`OK runtime: API existante ${configured}`);
    return { base: configured, child: null };
  } catch {
    // démarre un backend mémoire dédié
  }

  const port = String(19000 + Math.floor(Math.random() * 1000));
  const base = `http://127.0.0.1:${port}/api`;
  const child = spawn(process.execPath, ["scripts/dev-memory.js"], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: port,
      HOST: "127.0.0.1",
      SOMAFRIK_DB_REQUIRED: "false",
      SOMAFRIK_API_ONLY: "true",
      SOMAFRIK_E2E: "true",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      NODE_ENV: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
    // Groupe de processus dédié pour tuer aussi Chrome/Puppeteer enfants.
    detached: true,
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error(`backend mémoire arrêté (code=${code}, signal=${signal})`);
      if (output) console.error(output.slice(-2000));
    }
  });

  try {
    await waitForHealth(base, 60_000);
    console.log(`OK runtime: backend mémoire démarré sur ${base}`);
    return { base, child };
  } catch (error) {
    child.kill("SIGTERM");
    if (output) console.error(output.slice(-2000));
    throw error;
  }
}

async function request(base, pathName, { method = "GET", token, queryToken, queryAccessToken, headers = {}, body } = {}) {
  const url = new URL(`${base}${pathName}`);
  if (queryToken != null) url.searchParams.set("token", String(queryToken));
  if (queryAccessToken != null) url.searchParams.set("access_token", String(queryAccessToken));

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, text, headers: response.headers };
}

async function login(base) {
  const identifier = process.env.SOMAFRIK_VERIFY_IDENTIFIER || "superadmin@somafrik.app";
  const password = process.env.SOMAFRIK_VERIFY_PASSWORD || "1234";
  const loginRes = await fetch(`${base}/backoffice/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  const data = await loginRes.json();
  assert.strictEqual(loginRes.status, 200, `login failed: ${JSON.stringify(data)}`);
  assert.ok(data.accessToken, "accessToken manquant");

  let token = data.accessToken;
  if (data.user?.mustChangePassword) {
    const changeRes = await fetch(`${base}/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ newPassword: password }),
    });
    const changeData = await changeRes.json();
    assert.strictEqual(changeRes.status, 200, `change-password: ${JSON.stringify(changeData)}`);
    token = changeData.accessToken || token;
  }
  return token;
}

/**
 * Liste / PDF élèves : token établissement (schoolCode requis par /api/students PG).
 */
async function loginSchoolScoped(base) {
  const identifier = process.env.SOMAFRIK_VERIFY_SCHOOL_IDENTIFIER || "admin";
  const password = process.env.SOMAFRIK_VERIFY_PASSWORD || "1234";
  const schoolCode = process.env.SOMAFRIK_VERIFY_SCHOOL_CODE || "CD-2026-0001";
  const loginRes = await fetch(`${base}/backoffice/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password, schoolCode }),
  });
  const data = await loginRes.json();
  assert.strictEqual(
    loginRes.status,
    200,
    `login school-scoped failed: ${JSON.stringify(data)}`,
  );
  assert.ok(data.accessToken, "accessToken school-scoped manquant");
  return data.accessToken;
}

function extractApiList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

async function assertPositivePdf(base, token, studentId) {
  const url = new URL(`${base}/students/${encodeURIComponent(studentId)}/report.pdf`);
  url.searchParams.set("period", "Trimestre 1");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const body = Buffer.from(await response.arrayBuffer());

  assert.strictEqual(
    response.status,
    200,
    `report.pdf Bearer doit être 200 (reçu ${response.status})`,
  );
  assert.ok(
    contentType.includes("application/pdf"),
    `Content-Type application/pdf attendu (reçu "${contentType || "(vide)"}")`,
  );
  assert.ok(body.length > 0, "corps PDF non vide attendu");
  assert.ok(
    body.subarray(0, 4).toString("utf8") === "%PDF",
    "signature PDF (%PDF) attendue en tête de corps",
  );

  console.log(
    `OK http: report.pdf Bearer → 200 application/pdf (${body.length} octets)`,
  );
}

async function runHttpTests(base) {
  const probePath = "/backoffice/users";
  const token = await login(base);

  // Positif — Bearer valide
  const ok = await request(base, probePath, { token });
  assert.strictEqual(ok.status, 200, `Bearer valide doit répondre 200 (reçu ${ok.status})`);
  console.log("OK http: JWT Bearer valide → 200");

  // Négatif — JWT dans ?token=
  const viaToken = await request(base, probePath, { queryToken: token });
  assert.strictEqual(viaToken.status, 401, `?token= doit être rejeté (reçu ${viaToken.status})`);
  assert.match(
    String(viaToken.data?.message ?? ""),
    /JWT dans l'URL interdit/i,
    "message de rejet ?token= attendu",
  );
  console.log("OK http: JWT dans ?token= → 401");

  // Négatif — JWT dans ?access_token= (ancien contrat mobile PDF)
  const viaAccess = await request(base, probePath, { queryAccessToken: token });
  assert.strictEqual(
    viaAccess.status,
    401,
    `?access_token= doit être rejeté (reçu ${viaAccess.status})`,
  );
  console.log("OK http: JWT dans ?access_token= → 401");

  // Négatif — query + Bearer : la présence d'un JWT en query reste rejetée
  const both = await request(base, probePath, { token, queryToken: token });
  assert.strictEqual(both.status, 401, "Bearer + ?token= doit être rejeté");
  console.log("OK http: Bearer + ?token= → 401 (fail-closed)");

  // Négatif — JWT absent
  const missing = await request(base, probePath);
  assert.strictEqual(missing.status, 401, `JWT absent doit répondre 401 (reçu ${missing.status})`);
  console.log("OK http: JWT absent → 401");

  // Négatif — JWT invalide
  const invalid = await request(base, probePath, { token: "not-a-valid-jwt" });
  assert.strictEqual(invalid.status, 401, `JWT invalide doit répondre 401 (reçu ${invalid.status})`);
  console.log("OK http: JWT invalide → 401");

  // PDF query rejetée
  const pdfQuery = await request(base, "/students/1/report.pdf", {
    queryAccessToken: token,
  });
  assert.strictEqual(pdfQuery.status, 401, "report.pdf ?access_token= doit être 401");
  console.log("OK http: report.pdf ?access_token= → 401");

  // PDF positif strict (200 + application/pdf + corps non vide)
  // Bulletin PDF lit encore l'état BO (hors consolidation fiche PR1).
  // Token établissement requis ; élève seed mémoire CD-2026-0001.
  const schoolToken = await loginSchoolScoped(base);
  const studentsProbe = await request(base, "/students?limit=1", { token: schoolToken });
  assert.strictEqual(
    studentsProbe.status,
    200,
    `liste élèves établissement doit répondre 200 (reçu ${studentsProbe.status})`,
  );
  await assertPositivePdf(base, schoolToken, "CD-IN-EL-26-001");
}

function stopChildProcessTree(child) {
  if (!child || !child.pid) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => resolve();
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }
      finish();
    }, 2500);

    child.once("exit", () => {
      clearTimeout(timer);
      finish();
    });

    try {
      // Tue le groupe (backend + puppeteer/chrome éventuels).
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(timer);
        finish();
      }
    }
  });
}

async function main() {
  runStaticAudit();
  runMobileTypecheck();

  const { base, child } = await ensureApiBase();
  try {
    await runHttpTests(base);
    console.log("verify-jwt-header: SUCCESS");
  } finally {
    await stopChildProcessTree(child);
  }
}

main().catch((error) => {
  console.error("verify-jwt-header: FAIL");
  console.error(error);
  process.exit(1);
});
