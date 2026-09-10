"use strict";

/**
 * Scolarité L0 — smoke visuel Web (1440 / 1024 / 390 / 360).
 * Session injectée + interception API locale. Pas d'appel production.
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const OUT_DIR = "/opt/cursor/artifacts";
const PREVIEW_PORT = Number(process.env.SCOLARITE_L0_PREVIEW_PORT || 4174);
const BASE = `http://127.0.0.1:${PREVIEW_PORT}`;
const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/local/bin/google-chrome"].find((candidate) =>
    fs.existsSync(candidate),
  );

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
  { name: "390", width: 390, height: 844 },
  { name: "360", width: 360, height: 800 },
];

const PAGES = [
  { id: "hub", path: "/etablissement/vue-ensemble", wait: "Scolarité" },
  { id: "classes", path: "/etablissement/classes", wait: "Classes" },
  { id: "students", path: "/etablissement/eleves", wait: "Élèves" },
];

const SCHOOL = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "CD-IN-26-001",
  schoolCode: "CD-IN-26-001",
  name: "Complexe Scolaire Nuru",
  type: "Lycée",
  address: "1 avenue Test",
  phone: "+243810000000",
  email: "contact@nuru.cd",
  city: "Kinshasa",
  country: "RDC",
  countryCode: "CD",
  status: "active",
};

const PERMISSIONS = [
  "Classes:READ",
  "Classes:CREATE",
  "Élèves:READ",
  "Enseignants:READ",
  "Utilisateurs:READ",
  "Relations:READ",
  "Paramètres Établissement:READ",
  "Paramètres Établissement:UPDATE",
];

const SESSION = {
  accessToken: "scolarite-l0-viewport-smoke",
  permissions: PERMISSIONS,
  user: {
    id: "smoke-admin",
    identifier: "admin",
    firstName: "Smoke",
    lastName: "Admin",
    role: "Admin School",
    schoolCode: SCHOOL.code,
    schoolId: SCHOOL.id,
    mustChangePassword: false,
    permissions: PERMISSIONS,
  },
  scope: { label: SCHOOL.name },
};

const CLASSES = [
  {
    id: "cls-1",
    classCode: "CLS-1",
    publicId: "CLS-1",
    name: "6ème A",
    className: "6ème A",
    levelName: "6ème",
    streamName: "",
    groupCode: "A",
    status: "active",
    students: 2,
    academicYearName: "2025-2026",
    schoolCode: SCHOOL.code,
    schoolId: SCHOOL.id,
  },
];

const STUDENTS = [
  {
    id: "CD-IN-EL-26-00001",
    studentCode: "CD-IN-EL-26-00001",
    publicId: "CD-IN-EL-26-00001",
    firstName: "Amina",
    lastName: "Nuru",
    name: "Amina Nuru",
    className: "6ème A",
    classCode: "CLS-1",
    status: "active",
    academicYearName: "2025-2026",
    schoolId: SCHOOL.id,
    schoolCode: SCHOOL.code,
  },
];

const YEARS = [
  {
    id: "year-1",
    schoolCode: SCHOOL.code,
    schoolId: SCHOOL.id,
    name: "2025-2026",
    startDate: "2025-09-01",
    endDate: "2026-06-30",
    status: "active",
    isCurrent: true,
  },
];

function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) reject(new Error(`timeout waiting for ${url}`));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

function json(data) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(data) };
}

async function mockApis(page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("/api/")) return route.continue();
    const method = route.request().method();
    const p = url.pathname.replace(/\/+$/, "");

    if (p.endsWith("/auth/effective-permissions")) return route.fulfill(json({ permissions: PERMISSIONS }));
    if (p.endsWith("/backoffice/establishments")) return route.fulfill(json([SCHOOL]));
    if (p.includes("/backoffice/establishments/")) return route.fulfill(json(SCHOOL));
    if (p.endsWith("/classes")) return route.fulfill(json(CLASSES));
    if (p.endsWith("/students")) return route.fulfill(json(STUDENTS));
    if (p.endsWith("/v2/academic-years")) return route.fulfill(json(YEARS));
    if (method === "GET") return route.fulfill(json([]));
    return route.fulfill(json({}));
  });
}

async function main() {
  if (!CHROME) {
    console.error("Chrome introuvable — smoke viewport ignoré.");
    process.exit(2);
  }

  const searchRoots = ["/tmp/help-v1b-pw", "/tmp/playwright", ROOT, WEB];
  let playwrightPath = "";
  for (const root of searchRoots) {
    try {
      playwrightPath = require.resolve("playwright-core", { paths: [root] });
      break;
    } catch {
      /* next */
    }
  }
  if (!playwrightPath) {
    console.error("playwright-core introuvable");
    process.exit(2);
  }
  const { chromium } = require(playwrightPath);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const distIndex = path.join(WEB, "dist", "index.html");
  if (!fs.existsSync(distIndex)) {
    console.error("web/dist absent — lancer npm --prefix web run build avant le smoke.");
    process.exit(2);
  }

  const preview = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"], {
    cwd: WEB,
    env: { ...process.env, VITE_API_URL: process.env.VITE_API_URL || "https://api.somafrik.app" },
    stdio: "pipe",
  });
  preview.stdout.on("data", (chunk) => process.stdout.write(chunk));
  preview.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const stopPreview = () => {
    try {
      preview.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  };
  process.on("exit", stopPreview);

  await waitForHttp(BASE, 20000);

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const findings = [];
  const overflows = [];

  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        locale: "fr-FR",
      });
      const page = await context.newPage();
      await mockApis(page);
      await page.addInitScript((session) => {
        sessionStorage.setItem("somafrik.web.session", JSON.stringify(session));
      }, SESSION);

      for (const screen of PAGES) {
        await page.goto(`${BASE}${screen.path}`, { waitUntil: "networkidle", timeout: 30000 });
        await page.getByText(screen.wait, { exact: false }).first().waitFor({ timeout: 15000 });
        const file = path.join(OUT_DIR, `scolarite_l0_${screen.id}_${viewport.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        const metrics = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        const overflow = metrics.scrollWidth > metrics.innerWidth + 8;
        if (overflow) overflows.push({ viewport: viewport.name, page: screen.id, ...metrics });
        findings.push({
          viewport: viewport.name,
          page: screen.id,
          screenshot: file,
          overflow,
          ...metrics,
        });
      }

      await context.close();
    }
  } finally {
    await browser.close();
    stopPreview();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    chrome: CHROME,
    base: BASE,
    viewports: VIEWPORTS.map((item) => item.name),
    pages: PAGES.map((item) => item.id),
    overflows,
    findings,
    result: overflows.length === 0 ? "GO" : "NO-GO",
  };
  const reportPath = path.join(OUT_DIR, "scolarite_l0_viewport_report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`scolarite-l0-viewport-smoke: ${report.result} (${overflows.length} overflow(s))`);
  console.log(reportPath);
  if (overflows.length) {
    console.error(JSON.stringify(overflows, null, 2));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
