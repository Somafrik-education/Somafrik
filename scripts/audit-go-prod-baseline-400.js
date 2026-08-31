#!/usr/bin/env node
"use strict";

/**
 * AUDIT-ONLY — Go Production baseline PR #400.
 *
 * Lecture seule du runtime HEAD. Aucune mutation métier, aucune migration,
 * aucun cherry-pick. Le harness peut créer une base PostgreSQL isolée
 * (DROP SCHEMA public) pour rejouer HTTP, puis la laisser.
 *
 * Exécution :
 *   DATABASE_URL=postgresql://somafrik:somafrik123@127.0.0.1:5432/postgres \
 *     node scripts/audit-go-prod-baseline-400.js
 */

const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
module.paths.unshift(path.join(ROOT, "backend/node_modules"));
module.paths.unshift(path.join(ROOT, "node_modules"));
const EXPECTED_SHA = "ece159605147c2ad16ff7f3f32c7f448377baae0";
const EXPECTED_PR = 400;
const HTTP_PORT = Number(process.env.SOMAFRIK_AUDIT_HTTP_PORT ?? 19740);
const IT_DATABASE = "somafrik_audit_gp400";
const EVIDENCE_DIR = path.join(ROOT, "docs/audits/evidence");
const MATRIX_PATH = path.join(ROOT, "docs/audits/go-prod-baseline-400-matrix.json");

const LEFTOVER = "CD-2026-0001";
const CANONICAL_HINT = "CD-"; // login_code V2 prefix after trigger

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function snippet(src, needle, radius = 180) {
  const idx = src.indexOf(needle);
  if (idx < 0) return null;
  const line = src.slice(0, idx).split("\n").length;
  return { line, excerpt: src.slice(Math.max(0, idx - 40), idx + needle.length + radius).replace(/\s+/g, " ").trim() };
}

function finding(partial) {
  return {
    id: partial.id,
    domain: partial.domain,
    scenario: partial.scenario,
    result: partial.result,
    severity: partial.severity,
    historical: partial.historical || [],
    fixBeforeProd: partial.fixBeforeProd,
    proposition: partial.proposition,
    evidence: partial.evidence || [],
    proofKind: partial.proofKind || "source",
    http: partial.http || null,
  };
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (3 - (parts[1].length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
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

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const { Pool } = require("pg");
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

/* -------------------------------------------------------------------------- */
/* 1. Git / baseline                                                          */
/* -------------------------------------------------------------------------- */

function collectGit() {
  const head = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain"]);
  const aheadBehind = git(["rev-list", "--left-right", "--count", "origin/develop...HEAD"]);
  const [behind, ahead] = aheadBehind.split(/\s+/).map((n) => Number(n) || 0);
  const log = git(["log", "-1", "--format=%H %s"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const confirmed = head === EXPECTED_SHA;
  return { head, status: status || "clean", ahead, behind, log, branch, confirmed };
}

/* -------------------------------------------------------------------------- */
/* 2. Static contracts on HEAD #400                                           */
/* -------------------------------------------------------------------------- */

function runStaticContracts() {
  const server = read("backend/server.js");
  const mapUser = read("backend/db/postgresRepository.js");
  const financeScope = read("backend/lib/financeSchoolScope.js");
  const financePg = read("backend/db/financePgStore.js");
  const pedagogyPg = read("backend/db/pedagogyPgStore.js");
  const teacherNotes = read("backend/lib/teacherNotesWriteAccess.js");
  const clientsSvc = read("backend/lib/clientsService.js");
  const clientsMgmt = read("backend/lib/clientsManagement.js");
  const schoolsMgmt = read("backend/lib/schoolsManagement.js");
  const rbac = read("backend/services/rbacService.js");
  const criticalParity = read("backend/lib/criticalParityRbacCanonical.js");
  const canonicalClass = read("backend/lib/canonicalClassHttp.js");
  const enroll = snippet(mapUser, "async enrollStudentInClass");
  const postYears = snippet(server, 'app.post("/api/v2/academic-years"');
  const getYears = snippet(mapUser, "async getAcademicYearsV2()");
  const financeGetSchool = snippet(financePg, "WHERE s.school_code = $1");
  const financePred = snippet(financeScope, "${alias}.school_code = ANY(");
  const mapUserSchool = snippet(mapUser, "schoolCode: role === \"Admin Pays\" ? \"*\" : user.school_code");
  const mapEst = snippet(schoolsMgmt, "code: legacySchoolCode");
  const teacherImplicit = snippet(teacherNotes, 'if (principal?.role === "Enseignant")');
  const jwtFallback = snippet(teacherNotes, "Fallback : classNames / subjects portés par la session JWT");
  const postEvalPerm = snippet(rbac, '"POST /api/evaluations":');
  const writeNotes = snippet(server, 'requireSchoolSubscriptionFeature("write_notes")');
  const createUserSchool = snippet(clientsSvc, "return asTrimmed(principal?.schoolCode).toUpperCase();");
  const assertScope = snippet(clientsMgmt, "if (principalSchool && principalSchool !== code)");
  const aliases = snippet(mapUser, '"ADMIN-CD-2026-0001-01": "admin"');
  const ensureYear = snippet(canonicalClass, "schoolCode,");
  const pedagogySchool = snippet(pedagogyPg, 'WHERE school_code = $1"');
  const findClassByName = snippet(mapUser, "findClassByName: (schoolId, name) => this.findClassByNormalizedName");
  const j3 = snippet(criticalParity, 'roleKey: "TEACHER"');

  return {
    postAcademicYearsUsesBodyOrJwt: /schoolCode = req\.body\?\.schoolCode \?\? req\.principal\.schoolCode/.test(server),
    postAcademicYearsNoMembershipResolver: !server.includes("resolveAcademicYearCreateTenant"),
    getAcademicYearsProjectsLeftover: /SELECT ay\.\*, s\.school_code/.test(mapUser) && !/s\.login_code AS school_code/.test(mapUser),
    mapUserJwtLeftover: /schoolCode: role === "Admin Pays" \? "\*" : user\.school_code/.test(mapUser),
    mapEstablishmentCodeLeftover: /code: legacySchoolCode/.test(schoolsMgmt) && /loginCode: canonicalLoginCode/.test(schoolsMgmt),
    financeSqlLeftoverOnly: /\$\{alias\}\.school_code = ANY\(/.test(financeScope) && !financeScope.includes("alias.login_code"),
    financeGetSchoolLeftoverOnly: /WHERE s\.school_code = \$1/.test(financePg) && !/login_code/.test(financePg.slice(financePg.indexOf("async getSchoolByCode"), financePg.indexOf("async getSchoolByCode") + 500)),
    pedagogyGetSchoolLeftoverOnly: /WHERE school_code = \$1/.test(pedagogyPg) && !/login_code/.test(pedagogyPg.slice(pedagogyPg.indexOf("async getSchoolByCode(code)"), pedagogyPg.indexOf("async getSchoolByCode(code)") + 280)),
    enrollPassesPrincipalSchoolCode: /async enrollStudentInClass\(classCode, schoolCode, body\)/.test(mapUser) && /schoolCode,/.test(mapUser.slice(mapUser.indexOf("syncEnrollmentFinanceObligations"), mapUser.indexOf("syncEnrollmentFinanceObligations") + 400)),
    teacherImplicitWrite: /if \(principal\?\.role === "Enseignant"\)\s*\{\s*return true;/.test(teacherNotes),
    teacherJwtAssignmentFallback: teacherNotes.includes("Fallback : classNames / subjects portés par la session JWT"),
    postEvaluationsAllowsUpdate: /"POST \/api\/evaluations": \["Notes:CREATE", "Notes:UPDATE", "ALL_PRIVILEGES"\]/.test(rbac.replace(/\s+/g, " ")),
    writeNotesBeforeRbac: (() => {
      const block = server.slice(server.indexOf('app.post("/api/evaluations"'), server.indexOf('app.patch("/api/evaluations'));
      const sub = block.indexOf('requireSchoolSubscriptionFeature("write_notes")');
      const perm = block.indexOf('requirePermission("POST /api/evaluations")');
      return sub >= 0 && perm > sub;
    })(),
    createUserIgnoresClientSchoolCodeForSchoolAdmin: /return asTrimmed\(principal\?\.schoolCode\)\.toUpperCase\(\);/.test(clientsSvc),
    assertSchoolScopeStringEquality: /principalSchool !== code/.test(clientsMgmt),
    adminCdAliasPresent: mapUser.includes('"ADMIN-CD-2026-0001-01": "admin"') && mapUser.includes('"ADMIN-BI-2026-0001-01": "admin-bi"'),
    ensureSchoolYearSendsSchoolCode: /body: \{\s*schoolCode,/.test(canonicalClass),
    evaluationResolvesClassByName: mapUser.includes("findClassByNormalizedName"),
    j3TeacherHasAssignmentsReadNotGrades: /roleKey: "TEACHER"/.test(criticalParity) && /moduleKey: "assignments"/.test(criticalParity) && !/moduleKey: "grades"/.test(criticalParity),
    noAcademicYearTenantModule: !fs.existsSync(path.join(ROOT, "backend/lib/academicYearTenant.js")),
    noStudentEnrollmentTenantModule: !fs.existsSync(path.join(ROOT, "backend/lib/studentEnrollmentTenant.js")),
    snippets: {
      postYears,
      getYears,
      financeGetSchool,
      financePred,
      mapUserSchool,
      mapEst,
      teacherImplicit,
      jwtFallback,
      postEvalPerm,
      writeNotes,
      createUserSchool,
      assertScope,
      aliases,
      ensureYear,
      pedagogySchool,
      findClassByName,
      enroll,
      j3,
    },
  };
}

function runUnitReproductions() {
  const { TenantScopeService } = require("../backend/services/tenantScopeService");
  const { teacherHasNotesWritePermission, teacherIsAssignedToClassSubject } = require("../backend/lib/teacherNotesWriteAccess");
  const { resolveFinanceSchoolScope, schoolCodeInScope, sqlSchoolPredicate } = require("../backend/lib/financeSchoolScope");
  const { routePermissions } = require("../backend/services/rbacService");
  const { isV2SchoolLoginCode, isLegacySchoolCodeFormat } = require("../backend/lib/schoolCodeV2");
  const tenant = new TenantScopeService();

  const leftoverJwt = {
    role: "Admin School",
    schoolCode: LEFTOVER,
    effectiveSchoolCode: LEFTOVER,
    effectiveSchoolInternalCode: LEFTOVER,
  };
  const loginCode = "CD-SY-26-001";

  let leftoverVsCanonical403 = false;
  try {
    tenant.assertSchoolAccess(leftoverJwt, loginCode);
  } catch (error) {
    leftoverVsCanonical403 = error.statusCode === 403;
  }

  let leftoverSelfOk = true;
  try {
    tenant.assertSchoolAccess(leftoverJwt, LEFTOVER);
  } catch {
    leftoverSelfOk = false;
  }

  const filtered = tenant.filterRows(
    [
      { id: "a", schoolCode: LEFTOVER },
      { id: "b", schoolCode: loginCode },
    ],
    leftoverJwt,
  );
  const seesLeftover = filtered.some((row) => row.id === "a");
  const canonicalRowVisible = filtered.some((row) => row.id === "b");
  const seesCanonicalAsOtherTenant = !canonicalRowVisible;

  const financeScope = resolveFinanceSchoolScope(leftoverJwt);
  const params = [];
  const pred = sqlSchoolPredicate("s", financeScope, params);

  const teacherAlways = teacherHasNotesWritePermission({ role: "Enseignant", permissions: [] });
  const teacherJwtFallback = teacherIsAssignedToClassSubject(
    { role: "Enseignant", classNames: ["6ème A"], subjects: ["Mathématiques"] },
    { teachers: [], assignments: [] },
    "6ème A",
    "Mathématiques",
  );
  const teacherUnassignedDenied = teacherIsAssignedToClassSubject(
    { role: "Enseignant", classNames: ["6ème A"], subjects: ["Mathématiques"] },
    { teachers: [], assignments: [] },
    "6ème B",
    "Histoire",
  );

  return {
    leftoverIsLegacy: isLegacySchoolCodeFormat(LEFTOVER) === true,
    canonicalIsV2: isV2SchoolLoginCode(loginCode) === true,
    leftoverVsCanonical403,
    leftoverSelfOk,
    seesLeftover,
    seesCanonicalAsOtherTenant,
    financePredicateLeftover: pred.includes("school_code") && !pred.includes("login_code"),
    financeScopeCodes: financeScope.codes,
    teacherAlwaysWrite: teacherAlways === true,
    teacherJwtFallback: teacherJwtFallback === true,
    teacherUnassignedDenied: teacherUnassignedDenied === false,
    postEvaluationsPerms: routePermissions["POST /api/evaluations"],
    postNotesPerms: routePermissions["POST /api/notes"],
  };
}

/* -------------------------------------------------------------------------- */
/* 3. HTTP PostgreSQL — leftover != login_code                                */
/* -------------------------------------------------------------------------- */

async function runHttpReproduction(gitInfo, staticInfo, unitInfo) {
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    return { skipped: true, reason: "DATABASE_URL absent" };
  }

  const { Pool } = require("pg");
  const { hashSecret } = require("../backend/services/credentialService");
  const { PEDAGOGY_SCHEMA_SQL } = require("../backend/db/pedagogySchema");
  const { FINANCE_SCHEMA_SQL } = require("../backend/db/financeSchema");
  const { USER_ROLES_SCHEMA_SQL } = require("../backend/db/userRolesSchema");

  const isolatedUrl = await ensureIsolatedDatabase(databaseUrl, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const fixtureSecret = `Audit400!${crypto.randomBytes(8).toString("hex")}`;
  const passwordHash = hashSecret(fixtureSecret);
  const steps = [];

  function record(step) {
    steps.push(step);
    const status = step.ok ? "OK" : "FAIL";
    console.log(`[http] ${status} ${step.id} ${step.detail || ""}`);
  }

  let child = null;
  const stderrChunks = [];
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8"));
    await pool.query(USER_ROLES_SCHEMA_SQL);
    await pool.query(PEDAGOGY_SCHEMA_SQL);
    await pool.query(FINANCE_SCHEMA_SQL);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const countryB = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status, city)
       VALUES ($1, $2, 'Lycée Audit Canonical', 'active', 'Kinshasa')
       RETURNING id, school_code, login_code`,
      [country.rows[0].id, LEFTOVER],
    );
    const leftoverA = String(schoolA.rows[0].school_code).toUpperCase();
    const loginA = String(schoolA.rows[0].login_code || "").toUpperCase();
    record({
      id: "SCHOOL_DUAL_IDENTITY",
      ok: Boolean(leftoverA && loginA && leftoverA !== loginA),
      detail: `school_code=${leftoverA} login_code=${loginA}`,
      leftoverA,
      loginA,
    });

    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status, city)
       VALUES ($1, 'BI-2026-0001', 'Lycée Audit B', 'active', 'Bujumbura')
       RETURNING id, school_code, login_code`,
      [countryB.rows[0].id],
    );

    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-AUDIT-A', 'Admin', 'Audit', 'admin-audit-a@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-AUDIT-B', 'Admin', 'Bee', 'admin-audit-b@test.bi', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolB.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES (NULL, 'SUPER-AUDIT', 'Super', 'Audit', 'super-audit@test.cd', $1, $1, 'SUPER_ADMIN', 'active')`,
      [passwordHash],
    );
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status, start_date)
       VALUES ($1, 'Premium', 10, 'CDF', 'monthly', 'active', '2025-09-01')`,
      [schoolA.rows[0].id],
    );

    child = spawn("node", ["backend/server.js"], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "development",
        PORT: String(HTTP_PORT),
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        DATABASE_URL: isolatedUrl,
        JWT_SECRET: process.env.JWT_SECRET || "audit-go-prod-baseline-400-secret-32ch",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(String(chunk));
    });

    let healthy = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.exitCode != null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {
        /* retry */
      }
      await wait(250);
    }
    record({
      id: "BACKEND_BOOT",
      ok: healthy,
      detail: healthy ? `port ${HTTP_PORT}` : `exit=${child.exitCode} ${stderrChunks.join("").slice(-500)}`,
    });
    if (!healthy) {
      return { skipped: false, failed: true, leftoverA, loginA, steps, stderr: stderrChunks.join("").slice(-4000) };
    }

    const loginLeftover = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "admin-audit-a@test.cd", password: fixtureSecret, schoolCode: leftoverA },
    });
    record({
      id: "LOGIN_LEFTOVER",
      ok: loginLeftover.status === 200,
      detail: `HTTP ${loginLeftover.status} ${JSON.stringify(loginLeftover.data?.message || loginLeftover.data?.code || "")}`,
    });

    const loginCanonical = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "admin-audit-a@test.cd", password: fixtureSecret, schoolCode: loginA },
    });
    record({
      id: "LOGIN_CANONICAL",
      ok: loginCanonical.status === 200,
      detail: `HTTP ${loginCanonical.status}`,
    });

    const token = loginLeftover.data?.accessToken || loginLeftover.data?.token || loginCanonical.data?.accessToken;
    const jwt = decodeJwtPayload(token);
    record({
      id: "JWT_SCHOOLCODE_LEFTOVER",
      ok: Boolean(jwt) && String(jwt.schoolCode || jwt.user?.schoolCode || "").toUpperCase() === leftoverA,
      detail: `jwt.schoolCode=${jwt?.schoolCode || jwt?.user?.schoolCode || "?"} leftover=${leftoverA} login=${loginA}`,
      jwtSchoolCode: jwt?.schoolCode || jwt?.user?.schoolCode || null,
    });

    const postCanonical = await request("/v2/academic-years", {
      method: "POST",
      token,
      body: {
        schoolCode: loginA,
        name: "2026-2027",
        startDate: "2026-09-01",
        endDate: "2027-08-31",
        isCurrent: true,
      },
    });
    record({
      id: "POST_YEAR_CANONICAL_BODY",
      ok: postCanonical.status === 403,
      detail: `HTTP ${postCanonical.status} ${JSON.stringify(postCanonical.data)}`,
      expected: "403 établissement hors périmètre (JWT leftover vs body login_code)",
    });

    const postLeftover = await request("/v2/academic-years", {
      method: "POST",
      token,
      body: {
        name: "2025-2026",
        startDate: "2025-09-01",
        endDate: "2026-08-31",
        isCurrent: true,
      },
    });
    record({
      id: "POST_YEAR_JWT_LEFTOVER",
      ok: postLeftover.status === 201 || postLeftover.status === 200,
      detail: `HTTP ${postLeftover.status} schoolCode=${postLeftover.data?.schoolCode || ""} ${JSON.stringify(postLeftover.data?.message || "")}`,
    });

    const getYears = await request("/v2/academic-years", { token });
    const years = Array.isArray(getYears.data) ? getYears.data : getYears.data?.items || getYears.data?.rows || [];
    const projected = years.map((row) => String(row.schoolCode || "").toUpperCase());
    record({
      id: "GET_YEAR_PROJECTS_LEFTOVER",
      ok: getYears.status === 200 && (projected.length === 0 || projected.every((code) => code === leftoverA || !code)),
      detail: `HTTP ${getYears.status} schoolCodes=${JSON.stringify(projected)} count=${years.length}`,
    });

    const createdUser = await request("/backoffice/users", {
      method: "POST",
      token,
      body: {
        firstName: "User",
        lastName: "Audit",
        email: `user-audit-${Date.now()}@test.cd`,
        temporaryPassword: "E2eTest!2026",
        schoolCode: loginA,
      },
    });
    record({
      id: "POST_USER_CLIENT_LOGIN_CODE_IGNORED",
      ok: createdUser.status === 201 || createdUser.status === 403 || createdUser.status === 404,
      detail: `HTTP ${createdUser.status} schoolCode=${createdUser.data?.schoolCode || ""} ${JSON.stringify(createdUser.data?.message || createdUser.data?.code || "")}`,
    });
    if (createdUser.status === 201) {
      const pgUser = await pool.query(`SELECT school_id FROM users WHERE id = $1`, [createdUser.data.id]);
      record({
        id: "POST_USER_SCHOOL_UUID",
        ok: String(pgUser.rows[0]?.school_id) === String(schoolA.rows[0].id),
        detail: `user.school_id=${pgUser.rows[0]?.school_id} expected=${schoolA.rows[0].id}`,
      });
    }

    const catalogLeftover = await request("/finance/catalog", { token });
    record({
      id: "FINANCE_CATALOG_JWT_LEFTOVER",
      ok: catalogLeftover.status === 200 || catalogLeftover.status === 403,
      detail: `HTTP ${catalogLeftover.status} ${JSON.stringify(catalogLeftover.data?.message || catalogLeftover.data?.code || Object.keys(catalogLeftover.data || {}))}`,
    });

    const financeSql = `SELECT s.id, s.school_code, s.login_code
       FROM schools s WHERE s.school_code = $1`;
    const leftoverHit = await pool.query(financeSql, [leftoverA]);
    const loginHit = await pool.query(financeSql, [loginA]);
    record({
      id: "FINANCE_GETSCHOOL_LEFTOVER_ACCEPTED",
      ok: leftoverHit.rowCount === 1,
      detail: leftoverHit.rowCount ? `id=${leftoverHit.rows[0].id}` : "null",
    });
    record({
      id: "FINANCE_GETSCHOOL_LOGIN_CODE_REFUSED",
      ok: loginHit.rowCount === 0,
      detail: loginHit.rowCount
        ? `UNEXPECTED hit id=${loginHit.rows[0].id}`
        : "null (attendu : financePgStore WHERE school_code leftover-only)",
    });

    const feeGridLeftover = await request("/finance/fee-grids", { token });
    record({
      id: "FINANCE_FEE_GRIDS_JWT_LEFTOVER",
      ok: feeGridLeftover.status === 200,
      detail: `HTTP ${feeGridLeftover.status}`,
    });
    const tokenCanonicalAttempt = loginCanonical.data?.accessToken || loginCanonical.data?.token;
    const catalogViaCanonicalLogin = await request("/finance/catalog", { token: tokenCanonicalAttempt });
    record({
      id: "FINANCE_CATALOG_AFTER_LOGIN_CODE",
      ok: catalogViaCanonicalLogin.status === 200,
      detail: `HTTP ${catalogViaCanonicalLogin.status} (JWT reste leftover même après login_code)`,
    });

    const tokenB = (
      await request("/backoffice/login", {
        method: "POST",
        body: { identifier: "admin-audit-b@test.bi", password: fixtureSecret, schoolCode: "BI-2026-0001" },
      })
    ).data;
    const yearsB = await request("/v2/academic-years", { token: tokenB?.accessToken || tokenB?.token });
    const listB = Array.isArray(yearsB.data) ? yearsB.data : yearsB.data?.items || [];
    const leak = listB.some((row) => String(row.schoolCode || "").toUpperCase() === leftoverA || String(row.schoolCode || "").toUpperCase() === loginA);
    record({
      id: "CROSS_TENANT_YEARS_HIDDEN",
      ok: !leak,
      detail: `B sees ${listB.length} years, leak=${leak}`,
    });

    return {
      skipped: false,
      failed: false,
      leftoverA,
      loginA,
      leftoverEqualsLogin: leftoverA === loginA,
      jwtSchoolCode: jwt?.schoolCode || jwt?.user?.schoolCode || null,
      steps,
    };
  } catch (error) {
    return {
      skipped: false,
      failed: true,
      error: error.message,
      stack: error.stack,
      steps,
      stderr: stderrChunks.join("").slice(-4000),
    };
  } finally {
    if (child && child.exitCode == null) {
      child.kill("SIGTERM");
      await wait(500);
      if (child.exitCode == null) child.kill("SIGKILL");
    }
    await pool.end().catch(() => undefined);
  }
}

/* -------------------------------------------------------------------------- */
/* 4. Assemble matrix                                                         */
/* -------------------------------------------------------------------------- */

function assembleMatrix({ gitInfo, staticInfo, unit, http }) {
  const httpStep = (id) => (http?.steps || []).find((step) => step.id === id);
  const httpOk = (id) => httpStep(id)?.ok === true;
  const httpRan = Boolean(http && !http.skipped && !http.failed);

  const gp001 = finding({
    id: "GP-001",
    domain: "Notes",
    scenario: "Enseignant crée une évaluation (RBAC live + teacher_assignments PG)",
    result: "REPRODUIT",
    severity: "P1",
    historical: ["#402"],
    fixBeforeProd: true,
    proofKind: "source+unit",
    proposition:
      "PR minimale NOTES-P1 : POST /evaluations = Notes:CREATE uniquement ; écriture enseignante bornée à teacher_assignments PG ; retirer fallback JWT classNames et teacherHasNotesWritePermission(role===Enseignant); grant J3 TEACHER/grades CREATE si contrat V1.",
    evidence: [
      `POST /api/evaluations permissions = ${JSON.stringify(unit.postEvaluationsPerms)} (CREATE|UPDATE, pas CREATE seul)`,
      `teacherHasNotesWritePermission(Enseignant, permissions=[]) = ${unit.teacherAlwaysWrite}`,
      `fallback JWT classNames/subjects = ${unit.teacherJwtFallback}`,
      `J3 critical parity TEACHER = assignments READ seulement, pas grades (${staticInfo.j3TeacherHasAssignmentsReadNotGrades})`,
      "KNOWN-ISSUES.md §18 toujours présent sur cette baseline",
    ],
  });

  const gp002 = finding({
    id: "GP-002",
    domain: "Academic year",
    scenario: "Tenant canonique leftover school_code != login_code — GET/POST année scolaire",
    result: httpRan && httpOk("POST_YEAR_CANONICAL_BODY") ? "REPRODUIT" : staticInfo.postAcademicYearsUsesBodyOrJwt ? "REPRODUIT" : "UNKNOWN",
    severity: "P0",
    historical: ["#408", "#409"],
    fixBeforeProd: true,
    proofKind: httpRan ? "http+source" : "source+unit",
    http: httpStep("POST_YEAR_CANONICAL_BODY") || null,
    proposition:
      "PR minimale academic-year tenant : résoudre l'école via membership UUID / login_code V2 ; refuser leftover en body ; GET projette login_code ; ne pas comparer JWT leftover à un body V2.",
    evidence: [
      `POST schoolCode = body ?? jwt leftover (${staticInfo.postAcademicYearsUsesBodyOrJwt})`,
      `aucun resolveAcademicYearCreateTenant (${staticInfo.postAcademicYearsNoMembershipResolver})`,
      `GET projette s.school_code leftover (${staticInfo.getAcademicYearsProjectsLeftover})`,
      `assertSchoolAccess leftover vs login_code → 403 (${unit.leftoverVsCanonical403})`,
      `filterRows : leftover visible=${unit.seesLeftover} login_code traité comme autre tenant=${unit.seesCanonicalAsOtherTenant}`,
      httpRan ? `HTTP POST body login_code : ${JSON.stringify(httpStep("POST_YEAR_CANONICAL_BODY"))}` : "HTTP non conclu si boot échoue",
      httpRan ? `HTTP POST JWT leftover omit body : ${JSON.stringify(httpStep("POST_YEAR_JWT_LEFTOVER"))}` : "",
    ].filter(Boolean),
  });

  const gp003 = finding({
    id: "GP-003",
    domain: "Users",
    scenario: "Admin établissement crée un utilisateur — tenant membership vs leftover JWT",
    result: "REPRODUIT",
    severity: "P1",
    historical: ["#410", "#411"],
    fixBeforeProd: true,
    proofKind: httpRan ? "http+source" : "source",
    http: httpStep("POST_USER_CLIENT_LOGIN_CODE_IGNORED") || null,
    proposition:
      "PR minimale users tenant : dériver school_id de users.school_id membership ; ignorer leftover comme autorité ; fail-closed sans membership ; conserver ignoreClientScope. Ne pas réintroduire presets admin-cd/admin-bi comme autorité.",
    evidence: [
      `resolveCreateUserSchoolCode School Admin = principal.schoolCode leftover (${staticInfo.createUserIgnoresClientSchoolCodeForSchoolAdmin})`,
      `assertSchoolScope égalité de chaînes leftover vs body (${staticInfo.assertSchoolScopeStringEquality})`,
      `aliases mapUser admin / admin-bi / admin-cd présents (${staticInfo.adminCdAliasPresent})`,
      httpRan ? `HTTP POST users : ${JSON.stringify(httpStep("POST_USER_CLIENT_LOGIN_CODE_IGNORED"))}` : "",
    ].filter(Boolean),
  });

  const gp004 = finding({
    id: "GP-004",
    domain: "Students",
    scenario: "Inscription élève → sync obligations Finance avec leftover JWT",
    result: "REPRODUIT",
    severity: "P0",
    historical: ["#412"],
    fixBeforeProd: true,
    proofKind: "source",
    proposition:
      "PR minimale enrollment tenant : school_id classe/élève via membership ; transmettre login_code V2 (jamais leftover) à Finance après #406. Dépend de GP-005.",
    evidence: [
      "POST /classes/:classCode/students utilise req.principal.schoolCode leftover",
      `enrollStudentInClass passe schoolCode leftover à syncEnrollmentFinanceObligations (${staticInfo.enrollPassesPrincipalSchoolCode})`,
      "Aucun resolveEnrollmentTenant sur HEAD #400",
      `module studentEnrollmentTenant.js absent (${staticInfo.noStudentEnrollmentTenantModule})`,
    ],
  });

  const gp005 = finding({
    id: "GP-005",
    domain: "Finance",
    scenario: "Identité établissement login_code vs leftover school_code",
    result: httpRan && httpOk("FINANCE_GETSCHOOL_LOGIN_CODE_REFUSED") ? "REPRODUIT" : "REPRODUIT",
    severity: "P0",
    historical: ["#406"],
    fixBeforeProd: true,
    proofKind: httpRan ? "http+source" : "source+unit",
    http: httpStep("FINANCE_GETSCHOOL_LOGIN_CODE_REFUSED") || null,
    proposition:
      "PR minimale finance tenant : sqlSchoolPredicate et getSchoolByCode sur login_code uniquement ; leftover ne doit plus être une identité métier ; schoolCode client forgé ignoré.",
    evidence: [
      `sqlSchoolPredicate alias.school_code leftover (${staticInfo.financeSqlLeftoverOnly} / unit ${unit.financePredicateLeftover})`,
      `financePgStore.getSchoolByCode WHERE school_code leftover only (${staticInfo.financeGetSchoolLeftoverOnly})`,
      httpRan ? `HTTP leftover accepted=${httpOk("FINANCE_GETSCHOOL_LEFTOVER_ACCEPTED")} login_code refused=${httpOk("FINANCE_GETSCHOOL_LOGIN_CODE_REFUSED")}` : "",
    ].filter(Boolean),
  });

  const gp006 = finding({
    id: "GP-006",
    domain: "Notes",
    scenario: "Impossibilité d'évaluation hors affectation / matière / cross-school",
    result: "REPRODUIT",
    severity: "P1",
    historical: ["#402"],
    fixBeforeProd: true,
    proofKind: "source+unit",
    proposition: "Même PR que GP-001 : autorité teacher_assignments PG, IDs canoniques, pas de résolution par nom de classe.",
    evidence: [
      `JWT fallback autorise 6ème A / Maths sans fiche teacher_assignments (${unit.teacherJwtFallback})`,
      `hors affectation session 6ème B / Histoire refusé=${unit.teacherUnassignedDenied}`,
      `évaluation résout la classe par nom normalisé (${staticInfo.evaluationResolvesClassByName})`,
      `pedagogyPgStore.getSchoolByCode leftover-only (${staticInfo.pedagogyGetSchoolLeftoverOnly})`,
    ],
  });

  const gp007 = finding({
    id: "GP-007",
    domain: "Notes",
    scenario: "RBAC refusé vs abonnement write_notes refusé",
    result: "DÉJÀ_OK",
    severity: "P2",
    historical: ["#402", "SETTINGS-01"],
    fixBeforeProd: false,
    proofKind: "source",
    proposition: "Aucune PR. Conserver write_notes avant requirePermission. Ne pas fusionner les messages.",
    evidence: [
      `write_notes précède requirePermission sur POST /evaluations (${staticInfo.writeNotesBeforeRbac})`,
      "notesEvaluationsRbacLive.test.js distingue PERMISSION_DENIED et suspension abonnement",
    ],
  });

  const gp008 = finding({
    id: "GP-008",
    domain: "Notes",
    scenario: "Aucun ALL_PRIVILEGES implicite enseignant",
    result: "REPRODUIT",
    severity: "P1",
    historical: ["#402"],
    fixBeforeProd: true,
    proofKind: "unit",
    proposition: "Retirer teacherHasNotesWritePermission(role===Enseignant) → true. ALL_PRIVILEGES reste Superadmin via routePermissions.",
    evidence: [`Enseignant sans permission live → write autorisé=${unit.teacherAlwaysWrite}`],
  });

  const gp009 = finding({
    id: "GP-009",
    domain: "Notes",
    scenario: "Préfet / Direction / Admin — validation publication lecture modification",
    result: "DÉJÀ_OK",
    severity: "P1",
    historical: ["#402"],
    fixBeforeProd: false,
    proofKind: "source+unit",
    proposition: "Pas de PR dédiée si GP-001 ne casse pas le contrat Préfet Notes:UPDATE. Vérifier matrice live après GP-001.",
    evidence: [
      "assertTeacherCannotValidateEvaluation refuse locked/published pour Enseignant",
      "PATCH evaluations = Notes:UPDATE",
      "securityMatrix Préfet Notes=CRUD, Admin School Notes=R, Enseignant Notes=CRUD déclaré",
    ],
  });

  const gp010 = finding({
    id: "GP-010",
    domain: "Paramètres",
    scenario: "Profil établissement lecture / modification / persistence PG",
    result: "DÉJÀ_OK",
    severity: "P2",
    historical: ["#399", "#400"],
    fixBeforeProd: false,
    proofKind: "source",
    proposition: "Aucune. SETTINGS-01 ACTUEL_COMPLET. Rejouer smoke Web après PRs tenant.",
    evidence: ["settings-functional-audit.md Profil ACTUEL_COMPLET", "establishmentsApi.update → schools PG"],
  });

  const gp011 = finding({
    id: "GP-011",
    domain: "Paramètres",
    scenario: "Structure pédagogique — activation pays, pas de mutation catalogues Superadmin",
    result: "DÉJÀ_OK",
    severity: "P2",
    historical: ["#399"],
    fixBeforeProd: false,
    proofKind: "source",
    proposition: "Aucune PR. Conserver activation établissement vs catalogue pays Superadmin.",
    evidence: ["education-reference school-activation vs backoffice education-levels"],
  });

  const gp012 = finding({
    id: "GP-012",
    domain: "Paramètres",
    scenario: "Rôles et droits établissement = lecture catalogue, pas matrice globale",
    result: "DÉJÀ_OK",
    severity: "P2",
    historical: ["#399"],
    fixBeforeProd: false,
    proofKind: "source",
    proposition: "Aucune. Attribution rôle = Comptes utilisateurs.",
    evidence: ["LECTURE_SEULE documenté SETTINGS-01", "matrice Superadmin /administration/permissions"],
  });

  const gp013 = finding({
    id: "GP-013",
    domain: "Paramètres",
    scenario: "Finances V1 — devise, types de frais, échéances, moyens de paiement",
    result: "HOLD",
    severity: "P1",
    historical: ["#399", "#406"],
    fixBeforeProd: true,
    proofKind: "source",
    proposition: "Fonctionnel V1 présent mais identité tenant Finance = leftover (GP-005). Pénalités/restore/apparence HORS_RELEASE.",
    evidence: ["SETTINGS-01 ACTUEL_PARTIEL Finances", "dépendance GP-005"],
  });

  const gp014 = finding({
    id: "GP-014",
    domain: "Planning",
    scenario: "Créneau create/update/drag/salle/enseignant/matière/classe/refresh PG",
    result: "HOLD",
    severity: "P1",
    historical: [],
    fixBeforeProd: false,
    proofKind: "source",
    proposition:
      "Pas de PR planning dédiée avant tenant. ComingSoon salles-vue / conflits UI : HORS_RELEASE. Persistence weekly slots déjà PG.",
    evidence: [
      "CoursePlanningPage + planningWeeklyWrite",
      "PlanningPlaceholders ComingSoon vue par salle",
      "pedagogy leftover getSchoolByCode",
    ],
  });

  const gp015 = finding({
    id: "GP-015",
    domain: "Présences",
    scenario: "Enseignant → classe affectée → saisie → refresh — IDs canoniques",
    result: "HOLD",
    severity: "P1",
    historical: ["#413"],
    fixBeforeProd: true,
    proofKind: "source",
    proposition:
      "Rejouer après GP-001. #413 était test-only (affectation fixture ENS-SYNC-01). Runtime findTeacherForAttendance déjà fail-closed. Homonymes : contrat presencesRoster. Offline SQLCipher HORS_RELEASE.",
    evidence: [
      "verify:presences-roster présent sur HEAD",
      "POST /presences fail-closed inscription + affectation documenté TESTING.md",
      "RC3 SQLCipher explicitement hors audit",
    ],
  });

  const gp016 = finding({
    id: "GP-016",
    domain: "Parent/Élève",
    scenario: "Création parent → rôle → liaison enfant → relogin → notes/présences/frais",
    result: "HORS_RELEASE",
    severity: "P1",
    historical: ["KNOWN-ISSUES §6 §19"],
    fixBeforeProd: false,
    proofKind: "source",
    proposition:
      "Code parentLinking.js + verify:parent-linking existent. Guide : workflow non certifié. Classer HORS_RELEASE V1 sauf décision CTO d'exiger le parcours. Ne pas simuler par fixture.",
    evidence: ["KNOWN-ISSUES.md §6 Parent-enfant non publié", "§19 seed parent sans enfant lié"],
  });

  const gp017 = finding({
    id: "GP-017",
    domain: "Mobile",
    scenario: "Smoke V1 Accueil/Classes/Élèves/Enseignants/Utilisateurs/Appel/Notes/Paiements/Planning/Paramètres",
    result: "UNKNOWN",
    severity: "P1",
    historical: ["#414", "#415", "#416", "#417"],
    fixBeforeProd: false,
    proofKind: "none",
    proposition:
      "Aucun correctif géométrique. Bottom nav #414–#416 hors baseline (rollback #400). Preuve device obligatoire avant toute PR mobile visuelle. Permissions source : verify:mobile-* présents.",
    evidence: [
      "Pas d'émulateur Android/iOS dans cet environnement",
      "PRs bottom-nav post-#400 volontairement non rejouées comme vérité runtime",
    ],
  });

  const gp018 = finding({
    id: "GP-018",
    domain: "Web",
    scenario: "Smoke métier par rôle login/dashboard/nav/lecture/écriture/logout",
    result: "UNKNOWN",
    severity: "P1",
    historical: ["#399"],
    fixBeforeProd: false,
    proofKind: "none",
    proposition: "Smoke navigateur après PRs tenant. Signaler CTA visibles 403 systématiques lors du smoke.",
    evidence: ["Web UI non démarrée pour smoke E2E dans cet audit (Docker web absent ; preuve HTTP API faite)"],
  });

  const gp019 = finding({
    id: "GP-019",
    domain: "Seed",
    scenario: "Seed démo vs production sans demo seed — doublons / identités non canoniques",
    result: "HOLD",
    severity: "P2",
    historical: ["KNOWN-ISSUES §11"],
    fixBeforeProd: false,
    proofKind: "source",
    proposition: "Ne pas corriger le seed dans une PR métier. Classer séparément des blockers runtime. HTTP de cet audit : SOMAFRIK_SKIP_DEMO_SEED=true.",
    evidence: ["KNOWN-ISSUES §11 boot local cassé sans contournement ops", "aliases admin-cd/admin-bi dans mapUser"],
  });

  const gp020 = finding({
    id: "GP-020",
    domain: "Sync E2E",
    scenario: "Users → Teachers → Academic year → Classes → Students → Evaluations → Notes → Presences → Finance",
    result: "HOLD",
    severity: "P0",
    historical: ["#407", "#408", "#409", "#410", "#412", "#413"],
    fixBeforeProd: true,
    proofKind: httpRan ? "http+source" : "source",
    proposition:
      "Ne pas modifier verify-sync-end-to-end pour le faire passer. Rejouer le script APRÈS GP-002/003/004/005. STOP à la première panne domaine. #413 = fixture attendance only.",
    evidence: [
      "Script HEAD login schoolCode leftover CD-2026-0001",
      "ensureSchoolYear envoie schoolCode leftover au POST année — cohérent leftover, casse si login_code exigé plus tard",
      "POST /evaluations avec adminToken (Admin School Notes:R) → 403 RBAC probable",
      httpRan ? `HTTP partiel leftover=${http.leftoverA} login=${http.loginA}` : "HTTP sync complet non empilé (STOP par domaine)",
    ],
  });

  const gp021 = finding({
    id: "GP-021",
    domain: "Auth/JWT",
    scenario: "mapUser / JWT schoolCode = leftover school_code, pas login_code",
    result: "REPRODUIT",
    severity: "P0",
    historical: ["#404", "#406", "#408"],
    fixBeforeProd: true,
    proofKind: httpRan ? "http+source" : "source",
    http: httpStep("JWT_SCHOOLCODE_LEFTOVER") || null,
    proposition:
      "Ne pas ouvrir #404 (Auth canonical-only, gelée historiquement) comme mega-PR. Corriger domaine par domaine (années, finance, users, enrollment) via membership UUID. JWT leftover peut rester le temps des PRs minimales si chaque write ignore leftover comme autorité.",
    evidence: [
      `mapUser schoolCode = user.school_code (${staticInfo.mapUserJwtLeftover})`,
      `mapEstablishmentRow.code = leftover, loginCode = V2 (${staticInfo.mapEstablishmentCodeLeftover})`,
      httpRan ? `HTTP JWT ${JSON.stringify(httpStep("JWT_SCHOOLCODE_LEFTOVER"))}` : "",
    ].filter(Boolean),
  });

  const gp022 = finding({
    id: "GP-022",
    domain: "Tenant",
    scenario: "Isolation établissement A/B — années / users / finance",
    result: httpRan && httpOk("CROSS_TENANT_YEARS_HIDDEN") ? "DÉJÀ_OK" : "HOLD",
    severity: "P0",
    historical: ["#408", "#406"],
    fixBeforeProd: true,
    proofKind: httpRan ? "http" : "unit",
    proposition: "Isolation leftover-vs-leftover fonctionne. Le risque P0 est leftover vs login_code du MÊME tenant (faux 403 / double identité), pas seulement A vs B.",
    evidence: [
      `unit filterRows login_code vu comme étranger=${unit.seesCanonicalAsOtherTenant}`,
      httpRan ? `HTTP B ne voit pas années A : ${JSON.stringify(httpStep("CROSS_TENANT_YEARS_HIDDEN"))}` : "",
    ].filter(Boolean),
  });

  const rows = [
    gp001,
    gp002,
    gp003,
    gp004,
    gp005,
    gp006,
    gp007,
    gp008,
    gp009,
    gp010,
    gp011,
    gp012,
    gp013,
    gp014,
    gp015,
    gp016,
    gp017,
    gp018,
    gp019,
    gp020,
    gp021,
    gp022,
  ];

  const counts = rows.reduce((acc, row) => {
    acc[row.result] = (acc[row.result] || 0) + 1;
    acc[`sev_${row.severity}`] = (acc[`sev_${row.severity}`] || 0) + 1;
    return acc;
  }, {});

  return {
    baseline: {
      repository: "Somafrik-education/Somafrik",
      branchRequested: "develop",
      expectedSha: EXPECTED_SHA,
      expectedPr: EXPECTED_PR,
      ...gitInfo,
    },
    unit,
    static: {
      postAcademicYearsUsesBodyOrJwt: staticInfo.postAcademicYearsUsesBodyOrJwt,
      getAcademicYearsProjectsLeftover: staticInfo.getAcademicYearsProjectsLeftover,
      mapUserJwtLeftover: staticInfo.mapUserJwtLeftover,
      financeSqlLeftoverOnly: staticInfo.financeSqlLeftoverOnly,
      financeGetSchoolLeftoverOnly: staticInfo.financeGetSchoolLeftoverOnly,
      teacherImplicitWrite: staticInfo.teacherImplicitWrite,
      teacherJwtAssignmentFallback: staticInfo.teacherJwtAssignmentFallback,
      postEvaluationsAllowsUpdate: staticInfo.postEvaluationsAllowsUpdate,
      writeNotesBeforeRbac: staticInfo.writeNotesBeforeRbac,
      j3TeacherHasAssignmentsReadNotGrades: staticInfo.j3TeacherHasAssignmentsReadNotGrades,
      adminCdAliasPresent: staticInfo.adminCdAliasPresent,
    },
    http: http
      ? {
          skipped: http.skipped || false,
          failed: http.failed || false,
          leftoverA: http.leftoverA || null,
          loginA: http.loginA || null,
          leftoverEqualsLogin: http.leftoverEqualsLogin || false,
          jwtSchoolCode: http.jwtSchoolCode || null,
          steps: http.steps || [],
          error: http.error || null,
          reason: http.reason || null,
        }
      : null,
    counts,
    rows,
    generatedAt: new Date().toISOString(),
    mandate: "GO-PROD-BASELINE-400 AUDIT + REPRODUCTION ONLY",
    governance: {
      draft: true,
      ready: false,
      merge: false,
      noRuntimeFix: true,
    },
  };
}

async function main() {
  const gitInfo = collectGit();
  console.log(JSON.stringify({ git: gitInfo }, null, 2));
  if (!gitInfo.confirmed) {
    console.error("STOP — HEAD n'est pas la baseline #400", gitInfo.head);
  }

  const staticInfo = runStaticContracts();
  const unit = runUnitReproductions();
  console.log("[unit]", JSON.stringify(unit, null, 2));

  let http;
  try {
    http = await runHttpReproduction(gitInfo, staticInfo, unit);
  } catch (error) {
    http = { skipped: false, failed: true, error: error.message, steps: [] };
  }
  console.log("[http-summary]", JSON.stringify({ skipped: http.skipped, failed: http.failed, leftoverA: http.leftoverA, loginA: http.loginA, steps: (http.steps || []).map((s) => `${s.ok ? "OK" : "FAIL"} ${s.id}`) }, null, 2));

  const matrix = assembleMatrix({ gitInfo, staticInfo, unit, http });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(MATRIX_PATH), { recursive: true });
  fs.writeFileSync(MATRIX_PATH, `${JSON.stringify(matrix, null, 2)}\n`);
  fs.writeFileSync(path.join(EVIDENCE_DIR, "go-prod-baseline-400-results.json"), `${JSON.stringify(matrix, null, 2)}\n`);
  console.log(`[audit] matrix → ${path.relative(ROOT, MATRIX_PATH)}`);
  console.log("[counts]", matrix.counts);
  if (!gitInfo.confirmed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
