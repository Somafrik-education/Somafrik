"use strict";

/**
 * NFC-PRES-LOCAL-PR1b — GET /api/student-cards/roll-call/offline/v1/pack, de bout en bout
 * (serveur réel + PostgreSQL isolé).
 *
 * Trois démarrages du serveur : clé de signature mal formée (503), clé A active (cas nominaux et
 * sécurité), puis rotation d'urgence (A révoquée, B active). Clés générées à l'exécution.
 *
 * Fenêtre d'émission déterministe : l'établissement reçoit un fuseau fixe `Etc/GMT±N` choisi pour
 * qu'il soit l'après-midi au moment du test ; « aujourd'hui » et « demain » sont alors émissibles,
 * « hier » et « après-demain » refusés.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { mintSessionAccessToken } = require("./testAccessSession");
const { packSigningMessage, revocationsSigningMessage, computeCardRef, computeVerifier, cardKeyFromTokenHash } = require("./rollCallOfflineProof");
const { parseKeyring, verifySignature } = require("./rollCallOfflinePackSigner");
const { computePackWindow, isoSeconds, wallTime, computeMatchKey, deriveMatchKeySecret } = require("./rollCallOfflinePack");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_roll_call_offline_pack_it";
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_OFFLINE_PACK_HTTP_PORT ?? 19894);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";
// Secret de rapprochement dédié, distinct de JWT_SECRET (valeur de test construite à l'exécution).
const MATCH_SECRET = "pr1b-test-only-match-".repeat(3);

const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const LOGIN_C = "CD-SUS-26-002";
const CODE_A = "CD-2026-0001";
const CODE_B = "BI-2026-0001";
const CODE_C = "CD-2026-0003";
const U = (n) => `ffffffff-ffff-4fff-8fff-${String(n).padStart(12, "0")}`;
const USER = {
  ADMIN_A: U(1), TEACHER: U(2), TEACHER_FREE: U(3), PARENT: U(4), SUPER: U(5), PAYS: U(6), ADMIN_B: U(7), TEACHER_B: U(8),
  ADMIN_C: U(9), TEACHER_C: U(10),
};
const S = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`S${n}`, U(100 + n)]));
const STUDENT_B = U(199);
const STUDENT_C = U(198);

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

async function request(pathname, { method = "GET", token, body, headers = {}, port = HTTP_PORT } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, text, cacheControl: response.headers.get("cache-control") };
}

async function startServer(isolatedUrl, extraEnv, port = HTTP_PORT) {
  const child = spawn(process.execPath, ["backend/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      DATABASE_URL: isolatedUrl,
      JWT_SECRET,
      SOMAFRIK_DB_REQUIRED: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
      SOMAFRIK_API_ONLY: "true",
      ROLL_CALL_PACK_SIGNING_KEY: "",
      ROLL_CALL_PACK_KEYRING: "",
      ROLL_CALL_PACK_MATCH_SECRET: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = { value: "" };
  child.stdout.on("data", (chunk) => { output.value += String(chunk); });
  child.stderr.on("data", (chunk) => { output.value += String(chunk); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Backend exited early: ${child.exitCode}\n${output.value}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return { child, output };
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${output.value}`);
}

async function stopServer(server) {
  const child = server?.child;
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
    child.on("exit", () => { clearTimeout(timer); resolve(); });
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
  const existing = await pool.query("SELECT id FROM countries WHERE iso_code = $1 LIMIT 1", [iso]);
  if (existing.rowCount) return existing.rows[0];
  return (await pool.query("INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ($1,$2,$3,$4) RETURNING id", [name, iso, phone, currency])).rows[0];
}

async function setRoleModuleGrant(pool, roleKey, moduleKey, flags) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
      WHERE upper(role_key) = upper($1) AND module_key = $2 AND scope_type = 'global' AND status = 'active' LIMIT 1`,
    [roleKey, moduleKey],
  );
  if (existing.rowCount) {
    await pool.query(
      "UPDATE role_module_permissions SET can_create = $2, can_read = $3, can_update = $4, can_delete = FALSE, updated_at = NOW() WHERE id = $1",
      [existing.rows[0].id, flags.create, flags.read, flags.update],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by)
     VALUES ($1, 'global', $2, $3, $4, $5, FALSE, 'nfc-pres-local-pr1b')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update],
  );
}

function newKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateB64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicRaw: publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64url"),
  };
}

/** Fuseau fixe Etc/GMT±N où il est entre 14 h et 20 h au moment du test. */
function afternoonZone(nowMs) {
  const utcHour = new Date(nowMs).getUTCHours();
  for (let offset = -12; offset <= 14; offset += 1) {
    const localHour = (utcHour + offset + 48) % 24;
    if (localHour >= 14 && localHour <= 20) {
      // Convention POSIX inversée : Etc/GMT-3 = UTC+3.
      return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
    }
  }
  throw new Error("aucun fuseau fixe trouvé");
}

const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

async function main() {
  if (!DATABASE_URL) {
    console.log("rollCallOfflinePack.http.pg.test.js SKIP (DATABASE_URL absent)");
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
  const pool = new Pool({ connectionString: isolatedUrl });
  let server = null;
  let serverNext = null;
  const keyA = newKey();
  const keyB = newKey();
  const keyC = newKey();
  const ringV1 = { revocationSequence: 0, keys: [
    { keyId: "rc-pack-it-a", publicKey: keyA.publicRaw, status: "active" },
    { keyId: "rc-pack-it-b", publicKey: keyB.publicRaw, status: "standby" },
  ] };
  const ringV2 = { revocationSequence: 1, keys: [
    { keyId: "rc-pack-it-a", publicKey: keyA.publicRaw, status: "revoked" },
    { keyId: "rc-pack-it-b", publicKey: keyB.publicRaw, status: "active" },
    { keyId: "rc-pack-it-c", publicKey: keyC.publicRaw, status: "standby" },
  ] };
  try {
    await repo.init();
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    await setLoginCodeTriggers(pool, false);
    const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
    const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
    const school = async (country, code, login, short, name) => (await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`,
      [country, code, login, short, name],
    )).rows[0].id;
    const schoolA = await school(cd.id, CODE_A, LOGIN_A, "LAC", "Lycée Lac");
    const schoolB = await school(bi.id, CODE_B, LOGIN_B, "BUJ", "Lycée Buj");
    const schoolC = await school(cd.id, CODE_C, LOGIN_C, "SUS", "Lycée Suspendu");
    await setLoginCodeTriggers(pool, true);
    await pool.query("ALTER TABLE users DISABLE TRIGGER users_permanent_identity_insert");
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password) VALUES
         ($1,$11,'PK-ADM-A','Aline','A','aline@pk.test','Admin School','active', FALSE),
         ($2,$11,'PK-ENS-A','Chidi','T','chidi@pk.test','Enseignant','active', FALSE),
         ($3,$11,'PK-ENS-F','Fatou','F','fatou@pk.test','Enseignant','active', FALSE),
         ($4,$11,'PK-PAR-A','Paule','P','paule@pk.test','Parent','active', FALSE),
         ($5,NULL,'PK-SUPER','Super','Admin','super@pk.test','Super Administrateur Somafrik','active', FALSE),
         ($6,NULL,'PK-PAYS','Admin','Pays','pays@pk.test','Admin Pays','active', FALSE),
         ($7,$12,'PK-ADM-B','Binta','B','binta@pk.test','Admin School','active', FALSE),
         ($8,$12,'PK-ENS-B','Bruno','B','bruno@pk.test','Enseignant','active', FALSE),
         ($9,$13,'PK-ADM-C','Celia','C','celia@pk.test','Admin School','active', FALSE),
         ($10,$13,'PK-ENS-C','Cyril','C','cyril@pk.test','Enseignant','active', FALSE)`,
      [USER.ADMIN_A, USER.TEACHER, USER.TEACHER_FREE, USER.PARENT, USER.SUPER, USER.PAYS, USER.ADMIN_B, USER.TEACHER_B, USER.ADMIN_C, USER.TEACHER_C, schoolA, schoolB, schoolC],
    );
    await pool.query("ALTER TABLE users ENABLE TRIGGER users_permanent_identity_insert");
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES
         ($1,$11,'SCHOOL_ADMIN','active'), ($2,$11,'TEACHER','active'), ($3,$11,'TEACHER','active'), ($4,$11,'PARENT','active'),
         ($5,NULL,'SUPER_ADMIN','active'), ($6,NULL,'COUNTRY_ADMIN','active'), ($7,$12,'SCHOOL_ADMIN','active'),
         ($8,$12,'TEACHER','active'), ($9,$13,'SCHOOL_ADMIN','active'), ($10,$13,'TEACHER','active')`,
      [USER.ADMIN_A, USER.TEACHER, USER.TEACHER_FREE, USER.PARENT, USER.SUPER, USER.PAYS, USER.ADMIN_B, USER.TEACHER_B, USER.ADMIN_C, USER.TEACHER_C, schoolA, schoolB, schoolC],
    );
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: true, read: true, update: true });
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status) VALUES
         ($1,$10,'PK-S1','Amina','Kabila','active'), ($2,$10,'PK-S2','Bao','Lutete','active'), ($3,$10,'PK-S3','Cyn','Mbuyi','active'),
         ($4,$10,'PK-S4','Dan','Ngoy','active'), ($5,$10,'PK-S5','Eli','Ombe','active'), ($6,$10,'PK-S6','Fay','Pindi','active'),
         ($7,$10,'PK-S7','Gus','Rafiki','active'), ($8,$11,'PK-SB','Ines','Tshala','active'), ($9,$12,'PK-SC','Jo','Umba','active')`,
      [S.S1, S.S2, S.S3, S.S4, S.S5, S.S6, S.S7, STUDENT_B, STUDENT_C, schoolA, schoolB, schoolC],
    );
    const year = async (schoolId) => (await pool.query(
      "INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027', TRUE, 'open') RETURNING id", [schoolId],
    )).rows[0].id;
    const yearA = await year(schoolA);
    const yearB = await year(schoolB);
    const yearC = await year(schoolC);
    const klass = async (schoolId, yearId, code, name) => (await pool.query(
      "INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,$3,$4,'active') RETURNING id", [schoolId, yearId, code, name],
    )).rows[0].id;
    const classA1 = await klass(schoolA, yearA, "PK-A1", "3e A");
    const classA2 = await klass(schoolA, yearA, "PK-A2", "3e B");
    const classA3 = await klass(schoolA, yearA, "PK-A3", "3e C");
    const classB1 = await klass(schoolB, yearB, "PK-B1", "3e Buj");
    const classC1 = await klass(schoolC, yearC, "PK-C1", "3e Sus");
    const enroll = (schoolId, studentId, classId, yearId) => pool.query(
      "INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1,$2,$3,$4,'ENROLLED')", [schoolId, studentId, classId, yearId],
    );
    for (const id of [S.S1, S.S2, S.S3, S.S4, S.S5, S.S6]) await enroll(schoolA, id, classA1, yearA);
    await enroll(schoolA, S.S7, classA2, yearA);
    await enroll(schoolB, STUDENT_B, classB1, yearB);
    await enroll(schoolC, STUDENT_C, classC1, yearC);
    const subject = async (schoolId) => (await pool.query(
      "INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,'MATH','Maths','active') RETURNING id", [schoolId],
    )).rows[0].id;
    const subjectA = await subject(schoolA);
    const subjectB = await subject(schoolB);
    const subjectC = await subject(schoolC);
    const teacherRow = async (schoolId, userId, code) => (await pool.query(
      "INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,$3,'active') RETURNING id", [schoolId, userId, code],
    )).rows[0].id;
    const teacherA = await teacherRow(schoolA, USER.TEACHER, "PK-TCH-A");
    await teacherRow(schoolA, USER.TEACHER_FREE, "PK-TCH-F");
    const teacherB = await teacherRow(schoolB, USER.TEACHER_B, "PK-TCH-B");
    const teacherC = await teacherRow(schoolC, USER.TEACHER_C, "PK-TCH-C");
    const assign = async (schoolId, teacherId, classId, subjectId, yearId) => (await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`, [schoolId, teacherId, classId, subjectId, yearId],
    )).rows[0].id;
    const assignmentA1 = await assign(schoolA, teacherA, classA1, subjectA, yearA);
    await assign(schoolA, teacherA, classA3, subjectA, yearA);
    await assign(schoolB, teacherB, classB1, subjectB, yearB);
    await assign(schoolC, teacherC, classC1, subjectC, yearC);
    await pool.query(
      `INSERT INTO school_settings (school_id, student_card_enabled, student_card_qr_enabled, student_card_nfc_enabled, student_card_attendance_enabled,
                                    student_card_offline_roll_call_enabled)
       VALUES ($1, TRUE, TRUE, TRUE, TRUE, TRUE), ($2, TRUE, TRUE, TRUE, TRUE, TRUE), ($3, TRUE, TRUE, TRUE, TRUE, TRUE)
       ON CONFLICT (school_id) DO UPDATE SET student_card_enabled = TRUE, student_card_qr_enabled = TRUE,
         student_card_nfc_enabled = TRUE, student_card_attendance_enabled = TRUE, student_card_offline_roll_call_enabled = TRUE`,
      [schoolA, schoolB, schoolC],
    );
    await pool.query("UPDATE school_settings SET student_card_holder_kind = 'eleve' WHERE school_id = ANY($1::uuid[])", [[schoolA, schoolB, schoolC]]);
    // Abonnement suspendu pour l'établissement C uniquement.
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, billing_currency, status, start_date, end_date)
       VALUES ($1, 'Standard', 'CDF', 'suspended', CURRENT_DATE - 30, CURRENT_DATE + 300)`,
      [schoolC],
    );
    const nowMs = Date.now();
    const zone = afternoonZone(nowMs);
    await pool.query(
      "UPDATE schools SET profile_payload = COALESCE(profile_payload, '{}'::jsonb) || jsonb_build_object('timezone', $2::text) WHERE id = $1",
      [schoolA, zone],
    );
    const today = wallTime(zone, nowMs).slice(0, 10);

    // ---------- Fuseaux : calcul JS recoupé avec PostgreSQL (AT TIME ZONE) ----------
    for (const [tz, date] of [["Africa/Kinshasa", "2026-11-09"], ["Africa/Lubumbashi", "2026-11-09"], ["Europe/Paris", "2026-03-29"], ["Europe/Paris", "2026-10-25"], ["America/Santiago", "2026-09-06"], [zone, today]]) {
      const window = computePackWindow(tz, date);
      const row = (await pool.query(
        `SELECT ((($1::date - 1)::timestamp + interval '12 hours') AT TIME ZONE $2) AS issue_from,
                ($1::date::timestamp AT TIME ZONE $2) AS not_before,
                (($1::date + 1)::timestamp AT TIME ZONE $2) AS expires_at,
                (($1::date + 4)::timestamp AT TIME ZONE $2) AS sync_deadline`,
        [date, tz],
      )).rows[0];
      assert.deepEqual(
        { issueFrom: window.issueFrom, notBefore: window.notBefore, expiresAt: window.expiresAt, syncDeadline: window.syncDeadline },
        { issueFrom: row.issue_from.getTime(), notBefore: row.not_before.getTime(), expiresAt: row.expires_at.getTime(), syncDeadline: row.sync_deadline.getTime() },
        `fenêtre ${tz} ${date} identique à PostgreSQL`,
      );
    }

    // ---------- Démarrage 1 : clé privée mal formée → 503, aucun pack ----------
    // Base64 valide mais pas une clé PKCS#8 (construite à l'exécution).
    const malformedKey = Buffer.from("not-a-key").toString("base64");
    server = await startServer(isolatedUrl, { ROLL_CALL_PACK_SIGNING_KEY: malformedKey, ROLL_CALL_PACK_KEYRING: JSON.stringify(ringV1) });
    const tokenTeacher = await mint({ sub: USER.TEACHER, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: CODE_A, permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const pack = (token, query, headers) => request(`/student-cards/roll-call/offline/v1/pack?${new URLSearchParams(query)}`, { token, headers });
    const malformed = await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal(malformed.status, 503, malformed.text);
    assert.equal(malformed.data?.code, "ROLL_CALL_PACK_SIGNING_UNAVAILABLE");
    assert.equal(malformed.data?.pack, undefined);
    assert.equal(malformed.text.includes(malformedKey), false, "la valeur de la clé n'est jamais renvoyée");
    assert.equal(server.output.value.includes(malformedKey), false, "ni journalisée");
    await stopServer(server);

    // ---------- Démarrage 1b : clé valide mais secret de rapprochement absent → 503 ----------
    server = await startServer(isolatedUrl, { ROLL_CALL_PACK_SIGNING_KEY: keyA.privateB64, ROLL_CALL_PACK_KEYRING: JSON.stringify(ringV1) });
    const noMatchSecret = await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal(noMatchSecret.status, 503, noMatchSecret.text);
    assert.equal(noMatchSecret.data?.code, "ROLL_CALL_PACK_MATCH_SECRET_UNAVAILABLE");
    assert.equal(noMatchSecret.data?.pack, undefined);
    await stopServer(server);

    // ---------- Démarrage 2 : clé A active ----------
    server = await startServer(isolatedUrl, {
      ROLL_CALL_PACK_SIGNING_KEY: keyA.privateB64, ROLL_CALL_PACK_KEYRING: JSON.stringify(ringV1), ROLL_CALL_PACK_MATCH_SECRET: MATCH_SECRET,
    });
    const tokenTeacherFree = await mint({ sub: USER.TEACHER_FREE, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: CODE_A, permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenTeacherB = await mint({ sub: USER.TEACHER_B, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: CODE_B, permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenTeacherC = await mint({ sub: USER.TEACHER_C, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: CODE_C, permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenAdminA = await mint({ sub: USER.ADMIN_A, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: CODE_A,
      permissions: ["Élèves:UPDATE", "Gérer élèves", "Présences:CREATE", "Présences:UPDATE"] });
    const tokenParent = await mint({ sub: USER.PARENT, role: "Parent", roleKeys: ["PARENT"], schoolCode: CODE_A, permissions: ["Présences:READ"] });
    const tokenSuper = await mint({ sub: USER.SUPER, role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], schoolCode: LOGIN_A,
      permissions: ["ALL_PRIVILEGES", "Présences:CREATE"] });
    const tokenPays = await mint({ sub: USER.PAYS, role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"], schoolCode: LOGIN_A, countryCode: "CD",
      permissions: ["COUNTRY_PRIVILEGES", "Présences:UPDATE"] });

    // Cartes émises par l'API réelle, puis états physiques posés en base.
    const issue = async (studentId, medium) => {
      const issued = await request("/student-cards", { method: "POST", token: tokenAdminA, body: { studentId, medium } });
      assert.equal(issued.status, 201, JSON.stringify(issued.data));
      return { id: issued.data.id, cardToken: issued.data.cardToken };
    };
    // Plusieurs cartes pour S1 : la base n'admet qu'une carte active par élève
    // (student_access_cards_one_active_per_student). L'ancienne est remplacée par l'API réelle.
    const s1Old = await issue(S.S1, "qr");
    const replacedS1 = await request(`/student-cards/${s1Old.id}/replace`, { method: "POST", token: tokenAdminA, body: {} });
    assert.equal(replacedS1.status, 200, JSON.stringify(replacedS1.data));
    const s1Fresh = replacedS1.data?.card ?? replacedS1.data?.replacement ?? replacedS1.data?.newCard ?? replacedS1.data;
    assert.ok(s1Fresh?.id && s1Fresh.id !== s1Old.id && s1Fresh.cardToken, `réponse de remplacement : ${Object.keys(replacedS1.data ?? {})}`);
    const cards = {
      S1nfc: { id: s1Fresh.id, cardToken: s1Fresh.cardToken }, // carte active : NFC encodée + QR
      S1old: s1Old, // remplacée : exclue
      S2: await issue(S.S2, "qr"),
      S3: await issue(S.S3, "nfc_qr"), // NFC en attente : exclue
      S4: await issue(S.S4, "qr"), // révoquée : exclue
      S5: await issue(S.S5, "nfc_qr"), // NFC seule encodée (support nfc) : selon flag NFC
      S6: await issue(S.S6, "qr"), // réservation non activée (issued) : exclue
      S7: await issue(S.S7, "qr"), // autre classe
    };
    await pool.query(
      `UPDATE student_access_cards SET medium = 'nfc_qr', nfc_uid = '04AABBCCDDEE11', nfc_tag_type = 'NTAG216',
              nfc_encoding_state = 'encoded', nfc_encoded_at = NOW() WHERE id = $1`, [cards.S1nfc.id],
    );
    await pool.query(
      // État réel d'une réservation NFC en attente : jamais active (student_access_cards_nfc_pending_nonactive_check).
      `UPDATE student_access_cards SET status = 'issued', nfc_uid = '04AABBCCDDEE33', nfc_tag_type = 'NTAG213', nfc_encoding_state = 'pending',
              nfc_operation_id = gen_random_uuid(), nfc_reservation_expires_at = NOW() + interval '10 minutes' WHERE id = $1`, [cards.S3.id],
    );
    await pool.query(
      `UPDATE student_access_cards SET medium = 'nfc', nfc_uid = '04AABBCCDDEE55', nfc_tag_type = 'NTAG213',
              nfc_encoding_state = 'locked', nfc_encoded_at = NOW(), nfc_locked_at = NOW() WHERE id = $1`, [cards.S5.id],
    );
    const revoked = await request(`/student-cards/${cards.S4.id}/revoke`, { method: "POST", token: tokenAdminA, body: { reason: "Test PR1b" } });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.data));
    await pool.query("UPDATE student_access_cards SET status = 'issued' WHERE id = $1", [cards.S6.id]);
    await pool.query(
      "INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status) VALUES ($1,$2,$3,$4::date,'excused')",
      [schoolA, S.S2, classA1, today],
    );
    const cardRows = new Map((await pool.query(
      "SELECT id::text AS id, public_id, token_hash, nfc_uid FROM student_access_cards WHERE school_id = $1", [schoolA],
    )).rows.map((row) => [row.id, row]));
    const leaks = (rendered) => {
      const secrets = [];
      for (const card of Object.values(cards)) {
        const row = cardRows.get(card.id);
        secrets.push(card.id, card.cardToken, card.cardToken.split(".")[1], row.public_id, row.token_hash, row.nfc_uid);
      }
      return secrets.filter((value) => value && rendered.includes(value));
    };
    const keyring1 = parseKeyring(JSON.stringify(ringV1));

    // ---------- Cas nominal : classe affectée, aujourd'hui ----------
    const nominal = await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal(nominal.status, 200, nominal.text);
    assert.equal(nominal.cacheControl, "no-store");
    assert.deepEqual(Object.keys(nominal.data).sort(), ["pack", "revocations", "signature"]);
    const p = nominal.data.pack;
    assert.equal(p.contractVersion, "rc-offline-1");
    assert.equal(p.packVersion, 1);
    assert.equal(p.keyId, "rc-pack-it-a");
    assert.equal(p.schoolId, schoolA);
    assert.equal(p.actorUserId, USER.TEACHER);
    assert.equal(p.mode, "teacher");
    assert.equal(p.classId, classA1);
    assert.equal(p.date, today);
    assert.equal(p.timeZone, zone);
    const window = computePackWindow(zone, today);
    assert.equal(p.notBefore, isoSeconds(window.notBefore));
    assert.equal(p.expiresAt, isoSeconds(window.expiresAt));
    assert.equal(p.syncDeadline, isoSeconds(window.syncDeadline));
    assert.ok(Math.abs(Date.parse(p.issuedAt) - Date.now()) < 120000);
    assert.deepEqual(nominal.data.signature, { ...nominal.data.signature, alg: "Ed25519", keyId: "rc-pack-it-a" });
    assert.equal(verifySignature({ message: packSigningMessage(p), signature: nominal.data.signature, keyring: keyring1 }), true, "signature du pack");
    assert.equal(verifySignature({ message: packSigningMessage({ ...p, classId: classA2 }), signature: nominal.data.signature, keyring: keyring1 }), false, "champ signé altéré");
    assert.deepEqual(nominal.data.revocations.list, { contractVersion: "rc-offline-1", sequence: 0, revokedKeyIds: [], issuedAt: p.issuedAt });
    assert.equal(verifySignature({ message: revocationsSigningMessage(nominal.data.revocations.list), signature: nominal.data.revocations.signature, keyring: keyring1 }), true);
    // Élèves : les six inscrits de A1, uniques, triés par matchKey ; statut existant du jour.
    assert.deepEqual(p.students.map((s) => s.studentId).sort(), [S.S1, S.S2, S.S3, S.S4, S.S5, S.S6].sort());
    assert.deepEqual(p.students.map((s) => s.matchKey), [...p.students.map((s) => s.matchKey)].sort());
    assert.equal(p.students.find((s) => s.studentId === S.S2).existingStatus, "excused");
    assert.equal(p.students.find((s) => s.studentId === S.S1).existingStatus, null);
    // matchKey dérivé du secret dédié, jamais de JWT_SECRET.
    for (const entry of p.students) {
      assert.equal(entry.matchKey, computeMatchKey(deriveMatchKeySecret(MATCH_SECRET), p.packId, entry.studentId));
      assert.notEqual(entry.matchKey, computeMatchKey(deriveMatchKeySecret(JWT_SECRET), p.packId, entry.studentId));
    }
    assert.equal(nominal.text.includes(MATCH_SECRET), false);
    // Cartes : S1 (deux cartes), S2, S5 ; exclues S3 (en attente), S4 (révoquée), S6 (non activée), S7 (autre classe).
    const expectCards = (packBody, keys) => {
      const expected = keys.map((key) => {
        const row = cardRows.get(cards[key].id);
        const scope = { schoolId: schoolA, classId: classA1, packId: packBody.packId, publicId: row.public_id };
        return { cardRef: computeCardRef(scope), verifier: computeVerifier(cardKeyFromTokenHash(row.token_hash), scope) };
      }).sort((a, b) => (a.cardRef < b.cardRef ? -1 : 1));
      assert.deepEqual(packBody.cards.map(({ cardRef, verifier }) => ({ cardRef, verifier })), expected, keys.join(","));
    };
    expectCards(p, ["S1nfc", "S2", "S5"]);
    const s1Key = p.students.find((s) => s.studentId === S.S1).matchKey;
    assert.equal(p.students.filter((s) => s.studentId === S.S1).length, 1, "S1 une seule fois");
    assert.equal(p.cards.filter((c) => c.matchKey === s1Key).length, 1, "S1 : seule la carte active, l'ancienne remplacée exclue");
    for (const card of p.cards) assert.deepEqual(Object.keys(card).sort(), ["cardRef", "matchKey", "verifier"]);
    assert.deepEqual(leaks(nominal.text), [], "aucun publicId, token_hash, secret, UID ni identifiant de carte");
    assert.deepEqual(leaks(server.output.value), [], "rien de sensible dans les journaux du serveur");
    assert.equal(/token_hash|tokenHash|publicId|public_id|nfc_uid|cardToken/.test(nominal.text), false);

    // ---------- Fenêtre : la veille et le jour même ; hors fenêtre refusé ----------
    const tomorrow = await pack(tokenTeacher, { classId: classA1, date: shift(today, 1) });
    assert.equal(tomorrow.status, 200, `veille (préchargement) : ${tomorrow.text}`);
    assert.equal(tomorrow.data.pack.date, shift(today, 1));
    assert.notEqual(tomorrow.data.pack.packId, p.packId);
    assert.equal(tomorrow.data.pack.students.some((s) => p.students.some((t) => t.matchKey === s.matchKey)), false, "matchKey non corrélable");
    for (const date of [shift(today, -1), shift(today, 2), shift(today, 30)]) {
      const out = await pack(tokenTeacher, { classId: classA1, date });
      assert.equal(out.status, 409, `${date} : ${out.text}`);
      assert.equal(out.data?.code, "ROLL_CALL_PACK_DATE_OUT_OF_RANGE");
    }
    for (const query of [{ classId: classA1, date: "2026-02-30" }, { classId: classA1.toUpperCase(), date: today }, { classId: "x", date: today }, { date: today }]) {
      assert.equal((await pack(tokenTeacher, query)).status, 400, JSON.stringify(query));
    }

    // ---------- Classe sans carte ----------
    const noCards = await pack(tokenTeacher, { classId: classA3, date: today });
    assert.equal(noCards.status, 200, noCards.text);
    assert.deepEqual([noCards.data.pack.students, noCards.data.pack.cards], [[], []]);

    // ---------- Autorisations ----------
    assert.equal((await pack(undefined, { classId: classA1, date: today })).status, 401);
    const parent = await pack(tokenParent, { classId: classA1, date: today });
    assert.equal(parent.status, 403, parent.text);
    assert.equal(parent.data?.code, "PERMISSION_DENIED", "parent");
    for (const [token, headers] of [[tokenSuper, { "X-Somafrik-School-Code": LOGIN_A }], [tokenPays, {}]]) {
      const denied = await pack(token, { classId: classA1, date: today }, headers);
      assert.equal(denied.status, 403, denied.text);
      assert.equal(denied.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    }
    const admin = await pack(tokenAdminA, { classId: classA1, date: today });
    assert.equal(admin.status, 403, admin.text);
    assert.equal(admin.data?.code, "ROLL_CALL_ROLE_FORBIDDEN", "direction : pas de pack enseignant");
    const free = await pack(tokenTeacherFree, { classId: classA1, date: today });
    assert.equal(free.status, 403, free.text);
    assert.equal(free.data?.code, "ROLL_CALL_CLASS_FORBIDDEN", "enseignant non affecté");
    assert.equal((await pack(tokenTeacher, { classId: classA2, date: today })).data?.code, "ROLL_CALL_CLASS_FORBIDDEN", "classe non affectée");
    const crossAB = await pack(tokenTeacher, { classId: classB1, date: today });
    assert.equal(crossAB.status, 403, crossAB.text);
    assert.equal(crossAB.data?.code, "ROLL_CALL_CLASS_FORBIDDEN", "classe d'un autre établissement");
    const crossBA = await pack(tokenTeacherB, { classId: classA1, date: today });
    assert.equal(crossBA.status, 403, crossBA.text);
    assert.equal(crossBA.data?.code, "ROLL_CALL_CLASS_FORBIDDEN", "enseignant d'un autre établissement");
    assert.deepEqual(leaks(crossBA.text), []);
    const suspended = await pack(tokenTeacherC, { classId: classC1, date: wallTime("Africa/Kinshasa", Date.now()).slice(0, 10) });
    assert.equal(suspended.status, 403, `abonnement suspendu : ${suspended.text}`);
    assert.match(String(suspended.data?.message), /suspendu/, "refus par le gate d'abonnement");
    assert.equal(suspended.data?.pack, undefined);

    // Rôle révoqué en base (le JWT porte toujours TEACHER).
    await pool.query("UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1 AND role_key = 'TEACHER'", [USER.TEACHER]);
    const roleRevoked = await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal(roleRevoked.status, 403, roleRevoked.text);
    assert.equal(roleRevoked.data?.code, "PERMISSION_DENIED", "rôle révoqué : permissions effectives relues en base");
    await pool.query("UPDATE user_roles SET status = 'active', revoked_at = NULL WHERE user_id = $1 AND role_key = 'TEACHER'", [USER.TEACHER]);
    assert.equal((await pack(tokenTeacher, { classId: classA1, date: today })).status, 200, "rôle rétabli");
    // Affectation retirée.
    await pool.query("UPDATE teacher_assignments SET status = 'inactive' WHERE id = $1", [assignmentA1]);
    assert.equal((await pack(tokenTeacher, { classId: classA1, date: today })).data?.code, "ROLL_CALL_CLASS_FORBIDDEN", "affectation retirée");
    await pool.query("UPDATE teacher_assignments SET status = 'active' WHERE id = $1", [assignmentA1]);
    // Permission effective absente (droits Présences retirés au rôle TEACHER).
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: false, read: true, update: false });
    const noPermission = await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal(noPermission.status, 403, `permission absente : ${noPermission.text}`);
    assert.equal(noPermission.data?.code, "PERMISSION_DENIED");
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: true, read: true, update: true });
    assert.equal((await pack(tokenTeacher, { classId: classA1, date: today })).status, 200, "permission rétablie");

    // ---------- Flags ----------
    const setFlags = (flags) => pool.query(
      `UPDATE school_settings SET student_card_enabled = $2, student_card_attendance_enabled = $3,
              student_card_nfc_enabled = $4, student_card_qr_enabled = $5,
              student_card_offline_roll_call_enabled = $6 WHERE school_id = $1`,
      [schoolA, flags.master, flags.attendance, flags.nfc, flags.qr, flags.offline ?? true],
    );
    const all = { master: true, attendance: true, nfc: true, qr: true, offline: true };
    // NFC-PRES-LOCAL-PR3 : flag de l'appel hors connexion coupé, tout le reste activé → aucun pack.
    await setFlags({ ...all, offline: false });
    const offlineOff = await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal(offlineOff.status, 404, "flag appel hors connexion coupé");
    assert.equal(offlineOff.data?.code, "ROLL_CALL_OFFLINE_DISABLED");
    assert.equal(JSON.stringify(offlineOff.data).includes("students"), false, "aucune donnée d'élève sans flag");
    await setFlags({ ...all, master: false });
    assert.equal((await pack(tokenTeacher, { classId: classA1, date: today })).status, 404, "flag maître coupé");
    await setFlags({ ...all, attendance: false });
    const attendanceOff = await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal(attendanceOff.data?.code, "STUDENT_CARD_ATTENDANCE_DISABLED", "flag présences coupé");
    await setFlags({ ...all, nfc: false });
    const nfcOff = await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal(nfcOff.status, 200, nfcOff.text);
    expectCards(nfcOff.data.pack, ["S1nfc", "S2"]); // S5 (NFC seule) exclue ; S1nfc reste via QR
    await setFlags({ ...all, qr: false });
    const qrOff = await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal(qrOff.status, 200, qrOff.text);
    expectCards(qrOff.data.pack, ["S1nfc", "S5"]); // cartes QR seules exclues
    await setFlags({ ...all, nfc: false, qr: false });
    const noMedia = await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal(noMedia.status, 404, noMedia.text);
    assert.equal(noMedia.data?.code, "ROLL_CALL_OFFLINE_MEDIA_DISABLED");
    await setFlags(all);

    // ---------- Fuseau invalide : refus, jamais de repli silencieux ----------
    await pool.query("UPDATE schools SET profile_payload = profile_payload || '{\"timezone\":\"Mars/Olympus\"}'::jsonb WHERE id = $1", [schoolA]);
    const badZone = await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal(badZone.status, 503, badZone.text);
    assert.equal(badZone.data?.code, "ROLL_CALL_OFFLINE_TIMEZONE_INVALID");
    await pool.query("UPDATE schools SET profile_payload = profile_payload || jsonb_build_object('timezone', $2::text) WHERE id = $1", [schoolA, zone]);

    // ---------- Aucune écriture ; routes existantes intactes ----------
    const attendanceRows = (await pool.query("SELECT count(*)::int AS n FROM attendance")).rows[0].n;
    const journalRows = (await pool.query("SELECT count(*)::int AS n FROM attendance_roll_calls")).rows[0].n;
    await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM attendance")).rows[0].n, attendanceRows);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM attendance_roll_calls")).rows[0].n, journalRows);
    const sessionId = crypto.randomUUID();
    const roster = await request(`/student-cards/roll-call/roster?${new URLSearchParams({ sessionId, classId: classA1, date: today })}`, { token: tokenTeacher });
    assert.equal(roster.status, 200, roster.text);
    const scan = await request("/student-cards/roll-call/scan", { method: "POST", token: tokenTeacher, body: { sessionId, classId: classA1, date: today, cardToken: cards.S1nfc.cardToken } });
    assert.equal(scan.status, 200, scan.text);

    // ---------- Démarrage 3 : rotation d'urgence (A révoquée, B active), deux instances en parallèle ----------
    // Pendant un redéploiement, l'ancienne instance (non redémarrée) signe encore avec A ; la nouvelle
    // instance signe avec B et publie la révocation de A. Aucune rotation à chaud n'a lieu dans le
    // processus de l'ancienne instance : seul le redémarrage la met à jour.
    const NEXT_PORT = HTTP_PORT + 1;
    serverNext = await startServer(isolatedUrl, {
      ROLL_CALL_PACK_SIGNING_KEY: keyB.privateB64, ROLL_CALL_PACK_KEYRING: JSON.stringify(ringV2), ROLL_CALL_PACK_MATCH_SECRET: MATCH_SECRET,
    }, NEXT_PORT);
    const keyring2 = parseKeyring(JSON.stringify(ringV2));
    const rotated = await request(`/student-cards/roll-call/offline/v1/pack?${new URLSearchParams({ classId: classA1, date: today })}`, { token: tokenTeacher, port: NEXT_PORT });
    const stale = await pack(tokenTeacher, { classId: classA1, date: today });
    assert.equal(stale.status, 200, stale.text);
    assert.equal(stale.data.pack.keyId, "rc-pack-it-a", "ancienne instance non redémarrée : toujours la clé A");
    assert.equal(stale.data.revocations.list.sequence, 0);
    assert.equal(verifySignature({ message: packSigningMessage(stale.data.pack), signature: stale.data.signature, keyring: keyring1 }), true);
    // Un téléphone qui a reçu la révocation (séquence 1) refuse ce pack de l'ancienne instance.
    assert.equal(verifySignature({ message: packSigningMessage(stale.data.pack), signature: stale.data.signature, keyring: keyring2 }), false, "pack de l'ancienne instance refusé après révocation");
    await stopServer(server);
    server = serverNext;
    serverNext = null;
    assert.equal(rotated.status, 200, rotated.text);
    assert.equal(rotated.data.pack.keyId, "rc-pack-it-b");
    assert.equal(rotated.data.signature.keyId, "rc-pack-it-b");
    assert.equal(verifySignature({ message: packSigningMessage(rotated.data.pack), signature: rotated.data.signature, keyring: keyring2 }), true);
    assert.deepEqual(rotated.data.revocations.list, { contractVersion: "rc-offline-1", sequence: 1, revokedKeyIds: ["rc-pack-it-a"], issuedAt: rotated.data.pack.issuedAt });
    assert.equal(verifySignature({ message: revocationsSigningMessage(rotated.data.revocations.list), signature: rotated.data.revocations.signature, keyring: keyring2 }), true);
    // Pack émis avant la rotation par la clé A, désormais révoquée : refusé.
    assert.equal(verifySignature({ message: packSigningMessage(p), signature: nominal.data.signature, keyring: keyring2 }), false, "clé révoquée");
    assert.deepEqual(leaks(server.output.value), []);
    for (const secret of [keyA.privateB64, keyB.privateB64]) {
      assert.equal(rotated.text.includes(secret), false);
      assert.equal(server.output.value.includes(secret), false);
    }

    console.log("rollCallOfflinePack.http.pg.test.js OK");
  } finally {
    await stopServer(server);
    await stopServer(serverNext);
    await pool.end().catch(() => {});
    await repo.close?.().catch?.(() => {});
  }
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
