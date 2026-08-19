"use strict";

/**
 * Planning V2 Remplacements — HTTP + RBAC + concurrence + projection + E2E.
 */
const assert = require("node:assert/strict");
const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { hashSecret } = require("../services/credentialService");
const { PEDAGOGY_ERROR } = require("../lib/pedagogyManagement");
const { loadReconciledSchoolCourseId } = require("./loadReconciledSchoolCourse");

const ROOT = path.resolve(__dirname, "../..");
const PG_PORT = 19892;
const WEB_PORT = 5183;
const PG_HTTP_DATABASE = String(
  process.env.SOMAFRIK_PLANNING_REPLACEMENTS_HTTP_IT_DATABASE ?? "somafrik_planning_replacements_http_it",
)
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const SCHOOL_CODE = "CD-2026-0001";
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const NEW_PASSWORD = "Planning#2026Aa";
const ARTIFACTS = process.env.CURSOR_ARTIFACTS_DIR || "/tmp/cursor/artifacts";

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

function baseUrl(port) {
  return `http://127.0.0.1:${port}/api`;
}

async function request(port, pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl(port)}${pathname}`, {
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
      PORT: String(PG_PORT),
      SOMAFRIK_DB_REQUIRED: "true",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: process.env.JWT_SECRET || "verify-planning-replacements-test-secret-32ch",
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
      VITE_API_URL: `http://127.0.0.1:${PG_PORT}`,
      VITE_API_TARGET: `http://127.0.0.1:${PG_PORT}`,
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

async function waitForHealth(child, port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl(port)}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error("Backend health timeout");
}

async function waitForUrl(url, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error(`${label} timeout`);
}

async function login(port, identifier, password, schoolCode) {
  const result = await request(port, "/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.accessToken || result.data.token;
}

async function loginReady(port, identifier, password, schoolCode) {
  let token = await login(port, identifier, password, schoolCode);
  const changed = await request(port, "/auth/change-password", {
    method: "POST",
    token,
    body: { newPassword: NEW_PASSWORD },
  });
  if ([200, 201].includes(changed.status)) {
    token = changed.data?.accessToken || (await login(port, identifier, NEW_PASSWORD, schoolCode));
  }
  return token;
}

function decodeJwt(token) {
  const payload = String(token).split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
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
      `INSERT INTO schools (country_id, school_code, name, status, profile_payload)
       VALUES ($1, 'CD-2026-0001', 'Lycée IN', 'active', '{"timezone":"Africa/Kinshasa"}'::jsonb) RETURNING id`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status, start_date, end_date)
       VALUES ($1, '2026-2027', 'open', '2026-08-01', '2027-07-31') RETURNING id`,
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
    const french = await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, 'SUB-FR', 'Français', 2, 'active') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-CD-2026-0001-01', 'Admin', 'HTTP', 'admin-http@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'PREFET-CD-2026-0001-01', 'Samuel', 'Prefet', 'prefet-http@test.cd', $2, $2, 'PREFET_ETUDES', 'active')`,
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
    const sekeUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ENS-0001', 'Seke', 'Kilombo', 'seke-http@test.cd', $2, $2, 'TEACHER', 'active') RETURNING id`,
      [schoolA.rows[0].id, passwordHash],
    );
    const kabeyaUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ENS-0002', 'Jean', 'Kabeya', 'kabeya-http@test.cd', $2, $2, 'TEACHER', 'active') RETURNING id`,
      [schoolA.rows[0].id, passwordHash],
    );
    const seke = await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, speciality, status)
       VALUES ($1, $2, 'ENS-0001', 'Mathématiques', 'active') RETURNING id`,
      [schoolA.rows[0].id, sekeUser.rows[0].id],
    );
    const kabeya = await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, speciality, status)
       VALUES ($1, $2, 'ENS-0002', 'Français', 'active') RETURNING id`,
      [schoolA.rows[0].id, kabeyaUser.rows[0].id],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active'), ($1, $6, $7, $8, $5, 'active')`,
      [schoolA.rows[0].id, seke.rows[0].id, classA.rows[0].id, math.rows[0].id, year.rows[0].id, kabeya.rows[0].id, classB.rows[0].id, french.rows[0].id],
    );
    await pool.query(`INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open')`, [year.rows[0].id]);
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

function assertSourceGuards() {
  const page = fs.readFileSync(path.join(ROOT, "web/src/pages/planning/PlanningSubstitutionsPage.tsx"), "utf8");
  assert.match(page, /replacementsApi/);
  assert.doesNotMatch(page, /localStorage/);
  assert.doesNotMatch(page, /Bientôt disponible/);
  const service = fs.readFileSync(path.join(ROOT, "backend/lib/courseScheduleReplacementsService.js"), "utf8");
  assert.doesNotMatch(service, /school_courses.teacher_id/);
  assert.match(service, /weeklySlotId/);
  assert.match(service, /occurrenceDate/);
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

async function runHttp(databaseUrl) {
  const isolatedUrl = await prepareDatabase(databaseUrl);
  const pool = new Pool({ connectionString: isolatedUrl });
  const child = spawnBackend(isolatedUrl);
  try {
    await waitForHealth(child, PG_PORT);
    const prefetToken = await loginReady(PG_PORT, "prefet", "1234", SCHOOL_CODE);
    const teacherToken = await login(PG_PORT, "ENS-0001", "1234", SCHOOL_CODE);
    const kabeyaToken = await login(PG_PORT, "ENS-0002", "1234", SCHOOL_CODE);
    const secretaryToken = await loginReady(PG_PORT, "secretaire", "1234", SCHOOL_CODE);
    const parentToken = await login(PG_PORT, "+243 820 000 001", "1234", SCHOOL_CODE);

    const prefetJwt = decodeJwt(prefetToken);
    assert.ok((prefetJwt.permissions || []).includes("Remplacements:CREATE"));
    const teacherJwt = decodeJwt(teacherToken);
    assert.ok((teacherJwt.permissions || []).includes("Remplacements:READ"));
    assert.equal((teacherJwt.permissions || []).includes("Remplacements:CREATE"), false);

    assert.equal((await request(PG_PORT, "/course-schedule-replacements", { token: parentToken })).status, 403);
    assert.equal((await request(PG_PORT, "/course-schedule-replacements", { token: secretaryToken })).status, 403);
    assert.equal(
      (await request(PG_PORT, "/course-schedule-replacements", { method: "POST", token: teacherToken, body: {} })).status,
      403,
    );

    const yearId = (await pool.query(`SELECT id FROM academic_years LIMIT 1`)).rows[0].id;
    const kabeyaId = (await pool.query(`SELECT id FROM teachers WHERE teacher_code = 'ENS-0002'`)).rows[0].id;
    const sekeId = (await pool.query(`SELECT id FROM teachers WHERE teacher_code = 'ENS-0001'`)).rows[0].id;
    const courseAId = await loadReconciledSchoolCourseId(isolatedUrl, { className: "2ème A", subjectName: "Mathématiques" });
    const courseBId = await loadReconciledSchoolCourseId(isolatedUrl, { className: "2ème B", subjectName: "Français" });

    const slotA = await request(PG_PORT, "/course-schedules", {
      method: "POST",
      token: prefetToken,
      body: { schoolCourseId: courseAId, academicYearId: yearId, dayOfWeek: 1, startTime: "08:00", endTime: "09:00" },
    });
    assert.equal(slotA.status, 201, JSON.stringify(slotA.data));

    const weeklyTeacherBefore = slotA.data.teacherId;
    const courseTeacherBefore = (await pool.query(`SELECT teacher_id FROM school_courses WHERE id = $1`, [courseAId])).rows[0]
      .teacher_id;
    const assignmentCountBefore = (
      await pool.query(`SELECT count(*)::int AS c FROM teacher_assignments WHERE teacher_id = $1 AND status = 'active'`, [sekeId])
    ).rows[0].c;

    const badDay = await request(PG_PORT, "/course-schedule-replacements", {
      method: "POST",
      token: prefetToken,
      body: { weeklySlotId: slotA.data.id, occurrenceDate: "2026-08-25", substituteTeacherId: kabeyaId },
    });
    assert.equal(badDay.status, 400);
    assert.equal(badDay.data?.code, PEDAGOGY_ERROR.REPLACEMENT_WEEKDAY_MISMATCH);

    const created = await request(PG_PORT, "/course-schedule-replacements", {
      method: "POST",
      token: prefetToken,
      body: {
        weeklySlotId: slotA.data.id,
        occurrenceDate: "2026-08-24",
        substituteTeacherId: kabeyaId,
        reason: "Absence Seke",
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));

    const projection = await request(PG_PORT, "/course-schedules?from=2026-08-24&to=2026-08-24", { token: prefetToken });
    assert.equal(projection.status, 200);
    const occ = (projection.data.items || []).find((row) => row.scheduleId === slotA.data.id);
    assert.equal(occ.replacement, true);
    assert.equal(occ.replacementId, created.data.id);
    assert.match(String(occ.teacher || occ.teacherName), /Kabeya/i);
    assert.match(String(occ.originalTeacher), /Seke/i);

    const concurrentBody = {
      weeklySlotId: slotA.data.id,
      occurrenceDate: "2026-09-07",
      substituteTeacherId: kabeyaId,
    };
    const [left, right] = await Promise.all([
      request(PG_PORT, "/course-schedule-replacements", { method: "POST", token: prefetToken, body: concurrentBody }),
      request(PG_PORT, "/course-schedule-replacements", { method: "POST", token: prefetToken, body: concurrentBody }),
    ]);
    const statuses = [left.status, right.status].sort();
    assert.deepEqual(statuses, [201, 409], JSON.stringify({ left: left.data, right: right.data }));

    const kabeyaView = await request(PG_PORT, "/course-schedules?from=2026-08-24&to=2026-08-24", { token: kabeyaToken });
    assert.equal(kabeyaView.status, 200);
    assert.ok((kabeyaView.data.items || []).some((row) => row.replacementId === created.data.id));
    assert.equal(
      (await request(PG_PORT, "/course-schedule-replacements", { method: "POST", token: kabeyaToken, body: {} })).status,
      403,
    );

    const slotB = await request(PG_PORT, "/course-schedules", {
      method: "POST",
      token: prefetToken,
      body: { schoolCourseId: courseBId, academicYearId: yearId, dayOfWeek: 1, startTime: "08:00", endTime: "09:00" },
    });
    assert.equal(slotB.status, 201, JSON.stringify(slotB.data));
    const teachingConflict = await request(PG_PORT, "/course-schedule-replacements", {
      method: "POST",
      token: prefetToken,
      body: { weeklySlotId: slotA.data.id, occurrenceDate: "2026-08-31", substituteTeacherId: kabeyaId },
    });
    assert.equal(teachingConflict.status, 409);
    assert.equal(teachingConflict.data?.code, PEDAGOGY_ERROR.SUBSTITUTE_TEACHER_SCHEDULE_CONFLICT);

    const cancelled = await request(PG_PORT, `/course-schedule-replacements/${created.data.id}`, {
      method: "DELETE",
      token: prefetToken,
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.status, "cancelled");
    const restored = await request(PG_PORT, "/course-schedules?from=2026-08-24&to=2026-08-24", { token: prefetToken });
    const occ2 = (restored.data.items || []).find((row) => row.scheduleId === slotA.data.id);
    assert.equal(Boolean(occ2.replacement), false);
    assert.match(String(occ2.teacher || occ2.teacherName), /Seke/i);

    const weeklyTeacherAfter = (await pool.query(`SELECT teacher_id FROM course_schedule_weekly_slots WHERE id = $1`, [slotA.data.id]))
      .rows[0].teacher_id;
    const courseTeacherAfter = (await pool.query(`SELECT teacher_id FROM school_courses WHERE id = $1`, [courseAId])).rows[0]
      .teacher_id;
    const assignmentCountAfter = (
      await pool.query(`SELECT count(*)::int AS c FROM teacher_assignments WHERE teacher_id = $1 AND status = 'active'`, [sekeId])
    ).rows[0].c;
    assert.equal(String(weeklyTeacherAfter), String(weeklyTeacherBefore));
    assert.equal(String(courseTeacherAfter), String(courseTeacherBefore));
    assert.equal(assignmentCountAfter, assignmentCountBefore);

    console.log("OK http: remplacements RBAC, projection, weekly/course inchangés, concurrence");
    return { isolatedUrl, prefetToken, slotId: slotA.data.id, kabeyaId };
  } finally {
    killProcessTree(child);
    await pool.end();
    await wait(200);
  }
}

async function runBrowser(databaseUrl) {
  await ensureChromium();
  const isolatedUrl = await prepareDatabase(databaseUrl);
  const backend = spawnBackend(isolatedUrl);
  const web = spawnWeb();
  try {
    await waitForHealth(backend, PG_PORT);
    await waitForUrl(WEB_URL, "web");
    const prefetToken = await loginReady(PG_PORT, "prefet", "1234", SCHOOL_CODE);
    const yearId = (await request(PG_PORT, "/course-schedules", { token: prefetToken })).data;
    const pool = new Pool({ connectionString: isolatedUrl });
    const year = (await pool.query(`SELECT id FROM academic_years LIMIT 1`)).rows[0].id;
    const kabeyaId = (await pool.query(`SELECT id FROM teachers WHERE teacher_code = 'ENS-0002'`)).rows[0].id;
    await pool.end();
    const courseAId = await loadReconciledSchoolCourseId(isolatedUrl, { className: "2ème A", subjectName: "Mathématiques" });
    const slot = await request(PG_PORT, "/course-schedules", {
      method: "POST",
      token: prefetToken,
      body: { schoolCourseId: courseAId, academicYearId: year, dayOfWeek: 1, startTime: "08:00", endTime: "09:00" },
    });
    assert.equal(slot.status, 201, JSON.stringify(slot.data));
    const created = await request(PG_PORT, "/course-schedule-replacements", {
      method: "POST",
      token: prefetToken,
      body: { weeklySlotId: slot.data.id, occurrenceDate: "2026-08-24", substituteTeacherId: kabeyaId, reason: "Absence" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));

    const { chromium } = require("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(25000);
    try {
      await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("login-profile-school").click();
      await page.getByTestId("login-school-code").fill(SCHOOL_CODE);
      await page.getByTestId("login-identifier").fill("prefet");
      await page.getByTestId("login-password").fill(NEW_PASSWORD);
      await page.getByTestId("login-submit").click();
      await page.getByTestId("logout-button").waitFor({ timeout: 45000 });
      await page.goto(`${WEB_URL}/planning/remplacements`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("planning-replacements-page").waitFor();
      await page.getByText("Kabeya").waitFor();
      fs.mkdirSync(ARTIFACTS, { recursive: true });
      await page.screenshot({ path: path.join(ARTIFACTS, "planning-remplacements.png"), fullPage: true });

      await page.getByTestId("logout-button").click();
      await page.getByTestId("login-submit").waitFor({ timeout: 15000 });
      await page.getByTestId("login-profile-school").click();
      await page.getByTestId("login-school-code").fill(SCHOOL_CODE);
      await page.getByTestId("login-identifier").fill("ENS-0002");
      await page.getByTestId("login-password").fill("1234");
      await page.getByTestId("login-submit").click();
      const changeTitle = page.getByText("Nouveau mot de passe");
      try {
        await changeTitle.waitFor({ timeout: 2500 });
        await page.getByLabel(/Nouveau mot de passe/).fill(NEW_PASSWORD);
        await page.getByLabel(/^Confirmation/).fill(NEW_PASSWORD);
        await page.getByRole("button", { name: "Enregistrer" }).click();
      } catch {
        /* mot de passe déjà changé */
      }
      await page.getByTestId("logout-button").waitFor({ timeout: 45000 });
      await page.goto(`${WEB_URL}/planning/remplacements`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("planning-replacements-page").waitFor();
      assert.equal(await page.getByTestId("planning-replacement-create").count(), 0);
      console.log("OK e2e-browser: remplacements Préfet + Kabeya lecture seule");
    } finally {
      await browser.close();
    }
  } finally {
    killProcessTree(backend);
    killProcessTree(web);
    await wait(200);
  }
}

async function main() {
  assertSourceGuards();
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    if (process.env.CI) throw new Error("DATABASE_URL obligatoire pour verify:planning-replacements");
    console.log("verify-planning-replacements: SKIP (DATABASE_URL absent)");
    return;
  }
  await runHttp(databaseUrl);
  await runBrowser(databaseUrl);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
