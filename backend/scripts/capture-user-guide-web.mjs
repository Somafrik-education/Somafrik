import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

const BASE = process.env.SOMAFRIK_CAPTURE_WEB_URL || "http://127.0.0.1:4173";
const API = process.env.SOMAFRIK_CAPTURE_API_URL || "http://127.0.0.1:5000";
const OUT = path.resolve(process.cwd(), "../capture-output/web");
const PUBLIC_SCHOOL_CODE = "CD-IN-26-001";
const LEGACY_SCHOOL_CODE = "CD-2026-0001";
const IDENTIFIER = "admin";
const PASSWORD = "1234";

await fs.mkdir(OUT, { recursive: true });

async function resolveAcceptedSchoolCode() {
  for (const schoolCode of [PUBLIC_SCHOOL_CODE, LEGACY_SCHOOL_CODE]) {
    const response = await fetch(`${API}/api/backoffice/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolCode, identifier: IDENTIFIER, password: PASSWORD }),
    });
    console.log(`LOGIN_PRECHECK ${schoolCode} -> ${response.status}`);
    if (response.ok) return schoolCode;
    const payload = await response.json().catch(() => null);
    console.log(`LOGIN_PRECHECK_ERROR ${schoolCode}: ${payload?.code || ""} ${payload?.message || ""}`.trim());
  }
  throw new Error("Aucun code établissement de démonstration n'est accepté par /api/backoffice/login.");
}

const LOGIN_SCHOOL_CODE = await resolveAcceptedSchoolCode();

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
  defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") console.error("[browser]", msg.text());
});
page.on("pageerror", (error) => console.error("[pageerror]", error.message));
page.on("response", (response) => {
  if (response.status() >= 400) {
    console.error(`[http] ${response.request().method()} ${response.url()} -> ${response.status()}`);
  }
});

async function settle(ms = 1200) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function screenshot(name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`CAPTURED ${file}`);
}

async function goto(relativePath) {
  await page.goto(`${BASE}${relativePath}`, { waitUntil: "networkidle2", timeout: 60_000 });
  await settle();
}

async function clickText(selector, exactText) {
  const clicked = await page.evaluate(({ selector, exactText }) => {
    const candidates = [...document.querySelectorAll(selector)];
    const target = candidates.find((el) => (el.textContent || "").trim() === exactText);
    if (!target) return false;
    target.click();
    return true;
  }, { selector, exactText });
  if (!clicked) throw new Error(`Élément introuvable: ${selector} / ${exactText}`);
}

async function replaceInput(selector, value) {
  await page.waitForSelector(selector, { timeout: 10_000 });
  await page.click(selector);
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  if (value) await page.type(selector, value, { delay: 15 });
  await page.evaluate((sel) => {
    const input = document.querySelector(sel);
    if (input instanceof HTMLElement) input.blur();
  }, selector);
  await settle(100);
}

async function ensureLoggedIn() {
  await goto("/connexion");
  await page.click('[data-testid="login-profile-school"]');
  await settle(250);

  await replaceInput('[data-testid="login-school-code"]', "");
  await replaceInput('[data-testid="login-identifier"]', "");
  await replaceInput('[data-testid="login-password"]', "");
  await screenshot("01-connexion-etablissement.png");

  await replaceInput('[data-testid="login-school-code"]', LOGIN_SCHOOL_CODE);
  await replaceInput('[data-testid="login-identifier"]', IDENTIFIER);
  await replaceInput('[data-testid="login-password"]', PASSWORD);

  const fieldState = await page.evaluate(() => {
    const read = (selector) => {
      const node = document.querySelector(selector);
      return node instanceof HTMLInputElement ? node.value : "";
    };
    const password = read('[data-testid="login-password"]');
    return {
      schoolCode: read('[data-testid="login-school-code"]'),
      identifier: read('[data-testid="login-identifier"]'),
      passwordLength: password.length,
    };
  });
  console.log(`LOGIN_UI_FIELDS ${JSON.stringify(fieldState)}`);
  if (
    fieldState.schoolCode !== LOGIN_SCHOOL_CODE ||
    fieldState.identifier !== IDENTIFIER ||
    fieldState.passwordLength !== PASSWORD.length
  ) {
    throw new Error(`Valeurs du formulaire login incohérentes: ${JSON.stringify(fieldState)}`);
  }

  await page.click('[data-testid="login-submit"]');
  await settle(1800);

  const dialog = await page.$('[role="dialog"]');
  if (dialog) {
    const title = await page.evaluate((node) => node.textContent || "", dialog);
    if (title.includes("Nouveau mot de passe")) {
      const passwordInputs = await page.$$('[role="dialog"] input[type="password"]');
      if (passwordInputs.length >= 2) {
        await passwordInputs[0].type("Guide1234!");
        await passwordInputs[1].type("Guide1234!");
        await clickText('[role="dialog"] button', "Enregistrer");
        await settle(1500);
      }
    }
  }

  if (new URL(page.url()).pathname === "/connexion") {
    const visibleError = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("p")];
      const node = nodes.find((el) => {
        const text = (el.textContent || "").trim();
        return text.includes("Identifiant") || text.includes("connexion") || text.includes("Accès") || text.includes("autorisé");
      });
      return (node?.textContent || "").trim();
    });
    console.error(`LOGIN_UI_STILL_ON_CONNEXION ${visibleError || "sans message détecté"}`);
    await screenshot("login-failure-diagnostic.png");
    throw new Error("Connexion Web non établie après soumission du formulaire.");
  }
  await settle(1000);
}

try {
  await ensureLoggedIn();

  await goto("/tableau-de-bord");
  await screenshot("02-tableau-de-bord-etablissement.png");

  await goto("/etablissement/classes");
  await page.waitForFunction(() => document.body.innerText.includes("Classes"), { timeout: 30_000 });
  await screenshot("03-classes-liste.png");

  await clickText("button", "Ajouter");
  await page.waitForFunction(() => document.body.innerText.includes("Ajouter une classe"), { timeout: 10_000 });
  await settle(350);
  await screenshot("04-classe-ajout.png");
  await page.keyboard.press("Escape");
  await settle(250);

  await goto("/etablissement/eleves");
  await page.waitForFunction(() => document.body.innerText.includes("Élèves"), { timeout: 30_000 });
  await screenshot("05-eleves-annuaire.png");

  const dossierHref = await page.evaluate(() => {
    const link = [...document.querySelectorAll("a")].find((el) => (el.textContent || "").trim() === "Dossier");
    return link?.getAttribute("href") || null;
  });
  if (!dossierHref) throw new Error("Aucun lien Dossier disponible dans l'annuaire élèves.");
  await goto(dossierHref);
  await screenshot("06-eleve-dossier.png");

  const manifest = {
    baseSha: process.env.GITHUB_SHA || null,
    capturedAt: new Date().toISOString(),
    source: "Somafrik Web runtime + backend development demo-memory, GitHub Actions",
    requestedSchoolCode: PUBLIC_SCHOOL_CODE,
    runtimeLoginSchoolCode: LOGIN_SCHOOL_CODE,
    files: [
      "01-connexion-etablissement.png",
      "02-tableau-de-bord-etablissement.png",
      "03-classes-liste.png",
      "04-classe-ajout.png",
      "05-eleves-annuaire.png",
      "06-eleve-dossier.png",
    ],
  };
  await fs.writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
} finally {
  await browser.close();
}
