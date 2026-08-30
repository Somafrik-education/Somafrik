"use strict";

/**
 * HELP-V1C — smoke visuel Mobile (360 / 390 / iPhone 390×844).
 * HTML de géométrie identique au host (tabs, CTA, FAB, clavier). Chrome + playwright-core.
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "Mobile/src/help/viewport-smoke");
const ARTIFACTS = "/opt/cursor/artifacts";
const PORT = Number(process.env.HELP_V1C_PREVIEW_PORT || 4183);

const TRIGGER_SIZE = 44;
const CTA_RESERVE = 72;
const TAB_HEIGHT = 60;
const SIDE = 16;

const VIEWPORTS = [
  { name: "360", width: 360, height: 800, label: "Android 360" },
  { name: "390", width: 390, height: 844, label: "Android 390 / iPhone" },
  { name: "iphone", width: 390, height: 844, label: "iPhone représentatif" },
];

const SCREENS = [
  { id: "dashboard", title: "Accueil", cta: null, tabs: true, keyboard: false },
  { id: "classes", title: "Classes", cta: "Créer une classe", tabs: true, keyboard: false },
  { id: "profil", title: "Profil établissement", cta: "Enregistrer", tabs: false, keyboard: false },
  { id: "annee", title: "Année scolaire", cta: null, tabs: false, keyboard: false },
  { id: "structure", title: "Structure pédagogique", cta: "Enregistrer l’activation", tabs: false, keyboard: false },
  { id: "keyboard", title: "Classes", cta: "Créer une classe", tabs: true, keyboard: true },
];

function htmlPage(screen, viewport) {
  const tabH = screen.tabs ? TAB_HEIGHT : 0;
  const safeBottom = screen.tabs ? 0 : 16;
  const fabBottom = (screen.tabs ? tabH : safeBottom) + CTA_RESERVE;
  const showFab = !screen.keyboard;
  const sheetH = viewport.height < 700 ? viewport.height - 12 : Math.round(viewport.height * 0.85);
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=${viewport.width}, initial-scale=1"/>
<title>HELP-V1C ${screen.id} ${viewport.name}</title>
<style>
  html,body{margin:0;height:100%;font-family:system-ui,sans-serif;background:#F4F7FB;color:#0F172A}
  .screen{position:relative;width:${viewport.width}px;height:${viewport.height}px;overflow:hidden;background:#F4F7FB}
  header{height:56px;background:#fff;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;padding:0 16px;font-weight:800}
  main{padding:16px;height:${viewport.height - 56 - tabH}px}
  .cta{min-height:48px;background:#2563EB;color:#fff;border:0;border-radius:16px;font-weight:800;padding:0 16px}
  .tabs{position:absolute;left:0;right:0;bottom:0;height:${tabH}px;background:#fff;border-top:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-around;font-size:11px;font-weight:700;color:#64748B}
  .fab{position:absolute;right:${SIDE}px;bottom:${fabBottom}px;min-width:${TRIGGER_SIZE}px;min-height:${TRIGGER_SIZE}px;border-radius:999px;background:#2563EB;color:#fff;border:0;font-weight:800;padding:0 12px}
  .kb{position:absolute;left:0;right:0;bottom:0;height:260px;background:#CBD5E1;display:flex;align-items:center;justify-content:center;color:#334155;font-weight:700}
  .sheet{position:absolute;left:0;right:0;bottom:0;height:${sheetH}px;background:#fff;border-top-left-radius:20px;border-top-right-radius:20px;box-shadow:0 -8px 24px rgba(15,23,42,.18);padding:16px}
  .sheet h1{margin:0 0 12px;font-size:18px}
  .card{border:1px solid #E2E8F0;border-radius:12px;padding:12px;margin-top:8px}
</style></head>
<body>
<div class="screen" id="stage">
  <header>${screen.title}</header>
  <main>
    <p>Suggestions HELP contextuelles (max 3). Recherche locale, hors ligne.</p>
    ${screen.cta ? `<button class="cta" id="cta">${screen.cta}</button>` : ""}
  </main>
  ${screen.tabs ? `<nav class="tabs" id="tabs"><span>Accueil</span><span>Élèves</span><span>Appel</span><span>Frais</span><span>Classes</span></nav>` : ""}
  ${showFab ? `<button class="fab" id="help" aria-label="Ouvrir l’aide">? Besoin d’aide</button>` : ""}
  ${screen.keyboard ? `<div class="kb" id="keyboard">Clavier</div>` : ""}
  <div class="sheet" id="sheet" hidden>
    <h1>Besoin d’aide</h1>
    <input id="search" placeholder="Rechercher dans l’aide" style="width:100%;min-height:44px;border:1px solid #E2E8F0;border-radius:12px;padding:8px 12px"/>
    <div class="card"><strong>Consulter les classes</strong><div>Liste des classes de l’établissement.</div></div>
  </div>
</div>
<script>
  const help = document.getElementById("help");
  const sheet = document.getElementById("sheet");
  if (help) help.addEventListener("click", () => { sheet.hidden = false; help.hidden = true; });
</script>
</body></html>`;
}

function boxesOverlap(a, b, padding = 4) {
  if (!a || !b) return false;
  return !(
    a.x + a.width + padding < b.x ||
    a.x - padding > b.x + b.width ||
    a.y + a.height + padding < b.y ||
    a.y - padding > b.y + b.height
  );
}

async function box(locator) {
  const count = await locator.count();
  if (!count) return null;
  const handle = locator.first();
  if (!(await handle.isVisible())) return null;
  return handle.boundingBox();
}

async function main() {
  const CHROME =
    process.env.CHROME_PATH ||
    ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/local/bin/google-chrome"].find((candidate) =>
      fs.existsSync(candidate),
    );
  if (!CHROME) {
    console.error("Chrome introuvable — smoke viewport ignoré.");
    process.exit(2);
  }

  let playwrightPath;
  try {
    playwrightPath = require.resolve("playwright-core", {
      paths: [path.join("/tmp/help-v1c-pw"), ROOT, path.join(ROOT, "web")],
    });
  } catch {
    const { spawnSync } = require("node:child_process");
    const install = spawnSync("npm", ["install", "--prefix", "/tmp/help-v1c-pw", "playwright-core@1.55.0"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (install.status !== 0) {
      console.error(install.stdout, install.stderr);
      process.exit(1);
    }
    playwrightPath = require.resolve("playwright-core", { paths: ["/tmp/help-v1c-pw"] });
  }
  const { chromium } = require(playwrightPath);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACTS, { recursive: true });

  const pages = new Map();
  for (const viewport of VIEWPORTS) {
    for (const screen of SCREENS) {
      pages.set(`/${viewport.name}/${screen.id}`, htmlPage(screen, viewport));
    }
  }

  const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    const body = pages.get(url);
    if (!body) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const collisions = [];
  const findings = [];

  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        locale: "fr-FR",
      });
      const page = await context.newPage();
      for (const screen of SCREENS) {
        await page.goto(`http://127.0.0.1:${PORT}/${viewport.name}/${screen.id}`, { waitUntil: "domcontentloaded" });
        const help = page.locator("#help");
        const cta = page.locator("#cta");
        const tabs = page.locator("#tabs");
        const keyboard = page.locator("#keyboard");
        const helpBox = await box(help);
        const ctaBox = await box(cta);
        const tabsBox = await box(tabs);
        const keyboardBox = await box(keyboard);
        const overlapCta = boxesOverlap(helpBox, ctaBox);
        const overlapTabs = boxesOverlap(helpBox, tabsBox);
        const overlapKeyboard = boxesOverlap(helpBox, keyboardBox);
        if (overlapCta || overlapTabs || overlapKeyboard) {
          collisions.push({
            viewport: viewport.name,
            page: screen.id,
            overlapCta,
            overlapTabs,
            overlapKeyboard,
            helpBox,
            ctaBox,
            tabsBox,
            keyboardBox,
          });
        }

        const closedPath = path.join(OUT_DIR, `${screen.id}_${viewport.name}_closed.png`);
        await page.screenshot({ path: closedPath, fullPage: false });

        let panelBox = null;
        if (!screen.keyboard) {
          await help.click();
          const sheet = page.locator("#sheet");
          await sheet.waitFor({ state: "visible" });
          panelBox = await sheet.boundingBox();
          const openPath = path.join(OUT_DIR, `${screen.id}_${viewport.name}_open.png`);
          await page.screenshot({ path: openPath, fullPage: false });
        }

        findings.push({
          viewport: viewport.name,
          page: screen.id,
          helpVisible: Boolean(helpBox),
          helpHiddenForKeyboard: screen.keyboard,
          overlapCta,
          overlapTabs,
          overlapKeyboard,
          panelBox,
        });
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    chrome: CHROME,
    viewports: VIEWPORTS.map((item) => item.name),
    pages: SCREENS.map((item) => item.id),
    collisions,
    findings,
    result: collisions.length === 0 ? "GO" : "NO-GO",
  };
  const reportPath = path.join(OUT_DIR, "report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const copies = [
    "dashboard_360_closed.png",
    "dashboard_360_open.png",
    "classes_390_closed.png",
    "classes_390_open.png",
    "profil_iphone_closed.png",
    "profil_iphone_open.png",
    "keyboard_360_closed.png",
  ];
  for (const file of copies) {
    const from = path.join(OUT_DIR, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(ARTIFACTS, `help_v1c_${file}`));
  }
  fs.copyFileSync(reportPath, path.join(ARTIFACTS, "help_v1c_viewport_report.json"));

  console.log(`help-v1c-viewport-smoke: ${report.result} (${collisions.length} collision(s))`);
  if (collisions.length) {
    console.error(JSON.stringify(collisions, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
