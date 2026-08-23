import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

const BASE = process.env.SOMAFRIK_CAPTURE_WEB_URL || "http://127.0.0.1:4173";
const OUT = path.resolve(process.cwd(), "../capture-output/web");
const SCHOOL_CODE = "CD-IN-26-001";
const IDENTIFIER = "admin";
const PASSWORD = "1234";

await fs.mkdir(OUT, { recursive: true });

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

async function ensureLoggedIn() {
  await goto("/connexion");
  await page.click('[data-testid="login-profile-school"]');
  await settle(250);

  const school = await page.$('[data-testid="login-school-code"]');
  if (!school) throw new Error("Champ code établissement introuvable.");
  await school.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await screenshot("01-connexion-etablissement.png");

  await page.type('[data-testid="login-school-code"]', SCHOOL_CODE);
  await page.type('[data-testid="login-identifier"]', IDENTIFIER);
  await page.type('[data-testid="login-password"]', PASSWORD);

  await Promise.all([
    page.click('[data-testid="login-submit"]'),
    settle(900),
  ]);

  // Certains seeds peuvent imposer le renouvellement du secret temporaire.
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
    await page.waitForFunction(() => window.location.pathname !== "/connexion", { timeout: 30_000 });
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
    source: "runtime GitHub Actions",
    schoolCode: SCHOOL_CODE,
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
