"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { STUDENT_CARD_ERROR } = require("./studentAccessCardsManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_STUDENT_CARDS_HTTP_IT_DATABASE ?? "somafrik_student_cards_http_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_STUDENT_CARDS_HTTP_PORT ?? 19887);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const LEFTOVER_A = "CD-2026-0001";
const LEFTOVER_B = "BI-2026-0001";
const USER_A = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const USER_B = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const USER_TEACHER = "cccccccc-cccc-4ccc-8ccc-cccccccccc03";
const USER_ACCOUNTANT = "cccccccc-cccc-4ccc-8ccc-cccccccccc04";
const USER_SUPER = "cccccccc-cccc-4ccc-8ccc-cccccccccc05";
const USER_PAYS = "cccccccc-cccc-4ccc-8ccc-cccccccccc06";
const STUDENT_A = "cccccccc-cccc-4ccc-8ccc-cccccccccc11";
const STUDENT_A2 = "cccccccc-cccc-4ccc-8ccc-cccccccccc13";
const STUDENT_A3 = "cccccccc-cccc-4ccc-8ccc-cccccccccc14";
const STUDENT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccc12";

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

async function seed(pool) {
  await setLoginCodeTriggers(pool, false);
  const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
  const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'LAC', 'Lycée Lac', 'active')
     RETURNING id`,
    [cd.id, LEFTOVER_A, LOGIN_A],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'BUJ', 'Lycée Bujumbura', 'active')
     RETURNING id`,
    [bi.id, LEFTOVER_B, LOGIN_B],
  );
  await setLoginCodeTriggers(pool, true);
  const schoolAId = schoolA.rows[0].id;
  const schoolBId = schoolB.rows[0].id;

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $7, 'ADM-A', 'Aline', 'A', 'a@cards.gp.test', 'Admin School', 'active', FALSE),
       ($2, $8, 'ADM-B', 'Binta', 'B', 'b@cards.gp.test', 'Admin School', 'active', FALSE),
       ($3, $7, 'ENS-A', 'Chidi', 'T', 't@cards.gp.test', 'Enseignant', 'active', FALSE),
       ($4, $7, 'CPT-A', 'Dora', 'C', 'c@cards.gp.test', 'Comptable', 'active', FALSE),
       ($5, NULL, 'SUPER', 'Super', 'Admin', 'super@cards.gp.test', 'Super Administrateur Somafrik', 'active', FALSE),
       ($6, NULL, 'PAYS-CD', 'Admin', 'Pays', 'pays@cards.gp.test', 'Admin Pays', 'active', FALSE)`,
    [USER_A, USER_B, USER_TEACHER, USER_ACCOUNTANT, USER_SUPER, USER_PAYS, schoolAId, schoolBId],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $5, 'SCHOOL_ADMIN', 'active'),
       ($2, $6, 'SCHOOL_ADMIN', 'active'),
       ($3, $5, 'TEACHER', 'active'),
       ($4, $5, 'ACCOUNTANT', 'active'),
       ($7, NULL, 'SUPER_ADMIN', 'active'),
       ($8, NULL, 'COUNTRY_ADMIN', 'active')`,
    [USER_A, USER_B, USER_TEACHER, USER_ACCOUNTANT, schoolAId, schoolBId, USER_SUPER, USER_PAYS],
  );
  await pool.query(
    `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
     VALUES
       ($1, $5, 'STU-A-001', 'Eleve', 'A', 'active'),
       ($2, $5, 'STU-A-002', 'Eleve', 'A2', 'active'),
       ($3, $5, 'STU-A-003', 'Eleve', 'A3', 'active'),
       ($4, $6, 'STU-B-001', 'Eleve', 'B', 'active')`,
    [STUDENT_A, STUDENT_A2, STUDENT_A3, STUDENT_B, schoolAId, schoolBId],
  );
  await pool.query(
    `INSERT INTO school_settings (school_id, student_card_enabled)
     VALUES ($1, TRUE), ($2, TRUE)
     ON CONFLICT (school_id) DO UPDATE SET student_card_enabled = TRUE`,
    [schoolAId, schoolBId],
  );
  return { schoolAId, schoolBId };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentAccessCards.http.pg.test.js SKIP (DATABASE_URL absent)");
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
  const tokens = new TokenService({ secret: JWT_SECRET });
  const mint = (payload) => tokens.createAccessToken({ mustChangePassword: false, ...payload });
  const pool = new Pool({ connectionString: isolatedUrl });
  let child = null;

  try {
    await repo.init();
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    const { schoolAId, schoolBId } = await seed(pool);

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

    const tokenA = mint({
      sub: USER_A,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: ["Élèves:READ", "Élèves:UPDATE", "Gérer élèves", "Voir élèves"],
    });
    const tokenB = mint({
      sub: USER_B,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_B,
      permissions: ["Élèves:READ", "Élèves:UPDATE", "Gérer élèves", "Voir élèves"],
    });
    const tokenTeacher = mint({
      sub: USER_TEACHER,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: ["Élèves:READ", "Voir élèves"],
    });
    const tokenAccountant = mint({
      sub: USER_ACCOUNTANT,
      role: "Comptable",
      roleKeys: ["ACCOUNTANT"],
      schoolCode: LEFTOVER_A,
      permissions: ["Paiements:READ"],
    });
    const tokenSuper = mint({
      sub: USER_SUPER,
      role: "Super Administrateur Somafrik",
      roleKeys: ["SUPER_ADMIN"],
      schoolCode: LOGIN_A,
      permissions: ["ALL_PRIVILEGES", "Élèves:READ", "Élèves:UPDATE"],
    });
    const tokenPays = mint({
      sub: USER_PAYS,
      role: "Admin Pays",
      roleKeys: ["COUNTRY_ADMIN"],
      schoolCode: LOGIN_A,
      countryCode: "CD",
      permissions: ["COUNTRY_PRIVILEGES", "Élèves:UPDATE"],
    });

    await pool.query(`UPDATE school_settings SET student_card_enabled = FALSE WHERE school_id = $1`, [schoolAId]);
    const disabledIssue = await request("/student-cards", {
      method: "POST",
      token: tokenA,
      body: { studentId: STUDENT_A, medium: "nfc_qr" },
    });
    assert.equal(disabledIssue.status, 404, JSON.stringify(disabledIssue.data));
    assert.equal(disabledIssue.data?.code, STUDENT_CARD_ERROR.DISABLED);
    const disabledList = await request(`/students/${STUDENT_A}/cards`, { token: tokenA });
    assert.equal(disabledList.status, 404);
    assert.equal(disabledList.data?.code, STUDENT_CARD_ERROR.DISABLED);

    await pool.query(`UPDATE school_settings SET student_card_enabled = TRUE WHERE school_id = $1`, [schoolAId]);

    const issued = await request("/student-cards", {
      method: "POST",
      token: tokenA,
      body: { studentId: STUDENT_A, medium: "nfc_qr" },
    });
    assert.equal(issued.status, 201, JSON.stringify(issued.data));
    assert.equal(issued.data.status, "active");
    assert.ok(issued.data.cardToken && issued.data.cardToken.includes("."));
    assert.equal(issued.data.token_hash, undefined);
    const secret = issued.data.cardToken.split(".")[1];
    const cardId = issued.data.id;

    const listed = await request(`/students/${STUDENT_A}/cards`, { token: tokenA });
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    const cards = listed.data?.cards || listed.data;
    assert.equal(Array.isArray(cards), true);
    assert.equal(cards[0].cardToken, undefined);
    assert.equal(cards[0].token_hash, undefined);
    assert.equal(JSON.stringify(cards).includes(secret), false);

    const teacherList = await request(`/students/${STUDENT_A}/cards`, { token: tokenTeacher });
    assert.equal(teacherList.status, 200, JSON.stringify(teacherList.data));
    const teacherIssue = await request("/student-cards", {
      method: "POST",
      token: tokenTeacher,
      body: { studentId: STUDENT_A, medium: "qr" },
    });
    assert.equal(teacherIssue.status, 403, JSON.stringify(teacherIssue.data));

    const accountantList = await request(`/students/${STUDENT_A}/cards`, { token: tokenAccountant });
    assert.equal(accountantList.status, 403, JSON.stringify(accountantList.data));

    const crossList = await request(`/students/${STUDENT_A}/cards`, { token: tokenB });
    assert.equal(crossList.status, 404, JSON.stringify(crossList.data));
    const crossLost = await request(`/student-cards/${cardId}/lost`, { method: "POST", token: tokenB, body: {} });
    assert.equal(crossLost.status, 404, JSON.stringify(crossLost.data));
    assert.notEqual(crossLost.data?.code, STUDENT_CARD_ERROR.INVALID_STATE);

    const superIssue = await request("/student-cards", {
      method: "POST",
      token: tokenSuper,
      body: { studentId: STUDENT_A, medium: "qr" },
      headers: { "X-Somafrik-School-Code": LOGIN_A },
    });
    assert.equal(superIssue.status, 403, JSON.stringify(superIssue.data));
    assert.equal(superIssue.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    const paysList = await request(`/students/${STUDENT_A}/cards`, { token: tokenPays });
    assert.equal(paysList.status, 403);
    assert.equal(paysList.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");

    const lost = await request(`/student-cards/${cardId}/lost`, { method: "POST", token: tokenA, body: { reason: "lost" } });
    assert.equal(lost.status, 200, JSON.stringify(lost.data));
    assert.equal(lost.data.status, "lost");
    const lostAgain = await request(`/student-cards/${cardId}/lost`, { method: "POST", token: tokenA, body: {} });
    assert.equal(lostAgain.status, 200);
    assert.equal(lostAgain.data.status, "lost");
    assert.equal(lostAgain.data.revokedAt, lost.data.revokedAt);

    const replaced = await request(`/student-cards/${cardId}/replace`, {
      method: "POST",
      token: tokenA,
      headers: { "Idempotency-Key": "replace-card-a-1" },
    });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.data));
    assert.equal(replaced.data.card.status, "active");
    assert.equal(replaced.data.previous.status, "replaced");
    const newToken = replaced.data.card.cardToken;
    assert.ok(newToken);
    assert.notEqual(newToken, issued.data.cardToken);

    const replacedReplay = await request(`/student-cards/${cardId}/replace`, {
      method: "POST",
      token: tokenA,
      headers: { "Idempotency-Key": "replace-card-a-1" },
    });
    assert.equal(replacedReplay.status, 200, JSON.stringify(replacedReplay.data));
    assert.equal(replacedReplay.data.card.id, replaced.data.card.id);
    assert.equal(replacedReplay.data.idempotentReplay, true);
    const activeCount = await pool.query(
      `SELECT count(*)::int AS n FROM student_access_cards WHERE school_id=$1 AND student_id=$2 AND status='active'`,
      [schoolAId, STUDENT_A],
    );
    assert.equal(activeCount.rows[0].n, 1);

    const issuedCrossA = await request("/student-cards", {
      method: "POST",
      token: tokenA,
      body: { studentId: STUDENT_A2, medium: "nfc" },
    });
    assert.equal(issuedCrossA.status, 201, JSON.stringify(issuedCrossA.data));
    const cardCrossA = issuedCrossA.data.id;
    const issuedCrossB = await request("/student-cards", {
      method: "POST",
      token: tokenA,
      body: { studentId: STUDENT_A3, medium: "qr" },
    });
    assert.equal(issuedCrossB.status, 201, JSON.stringify(issuedCrossB.data));
    const cardCrossB = issuedCrossB.data.id;
    assert.notEqual(cardCrossA, cardCrossB);

    const replacementA = await request(`/student-cards/${cardCrossA}/replace`, {
      method: "POST",
      token: tokenA,
      body: {},
      headers: { "Idempotency-Key": "cross-card-key" },
    });
    assert.equal(replacementA.status, 200, JSON.stringify(replacementA.data));
    assert.equal(replacementA.data.previous.id, cardCrossA);
    assert.notEqual(replacementA.data.idempotentReplay, true);

    const replacementB = await request(`/student-cards/${cardCrossB}/replace`, {
      method: "POST",
      token: tokenA,
      body: {},
      headers: { "Idempotency-Key": "cross-card-key" },
    });
    assert.equal(replacementB.status, 200, JSON.stringify(replacementB.data));
    assert.notEqual(replacementB.data.idempotentReplay, true, JSON.stringify(replacementB.data));
    assert.notEqual(replacementA.data.card.id, replacementB.data.card.id);
    assert.equal(replacementB.data.previous.id, cardCrossB);
    assert.notEqual(replacementB.data.card.id, replacementA.data.card.id);
    assert.notEqual(replacementB.data.previous.id, cardCrossA);

    const crossStates = await pool.query(
      `SELECT id, student_id, status, replaced_by_card_id
         FROM student_access_cards
        WHERE id = ANY($1::uuid[])`,
      [[cardCrossA, cardCrossB, replacementA.data.card.id, replacementB.data.card.id]],
    );
    const byId = Object.fromEntries(crossStates.rows.map((row) => [row.id, row]));
    assert.equal(byId[cardCrossA].status, "replaced");
    assert.equal(byId[cardCrossA].replaced_by_card_id, replacementA.data.card.id);
    assert.equal(byId[cardCrossB].status, "replaced");
    assert.equal(byId[cardCrossB].replaced_by_card_id, replacementB.data.card.id);
    assert.equal(byId[replacementA.data.card.id].status, "active");
    assert.equal(byId[replacementB.data.card.id].status, "active");
    assert.equal(byId[replacementA.data.card.id].student_id, STUDENT_A2);
    assert.equal(byId[replacementB.data.card.id].student_id, STUDENT_A3);

    const replaceDenied = await request(`/student-cards/${cardId}/replace`, { method: "POST", token: tokenA });
    assert.equal(replaceDenied.status, 409, JSON.stringify(replaceDenied.data));
    assert.equal(replaceDenied.data?.code, STUDENT_CARD_ERROR.INVALID_STATE);

    const scan = await request("/student-cards/scan", { method: "POST", token: tokenA, body: { cardToken: newToken } });
    assert.notEqual(scan.status, 200);
    assert.ok(scan.status === 404 || scan.status === 403 || scan.status === 400);

    const dbCards = await pool.query(`SELECT token_hash, public_id FROM student_access_cards WHERE school_id=$1`, [schoolAId]);
    for (const row of dbCards.rows) {
      assert.match(row.token_hash, /^[0-9a-f]{64}$/);
      assert.equal(JSON.stringify(row).includes(secret), false);
      assert.equal(JSON.stringify(row).includes(newToken), false);
    }
    const auditRows = await pool.query(
      `SELECT action, new_value::text AS payload FROM audit_logs WHERE action LIKE 'student_card_%'`,
    );
    assert.ok(auditRows.rowCount >= 1);
    for (const row of auditRows.rows) {
      assert.equal(String(row.payload ?? "").includes(secret), false, row.action);
      assert.doesNotMatch(String(row.payload ?? ""), /cardToken|token_hash|"secret"/);
    }

    void schoolBId;
    console.log("studentAccessCards.http.pg.test.js OK");
  } finally {
    await stopChild(child);
    await pool.end();
    if (typeof repo.close === "function") await repo.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
