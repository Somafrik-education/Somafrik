"use strict";

/**
 * CARTE-BATCH-API-02 — protocole HTTP + PostgreSQL local jetable.
 * Préparation, accusé technique, sauvegarde, activation, coupures et absence de secret en clair.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const {
  prepareClassCardBatch,
  recordBatchReceipt,
  activateClassCardBatch,
} = require("./studentCardBatchIssue");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_CARD_BATCH_HTTP_IT_DATABASE ?? "somafrik_carte_batch_api02_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_CARD_BATCH_HTTP_PORT ?? 19891);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LOGIN_A = "CD-BAT-26-001";
const LOGIN_B = "BI-BAT-26-002";
const CODE_A = "CD-2026-B02A";
const CODE_B = "BI-2026-B02B";
const USER_A = "dddddddd-dddd-4ddd-8ddd-0000000000a1";
const USER_B = "dddddddd-dddd-4ddd-8ddd-0000000000b1";
const USER_ACCOUNTANT = "dddddddd-dddd-4ddd-8ddd-0000000000c1";
const USER_SUPER = "dddddddd-dddd-4ddd-8ddd-0000000000d1";

const STUDENTS = {
  h1: "dddddddd-dddd-4ddd-8ddd-000000000011",
  h2: "dddddddd-dddd-4ddd-8ddd-000000000012",
  cut: "dddddddd-dddd-4ddd-8ddd-000000000013",
  exp: "dddddddd-dddd-4ddd-8ddd-000000000014",
  act: "dddddddd-dddd-4ddd-8ddd-000000000015",
  act2: "dddddddd-dddd-4ddd-8ddd-000000000016",
  c1: "dddddddd-dddd-4ddd-8ddd-000000000017",
  c2: "dddddddd-dddd-4ddd-8ddd-000000000018",
  fail: "dddddddd-dddd-4ddd-8ddd-000000000019",
  fact: "dddddddd-dddd-4ddd-8ddd-00000000001a",
  undet: "dddddddd-dddd-4ddd-8ddd-00000000001b",
  flag: "dddddddd-dddd-4ddd-8ddd-00000000001c",
  skip: "dddddddd-dddd-4ddd-8ddd-00000000001d",
};

const CLASSES = {
  happy: ["CB02-HAPPY", ["h1", "h2"]],
  cut: ["CB02-CUT", ["cut"]],
  exp: ["CB02-EXP", ["exp"]],
  act: ["CB02-ACT", ["act", "act2"]],
  empty: ["CB02-EMPTY", []],
  conc: ["CB02-CONC", ["c1", "c2"]],
  fail: ["CB02-FAIL", ["fail"]],
  fact: ["CB02-FACT", ["fact"]],
  undet: ["CB02-UNDET", ["undet"]],
  flag: ["CB02-FLAG", ["flag"]],
  skip: ["CB02-SKIP", ["skip"]],
};

function assertDisposableTarget(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`Refus: hôte PostgreSQL non local (${host}).`);
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (/prod|preprod/i.test(`${host} ${name} ${IT_DATABASE}`)) {
    throw new Error("Refus: cible prod ou préprod.");
  }
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

function brief(data) {
  if (!data || typeof data !== "object") return String(data ?? "");
  return JSON.stringify({
    code: data.code,
    message: data.message,
    status: data.status,
    batchId: data.batchId,
    secretsIncluded: data.secretsIncluded,
    counts: data.counts,
  });
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
    data = { message: text.slice(0, 180) };
  }
  return { status: response.status, data, cacheControl: response.headers.get("cache-control") };
}

function splitToken(cardToken) {
  const value = String(cardToken ?? "");
  const dot = value.indexOf(".");
  assert.ok(dot > 0, "jeton incomplet");
  return { publicId: value.slice(0, dot), secret: value.slice(dot + 1), cardToken: value };
}

function proofsFrom(entries) {
  return entries
    .filter((entry) => entry.cardToken)
    .map((entry) => {
      const parts = splitToken(entry.cardToken);
      return { publicId: parts.publicId, secret: parts.secret };
    });
}

function assertPublicPayload(data, secrets) {
  const text = JSON.stringify(data ?? {});
  assert.equal(Object.prototype.hasOwnProperty.call(data ?? {}, "deliveryNonce"), false);
  assert.equal(text.includes("cardToken"), false);
  assert.equal(text.includes("token_hash"), false);
  assert.equal(data?.secretsIncluded, false);
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false);
  }
}

async function countSecretHits(pool, secrets) {
  const dumped = await pool.query(`
    SELECT row_to_json(c)::text AS payload FROM student_access_cards c
    UNION ALL
    SELECT row_to_json(b)::text FROM student_card_batches b
    UNION ALL
    SELECT row_to_json(i)::text FROM student_card_batch_items i
    UNION ALL
    SELECT coalesce(new_value::text, '') FROM audit_logs
    UNION ALL
    SELECT coalesce(response_body::text, '') FROM idempotency_keys
  `);
  let hits = 0;
  for (const secret of secrets) {
    if (!secret) continue;
    for (const row of dumped.rows) {
      if (String(row.payload).includes(secret)) hits += 1;
    }
  }
  return hits;
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value.slice(-2000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value.slice(-2000)}`);
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
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, iso, phone, currency],
  );
  return inserted.rows[0];
}

async function seed(pool) {
  await setLoginCodeTriggers(pool, false);
  const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
  const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
  const schoolA = (await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, school_type, status)
     VALUES ($1, $2, $3, 'BAT', 'Lycée Batch', 'Lycée', 'active') RETURNING id`,
    [cd.id, CODE_A, LOGIN_A],
  )).rows[0];
  const schoolB = (await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, school_type, status)
     VALUES ($1, $2, $3, 'BUB', 'Lycée Autre', 'Lycée', 'active') RETURNING id`,
    [bi.id, CODE_B, LOGIN_B],
  )).rows[0];
  await setLoginCodeTriggers(pool, true);
  await pool.query(`ALTER TABLE users DISABLE TRIGGER users_permanent_identity_insert`);
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $5, 'ADM-B02', 'Aline', 'Batch', 'aline@batch.gp.test', 'Admin School', 'active', FALSE),
       ($2, $6, 'ADM-B02B', 'Binta', 'Autre', 'binta@batch.gp.test', 'Admin School', 'active', FALSE),
       ($3, $5, 'CPT-B02', 'Dora', 'C', 'dora@batch.gp.test', 'Comptable', 'active', FALSE),
       ($4, NULL, 'SUP-B02', 'Super', 'Admin', 'super@batch.gp.test', 'Super Administrateur Somafrik', 'active', FALSE)`,
    [USER_A, USER_B, USER_ACCOUNTANT, USER_SUPER, schoolA.id, schoolB.id],
  );
  await pool.query(`ALTER TABLE users ENABLE TRIGGER users_permanent_identity_insert`);
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $5, 'SCHOOL_ADMIN', 'active'),
       ($2, $6, 'SCHOOL_ADMIN', 'active'),
       ($3, $5, 'ACCOUNTANT', 'active'),
       ($4, NULL, 'SUPER_ADMIN', 'active')`,
    [USER_A, USER_B, USER_ACCOUNTANT, USER_SUPER, schoolA.id, schoolB.id],
  );
  const studentRows = Object.entries(STUDENTS);
  for (const [key, id] of studentRows) {
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
       VALUES ($1, $2, $3, 'Eleve', $4, 'active')`,
      [id, schoolA.id, `STU-B02-${key.toUpperCase()}`, key],
    );
  }
  const yearA = (await pool.query(
    `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1, '2026-2027', TRUE, 'open') RETURNING id`,
    [schoolA.id],
  )).rows[0];
  const classIds = {};
  for (const [key, [code, members]] of Object.entries(CLASSES)) {
    const created = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [schoolA.id, yearA.id, code, code],
    )).rows[0];
    classIds[key] = created.id;
    for (const member of members) {
      await pool.query(
        `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
         VALUES ($1, $2, $3, $4, 'ENROLLED')`,
        [schoolA.id, STUDENTS[member], created.id, yearA.id],
      );
    }
  }
  await pool.query(
    `INSERT INTO school_settings (school_id, student_card_enabled, student_card_qr_enabled, student_card_holder_kind)
     VALUES ($1, TRUE, TRUE, 'eleve'), ($2, TRUE, TRUE, 'eleve')
     ON CONFLICT (school_id) DO UPDATE SET
       student_card_enabled = TRUE,
       student_card_qr_enabled = TRUE,
       student_card_holder_kind = 'eleve'`,
    [schoolA.id, schoolB.id],
  );
  return { schoolAId: schoolA.id, schoolBId: schoolB.id, classIds };
}

async function cardRow(pool, cardId) {
  const found = await pool.query(
    `SELECT id, public_id, token_hash, status, medium, nfc_uid, nfc_operation_id, nfc_encoding_state, revoke_reason
       FROM student_access_cards WHERE id = $1`,
    [cardId],
  );
  return found.rows[0];
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentCardBatchIssue.http.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  assertDisposableTarget(DATABASE_URL);
  if (!IT_DATABASE) throw new Error("Nom de base de test vide.");

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  assertDisposableTarget(isolatedUrl);
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
  const secrets = [];

  try {
    await repo.init();
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    const { schoolAId } = await seed(pool);
    const scope = { mode: "school", schoolId: schoolAId };
    const principal = { sub: USER_A };

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
        DB_SSL: "false",
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
      schoolCode: CODE_A,
      permissions: ["Élèves:UPDATE", "Gérer élèves", "Présences:CREATE", "Présences:UPDATE"],
    });
    const tokenB = mint({
      sub: USER_B,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: CODE_B,
      permissions: ["Élèves:UPDATE", "Gérer élèves"],
    });
    const tokenAccountant = mint({
      sub: USER_ACCOUNTANT,
      role: "Comptable",
      roleKeys: ["ACCOUNTANT"],
      schoolCode: CODE_A,
      permissions: ["Paiements:READ"],
    });
    const tokenSuper = mint({
      sub: USER_SUPER,
      role: "Super Administrateur Somafrik",
      roleKeys: ["SUPER_ADMIN"],
      schoolCode: LOGIN_A,
      permissions: ["ALL_PRIVILEGES", "Élèves:UPDATE"],
    });

    const anonymous = await request("/classes/CB02-HAPPY/student-cards/batches", { method: "POST", body: {} });
    assert.equal(anonymous.status, 401, brief(anonymous.data));

    const accountant = await request("/classes/CB02-HAPPY/student-cards/batches", {
      method: "POST",
      token: tokenAccountant,
      body: {},
    });
    assert.equal(accountant.status, 403, brief(accountant.data));
    assert.equal(accountant.data?.code, "PERMISSION_DENIED");

    const superadmin = await request("/classes/CB02-HAPPY/student-cards/batches", {
      method: "POST",
      token: tokenSuper,
      body: {},
    });
    assert.equal(superadmin.status, 403, brief(superadmin.data));
    assert.equal(superadmin.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    assert.equal(JSON.stringify(superadmin.data).includes(STUDENTS.h1), false);

    const cross = await request("/classes/CB02-HAPPY/student-cards/batches", { method: "POST", token: tokenB, body: {} });
    assert.equal(cross.status, 404, brief(cross.data));
    assert.equal(cross.data?.code, "STUDENT_CARD_CLASS_NOT_FOUND");
    assert.equal(JSON.stringify(cross.data).includes(STUDENTS.h1), false);

    await pool.query(`UPDATE school_settings SET student_card_qr_enabled = FALSE WHERE school_id = $1`, [schoolAId]);
    const qrOff = await request("/classes/CB02-FLAG/student-cards/batches", { method: "POST", token: tokenA, body: {} });
    assert.equal(qrOff.status, 409, brief(qrOff.data));
    assert.equal(qrOff.data?.code, "STUDENT_CARD_QR_DISABLED");
    await pool.query(`UPDATE school_settings SET student_card_enabled = FALSE WHERE school_id = $1`, [schoolAId]);
    const masterOff = await request("/classes/CB02-FLAG/student-cards/batches", { method: "POST", token: tokenA, body: {} });
    assert.equal(masterOff.status, 404, brief(masterOff.data));
    assert.equal(masterOff.data?.code, "STUDENT_CARD_DISABLED");
    await pool.query(
      `UPDATE school_settings SET student_card_enabled = TRUE, student_card_qr_enabled = TRUE WHERE school_id = $1`,
      [schoolAId],
    );
    const flagCards = await pool.query(`SELECT count(*)::int AS n FROM student_access_cards WHERE student_id = $1`, [STUDENTS.flag]);
    assert.equal(flagCards.rows[0].n, 0);

    const empty = await request("/classes/CB02-EMPTY/student-cards/batches", { method: "POST", token: tokenA, body: {} });
    assert.equal(empty.status, 200, brief(empty.data));
    assert.equal(empty.cacheControl, "no-store");
    assert.equal(empty.data.batchId, null);
    assert.equal(empty.data.status, "not_prepared");
    assert.equal(empty.data.secretsIncluded, false);

    await pool.query(`UPDATE schools SET school_type = 'Institut' WHERE id = $1`, [schoolAId]);
    await pool.query(`UPDATE school_settings SET student_card_holder_kind = NULL WHERE school_id = $1`, [schoolAId]);
    const undetermined = await request("/classes/CB02-UNDET/student-cards/batches", { method: "POST", token: tokenA, body: {} });
    assert.equal(undetermined.status, 200, brief(undetermined.data));
    assert.equal(undetermined.data.status, "not_prepared");
    assert.equal(undetermined.data.entries?.[0]?.decision, "ineligible");
    assert.equal(undetermined.data.entries?.[0]?.reason, "HOLDER_UNDETERMINED");
    const undetCards = await pool.query(`SELECT count(*)::int AS n FROM student_access_cards WHERE student_id = $1`, [STUDENTS.undet]);
    assert.equal(undetCards.rows[0].n, 0);
    await pool.query(`UPDATE schools SET school_type = 'Lycée' WHERE id = $1`, [schoolAId]);
    await pool.query(`UPDATE school_settings SET student_card_holder_kind = 'eleve' WHERE school_id = $1`, [schoolAId]);

    const prepared = await request("/classes/CB02-HAPPY/student-cards/batches", {
      method: "POST",
      token: tokenA,
      body: { students: [{ studentId: STUDENTS.h1, hasActiveCard: false }], failAfterInsert: true },
    });
    assert.equal(prepared.status, 201, brief(prepared.data));
    assert.equal(prepared.cacheControl, "no-store");
    assert.equal(prepared.data.secretsIncluded, true);
    assert.equal(prepared.data.status, "prepared");
    assert.ok(prepared.data.deliveryNonce);
    assert.equal(prepared.data.counts.prepared, 2);
    const happyEntries = prepared.data.entries.filter((entry) => entry.decision === "prepared");
    assert.equal(happyEntries.length, 2);
    const happyProofs = proofsFrom(happyEntries);
    secrets.push(prepared.data.deliveryNonce, ...happyProofs.map((proof) => proof.secret), ...happyEntries.map((entry) => entry.cardToken));
    for (const entry of happyEntries) {
      const row = await cardRow(pool, entry.cardId);
      assert.equal(row.status, "issued");
      assert.equal(row.medium, "qr");
      assert.equal(row.nfc_uid, null);
      assert.equal(row.nfc_operation_id, null);
      assert.equal(row.nfc_encoding_state, null);
      assert.equal(row.public_id, entry.publicId);
      const parts = splitToken(entry.cardToken);
      assert.equal(parts.publicId, entry.publicId);
    }
    assert.equal(await countSecretHits(pool, secrets), 0);

    const viewed = await request(`/classes/CB02-HAPPY/student-cards/batches/${prepared.data.batchId}`, { token: tokenA });
    assert.equal(viewed.status, 200, brief(viewed.data));
    assert.equal(viewed.cacheControl, "no-store");
    assertPublicPayload(viewed.data, secrets);

    const pending = await request("/classes/CB02-HAPPY/student-cards/batches", { method: "POST", token: tokenA, body: {} });
    assert.equal(pending.status, 409, brief(pending.data));
    assert.equal(pending.cacheControl, "no-store");
    assert.equal(pending.data?.code, "STUDENT_CARD_BATCH_PENDING");
    assert.equal(pending.data?.details?.batchId, prepared.data.batchId);
    assert.equal(pending.data?.details?.secretsRecoverable, false);
    assert.equal(JSON.stringify(pending.data).includes("cardToken"), false);
    assert.equal(JSON.stringify(pending.data).includes(prepared.data.deliveryNonce), false);

    for (const entry of happyEntries) {
      const scanIssued = await request("/student-cards/scan", {
        method: "POST",
        token: tokenA,
        body: { cardToken: entry.cardToken },
      });
      assert.equal(scanIssued.status, 409, brief(scanIssued.data));
      assert.equal(scanIssued.data?.code, "STUDENT_CARD_INVALID_STATE");
      assert.equal(JSON.stringify(scanIssued.data).includes(splitToken(entry.cardToken).secret), false);
    }

    const savedTooSoon = await request(`/classes/CB02-HAPPY/student-cards/batches/${prepared.data.batchId}/receipt`, {
      method: "POST",
      token: tokenA,
      body: { kind: "saved", proofs: happyProofs },
    });
    assert.equal(savedTooSoon.status, 409, brief(savedTooSoon.data));
    assert.equal(savedTooSoon.data?.code, "STUDENT_CARD_BATCH_RECEIPT_REQUIRED");

    const activateTooSoon = await request(`/classes/CB02-HAPPY/student-cards/batches/${prepared.data.batchId}/activate`, {
      method: "POST",
      token: tokenA,
      body: { proofs: happyProofs },
    });
    assert.equal(activateTooSoon.status, 409, brief(activateTooSoon.data));
    assert.equal(activateTooSoon.data?.code, "STUDENT_CARD_BATCH_SAVE_REQUIRED");

    const badNonce = await request(`/classes/CB02-HAPPY/student-cards/batches/${prepared.data.batchId}/receipt`, {
      method: "POST",
      token: tokenA,
      body: { kind: "technical", deliveryNonce: "nonce-incorrect" },
    });
    assert.equal(badNonce.status, 409, brief(badNonce.data));
    assert.equal(badNonce.data?.code, "STUDENT_CARD_BATCH_PROOF_INVALID");

    const technical = await request(`/classes/CB02-HAPPY/student-cards/batches/${prepared.data.batchId}/receipt`, {
      method: "POST",
      token: tokenA,
      body: { kind: "technical", deliveryNonce: prepared.data.deliveryNonce },
    });
    assert.equal(technical.status, 200, brief(technical.data));
    assert.equal(technical.cacheControl, "no-store");
    assert.equal(technical.data.status, "received");
    assertPublicPayload(technical.data, secrets);
    for (const entry of happyEntries) {
      assert.equal((await cardRow(pool, entry.cardId)).status, "issued");
    }

    const stillTooSoon = await request(`/classes/CB02-HAPPY/student-cards/batches/${prepared.data.batchId}/activate`, {
      method: "POST",
      token: tokenA,
      body: { proofs: happyProofs },
    });
    assert.equal(stillTooSoon.status, 409);
    assert.equal(stillTooSoon.data?.code, "STUDENT_CARD_BATCH_SAVE_REQUIRED");

    const badSave = await request(`/classes/CB02-HAPPY/student-cards/batches/${prepared.data.batchId}/receipt`, {
      method: "POST",
      token: tokenA,
      body: {
        kind: "saved",
        proofs: happyProofs.map((proof, index) => (index === 0 ? { ...proof, secret: "secret-incorrect" } : proof)),
      },
    });
    assert.equal(badSave.status, 409, brief(badSave.data));
    assert.equal(badSave.data?.code, "STUDENT_CARD_BATCH_PROOF_INVALID");
    assert.equal((await pool.query(`SELECT status FROM student_card_batches WHERE id = $1`, [prepared.data.batchId])).rows[0].status, "received");

    const saved = await request(`/classes/CB02-HAPPY/student-cards/batches/${prepared.data.batchId}/receipt`, {
      method: "POST",
      token: tokenA,
      body: { kind: "saved", proofs: happyProofs },
    });
    assert.equal(saved.status, 200, brief(saved.data));
    assert.equal(saved.data.status, "saved");
    assertPublicPayload(saved.data, secrets);
    for (const entry of happyEntries) {
      assert.equal((await cardRow(pool, entry.cardId)).status, "issued");
    }

    const badActivate = await request(`/classes/CB02-HAPPY/student-cards/batches/${prepared.data.batchId}/activate`, {
      method: "POST",
      token: tokenA,
      body: {
        proofs: happyProofs.map((proof, index) => (index === 1 ? { ...proof, secret: "autre-secret-incorrect" } : proof)),
      },
    });
    assert.equal(badActivate.status, 409, brief(badActivate.data));
    assert.equal(badActivate.data?.code, "STUDENT_CARD_BATCH_PROOF_INVALID");
    for (const entry of happyEntries) {
      assert.equal((await cardRow(pool, entry.cardId)).status, "issued");
    }
    assert.equal((await pool.query(`SELECT status FROM student_card_batches WHERE id = $1`, [prepared.data.batchId])).rows[0].status, "saved");

    const before = {};
    for (const entry of happyEntries) before[entry.cardId] = await cardRow(pool, entry.cardId);

    const activated = await request(`/classes/CB02-HAPPY/student-cards/batches/${prepared.data.batchId}/activate`, {
      method: "POST",
      token: tokenA,
      body: { proofs: happyProofs },
    });
    assert.equal(activated.status, 200, brief(activated.data));
    assert.equal(activated.cacheControl, "no-store");
    assert.equal(activated.data.status, "activated");
    assert.equal(activated.data.counts.activated, 2);
    assertPublicPayload(activated.data, secrets);
    for (const entry of happyEntries) {
      const row = await cardRow(pool, entry.cardId);
      assert.equal(row.id, before[entry.cardId].id);
      assert.equal(row.public_id, before[entry.cardId].public_id);
      assert.equal(row.token_hash, before[entry.cardId].token_hash);
      assert.equal(row.status, "active");
      assert.equal(row.medium, "qr");
      assert.equal(row.nfc_uid, null);
      assert.equal(row.nfc_operation_id, null);
      const scan = await request("/student-cards/scan", {
        method: "POST",
        token: tokenA,
        body: { cardToken: entry.cardToken },
      });
      assert.equal(scan.status, 200, brief(scan.data));
      assert.equal(scan.data?.card?.status, "active");
      assert.equal(JSON.stringify(scan.data).includes(splitToken(entry.cardToken).secret), false);
    }

    const activatedAgain = await request(`/classes/CB02-HAPPY/student-cards/batches/${prepared.data.batchId}/activate`, {
      method: "POST",
      token: tokenA,
      body: { proofs: happyProofs },
    });
    assert.equal(activatedAgain.status, 200, brief(activatedAgain.data));
    assertPublicPayload(activatedAgain.data, secrets);
    for (const entry of happyEntries) {
      const row = await cardRow(pool, entry.cardId);
      assert.equal(row.token_hash, before[entry.cardId].token_hash);
      assert.equal(row.status, "active");
      const count = await pool.query(
        `SELECT count(*)::int AS n FROM student_access_cards WHERE student_id = $1`,
        [entry.studentId],
      );
      assert.equal(count.rows[0].n, 1);
    }

    const abortActivated = await request(`/classes/CB02-HAPPY/student-cards/batches/${prepared.data.batchId}/abort`, {
      method: "POST",
      token: tokenA,
      body: {},
    });
    assert.equal(abortActivated.status, 409, brief(abortActivated.data));
    assert.equal(abortActivated.data?.code, "STUDENT_CARD_BATCH_ACTIVATED");

    const wrongClass = await request(`/classes/CB02-EMPTY/student-cards/batches/${prepared.data.batchId}/receipt`, {
      method: "POST",
      token: tokenA,
      body: { kind: "technical", deliveryNonce: prepared.data.deliveryNonce },
    });
    assert.equal(wrongClass.status, 404, brief(wrongClass.data));
    assert.equal(wrongClass.data?.code, "STUDENT_CARD_BATCH_NOT_FOUND");

    const cut = await request("/classes/CB02-CUT/student-cards/batches", { method: "POST", token: tokenA, body: {} });
    assert.equal(cut.status, 201, brief(cut.data));
    const cutEntry = cut.data.entries.find((entry) => entry.cardToken);
    const cutParts = splitToken(cutEntry.cardToken);
    secrets.push(cut.data.deliveryNonce, cutParts.secret, cutEntry.cardToken);
    const cutAgain = await request("/classes/CB02-CUT/student-cards/batches", { method: "POST", token: tokenA, body: {} });
    assert.equal(cutAgain.status, 409);
    assert.equal(cutAgain.data?.details?.batchId, cut.data.batchId);
    assert.equal(cutAgain.data?.details?.secretsRecoverable, false);
    assert.equal(JSON.stringify(cutAgain.data).includes(cutParts.secret), false);
    const cutSaved = await request(`/classes/CB02-CUT/student-cards/batches/${cut.data.batchId}/receipt`, {
      method: "POST",
      token: tokenA,
      body: { kind: "saved", proofs: [{ publicId: cutParts.publicId, secret: cutParts.secret }] },
    });
    assert.equal(cutSaved.status, 409);
    assert.equal(cutSaved.data?.code, "STUDENT_CARD_BATCH_RECEIPT_REQUIRED");
    const cutActivate = await request(`/classes/CB02-CUT/student-cards/batches/${cut.data.batchId}/activate`, {
      method: "POST",
      token: tokenA,
      body: { proofs: [{ publicId: cutParts.publicId, secret: cutParts.secret }] },
    });
    assert.equal(cutActivate.status, 409);
    assert.equal(cutActivate.data?.code, "STUDENT_CARD_BATCH_SAVE_REQUIRED");
    const aborted = await request(`/classes/CB02-CUT/student-cards/batches/${cut.data.batchId}/abort`, {
      method: "POST",
      token: tokenA,
      body: {},
    });
    assert.equal(aborted.status, 200, brief(aborted.data));
    assert.equal(aborted.data.status, "aborted");
    assertPublicPayload(aborted.data, secrets);
    const abortedCard = await cardRow(pool, cutEntry.cardId);
    assert.equal(abortedCard.status, "revoked");
    assert.equal(abortedCard.revoke_reason, "batch_delivery_aborted");
    const cutNext = await request("/classes/CB02-CUT/student-cards/batches", { method: "POST", token: tokenA, body: {} });
    assert.equal(cutNext.status, 201, brief(cutNext.data));
    const cutNextEntry = cutNext.data.entries.find((entry) => entry.cardToken);
    assert.notEqual(cutNextEntry.cardId, cutEntry.cardId);
    assert.equal(JSON.stringify(cutNext.data).includes(cutParts.secret), false);
    secrets.push(cutNext.data.deliveryNonce, splitToken(cutNextEntry.cardToken).secret, cutNextEntry.cardToken);
    const oldScan = await request("/student-cards/scan", {
      method: "POST",
      token: tokenA,
      body: { cardToken: cutEntry.cardToken },
    });
    assert.equal(oldScan.status, 409, brief(oldScan.data));
    assert.equal(oldScan.data?.code, "STUDENT_CARD_INVALID_STATE");
    await request(`/classes/CB02-CUT/student-cards/batches/${cutNext.data.batchId}/abort`, { method: "POST", token: tokenA, body: {} });

    const expiredPrep = await request("/classes/CB02-EXP/student-cards/batches", { method: "POST", token: tokenA, body: {} });
    assert.equal(expiredPrep.status, 201, brief(expiredPrep.data));
    const expiredEntry = expiredPrep.data.entries.find((entry) => entry.cardToken);
    const expiredSecret = splitToken(expiredEntry.cardToken).secret;
    secrets.push(expiredPrep.data.deliveryNonce, expiredSecret, expiredEntry.cardToken);
    await pool.query(
      `UPDATE student_card_batches SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [expiredPrep.data.batchId],
    );
    const renewed = await request("/classes/CB02-EXP/student-cards/batches", { method: "POST", token: tokenA, body: {} });
    assert.equal(renewed.status, 201, brief(renewed.data));
    assert.notEqual(renewed.data.batchId, expiredPrep.data.batchId);
    assert.equal(JSON.stringify(renewed.data).includes(expiredSecret), false);
    secrets.push(renewed.data.deliveryNonce, ...proofsFrom(renewed.data.entries).map((proof) => proof.secret));
    const expiredCard = await cardRow(pool, expiredEntry.cardId);
    assert.equal(expiredCard.status, "revoked");
    assert.equal(expiredCard.revoke_reason, "batch_delivery_expired");
    const oldBatch = await pool.query(`SELECT status FROM student_card_batches WHERE id = $1`, [expiredPrep.data.batchId]);
    assert.equal(oldBatch.rows[0].status, "expired");
    await request(`/classes/CB02-EXP/student-cards/batches/${renewed.data.batchId}/abort`, { method: "POST", token: tokenA, body: {} });

    const issuedActive = await request("/student-cards", {
      method: "POST",
      token: tokenA,
      body: { studentId: STUDENTS.act, medium: "qr" },
    });
    assert.equal(issuedActive.status, 201, brief(issuedActive.data));
    secrets.push(issuedActive.data.cardToken, issuedActive.data.cardToken.split(".")[1]);
    const activeBefore = await cardRow(pool, issuedActive.data.id);
    const mixed = await request("/classes/CB02-ACT/student-cards/batches", {
      method: "POST",
      token: tokenA,
      body: { students: [{ studentId: STUDENTS.act, hasActiveCard: false }] },
    });
    assert.equal(mixed.status, 201, brief(mixed.data));
    const already = mixed.data.entries.find((entry) => entry.studentId === STUDENTS.act);
    const fresh = mixed.data.entries.find((entry) => entry.studentId === STUDENTS.act2);
    assert.equal(already.decision, "already_active");
    assert.equal(already.cardToken, undefined);
    assert.equal(fresh.decision, "prepared");
    assert.ok(fresh.cardToken);
    secrets.push(mixed.data.deliveryNonce, splitToken(fresh.cardToken).secret, fresh.cardToken);
    const activeAfter = await cardRow(pool, issuedActive.data.id);
    assert.equal(activeAfter.status, "active");
    assert.equal(activeAfter.token_hash, activeBefore.token_hash);
    assert.equal(activeAfter.public_id, activeBefore.public_id);
    const activeCount = await pool.query(
      `SELECT count(*)::int AS n FROM student_access_cards WHERE student_id = $1`,
      [STUDENTS.act],
    );
    assert.equal(activeCount.rows[0].n, 1);
    await request(`/classes/CB02-ACT/student-cards/batches/${mixed.data.batchId}/abort`, { method: "POST", token: tokenA, body: {} });

    const [first, second] = await Promise.all([
      request("/classes/CB02-CONC/student-cards/batches", { method: "POST", token: tokenA, body: {} }),
      request("/classes/CB02-CONC/student-cards/batches", { method: "POST", token: tokenA, body: {} }),
    ]);
    const outcomes = [first, second].map((item) => item.status).sort();
    assert.deepEqual(outcomes, [201, 409], outcomes.join(","));
    const winner = first.status === 201 ? first : second;
    secrets.push(winner.data.deliveryNonce, ...proofsFrom(winner.data.entries).flatMap((proof) => [proof.secret]));
    for (const entry of winner.data.entries.filter((item) => item.cardToken)) {
      secrets.push(entry.cardToken);
    }
    const concCards = await pool.query(
      `SELECT student_id, count(*)::int AS n
         FROM student_access_cards
        WHERE student_id = ANY($1::uuid[])
        GROUP BY student_id`,
      [[STUDENTS.c1, STUDENTS.c2]],
    );
    assert.equal(concCards.rowCount, 2);
    for (const row of concCards.rows) assert.equal(row.n, 1);
    await request(`/classes/CB02-CONC/student-cards/batches/${winner.data.batchId}/abort`, { method: "POST", token: tokenA, body: {} });

    const skipPrep = await request("/classes/CB02-SKIP/student-cards/batches", { method: "POST", token: tokenA, body: {} });
    assert.equal(skipPrep.status, 201, brief(skipPrep.data));
    const skipEntry = skipPrep.data.entries.find((entry) => entry.cardToken);
    const skipProof = proofsFrom([skipEntry]);
    secrets.push(skipPrep.data.deliveryNonce, skipProof[0].secret, skipEntry.cardToken);
    const skipTechnical = await request(`/classes/CB02-SKIP/student-cards/batches/${skipPrep.data.batchId}/receipt`, {
      method: "POST",
      token: tokenA,
      body: { kind: "technical", deliveryNonce: skipPrep.data.deliveryNonce },
    });
    assert.equal(skipTechnical.status, 200, brief(skipTechnical.data));
    const skipSaved = await request(`/classes/CB02-SKIP/student-cards/batches/${skipPrep.data.batchId}/receipt`, {
      method: "POST",
      token: tokenA,
      body: { kind: "saved", proofs: skipProof },
    });
    assert.equal(skipSaved.status, 200, brief(skipSaved.data));
    const rival = await request("/student-cards", {
      method: "POST",
      token: tokenA,
      body: { studentId: STUDENTS.skip, medium: "qr" },
    });
    assert.equal(rival.status, 201, brief(rival.data));
    secrets.push(rival.data.cardToken, rival.data.cardToken.split(".")[1]);
    const rivalBefore = await cardRow(pool, rival.data.id);
    const skipped = await request(`/classes/CB02-SKIP/student-cards/batches/${skipPrep.data.batchId}/activate`, {
      method: "POST",
      token: tokenA,
      body: { proofs: skipProof },
    });
    assert.equal(skipped.status, 200, brief(skipped.data));
    assert.equal(skipped.data.counts.skippedActive, 1);
    assert.equal(skipped.data.counts.activated, 0);
    const preparedSkipped = await cardRow(pool, skipEntry.cardId);
    assert.equal(preparedSkipped.status, "revoked");
    assert.equal(preparedSkipped.revoke_reason, "batch_superseded_by_active");
    const rivalAfter = await cardRow(pool, rival.data.id);
    assert.equal(rivalAfter.status, "active");
    assert.equal(rivalAfter.token_hash, rivalBefore.token_hash);
    assert.equal(rivalAfter.id, rivalBefore.id);

    await assert.rejects(
      () => prepareClassCardBatch(repo, scope, "CB02-FAIL", principal, { failAfterInsert: true }),
      (error) => /interrompue/.test(error.message),
    );
    const failCards = await pool.query(`SELECT count(*)::int AS n FROM student_access_cards WHERE student_id = $1`, [STUDENTS.fail]);
    const failBatches = await pool.query(
      `SELECT count(*)::int AS n FROM student_card_batches WHERE class_code = 'CB02-FAIL'`,
    );
    assert.equal(failCards.rows[0].n, 0);
    assert.equal(failBatches.rows[0].n, 0);

    const factPrepared = await prepareClassCardBatch(repo, scope, "CB02-FACT", principal);
    secrets.push(factPrepared.deliveryNonce, ...proofsFrom(factPrepared.entries).flatMap((proof) => [proof.secret]));
    for (const entry of factPrepared.entries) {
      if (entry.cardToken) secrets.push(entry.cardToken);
    }
    const factProofs = proofsFrom(factPrepared.entries);
    await recordBatchReceipt(repo, scope, "CB02-FACT", factPrepared.batchId, {
      kind: "technical",
      deliveryNonce: factPrepared.deliveryNonce,
    }, principal);
    await recordBatchReceipt(repo, scope, "CB02-FACT", factPrepared.batchId, {
      kind: "saved",
      proofs: factProofs,
    }, principal);
    await assert.rejects(
      () => activateClassCardBatch(repo, scope, "CB02-FACT", factPrepared.batchId, { proofs: factProofs }, principal, {
        failBeforeCommit: true,
      }),
      (error) => /interrompue/.test(error.message),
    );
    const factCard = await pool.query(
      `SELECT status FROM student_access_cards WHERE student_id = $1`,
      [STUDENTS.fact],
    );
    assert.equal(factCard.rows[0].status, "issued");
    const factBatch = await pool.query(`SELECT status FROM student_card_batches WHERE id = $1`, [factPrepared.batchId]);
    assert.equal(factBatch.rows[0].status, "saved");

    assert.equal(await countSecretHits(pool, secrets), 0);
    const idempotency = await pool.query(
      `SELECT count(*)::int AS n FROM idempotency_keys WHERE route_key LIKE '%student-cards/batches%'`,
    );
    assert.equal(idempotency.rows[0].n, 0);
    const audits = await pool.query(
      `SELECT action, coalesce(new_value::text, '') AS payload
         FROM audit_logs WHERE action LIKE 'student_card_batch_%'`,
    );
    assert.ok(audits.rowCount >= 1);
    for (const row of audits.rows) {
      assert.doesNotMatch(row.payload, /cardToken|token_hash|"secret"|deliveryNonce/);
    }
    const hashes = await pool.query(`SELECT delivery_nonce_hash FROM student_card_batches`);
    for (const row of hashes.rows) assert.match(row.delivery_nonce_hash, /^[0-9a-f]{64}$/);

    console.log("studentCardBatchIssue.http.pg.test.js PASS");
  } finally {
    await stopChild(child);
    await pool.end();
    if (typeof repo.close === "function") await repo.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
