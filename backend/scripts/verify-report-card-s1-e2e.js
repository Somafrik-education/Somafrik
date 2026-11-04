"use strict";

/**
 * E2E Playwright réel — Bulletins S1 / #659, refondu pour BULLETIN-CATALOG-01.
 *
 * Superadmin : catalogue des bulletins → disponibilité du modèle pour un pays
 * (confirmation explicite + historique). Établissement du pays : CTA
 * « Configurer un bulletin » → galerie des modèles autorisés → assistant →
 * aperçu réel → enregistrement → activation confirmée. RBAC fail-closed
 * (secrétaire en lecture), établissement d'un autre pays sans modèle,
 * isolation entre établissements, Superadmin sans accès au parcours école.
 *
 * La migration du catalogue est appliquée EXPLICITEMENT à la base isolée de
 * ce test (elle n'est jamais exécutée au démarrage du serveur).
 * Captures : SOMAFRIK_E2E_SCREENSHOTS=<dossier> (bureau 1440×900, tablette 820×1180).
 *
 * Aucun mock du workflow métier. PostgreSQL isolé. Interdit : waitForTimeout numérique Playwright.
 */

const { superadminLoginPassword } = require("../lib/superadminSeedSecret");
const assert = require("node:assert/strict");
const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Pool } = require("pg");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { REPORT_CARD_CATALOG_SQL } = require("../db/reportCardCatalogSchema");
const { hashSecret } = require("../services/credentialService");

const ROOT = path.resolve(__dirname, "../..");
const API_PORT = 19891;
const WEB_PORT = 5191;
const PG_HTTP_DATABASE = String(process.env.SOMAFRIK_REPORT_CARD_S1_E2E_DATABASE ?? "somafrik_report_card_s1_e2e")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const SCHOOL_A_CODE = "CD-2026-0001";
const SCHOOL_B_CODE = "BI-2026-0001";
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const NEW_PASSWORD = "ReportCard#2026Aa";
const ACADEMIC_YEAR_NAME = "2026-2027";
const EVIDENCE_DIR = path.join(os.tmpdir(), "somafrik-report-card-s1-e2e");
const SCREENSHOT_DIR = String(process.env.SOMAFRIK_E2E_SCREENSHOTS ?? "").trim();
const TABLET = { width: 820, height: 1180 };
// Exécution locale : navigateur préinstallé (CI : navigateur Playwright standard).
const LAUNCH = process.env.SOMAFRIK_CHROMIUM_PATH ? { headless: true, executablePath: process.env.SOMAFRIK_CHROMIUM_PATH } : { headless: true };
const DESKTOP = { width: 1440, height: 900 };

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiBase() {
  return `http://127.0.0.1:${API_PORT}/api`;
}

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${apiBase()}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

function spawnBackend(databaseUrl, storageDir) {
  return spawn("node", ["backend/server.js"], {
    cwd: ROOT,
    detached: true,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "development",
      PORT: String(API_PORT),
      SOMAFRIK_DB_REQUIRED: "true",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
      SOMAFRIK_REPORT_CARD_SOURCE_STORAGE: storageDir,
      DATABASE_URL: databaseUrl,
      JWT_SECRET: process.env.JWT_SECRET || "verify-report-card-s1-e2e-secret-32ch",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function spawnWeb() {
  return spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], {
    cwd: path.join(ROOT, "web"),
    detached: true,
    env: {
      ...process.env,
      VITE_API_URL: `http://127.0.0.1:${API_PORT}`,
      BROWSER: "none",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function killProcessTree(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

async function waitForUrl(url, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 302 || response.status === 404) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error(`${label} timeout (${url})`);
}

async function prepareDatabase(databaseUrl) {
  const isolatedUrl = await ensureIsolatedDatabase(databaseUrl, PG_HTTP_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const passwordHash = hashSecret("1234");
  const superadminPasswordHash = hashSecret(superadminLoginPassword());
  let schoolAId = "";
  let schoolBId = "";
  let countryCdId = "";
  const classIds = {};
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8"));
    await pool.query(PEDAGOGY_SCHEMA_SQL);
    await pool.query(fs.readFileSync(path.join(ROOT, "backend/db/migrations/20261103_subject_hierarchy.sql"), "utf8"));
    // Migration du catalogue : appliquée explicitement pour ce test (jamais au démarrage).
    await pool.query(REPORT_CARD_CATALOG_SQL);
    const countryCd = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('République démocratique du Congo', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const countryBi = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id`,
    );
    countryCdId = countryCd.rows[0].id;
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status, profile_payload)
       VALUES ($1, $2, $3, 'Lycée Kinshasa E2E', 'active', '{"timezone":"Africa/Kinshasa"}'::jsonb) RETURNING id`,
      [countryCdId, SCHOOL_A_CODE, SCHOOL_A_CODE],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status, profile_payload)
       VALUES ($1, $2, $3, 'Lycée Bujumbura E2E', 'active', '{"timezone":"Africa/Bujumbura"}'::jsonb) RETURNING id`,
      [countryBi.rows[0].id, SCHOOL_B_CODE, SCHOOL_B_CODE],
    );
    schoolAId = schoolA.rows[0].id;
    schoolBId = schoolB.rows[0].id;
    for (const schoolId of [schoolAId, schoolBId]) {
      const year = await pool.query(
        `INSERT INTO academic_years (school_id, name, status, is_current, start_date, end_date)
         VALUES ($1, $2, 'open', TRUE, '2026-09-01', '2027-07-31') RETURNING id`,
        [schoolId, ACADEMIC_YEAR_NAME],
      );
      for (const [index, name] of ["Trimestre 1", "Trimestre 2", "Trimestre 3"].entries()) {
        await pool.query(
          `INSERT INTO terms (academic_year_id, name, start_date) VALUES ($1, $2, $3)`,
          [year.rows[0].id, name, `2026-${9 + index}-01`],
        );
      }
      for (const [order, [code, name]] of [
        ["MATHEMATIQUES", "Mathématiques"],
        ["FRANCAIS", "Français"],
        ["SCIENCES", "Sciences"],
        ["CIVISME", "Éducation civique"],
      ].entries()) {
        await pool.query(
          `INSERT INTO subjects (school_id, subject_code, name, status, display_order) VALUES ($1, $2, $3, 'active', $4)`,
          [schoolId, code, name, order + 1],
        );
      }
      for (const [order, [code, name]] of [["interrogation", "Interrogation"], ["examen", "Examen"]].entries()) {
        await pool.query(
          `INSERT INTO evaluation_types (school_id, code, name, display_order) VALUES ($1, $2, $3, $4)`,
          [schoolId, code, name, order + 1],
        );
      }
      if (schoolId !== schoolAId) continue;
      // Deux classes aux matières différentes : la configuration ne propose que les matières enseignées.
      const teacher = await pool.query(`INSERT INTO teachers (school_id, teacher_code) VALUES ($1, 'E2E-T1') RETURNING id`, [schoolId]);
      for (const [key, name, codes] of [
        ["A", "6e A", ["MATHEMATIQUES", "FRANCAIS", "CIVISME"]],
        ["B", "6e B", ["MATHEMATIQUES", "SCIENCES"]],
      ]) {
        const cls = await pool.query(
          `INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1, $2, $3, $4) RETURNING id`,
          [schoolId, year.rows[0].id, `E2E-6${key}`, name],
        );
        classIds[key] = cls.rows[0].id;
        for (const code of codes) {
          await pool.query(
            `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code)
             SELECT $1, $2, id, $3, $4 FROM subjects WHERE school_id = $1 AND subject_code = $5`,
            [schoolId, cls.rows[0].id, teacher.rows[0].id, `E2E-6${key}-${code}`, code],
          );
        }
      }
    }
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status, must_change_password)
       VALUES (NULL, 'USR-2026-000002', 'Super', 'Admin', 'superadmin-e2e@test.cd', $1, $1, 'SUPER_ADMIN', 'active', FALSE)`,
      [superadminPasswordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status, must_change_password)
       VALUES ($1, 'ADMIN-CD-2026-0001-01', 'Admin', 'SchoolA', 'admin-a@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active', FALSE)`,
      [schoolAId, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status, must_change_password)
       VALUES ($1, 'SECRETAIRE-CD-2026-0001-01', 'Amina', 'Secretaire', 'secretaire-a@test.cd', $2, $2, 'SECRETARY', 'active', FALSE)`,
      [schoolAId, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status, must_change_password)
       VALUES ($1, 'ADMIN-BI-2026-0001-01', 'Admin', 'SchoolB', 'admin-b@test.bi', $2, $2, 'SCHOOL_ADMIN', 'active', FALSE)`,
      [schoolBId, passwordHash],
    );
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status, start_date)
       VALUES ($1, 'Premium', 10, 'CDF', 'monthly', 'active', '2026-09-01'),
              ($2, 'Premium', 10, 'BIF', 'monthly', 'active', '2026-09-01')`,
      [schoolAId, schoolBId],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       SELECT id, school_id, role, 'active' FROM users WHERE role IS NOT NULL`,
    );
  } finally {
    await pool.end();
  }
  return { isolatedUrl, schoolAId, schoolBId, countryCdId, classIds };
}

/**
 * BULLETIN-CLASSE-01 : migrations manuelles L1 (portée classe) et L3 (identité officielle figée),
 * appliquées APRÈS le démarrage du serveur (tables LOT 6 créées au boot) — même ordre qu'en
 * préproduction : code déployé, puis migration explicite en transaction unique.
 */
async function applyClassScopeMigrations(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const file of ["20261105_report_card_class_scope.sql", "20261106_report_card_official_assets.sql"]) {
      const sql = fs.readFileSync(path.join(ROOT, "backend/db/migrations", file), "utf8");
      await pool.query(`BEGIN;\n${sql}\nCOMMIT;`);
    }
  } finally {
    await pool.end();
  }
}

async function seedSecretaryReadOnly(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const existing = await pool.query(
      `SELECT id FROM role_module_permissions
       WHERE status = 'active' AND upper(role_key) = 'SECRETARY'
         AND scope_type = 'global' AND module_key = 'report_cards'
         AND country_id IS NULL AND school_id IS NULL
       LIMIT 1`,
    );
    if (existing.rowCount) {
      await pool.query(
        `UPDATE role_module_permissions
         SET can_create = FALSE, can_read = TRUE, can_update = FALSE, can_delete = FALSE,
             version = version + 1, updated_by = 'e2e-report-card-s1', updated_at = NOW()
         WHERE id = $1`,
        [existing.rows[0].id],
      );
    } else {
      await pool.query(
        `INSERT INTO role_module_permissions (
           role_key, scope_type, country_id, school_id, module_key,
           can_create, can_read, can_update, can_delete, status, version, updated_by
         ) VALUES (
           'SECRETARY', 'global', NULL, NULL, 'report_cards',
           FALSE, TRUE, FALSE, FALSE, 'active', 1, 'e2e-report-card-s1'
         )`,
      );
    }
  } finally {
    await pool.end();
  }
}

async function ensureChromium() {
  const { chromium } = require("playwright");
  try {
    const browser = await chromium.launch(LAUNCH);
    await browser.close();
  } catch {
    execSync("npx playwright install chromium", { cwd: ROOT, stdio: "inherit" });
  }
}

function requestModelCta(page) {
  return page
    .getByTestId("report-card-request-model-cta")
    .or(page.getByRole("link", { name: "Configurer un bulletin" }))
    .or(page.getByRole("button", { name: "Configurer un bulletin" }));
}

/** Capture de preuve (bureau + tablette) quand SOMAFRIK_E2E_SCREENSHOTS est défini. */
async function capture(page, name) {
  if (!SCREENSHOT_DIR) return;
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const viewport = page.viewportSize();
  const suffix = viewport && viewport.width < 1000 ? "tablette" : "bureau";
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-${suffix}.png`), fullPage: true });
}

async function captureBoth(page, name) {
  if (!SCREENSHOT_DIR) return;
  await capture(page, name);
  await page.setViewportSize(TABLET);
  await capture(page, name);
  await page.setViewportSize(DESKTOP);
}

function isCatalogCall(method, suffix) {
  return (response) => {
    let pathname = "";
    try {
      pathname = new URL(response.url()).pathname;
    } catch {
      pathname = response.url();
    }
    return response.request().method() === method && pathname.startsWith("/api/report-card/catalog") && pathname.endsWith(suffix);
  };
}



async function loginAsSchool(page, identifier, password, schoolCode) {
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("login-profile-school").click();
  await page.getByTestId("login-school-code").fill(schoolCode);
  await page.getByTestId("login-identifier").fill(identifier);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  const changeTitle = page.getByText("Nouveau mot de passe");
  try {
    await changeTitle.waitFor({ timeout: 2500 });
    await page.getByLabel(/Nouveau mot de passe/).fill(NEW_PASSWORD);
    await page.getByLabel(/^Confirmation/).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Enregistrer" }).click();
  } catch {
    /* pas de changement de mot de passe */
  }
  await page.getByTestId("logout-button").waitFor({ timeout: 45000 });
}

async function loginAsSuperadmin(page, identifier, password) {
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("login-profile-superadmin").click();
  await page.getByTestId("login-identifier").fill(identifier);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  const changeTitle = page.getByText("Nouveau mot de passe");
  try {
    await changeTitle.waitFor({ timeout: 2500 });
    await page.getByLabel(/Nouveau mot de passe/).fill(NEW_PASSWORD);
    await page.getByLabel(/^Confirmation/).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Enregistrer" }).click();
  } catch {
    /* pas de changement de mot de passe */
  }
  await page.getByTestId("logout-button").waitFor({ timeout: 45000 });
}

async function logout(page) {
  await page.getByTestId("logout-button").click();
  await page.getByTestId("login-submit").waitFor({ timeout: 15000 });
}

async function sessionToken(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem("somafrik.web.session");
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw);
      return parsed.accessToken || parsed.token || "";
    } catch {
      return "";
    }
  });
}

async function named(id, fn) {
  try {
    await fn();
    console.log(`OK ${id}`);
  } catch (error) {
    console.error(`FAIL ${id}: ${error && error.message ? error.message : error}`);
    throw error;
  }
}

async function openBulletinsFromNav(page) {
  await page.locator("nav").getByText("Pédagogie").waitFor({ timeout: 20000 });
  const bulletinsNav = page.getByTestId("nav-bulletins");
  await bulletinsNav.waitFor({ timeout: 20000 });
  await bulletinsNav.click();
  await page.waitForURL(/\/bulletins\/?$/, { timeout: 20000 });
}

async function waitVisibleText(page, text) {
  await page.getByText(text).first().waitFor();
}


async function clickAndWaitHttp(page, locator, match) {
  const pending = page.waitForResponse(
    (response) => match(response) && response.request().method() !== "OPTIONS",
    { timeout: 20000 },
  );
  await locator.click();
  return pending;
}

async function saveFailureEvidence(page, label) {
  try {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const file = path.join(EVIDENCE_DIR, `${label}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.error(`screenshot: ${file}`);
  } catch (error) {
    console.error(`screenshot failed: ${error && error.message ? error.message : error}`);
  }
}


async function runBrowserScenarios({ countryCdId, classIds }) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch(LAUNCH);
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("response", (response) => {
    if (!response.url().includes("/report-card/") || response.ok()) return;
    console.error(`http ${response.status()} ${response.request().method()} ${response.url()}`);
  });
  try {
    await named("e2e-report-card-catalog-superadmin-country-availability", async () => {
      await loginAsSuperadmin(page, "superadmin", superadminLoginPassword());
      // Ancien éditeur retiré : les anciennes URLs mènent au catalogue.
      await page.goto(`${WEB_URL}/parametres/bulletins-configuration`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/parametres\/bulletins-catalogue$/, { timeout: 20000 });
      await page.goto(`${WEB_URL}/parametres`, { waitUntil: "domcontentloaded" });
      await page.getByText("Catalogue des bulletins").first().click();
      await page.waitForURL(/\/parametres\/bulletins-catalogue$/, { timeout: 20000 });
      await page.getByTestId("catalog-admin-model-colombiere").waitFor();
      await page.getByTestId("catalog-admin-model-berceau").waitFor();
      assert.equal(await page.locator("textarea").count(), 0, "aucun éditeur JSON dans l'interface");
      await page.getByTestId("catalog-admin-model-colombiere").getByTestId("catalog-admin-allowed-none").waitFor();
      await captureBoth(page, "01-superadmin-catalogue");
      await page.getByTestId("catalog-admin-model-berceau").getByRole("button", { name: "Voir le modèle" }).click();
      await page.getByTestId("catalog-admin-view").waitFor();
      await capture(page, "02-superadmin-voir-modele-berceau");
      await page.keyboard.press("Escape");
      await page.getByTestId("catalog-admin-view").waitFor({ state: "detached" });
      await page.getByTestId("catalog-admin-manage-colombiere").click();
      await page.getByTestId("catalog-admin-availability").waitFor();
      await page.getByTestId("catalog-admin-toggle-CD").click();
      await page.getByTestId("catalog-admin-confirm-summary").waitFor();
      await capture(page, "03-superadmin-confirmation-disponibilite");
      const put = await clickAndWaitHttp(page, page.getByTestId("catalog-admin-confirm"), isCatalogCall("PUT", `/countries/${countryCdId}`));
      assert.equal(put.status(), 200, "PUT disponibilité");
      await page.getByTestId("catalog-admin-audit").waitFor();
      await waitVisibleText(page, "Jamais configuré");
      await captureBoth(page, "04-superadmin-disponibilite-historique");
      await page.keyboard.press("Escape");
      await page.getByTestId("catalog-admin-availability").waitFor({ state: "detached" });
      await page.getByTestId("catalog-admin-model-colombiere").getByTestId("catalog-admin-allowed").waitFor();
      const token = await sessionToken(page);
      const schoolRoute = await request("/report-card/catalog/models/colombiere/configuration", { token });
      assert.equal(schoolRoute.status, 403, "Superadmin : aucun accès au parcours école");
      const publications = await request("/report-card/publications", { token });
      assert.notEqual(publications.status, 200, "Superadmin : aucun accès aux bulletins");
    });

    await named("e2e-report-card-catalog-school-configure-save-activate", async () => {
      await logout(page);
      await loginAsSchool(page, "admin", "1234", SCHOOL_A_CODE);
      await openBulletinsFromNav(page);
      const cta = requestModelCta(page);
      try {
        await cta.first().waitFor({ timeout: 8000 });
      } catch {
        throw new Error("Admin établissement connecté → /bulletins → CTA « Configurer un bulletin » introuvable (#659)");
      }
      await cta.first().click();
      await page.waitForURL(/\/bulletins\/modele$/, { timeout: 20000 });
      await page.getByTestId("catalog-school-model-colombiere").waitFor();
      assert.equal(await page.getByTestId("catalog-school-model-berceau").count(), 0, "modèle non autorisé dans le pays : invisible");
      await captureBoth(page, "05-ecole-galerie");
      await page.getByTestId("catalog-school-choose-colombiere").click();
      await page.getByTestId("catalog-class-picker").waitFor();
      assert.equal(await page.getByTestId("catalog-step-structure").count(), 0, "classe obligatoire avant toute configuration");
      await page.getByLabel("Classe à configurer").selectOption({ label: `6e A — ${ACADEMIC_YEAR_NAME}` });
      await page.getByTestId("catalog-step-structure").waitFor();
      await captureBoth(page, "06-ecole-assistant-structure");
      await page.getByTestId("catalog-next").click();
      await page.getByTestId("catalog-step-subjects").waitFor();
      assert.equal(await page.getByLabel("Sciences", { exact: true }).count(), 0, "matière non enseignée en 6e A : non proposée");
      await page.getByLabel("Mathématiques", { exact: true }).check();
      await page.getByLabel("Français", { exact: true }).check();
      await page.getByLabel("Éducation civique", { exact: true }).check();
      await page.getByLabel("Maximum EX — Éducation civique").fill("");
      await page.getByLabel("Maximum TJ — Éducation civique").fill("10");
      await captureBoth(page, "07-ecole-assistant-matieres-maxima");
      await page.getByTestId("catalog-next").click();
      await page.getByTestId("catalog-step-sources").waitFor();
      await page.getByTestId("catalog-next").click();
      await page.getByText("Choisissez au moins un type d'évaluation.").first().waitFor();
      await capture(page, "08-ecole-assistant-erreurs-champ");
      const tj = page.locator("fieldset", { has: page.getByText("Travail journalier (TJ)", { exact: true }) });
      await tj.getByLabel("Interrogation").check();
      const ex = page.locator("fieldset", { has: page.getByText("Examen (EX)", { exact: true }) });
      await ex.getByLabel("Examen").check();
      await capture(page, "09-ecole-assistant-calcul");
      await page.getByTestId("catalog-next").click();
      await page.getByTestId("catalog-step-header").waitFor();
      await page.getByLabel("Ligne d'en-tête 1").fill("République démocratique du Congo");
      await page.getByLabel("Signature 1").fill("Le titulaire");
      await page.getByLabel("Signature 2").fill("Le chef d'établissement");
      await page.getByLabel("Signature 3").fill("Le parent");
      await captureBoth(page, "09b-ecole-assistant-en-tete");
      const previewCall = page.waitForResponse(isCatalogCall("POST", "/preview"));
      await page.getByTestId("catalog-next").click();
      assert.equal((await previewCall).status(), 200, "aperçu");
      await page.getByTestId("catalog-preview").waitFor();
      assert.ok((await page.getByTestId("catalog-preview").locator("[data-failing]").count()) > 0, "notes en échec signalées dans l'aperçu");
      await page.getByTestId("catalog-preview").getByText("Le chef d'établissement").waitFor();
      await page.getByTestId("catalog-preview").getByTestId("report-card-header").getByText("République démocratique du Congo").waitFor();
      await page.getByTestId("catalog-preview").getByText("6e A", { exact: true }).first().waitFor();
      await captureBoth(page, "10-ecole-apercu");
      await page.getByTestId("catalog-next").click();
      await page.getByTestId("catalog-step-summary").waitFor();
      await page.getByTestId("catalog-summary-class").getByText(`6e A — ${ACADEMIC_YEAR_NAME}`).waitFor();
      assert.equal(await page.getByTestId("catalog-activate").isDisabled(), true, "activation impossible avant enregistrement");
      const saved = await clickAndWaitHttp(page, page.getByTestId("catalog-save"), isCatalogCall("PUT", "/configuration"));
      assert.equal(saved.status(), 200, "enregistrement");
      await page.getByTestId("catalog-saved").waitFor();
      await captureBoth(page, "11-ecole-recapitulatif-enregistre");
      await page.getByTestId("catalog-activate").click();
      await page.getByTestId("catalog-activate-summary").waitFor();
      await capture(page, "12-ecole-confirmation-activation");
      const activated = await clickAndWaitHttp(page, page.getByTestId("catalog-activate-confirm"), isCatalogCall("POST", "/activate"));
      assert.equal(activated.status(), 200, "activation");
      await page.getByTestId("catalog-school-notice").waitFor();
      await page.getByTestId("catalog-school-model-colombiere").getByText("Actif pour cette classe").waitFor();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("catalog-school-model-colombiere").waitFor();
      await page.getByLabel("Afficher l'état pour").selectOption({ label: `6e A — ${ACADEMIC_YEAR_NAME}` });
      await page.getByTestId("catalog-school-model-colombiere").getByText("Actif pour cette classe").waitFor();
      await captureBoth(page, "13-ecole-modele-actif");
      const token = await sessionToken(page);
      const classA = await request(`/report-card/catalog?classId=${encodeURIComponent(classIds.A)}`, { token });
      assert.equal(classA.status, 200, JSON.stringify(classA.data));
      assert.equal(classA.data.models.find((m) => m.model_id === "colombiere")?.configuration, "ACTIVE", "6e A : configuration active après rechargement");
      const classB = await request(`/report-card/catalog?classId=${encodeURIComponent(classIds.B)}`, { token });
      assert.equal(classB.data.models.find((m) => m.model_id === "colombiere")?.configuration, "NONE", "6e B : non affectée par l'activation de 6e A");
      const ctxB = await request(`/report-card/catalog/models/colombiere/configuration?classId=${encodeURIComponent(classIds.B)}`, { token });
      assert.deepEqual(ctxB.data.subjects.map((s) => s.code).sort(), ["MATHEMATIQUES", "SCIENCES"], "6e B : seules ses matières");
      const admin = await request("/report-card/catalog/admin", { token });
      assert.equal(admin.status, 403, "Admin School : pas de gestion nationale");
      const put = await request(`/report-card/catalog/admin/models/berceau/countries/${countryCdId}`, {
        method: "PUT",
        token,
        body: { available: true, confirm: true },
      });
      assert.equal(put.status, 403, "Admin School : disponibilité nationale interdite");
    });

    await named("e2e-report-card-catalog-rbac-fail-closed", async () => {
      await logout(page);
      await loginAsSchool(page, "secretaire", "1234", SCHOOL_A_CODE);
      await openBulletinsFromNav(page);
      assert.equal(await requestModelCta(page).count(), 0, "Secrétaire READ-only ne doit pas voir le CTA");
      await page.goto(`${WEB_URL}/bulletins/modele`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/bulletins\/?$/, { timeout: 20000 });
      const pathname = new URL(page.url()).pathname.replace(/\/$/, "") || "/";
      assert.equal(pathname, "/bulletins", "navigation directe READ-only doit rediriger hors /bulletins/modele");
      assert.equal(await page.getByTestId("catalog-school").count(), 0, "la page de configuration ne doit pas rester visible");
      const token = await sessionToken(page);
      const saved = await request("/report-card/catalog/models/colombiere/configuration", {
        method: "PUT",
        token,
        body: { input: { structure: "SINGLE" } },
      });
      assert.equal(saved.status, 403, JSON.stringify(saved.data));
      const activated = await request("/report-card/catalog/models/colombiere/activate", { method: "POST", token, body: { confirm: true } });
      assert.equal(activated.status, 403, JSON.stringify(activated.data));
    });

    await named("e2e-report-card-catalog-other-country-and-cross-tenant", async () => {
      await logout(page);
      await loginAsSchool(page, "admin-bi", "1234", SCHOOL_B_CODE);
      await page.goto(`${WEB_URL}/bulletins/modele`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("catalog-school-empty").waitFor();
      await waitVisibleText(page, "Burundi");
      await captureBoth(page, "14-ecole-autre-pays-aucun-modele");
      const token = await sessionToken(page);
      const listed = await request("/report-card/catalog", { token });
      assert.equal(listed.status, 200, JSON.stringify(listed.data));
      assert.deepEqual(listed.data.models, [], "modèle non autorisé au Burundi : invisible");
      const ctx = await request("/report-card/catalog/models/colombiere/configuration", { token });
      assert.equal(ctx.status, 403, `configuration hors pays ${ctx.status}`);
      const foreign = await request("/report-card/bindings/catalog-colombiere", { token });
      assert.notEqual(foreign.status, 200, "établissement B ne voit pas la liaison de A");
    });
  } catch (error) {
    await saveFailureEvidence(page, "report-card-s1-e2e");
    throw error;
  } finally {
    await browser.close();
  }
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    if (process.env.CI) {
      throw new Error("DATABASE_URL obligatoire pour l'E2E Playwright Bulletins S1 en CI");
    }
    console.log("verify-report-card-s1-e2e: SKIP (DATABASE_URL absent)");
    return;
  }

  await ensureChromium();
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "somafrik-rc-source-"));
  const prepared = await prepareDatabase(databaseUrl);
  const backend = spawnBackend(prepared.isolatedUrl, storageDir);
  const web = spawnWeb();
  let backendLog = "";
  let webLog = "";
  backend.stdout.on("data", (chunk) => {
    backendLog += String(chunk);
  });
  backend.stderr.on("data", (chunk) => {
    backendLog += String(chunk);
  });
  web.stdout.on("data", (chunk) => {
    webLog += String(chunk);
  });
  web.stderr.on("data", (chunk) => {
    webLog += String(chunk);
  });
  const stop = () => {
    killProcessTree(backend);
    killProcessTree(web);
  };
  process.on("exit", stop);
  const startedAt = Date.now();
  try {
    await waitForUrl(`${apiBase()}/health`, "backend");
    await waitForUrl(WEB_URL, "web");
    await seedSecretaryReadOnly(prepared.isolatedUrl);
    await applyClassScopeMigrations(prepared.isolatedUrl);
    await runBrowserScenarios(prepared);
    console.log(`OK report-card-s1-e2e (${Date.now() - startedAt}ms)`);
  } catch (error) {
    console.error("backend log:\n", backendLog.slice(-6000));
    console.error("web log:\n", webLog.slice(-4000));
    throw error;
  } finally {
    stop();
    backend.stdout?.destroy();
    backend.stderr?.destroy();
    web.stdout?.destroy();
    web.stderr?.destroy();
    await wait(200);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
