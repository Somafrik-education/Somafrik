"use strict";

/**
 * Recette runtime wizard guidé Mobile — vrais composants RN.
 * Expo web + Chrome/playwright-core. Hors graphe de production.
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const MOBILE = path.join(ROOT, "Mobile");
const ARTIFACTS = "/opt/cursor/artifacts";
const PORT = Number(process.env.GUIDED_SETUP_MOBILE_UX_SMOKE_PORT || 8092);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/local/bin/google-chrome"].find((candidate) =>
    fs.existsSync(candidate),
  );

function freePort(port) {
  spawnSync("bash", ["-lc", `fuser -k ${port}/tcp >/dev/null 2>&1 || true`], { stdio: "ignore" });
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

async function dumpFailure(page, name) {
  const dir = "/tmp/guided-setup-mobile-ux-smoke";
  fs.mkdirSync(dir, { recursive: true });
  try {
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
    fs.writeFileSync(path.join(dir, `${name}.html`), await page.content());
  } catch {
    /* page already closed */
  }
}

async function main() {
  if (!CHROME) {
    console.error("Chrome introuvable — recette wizard guidé mobile bloquée.");
    process.exit(2);
  }

  freePort(PORT);
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.mkdirSync(path.join(ARTIFACTS, "screenshots"), { recursive: true });
  const { chromium } = require(ensurePlaywright());

  const expo = spawn("npx", ["expo", "start", "--web", "--port", String(PORT), "--non-interactive", "--clear"], {
    cwd: MOBILE,
    env: {
      ...process.env,
      CI: "1",
      BROWSER: "none",
      EXPO_NO_TELEMETRY: "1",
      SOMAFRIK_GUIDED_SETUP_UX_SMOKE_ENTRY: "1",
    },
    stdio: "pipe",
  });
  let bundled = false;
  const markBundled = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(chunk);
    if (/Web Bundled|Finished|Bundled \d/i.test(text)) bundled = true;
  };
  expo.stdout.on("data", markBundled);
  expo.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    markBundled(chunk);
  });
  const stopExpo = () => {
    try {
      expo.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    freePort(PORT);
  };
  process.on("exit", stopExpo);

  await waitForHttp(BASE, 180000);
  const waitStart = Date.now();
  while (!bundled && Date.now() - waitStart < 20000) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const shots = [];
  const shot = async (page, name) => {
    const file = `${name}.png`;
    await page.screenshot({ path: path.join(ARTIFACTS, file), fullPage: false });
    shots.push(file);
  };

  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "fr-FR",
      isMobile: true,
      hasTouch: true,
      recordVideo: {
        dir: "/tmp/guided-setup-mobile-ux-smoke",
        size: { width: 390, height: 844 },
      },
    });
    const page = await context.newPage();
    const video = page.video();

    const deadline = Date.now() + 180000;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.getByTestId("guided-setup-smoke").waitFor({ state: "visible", timeout: 20000 });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await dumpFailure(page, "waiting-smoke");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    if (lastError) throw lastError;

    await page.getByText("Configuration de votre établissement").waitFor({ state: "visible", timeout: 30000 });
    await page.getByText("Étape 1 sur 10").waitFor({ state: "visible" });
    await page.getByTestId("guided-setup-status").getByText(/percent=0/).waitFor();
    const oldWizard = await page.getByText("Ces actions ouvrent les écrans existants").count();
    if (oldWizard !== 0) throw new Error("ancien SchoolSetupWizard visible — empilement interdit");
    await shot(page, "mobile_guided_runtime_0_percent");

    await page.getByText("Ouvrir l'écran existant").scrollIntoViewIfNeeded();
    await page.getByLabel("Enregistrer et continuer").scrollIntoViewIfNeeded();
    await page.getByLabel("Enregistrer et continuer").click();
    await page.getByText("Étape 2 sur 10").waitFor({ state: "visible", timeout: 15000 });
    await page.getByText("Configuration 10 % terminée").waitFor();
    await shot(page, "mobile_guided_runtime_10_percent");

    await page.getByLabel("Précédent").click();
    await page.getByText("Étape 1 sur 10").waitFor({ state: "visible", timeout: 15000 });
    await page.getByLabel("Enregistrer et continuer").waitFor({ state: "visible" });

    await page.getByTestId("guided-setup-resume-40").click();
    await page.getByText("Étape 5 sur 10").waitFor({ state: "visible" });
    await page.getByText("Enseignants").first().waitFor();
    await page.getByTestId("guided-setup-status").getByText(/configuration_required/).waitFor();
    await shot(page, "mobile_guided_runtime_40_percent");

    await page.getByTestId("guided-setup-resume-50").click();
    await page.getByText("Étape 6 sur 10").waitFor({ state: "visible" });
    await page.getByText("Élèves").first().waitFor();
    await shot(page, "mobile_guided_runtime_50_percent");

    await page.getByTestId("guided-setup-resume-60").click();
    await page.getByText("Étape 7 sur 10").waitFor({ state: "visible" });
    await page.getByTestId("guided-setup-status").getByText(/statut=operational/).waitFor();
    await shot(page, "mobile_guided_runtime_60_percent_operational");

    await page.getByTestId("guided-setup-resume-100").click();
    await page.getByText("Étape 10 sur 10").waitFor({ state: "visible" });
    await page.getByLabel("Vérifier la configuration").scrollIntoViewIfNeeded();
    await page.getByLabel("Vérifier la configuration").waitFor({ state: "visible" });
    await page.getByLabel("Terminer la configuration").waitFor({ state: "visible" });
    await shot(page, "mobile_guided_runtime_100_percent");

    await page.getByLabel("Vérifier la configuration").click();
    await page.getByText("Étape 1 sur 10").waitFor({ state: "visible" });
    await page.getByLabel("Terminer la configuration").waitFor({ state: "visible" });
    await shot(page, "mobile_guided_runtime_verify_then_finish");

    await page.getByLabel("Terminer la configuration").click();
    await page.getByTestId("guided-setup-home").waitFor({ state: "visible", timeout: 15000 });
    await page.getByTestId("guided-setup-home").getByText("Accueil").waitFor();
    await shot(page, "mobile_guided_runtime_home_after_terminer");

    await context.close();
    if (video) {
      const videoPath = await video.path();
      if (videoPath && fs.existsSync(videoPath)) {
        const dest = path.join(ARTIFACTS, "mobile_guided_wizard_expo_web_runtime.webm");
        fs.copyFileSync(videoPath, dest);
        shots.push("mobile_guided_wizard_expo_web_runtime.webm");
      }
    }
  } finally {
    await browser.close();
    stopExpo();
  }

  const report = {
    result: "GO",
    runtime: "expo-web + GuidedSchoolSetupWizard de production",
    viewport: "390x844",
    shots,
  };
  fs.writeFileSync(path.join(ARTIFACTS, "guided_mobile_runtime_report.json"), JSON.stringify(report, null, 2));
  console.log(`guided-setup-mobile-ux-smoke: GO (${shots.length} captures)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
