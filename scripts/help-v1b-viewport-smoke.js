"use strict";

/**
 * HELP-V1B — smoke visuel navigateur (viewports 1440 / 1024 / 390 / 360).
 * Utilise Chrome système + playwright-core. Pas d’API réelle : interception locale.
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const OUT_DIR = path.join(ROOT, "web/src/help/viewport-smoke");
const ARTIFACTS = "/opt/cursor/artifacts";
const PREVIEW_PORT = Number(process.env.HELP_V1B_PREVIEW_PORT || 4173);
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
  { id: "dashboard", path: "/tableau-de-bord", ctaName: null },
  { id: "classes", path: "/etablissement/classes", ctaName: "Ajouter" },
  { id: "profil", path: "/parametres/profil", ctaName: "Enregistrer" },
];

const SCHOOL = {
  code: "CD-IN-26-001",
  name: "Lycée Smoke HELP-V1B",
  type: "Lycée",
  address: "1 avenue Test",
  phone: "+243810000000",
  email: "contact@smoke.cd",
  city: "Kinshasa",
  country: "RDC",
  countryCode: "CD",
  logoUrl: "",
  principalName: "Directeur Smoke",
  principalEmail: "dir@smoke.cd",
  principalPhone: "+243810000001",
  status: "active",
};

const PERMISSIONS = [
  "Classes:READ",
  "Classes:CREATE",
  "Élèves:READ",
  "Utilisateurs:READ",
  "Utilisateurs:CREATE",
  "Notes:READ",
  "Paiements:READ",
  "Présences:READ",
  "Paramètres Établissement:READ",
  "Paramètres Établissement:UPDATE",
  "Messages:READ",
  "Notifications:READ",
  "Announcements:READ",
];

const SESSION = {
  accessToken: "help-v1b-viewport-smoke",
  permissions: PERMISSIONS,
  user: {
    id: "smoke-admin",
    identifier: "admin",
    firstName: "Smoke",
    lastName: "Admin",
    role: "Admin School",
    schoolCode: SCHOOL.code,
    mustChangePassword: false,
    permissions: PERMISSIONS,
  },
  scope: { label: SCHOOL.name },
};

function toRect(box) {
  return {
    left: box.x,
    top: box.y,
    right: box.x + box.width,
    bottom: box.y + box.height,
  };
}

function boxesOverlap(a, b, padding = 4) {
  if (!a || !b) return false;
  const left = toRect(a);
  const right = toRect(b);
  return !(
    left.right + padding < right.left ||
    left.left - padding > right.right ||
    left.bottom + padding < right.top ||
    left.top - padding > right.bottom
  );
}

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
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.includes("/api/")) return route.continue();

    const method = request.method();
    const p = url.pathname.replace(/\/+$/, "");

    if (p.endsWith("/auth/effective-permissions")) return route.fulfill(json({ permissions: PERMISSIONS }));
    if (p.endsWith("/backoffice/establishments")) return route.fulfill(json([SCHOOL]));
    if (p.endsWith("/classes")) return route.fulfill(json([]));
    if (p.endsWith("/v2/academic-years")) {
      return route.fulfill(
        json([
          {
            id: "year-1",
            schoolCode: SCHOOL.code,
            name: "2025-2026",
            startDate: "2025-09-01",
            endDate: "2026-06-30",
            status: "active",
            isCurrent: true,
          },
        ]),
      );
    }
    if (method === "GET") return route.fulfill(json([]));
    return route.fulfill(json({}));
  });
}

async function box(locator) {
  const count = await locator.count();
  if (count === 0) return null;
  const handle = locator.first();
  if (!(await handle.isVisible())) return null;
  return handle.boundingBox();
}

async function main() {
  if (!CHROME) {
    console.error("Chrome introuvable — smoke viewport ignoré.");
    process.exit(2);
  }

  const playwrightPath = require.resolve("playwright-core", {
    paths: [path.join("/tmp/help-v1b-pw"), ROOT, WEB],
  });
  const { chromium } = require(playwrightPath);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACTS, { recursive: true });

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
  const collisions = [];

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
        const help = page.getByRole("button", { name: /Ouvrir l.aide/i });
        await help.waitFor({ state: "visible", timeout: 15000 });

        const helpBox = await box(help);
        const topbar = await box(page.locator("header").first());
        const cta = screen.ctaName
          ? await box(page.getByRole("button", { name: screen.ctaName }))
          : null;
        const menu = await box(page.getByRole("button", { name: "Ouvrir le menu" }));

        const overlapCta = boxesOverlap(helpBox, cta);
        const overlapTopbar = boxesOverlap(helpBox, topbar);
        const overlapMenu = boxesOverlap(helpBox, menu);
        if (overlapCta || overlapTopbar || overlapMenu) {
          collisions.push({
            viewport: viewport.name,
            page: screen.id,
            overlapCta,
            overlapTopbar,
            overlapMenu,
            helpBox,
            cta,
            topbar,
            menu,
          });
        }

        const closedPath = path.join(OUT_DIR, `${screen.id}_${viewport.name}_closed.png`);
        await page.screenshot({ path: closedPath, fullPage: false });

        await help.click();
        const dialog = page.getByRole("dialog", { name: /Besoin d.aide/i });
        await dialog.waitFor({ state: "visible", timeout: 5000 });
        const dialogBox = await dialog.boundingBox();
        const openPath = path.join(OUT_DIR, `${screen.id}_${viewport.name}_open.png`);
        await page.screenshot({ path: openPath, fullPage: false });

        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden", timeout: 5000 });

        findings.push({
          viewport: viewport.name,
          page: screen.id,
          path: screen.path,
          helpVisible: Boolean(helpBox),
          helpBox,
          ctaBox: cta,
          topbarBox: topbar,
          menuBox: menu,
          panelBox: dialogBox,
          overlapCta,
          overlapTopbar,
          overlapMenu,
          panelFullWidthSmall:
            viewport.width <= 390 ? Boolean(dialogBox && Math.abs(dialogBox.width - viewport.width) <= 2) : null,
          screenshots: { closed: closedPath, open: openPath },
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
    collisions,
    findings,
    result: collisions.length === 0 ? "GO" : "NO-GO",
  };

  const reportPath = path.join(OUT_DIR, "report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const copies = [
    "dashboard_1440_closed.png",
    "dashboard_1440_open.png",
    "classes_1024_closed.png",
    "classes_390_closed.png",
    "classes_390_open.png",
    "profil_360_closed.png",
    "profil_360_open.png",
  ];
  for (const file of copies) {
    const from = path.join(OUT_DIR, file);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(ARTIFACTS, `help_v1b_${file}`));
    }
  }
  fs.copyFileSync(reportPath, path.join(ARTIFACTS, "help_v1b_viewport_report.json"));

  console.log(`help-v1b-viewport-smoke: ${report.result} (${collisions.length} collision(s))`);
  console.log(reportPath);
  if (collisions.length) {
    console.error(JSON.stringify(collisions, null, 2));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
