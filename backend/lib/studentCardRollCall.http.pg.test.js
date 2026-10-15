"use strict";

/**
 * CARTE-PR1 — appel collectif par carte, de bout en bout (HTTP + PostgreSQL isolé).
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { deriveRollCallKeys, sealReceipt, openReceipt, ROLL_CALL_ERROR } = require("./studentCardRollCall");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_ROLL_CALL_IT_DATABASE ?? "somafrik_student_card_roll_call_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_ROLL_CALL_HTTP_PORT ?? 19891);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const LEFTOVER_A = "CD-2026-0001";
const LEFTOVER_B = "BI-2026-0001";
const U = (n) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, "0")}`;
const USER_ADMIN = U(1);
const USER_TEACHER = U(2);
const USER_TEACHER_FREE = U(3);
const USER_PARENT = U(4);
const USER_SUPER = U(5);
const USER_PAYS = U(6);
const USER_ADMIN_B = U(7);
// CARTE-UX-ROLE-01
const USER_DIRECTOR = U(8);
const USER_PROVISEUR_NO_UPDATE = U(9);
const USER_SUPERVISOR = U(10);
const USER_DIRECTOR_TEACHER = U(11);
const S = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`S${n}`, U(100 + n)]));
const STUDENT_B = U(199);

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
  return { status: response.status, data, cacheControl: response.headers.get("cache-control") };
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
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
  return (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ($1,$2,$3,$4) RETURNING id`,
    [name, iso, phone, currency],
  )).rows[0];
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
       SET can_create = $2, can_read = $3, can_update = $4, can_delete = FALSE, updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, flags.create, flags.read, flags.update],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', $2, $3, $4, $5, FALSE, 'carte-pr1')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update],
  );
}

const attendanceOn = async (pool, date) =>
  (await pool.query(`SELECT student_id, status FROM attendance WHERE attendance_date = $1::date ORDER BY student_id`, [date])).rows;

async function main() {
  if (!DATABASE_URL) {
    console.log("studentCardRollCall.http.pg.test.js SKIP (DATABASE_URL absent)");
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
  const keys = deriveRollCallKeys(JWT_SECRET);
  const pool = new Pool({ connectionString: isolatedUrl });
  let child = null;
  try {
    await repo.init();
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    await setLoginCodeTriggers(pool, false);
    const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
    const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
    const schoolA = (await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1,$2,$3,'LAC','Lycée Lac','active') RETURNING id`,
      [cd.id, LEFTOVER_A, LOGIN_A],
    )).rows[0];
    const schoolB = (await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1,$2,$3,'BUJ','Lycée Buj','active') RETURNING id`,
      [bi.id, LEFTOVER_B, LOGIN_B],
    )).rows[0];
    await setLoginCodeTriggers(pool, true);
    await pool.query(`ALTER TABLE users DISABLE TRIGGER users_permanent_identity_insert`);
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES
         ($1,$8,'ADM-A','Aline','A','aline@rc.test','Admin School','active', FALSE),
         ($2,$8,'ENS-A','Chidi','T','chidi@rc.test','Enseignant','active', FALSE),
         ($3,$8,'ENS-F','Fatou','F','fatou@rc.test','Enseignant','active', FALSE),
         ($4,$8,'PAR-A','Paule','P','paule@rc.test','Parent','active', FALSE),
         ($5,NULL,'SUPER','Super','Admin','super@rc.test','Super Administrateur Somafrik','active', FALSE),
         ($6,NULL,'PAYS','Admin','Pays','pays@rc.test','Admin Pays','active', FALSE),
         ($7,$9,'ADM-B','Binta','B','binta@rc.test','Admin School','active', FALSE)`,
      [USER_ADMIN, USER_TEACHER, USER_TEACHER_FREE, USER_PARENT, USER_SUPER, USER_PAYS, USER_ADMIN_B, schoolA.id, schoolB.id],
    );
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1,$5,'DIR-A','Dora','D','dora@rc.test','Directeur','active', FALSE),
              ($2,$5,'PRV-A','Paul','V','paul@rc.test','Proviseur','active', FALSE),
              ($3,$5,'SUR-A','Sami','S','sami@rc.test','Surveillant','active', FALSE),
              ($4,$5,'DIT-A','Dina','T','dina@rc.test','Directeur','active', FALSE)`,
      [USER_DIRECTOR, USER_PROVISEUR_NO_UPDATE, USER_SUPERVISOR, USER_DIRECTOR_TEACHER, schoolA.id],
    );
    await pool.query(`ALTER TABLE users ENABLE TRIGGER users_permanent_identity_insert`);
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES ($1,$8,'SCHOOL_ADMIN','active'), ($2,$8,'TEACHER','active'), ($3,$8,'TEACHER','active'),
              ($4,$8,'PARENT','active'), ($5,NULL,'SUPER_ADMIN','active'), ($6,NULL,'COUNTRY_ADMIN','active'),
              ($7,$9,'SCHOOL_ADMIN','active')`,
      [USER_ADMIN, USER_TEACHER, USER_TEACHER_FREE, USER_PARENT, USER_SUPER, USER_PAYS, USER_ADMIN_B, schoolA.id, schoolB.id],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES ($1,$5,'PRINCIPAL','active'), ($2,$5,'PROVISEUR','active'), ($3,$5,'SUPERVISOR','active'),
              ($4,$5,'PRINCIPAL','active'), ($4,$5,'TEACHER','active')`,
      [USER_DIRECTOR, USER_PROVISEUR_NO_UPDATE, USER_SUPERVISOR, USER_DIRECTOR_TEACHER, schoolA.id],
    );
    await setRoleModuleGrant(pool, "PRINCIPAL", "attendance", { create: true, read: true, update: true });
    await setRoleModuleGrant(pool, "PROVISEUR", "attendance", { create: true, read: true, update: false });
    await setRoleModuleGrant(pool, "SUPERVISOR", "attendance", { create: true, read: true, update: true });
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: true, read: true, update: true });
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
       VALUES ($1,$9,'RC-S1','Amina','Kabila','active'), ($2,$9,'RC-S2','Bao','Lutete','active'),
              ($3,$9,'RC-S3','Cyn','Mbuyi','active'), ($4,$9,'RC-S4','Dan','Ngoy','active'),
              ($5,$9,'RC-S5','Eli','Ombe','active'), ($6,$9,'RC-S6','Fay','Pindi','active'),
              ($7,$9,'RC-S7','Gus','Rafiki','active'), ($8,$9,'RC-S8','Hana','Sefu','active'),
              ($10,$11,'RC-SB','Ines','Tshala','active')`,
      [S.S1, S.S2, S.S3, S.S4, S.S5, S.S6, S.S7, S.S8, schoolA.id, STUDENT_B, schoolB.id],
    );
    const yearA = (await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027', TRUE, 'open') RETURNING id`,
      [schoolA.id],
    )).rows[0];
    const yearB = (await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027', TRUE, 'open') RETURNING id`,
      [schoolB.id],
    )).rows[0];
    const classA1 = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,'RC-A1','2e A','active') RETURNING id`,
      [schoolA.id, yearA.id],
    )).rows[0];
    const classA2 = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,'RC-A2','2e B','active') RETURNING id`,
      [schoolA.id, yearA.id],
    )).rows[0];
    const classB1 = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,'RC-B1','2e Buj','active') RETURNING id`,
      [schoolB.id, yearB.id],
    )).rows[0];
    for (const id of [S.S1, S.S2, S.S3, S.S5, S.S6, S.S7, S.S8]) {
      await pool.query(
        `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1,$2,$3,$4,'ENROLLED')`,
        [schoolA.id, id, classA1.id, yearA.id],
      );
    }
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,'ENROLLED'), ($5,$6,$7,$8,'ENROLLED')`,
      [schoolA.id, S.S4, classA2.id, yearA.id, schoolB.id, STUDENT_B, classB1.id, yearB.id],
    );
    const subject = (await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,'MATH','Maths','active') RETURNING id`,
      [schoolA.id],
    )).rows[0];
    const teacher = (await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,'TCH-A','active') RETURNING id`,
      [schoolA.id, USER_TEACHER],
    )).rows[0];
    await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,'TCH-F','active')`,
      [schoolA.id, USER_TEACHER_FREE],
    );
    // Compte multi-rôle (libellé « Directeur », clés PRINCIPAL + TEACHER) affecté à la seule classe A1.
    const directorTeacher = (await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,'TCH-D','active') RETURNING id`,
      [schoolA.id, USER_DIRECTOR_TEACHER],
    )).rows[0];
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [schoolA.id, teacher.id, classA1.id, subject.id, yearA.id],
    );
    const subjectPhys = (await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,'PHYS','Physique','active') RETURNING id`,
      [schoolA.id],
    )).rows[0];
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [schoolA.id, directorTeacher.id, classA1.id, subjectPhys.id, yearA.id],
    );
    await pool.query(
      `INSERT INTO school_settings (school_id, student_card_enabled, student_card_qr_enabled, student_card_attendance_enabled)
       VALUES ($1, TRUE, TRUE, TRUE), ($2, TRUE, TRUE, TRUE)
       ON CONFLICT (school_id) DO UPDATE SET
         student_card_enabled = TRUE, student_card_qr_enabled = TRUE, student_card_attendance_enabled = TRUE`,
      [schoolA.id, schoolB.id],
    );

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

    const tokenAdmin = mint({ sub: USER_ADMIN, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LEFTOVER_A,
      permissions: ["Élèves:UPDATE", "Gérer élèves", "Présences:CREATE", "Présences:UPDATE"] });
    const tokenTeacher = mint({ sub: USER_TEACHER, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: LEFTOVER_A,
      permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenTeacherFree = mint({ sub: USER_TEACHER_FREE, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: LEFTOVER_A,
      permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenParent = mint({ sub: USER_PARENT, role: "Parent", roleKeys: ["PARENT"], schoolCode: LEFTOVER_A,
      permissions: ["Présences:READ"] });
    const tokenSuper = mint({ sub: USER_SUPER, role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"],
      schoolCode: LOGIN_A, permissions: ["ALL_PRIVILEGES", "Présences:CREATE"] });
    const tokenPays = mint({ sub: USER_PAYS, role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"], schoolCode: LOGIN_A,
      countryCode: "CD", permissions: ["COUNTRY_PRIVILEGES", "Présences:UPDATE"] });
    const tokenAdminB = mint({ sub: USER_ADMIN_B, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LEFTOVER_B,
      permissions: ["Élèves:UPDATE", "Gérer élèves", "Présences:CREATE", "Présences:UPDATE"] });
    const tokenDirector = mint({ sub: USER_DIRECTOR, role: "Directeur", roleKeys: ["PRINCIPAL"], schoolCode: LEFTOVER_A,
      permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenProviseurNoUpdate = mint({ sub: USER_PROVISEUR_NO_UPDATE, role: "Proviseur", roleKeys: ["PROVISEUR"],
      schoolCode: LEFTOVER_A, permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenSupervisor = mint({ sub: USER_SUPERVISOR, role: "Surveillant", roleKeys: ["SUPERVISOR"], schoolCode: LEFTOVER_A,
      permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenDirectorTeacher = mint({ sub: USER_DIRECTOR_TEACHER, role: "Directeur", roleKeys: ["PRINCIPAL", "TEACHER"],
      schoolCode: LEFTOVER_A, permissions: ["Présences:CREATE", "Présences:UPDATE"] });

    const issue = async (studentId, medium = "qr", token = tokenAdmin) => {
      const issued = await request("/student-cards", { method: "POST", token, body: { studentId, medium } });
      assert.equal(issued.status, 201, JSON.stringify(issued.data));
      return { id: issued.data.id, cardToken: issued.data.cardToken };
    };
    const cards = {};
    for (const key of ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]) cards[key] = await issue(S[key], key === "S1" ? "nfc_qr" : "qr");
    const cardB = await issue(STUDENT_B, "qr", tokenAdminB);
    // Carte NFC physiquement encodée (état produit après nfc-confirm) : même jeton, support NFC.
    await pool.query(
      `UPDATE student_access_cards SET medium = 'nfc', nfc_uid = '04AABBCCDDEE11', nfc_tag_type = 'NTAG216',
              nfc_encoding_state = 'encoded', nfc_encoded_at = NOW() WHERE id = $1`,
      [cards.S1.id],
    );
    // Réservation NFC non activée (status issued) : refusée.
    await pool.query(
      `UPDATE student_access_cards SET status = 'issued' WHERE id = $1`,
      [cards.S6.id],
    );

    const session = () => crypto.randomUUID();
    const scan = (token, body, headers) => request("/student-cards/roll-call/scan", { method: "POST", token, body, headers });
    const validate = (token, body, operationKey = body.sessionId, headers = {}) =>
      request("/student-cards/roll-call/validate", {
        method: "POST",
        token,
        body,
        headers: operationKey === null ? headers : { "Idempotency-Key": operationKey, ...headers },
      });
    const identityLeaks = (payload) => {
      const rendered = JSON.stringify(payload);
      return [
        ...Object.values(S), STUDENT_B, ...Object.values(cards).flatMap((c) => [c.id, c.cardToken, c.cardToken.split(".")[1]]),
        "RC-S1", "RC-S2", "Amina", "Kabila", "Bao", "Lutete", "RC-A1", "2e A",
      ].filter((secret) => rendered.includes(secret));
    };

    // ---------- Autorisations et isolation ----------
    const X = session();
    const ctxX = { sessionId: X, classId: classA1.id, date: "2026-10-06" };
    assert.equal((await scan(undefined, { ...ctxX, cardToken: cards.S1.cardToken })).status, 401);
    assert.equal((await scan(tokenParent, { ...ctxX, cardToken: cards.S1.cardToken })).status, 403);
    for (const [token, headers] of [[tokenSuper, { "X-Somafrik-School-Code": LOGIN_A }], [tokenPays, {}]]) {
      const denied = await scan(token, { ...ctxX, cardToken: cards.S1.cardToken }, headers);
      assert.equal(denied.status, 403, JSON.stringify(denied.data));
      assert.equal(denied.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    }
    const freeTeacher = await scan(tokenTeacherFree, { ...ctxX, cardToken: cards.S1.cardToken });
    assert.equal(freeTeacher.status, 403, JSON.stringify(freeTeacher.data));
    assert.equal(freeTeacher.data?.code, ROLL_CALL_ERROR.CLASS_FORBIDDEN);
    const otherClass = await scan(tokenTeacher, { ...ctxX, classId: classA2.id, cardToken: cards.S4.cardToken });
    assert.equal(otherClass.status, 403, JSON.stringify(otherClass.data));
    assert.equal(otherClass.data?.code, ROLL_CALL_ERROR.CLASS_FORBIDDEN);
    const foreignClass = await scan(tokenTeacher, { ...ctxX, classId: classB1.id, cardToken: cardB.cardToken });
    assert.equal(foreignClass.status, 403, JSON.stringify(foreignClass.data));
    const foreignCard = await scan(tokenTeacher, { ...ctxX, cardToken: cardB.cardToken });
    assert.equal(foreignCard.status, 404, "une carte d'un autre établissement est inconnue ici");
    assert.equal((await scan(tokenTeacher, { ...ctxX, sessionId: "not-a-uuid", cardToken: cards.S1.cardToken })).data?.code,
      ROLL_CALL_ERROR.INPUT_INVALID);

    // ---------- Scan brouillon : aucune écriture, aucune identité ----------
    const s1 = await scan(tokenTeacher, { ...ctxX, cardToken: cards.S1.cardToken });
    assert.equal(s1.status, 200, JSON.stringify(s1.data));
    assert.equal(s1.cacheControl, "no-store");
    assert.deepEqual(Object.keys(s1.data).sort(), ["dedupKey", "expiresAt", "receipt", "status"]);
    assert.equal(s1.data.status, "accepted");
    assert.deepEqual(identityLeaks(s1.data), []);
    assert.deepEqual(await attendanceOn(pool, ctxX.date), [], "un scan brouillon ne pointe jamais");
    const s1Again = await scan(tokenTeacher, { ...ctxX, cardToken: cards.S1.cardToken });
    assert.equal(s1Again.data.dedupKey, s1.data.dedupKey, "même carte, même session → même clé");
    assert.notEqual(s1Again.data.receipt, s1.data.receipt);
    const s1OtherSession = await scan(tokenTeacher, { ...ctxX, sessionId: session(), cardToken: cards.S1.cardToken });
    assert.notEqual(s1OtherSession.data.dedupKey, s1.data.dedupKey, "clé non corrélable entre sessions");
    const s2 = await scan(tokenTeacher, { ...ctxX, cardToken: cards.S2.cardToken });
    assert.equal(s2.status, 200, JSON.stringify(s2.data));
    const mismatch = await scan(tokenTeacher, { ...ctxX, cardToken: cards.S4.cardToken });
    assert.equal(mismatch.status, 409, JSON.stringify(mismatch.data));
    assert.equal(mismatch.data?.code, ROLL_CALL_ERROR.CLASS_MISMATCH);
    assert.deepEqual(identityLeaks(mismatch.data), []);

    // Cartes révoquée, remplacée, non activée.
    assert.equal((await request(`/student-cards/${cards.S3.id}/revoke`, { method: "POST", token: tokenAdmin, body: {} })).status, 200);
    const revoked = await scan(tokenTeacher, { ...ctxX, cardToken: cards.S3.cardToken });
    assert.equal(revoked.status, 409, JSON.stringify(revoked.data));
    assert.deepEqual(identityLeaks(revoked.data), []);
    // Régression : une ancienne carte du même élève a été scannée AVANT son remplacement.
    const twoCards = { sessionId: session(), classId: classA1.id, date: "2026-10-12" };
    const receiptBeforeReplacement = await scan(tokenTeacher, { ...twoCards, cardToken: cards.S5.cardToken });
    assert.equal(receiptBeforeReplacement.status, 200, JSON.stringify(receiptBeforeReplacement.data));
    const replaced = await request(`/student-cards/${cards.S5.id}/replace`, { method: "POST", token: tokenAdmin, body: {} });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.data));
    assert.equal((await scan(tokenTeacher, { ...ctxX, cardToken: cards.S5.cardToken })).status, 409, "ancienne carte remplacée refusée");
    assert.equal((await scan(tokenTeacher, { ...ctxX, cardToken: replaced.data.card.cardToken })).status, 200, "nouvelle carte acceptée");
    const receiptAfterReplacement = await scan(tokenTeacher, { ...twoCards, cardToken: replaced.data.card.cardToken });
    assert.equal(receiptAfterReplacement.status, 200, JSON.stringify(receiptAfterReplacement.data));
    for (const [receipts, expectedIndex] of [
      [[receiptBeforeReplacement.data.receipt, receiptAfterReplacement.data.receipt], 0],
      [[receiptAfterReplacement.data.receipt, receiptBeforeReplacement.data.receipt], 1],
    ]) {
      const invalidPair = await validate(tokenTeacher, { ...twoCards, receipts });
      assert.equal(invalidPair.status, 409, JSON.stringify(invalidPair.data));
      assert.equal(invalidPair.data?.code, ROLL_CALL_ERROR.CARD_INVALID);
      assert.deepEqual(invalidPair.data?.details, { invalidReceiptIndexes: [expectedIndex] });
      assert.deepEqual(await attendanceOn(pool, twoCards.date), [], "aucune présence sur lot partiellement invalide");
    }
    assert.equal((await scan(tokenTeacher, { ...ctxX, cardToken: cards.S6.cardToken })).status, 409, "réservation non activée refusée");

    // ---------- Validation : contrôles avant écriture ----------
    const bodyX = { ...ctxX, receipts: [s1.data.receipt, s1Again.data.receipt, s2.data.receipt] };
    assert.equal((await validate(tokenTeacher, bodyX, null)).data?.code, ROLL_CALL_ERROR.OPERATION_KEY_REQUIRED);
    assert.equal((await validate(tokenTeacher, bodyX, session())).data?.code, ROLL_CALL_ERROR.OPERATION_KEY_REQUIRED);
    const tampered = `${s1.data.receipt.slice(0, -6)}AAAAAA`;
    const tamperedRes = await validate(tokenTeacher, { ...ctxX, receipts: [s2.data.receipt, tampered] });
    assert.equal(tamperedRes.status, 400, JSON.stringify(tamperedRes.data));
    assert.equal(tamperedRes.data?.code, ROLL_CALL_ERROR.RECEIPT_INVALID);
    const claims = openReceipt(keys, s2.data.receipt);
    const expired = sealReceipt(keys, { ...claims, exp: Date.now() - 1000 });
    const expiredSession = { ...ctxX, sessionId: session() };
    const expiredRes = await validate(tokenTeacher, {
      ...expiredSession,
      receipts: [sealReceipt(keys, { ...claims, ses: expiredSession.sessionId, exp: Date.now() - 1000 })],
    });
    assert.equal(expiredRes.data?.code, ROLL_CALL_ERROR.RECEIPT_EXPIRED, JSON.stringify(expiredRes.data));
    assert.equal((await validate(tokenTeacher, { ...ctxX, receipts: [expired] })).data?.code, ROLL_CALL_ERROR.RECEIPT_EXPIRED);
    const wrongSession = { ...ctxX, sessionId: session() };
    assert.equal((await validate(tokenTeacher, { ...wrongSession, receipts: [s2.data.receipt] })).data?.code,
      ROLL_CALL_ERROR.CONTEXT_MISMATCH, "reçu d'une autre session");
    assert.equal((await validate(tokenTeacher, { ...ctxX, date: "2026-10-07", receipts: [s2.data.receipt] })).data?.code,
      ROLL_CALL_ERROR.CONTEXT_MISMATCH, "autre date");
    assert.equal((await validate(tokenTeacher, { ...ctxX, classId: classA2.id, receipts: [s2.data.receipt] })).data?.code,
      ROLL_CALL_ERROR.CONTEXT_MISMATCH, "autre classe");
    assert.equal((await validate(tokenTeacherFree, bodyX)).data?.code, ROLL_CALL_ERROR.CONTEXT_MISMATCH, "autre utilisateur");
    const crossSchool = await validate(tokenAdminB, bodyX);
    assert.equal(crossSchool.data?.code, ROLL_CALL_ERROR.ROLE_FORBIDDEN, "autre établissement, sans clé TEACHER");
    assert.deepEqual(await attendanceOn(pool, ctxX.date), [], "aucun refus n'a écrit de présence");

    // ---------- Validation réussie, doublons, rejeu ----------
    const ok = await validate(tokenTeacher, bodyX);
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.deepEqual(ok.data, { recorded: 2, duplicatesIgnored: 1, classId: classA1.id, date: ctxX.date });
    assert.deepEqual(identityLeaks(ok.data), []);
    assert.deepEqual((await attendanceOn(pool, ctxX.date)).map((row) => [row.student_id, row.status]),
      [[S.S1, "present"], [S.S2, "present"]], "seuls les élèves scannés ; aucun absent automatique");
    const replay = await validate(tokenTeacher, bodyX);
    assert.equal(replay.status, 201, JSON.stringify(replay.data));
    assert.equal(replay.data.idempotentReplay, true);
    assert.equal((await attendanceOn(pool, ctxX.date)).length, 2, "rejeu sans doublon");
    const conflicting = await validate(tokenTeacher, { ...ctxX, receipts: [s2.data.receipt] });
    assert.equal(conflicting.status, 409, "session déjà validée avec un autre contenu");

    // ---------- Révocation entre scan et validation ----------
    const Z = { sessionId: session(), classId: classA1.id, date: "2026-10-08" };
    const z7 = await scan(tokenTeacher, { ...Z, cardToken: cards.S7.cardToken });
    const z2 = await scan(tokenTeacher, { ...Z, cardToken: cards.S2.cardToken });
    assert.equal((await request(`/student-cards/${cards.S7.id}/lost`, { method: "POST", token: tokenAdmin, body: {} })).status, 200);
    const afterLost = await validate(tokenTeacher, { ...Z, receipts: [z2.data.receipt, z7.data.receipt] });
    assert.equal(afterLost.status, 409, JSON.stringify(afterLost.data));
    assert.equal(afterLost.data?.code, ROLL_CALL_ERROR.CARD_INVALID);
    assert.deepEqual(afterLost.data?.details, { invalidReceiptIndexes: [1] }, "seule la position du reçu refusé");
    assert.deepEqual(identityLeaks(afterLost.data), []);
    assert.deepEqual(await attendanceOn(pool, Z.date), [], "fail-closed : aucune présence partielle");

    // ---------- Permissions retirées entre scan et validation ----------
    const P = { sessionId: session(), classId: classA1.id, date: "2026-10-09" };
    const p1 = await scan(tokenTeacher, { ...P, cardToken: cards.S1.cardToken });
    assert.equal(p1.status, 200);
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: false, read: true, update: false });
    const noPermission = await validate(tokenTeacher, { ...P, receipts: [p1.data.receipt] });
    assert.equal(noPermission.status, 403, JSON.stringify(noPermission.data));
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: true, read: true, update: true });
    await pool.query(`UPDATE teacher_assignments SET status = 'inactive' WHERE teacher_id = $1`, [teacher.id]);
    const unassigned = await validate(tokenTeacher, { ...P, receipts: [p1.data.receipt] });
    assert.equal(unassigned.status, 403, JSON.stringify(unassigned.data));
    await pool.query(`UPDATE teacher_assignments SET status = 'active' WHERE teacher_id = $1`, [teacher.id]);
    assert.deepEqual(await attendanceOn(pool, P.date), []);

    // ---------- Échec en cours de transaction : rollback complet ----------
    const R = { sessionId: session(), classId: classA1.id, date: "2026-10-12" };
    const r1 = await scan(tokenTeacher, { ...R, cardToken: cards.S1.cardToken });
    const r8 = await scan(tokenTeacher, { ...R, cardToken: cards.S8.cardToken });
    await pool.query(`UPDATE enrollments SET class_id = $1 WHERE student_id = $2`, [classA2.id, S.S8]);
    const rolledBack = await validate(tokenTeacher, { ...R, receipts: [r1.data.receipt, r8.data.receipt] });
    assert.equal(rolledBack.status, 403, JSON.stringify(rolledBack.data));
    assert.deepEqual(await attendanceOn(pool, R.date), [], "S1 écrit puis annulé avec S8 : transaction unique");
    await pool.query(`UPDATE enrollments SET class_id = $1 WHERE student_id = $2`, [classA1.id, S.S8]);
    const retried = await validate(tokenTeacher, { ...R, receipts: [r1.data.receipt, r8.data.receipt] });
    assert.equal(retried.status, 201, "un échec n'est jamais mémorisé : la même opération peut être relancée");
    assert.equal((await attendanceOn(pool, R.date)).length, 2);

    // ---------- Concurrence ----------
    const C = { sessionId: session(), classId: classA1.id, date: "2026-10-13" };
    const c1 = await scan(tokenTeacher, { ...C, cardToken: cards.S1.cardToken });
    const c2 = await scan(tokenTeacher, { ...C, cardToken: cards.S2.cardToken });
    const bodyC = { ...C, receipts: [c1.data.receipt, c2.data.receipt] };
    const parallel = await Promise.all([validate(tokenTeacher, bodyC), validate(tokenTeacher, bodyC)]);
    assert.deepEqual(parallel.map((r) => r.status), [201, 201], JSON.stringify(parallel.map((r) => r.data)));
    assert.equal(parallel.filter((r) => r.data.idempotentReplay === true).length, 1, "une exécution, un rejeu");
    assert.equal((await attendanceOn(pool, C.date)).length, 2);
    const D1 = { sessionId: session(), classId: classA1.id, date: "2026-10-14" };
    const D2 = { ...D1, sessionId: session() };
    const d1 = await scan(tokenTeacher, { ...D1, cardToken: cards.S1.cardToken });
    const d2 = await scan(tokenTeacher, { ...D2, cardToken: cards.S1.cardToken });
    const overlapping = await Promise.all([
      validate(tokenTeacher, { ...D1, receipts: [d1.data.receipt] }),
      validate(tokenTeacher, { ...D2, receipts: [d2.data.receipt] }),
    ]);
    assert.deepEqual(overlapping.map((r) => r.status), [201, 201]);
    assert.equal((await attendanceOn(pool, D1.date)).length, 1, "deux sessions concurrentes, une seule présence");

    // ---------- CARTE-UX-ROLE-01 : parcours enseignant (clés canoniques, affectation stricte) ----------
    const A = { sessionId: session(), classId: classA1.id, date: "2026-10-15" };
    // La direction ne peut plus pointer « au nom » d'un enseignant : ni sans auteur, ni avec teacherId.
    for (const token of [tokenAdmin, tokenDirector]) {
      const asTeacher = await scan(token, { ...A, cardToken: cards.S2.cardToken });
      assert.equal(asTeacher.status, 403, JSON.stringify(asTeacher.data));
      assert.equal(asTeacher.data?.code, ROLL_CALL_ERROR.ROLE_FORBIDDEN);
      const sealedForDirector = sealReceipt(keys, {
        sch: schoolA.id, cls: classA1.id, dt: A.date, usr: USER_DIRECTOR, ses: A.sessionId, crd: cards.S2.id, stu: S.S2,
        mod: "teacher", exp: Date.now() + 60_000,
      });
      const attributed = await validate(token, { ...A, teacherId: "TCH-A", receipts: [sealedForDirector] });
      assert.equal(attributed.status, 403, JSON.stringify(attributed.data));
      assert.equal(attributed.data?.code, ROLL_CALL_ERROR.ROLE_FORBIDDEN);
    }
    // Rôle secondaire sans clé TEACHER ni rôle de direction : aucun des deux parcours.
    assert.equal((await scan(tokenSupervisor, { ...A, cardToken: cards.S2.cardToken })).data?.code, ROLL_CALL_ERROR.ROLE_FORBIDDEN);
    assert.equal((await scan(tokenSupervisor, { ...A, mode: "direction", cardToken: cards.S2.cardToken })).data?.code,
      ROLL_CALL_ERROR.ROLE_FORBIDDEN);
    assert.deepEqual(await attendanceOn(pool, A.date), []);
    // Multi-rôle : la clé TEACHER impose l'affectation, même avec un libellé « Directeur ».
    const multiOther = await scan(tokenDirectorTeacher, { ...A, classId: classA2.id, cardToken: cards.S4.cardToken });
    assert.equal(multiOther.status, 403, JSON.stringify(multiOther.data));
    assert.equal(multiOther.data?.code, ROLL_CALL_ERROR.CLASS_FORBIDDEN);
    const m1 = await scan(tokenDirectorTeacher, { ...A, cardToken: cards.S2.cardToken });
    assert.equal(m1.status, 200, JSON.stringify(m1.data));
    const multiOk = await validate(tokenDirectorTeacher, { ...A, teacherId: "TCH-A", receipts: [m1.data.receipt] });
    assert.equal(multiOk.status, 201, JSON.stringify(multiOk.data));
    const multiRow = (await pool.query(`SELECT teacher_id FROM attendance WHERE attendance_date = $1 AND student_id = $2`, [A.date, S.S2])).rows[0];
    assert.equal(String(multiRow.teacher_id), String(directorTeacher.id), "présence attribuée à l'enseignant authentifié, jamais au teacherId client");

    // ---------- CARTE-UX-ROLE-01 : appel exceptionnel de la direction ----------
    const E = { sessionId: session(), classId: classA1.id, date: "2026-10-17", mode: "direction" };
    const justification = "Enseignant absent ce matin, appel réalisé par la direction.";
    assert.equal((await scan(tokenProviseurNoUpdate, { ...E, cardToken: cards.S1.cardToken })).data?.code,
      ROLL_CALL_ERROR.ROLE_FORBIDDEN, "direction sans Présences:UPDATE effective");
    assert.equal((await scan(tokenTeacher, { ...E, cardToken: cards.S1.cardToken })).data?.code,
      ROLL_CALL_ERROR.ROLE_FORBIDDEN, "un enseignant n'utilise pas l'appel exceptionnel");
    assert.equal((await scan(tokenAdminB, { ...E, cardToken: cards.S1.cardToken })).status, 403, "classe d'un autre établissement");
    for (const [token, headers] of [[tokenSuper, { "X-Somafrik-School-Code": LOGIN_A }], [tokenPays, {}]]) {
      const denied = await scan(token, { ...E, cardToken: cards.S1.cardToken }, headers);
      assert.equal(denied.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    }
    assert.equal((await scan(tokenParent, { ...E, cardToken: cards.S1.cardToken })).status, 403);
    assert.equal((await scan(tokenDirector, { ...E, mode: "inconnu", cardToken: cards.S1.cardToken })).data?.code,
      ROLL_CALL_ERROR.INPUT_INVALID);
    const e1 = await scan(tokenDirector, { ...E, cardToken: cards.S1.cardToken });
    assert.equal(e1.status, 200, JSON.stringify(e1.data));
    assert.deepEqual(identityLeaks(e1.data), []);
    const e2 = await scan(tokenDirector, { ...E, cardToken: cards.S2.cardToken });
    const eTeacherReceipt = await scan(tokenDirectorTeacher, { ...E, mode: undefined, cardToken: cards.S2.cardToken });
    assert.equal(eTeacherReceipt.status, 200);
    const bodyE = { ...E, justification, receipts: [e1.data.receipt, e2.data.receipt] };
    assert.equal((await validate(tokenDirector, { ...bodyE, justification: "  court " })).data?.code,
      ROLL_CALL_ERROR.JUSTIFICATION_REQUIRED, "justification obligatoire");
    assert.equal((await validate(tokenDirector, { ...bodyE, justification: undefined })).data?.code,
      ROLL_CALL_ERROR.JUSTIFICATION_REQUIRED);
    assert.equal((await validate(tokenDirector, { ...bodyE, mode: undefined })).data?.code,
      ROLL_CALL_ERROR.ROLE_FORBIDDEN, "reçus de direction refusés hors parcours direction");
    const forgedMode = sealReceipt(keys, { ...openReceipt(keys, e1.data.receipt), mod: "teacher" });
    assert.equal((await validate(tokenDirector, { ...bodyE, receipts: [forgedMode] })).data?.code,
      ROLL_CALL_ERROR.CONTEXT_MISMATCH, "un reçu enseignant n'est jamais accepté par le parcours direction");
    assert.equal((await validate(tokenDirectorTeacher, { ...E, mode: undefined, receipts: [e1.data.receipt] })).data?.code,
      ROLL_CALL_ERROR.CONTEXT_MISMATCH);
    const expiredE = sealReceipt(keys, { ...openReceipt(keys, e1.data.receipt), exp: Date.now() - 1000 });
    assert.equal((await validate(tokenDirector, { ...bodyE, receipts: [expiredE] })).data?.code, ROLL_CALL_ERROR.RECEIPT_EXPIRED);
    assert.deepEqual(await attendanceOn(pool, E.date), [], "aucun refus n'écrit de présence");
    // S2 déjà pointé présent par son enseignant : la direction ne modifie ni le statut ni l'auteur.
    const teacherFirst = { sessionId: session(), classId: classA1.id, date: E.date };
    const tf = await scan(tokenTeacher, { ...teacherFirst, cardToken: cards.S2.cardToken });
    assert.equal((await validate(tokenTeacher, { ...teacherFirst, receipts: [tf.data.receipt] })).status, 201);
    const okE = await validate(tokenDirector, bodyE);
    assert.equal(okE.status, 201, JSON.stringify(okE.data));
    assert.deepEqual(okE.data, { mode: "direction", recorded: 1, alreadyPresent: 1, duplicatesIgnored: 0, classId: classA1.id, date: E.date });
    const rowsE = (await pool.query(
      `SELECT student_id, status, teacher_id FROM attendance WHERE attendance_date = $1 ORDER BY student_id`, [E.date])).rows;
    assert.deepEqual(rowsE.map((r) => [r.student_id, r.status, r.teacher_id === null ? null : String(r.teacher_id)]),
      [[S.S1, "present", null], [S.S2, "present", String(teacher.id)]], "aucun enseignant fictif ; auteur existant conservé");
    const auditE = (await pool.query(
      `SELECT user_id, school_id, entity_id, new_value FROM audit_logs WHERE action = 'student_card_roll_call_direction'`)).rows;
    assert.equal(auditE.length, 1);
    assert.equal(String(auditE[0].user_id), USER_DIRECTOR, "auteur réel tracé");
    assert.equal(String(auditE[0].school_id), String(schoolA.id));
    assert.equal(auditE[0].entity_id, E.sessionId);
    assert.equal(auditE[0].new_value.justification, justification);
    assert.deepEqual(auditE[0].new_value.authorRoleKeys, ["PRINCIPAL"]);
    assert.equal(auditE[0].new_value.recorded, 1);
    // Rejeu idempotent et double soumission.
    const replayE = await validate(tokenDirector, bodyE);
    assert.equal(replayE.status, 201);
    assert.equal(replayE.data.idempotentReplay, true);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'student_card_roll_call_direction'`)).rows[0].n, 1);
    assert.equal((await validate(tokenDirector, { ...bodyE, receipts: [e1.data.receipt] })).status, 409, "même opération, autre contenu");
    // Carte devenue invalide entre scan et validation : lot entier refusé.
    const F = { sessionId: session(), classId: classA1.id, date: "2026-10-18", mode: "direction" };
    const f8 = await scan(tokenDirector, { ...F, cardToken: cards.S8.cardToken });
    const f1 = await scan(tokenDirector, { ...F, cardToken: cards.S1.cardToken });
    assert.equal((await request(`/student-cards/${cards.S8.id}/lost`, { method: "POST", token: tokenAdmin, body: {} })).status, 200);
    const lostE = await validate(tokenDirector, { ...F, justification, receipts: [f1.data.receipt, f8.data.receipt] });
    assert.equal(lostE.data?.code, ROLL_CALL_ERROR.CARD_INVALID, JSON.stringify(lostE.data));
    assert.deepEqual(await attendanceOn(pool, F.date), []);

    // ---------- CARTE-UX-ROLE-01 : supervision de direction ----------
    const overview = (token, date = E.date, headers = {}) =>
      request(`/student-cards/roll-call/overview?date=${date}`, { token, headers });
    const ov = await overview(tokenDirector);
    assert.equal(ov.status, 200, JSON.stringify(ov.data));
    assert.equal(ov.cacheControl, "no-store");
    assert.equal(ov.data.date, E.date);
    const ovA1 = ov.data.classes.find((c) => c.classId === classA1.id);
    assert.deepEqual(
      { enrolled: ovA1.enrolled, present: ovA1.present, recorded: ovA1.recorded, notRecorded: ovA1.notRecorded, status: ovA1.status },
      { enrolled: 7, present: 2, recorded: 2, notRecorded: 5, status: "partial" },
    );
    assert.equal(ov.data.classes.find((c) => c.classId === classA2.id).status, "not_started");
    assert.equal(ov.data.classes.some((c) => c.classId === classB1.id), false, "aucune classe d'un autre établissement");
    const studentLeaks = [...Object.values(S), "RC-S1", "Amina", "Kabila", "Bao", ...Object.values(cards).map((c) => c.cardToken)]
      .filter((value) => JSON.stringify(ov.data).includes(value));
    assert.deepEqual(studentLeaks, [], "supervision sans aucune donnée d'élève");
    assert.equal((await overview(tokenProviseurNoUpdate)).status, 200, "consultation : lecture seule suffit");
    for (const token of [tokenTeacher, tokenSupervisor, tokenParent]) {
      assert.equal((await overview(token)).status, 403);
    }
    assert.equal((await overview(tokenSuper, E.date, { "X-Somafrik-School-Code": LOGIN_A })).data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    const ovB = await overview(tokenAdminB);
    assert.equal(ovB.status, 200, JSON.stringify(ovB.data));
    assert.deepEqual(ovB.data.classes.map((c) => c.classId), [classB1.id]);
    assert.equal((await overview(tokenDirector, "2026-13-40")).data?.code, ROLL_CALL_ERROR.INPUT_INVALID);

    // ---------- Aucun secret dans l'audit ----------
    const audit = JSON.stringify((await pool.query(`SELECT old_value, new_value FROM audit_logs`)).rows);
    for (const secret of [s1.data.receipt, s1.data.dedupKey, cards.S1.cardToken.split(".")[1], cards.S2.cardToken.split(".")[1]]) {
      assert.equal(audit.includes(secret), false, "audit sans reçu ni jeton");
    }

    // ---------- Non-régression : pointage individuel inchangé ----------
    const individual = await request("/student-cards/scan", {
      method: "POST",
      token: tokenTeacher,
      headers: { "Idempotency-Key": "individual-1" },
      body: { cardToken: cards.S2.cardToken, attendance: { date: "2026-10-16", status: "present" } },
    });
    assert.equal(individual.status, 201, JSON.stringify(individual.data));
    assert.equal(individual.data.student.id, S.S2);

    console.log("studentCardRollCall.http.pg.test.js OK");
  } finally {
    await stopChild(child);
    await pool.end().catch(() => {});
    await repo.close?.().catch?.(() => {});
  }
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
