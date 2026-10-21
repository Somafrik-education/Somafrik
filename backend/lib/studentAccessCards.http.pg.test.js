"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { STUDENT_CARD_ERROR } = require("./studentAccessCardsManagement");
const { randomUUID } = require("node:crypto");

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
  return {
    status: response.status,
    data,
    cacheControl: response.headers.get("cache-control"),
  };
}

function cardSecrets(...tokens) {
  return tokens.filter(Boolean).flatMap((token) => {
    const value = String(token);
    const secret = value.includes(".") ? value.split(".").slice(1).join(".") : value;
    return [value, secret];
  });
}

async function assertCardSecretsAbsent(pool, secrets) {
  const dumped = await pool.query(`
    SELECT 'idempotency_keys' AS src, coalesce(response_body::text, '') AS payload
      FROM idempotency_keys
    UNION ALL
    SELECT 'student_access_cards', row_to_json(c)::text
      FROM student_access_cards c
    UNION ALL
    SELECT 'audit_logs', coalesce(old_value::text, '') || coalesce(new_value::text, '')
      FROM audit_logs
     WHERE action LIKE 'student_card_%'
  `);
  let hits = 0;
  for (const secret of secrets) {
    for (const row of dumped.rows) {
      if (String(row.payload).includes(secret)) hits += 1;
    }
  }
  assert.equal(hits, 0, `persisted card secret occurrences=${hits}`);
  const secretRoutes = await pool.query(`
    SELECT count(*)::int AS n
      FROM idempotency_keys
     WHERE route_key = 'POST /api/student-cards'
        OR route_key LIKE 'POST /api/student-cards/%/replace'
  `);
  assert.equal(secretRoutes.rows[0].n, 0);
  const bodies = await pool.query(`SELECT coalesce(response_body::text, '') AS payload FROM idempotency_keys`);
  for (const row of bodies.rows) {
    assert.doesNotMatch(row.payload, /cardToken|token_hash/);
  }
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
  // CARTE-CYCLE-01 : titulaire explicite (élève) pour les établissements de test émetteurs de cartes.
  await pool.query("UPDATE school_settings SET student_card_holder_kind = 'eleve' WHERE school_id = ANY($1::uuid[])", [[schoolAId, schoolBId]]);
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
        // NFC-P0-R3-1: small per-user diagnosis budget so the 429 path is exercised.
        NFC_DIAGNOSIS_RATE_LIMIT_MAX: "12",
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
      headers: { "Idempotency-Key": "issue-card-a-1" },
    });
    assert.equal(issued.status, 201, JSON.stringify(issued.data));
    assert.equal(issued.cacheControl, "no-store");
    assert.equal(issued.data.status, "active");
    assert.ok(issued.data.cardToken && issued.data.cardToken.includes("."));
    assert.equal(issued.data.token_hash, undefined);
    assert.notEqual(issued.data.idempotentReplay, true);
    const secret = issued.data.cardToken.split(".")[1];
    const cardId = issued.data.id;
    await assertCardSecretsAbsent(pool, cardSecrets(issued.data.cardToken));

    const issuedAgain = await request("/student-cards", {
      method: "POST",
      token: tokenA,
      body: { studentId: STUDENT_A, medium: "nfc_qr" },
      headers: { "Idempotency-Key": "issue-card-a-1" },
    });
    assert.equal(issuedAgain.status, 409, JSON.stringify(issuedAgain.data));
    assert.equal(issuedAgain.data?.code, STUDENT_CARD_ERROR.ACTIVE_ALREADY_EXISTS);
    assert.notEqual(issuedAgain.data?.idempotentReplay, true);
    assert.equal(issuedAgain.data?.cardToken, undefined);

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
    assert.equal(replaced.cacheControl, "no-store");
    assert.equal(replaced.data.card.status, "active");
    assert.equal(replaced.data.previous.status, "replaced");
    const newToken = replaced.data.card.cardToken;
    assert.ok(newToken);
    assert.notEqual(newToken, issued.data.cardToken);
    assert.notEqual(replaced.data.idempotentReplay, true);
    await assertCardSecretsAbsent(pool, cardSecrets(issued.data.cardToken, newToken));

    const replacedReplay = await request(`/student-cards/${cardId}/replace`, {
      method: "POST",
      token: tokenA,
      headers: { "Idempotency-Key": "replace-card-a-1" },
    });
    assert.equal(replacedReplay.status, 409, JSON.stringify(replacedReplay.data));
    assert.equal(replacedReplay.data?.code, STUDENT_CARD_ERROR.INVALID_STATE);
    assert.notEqual(replacedReplay.data?.idempotentReplay, true);
    assert.equal(replacedReplay.data?.cardToken, undefined);
    assert.equal(replacedReplay.data?.card, undefined);
    const activeCount = await pool.query(
      `SELECT count(*)::int AS n FROM student_access_cards WHERE school_id=$1 AND student_id=$2 AND status='active'`,
      [schoolAId, STUDENT_A],
    );
    assert.equal(activeCount.rows[0].n, 1);

    const issuedCrossA = await request("/student-cards", {
      method: "POST",
      token: tokenA,
      body: { studentId: STUDENT_A2, medium: "nfc_qr" },
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
    assert.equal(scan.status, 409, JSON.stringify(scan.data));
    assert.equal(scan.data?.code, STUDENT_CARD_ERROR.ENROLLMENT_UNRESOLVED);
    assert.equal(JSON.stringify(scan.data).includes(newToken), false);

    const dbCards = await pool.query(`SELECT row_to_json(c) AS payload FROM student_access_cards c WHERE school_id=$1`, [schoolAId]);
    assert.ok(dbCards.rowCount >= 1);
    for (const row of dbCards.rows) {
      assert.match(row.payload.token_hash, /^[0-9a-f]{64}$/);
      assert.equal(JSON.stringify(row.payload).includes(secret), false);
      assert.equal(JSON.stringify(row.payload).includes(newToken), false);
    }
    const auditRows = await pool.query(
      `SELECT action, coalesce(old_value::text, '') || coalesce(new_value::text, '') AS payload
         FROM audit_logs WHERE action LIKE 'student_card_%'`,
    );
    assert.ok(auditRows.rowCount >= 1);
    assert.equal(auditRows.rows.some((row) => row.action === "student_card_issued"), true);
    assert.equal(auditRows.rows.some((row) => row.action === "student_card_replaced"), true);
    assert.equal(auditRows.rows.some((row) => row.action === "student_card_scanned"), false);
    for (const row of auditRows.rows) {
      assert.equal(String(row.payload ?? "").includes(secret), false, row.action);
      assert.equal(String(row.payload ?? "").includes(newToken), false, row.action);
      assert.doesNotMatch(String(row.payload ?? ""), /cardToken|token_hash|"secret"/);
    }
    await assertCardSecretsAbsent(pool, cardSecrets(
      issued.data.cardToken,
      newToken,
      issuedCrossA.data.cardToken,
      issuedCrossB.data.cardToken,
      replacementA.data.card.cardToken,
      replacementB.data.card.cardToken,
    ));

    // NFC-PROG-02: real HTTP routes, live RBAC and PostgreSQL audit/associations.
    const nfcStudent = randomUUID();
    await pool.query("INSERT INTO students(id,school_id,first_name,last_name,status) VALUES($1,$2,'NFC','Fixture','active')",[nfcStudent,schoolAId]);
    await pool.query("UPDATE school_settings SET student_card_nfc_enabled=TRUE WHERE school_id=ANY($1::uuid[])",[[schoolAId,schoolBId]]);
    const nfcBody={studentId:nfcStudent,medium:"nfc",nfc:{uid:"04112233445566",tagType:"NTAG216"},operationId:randomUUID()};
    // Lose an actual HTTP response body after the server commits. Replaying the
    // operation must recover its reference without a second reservation or token cache.
    const lostResponse=await fetch(`http://127.0.0.1:${HTTP_PORT}/api/student-cards`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${tokenA}`},body:JSON.stringify(nfcBody)});
    assert.equal(lostResponse.status,201);await lostResponse.body.cancel();
    const nfcIssue=await request('/student-cards',{method:'POST',token:tokenA,body:nfcBody});
    assert.equal(nfcIssue.status,201);assert.equal(nfcIssue.cacheControl,'no-store');assert.equal(nfcIssue.data.status,'issued');
    assert.equal(nfcIssue.data.cardToken,undefined);
    const retryOperationId=randomUUID();
    const retry=await request(`/student-cards/${nfcIssue.data.id}/nfc-retry`,{method:'POST',token:tokenA,body:{...nfcBody.nfc,operationId:retryOperationId}});
    assert.equal(retry.status,200);const nfcToken=retry.data.cardToken;assert.ok(nfcToken);
    const recovered=await request('/student-cards',{method:'POST',token:tokenA,body:nfcBody});
    assert.equal(recovered.data.id,nfcIssue.data.id);assert.equal(recovered.data.cardToken,undefined);assert.equal(recovered.data.idempotentReplay,true);
    const confirmBody={...nfcBody.nfc,cardToken:nfcToken,locked:false,studentId:nfcStudent,operationId:nfcBody.operationId};
    const confirmPath=`/student-cards/${nfcIssue.data.id}/nfc-confirm`;
    const denied=await request(confirmPath,{method:'POST',token:tokenTeacher,body:confirmBody});assert.equal(denied.status,403);
    const platform=await request(confirmPath,{method:'POST',token:tokenSuper,body:confirmBody});assert.equal(platform.status,403);
    const wrongTenant=await request(confirmPath,{method:'POST',token:tokenB,body:confirmBody});assert.equal(wrongTenant.status,404);assert.equal(wrongTenant.data.code,'STUDENT_CARD_NOT_FOUND');
    // UUID validation is part of the real HTTP contract, including lost-response replay.
    const beforeUuid=await pool.query('SELECT status,nfc_encoding_state,nfc_encoded_at,nfc_locked_at FROM student_access_cards WHERE id=$1',[nfcIssue.data.id]);
    const auditBeforeUuid=await pool.query('SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1',[nfcIssue.data.id]);
    for (const operationId of [undefined,null,'invalid',[],{id:nfcBody.operationId},randomUUID(),retryOperationId]) {
      const invalid=await request(confirmPath,{method:'POST',token:tokenA,body:{...confirmBody,operationId}});
      const mismatch=typeof operationId==='string' && operationId!=='invalid';
      assert.equal(invalid.status,mismatch?409:400);assert.equal(invalid.data.code,mismatch?'STUDENT_CARD_NFC_OPERATION_MISMATCH':'STUDENT_CARD_NFC_OPERATION_REQUIRED');
      assert.equal(invalid.cacheControl,'no-store');
      const errorText=JSON.stringify(invalid.data);
      for (const forbidden of [nfcToken,nfcToken.split('.')[1],nfcBody.nfc.uid,nfcBody.operationId]) assert.equal(errorText.includes(forbidden),false);
    }
    assert.deepEqual((await pool.query('SELECT status,nfc_encoding_state,nfc_encoded_at,nfc_locked_at FROM student_access_cards WHERE id=$1',[nfcIssue.data.id])).rows,beforeUuid.rows);
    assert.deepEqual((await pool.query('SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1',[nfcIssue.data.id])).rows,auditBeforeUuid.rows);
    const pendingScan=await request('/student-cards/scan',{method:'POST',token:tokenA,body:{cardToken:nfcToken}});assert.equal(pendingScan.status,409);assert.equal(pendingScan.data.code,'STUDENT_CARD_INVALID_STATE');
    await pool.query(`CREATE FUNCTION nfc_http_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='student_card_nfc_encoded' THEN RAISE EXCEPTION 'NFC HTTP audit failure injected'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER nfc_http_reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION nfc_http_reject_audit();`);
    const auditFailed=await request(confirmPath,{method:'POST',token:tokenA,body:confirmBody});assert.equal(auditFailed.status,500);
    assert.equal((await pool.query('SELECT status FROM student_access_cards WHERE id=$1',[nfcIssue.data.id])).rows[0].status,'issued');
    await pool.query('DROP TRIGGER nfc_http_reject_audit ON audit_logs; DROP FUNCTION nfc_http_reject_audit()');
    const confirmedResponse=await fetch(`http://127.0.0.1:${HTTP_PORT}/api${confirmPath}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${tokenA}`},body:JSON.stringify(confirmBody)});
    assert.equal(confirmedResponse.status,200);await confirmedResponse.body.cancel();
    const confirmedAgain=await request(confirmPath,{method:'POST',token:tokenA,body:confirmBody});assert.equal(confirmedAgain.status,200);assert.equal(confirmedAgain.data.status,'active');
    const auditCount=await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='student_card_nfc_encoded'",[nfcIssue.data.id]);assert.equal(auditCount.rows[0].n,1);
    const badReplay=await request(confirmPath,{method:'POST',token:tokenA,body:{...confirmBody,operationId:randomUUID(),locked:true}});
    assert.equal(badReplay.status,409);assert.equal(badReplay.data.code,'STUDENT_CARD_NFC_OPERATION_MISMATCH');
    assert.equal((await pool.query('SELECT nfc_encoding_state FROM student_access_cards WHERE id=$1',[nfcIssue.data.id])).rows[0].nfc_encoding_state,'encoded');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='student_card_nfc_encoded'",[nfcIssue.data.id])).rows[0].n,1);
    const replacementBody={nfc:{uid:'04778899001122',tagType:'NTAG216'},operationId:randomUUID()};
    const replacementPath=`/student-cards/${nfcIssue.data.id}/replace`;
    const preparedNfc=await request(replacementPath,{method:'POST',token:tokenA,body:replacementBody});assert.equal(preparedNfc.status,200);assert.equal(preparedNfc.data.status,'issued');
    assert.equal((await pool.query('SELECT status FROM student_access_cards WHERE id=$1',[nfcIssue.data.id])).rows[0].status,'active');
    const replacementConfirmPath=`/student-cards/${preparedNfc.data.id}/nfc-confirm`;
    const replacementConfirmBody={...replacementBody.nfc,cardToken:preparedNfc.data.cardToken,locked:false,studentId:nfcStudent,operationId:replacementBody.operationId};
    const wrongReplacement=await request(replacementConfirmPath,{method:'POST',token:tokenA,body:{...replacementConfirmBody,operationId:nfcBody.operationId}});
    assert.equal(wrongReplacement.status,409);assert.equal(wrongReplacement.data.code,'STUDENT_CARD_NFC_OPERATION_MISMATCH');
    assert.equal((await pool.query('SELECT status FROM student_access_cards WHERE id=$1',[nfcIssue.data.id])).rows[0].status,'active');
    assert.equal((await pool.query('SELECT status FROM student_access_cards WHERE id=$1',[preparedNfc.data.id])).rows[0].status,'issued');
    const newConfirm=await request(replacementConfirmPath,{method:'POST',token:tokenA,body:replacementConfirmBody});assert.equal(newConfirm.status,200);
    assert.equal((await pool.query('SELECT status FROM student_access_cards WHERE id=$1',[nfcIssue.data.id])).rows[0].status,'replaced');
    const replacementReplay=await request(replacementPath,{method:'POST',token:tokenA,body:replacementBody});assert.equal(replacementReplay.status,200);assert.equal(replacementReplay.data.id,preparedNfc.data.id);assert.equal(replacementReplay.data.cardToken,undefined);
    await assertCardSecretsAbsent(pool,cardSecrets(preparedNfc.data.cardToken));
    // NFC-P0-RECOVERY-02 — GET /students/:id/cards materialises an expired reservation.
    const expStudent=randomUUID();
    await pool.query("INSERT INTO students(id,school_id,first_name,last_name,status) VALUES($1,$2,'Expired','Fixture','active')",[expStudent,schoolAId]);
    const expBody={studentId:expStudent,medium:'nfc',nfc:{uid:'04A0B1C2D3E4F5',tagType:'NTAG216'},operationId:randomUUID()};
    const expIssue=await request('/student-cards',{method:'POST',token:tokenA,body:expBody});assert.equal(expIssue.status,201);
    const expRetry=await request(`/student-cards/${expIssue.data.id}/nfc-retry`,{method:'POST',token:tokenA,body:{...expBody.nfc,operationId:randomUUID()}});
    assert.equal(expRetry.status,200);const expToken=expRetry.data.cardToken;assert.ok(expToken);
    await pool.query("UPDATE student_access_cards SET issued_at=clock_timestamp()-INTERVAL '31 minutes',nfc_reservation_expires_at=clock_timestamp()-INTERVAL '1 minute' WHERE id=$1",[expIssue.data.id]);
    const expAudits=async()=>(await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='student_card_nfc_reservation_expired'",[expIssue.data.id])).rows[0].n;
    const readerExp=await request(`/students/${expStudent}/cards`,{token:tokenTeacher});assert.equal(readerExp.status,200);
    assert.equal((readerExp.data.cards||readerExp.data)[0].status,'issued');assert.equal(await expAudits(),0);
    const crossExp=await request(`/students/${expStudent}/cards`,{token:tokenB});assert.equal(crossExp.status,404);assert.equal(await expAudits(),0);
    const listedExp=await request(`/students/${expStudent}/cards`,{token:tokenA});assert.equal(listedExp.status,200);assert.equal(listedExp.cacheControl,'no-store');
    const expCard=(listedExp.data.cards||listedExp.data)[0];
    assert.equal(expCard.status,'revoked');assert.equal(expCard.revokeReason,'nfc_reservation_expired');assert.equal(expCard.nfc.state,'pending');
    assert.equal(expCard.nfc.uid,expBody.nfc.uid);assert.equal(expCard.nfc.tagType,'NTAG216');assert.equal(JSON.stringify(listedExp.data).includes(expToken.split('.')[1]),false);
    await request(`/students/${expStudent}/cards`,{token:tokenA});assert.equal(await expAudits(),1);
    const expRecover=await request(`/student-cards/${expIssue.data.id}/nfc-recover`,{method:'POST',token:tokenA,body:{...expBody.nfc,cardToken:expToken,studentId:expStudent,operationId:randomUUID()}});
    assert.equal(expRecover.status,200,JSON.stringify(expRecover.data));assert.equal(expRecover.data.status,'active');assert.equal(expRecover.data.id,expIssue.data.id);
    assert.equal(JSON.stringify(expRecover.data).includes(expToken.split('.')[1]),false);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='student_card_nfc_reservation_recovered'",[expIssue.data.id])).rows[0].n,1);
    await assertCardSecretsAbsent(pool,cardSecrets(expToken));
    // NFC-P0-R2 — blank card: reopen the same row, write (simulated), confirm, then scan.
    const r2Student=randomUUID();
    await pool.query("INSERT INTO students(id,school_id,first_name,last_name,status) VALUES($1,$2,'Blank','Fixture','active')",[r2Student,schoolAId]);
    const r2Body={studentId:r2Student,medium:'nfc',nfc:{uid:'04B0C1D2E3F405',tagType:'NTAG213'},operationId:randomUUID()};
    const r2Issue=await request('/student-cards',{method:'POST',token:tokenA,body:r2Body});assert.equal(r2Issue.status,201);
    await pool.query("UPDATE student_access_cards SET issued_at=clock_timestamp()-INTERVAL '31 minutes',nfc_reservation_expires_at=clock_timestamp()-INTERVAL '1 minute' WHERE id=$1",[r2Issue.data.id]);
    assert.equal(((await request(`/students/${r2Student}/cards`,{token:tokenA})).data.cards)[0].status,'revoked');
    const r2Path=`/student-cards/${r2Issue.data.id}/nfc-reencode`;
    const r2Payload={...r2Body.nfc,studentId:r2Student,operationId:randomUUID()};
    const r2Teacher=await request(r2Path,{method:'POST',token:tokenTeacher,body:r2Payload});assert.equal(r2Teacher.status,403);
    const r2Cross=await request(r2Path,{method:'POST',token:tokenB,body:r2Payload});assert.ok([403,404].includes(r2Cross.status));
    assert.equal((await pool.query('SELECT status FROM student_access_cards WHERE id=$1',[r2Issue.data.id])).rows[0].status,'revoked');
    const r2Reopen=await request(r2Path,{method:'POST',token:tokenA,body:r2Payload});
    assert.equal(r2Reopen.status,200,JSON.stringify(r2Reopen.data));assert.equal(r2Reopen.cacheControl,'no-store');
    assert.equal(r2Reopen.data.id,r2Issue.data.id);assert.equal(r2Reopen.data.status,'issued');const r2Token=r2Reopen.data.cardToken;assert.ok(r2Token);
    const r2Replay=await request(r2Path,{method:'POST',token:tokenA,body:r2Payload});assert.equal(r2Replay.status,200);assert.equal(r2Replay.data.cardToken,undefined);
    const r2Confirm=await request(`/student-cards/${r2Issue.data.id}/nfc-confirm`,{method:'POST',token:tokenA,
      body:{...r2Body.nfc,cardToken:r2Token,locked:false,studentId:r2Student,operationId:r2Reopen.data.nfc.operationId}});
    assert.equal(r2Confirm.status,200,JSON.stringify(r2Confirm.data));assert.equal(r2Confirm.data.status,'active');assert.equal(r2Confirm.data.nfc.state,'encoded');
    const r2Scan=await request('/student-cards/scan',{method:'POST',token:tokenA,body:{cardToken:r2Token}});
    // Card accepted by the scan resolver (this fixture has no class enrollment, as line ~506).
    assert.equal(r2Scan.data?.code,STUDENT_CARD_ERROR.ENROLLMENT_UNRESOLVED,JSON.stringify(r2Scan.data));
    const r2Stale=await request('/student-cards/scan',{method:'POST',token:tokenA,body:{cardToken:`${r2Token.split('.')[0]}.${'A'.repeat(43)}`}});
    assert.notEqual(r2Stale.data?.code,STUDENT_CARD_ERROR.ENROLLMENT_UNRESOLVED);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM student_access_cards WHERE nfc_uid='04B0C1D2E3F405'")).rows[0].n,1);
    await assertCardSecretsAbsent(pool,cardSecrets(r2Token));
    // NFC-P0-R3-1 — read-only diagnosis by UID: RBAC, school isolation, minimal answer, audit, rate limit.
    const diag=(token,body)=>request('/student-cards/nfc-diagnose',{method:'POST',token,body});
    const r2PublicId=r2Token.split('.')[0];
    const diagBody={...r2Body.nfc,ndef:{state:'somafrik',publicId:r2PublicId},readOnly:false};
    let diagCallsA=0;
    const diagA=async(body)=>{diagCallsA+=1;return diag(tokenA,body);};
    const rowBefore=(await pool.query('SELECT row_to_json(c)::text AS r FROM student_access_cards c WHERE id=$1',[r2Issue.data.id])).rows[0].r;
    assert.equal((await diag(null,diagBody)).status,401);
    assert.equal((await diag(tokenTeacher,diagBody)).status,403);
    assert.equal((await diag(tokenAccountant,diagBody)).status,403);
    assert.equal((await diag(tokenSuper,diagBody)).status,403);
    const own=await diagA(diagBody);
    assert.equal(own.status,200,JSON.stringify(own.data));assert.equal(own.cacheControl,'no-store');
    assert.equal(own.data.code,'ACTIVE');assert.equal(own.data.physical,'SOMAFRIK_THIS_CARD');assert.equal(own.data.sameSchool,true);
    assert.equal(own.data.card.id,r2Issue.data.id);assert.equal(own.data.holder.id,r2Student);
    assert.doesNotMatch(JSON.stringify(own.data),/token_hash|tokenHash|cardToken|public_?id|operation/i);
    await pool.query('UPDATE school_settings SET student_card_nfc_enabled=TRUE WHERE school_id=$1',[schoolBId]);
    const cross=await diag(tokenB,{...diagBody,ndef:{state:'empty'}});
    assert.equal(cross.status,200,JSON.stringify(cross.data));
    assert.deepEqual(Object.keys(cross.data).sort(),['actions','code','message','physical','physicalMessage','physicalSource','recoverable','sameSchool']);
    assert.equal(own.data.physicalSource,'client_declared');assert.equal(cross.data.physicalSource,'client_declared');
    assert.equal(cross.data.code,'OTHER_SCHOOL');assert.equal(cross.data.sameSchool,false);assert.deepEqual(cross.data.actions,['contact_owner_school']);
    const crossText=JSON.stringify(cross.data);
    for (const leak of [r2Issue.data.id,r2Student,'Blank','Fixture','active','revoked','04B0C1D2E3F405'])
      assert.equal(crossText.includes(leak),false,`cross-school leak: ${leak}`);
    const unknown=await diagA({uid:'04FFEEDDCCBBAA',tagType:'NTAG216',ndef:{state:'empty'},readOnly:false});
    assert.equal(unknown.status,200);assert.equal(unknown.data.code,'UID_UNKNOWN');assert.deepEqual(unknown.data.actions,['program_new_card']);
    const badInput=await diagA({...r2Body.nfc,ndef:{state:'somafrik',publicId:r2Token},readOnly:false});
    assert.equal(badInput.status,400,'a full token is never accepted as publicId');
    // Read-only: the card row is byte-identical; only diagnosis audits were written.
    assert.equal((await pool.query('SELECT row_to_json(c)::text AS r FROM student_access_cards c WHERE id=$1',[r2Issue.data.id])).rows[0].r,rowBefore);
    const diagAudits=(await pool.query("SELECT entity_id,new_value::text AS v FROM audit_logs WHERE action='student_card_nfc_diagnosed' ORDER BY created_at")).rows;
    assert.equal(diagAudits.length,3);
    assert.equal(diagAudits[0].entity_id,r2Issue.data.id);assert.equal(diagAudits[1].entity_id,null);
    for (const a of diagAudits){assert.doesNotMatch(a.v,/04B0C1D2E3F405|04FFEEDDCCBBAA/);assert.equal(a.v.includes(r2PublicId),false);assert.match(a.v,/04••••••••/);}
    await assertCardSecretsAbsent(pool,cardSecrets(r2Token));
    // Per-user rate limit (12 per window in this run): A is throttled, B is not.
    let limited=null;
    while (diagCallsA<=12) { const res=await diagA(diagBody); if (res.status===429){limited=diagCallsA;break;} }
    assert.equal(limited,13,'13th diagnosis of the same user is throttled');
    assert.equal((await diag(tokenB,{...diagBody,ndef:{state:'empty'}})).status,200);
    await pool.query('UPDATE school_settings SET student_card_nfc_enabled=FALSE WHERE school_id=$1',[schoolAId]);
    const flagsDenied=await request(confirmPath,{method:'POST',token:tokenA,body:confirmBody});assert.equal(flagsDenied.status,404);
    await assertCardSecretsAbsent(pool,cardSecrets(nfcToken));
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
