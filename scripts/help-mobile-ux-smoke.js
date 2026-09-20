"use strict";

/**
 * Recette runtime Aide Mobile — vrais composants RN (HelpHost / HelpSheet / drawer).
 * Expo web + Chrome/playwright-core. Hors graphe de production.
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const MOBILE = path.join(ROOT, "Mobile");
const ARTIFACTS = "/opt/cursor/artifacts";
const PORT = Number(process.env.HELP_MOBILE_UX_SMOKE_PORT || 8091);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/local/bin/google-chrome"].find((candidate) =>
    fs.existsSync(candidate),
  );

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
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

function ensurePlaywright() {
  try {
    return require.resolve("playwright-core", { paths: [path.join("/tmp/help-mobile-pw"), ROOT] });
  } catch {
    const install = spawnSync("npm", ["install", "--prefix", "/tmp/help-mobile-pw", "--no-save", "playwright-core@1.55.0"], {
      encoding: "utf8",
      stdio: "inherit",
    });
    if (install.status !== 0) throw new Error("playwright-core install failed");
    return require.resolve("playwright-core", { paths: [path.join("/tmp/help-mobile-pw")] });
  }
}

async function main() {
  if (!CHROME) {
    console.error("Chrome introuvable — recette Aide mobile bloquée.");
    process.exit(2);
  }

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { chromium } = require(ensurePlaywright());

  const expo = spawn(
    "npx",
    ["expo", "start", "--web", "--port", String(PORT), "--non-interactive"],
    {
      cwd: MOBILE,
      env: {
        ...process.env,
        CI: "1",
        BROWSER: "none",
        EXPO_NO_TELEMETRY: "1",
        SOMAFRIK_HELP_UX_SMOKE_ENTRY: "1",
      },
      stdio: "pipe",
    },
  );
  expo.stdout.on("data", (chunk) => process.stdout.write(chunk));
  expo.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const stopExpo = () => {
    try {
      expo.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  };
  process.on("exit", stopExpo);

  await waitForHttp(BASE, 180000);

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const shots = [];

  try {
    async function openPage(width) {
      const context = await browser.newContext({
        viewport: { width, height: 800 },
        locale: "fr-FR",
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByTestId("mobile-help-button").waitFor({ state: "visible", timeout: 120000 });
      return { context, page };
    }

    const shot360 = await openPage(360);
    await shot360.page.screenshot({
      path: path.join(ARTIFACTS, "help_runtime_360_button_visible.png"),
      fullPage: false,
    });
    shots.push("help_runtime_360_button_visible.png");

    await shot360.page.getByTestId("mobile-help-button").click();
    await shot360.page.getByTestId("help-search").waitFor({ state: "visible", timeout: 15000 });
    await shot360.page.screenshot({
      path: path.join(ARTIFACTS, "help_runtime_sheet_open.png"),
      fullPage: false,
    });
    shots.push("help_runtime_sheet_open.png");
    await shot360.page.getByLabel("Fermer l’aide").click();
    await shot360.page.getByTestId("mobile-help-button").waitFor({ state: "visible", timeout: 10000 });

    await shot360.page.getByTestId("mobile-header-menu").click();
    await shot360.page.getByTestId("mobile-role-drawer-help-hide").waitFor({ state: "visible", timeout: 10000 });
    await shot360.page.getByTestId("mobile-role-drawer-help-hide").click();
    await shot360.page.getByTestId("mobile-help-button").waitFor({ state: "hidden", timeout: 10000 });
    await shot360.page.screenshot({
      path: path.join(ARTIFACTS, "help_runtime_button_hidden.png"),
      fullPage: false,
    });
    shots.push("help_runtime_button_hidden.png");

    await shot360.page.getByTestId("mobile-header-menu").click();
    await shot360.page.getByTestId("mobile-role-drawer-help-show").waitFor({ state: "visible", timeout: 10000 });
    await shot360.page.getByTestId("mobile-role-drawer-help").waitFor({ state: "visible", timeout: 5000 });
    await shot360.page.screenshot({
      path: path.join(ARTIFACTS, "help_runtime_menu_show_trigger.png"),
      fullPage: false,
    });
    shots.push("help_runtime_menu_show_trigger.png");

    await shot360.page.getByTestId("mobile-role-drawer-help-show").click();
    await shot360.page.getByTestId("mobile-help-button").waitFor({ state: "visible", timeout: 10000 });
    await shot360.page.screenshot({
      path: path.join(ARTIFACTS, "help_runtime_button_restored.png"),
      fullPage: false,
    });
    shots.push("help_runtime_button_restored.png");
    await shot360.context.close();

    const shot390 = await openPage(390);
    await shot390.page.screenshot({
      path: path.join(ARTIFACTS, "help_runtime_390_button_visible.png"),
      fullPage: false,
    });
    shots.push("help_runtime_390_button_visible.png");
    await shot390.context.close();
  } finally {
    await browser.close();
    stopExpo();
  }

  const report = {
    result: "GO",
    runtime: "expo-web + HelpHost/HelpSheet/RoleNavigationDrawer de production",
    shots,
  };
  fs.writeFileSync(path.join(ARTIFACTS, "help_runtime_report.json"), JSON.stringify(report, null, 2));
  console.log(`help-mobile-ux-smoke: GO (${shots.length} captures)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
