"use strict";

/**
 * E2E navigateur Planning V2 Web — /planning.
 * Admin menu, création weekly, 409, modification, annulation, enseignant read-only,
 * Parent / Secrétaire interdits.
 */
const assert = require("node:assert/strict");
const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { hashSecret } = require("../services/credentialService");
const { loadReconciledSchoolCourseId } = require("./loadReconciledSchoolCourse");

const ROOT = path.resolve(__dirname, "../..");
const API_PORT = 19881;
const WEB_PORT = 5181;
const PG_HTTP_DATABASE = String(process.env.SOMAFRIK_PLANNING_WEB_E2E_DATABASE ?? "somafrik_planning_web_e2e")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const SCHOOL_CODE = "CD-IN-26-001";
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const NEW_PASSWORD = "Planning#2026Aa";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const maintenanceUrl = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenanceUrl });
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

function spawnBackend(databaseUrl) {
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
      DATABASE_URL: databaseUrl,
      JWT_SECRET: process.env.JWT_SECRET || "verify-planning-v2-web-e2e-secret-32ch",
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
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

async function loginApi(identifier, password) {
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, schoolCode: SCHOOL_CODE },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.accessToken || result.data.token;
}

async function prepareDatabase(databaseUrl) {
  const isolatedUrl = await ensureIsolatedDatabase(databaseUrl, PG_HTTP_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const passwordHash = hashSecret("1234");
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8"));
    await pool.query(PEDAGOGY_SCHEMA_SQL);
    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status, profile_payload)
       VALUES ($1, 'CD-2026-0001', 'CD-IN-26-001', 'Lycée IN', 'active', '{"timezone":"Africa/Kinshasa"}'::jsonb) RETURNING id`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2026-2027', 'open') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const classA = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-2A', '2ème A', 'active') RETURNING id`,
      [schoolA.rows[0].id, year.rows[0].id],
    );
    const classB = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-2B', '2ème B', 'active') RETURNING id`,
      [schoolA.rows[0].id, year.rows[0].id],
    );
    const math = await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, 'SUB-MATH', 'Mathématiques', 2, 'active') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-CD-2026-0001-01', 'Admin', 'HTTP', 'admin-http@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'SECRETAIRE-CD-2026-0001-01', 'Amina', 'Secretaire', 'secretaire-http@test.cd', $2, $2, 'SECRETARY', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
       VALUES ($1, 'PARENT-CD-2026-0001-01', 'Parent', 'HTTP', 'parent-http@test.cd', '+243 820 000 001', $2, $2, 'PARENT', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    const teacherUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ENS-0001', 'Seke', 'Kilombo', 'seke-http@test.cd', $2, $2, 'TEACHER', 'active') RETURNING id`,
      [schoolA.rows[0].id, passwordHash],
    );
    const teacher = await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status)
       VALUES ($1, $2, 'ENS-0001', 'active') RETURNING id`,
      [schoolA.rows[0].id, teacherUser.rows[0].id],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active'), ($1, $2, $6, $4, $5, 'active')`,
      [schoolA.rows[0].id, teacher.rows[0].id, classA.rows[0].id, math.rows[0].id, year.rows[0].id, classB.rows[0].id],
    );
    await pool.query(
      `INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open')`,
      [year.rows[0].id],
    );
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status, start_date)
       VALUES ($1, 'Premium', 10, 'CDF', 'monthly', 'active', '2026-09-01')`,
      [schoolA.rows[0].id],
    );
  } finally {
    await pool.end();
  }
  return isolatedUrl;
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

async function loginAs(page, identifier, password) {
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("login-profile-school").click();
  await page.getByTestId("login-school-code").fill(SCHOOL_CODE);
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

async function waitToast(page, pattern) {
  const toast = page.getByTestId("app-toast");
  await toast.waitFor({ timeout: 15000 });
  await page.waitForFunction(
    (expected) => {
      const node = document.querySelector('[data-testid="app-toast"]');
      return node && new RegExp(expected, "i").test(node.textContent || "");
    },
    String(pattern),
    { timeout: 15000 },
  );
}

async function runBrowserScenarios() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(20000);
  try {
    await loginAs(page, "admin", "1234");
    const planningNav = page.getByTestId("nav-planning");
    await planningNav.waitFor({ timeout: 20000 });
    await page.locator("nav").getByText("Planning de cours").waitFor();
    await planningNav.click();
    await page.getByTestId("planning-page").waitFor({ timeout: 30000 });
    await page.getByTestId("planning-page").getByRole("heading", { name: "Planning de cours" }).waitFor();

    await page.getByTestId("planning-create-button").click();
    await page.getByTestId("planning-save-button").click();
    await waitToast(page, "Créneau hebdomadaire créé");
    await page.getByTestId("planning-event").first().waitFor({ timeout: 20000 });

    await page.getByTestId("planning-create-button").click();
    await page.getByTestId("planning-save-button").click();
    await waitToast(page, "Conflit");
    await page.getByRole("button", { name: "Fermer" }).click();

    await page.getByTestId("planning-event").first().click();
    await page.getByTestId("planning-end-time").fill("10:00");
    await page.getByTestId("planning-save-button").click();
    await waitToast(page, "Créneau mis à jour");

    await page.getByTestId("planning-event").first().click();
    await page.getByTestId("planning-cancel-slot-button").click();
    await waitToast(page, "Créneau annulé");

    await logout(page);

    await loginAs(page, "seke-http@test.cd", "1234");
    await page.getByTestId("nav-planning").click();
    await page.getByTestId("planning-page").waitFor({ timeout: 30000 });
    assert.equal(await page.getByTestId("planning-create-button").count(), 0);
    assert.equal(await page.getByTestId("planning-save-button").count(), 0);
    await logout(page);

    await loginAs(page, "+243 820 000 001", "1234");
    assert.equal(await page.getByTestId("nav-planning").count(), 0);
    await page.goto(`${WEB_URL}/planning`, { waitUntil: "domcontentloaded" });
    await wait(2000);
    assert.equal(await page.getByTestId("planning-page").count(), 0);
    await logout(page);

    await loginAs(page, "secretaire", "1234");
    assert.equal(await page.getByTestId("nav-planning").count(), 0);
    await page.goto(`${WEB_URL}/planning`, { waitUntil: "domcontentloaded" });
    await wait(2000);
    assert.equal(await page.getByTestId("planning-page").count(), 0);

    console.log("OK e2e-browser: /planning Admin CRUD + 409, enseignant read-only, Parent/Secrétaire interdits");
  } finally {
    await browser.close();
  }
}

async function seedCanonicalCourse(databaseUrl) {
  const id = await loadReconciledSchoolCourseId(databaseUrl, {
    className: "2ème A",
    subjectName: "Mathématiques",
  });
  assert.match(String(id), /^[0-9a-f-]{36}$/i);
  return id;
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    if (process.env.CI) {
      throw new Error("DATABASE_URL obligatoire pour l'E2E navigateur Planning en CI");
    }
    console.log("verify-planning-v2-web-e2e: SKIP (DATABASE_URL absent)");
    return;
  }

  await ensureChromium();
  const isolatedUrl = await prepareDatabase(databaseUrl);
  const backend = spawnBackend(isolatedUrl);
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
  try {
    await waitForUrl(`${apiBase()}/health`, "backend");
    await waitForUrl(WEB_URL, "web");
    await seedCanonicalCourse(isolatedUrl);
    await runBrowserScenarios();
  } catch (error) {
    console.error("backend log:\n", backendLog.slice(-4000));
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
