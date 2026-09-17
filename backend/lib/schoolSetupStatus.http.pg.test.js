"use strict";

/**
 * LOT 0 RED — Issue #676 / HOLD CTO 5713796846
 * Preuve HTTP/PG runtime : membership `principal.sub → users.school_id → schools`
 * sans champs synthétiques usersSchoolId / effectiveSchoolId.
 *
 * Aucune implémentation GREEN. Échoue tant que GET /api/v2/school-setup/status
 * est absent. SKIP uniquement si DATABASE_URL est absent (requires PG lazy).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
if (process.env.GITHUB_ACTIONS && !DATABASE_URL) {
  throw new Error("G5: DATABASE_URL requis en GitHub Actions — le harness HTTP/PG ne doit pas SKIP");
}
const IT_DATABASE = String(process.env.SOMAFRIK_SCHOOL_SETUP_LOT0_IT_DATABASE ?? "somafrik_school_setup_lot0_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_SCHOOL_SETUP_LOT0_HTTP_PORT ?? 19891);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";
const SETUP_PATH = "/v2/school-setup/status";

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const USER_NO_SCHOOL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";

const SETUP_PERMISSIONS = Object.freeze(["Paramètres Établissement:READ"]);

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(Pool, databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function request(pathname, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
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

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
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
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function setRoleModuleGrant(pool, roleKey, moduleKey, flags) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = upper($1) AND module_key = $2 AND scope_type = 'global' AND status = 'active'
     LIMIT 1`,
    [roleKey, moduleKey],
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_create = $2, can_read = $3, can_update = $4, can_delete = FALSE, updated_by = 'lot0', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, flags.create, flags.read, flags.update],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', $2, $3, $4, $5, FALSE, 'lot0')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update],
  );
}

async function ensureCountry(pool, name, iso, phone, currency) {
  const existing = await pool.query(`SELECT id FROM countries WHERE iso_code = $1 LIMIT 1`, [iso]);
  if (existing.rowCount) return existing.rows[0];
  const inserted = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, iso, phone, currency],
  );
  return inserted.rows[0];
}

async function setLoginCodeTriggers(pool, enabled) {
  const action = enabled ? "ENABLE" : "DISABLE";
  await pool.query(`
    DO $trg$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_schools_login_code_insert') THEN
        EXECUTE 'ALTER TABLE schools ${action} TRIGGER zz_schools_login_code_insert';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_schools_login_code_update') THEN
        EXECUTE 'ALTER TABLE schools ${action} TRIGGER zz_schools_login_code_update';
      END IF;
    END
    $trg$;
  `);
}

function leaksSchoolB(payload, fixture) {
  const encoded = JSON.stringify(payload ?? {});
  return (
    encoded.includes(String(fixture.schoolBId)) ||
    encoded.includes(LOGIN_B) ||
    encoded.includes(LEFTOVER_B)
  );
}

function assertReadyAWithoutPeriods(response, fixture) {
  assert.equal(
    response.status,
    200,
    `GET ${SETUP_PATH} status=${response.status} body=${JSON.stringify(response.data)} — contrat HTTP LOT 0 absent ou incorrect`,
  );
  const payload = response.data;
  assert.ok(payload && typeof payload === "object", "payload JSON objet");
  assert.equal(payload.status, "READY");
  assert.equal(payload.core?.academicYear, true);
  assert.equal(payload.core?.structure, true);
  assert.equal(payload.core?.classes, true);
  assert.equal(payload.optional?.periods, false);
  assert.equal(payload.progress?.coreDone, 3);
  assert.equal(payload.progress?.coreTotal, 3);
  assert.equal(leaksSchoolB(payload, fixture), false, `fuite école B: ${JSON.stringify(payload)}`);
}

function assertClosedOrReadyA(response, fixture) {
  if (response.status === 400 || response.status === 403 || response.status === 401) {
    assert.equal(leaksSchoolB(response.data, fixture), false, `fuite école B en erreur: ${JSON.stringify(response.data)}`);
    return;
  }
  assertReadyAWithoutPeriods(response, fixture);
}

async function seedReadyAWithoutTerms(pool) {
  await setLoginCodeTriggers(pool, false);
  const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
  const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'LAC', 'Lycée Lac', 'active')
     RETURNING id, school_code, login_code`,
    [cd.id, LEFTOVER_A, LOGIN_A],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'BUJ', 'Lycée Bujumbura', 'active')
     RETURNING id, school_code, login_code`,
    [bi.id, LEFTOVER_B, LOGIN_B],
  );
  await setLoginCodeTriggers(pool, true);

  assert.notEqual(schoolA.rows[0].school_code, schoolA.rows[0].login_code);
  assert.equal(schoolA.rows[0].login_code, LOGIN_A);
  assert.equal(schoolB.rows[0].login_code, LOGIN_B);

  const yearA = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', TRUE, 'open')
     RETURNING id`,
    [schoolA.rows[0].id],
  );

  const level = await pool.query(
    `INSERT INTO education_levels (country_id, level_code, name, status)
     VALUES ($1, '6eme', '6ème', 'active') RETURNING id`,
    [cd.id],
  );
  const group = await pool.query(
    `INSERT INTO education_class_groups (country_id, group_code, name, status)
     VALUES ($1, 'A', 'A', 'active') RETURNING id`,
    [cd.id],
  );
  await pool.query(
    `INSERT INTO school_levels (school_id, level_id, status) VALUES ($1, $2, 'active')`,
    [schoolA.rows[0].id, level.rows[0].id],
  );
  await pool.query(
    `INSERT INTO school_class_groups (school_id, group_id, status) VALUES ($1, $2, 'active')`,
    [schoolA.rows[0].id, group.rows[0].id],
  );
  await pool.query(
    `INSERT INTO classes (
       school_id, academic_year_id, class_code, name, level, status, level_id, group_id, group_code
     ) VALUES ($1, $2, 'CLS-A-READY', '6ème A', '6ème', 'active', $3, $4, 'A')`,
    [schoolA.rows[0].id, yearA.rows[0].id, level.rows[0].id, group.rows[0].id],
  );

  const termsA = await pool.query(
    `SELECT count(*)::int AS c FROM terms WHERE academic_year_id = $1`,
    [yearA.rows[0].id],
  );
  assert.equal(termsA.rows[0].c, 0, "fixture A doit rester sans période");

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $4, 'ADM-A', 'Aline', 'A', 'a@lot0.test', 'Admin School', 'active', FALSE),
       ($2, $5, 'ADM-B', 'Binta', 'B', 'b@lot0.test', 'Admin School', 'active', FALSE),
       ($3, NULL, 'ADM-NS', 'Sans', 'Ecole', 'ns@lot0.test', 'Admin School', 'active', FALSE)`,
    [USER_A, USER_B, USER_NO_SCHOOL, schoolA.rows[0].id, schoolB.rows[0].id],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $4, 'SCHOOL_ADMIN', 'active'),
       ($2, $5, 'SCHOOL_ADMIN', 'active'),
       ($3, NULL, 'SCHOOL_ADMIN', 'active')`,
    [USER_A, USER_B, USER_NO_SCHOOL, schoolA.rows[0].id, schoolB.rows[0].id],
  );

  await setRoleModuleGrant(pool, "SCHOOL_ADMIN", "school_settings", { create: false, read: true, update: false });

  return {
    schoolAId: schoolA.rows[0].id,
    schoolBId: schoolB.rows[0].id,
    yearAId: yearA.rows[0].id,
  };
}

test(
  "ST-06-HTTP / ST-03-HTTP — membership PG autoritaire + READY sans période",
  { skip: !DATABASE_URL },
  async () => {
    const { Pool } = require("pg");
    const { createPostgresRepository } = require("../db/repositoryFactory");
    const { TokenService } = require("../services/tokenService");

    const isolatedUrl = await ensureIsolatedDatabase(Pool, DATABASE_URL, IT_DATABASE);
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
    const tokens = new TokenService({ secret: JWT_SECRET });
    const pool = new Pool({ connectionString: isolatedUrl });
    let child = null;

    function mint(payload) {
      return tokens.createAccessToken({ mustChangePassword: false, ...payload });
    }

    try {
      await repo.init();
      await pool.query(`
        ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
        ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
      `);
      const fixture = await seedReadyAWithoutTerms(pool);

      child = spawn(process.execPath, ["backend/server.js"], {
        cwd: ROOT,
        env: {
          ...process.env,
          NODE_ENV: "test",
          PORT: String(HTTP_PORT),
          DATABASE_URL: isolatedUrl,
          JWT_SECRET,
          SOMAFRIK_DB_REQUIRED: "true",
          SOMAFRIK_SKIP_DEMO_SEED: "true",
          SOMAFRIK_API_ONLY: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stderrRef = { value: "" };
      child.stderr.on("data", (chunk) => {
        stderrRef.value += String(chunk);
      });
      await waitForHealth(child, stderrRef);

      await pool.query(`DELETE FROM terms WHERE academic_year_id = $1`, [fixture.yearAId]);
      const termsAfterBoot = await pool.query(
        `SELECT count(*)::int AS c FROM terms WHERE academic_year_id = $1`,
        [fixture.yearAId],
      );
      assert.equal(termsAfterBoot.rows[0].c, 0, "fixture A doit rester sans période après boot serveur");

      const tokenA = mint({
        sub: USER_A,
        role: "Admin School",
        roleKeys: ["SCHOOL_ADMIN"],
        schoolCode: LEFTOVER_A,
        permissions: SETUP_PERMISSIONS,
      });
      const tokenForgedB = mint({
        sub: USER_A,
        role: "Admin School",
        roleKeys: ["SCHOOL_ADMIN"],
        schoolCode: LEFTOVER_B,
        permissions: SETUP_PERMISSIONS,
      });
      const tokenNoSchool = mint({
        sub: USER_NO_SCHOOL,
        role: "Admin School",
        roleKeys: ["SCHOOL_ADMIN"],
        schoolCode: LEFTOVER_A,
        permissions: SETUP_PERMISSIONS,
      });
      const tokenNoSub = mint({
        role: "Admin School",
        roleKeys: ["SCHOOL_ADMIN"],
        schoolCode: LEFTOVER_A,
        permissions: SETUP_PERMISSIONS,
      });

      const membership = await request(SETUP_PATH, { token: tokenA });
      assertReadyAWithoutPeriods(membership, fixture);

      const forgedJwt = await request(SETUP_PATH, { token: tokenForgedB });
      assertClosedOrReadyA(forgedJwt, fixture);

      const forgedHeader = await request(SETUP_PATH, {
        token: tokenA,
        headers: { "X-Somafrik-School-Code": LOGIN_B },
      });
      assertClosedOrReadyA(forgedHeader, fixture);

      const noSchool = await request(SETUP_PATH, { token: tokenNoSchool });
      assert.ok(
        noSchool.status === 401 || noSchool.status === 403,
        `membership absent fail-closed, jamais fallback leftover JWT (status=${noSchool.status} body=${JSON.stringify(noSchool.data)})`,
      );
      assert.notEqual(noSchool.status, 200);
      assert.equal(noSchool.data?.status, undefined);
      assert.equal(leaksSchoolB(noSchool.data, fixture), false);

      const noSub = await request(SETUP_PATH, { token: tokenNoSub });
      assert.ok(
        noSub.status === 401 || noSub.status === 403,
        `sub absent fail-closed (status=${noSub.status} body=${JSON.stringify(noSub.data)})`,
      );
      assert.notEqual(noSub.status, 200);

      await pool.query(
        `UPDATE academic_years SET is_current = FALSE, status = 'open' WHERE id = $1`,
        [fixture.yearAId],
      );
      const openOnly = await request(SETUP_PATH, { token: tokenA });
      assertReadyAWithoutPeriods(openOnly, fixture);

      await pool.query(
        `UPDATE academic_years SET is_current = FALSE, status = 'active' WHERE id = $1`,
        [fixture.yearAId],
      );
      const activeOnly = await request(SETUP_PATH, { token: tokenA });
      assert.equal(
        activeOnly.status,
        200,
        `G4 status=active sans is_current: status=${activeOnly.status} body=${JSON.stringify(activeOnly.data)}`,
      );
      assert.equal(activeOnly.data?.core?.academicYear, false);
      assert.notEqual(activeOnly.data?.status, "READY");
      assert.equal(leaksSchoolB(activeOnly.data, fixture), false);

      await pool.query(
        `UPDATE academic_years SET is_current = FALSE, status = 'closed' WHERE id = $1`,
        [fixture.yearAId],
      );
      const yearY2 = await pool.query(
        `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
         VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open')
         RETURNING id`,
        [fixture.schoolAId],
      );
      await pool.query(`DELETE FROM terms WHERE academic_year_id = $1`, [yearY2.rows[0].id]);
      const y1Class = await pool.query(
        `SELECT count(*)::int AS c FROM classes WHERE academic_year_id = $1`,
        [fixture.yearAId],
      );
      assert.equal(y1Class.rows[0].c, 1, "G6: Y1 conserve sa classe historique");

      const g6NoY2Class = await request(SETUP_PATH, { token: tokenA });
      assert.equal(
        g6NoY2Class.status,
        200,
        `G6 sans classe Y2: status=${g6NoY2Class.status} body=${JSON.stringify(g6NoY2Class.data)}`,
      );
      assert.equal(g6NoY2Class.data?.core?.academicYear, true);
      assert.equal(g6NoY2Class.data?.core?.structure, true);
      assert.equal(g6NoY2Class.data?.core?.classes, false);
      assert.equal(g6NoY2Class.data?.status, "IN_PROGRESS");
      assert.equal(leaksSchoolB(g6NoY2Class.data, fixture), false);

      const offering = await pool.query(
        `SELECT sl.level_id, scg.group_id
         FROM school_levels sl
         CROSS JOIN school_class_groups scg
         WHERE sl.school_id = $1 AND scg.school_id = $1
         LIMIT 1`,
        [fixture.schoolAId],
      );
      await pool.query(
        `INSERT INTO classes (
           school_id, academic_year_id, class_code, name, level, status, level_id, group_id, group_code
         ) VALUES ($1, $2, 'CLS-A-Y2', '6ème A Y2', '6ème', 'active', $3, $4, 'A')`,
        [fixture.schoolAId, yearY2.rows[0].id, offering.rows[0].level_id, offering.rows[0].group_id],
      );
      await pool.query(`DELETE FROM terms WHERE academic_year_id = $1`, [yearY2.rows[0].id]);
      const g6ReadyY2 = await request(SETUP_PATH, { token: tokenA });
      assertReadyAWithoutPeriods(g6ReadyY2, fixture);
    } finally {
      await stopChild(child);
      await pool.end();
      if (typeof repo.close === "function") await repo.close();
    }
  },
);
