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
const { mintSessionAccessToken } = require("./testAccessSession");

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
  const mint = (payload) => mintSessionAccessToken({ tokens, repository: repo, payload: { mustChangePassword: false, ...payload } });
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
    // CARTE-CYCLE-01 : titulaire explicite (élève) pour les établissements de test émetteurs de cartes.
    await pool.query("UPDATE school_settings SET student_card_holder_kind = 'eleve' WHERE school_id = ANY($1::uuid[])", [[schoolA.id, schoolB.id]]);

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

    const tokenAdmin = await mint({ sub: USER_ADMIN, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LEFTOVER_A,
      permissions: ["Élèves:UPDATE", "Gérer élèves", "Présences:CREATE", "Présences:UPDATE"] });
    const tokenTeacher = await mint({ sub: USER_TEACHER, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: LEFTOVER_A,
      permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenTeacherFree = await mint({ sub: USER_TEACHER_FREE, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: LEFTOVER_A,
      permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenParent = await mint({ sub: USER_PARENT, role: "Parent", roleKeys: ["PARENT"], schoolCode: LEFTOVER_A,
      permissions: ["Présences:READ"] });
    const tokenSuper = await mint({ sub: USER_SUPER, role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"],
      schoolCode: LOGIN_A, permissions: ["ALL_PRIVILEGES", "Présences:CREATE"] });
    const tokenPays = await mint({ sub: USER_PAYS, role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"], schoolCode: LOGIN_A,
      countryCode: "CD", permissions: ["COUNTRY_PRIVILEGES", "Présences:UPDATE"] });
    const tokenAdminB = await mint({ sub: USER_ADMIN_B, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LEFTOVER_B,
      permissions: ["Élèves:UPDATE", "Gérer élèves", "Présences:CREATE", "Présences:UPDATE"] });
    const tokenDirector = await mint({ sub: USER_DIRECTOR, role: "Directeur", roleKeys: ["PRINCIPAL"], schoolCode: LEFTOVER_A,
      permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenProviseurNoUpdate = await mint({ sub: USER_PROVISEUR_NO_UPDATE, role: "Proviseur", roleKeys: ["PROVISEUR"],
      schoolCode: LEFTOVER_A, permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenSupervisor = await mint({ sub: USER_SUPERVISOR, role: "Surveillant", roleKeys: ["SUPERVISOR"], schoolCode: LEFTOVER_A,
      permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenDirectorTeacher = await mint({ sub: USER_DIRECTOR_TEACHER, role: "Directeur", roleKeys: ["PRINCIPAL", "TEACHER"],
      schoolCode: LEFTOVER_A, permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    // Jeton signé mais périmé : les clés du JWT (PRINCIPAL) ne correspondent plus aux rôles actifs en base (TEACHER seul).
    const tokenStaleDirector = await mint({ sub: USER_TEACHER_FREE, role: "Directeur", roleKeys: ["PRINCIPAL"], schoolCode: LEFTOVER_A,
      permissions: ["Présences:READ", "Présences:CREATE", "Présences:UPDATE"] });

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
    const { rollCallId: okRollCallId, validatedAt: okValidatedAt, counts: okCounts, complete: okComplete, ...okBody } = ok.data;
    assert.equal(okComplete, false, "appel par carte sans confirmation d'appel complet");
    assert.deepEqual(okCounts, { present: 2, absent: 0, late: 0, excused: 0, enrolled: 7, notRecorded: 5 },
      "sans appel complet, les élèves non scannés restent non enregistrés");
    assert.deepEqual(okBody, {
      mode: "teacher", recorded: 2, created: 2, corrected: 0, unchanged: 0, protected: 0, absent: 0, manual: 0,
      duplicatesIgnored: 1, protectedReceiptIndexes: [], protectedManualIndexes: [], classId: classA1.id, date: ctxX.date,
    });
    assert.match(okRollCallId, /^[0-9a-f-]{36}$/);
    assert.ok(Number.isFinite(Date.parse(okValidatedAt)));
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
    assert.equal((await scan(tokenStaleDirector, { ...E, cardToken: cards.S1.cardToken })).data?.code,
      ROLL_CALL_ERROR.ROLE_FORBIDDEN, "rôles relus en base : une clé PRINCIPAL du seul JWT ne suffit pas");
    assert.equal((await scan(tokenDirector, { ...E, mode: "inconnu", cardToken: cards.S1.cardToken })).data?.code,
      ROLL_CALL_ERROR.INPUT_INVALID);
    const e1 = await scan(tokenDirector, { ...E, cardToken: cards.S1.cardToken });
    assert.equal(e1.status, 200, JSON.stringify(e1.data));
    assert.deepEqual(identityLeaks(e1.data), []);
    const e2 = await scan(tokenDirector, { ...E, cardToken: cards.S2.cardToken });
    const eTeacherReceipt = await scan(tokenDirectorTeacher, { ...E, mode: undefined, cardToken: cards.S2.cardToken });
    assert.equal(eTeacherReceipt.status, 200);
    const e3 = await scan(tokenDirector, { ...E, cardToken: cards.S8.cardToken });
    assert.equal(e3.status, 200, JSON.stringify(e3.data));
    const bodyE = { ...E, justification, receipts: [e1.data.receipt, e2.data.receipt, e3.data.receipt] };
    const foreignReceipt = sealReceipt(keys, { ...openReceipt(keys, e1.data.receipt), sch: String(schoolB.id) });
    assert.equal((await validate(tokenDirector, { ...bodyE, receipts: [foreignReceipt] })).data?.code,
      ROLL_CALL_ERROR.CONTEXT_MISMATCH, "reçu d'un autre établissement refusé");
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
    // S8 déjà noté absent (avec motif) par son enseignant ; présence d'un autre établissement à la même date.
    await pool.query(
      `INSERT INTO attendance (school_id, student_id, class_id, teacher_id, attendance_date, status, reason)
       VALUES ($1,$2,$3,$4,$5::date,'absent','Malade'), ($6,$7,$8,NULL,$5::date,'absent','B')`,
      [schoolA.id, S.S8, classA1.id, teacher.id, E.date, schoolB.id, STUDENT_B, classB1.id],
    );
    const snapshot = async () => (await pool.query(
      `SELECT school_id, student_id, status, reason, teacher_id, class_id, updated_at FROM attendance
        WHERE attendance_date = $1 AND (student_id IN ($2, $3) OR school_id = $4) ORDER BY student_id`,
      [E.date, S.S2, S.S8, schoolB.id])).rows.map((r) => JSON.stringify(r));
    const before = await snapshot();
    const okE = await validate(tokenDirector, bodyE);
    assert.equal(okE.status, 201, JSON.stringify(okE.data));
    const { rollCallId: okERollCallId, validatedAt: _okEValidatedAt, ...okEBody } = okE.data;
    assert.deepEqual(okEBody, { mode: "direction", recorded: 1, alreadyRecorded: 2, duplicatesIgnored: 0, classId: classA1.id, date: E.date });
    const journalE = (await pool.query(
      `SELECT mode, author_user_id, author_role_keys, teacher_id, justification, scanned_count, created_count, protected_count
         FROM attendance_roll_calls WHERE id = $1`, [okERollCallId],
    )).rows[0];
    assert.deepEqual(
      [journalE.mode, journalE.author_user_id, journalE.author_role_keys, journalE.teacher_id, journalE.justification,
        journalE.scanned_count, journalE.created_count, journalE.protected_count],
      ["direction", USER_DIRECTOR, ["PRINCIPAL"], null, justification, 3, 1, 2],
      "journal : auteur réel, aucune attribution enseignant, existant protégé",
    );
    assert.deepEqual(await snapshot(), before, "présences déjà enregistrées (présent, absent avec motif) et autre établissement inchangés");
    const rowsE = (await pool.query(
      `SELECT student_id, status, teacher_id FROM attendance WHERE attendance_date = $1 AND school_id = $2 ORDER BY student_id`,
      [E.date, schoolA.id])).rows;
    assert.deepEqual(rowsE.map((r) => [r.student_id, r.status, r.teacher_id === null ? null : String(r.teacher_id)]),
      [[S.S1, "present", null], [S.S2, "present", String(teacher.id)], [S.S8, "absent", String(teacher.id)]],
      "aucun enseignant fictif ; auteur existant conservé");
    const auditE = (await pool.query(
      `SELECT user_id, school_id, entity_id, new_value FROM audit_logs WHERE action = 'student_card_roll_call_direction'`)).rows;
    assert.equal(auditE.length, 1);
    assert.equal(String(auditE[0].user_id), USER_DIRECTOR, "auteur réel tracé");
    assert.equal(String(auditE[0].school_id), String(schoolA.id));
    assert.equal(auditE[0].entity_id, E.sessionId);
    assert.equal(auditE[0].new_value.justification, justification);
    assert.deepEqual(auditE[0].new_value.authorRoleKeys, ["PRINCIPAL"]);
    assert.equal(auditE[0].new_value.recorded, 1);
    assert.equal(auditE[0].new_value.alreadyRecorded, 2);
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
    // Statut d'inscription historique « active » (seed de démo, données préexistantes) : même
    // sémantique qu'« ENROLLED » pour l'effectif, comme partout ailleurs (ROSTER_ENROLLMENT_SQL).
    await pool.query(
      `UPDATE enrollments SET status = 'active' WHERE school_id = $1 AND class_id = $2 AND student_id = $3`,
      [schoolA.id, classA1.id, S.S7],
    );
    const ov = await overview(tokenDirector);
    assert.equal(ov.status, 200, JSON.stringify(ov.data));
    assert.equal(ov.cacheControl, "no-store");
    assert.equal(ov.data.date, E.date);
    const ovA1 = ov.data.classes.find((c) => c.classId === classA1.id);
    assert.deepEqual(
      { enrolled: ovA1.enrolled, present: ovA1.present, recorded: ovA1.recorded, notRecorded: ovA1.notRecorded, status: ovA1.status },
      { enrolled: 7, present: 2, recorded: 3, notRecorded: 4, status: "partial" },
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
    assert.equal((await overview(tokenStaleDirector)).status, 403, "supervision : rôles relus en base");

    // ---------- Révocation du rôle de direction : effet immédiat, sans attendre l'expiration du jeton ----------
    await pool.query(
      `UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1 AND role_key = 'PRINCIPAL'`,
      [USER_DIRECTOR],
    );
    const G = { sessionId: session(), classId: classA1.id, date: "2026-10-19", mode: "direction" };
    assert.equal((await scan(tokenDirector, { ...G, cardToken: cards.S1.cardToken })).data?.code, ROLL_CALL_ERROR.ROLE_FORBIDDEN,
      "rôle PRINCIPAL révoqué : appel exceptionnel refusé malgré un jeton encore valide");
    const g1 = sealReceipt(keys, { ...openReceipt(keys, f1.data.receipt), dt: G.date, ses: G.sessionId, exp: Date.now() + 60_000 });
    assert.equal((await validate(tokenDirector, { ...G, justification, receipts: [g1] })).data?.code, ROLL_CALL_ERROR.ROLE_FORBIDDEN);
    assert.equal((await overview(tokenDirector)).status, 403);
    assert.deepEqual(await attendanceOn(pool, G.date), []);

    // ---------- Aucun secret dans l'audit ----------
    const audit = JSON.stringify((await pool.query(`SELECT old_value, new_value FROM audit_logs`)).rows);
    for (const secret of [s1.data.receipt, s1.data.dedupKey, cards.S1.cardToken.split(".")[1], cards.S2.cardToken.split(".")[1]]) {
      assert.equal(audit.includes(secret), false, "audit sans reçu ni jeton");
    }

    // ---------- CARTE-PR3-B : appel en classe (pointage manuel, écrasements, journal) ----------
    const H = { sessionId: session(), classId: classA1.id, date: "2026-10-20" };
    const rowsOn = async (date) => Object.fromEntries((await pool.query(
      `SELECT student_id, status, reason FROM attendance WHERE attendance_date = $1::date AND school_id = $2`, [date, schoolA.id],
    )).rows.map((row) => [row.student_id, [row.status, row.reason]]));
    // Existant : S2 justifié (protégé), S5 absent (corrigeable), S8 présent (ne peut pas devenir absent).
    await pool.query(
      `INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status, reason)
       VALUES ($1,$2,$5,$6,'excused','Malade'), ($1,$3,$5,$6,'absent','Non venu'), ($1,$4,$5,$6,'present',NULL)`,
      [schoolA.id, S.S2, S.S5, S.S8, classA1.id, H.date],
    );
    const h1 = await scan(tokenTeacher, { ...H, cardToken: cards.S1.cardToken });
    const h2 = await scan(tokenTeacher, { ...H, cardToken: cards.S2.cardToken });
    const h5 = await scan(tokenTeacher, { ...H, cardToken: replaced.data.card.cardToken });
    for (const scanned of [h1, h2, h5]) assert.equal(scanned.status, 200, JSON.stringify(scanned.data));
    const manualH = [
      { studentId: S.S3, status: "absent" }, { studentId: S.S6, status: "present" },
      { studentId: S.S7, status: "late" }, { studentId: S.S8, status: "absent" },
    ];
    const bodyH = { ...H, receipts: [h1.data.receipt, h2.data.receipt, h5.data.receipt], manual: manualH, complete: true };
    const beforeH = await rowsOn(H.date);

    // Refus du pointage manuel : rien n'est écrit, ni présence ni journal.
    const journalCount = async () => Number((await pool.query(`SELECT count(*)::int AS n FROM attendance_roll_calls`)).rows[0].n);
    const journalBefore = await journalCount();
    for (const [label, body, status, code] of [
      ["élève d'une autre classe", { ...bodyH, manual: [...manualH, { studentId: S.S4, status: "present" }] }, 403,
        ROLL_CALL_ERROR.STUDENT_NOT_ENROLLED],
      ["élève d'un autre établissement", { ...bodyH, manual: [{ studentId: STUDENT_B, status: "present" }] }, 403,
        ROLL_CALL_ERROR.STUDENT_NOT_ENROLLED],
      ["statut justifié interdit à l'appel", { ...bodyH, manual: [{ studentId: S.S3, status: "excused" }] }, 400,
        ROLL_CALL_ERROR.INPUT_INVALID],
      ["élève en double", { ...bodyH, manual: [manualH[0], manualH[0]] }, 400, ROLL_CALL_ERROR.INPUT_INVALID],
      ["élève scanné et pointé", { ...bodyH, manual: [{ studentId: S.S1, status: "absent" }] }, 400, ROLL_CALL_ERROR.INPUT_INVALID],
      ["appel vide", { ...H, receipts: [], manual: [] }, 400, ROLL_CALL_ERROR.INPUT_INVALID],
    ]) {
      const refused = await validate(tokenTeacher, body);
      assert.equal(refused.status, status, `${label}: ${JSON.stringify(refused.data)}`);
      assert.equal(refused.data?.code, code, label);
    }
    const notEnrolled = await validate(tokenTeacher, { ...bodyH, manual: [...manualH, { studentId: S.S4, status: "present" }] });
    assert.deepEqual(notEnrolled.data?.details, { invalidManualIndexes: [4] }, "seule la position refusée");
    const freeManual = await validate(tokenTeacherFree, { ...H, manual: [{ studentId: S.S3, status: "present" }] });
    assert.equal(freeManual.status, 403, "enseignant non affecté : aucun pointage manuel");
    await pool.query(`UPDATE user_roles SET status = 'active', revoked_at = NULL WHERE user_id = $1 AND role_key = 'PRINCIPAL'`,
      [USER_DIRECTOR]);
    const directionManual = await validate(tokenDirector, { ...H, mode: "direction", justification, manual: [manualH[1]] });
    assert.equal(directionManual.data?.code, ROLL_CALL_ERROR.MANUAL_FORBIDDEN, "aucun pointage nominatif par la direction");
    assert.deepEqual(await rowsOn(H.date), beforeH, "aucun refus n'a modifié les présences");
    assert.equal(await journalCount(), journalBefore, "aucun refus n'a écrit le journal");

    // Validation : créations, correction absent → présent, refus des écrasements interdits.
    const okH = await validate(tokenTeacher, bodyH);
    assert.equal(okH.status, 201, JSON.stringify(okH.data));
    const { rollCallId: rollCallH, validatedAt: _validatedH, counts: countsH, complete: completeH, ...okHBody } = okH.data;
    assert.equal(completeH, true);
    assert.deepEqual(countsH, { present: 4, absent: 1, late: 1, excused: 1, enrolled: 7, notRecorded: 0 }, "comptage exact");
    assert.deepEqual(okHBody, {
      mode: "teacher", recorded: 5, created: 4, corrected: 1, unchanged: 0, protected: 2, absent: 1, manual: 4,
      duplicatesIgnored: 0, protectedReceiptIndexes: [1], protectedManualIndexes: [3], classId: classA1.id, date: H.date,
    });
    assert.deepEqual(identityLeaks({ ...okH.data, protectedManualIndexes: undefined }), []);
    const afterH = await rowsOn(H.date);
    assert.deepEqual(afterH[S.S2], ["excused", "Malade"], "justifié jamais écrasé par un scan");
    assert.deepEqual(afterH[S.S8], ["present", null], "présent jamais rétrogradé en absent par l'appel");
    assert.equal(afterH[S.S5][0], "present", "absent → présent autorisé");
    assert.deepEqual([afterH[S.S1][0], afterH[S.S3][0], afterH[S.S6][0], afterH[S.S7][0]], ["present", "absent", "present", "late"]);
    assert.equal(Object.keys(afterH).length, 7, "aucun absent automatique : seuls les élèves scannés ou pointés");
    const journalH = (await pool.query(
      `SELECT mode, author_user_id, author_role_keys, teacher_id, justification, session_id, scanned_count, manual_count,
              created_count, corrected_count, unchanged_count, protected_count
         FROM attendance_roll_calls WHERE id = $1`, [rollCallH],
    )).rows[0];
    assert.deepEqual(journalH, {
      mode: "teacher", author_user_id: USER_TEACHER, author_role_keys: ["TEACHER"], teacher_id: teacher.id, justification: null,
      session_id: H.sessionId, scanned_count: 3, manual_count: 4, created_count: 4, corrected_count: 1, unchanged_count: 0,
      protected_count: 2,
    });
    const auditH = (await pool.query(
      `SELECT user_id, new_value FROM audit_logs WHERE action = 'student_card_roll_call_teacher' AND entity_id = $1`, [rollCallH],
    )).rows;
    assert.equal(auditH.length, 1);
    assert.equal(String(auditH[0].user_id), USER_TEACHER, "auteur réel");
    assert.deepEqual(auditH[0].new_value.corrections.map((c) => [c.studentId, c.from, c.to]), [[S.S5, "absent", "present"]],
      "correction tracée");
    assert.deepEqual(auditH[0].new_value.protected.map((p) => [p.studentId, p.kept, p.requested]).sort(),
      [[S.S2, "excused", "present"], [S.S8, "present", "absent"]].sort());

    // Double validation : rejeu idempotent ; sans enregistrement d'idempotence, le journal refuse.
    const replayH = await validate(tokenTeacher, bodyH);
    assert.equal(replayH.data.idempotentReplay, true);
    await pool.query(`DELETE FROM idempotency_keys WHERE route_key = 'POST /api/student-cards/roll-call/validate'`);
    const twiceH = await validate(tokenTeacher, bodyH);
    assert.equal(twiceH.status, 409, JSON.stringify(twiceH.data));
    assert.equal(twiceH.data?.code, ROLL_CALL_ERROR.ALREADY_VALIDATED);
    assert.deepEqual(await rowsOn(H.date), afterH, "seconde validation refusée sans aucune écriture");
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM attendance_roll_calls WHERE session_id = $1`, [H.sessionId]))
      .rows[0].n, 1);

    // Nouvelle session, même jour : correction manuelle absent → présent (élève arrivé), le reste inchangé.
    const K = { ...H, sessionId: session() };
    const k5 = await scan(tokenTeacher, { ...K, cardToken: replaced.data.card.cardToken });
    const okK = await validate(tokenTeacher, { ...K, receipts: [k5.data.receipt], manual: [{ studentId: S.S3, status: "late" }] });
    assert.equal(okK.status, 201, JSON.stringify(okK.data));
    assert.deepEqual([okK.data.created, okK.data.corrected, okK.data.unchanged, okK.data.protected], [0, 1, 1, 0]);
    assert.equal((await rowsOn(H.date))[S.S3][0], "late");

    // Appel uniquement manuel : seuls les élèves pointés, aucun absent créé pour les autres.
    const J = { sessionId: session(), classId: classA1.id, date: "2026-10-21" };
    const okJ = await validate(tokenTeacher, { ...J, manual: [{ studentId: S.S1, status: "present" }] });
    assert.equal(okJ.status, 201, JSON.stringify(okJ.data));
    assert.deepEqual(Object.keys(await rowsOn(J.date)), [S.S1]);

    // ---------- CARTE-PR3-B : concurrence réelle (deux connexions PostgreSQL) ----------
    // Une seconde connexion écrit sans valider pendant que l'appel s'exécute : l'appel doit attendre
    // puis respecter l'état validé (jamais d'écrasement silencieux), de façon déterministe.
    const waitForBlockedBackends = async (count, waitEventType = "Lock", timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const { rows } = await pool.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = $1 AND state = 'active'`,
          [waitEventType],
        );
        if (rows[0].n >= count) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    };
    const statusOf = async (studentId, date) => (await pool.query(
      `SELECT status, reason FROM attendance WHERE school_id = $1 AND student_id = $2 AND attendance_date = $3::date`,
      [schoolA.id, studentId, date],
    )).rows;

    // C1 — un justifié validé pendant l'appel n'est jamais écrasé par un scan « présent ».
    const C1 = { sessionId: session(), classId: classA1.id, date: "2026-10-22" };
    const c1Scan = await scan(tokenTeacher, { ...C1, cardToken: cards.S1.cardToken });
    assert.equal(c1Scan.status, 200, JSON.stringify(c1Scan.data));
    const writerC1 = await pool.connect();
    let race1;
    try {
      await writerC1.query("BEGIN");
      await writerC1.query(
        `INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status, reason)
         VALUES ($1, $2, $3, $4::date, 'excused', 'Malade')`,
        [schoolA.id, S.S1, classA1.id, C1.date],
      );
      const pendingC1 = validate(tokenTeacher, { ...C1, receipts: [c1Scan.data.receipt] });
      assert.equal(await waitForBlockedBackends(1), true, "l'appel attend l'écriture concurrente");
      await writerC1.query("COMMIT");
      race1 = await pendingC1;
    } finally {
      writerC1.release();
    }
    assert.equal(race1.status, 201, JSON.stringify(race1.data));
    assert.deepEqual(await statusOf(S.S1, C1.date), [{ status: "excused", reason: "Malade" }],
      "C1 : justifié concurrent jamais écrasé");
    assert.deepEqual([race1.data.created, race1.data.corrected, race1.data.protected, race1.data.recorded], [0, 0, 1, 0]);
    assert.deepEqual(race1.data.protectedReceiptIndexes, [0]);
    const journalC1 = (await pool.query(
      `SELECT created_count, protected_count FROM attendance_roll_calls WHERE id = $1`, [race1.data.rollCallId],
    )).rows[0];
    assert.deepEqual(journalC1, { created_count: 0, protected_count: 1 }, "C1 : journal conforme à l'écriture réelle");

    // C2 — un présent validé pendant l'appel n'est jamais rétrogradé par un « absent » manuel.
    const C2 = { sessionId: session(), classId: classA1.id, date: "2026-10-23" };
    const writerC2 = await pool.connect();
    let race2;
    try {
      await writerC2.query("BEGIN");
      await writerC2.query(
        `INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status)
         VALUES ($1, $2, $3, $4::date, 'present')`,
        [schoolA.id, S.S3, classA1.id, C2.date],
      );
      // Appel complet confirmé : S3 « absent » (provisoire) pendant qu'un « présent » est enregistré.
      const pendingC2 = validate(tokenTeacher, {
        ...C2,
        complete: true,
        manual: [
          { studentId: S.S3, status: "absent" },
          ...[S.S1, S.S2, S.S5, S.S6, S.S7, S.S8].map((studentId) => ({ studentId, status: "present" })),
        ],
      });
      assert.equal(await waitForBlockedBackends(1), true, "l'appel attend l'écriture concurrente");
      await writerC2.query("COMMIT");
      race2 = await pendingC2;
    } finally {
      writerC2.release();
    }
    assert.equal(race2.status, 201, JSON.stringify(race2.data));
    assert.equal((await statusOf(S.S3, C2.date))[0].status, "present", "C2 : présent concurrent jamais rétrogradé");
    assert.deepEqual([race2.data.created, race2.data.protected, race2.data.absent], [6, 1, 0]);
    assert.deepEqual(race2.data.protectedManualIndexes, [0]);

    // C3 — appels Enseignant et Direction simultanés sur le même établissement et la même date :
    // sérialisés par le verrou transactionnel ; une seule présence, compteurs cohérents.
    const C3 = { sessionId: session(), classId: classA1.id, date: "2026-10-24" };
    const C3D = { sessionId: session(), classId: classA1.id, date: C3.date, mode: "direction" };
    const c3Dir = await scan(tokenDirector, { ...C3D, cardToken: cards.S2.cardToken });
    assert.equal(c3Dir.status, 200, JSON.stringify(c3Dir.data));
    const lockHolder = await pool.connect();
    let c3Teacher;
    let c3Direction;
    try {
      await lockHolder.query("BEGIN");
      await lockHolder.query(
        `SELECT pg_advisory_xact_lock(hashtext('attendance-roll-call'), hashtext($1::text || ':' || $2::text))`,
        [schoolA.id, C3.date],
      );
      const pendingTeacher = validate(tokenTeacher, { ...C3, manual: [{ studentId: S.S2, status: "present" }] });
      const pendingDirection = validate(tokenDirector, { ...C3D, justification, receipts: [c3Dir.data.receipt] });
      const serialized = await waitForBlockedBackends(2, "Lock", 3000);
      await lockHolder.query("COMMIT");
      [c3Teacher, c3Direction] = await Promise.all([pendingTeacher, pendingDirection]);
      assert.equal(serialized, true, "C3 : appels Enseignant et Direction sérialisés par établissement et date");
    } finally {
      lockHolder.release();
    }
    assert.equal(c3Teacher.status, 201, JSON.stringify(c3Teacher.data));
    assert.equal(c3Direction.status, 201, JSON.stringify(c3Direction.data));
    assert.equal((await statusOf(S.S2, C3.date)).length, 1, "C3 : une seule présence");
    const c3Journals = (await pool.query(
      `SELECT mode, created_count, unchanged_count, protected_count FROM attendance_roll_calls
        WHERE session_id = ANY($1::uuid[]) ORDER BY mode`,
      [[C3.sessionId, C3D.sessionId]],
    )).rows;
    assert.equal(c3Journals.length, 2);
    assert.equal(c3Journals.reduce((sum, row) => sum + row.created_count, 0), 1, "C3 : une seule création comptée");
    assert.equal(c3Journals.reduce((sum, row) => sum + row.created_count + row.unchanged_count + row.protected_count, 0), 2,
      "C3 : chaque demande comptée une fois");

    // ---------- CARTE-PR3-B : absent par défaut (liste d'appel + appel complet confirmé) ----------
    const roster = (token, query, headers = {}) =>
      request(`/student-cards/roll-call/roster?${new URLSearchParams(query).toString()}`, { token, headers });
    const outboxCount = async (eventType, date) => Number((await pool.query(
      `SELECT count(*)::int AS n FROM communication_event_outbox
        WHERE event_type = $1 AND school_id = $2 AND payload->>'attendanceDate' = $3`,
      [eventType, schoolA.id, date],
    )).rows[0].n);
    const DAY = { sessionId: session(), classId: classA1.id, date: "2026-10-26" };
    // Existant avant l'appel : S2 justifié, S5 présent déjà validé.
    await pool.query(
      `INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status, reason)
       VALUES ($1,$2,$4,$5::date,'excused','Malade'), ($1,$3,$4,$5::date,'present',NULL)`,
      [schoolA.id, S.S2, S.S5, classA1.id, DAY.date],
    );
    const attendanceRowsD = async () => (await pool.query(
      `SELECT count(*)::int AS n FROM attendance WHERE school_id = $1 AND attendance_date = $2::date`, [schoolA.id, DAY.date],
    )).rows[0].n;
    const absentBefore = await outboxCount("attendance.student.absent", DAY.date);

    // Liste d'appel : inscrits actifs, statut existant, provisoire « absent », clé de rapprochement de session.
    const rD = await roster(tokenTeacher, DAY);
    assert.equal(rD.status, 200, JSON.stringify(rD.data));
    assert.equal(rD.cacheControl, "no-store");
    const byStudent = Object.fromEntries(rD.data.students.map((row) => [row.studentId, row]));
    assert.deepEqual(Object.keys(byStudent).sort(), [S.S1, S.S2, S.S3, S.S5, S.S6, S.S7, S.S8].sort(),
      "uniquement les élèves activement inscrits de la classe");
    assert.deepEqual([byStudent[S.S2].existingStatus, byStudent[S.S2].provisionalStatus], ["excused", "excused"]);
    assert.deepEqual([byStudent[S.S5].existingStatus, byStudent[S.S5].provisionalStatus], ["present", "present"]);
    assert.deepEqual([byStudent[S.S3].existingStatus, byStudent[S.S3].provisionalStatus], [null, "absent"]);
    assert.deepEqual(rD.data.counts, { present: 1, absent: 5, late: 0, excused: 1, enrolled: 7 });
    const scanD1 = await scan(tokenTeacher, { ...DAY, cardToken: cards.S1.cardToken });
    assert.equal(scanD1.status, 200, JSON.stringify(scanD1.data));
    assert.equal(scanD1.data.dedupKey, byStudent[S.S1].matchKey, "le scan se rapproche de l'élève de la liste de l'enseignant");
    assert.deepEqual(identityLeaks(scanD1.data), [], "la réponse du scan reste sans identité");
    const otherSession = await roster(tokenTeacher, { ...DAY, sessionId: session() });
    assert.notEqual(otherSession.data.students.find((row) => row.studentId === S.S1).matchKey, byStudent[S.S1].matchKey,
      "clé de rapprochement limitée à la session");
    assert.equal(await attendanceRowsD(), 2, "aucune écriture à l'ouverture de la liste ni au scan");
    assert.equal(await outboxCount("attendance.student.absent", DAY.date), absentBefore, "aucune notification avant validation");

    // RBAC et isolation : uniquement l'enseignant affecté, dans son établissement.
    for (const [label, token, headers, expected] of [
      ["enseignant non affecté", tokenTeacherFree, {}, ROLL_CALL_ERROR.CLASS_FORBIDDEN],
      ["direction", tokenDirector, {}, ROLL_CALL_ERROR.ROLE_FORBIDDEN],
      ["surveillant", tokenSupervisor, {}, null],
      ["parent", tokenParent, {}, null],
      ["jeton périmé", tokenStaleDirector, {}, null],
      ["autre établissement", tokenAdminB, {}, null],
      ["Superadmin", tokenSuper, { "X-Somafrik-School-Code": LOGIN_A }, "PLATFORM_PERSONAL_DATA_DENIED"],
      ["Admin Pays", tokenPays, {}, "PLATFORM_PERSONAL_DATA_DENIED"],
    ]) {
      const denied = await roster(token, DAY, headers);
      assert.equal(denied.status >= 400 && denied.status < 500, true, `${label}: ${denied.status}`);
      assert.notEqual(denied.status, 200, label);
      if (expected) assert.equal(denied.data?.code, expected, label);
      assert.equal(JSON.stringify(denied.data ?? "").includes(S.S3), false, `${label}: aucune donnée d'élève`);
    }
    assert.equal((await roster(tokenTeacher, { ...DAY, classId: classB1.id })).data?.code, ROLL_CALL_ERROR.CLASS_FORBIDDEN,
      "classe d'un autre établissement");
    assert.equal((await roster(tokenTeacher, { ...DAY, sessionId: "x" })).data?.code, ROLL_CALL_ERROR.INPUT_INVALID);

    // Absences seulement après confirmation explicite de l'appel complet.
    const fullManual = [
      { studentId: S.S2, status: "absent" }, // justifié existant : jamais écrasé
      { studentId: S.S3, status: "absent" },
      { studentId: S.S6, status: "present" },
      { studentId: S.S7, status: "late" },
      { studentId: S.S8, status: "absent" },
    ]; // S5 (présent existant) couvert par son statut, non renvoyé.
    const bodyD = { ...DAY, receipts: [scanD1.data.receipt], manual: fullManual, complete: true };
    const unconfirmed = await validate(tokenTeacher, { ...bodyD, complete: undefined });
    assert.equal(unconfirmed.data?.code, ROLL_CALL_ERROR.CONFIRMATION_REQUIRED, JSON.stringify(unconfirmed.data));
    // Effectif modifié : un élève manquant, puis une inscription ajoutée après l'ouverture.
    const missingOne = await validate(tokenTeacher, { ...bodyD, manual: fullManual.filter((row) => row.studentId !== S.S8) });
    assert.equal(missingOne.status, 409, JSON.stringify(missingOne.data));
    assert.equal(missingOne.data?.code, ROLL_CALL_ERROR.ROSTER_CHANGED);
    assert.deepEqual(missingOne.data?.details, { missing: 1, unexpected: 0, enrolled: 7 });
    await pool.query(`UPDATE enrollments SET class_id = $1 WHERE student_id = $2`, [classA1.id, S.S4]);
    const newcomer = await validate(tokenTeacher, bodyD);
    assert.equal(newcomer.data?.code, ROLL_CALL_ERROR.ROSTER_CHANGED, "inscription ajoutée après l'ouverture : 409");
    await pool.query(`UPDATE enrollments SET class_id = $1 WHERE student_id = $2`, [classA2.id, S.S4]);
    assert.equal(await attendanceRowsD(), 2, "aucune écriture sur refus");
    assert.equal(await outboxCount("attendance.student.absent", DAY.date), absentBefore, "aucune notification sur refus");

    // Validation confirmée : statuts de tout le périmètre, justifié et présent préservés, comptage exact.
    const okD = await validate(tokenTeacher, bodyD);
    assert.equal(okD.status, 201, JSON.stringify(okD.data));
    assert.deepEqual([okD.data.created, okD.data.corrected, okD.data.unchanged, okD.data.protected, okD.data.absent],
      [5, 0, 0, 1, 2]);
    assert.deepEqual(okD.data.counts, { present: 3, absent: 2, late: 1, excused: 1, enrolled: 7, notRecorded: 0 });
    assert.deepEqual(await statusOf(S.S2, DAY.date), [{ status: "excused", reason: "Malade" }], "justifié jamais écrasé");
    assert.equal((await statusOf(S.S5, DAY.date))[0].status, "present", "présence existante conservée");
    assert.equal(await outboxCount("attendance.student.absent", DAY.date), absentBefore + 2,
      "une notification par absence réellement enregistrée (S3, S8), aucune pour le justifié");
    // Idempotence et double validation : aucune notification supplémentaire.
    assert.equal((await validate(tokenTeacher, bodyD)).data.idempotentReplay, true);
    await pool.query(`DELETE FROM idempotency_keys WHERE route_key = 'POST /api/student-cards/roll-call/validate'`);
    assert.equal((await validate(tokenTeacher, bodyD)).data?.code, ROLL_CALL_ERROR.ALREADY_VALIDATED);
    assert.equal(await outboxCount("attendance.student.absent", DAY.date), absentBefore + 2, "rejeu et double validation sans notification");

    // Rollback : absences écrites puis transaction annulée (journal déjà occupé) → ni présence ni notification.
    const ROLLBACK_DAY = { sessionId: session(), classId: classA1.id, date: "2026-10-27" };
    await pool.query(
      `INSERT INTO attendance_roll_calls (school_id, class_id, roll_call_date, session_id, mode, author_user_id,
                                          author_role_keys, teacher_id)
       VALUES ($1, $2, $3::date, $4, 'teacher', $5, '{TEACHER}', $6)`,
      [schoolA.id, classA1.id, ROLLBACK_DAY.date, ROLLBACK_DAY.sessionId, USER_TEACHER, teacher.id],
    );
    const rolledBackE = await validate(tokenTeacher, {
      ...ROLLBACK_DAY,
      complete: true,
      manual: [S.S1, S.S2, S.S3, S.S5, S.S6, S.S7, S.S8].map((studentId) => ({ studentId, status: "absent" })),
    });
    assert.equal(rolledBackE.data?.code, ROLL_CALL_ERROR.ALREADY_VALIDATED, JSON.stringify(rolledBackE.data));
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE attendance_date = $1::date`, [ROLLBACK_DAY.date])).rows[0].n, 0);
    assert.equal(await outboxCount("attendance.student.absent", ROLLBACK_DAY.date), 0, "notification annulée avec la transaction");

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
