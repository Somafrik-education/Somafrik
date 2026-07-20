/**
 * S2.1 — Vérifie que l'auth JWT passe exclusivement par Authorization: Bearer.
 *
 * Cas couverts :
 *  - JWT valide dans Authorization → 200
 *  - JWT dans query string (?token= / ?access_token=) → rejet (401)
 *  - JWT absent → 401
 *  - JWT invalide → 401
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
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const BACKEND_DIR = path.join(__dirname, "..");

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
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

  const mobileApi = readUtf8(path.join(ROOT, "Mobile", "src", "services", "api.ts"));
  assert.ok(
    !/access_token=\$\{/.test(mobileApi) && !/[&?]access_token=/.test(mobileApi),
    "Mobile ne doit plus placer access_token dans l'URL PDF",
  );
  assert.ok(
    mobileApi.includes("Authorization: `Bearer"),
    "Mobile doit conserver Authorization Bearer",
  );

  const reportScreen = readUtf8(path.join(ROOT, "Mobile", "src", "screens", "ReportCardsScreen.tsx"));
  assert.ok(
    reportScreen.includes("downloadReportCardPdf"),
    "ReportCardsScreen doit télécharger le PDF via Bearer (downloadReportCardPdf)",
  );
  assert.ok(
    !reportScreen.includes("getReportCardPdfUrl"),
    "ReportCardsScreen ne doit plus ouvrir une URL portant le JWT",
  );

  console.log("OK static: aucune auth JWT via query string (backend + mobile PDF)");
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

async function request(base, pathName, { method = "GET", token, queryToken, queryAccessToken, headers = {} } = {}) {
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
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, text };
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

async function runHttpTests(base) {
  const probePath = "/school";
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

  // PDF — même contrat (plus d'auth via query), indépendamment de l'existence métier
  const pdfProbeId = "ELE-S21-PROBE";
  const pdfQuery = await request(base, `/students/${pdfProbeId}/report.pdf`, {
    queryAccessToken: token,
  });
  assert.strictEqual(pdfQuery.status, 401, "report.pdf ?access_token= doit être 401");
  console.log("OK http: report.pdf ?access_token= → 401");

  const studentsRes = await request(base, "/students?limit=1", { token });
  assert.strictEqual(studentsRes.status, 200, "liste élèves pour test PDF Bearer");
  const students = Array.isArray(studentsRes.data)
    ? studentsRes.data
    : studentsRes.data?.items ?? studentsRes.data?.rows ?? [];
  const studentId = students[0]?.id;
  if (studentId) {
    const pdfOk = await request(base, `/students/${encodeURIComponent(studentId)}/report.pdf`, {
      token,
    });
    assert.ok(
      pdfOk.status === 200 || pdfOk.status === 404,
      `PDF Bearer: status inattendu ${pdfOk.status}`,
    );
    console.log(`OK http: report.pdf avec Bearer → ${pdfOk.status}`);
  } else {
    // Sans élève, on valide quand même que Bearer n'est pas rejeté pour motif query.
    const pdfBearerProbe = await request(base, `/students/${pdfProbeId}/report.pdf`, { token });
    assert.notStrictEqual(pdfBearerProbe.status, 401, "Bearer PDF ne doit pas être 401 auth");
    console.log(`OK http: report.pdf Bearer probe → ${pdfBearerProbe.status}`);
  }
}

async function main() {
  runStaticAudit();

  const { base, child } = await ensureApiBase();
  try {
    await runHttpTests(base);
    console.log("verify-jwt-header: SUCCESS");
  } finally {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000);
        child.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

main().catch((error) => {
  console.error("verify-jwt-header: FAIL");
  console.error(error);
  process.exit(1);
});
