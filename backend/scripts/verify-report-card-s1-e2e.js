"use strict";

/**
 * E2E Playwright réel — Bulletins LOT 6→11 / S1 smoke #656 / défaut #659.
 * Admin établissement → CTA demande modèle → persistance → artefact → mapping
 * Superadmin → revue → approbation → ACTIVE. RBAC fail-closed + cross-tenant.
 *
 * Aucun mock du workflow métier. PostgreSQL isolé. Pas de page.waitForTimeout().
 */
const assert = require("node:assert/strict");
const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Pool } = require("pg");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { hashSecret } = require("../services/credentialService");
const { createAcademicRuleProfilePgStore } = require("../db/academicRuleProfilePgStore");
const { createReportCardSchemaPgStore } = require("../db/reportCardSchemaPgStore");

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
const MODEL_KEY = "e2e-trimestriel";
const ACADEMIC_YEAR_NAME = "2026-2027";
const EVIDENCE_DIR = path.join(os.tmpdir(), "somafrik-report-card-s1-e2e");

const PDF_BYTES = Buffer.from("%PDF-1.4\n%SOMAFRIK-S1-E2E\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function calculableProfile() {
  return {
    period_mode: "term",
    periods: ["T1", "T2", "T3"],
    annual: true,
    score_components: [
      { id: "TJ", applicability: "always", max: 20, coefficient: 2 },
      { id: "EX", applicability: "per_subject", max: 20 },
    ],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up", stage: "display_only" },
    aggregation: {
      mode: "weighted_sum",
      coefficient_default: 1,
      percentage: "points_over_max_100",
    },
    ranking: { enabled: true, ties: "competition", metric: "PERCENTAGE" },
    pass_rule: { metric: "PERCENTAGE", threshold: 50 },
  };
}

function compatibleSchema() {
  return {
    sections: [
      {
        id: "SUBJECTS",
        order: 1,
        kind: "subject_rows",
        columns: [
          { id: "COL_TJ", order: 1, kind: "score_component", score_component_id: "TJ" },
          { id: "COL_T1", order: 2, kind: "period", period_id: "T1" },
        ],
      },
    ],
  };
}

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
  let schoolAId = "";
  let schoolBId = "";
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8"));
    await pool.query(PEDAGOGY_SCHEMA_SQL);
    const countryCd = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const countryBi = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status, profile_payload)
       VALUES ($1, $2, 'Lycée Kinshasa E2E', 'active', '{"timezone":"Africa/Kinshasa"}'::jsonb) RETURNING id`,
      [countryCd.rows[0].id, SCHOOL_A_CODE],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status, profile_payload)
       VALUES ($1, $2, 'Lycée Bujumbura E2E', 'active', '{"timezone":"Africa/Bujumbura"}'::jsonb) RETURNING id`,
      [countryBi.rows[0].id, SCHOOL_B_CODE],
    );
    schoolAId = schoolA.rows[0].id;
    schoolBId = schoolB.rows[0].id;
    await pool.query(
      `INSERT INTO academic_years (school_id, name, status, is_current, start_date, end_date)
       VALUES ($1, $2, 'open', TRUE, '2026-09-01', '2027-07-31')`,
      [schoolAId, ACADEMIC_YEAR_NAME],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status, must_change_password)
       VALUES (NULL, 'USR-2026-000002', 'Super', 'Admin', 'superadmin-e2e@test.cd', $1, $1, 'SUPER_ADMIN', 'active', FALSE)`,
      [passwordHash],
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
  } finally {
    await pool.end();
  }
  return { isolatedUrl, schoolAId, schoolBId };
}

async function seedCatalog(databaseUrl, schoolAId) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const profileStore = createAcademicRuleProfilePgStore(pool);
    const schemaStore = createReportCardSchemaPgStore(pool);
    await profileStore.createProfile({
      schoolId: schoolAId,
      actorSchoolId: schoolAId,
      profileKey: "e2e-academic-profile",
      spec: calculableProfile(),
      activate: true,
    });
    await schemaStore.createSchema({
      schoolId: schoolAId,
      actorSchoolId: schoolAId,
      schemaKey: "e2e-report-schema",
      spec: compatibleSchema(),
      activate: true,
    });
  } finally {
    await pool.end();
  }
}

async function ensureChromium() {
  const { chromium } = require("playwright");
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
  } catch {
    execSync("npx playwright install chromium", { cwd: ROOT, stdio: "inherit" });
  }
}

function requestModelCta(page) {
  return page
    .getByTestId("report-card-request-model-cta")
    .or(page.getByRole("link", { name: "Demander un modèle de bulletin" }))
    .or(page.getByRole("button", { name: "Demander un modèle de bulletin" }));
}

function submitRequestCta(page) {
  return page
    .getByTestId("report-card-submit-request")
    .or(page.getByRole("button", { name: "Soumettre la demande de modèle" }));
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

async function waitWorkflowState(page, status) {
  await page.locator(`li[data-workflow-state="${status}"]`).waitFor({ timeout: 20000 });
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

async function runBrowserScenarios({ schoolAId }) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const state = {
    requestId: "",
    artifactId: "",
    artifactVersion: "",
    schoolId: schoolAId,
  };
  try {
    await named("e2e-report-card-school-request-visible-and-persisted", async () => {
      await loginAsSchool(page, "admin", "1234", SCHOOL_A_CODE);
      await openBulletinsFromNav(page);
      const cta = requestModelCta(page);
      try {
        await cta.first().waitFor({ timeout: 8000 });
      } catch {
        throw new Error(
          "Admin établissement connecté → /bulletins → CTA « Demander un modèle de bulletin » introuvable (#659)",
        );
      }
      await cta.first().click();
      await page.waitForURL(/\/bulletins\/modele\/?$/, { timeout: 15000 });
      const year = page.getByTestId("report-card-academic-year").or(page.getByText(ACADEMIC_YEAR_NAME));
      await year.first().waitFor({ timeout: 15000 });
      const modelInput = page.getByLabel(/clé modèle/i);
      await modelInput.waitFor();
      await modelInput.fill(MODEL_KEY);
      const description = page.getByLabel(/^Description$/i);
      await description.fill("Demande E2E S1 isolée");
      const submit = submitRequestCta(page);
      await submit.first().waitFor();
      const created = await clickAndWaitHttp(
        page,
        submit.first(),
        (response) =>
          response.url().includes("/api/report-card/requests") &&
          response.request().method() === "POST" &&
          !response.url().includes("source-artifact"),
      );
      assert.ok(created.ok(), `submit HTTP ${created.status()} ${created.url()}`);
      const payload = await created.json().catch(() => null);
      state.requestId = String(payload?.request?.id || "");
      assert.match(state.requestId, /^[0-9a-f-]{36}$/i, "request id absent de la réponse HTTP");
      await waitWorkflowState(page, "SUBMITTED");
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitWorkflowState(page, "SUBMITTED");
      await page.getByText(MODEL_KEY).waitFor();
      const listed = await request("/report-card/requests", { token: await sessionToken(page) });
      assert.equal(listed.status, 200, JSON.stringify(listed.data));
      const row = (listed.data?.requests || []).find((item) => item.id === state.requestId);
      assert.ok(row, "demande absente après reload");
      assert.equal(row.status, "SUBMITTED");
      assert.equal(String(row.school_id || state.schoolId), String(state.schoolId));
      assert.equal(row.model_key, MODEL_KEY);
    });

    await named("e2e-report-card-source-upload-preview-persisted", async () => {
      const fileInput = page.locator(`li[data-workflow-state] input[type="file"]`).first();
      await fileInput.waitFor();
      await fileInput.setInputFiles({
        name: "modele-e2e.pdf",
        mimeType: "application/pdf",
        buffer: PDF_BYTES,
      });
      const uploadPdf = await clickAndWaitHttp(
        page,
        page.getByRole("button", { name: "Envoyer un modèle de bulletin" }).first(),
        (response) =>
          response.url().includes("/source-artifact") &&
          response.request().method() === "POST" &&
          !response.url().includes("/content"),
      );
      assert.ok(uploadPdf.ok(), `upload PDF HTTP ${uploadPdf.status()}`);
      const pdfBody = await uploadPdf.json().catch(() => null);
      const pdfId = String(pdfBody?.artifact?.artifact_id || "");
      assert.ok(pdfId, "artifact_id PDF absent");
      await page.locator("[data-source-artifact-preview]").waitFor();
      await page.getByText(pdfId).waitFor();
      const preview = page.locator(
        "[data-source-artifact-preview] iframe, [data-source-artifact-preview] img, iframe[title^='source-artifact'], img[alt^='source-artifact']",
      );
      await preview.first().waitFor();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("[data-source-artifact-preview]").waitFor();
      await page.getByText(pdfId).waitFor();

      await fileInput.setInputFiles({
        name: "modele-e2e.png",
        mimeType: "image/png",
        buffer: PNG_BYTES,
      });
      const uploadPng = await clickAndWaitHttp(
        page,
        page.getByRole("button", { name: "Envoyer un modèle de bulletin" }).first(),
        (response) =>
          response.url().includes("/source-artifact") &&
          response.request().method() === "POST" &&
          !response.url().includes("/content"),
      );
      assert.ok(uploadPng.ok(), `upload PNG HTTP ${uploadPng.status()}`);
      const pngBody = await uploadPng.json().catch(() => null);
      state.artifactId = String(pngBody?.artifact?.artifact_id || "");
      state.artifactVersion = String(pngBody?.artifact?.version || "");
      assert.ok(state.artifactId, "artifact_id PNG absent");
      assert.notEqual(state.artifactId, pdfId, "la version PNG doit remplacer l'artefact PDF");
      await page.getByText(state.artifactId).waitFor();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText(state.artifactId).waitFor();
      const current = await request(`/report-card/requests/${encodeURIComponent(state.requestId)}/source-artifact`, {
        token: await sessionToken(page),
      });
      assert.equal(current.status, 200, JSON.stringify(current.data));
      assert.equal(current.data?.artifact?.artifact_id, state.artifactId);
      assert.equal(String(current.data?.artifact?.version), state.artifactVersion);
    });

    await named("e2e-report-card-superadmin-explicit-mapping", async () => {
      await logout(page);
      await loginAsSuperadmin(page, "superadmin", "1234");
      await page.goto(`${WEB_URL}/parametres/bulletins-configuration`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: /configuration bulletins/i }).waitFor();
      const schoolInput = page.getByLabel(/établissement cible/i);
      await schoolInput.fill(state.schoolId);
      const loaded = await clickAndWaitHttp(
        page,
        page.getByRole("button", { name: "Charger la file" }),
        (response) => response.url().includes("/report-card/admin/queue") && response.request().method() === "GET",
      );
      assert.ok(loaded.ok(), `queue HTTP ${loaded.status()}`);
      const queueBody = await loaded.json().catch(() => null);
      const found = (queueBody?.requests || []).find((item) => item.id === state.requestId);
      assert.ok(found, "Superadmin ne retrouve pas la demande créée");
      assert.equal(found.school_id, state.schoolId);
      await page.getByText(MODEL_KEY).waitFor();
      await page.getByText(state.artifactId).waitFor();
      const adminPreview = page.locator(
        "iframe[title^='source-artifact'], img[alt^='source-artifact']",
      );
      await adminPreview.first().waitFor();

      const review = await clickAndWaitHttp(
        page,
        page.getByRole("button", { name: "Examiner" }),
        (response) => response.url().includes("/review") && response.request().method() === "POST",
      );
      assert.ok(review.ok(), `review HTTP ${review.status()}`);
      const configure = await clickAndWaitHttp(
        page,
        page.getByRole("button", { name: "Configurer" }),
        (response) => response.url().includes("/configure") && response.request().method() === "POST",
      );
      assert.ok(configure.ok(), `configure HTTP ${configure.status()}`);
      await page.getByLabel(/profil académique/i).waitFor();
      const saveTemplate = await clickAndWaitHttp(
        page,
        page.getByRole("button", { name: "Enregistrer gabarit" }),
        (response) => response.url().includes("/save-template") && response.request().method() === "POST",
      );
      assert.ok(saveTemplate.ok(), `save-template HTTP ${saveTemplate.status()}`);
      const bind = await clickAndWaitHttp(
        page,
        page.getByRole("button", { name: "Lier le bundle" }),
        (response) => response.url().includes("/bind-bundle") && response.request().method() === "POST",
      );
      assert.ok(bind.ok(), `bind-bundle HTTP ${bind.status()}`);
      const bindBody = await bind.json().catch(() => null);
      const bindReq = bindBody?.request || {};
      assert.ok(bindReq.profile_id, "mapping AcademicRuleProfile absent");
      assert.ok(bindReq.schema_id, "mapping ReportCardSchema absent");
      assert.ok(bindReq.rendering_template_id, "mapping RenderingTemplate absent");
      const ready = await clickAndWaitHttp(
        page,
        page.getByRole("button", { name: "Prêt pour revue" }),
        (response) => response.url().includes("/ready-for-review") && response.request().method() === "POST",
      );
      assert.ok(ready.ok(), `ready-for-review HTTP ${ready.status()}`);
      await waitWorkflowState(page, "READY_FOR_REVIEW");
    });

    await named("e2e-report-card-ready-review-school-approval-active", async () => {
      await logout(page);
      await loginAsSchool(page, "admin", "1234", SCHOOL_A_CODE);
      await page.goto(`${WEB_URL}/bulletins/modele`, { waitUntil: "domcontentloaded" });
      await waitWorkflowState(page, "READY_FOR_REVIEW");
      const approve = await clickAndWaitHttp(
        page,
        page.getByRole("button", { name: "Approuver" }),
        (response) => response.url().includes("/approve") && response.request().method() === "POST",
      );
      assert.ok(approve.ok(), `approve HTTP ${approve.status()}`);
      await waitWorkflowState(page, "APPROVED");
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitWorkflowState(page, "APPROVED");

      await logout(page);
      await loginAsSuperadmin(page, "superadmin", "1234");
      await page.goto(`${WEB_URL}/parametres/bulletins-configuration`, { waitUntil: "domcontentloaded" });
      await page.getByLabel(/établissement cible/i).fill(state.schoolId);
      await clickAndWaitHttp(
        page,
        page.getByRole("button", { name: "Charger la file" }),
        (response) => response.url().includes("/report-card/admin/queue") && response.request().method() === "GET",
      );
      await waitWorkflowState(page, "APPROVED");
      const activate = await clickAndWaitHttp(
        page,
        page.getByRole("button", { name: "Activer" }),
        (response) => response.url().includes("/activate") && response.request().method() === "POST",
      );
      assert.ok(activate.ok(), `activate HTTP ${activate.status()}`);
      await waitWorkflowState(page, "ACTIVE");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByLabel(/établissement cible/i).fill(state.schoolId);
      await clickAndWaitHttp(
        page,
        page.getByRole("button", { name: "Charger la file" }),
        (response) => response.url().includes("/report-card/admin/queue") && response.request().method() === "GET",
      );
      await waitWorkflowState(page, "ACTIVE");
      await page.getByText(MODEL_KEY).waitFor();
      await page.getByText(state.artifactId).waitFor();
      const token = await sessionToken(page);
      const again = await request(
        `/report-card/admin/requests/${encodeURIComponent(state.requestId)}?schoolId=${encodeURIComponent(state.schoolId)}`,
        { token },
      );
      assert.equal(again.status, 200, JSON.stringify(again.data));
      assert.equal(again.data?.request?.id, state.requestId);
      assert.equal(again.data?.request?.status, "ACTIVE");
      const artifact = await request(
        `/report-card/admin/requests/${encodeURIComponent(state.requestId)}/source-artifact?schoolId=${encodeURIComponent(state.schoolId)}`,
        { token },
      );
      assert.equal(artifact.status, 200, JSON.stringify(artifact.data));
      assert.equal(artifact.data?.artifact?.artifact_id, state.artifactId);
      assert.equal(String(artifact.data?.artifact?.version), state.artifactVersion);
      const binding = await request(
        `/report-card/admin/bindings/${encodeURIComponent(MODEL_KEY)}?schoolId=${encodeURIComponent(state.schoolId)}`,
        { token },
      );
      assert.equal(binding.status, 200, JSON.stringify(binding.data));
      assert.ok(binding.data?.binding, "binding ACTIVE absent après reload");
    });

    await named("e2e-report-card-request-rbac-fail-closed", async () => {
      await logout(page);
      await loginAsSchool(page, "secretaire", "1234", SCHOOL_A_CODE);
      await openBulletinsFromNav(page);
      assert.equal(await requestModelCta(page).count(), 0, "Secrétaire READ-only ne doit pas voir le CTA de demande");
      await page.goto(`${WEB_URL}/bulletins/modele`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: /modèle de bulletin/i }).waitFor();
      assert.equal(await submitRequestCta(page).count(), 0, "navigation directe ne doit pas exposer la soumission");
      const token = await sessionToken(page);
      const created = await request("/report-card/requests", {
        method: "POST",
        token,
        body: { modelKey: "rbac-bypass", description: "interdit" },
      });
      assert.equal(created.status, 403, JSON.stringify(created.data));
    });

    await named("e2e-report-card-cross-tenant-forbidden", async () => {
      await logout(page);
      await loginAsSchool(page, "admin-bi", "1234", SCHOOL_B_CODE);
      await page.goto(`${WEB_URL}/bulletins/modele`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: /modèle de bulletin/i }).waitFor();
      const token = await sessionToken(page);
      const listed = await request("/report-card/requests", { token });
      assert.equal(listed.status, 200, JSON.stringify(listed.data));
      const leaked = (listed.data?.requests || []).some((item) => item.id === state.requestId);
      assert.equal(leaked, false, "établissement B voit la demande de A");
      const foreign = await request(`/report-card/requests/${encodeURIComponent(state.requestId)}`, { token });
      assert.ok([403, 404].includes(foreign.status), `GET cross-tenant ${foreign.status}`);
      const artifact = await request(
        `/report-card/requests/${encodeURIComponent(state.requestId)}/source-artifact`,
        { token },
      );
      assert.ok([403, 404].includes(artifact.status), `artefact cross-tenant ${artifact.status}`);
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
    await seedCatalog(prepared.isolatedUrl, prepared.schoolAId);
    await runBrowserScenarios({ schoolAId: prepared.schoolAId });
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
