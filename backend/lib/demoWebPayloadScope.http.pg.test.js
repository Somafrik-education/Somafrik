"use strict";

/**
 * DEMO-DATA — audit payload réel (seed PostgreSQL + API + scopers Web).
 * Interdit : rows synthétiques déjà alignées. RED = volume PG > 0 qui tombe à 0
 * après mapping API ou après scope Web (classes ou élèves).
 */

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_DEMO_PAYLOAD_SCOPE_IT_DATABASE ?? "somafrik_demo_payload_scope_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_DEMO_PAYLOAD_SCOPE_HTTP_PORT ?? 19961);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";
const EVIDENCE_DIR = path.join(ROOT, "docs/audits/evidence");
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, "demo-web-payload-scope.json");
const APPLY_INPUT = path.join("/tmp", "demo-payload-scope-input.json");
const APPLY_OUTPUT = path.join("/tmp", "demo-payload-scope-output.json");

const LOGIN_CODE = "CD-IN-26-001";
const INTERNAL_CODE = "SCH-BULK-CD-0001";

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

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.rows)) return data.rows;
  if (data && Array.isArray(data.classes)) return data.classes;
  if (data && Array.isArray(data.students)) return data.students;
  if (data && Array.isArray(data.teachers)) return data.teachers;
  if (data && Array.isArray(data.notes)) return data.notes;
  if (data && Array.isArray(data.evaluations)) return data.evaluations;
  if (data && Array.isArray(data.presences)) return data.presences;
  if (data && Array.isArray(data.payments)) return data.payments;
  if (data && Array.isArray(data.assignments)) return data.assignments;
  if (data && Array.isArray(data.courseSchedules)) return data.courseSchedules;
  if (data && Array.isArray(data.users)) return data.users;
  if (data && Array.isArray(data.schools)) return data.schools;
  return [];
}

function decodeJwt(token) {
  const payload = String(token ?? "").split(".")[1];
  if (!payload) return null;
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function identityOf(row) {
  if (!row) return null;
  return {
    id: row.id ?? row.publicId ?? row.classCode ?? null,
    schoolId: row.schoolId ?? row.school_id ?? null,
    schoolCode: row.schoolCode ?? row.school_code ?? row.code ?? null,
    schoolPublicCode: row.schoolPublicCode ?? row.school_login_code ?? row.loginCode ?? row.login_code ?? null,
    loginCode: row.loginCode ?? row.login_code ?? null,
  };
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const next = String(value ?? "").trim();
    if (!next) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

async function discoverSchoolAdminIdentities(pool, schoolId) {
  const result = await pool.query(
    `SELECT u.user_code, u.login_code, u.identity_code, u.email, u.phone, u.role,
            s.school_code, s.login_code AS school_login_code
     FROM users u
     JOIN schools s ON s.id = u.school_id
     WHERE u.school_id = $1 AND u.role = 'SCHOOL_ADMIN'
     ORDER BY u.created_at`,
    [schoolId],
  );
  const identifiers = uniqueNonEmpty([
    "admin",
    ...result.rows.flatMap((row) => [row.user_code, row.login_code, row.identity_code, row.email, row.phone]),
  ]);
  const schoolCodes = uniqueNonEmpty([
    LOGIN_CODE,
    INTERNAL_CODE,
    ...result.rows.flatMap((row) => [row.school_login_code, row.school_code]),
  ]);
  return { rows: result.rows, identifiers, schoolCodes };
}

async function loginDemoSession(discovered) {
  const attempts = [];

  async function tryLogin(kind, body) {
    const pathname = kind === "api" ? "/login" : "/backoffice/login";
    const result = await request(pathname, { method: "POST", body });
    attempts.push({
      kind,
      identifier: body.identifier,
      schoolCode: body.schoolCode,
      status: result.status,
      message: result.data && typeof result.data === "object" ? result.data.message ?? null : String(result.data ?? ""),
    });
    return result;
  }

  // Terrain Démo : demoGateway → POST /api/login (identifier admin, schoolCode CD-IN-26-001, pin).
  for (const schoolCode of discovered.schoolCodes) {
    for (const identifier of discovered.identifiers) {
      const apiLogin = await tryLogin("api", {
        role: "school_admin",
        schoolCode,
        identifier,
        pin: "1234",
      });
      if (apiLogin.status === 200 && apiLogin.data?.accessToken) {
        return { login: apiLogin, attempts, path: "api", identifier, schoolCode };
      }
    }
  }

  for (const schoolCode of discovered.schoolCodes) {
    for (const identifier of discovered.identifiers) {
      const backoffice = await tryLogin("backoffice", {
        identifier,
        password: "1234",
        schoolCode,
      });
      if (backoffice.status === 200 && backoffice.data?.accessToken) {
        return { login: backoffice, attempts, path: "backoffice", identifier, schoolCode };
      }
    }
  }

  return { login: null, attempts, path: null, identifier: null, schoolCode: null };
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 8000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function countOrZero(pool, sql, params) {
  try {
    const result = await pool.query(sql, params);
    return Number(result.rows[0]?.count ?? 0);
  } catch {
    return null;
  }
}

async function firstRowOrNull(pool, sql, params) {
  try {
    const result = await pool.query(sql, params);
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

function dropPoint(raw, mapped, scoped) {
  if (raw > 0 && mapped === 0) return "mapped";
  if (mapped > 0 && scoped === 0) return "scoped";
  if (raw > 0 && scoped === 0) return "scoped";
  return null;
}

function markdownTable(rows) {
  const header = "| domaine | HTTP | raw PG | mapped API | scoped Web | 1er drop | identité 1er row API |";
  const sep = "|---|---:|---:|---:|---:|---|---|";
  const body = rows.map((row) => {
    const ident = row.firstMapped
      ? `schoolId=${row.firstMapped.schoolId ?? "∅"} schoolCode=${row.firstMapped.schoolCode ?? "∅"} public=${row.firstMapped.schoolPublicCode ?? "∅"}`
      : "∅";
    const extra = [row.httpError, row.scopeError].filter(Boolean).join(" / ");
    return `| ${row.domain} | ${row.httpStatus} | ${row.raw} | ${row.mapped} | ${row.scoped} | ${row.drop ?? "—"} | ${ident}${extra ? ` (${extra})` : ""} |`;
  });
  return [header, sep, ...body].join("\n");
}

async function main() {
  if (!DATABASE_URL) {
    console.log("demoWebPayloadScope.http.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: isolatedUrl });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }

  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const repo = createPostgresRepository(isolatedUrl);
  await repo.init();

  const seed = spawnSync(process.execPath, ["backend/scripts/seed-platform-bulk.js", "--fresh"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: isolatedUrl },
  });
  if (seed.stdout) process.stdout.write(seed.stdout);
  if (seed.stderr) process.stderr.write(seed.stderr);
  assert.equal(seed.status, 0, "seed-platform-bulk a échoué");

  const pool = new Pool({ connectionString: isolatedUrl });
  const stderrRef = { value: "" };
  let child = null;

  try {
    const school = await pool.query(
      `SELECT id, school_code, login_code
       FROM schools
       WHERE UPPER(COALESCE(login_code, '')) = $1
          OR school_code = $2
       ORDER BY CASE WHEN UPPER(COALESCE(login_code, '')) = $1 THEN 0 ELSE 1 END
       LIMIT 1`,
      [LOGIN_CODE, INTERNAL_CODE],
    );
    assert.ok(school.rowCount, "école démo CD-IN-26-001 / SCH-BULK-CD-0001 introuvable après seed");
    const schoolId = school.rows[0].id;
    const pgSchool = school.rows[0];

    const raw = {
      schools: await countOrZero(pool, "SELECT COUNT(*)::int AS count FROM schools"),
      users: await countOrZero(pool, "SELECT COUNT(*)::int AS count FROM users WHERE school_id = $1", [schoolId]),
      userRoles: await countOrZero(
        pool,
        `SELECT COUNT(*)::int AS count
         FROM user_roles ur
         WHERE ur.school_id = $1 AND ur.status = 'active' AND ur.revoked_at IS NULL`,
        [schoolId],
      ),
      students: await countOrZero(pool, "SELECT COUNT(*)::int AS count FROM students WHERE school_id = $1", [schoolId]),
      classes: await countOrZero(pool, "SELECT COUNT(*)::int AS count FROM classes WHERE school_id = $1", [schoolId]),
      teachers: await countOrZero(pool, "SELECT COUNT(*)::int AS count FROM teachers WHERE school_id = $1", [schoolId]),
      notes: await countOrZero(pool, "SELECT COUNT(*)::int AS count FROM grades WHERE school_id = $1", [schoolId]),
      evaluations: await countOrZero(pool, "SELECT COUNT(*)::int AS count FROM evaluations WHERE school_id = $1", [schoolId]),
      presences: await countOrZero(pool, "SELECT COUNT(*)::int AS count FROM attendance WHERE school_id = $1", [schoolId]),
      payments: await countOrZero(pool, "SELECT COUNT(*)::int AS count FROM payments WHERE school_id = $1", [schoolId]),
      assignments: await countOrZero(
        pool,
        "SELECT COUNT(*)::int AS count FROM teacher_assignments WHERE school_id = $1",
        [schoolId],
      ),
      courseSchedules: await countOrZero(
        pool,
        `SELECT COUNT(*)::int AS count
         FROM jsonb_array_elements(COALESCE((SELECT state_payload->'courseSchedules' FROM backoffice_state WHERE state_key = 'default'), '[]'::jsonb))
         item
         WHERE UPPER(COALESCE(item->>'schoolCode', '')) IN ($1, $2)`,
        [String(pgSchool.school_code).toUpperCase(), String(pgSchool.login_code ?? "").toUpperCase()],
      ),
    };

    const rawFirst = {
      students: identityOf(
        await firstRowOrNull(
          pool,
          `SELECT st.school_id, s.school_code, s.login_code AS school_login_code
           FROM students st JOIN schools s ON s.id = st.school_id
           WHERE st.school_id = $1 LIMIT 1`,
          [schoolId],
        ),
      ),
      classes: identityOf(
        await firstRowOrNull(
          pool,
          `SELECT cl.school_id, s.school_code, s.login_code AS school_login_code
           FROM classes cl JOIN schools s ON s.id = cl.school_id
           WHERE cl.school_id = $1 LIMIT 1`,
          [schoolId],
        ),
      ),
      teachers: identityOf(
        await firstRowOrNull(
          pool,
          `SELECT t.school_id, s.school_code, s.login_code AS school_login_code
           FROM teachers t JOIN schools s ON s.id = t.school_id
           WHERE t.school_id = $1 LIMIT 1`,
          [schoolId],
        ),
      ),
      users: identityOf(
        await firstRowOrNull(
          pool,
          `SELECT u.school_id, s.school_code, s.login_code AS school_login_code, u.login_code
           FROM users u JOIN schools s ON s.id = u.school_id
           WHERE u.school_id = $1 LIMIT 1`,
          [schoolId],
        ),
      ),
    };

    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(HTTP_PORT),
        DATABASE_URL: isolatedUrl,
        JWT_SECRET,
        NODE_ENV: "test",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.on("data", (chunk) => {
      stderrRef.value += String(chunk);
    });
    await waitForHealth(child, stderrRef);

    const discovered = await discoverSchoolAdminIdentities(pool, schoolId);
    const logged = await loginDemoSession(discovered);
    const adminAttempt = logged.attempts.find(
      (row) => row.identifier === "admin" && row.schoolCode === LOGIN_CODE,
    );
    assert.ok(
      logged.login?.status === 200 && logged.login.data?.accessToken,
      `aucun login SCHOOL_ADMIN n'a abouti (admin/${LOGIN_CODE} status=${adminAttempt?.status ?? "∅"} message=${adminAttempt?.message ?? "∅"}) ; tentatives=${JSON.stringify(logged.attempts)} ; identifiants PG=${JSON.stringify(discovered.identifiers)}`,
    );
    const login = logged.login;
    const token = login.data.accessToken;
    const jwt = decodeJwt(token);
    const sessionUser = login.data.user;
    const schoolContext = login.data.schoolContext ?? login.data.school ?? {};

    const membershipCode = String(sessionUser?.schoolCode ?? INTERNAL_CODE).trim();
    const schoolPaths = uniqueNonEmpty([membershipCode, LOGIN_CODE, INTERNAL_CODE]);
    let schoolsPath = `/backoffice/establishments/${encodeURIComponent(schoolPaths[0])}`;
    for (const code of schoolPaths) {
      const probe = await request(`/backoffice/establishments/${encodeURIComponent(code)}`, { token });
      if (probe.status === 200) {
        schoolsPath = `/backoffice/establishments/${encodeURIComponent(code)}`;
        break;
      }
    }

    const endpoints = {
      schools: schoolsPath,
      users: "/backoffice/users",
      students: "/students",
      classes: "/classes",
      teachers: "/teachers",
      notes: "/notes",
      evaluations: "/evaluations",
      presences: "/presences",
      payments: "/payments",
      assignments: "/assignments",
      courseSchedules: "/course-schedules",
    };

    const http = {};
    const mapped = {};
    for (const [domain, pathname] of Object.entries(endpoints)) {
      const result = await request(pathname, { token });
      const rows =
        domain === "schools"
          ? unwrapList(result.data).length
            ? unwrapList(result.data)
            : result.data && typeof result.data === "object" && !Array.isArray(result.data)
              ? [result.data]
              : []
          : unwrapList(result.data);
      http[domain] = {
        status: result.status,
        count: rows.length,
        first: identityOf(rows[0]),
        error:
          result.status >= 400
            ? result.data && typeof result.data === "object"
              ? result.data.message ?? JSON.stringify(result.data)
              : String(result.data ?? "")
            : null,
      };
      mapped[domain] = rows;
    }

    const applyInput = {
      sessionUser,
      schools: mapped.schools,
      domains: mapped,
    };
    fs.writeFileSync(APPLY_INPUT, `${JSON.stringify(applyInput)}\n`);
    const apply = spawnSync(
      "npx",
      ["--yes", "tsx", "web/src/lib/demoPayloadScope.apply.ts", APPLY_INPUT, APPLY_OUTPUT],
      { cwd: ROOT, encoding: "utf8" },
    );
    if (apply.stdout) process.stdout.write(apply.stdout);
    if (apply.stderr) process.stderr.write(apply.stderr);
    assert.equal(apply.status, 0, "application des scopers Web a échoué");
    const scoped = JSON.parse(fs.readFileSync(APPLY_OUTPUT, "utf8"));

    const domains = [
      "schools",
      "users",
      "students",
      "classes",
      "teachers",
      "notes",
      "evaluations",
      "presences",
      "payments",
      "assignments",
      "courseSchedules",
    ].map((domain) => {
      const rawCount = Number(raw[domain] ?? 0);
      const mappedCount = Number(http[domain]?.count ?? 0);
      const scopedCount = Number(scoped.domains?.[domain]?.scoped ?? mappedCount);
      return {
        domain,
        httpStatus: http[domain]?.status ?? null,
        raw: rawCount,
        mapped: mappedCount,
        scoped: scopedCount,
        drop: dropPoint(rawCount, mappedCount, scopedCount),
        firstRaw: rawFirst[domain] ?? null,
        firstMapped: http[domain]?.first ?? scoped.domains?.[domain]?.firstMapped ?? null,
        scopeError: scoped.domains?.[domain]?.error ?? null,
        httpError: http[domain]?.error ?? null,
      };
    });

    const report = {
      kind: "demo_web_payload_scope_audit",
      login: {
        path: logged.path,
        identifier: logged.identifier,
        requestedSchoolCode: logged.schoolCode,
        httpStatus: login.status,
        adminAttempt: adminAttempt ?? null,
        discoveredIdentifiers: discovered.identifiers,
        attempts: logged.attempts,
      },
      pgSchool: {
        schoolId,
        schoolCode: pgSchool.school_code,
        loginCode: pgSchool.login_code,
      },
      session: {
        schoolId: sessionUser?.schoolId ?? scoped.session?.schoolId ?? null,
        schoolPublicCode: sessionUser?.schoolPublicCode ?? scoped.session?.schoolPublicCode ?? null,
        schoolCode: sessionUser?.schoolCode ?? scoped.session?.schoolCode ?? null,
        jwtSchoolCode: jwt?.schoolCode ?? null,
        jwtSchoolId: jwt?.schoolId ?? jwt?.effectiveSchoolId ?? null,
        schoolContextId: schoolContext.id ?? schoolContext.schoolId ?? null,
        schoolContextCode: schoolContext.code ?? schoolContext.schoolCode ?? null,
        schoolContextLoginCode: schoolContext.loginCode ?? schoolContext.login_code ?? null,
        activeSchoolCode: scoped.session?.activeSchoolCode ?? null,
        hasSchoolId: Boolean(String(sessionUser?.schoolId ?? "").trim()) || Boolean(scoped.session?.hasSchoolId),
        hasPublicCode: Boolean(String(sessionUser?.schoolPublicCode ?? "").trim()) || Boolean(scoped.session?.hasPublicCode),
        schoolCodeIsV2: scoped.session?.schoolCodeIsV2 ?? null,
      },
      traces: scoped.traces ?? null,
      pgRaw: raw,
      domains,
      table: markdownTable(domains),
    };

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write("\n=== DEMO PAYLOAD SCOPE raw → mapped → scoped ===\n");
    process.stdout.write(`${report.table}\n\n`);
    process.stdout.write(`session ${JSON.stringify(report.session, null, 2)}\n`);

    const classRow = domains.find((row) => row.domain === "classes");
    const studentRow = domains.find((row) => row.domain === "students");
    const reproduced =
      (classRow && classRow.raw >= 30 && classRow.scoped === 0) ||
      (studentRow && studentRow.raw >= 300 && studentRow.scoped === 0);
    assert.ok(
      reproduced,
      `RED non reproduit (classes raw=${classRow?.raw} scoped=${classRow?.scoped} ; students raw=${studentRow?.raw} scoped=${studentRow?.scoped} kept/error=${studentRow?.scopeError})`,
    );
    console.log(
      `RED reproduit : classes raw=${classRow.raw} mapped=${classRow.mapped} scoped=${classRow.scoped} drop=${classRow.drop} ; students raw=${studentRow.raw} mapped=${studentRow.mapped} scoped=${studentRow.scoped} drop=${studentRow.drop} error=${studentRow.scopeError}`,
    );
  } finally {
    await stopChild(child);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
