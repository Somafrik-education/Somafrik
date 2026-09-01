"use strict";

/**
 * Gate Web smoke GO-PROD — evidence/test-only.
 * Relie le smoke local à HEAD courant. Ne déploie rien.
 * Les hébergements préprod/prod sans SHA vérifiable = MANUAL BLOCKER.
 */

const assert = require("node:assert/strict");
const { spawn, spawnSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = "58ef7b67d6c815aa85d1066b17394e68c15fd174";
const API_PORT = Number(process.env.SOMAFRIK_WEB_SMOKE_API_PORT || 5091);
const WEB_PORT = Number(process.env.SOMAFRIK_WEB_SMOKE_WEB_PORT || 4191);
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const WEB_BASE = `http://127.0.0.1:${WEB_PORT}`;
const SCHOOL_CODE = "CD-IN-26-001";
const IDENTIFIER = "admin";
const PASSWORD = "1234";
const HOSTED_ASSET = "index-J4_5WK6-.js";
const ARTIFACT_DIR = process.env.SOMAFRIK_WEB_SMOKE_ARTIFACTS || "/tmp/somafrik-web-smoke";

const HOSTED = [
  { id: "preprod-web", url: "https://preprod.somafrik.app/", kind: "html" },
  { id: "preprod-login", url: "https://preprod.somafrik.app/connexion", kind: "html" },
  { id: "render-web", url: "https://somafrik-web-preprod.onrender.com/", kind: "html" },
  { id: "prod-web", url: "https://somafrik.app/", kind: "html" },
  { id: "api-preprod-alias", url: "https://api-preprod.somafrik.app/api/health", kind: "health" },
  { id: "api-preprod-render", url: "https://somafrik-api-preprod.onrender.com/api/health", kind: "health" },
  { id: "api-prod", url: "https://api.somafrik.app/api/health", kind: "health" },
];

const API_READS = [
  { id: "WS-API-classes", path: "/api/classes" },
  { id: "WS-API-students", path: "/api/students" },
  { id: "WS-API-presences", path: "/api/presences" },
  { id: "WS-API-evaluations", path: "/api/evaluations" },
  { id: "WS-API-schedules", path: "/api/course-schedules" },
  { id: "WS-API-payments", path: "/api/payments" },
  { id: "WS-API-permissions", path: "/api/auth/effective-permissions" },
];

const BROWSER_PAGES = [
  { id: "WS-UI-dashboard", path: "/tableau-de-bord", expect: /tableau|pilotage|établissement|dashboard/i },
  { id: "WS-UI-classes", path: "/etablissement/classes", expect: /classes/i },
  { id: "WS-UI-students", path: "/etablissement/eleves", expect: /élèves|eleves/i },
  { id: "WS-UI-presences", path: "/presences", expect: /présence|appel|classe/i },
  { id: "WS-UI-notes", path: "/notes", expect: /note|évaluation/i },
  { id: "WS-UI-planning", path: "/planning/emploi-du-temps/calendrier", expect: /planning|emploi|calendrier|cours/i },
  { id: "WS-UI-finance", path: "/finances/paiements", expect: /paiement|finance/i },
];

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return process.env.GITHUB_SHA || "unknown";
  }
}

function hasBaselineAncestor() {
  try {
    execSync(`git merge-base --is-ancestor ${BASELINE} HEAD`, { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return process.env.SOMAFRIK_WEB_SMOKE_ALLOW_OTHER_SHA === "1";
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countRows(data) {
  if (Array.isArray(data)) return data.length;
  if (data && Array.isArray(data.items)) return data.items.length;
  if (data && Array.isArray(data.rows)) return data.rows.length;
  if (data && typeof data.count === "number") return data.count;
  return null;
}

async function fetchText(url, { timeoutMs = 15000, method = "GET", headers = {}, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
      redirect: "follow",
    });
    const text = await response.text();
    return {
      status: response.status,
      text,
      headers: Object.fromEntries(response.headers.entries()),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options) {
  const raw = await fetchText(url, options);
  let data = null;
  try {
    data = raw.text ? JSON.parse(raw.text) : null;
  } catch {
    data = raw.text;
  }
  return { ...raw, data };
}

function requestLocal(method, urlPath, { token, body } = {}) {
  const payload = body == null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: API_PORT,
        path: urlPath,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 20000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = text;
          }
          resolve({ status: res.statusCode, data, text });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout ${method} ${urlPath}`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function spawnBackend() {
  return spawn(process.execPath, ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    detached: true,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
      SOMAFRIK_SKIP_DEMO_SEED: "false",
      JWT_SECRET: process.env.JWT_SECRET || "web-smoke-jwt-secret-with-enough-length-32",
      CORS_ORIGINS: `http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function spawnPreview() {
  return spawn("npx", ["--yes", "vite", "preview", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], {
    cwd: path.join(ROOT, "web"),
    detached: true,
    env: {
      ...process.env,
      VITE_API_URL: API_BASE,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function killTree(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

async function waitFor(fn, label, attempts = 40, delayMs = 500) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await wait(delayMs);
  }
  throw new Error(`${label} indisponible: ${last instanceof Error ? last.message : last}`);
}

function sourceGuards() {
  const findings = fs.readFileSync(path.join(ROOT, "docs/audits/web-smoke-goprod-2026-09-01.md"), "utf8");
  assert.match(findings, /Web smoke GO-PROD/);
  assert.match(findings, /58ef7b67d6c815aa85d1066b17394e68c15fd174/);
  assert.match(findings, /MANUAL BLOCKER/);
  assert.doesNotMatch(findings, /déclencher un déploiement/i);
  assert.doesNotMatch(findings, /Play Store|merge `main`/i);
}

async function probeHosted() {
  const rows = [];
  for (const target of HOSTED) {
    try {
      const payload = target.kind === "health"
        ? await fetchJson(target.url, { timeoutMs: 20000 })
        : await fetchText(target.url, { timeoutMs: 20000 });
      const body = payload.data ?? payload.text ?? "";
      const text = typeof body === "string" ? body : JSON.stringify(body);
      const shaHit = /58ef7b67|b91f71c3/i.test(text);
      const asset = /index-[A-Za-z0-9_-]+\.js/.exec(text)?.[0] ?? null;
      const healthObj = body && typeof body === "object" ? body : null;
      rows.push({
        id: `WS-HOSTED-${target.id}`,
        status: payload.status,
        lastModified: payload.headers?.["last-modified"] ?? null,
        asset,
        healthHasSha: Boolean(healthObj && (healthObj.gitSha || healthObj.commit || healthObj.sha)),
        linkedToBaseline: Boolean(shaHit),
        note:
          payload.status >= 200 && payload.status < 400
            ? shaHit
              ? "SHA trouvé"
              : "joignable, SHA non vérifiable"
            : "injoignable",
      });
    } catch (error) {
      rows.push({
        id: `WS-HOSTED-${target.id}`,
        status: 0,
        lastModified: null,
        asset: null,
        healthHasSha: false,
        linkedToBaseline: false,
        note: error.message,
      });
    }
  }
  return rows;
}

async function browserSmoke(tokenIgnored) {
  const puppeteer = require(path.join(ROOT, "backend/node_modules/puppeteer"));
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const results = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${WEB_BASE}/connexion`, { waitUntil: "networkidle0", timeout: 30000 });
    const title = await page.$eval("#login-title", (el) => el.textContent || "");
    assert.match(title, /Connexion plateforme/);
    await page.click('[data-testid="login-profile-school"]');
    await page.evaluate(
      ({ schoolCode, identifier, password }) => {
        const setNative = (selector, value) => {
          const input = document.querySelector(selector);
          if (!input) throw new Error(`champ manquant ${selector}`);
          const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
          proto?.set?.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        };
        setNative('[data-testid="login-school-code"]', schoolCode);
        setNative('[data-testid="login-identifier"]', identifier);
        setNative('[data-testid="login-password"]', password);
      },
      { schoolCode: SCHOOL_CODE, identifier: IDENTIFIER, password: PASSWORD },
    );
    const schoolValue = await page.$eval('[data-testid="login-school-code"]', (el) => el.value);
    assert.equal(schoolValue, SCHOOL_CODE, `code établissement saisi=${schoolValue}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "ws-connexion.png") });
    page.on("pageerror", (error) => console.log("browser pageerror", error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("browser console", msg.text());
    });
    await page.click('[data-testid="login-submit"]');
    await page.waitForFunction(
      () => !window.location.pathname.includes("/connexion") || Boolean(document.querySelector('[role="alert"]')),
      { timeout: 20000 },
    ).catch(() => null);
    await wait(800);
    let url = page.url();
    if (url.includes("/connexion")) {
      const demoBtn = await page.evaluateHandle(() =>
        [...document.querySelectorAll("button")].find((btn) => /Administrateur d.établissement CD/i.test(btn.textContent || "")),
      );
      if (demoBtn.asElement()) {
        await demoBtn.asElement().click();
        await page.click('[data-testid="login-submit"]');
        await page.waitForFunction(() => !window.location.pathname.includes("/connexion"), { timeout: 20000 }).catch(() => null);
        url = page.url();
      }
    }
    const loginOk = /tableau-de-bord|etablissement|planning|notes|presences/.test(url);
    const bodyText = await page.evaluate(() => document.body.innerText);
    results.push({
      id: "WS-UI-login",
      status: loginOk ? 200 : 500,
      detail: url,
      note: loginOk ? "session établissement" : bodyText.slice(0, 240),
    });
    assert.ok(loginOk, `login web n'a pas quitté /connexion (${url}) — ${bodyText.slice(0, 240)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "ws-dashboard.png") });

    for (const route of BROWSER_PAGES) {
      await page.goto(`${WEB_BASE}${route.path}`, { waitUntil: "networkidle0", timeout: 30000 });
      const text = await page.evaluate(() => document.body.innerText);
      const ok = route.expect.test(text) && !/erreur serveur|failed to fetch/i.test(text);
      await page.screenshot({
        path: path.join(ARTIFACT_DIR, `${route.id.toLowerCase()}.png`),
      });
      results.push({
        id: route.id,
        status: ok ? 200 : 500,
        detail: page.url(),
        note: ok ? `texte métier visible` : text.slice(0, 240),
      });
      assert.ok(ok, `${route.id} page vide ou erreur (${page.url()})`);
    }
  } finally {
    await browser.close();
  }
  return results;
}

function buildWeb() {
  const result = spawnSync("npm", ["run", "build"], {
    cwd: path.join(ROOT, "web"),
    encoding: "utf8",
    env: {
      ...process.env,
      VITE_API_URL: API_BASE,
      VITE_SHOW_DEMO_ACCOUNTS: "true",
    },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, "web build a échoué");
  const distHtml = fs.readFileSync(path.join(ROOT, "web/dist/index.html"), "utf8");
  const localAsset = /index-[A-Za-z0-9_-]+\.js/.exec(distHtml)?.[0] ?? null;
  return localAsset;
}

async function main() {
  sourceGuards();
  const sha = gitSha();
  console.log(`Web smoke SHA local=${sha} baseline=${BASELINE}`);
  assert.ok(
    hasBaselineAncestor(),
    `HEAD ${sha} ne contient pas l'ancêtre obligatoire ${BASELINE}`,
  );

  const hosted = await probeHosted();
  for (const row of hosted) {
    console.log(
      `${row.linkedToBaseline ? "PASS" : "HOLD"} ${row.id} status=${row.status} asset=${row.asset || "-"} sha=${row.linkedToBaseline} ${row.note}`,
    );
  }
  const hostedLinked = hosted.some((row) => row.linkedToBaseline);
  if (hostedLinked) {
    console.log("NOTE hosted: une sonde contient le SHA ; cela ne lève pas le blocker sans deploy CTO");
  }

  const child = spawnBackend();
  let preview;
  let localAsset = null;
  try {
    await waitFor(async () => {
      const health = await requestLocal("GET", "/api/health");
      return health.status === 200 ? health : null;
    }, "backend mémoire");

    const login = await requestLocal("POST", "/api/backoffice/login", {
      body: { identifier: IDENTIFIER, password: PASSWORD, schoolCode: SCHOOL_CODE },
    });
    assert.equal(login.status, 200, `login local ${login.status} ${JSON.stringify(login.data)}`);
    const token = login.data?.accessToken;
    assert.ok(token, "login local sans accessToken");
    const schoolCode =
      login.data?.user?.schoolCode || login.data?.school?.code || login.data?.schoolContext?.code || "";
    console.log(`PASS WS-API-login status=200 schoolCode=${schoolCode || "?"}`);

    for (const probe of API_READS) {
      const result = await requestLocal("GET", probe.path, { token });
      const n = countRows(result.data);
      assert.ok(result.status >= 200 && result.status < 300, `${probe.id} ${result.status}`);
      console.log(`PASS ${probe.id} status=${result.status} count=${n ?? "n/a"}`);
    }

    localAsset = process.env.SOMAFRIK_WEB_SMOKE_SKIP_BUILD === "1"
      ? (/index-[A-Za-z0-9_-]+\.js/.exec(fs.readFileSync(path.join(ROOT, "web/dist/index.html"), "utf8"))?.[0] ?? null)
      : buildWeb();
    console.log(`local web asset=${localAsset} hosted asset=${HOSTED_ASSET}`);
    if (localAsset && localAsset !== HOSTED_ASSET) {
      console.log("HOLD WS-HOSTED-asset-mismatch — le bundle hébergé n'est pas ce HEAD (pas de deploy déclenché)");
    }

    preview = spawnPreview();
    await waitFor(async () => {
      const page = await fetchText(`${WEB_BASE}/connexion`, { timeoutMs: 4000 });
      return page.status === 200 ? page : null;
    }, "vite preview");

    const ui = await browserSmoke(token);
    for (const row of ui) {
      console.log(`PASS ${row.id} status=${row.status} ${row.detail}`);
    }
  } finally {
    killTree(preview);
    killTree(child);
    await wait(300);
  }

  console.log("OK verify-web-smoke — local SHA-linked PASS ; hosted = MANUAL BLOCKER (pas de SHA, pas de deploy)");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
