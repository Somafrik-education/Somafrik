"use strict";

/**
 * NFC-PRES-LOCAL-PR1c — POST /api/student-cards/roll-call/offline/v1/sync, de bout en bout
 * (serveurs réels + PostgreSQL isolé).
 *
 * Deux instances simultanées (A et B) partagent la base : un rejeu « < 24 h » passe par A (cache
 * mémoire ou ligne `idempotency_keys`) ; un rejeu « > 24 h » passe par B après suppression des
 * lignes `idempotency_keys` (B n'a jamais vu l'opération : aucun cache mémoire) et n'est servi que
 * par le journal `attendance_roll_calls.ack_body`.
 *
 * Fenêtre déterministe : l'établissement reçoit un fuseau fixe `Etc/GMT±N` où il est l'après-midi.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { mintSessionAccessToken } = require("./testAccessSession");
const { deriveCardKeyFromSecret, computeProof, computePayloadDigest } = require("./rollCallOfflineProof");
const { wallTime } = require("./rollCallOfflinePack");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_roll_call_offline_sync_it";
const ROOT = path.resolve(__dirname, "../..");
const PORT_A = Number(process.env.SOMAFRIK_OFFLINE_SYNC_HTTP_PORT ?? 19896);
const PORT_B = PORT_A + 1;
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const LOGIN_C = "CD-SUS-26-002";
const CODE_A = "CD-2026-0001";
const CODE_B = "BI-2026-0001";
const CODE_C = "CD-2026-0003";
const U = (n) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, "0")}`;
const USER = { ADMIN_A: U(1), TEACHER: U(2), TEACHER_FREE: U(3), SUPER: U(5), ADMIN_B: U(7), TEACHER_B: U(8), TEACHER_C: U(10) };
const S = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`S${n}`, U(100 + n)]));
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

async function request(port, pathname, { method = "GET", token, body, headers = {}, signal } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, text };
}

async function startServer(isolatedUrl, port) {
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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = { value: "" };
  child.stdout.on("data", (chunk) => { output.value += String(chunk); });
  child.stderr.on("data", (chunk) => { output.value += String(chunk); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Backend exited early: ${child.exitCode}\n${output.value}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return { child, output, port };
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
     VALUES ($1, 'global', $2, $3, $4, $5, FALSE, 'nfc-pres-local-pr1c')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update],
  );
}

function afternoonZone(nowMs) {
  const utcHour = new Date(nowMs).getUTCHours();
  for (let offset = -12; offset <= 14; offset += 1) {
    const localHour = (utcHour + offset + 48) % 24;
    if (localHour >= 14 && localHour <= 20) return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
  }
  throw new Error("aucun fuseau fixe trouvé");
}

const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const byKey = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Champs de l'ACK, sans l'indicateur de rejeu ajouté par withIdempotency. */
const ackFields = (body) => Object.fromEntries(Object.entries(body ?? {}).filter(([key]) => key !== "idempotentReplay").sort(([a], [b]) => (a < b ? -1 : 1)));

async function main() {
  if (!DATABASE_URL) {
    console.log("rollCallOfflineSync.http.pg.test.js SKIP (DATABASE_URL absent)");
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
  let serverA = null;
  let serverB = null;
  try {
    await repo.init();
    // ---------- Schéma : migration additive appliquée, lignes historiques intactes ----------
    const columns = (await pool.query(
      `SELECT column_name, is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'attendance_roll_calls' AND column_name IN ('source','operation_id','payload_digest','ack_body') ORDER BY column_name`,
    )).rows;
    assert.deepEqual(columns.map((c) => c.column_name), ["ack_body", "operation_id", "payload_digest", "source"]);
    assert.equal(columns.find((c) => c.column_name === "source").is_nullable, "NO");
    const constraints = (await pool.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'attendance_roll_calls'::regclass ORDER BY conname`,
    )).rows.map((r) => r.conname);
    for (const name of ["attendance_roll_calls_session_unique", "attendance_roll_calls_source_check", "attendance_roll_calls_offline_shape_check"]) {
      assert.ok(constraints.includes(name), name);
    }
    await repo.init(); // ré-application : idempotente

    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    await setLoginCodeTriggers(pool, false);
    const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
    const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
    const school = async (country, code, login, short, name) => (await pool.query(
      "INSERT INTO schools (country_id, school_code, login_code, short_code, name, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id",
      [country, code, login, short, name],
    )).rows[0].id;
    const schoolA = await school(cd.id, CODE_A, LOGIN_A, "LAC", "Lycée Lac");
    const schoolB = await school(bi.id, CODE_B, LOGIN_B, "BUJ", "Lycée Buj");
    const schoolC = await school(cd.id, CODE_C, LOGIN_C, "SUS", "Lycée Suspendu");
    await setLoginCodeTriggers(pool, true);
    await pool.query("ALTER TABLE users DISABLE TRIGGER users_permanent_identity_insert");
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password) VALUES
         ($1,$8,'SY-ADM-A','Aline','A','aline@sy.test','Admin School','active', FALSE),
         ($2,$8,'SY-ENS-A','Chidi','T','chidi@sy.test','Enseignant','active', FALSE),
         ($3,$8,'SY-ENS-F','Fatou','F','fatou@sy.test','Enseignant','active', FALSE),
         ($4,NULL,'SY-SUPER','Super','Admin','super@sy.test','Super Administrateur Somafrik','active', FALSE),
         ($5,$9,'SY-ADM-B','Binta','B','binta@sy.test','Admin School','active', FALSE),
         ($6,$9,'SY-ENS-B','Bruno','B','bruno@sy.test','Enseignant','active', FALSE),
         ($7,$10,'SY-ENS-C','Cyril','C','cyril@sy.test','Enseignant','active', FALSE)`,
      [USER.ADMIN_A, USER.TEACHER, USER.TEACHER_FREE, USER.SUPER, USER.ADMIN_B, USER.TEACHER_B, USER.TEACHER_C, schoolA, schoolB, schoolC],
    );
    await pool.query("ALTER TABLE users ENABLE TRIGGER users_permanent_identity_insert");
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES
         ($1,$8,'SCHOOL_ADMIN','active'), ($2,$8,'TEACHER','active'), ($3,$8,'TEACHER','active'), ($4,NULL,'SUPER_ADMIN','active'),
         ($5,$9,'SCHOOL_ADMIN','active'), ($6,$9,'TEACHER','active'), ($7,$10,'TEACHER','active')`,
      [USER.ADMIN_A, USER.TEACHER, USER.TEACHER_FREE, USER.SUPER, USER.ADMIN_B, USER.TEACHER_B, USER.TEACHER_C, schoolA, schoolB, schoolC],
    );
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: true, read: true, update: true });
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status) VALUES
         ($1,$11,'SY-S1','Amina','Kabila','active'), ($2,$11,'SY-S2','Bao','Lutete','active'), ($3,$11,'SY-S3','Cyn','Mbuyi','active'),
         ($4,$11,'SY-S4','Dan','Ngoy','active'), ($5,$11,'SY-S5','Eli','Ombe','active'), ($6,$11,'SY-S6','Fay','Pindi','active'),
         ($7,$11,'SY-S7','Gus','Rafiki','active'), ($8,$11,'SY-S8','Hana','Sefu','active'),
         ($9,$12,'SY-SB','Ines','Tshala','active'), ($10,$13,'SY-SC','Jo','Umba','active')`,
      [S.S1, S.S2, S.S3, S.S4, S.S5, S.S6, S.S7, S.S8, STUDENT_B, STUDENT_C, schoolA, schoolB, schoolC],
    );
    const year = async (schoolId) => (await pool.query(
      "INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027', TRUE, 'open') RETURNING id", [schoolId],
    )).rows[0].id;
    const yearA = await year(schoolA);
    const yearB = await year(schoolB);
    const yearC = await year(schoolC);
    const klass = async (schoolId, yearId, code) => (await pool.query(
      "INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,$3,$4,'active') RETURNING id", [schoolId, yearId, code, `Classe ${code}`],
    )).rows[0].id;
    const classA1 = await klass(schoolA, yearA, "SY-A1");
    const classA2 = await klass(schoolA, yearA, "SY-A2");
    const classB1 = await klass(schoolB, yearB, "SY-B1");
    const classC1 = await klass(schoolC, yearC, "SY-C1");
    const enroll = (schoolId, studentId, classId, yearId) => pool.query(
      "INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1,$2,$3,$4,'ENROLLED')", [schoolId, studentId, classId, yearId],
    );
    for (const id of [S.S1, S.S2, S.S3, S.S4, S.S5, S.S6]) await enroll(schoolA, id, classA1, yearA);
    for (const id of [S.S7, S.S8]) await enroll(schoolA, id, classA2, yearA);
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
    const teacherA = await teacherRow(schoolA, USER.TEACHER, "SY-TCH-A");
    const teacherFree = await teacherRow(schoolA, USER.TEACHER_FREE, "SY-TCH-F");
    const teacherB = await teacherRow(schoolB, USER.TEACHER_B, "SY-TCH-B");
    const teacherC = await teacherRow(schoolC, USER.TEACHER_C, "SY-TCH-C");
    const assign = async (schoolId, teacherId, classId, subjectId, yearId) => (await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`, [schoolId, teacherId, classId, subjectId, yearId],
    )).rows[0].id;
    const assignmentA1 = await assign(schoolA, teacherA, classA1, subjectA, yearA);
    await assign(schoolA, teacherA, classA2, subjectA, yearA);
    await assign(schoolB, teacherB, classB1, subjectB, yearB);
    await assign(schoolC, teacherC, classC1, subjectC, yearC);
    void teacherFree;
    await pool.query(
      `INSERT INTO school_settings (school_id, student_card_enabled, student_card_qr_enabled, student_card_nfc_enabled, student_card_attendance_enabled,
                                    student_card_offline_roll_call_enabled)
       VALUES ($1, TRUE, TRUE, TRUE, TRUE, TRUE), ($2, TRUE, TRUE, TRUE, TRUE, TRUE), ($3, TRUE, TRUE, TRUE, TRUE, TRUE)
       ON CONFLICT (school_id) DO UPDATE SET student_card_enabled = TRUE, student_card_qr_enabled = TRUE,
         student_card_nfc_enabled = TRUE, student_card_attendance_enabled = TRUE, student_card_offline_roll_call_enabled = TRUE`,
      [schoolA, schoolB, schoolC],
    );
    await pool.query("UPDATE school_settings SET student_card_holder_kind = 'eleve' WHERE school_id = ANY($1::uuid[])", [[schoolA, schoolB, schoolC]]);
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, billing_currency, status, start_date, end_date)
       VALUES ($1, 'Standard', 'CDF', 'suspended', CURRENT_DATE - 30, CURRENT_DATE + 300)`, [schoolC],
    );
    // Abonnement actif pour A : la garde W le relit en direct, sous verrou partagé.
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, billing_currency, status, start_date, end_date)
       VALUES ($1, 'Standard', 'CDF', 'active', CURRENT_DATE - 30, CURRENT_DATE + 300)`, [schoolA],
    );
    const zone = afternoonZone(Date.now());
    for (const id of [schoolA, schoolB]) {
      await pool.query("UPDATE schools SET profile_payload = COALESCE(profile_payload, '{}'::jsonb) || jsonb_build_object('timezone', $2::text) WHERE id = $1", [id, zone]);
    }
    const today = wallTime(zone, Date.now()).slice(0, 10);
    const todayC = wallTime("Africa/Kinshasa", Date.now()).slice(0, 10);

    serverA = await startServer(isolatedUrl, PORT_A);
    serverB = await startServer(isolatedUrl, PORT_B);

    let tokenTeacher = await mint({ sub: USER.TEACHER, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: CODE_A, permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenTeacherFree = await mint({ sub: USER.TEACHER_FREE, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: CODE_A, permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenTeacherB = await mint({ sub: USER.TEACHER_B, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: CODE_B, permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenTeacherC = await mint({ sub: USER.TEACHER_C, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: CODE_C, permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    const tokenAdminA = await mint({ sub: USER.ADMIN_A, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: CODE_A,
      permissions: ["Élèves:UPDATE", "Gérer élèves", "Présences:CREATE", "Présences:UPDATE", "Présences:READ"] });
    const tokenAdminB = await mint({ sub: USER.ADMIN_B, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: CODE_B,
      permissions: ["Élèves:UPDATE", "Gérer élèves", "Présences:CREATE", "Présences:UPDATE"] });
    const tokenSuper = await mint({ sub: USER.SUPER, role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], schoolCode: LOGIN_A,
      permissions: ["ALL_PRIVILEGES", "Présences:CREATE"] });

    // ---------- Cartes émises par l'API réelle ----------
    const issue = async (studentId, medium, token = tokenAdminA) => {
      const issued = await request(PORT_A, "/student-cards", { method: "POST", token, body: { studentId, medium } });
      assert.equal(issued.status, 201, JSON.stringify(issued.data));
      const [publicId, secret] = issued.data.cardToken.split(".");
      return { id: issued.data.id, cardToken: issued.data.cardToken, publicId, key: deriveCardKeyFromSecret(secret) };
    };
    const card = {
      S1: await issue(S.S1, "nfc_qr"),
      S2: await issue(S.S2, "qr"),
      S3: await issue(S.S3, "qr"),
      S4: await issue(S.S4, "qr"),
      S5: await issue(S.S5, "nfc_qr"),
      S6: await issue(S.S6, "qr"),
      S7: await issue(S.S7, "qr"),
      S8: await issue(S.S8, "qr"),
      B: await issue(STUDENT_B, "qr", tokenAdminB),
    };
    for (const key of ["S1", "S5"]) {
      await pool.query(
        `UPDATE student_access_cards SET nfc_uid = $2, nfc_tag_type = 'NTAG216', nfc_encoding_state = 'encoded', nfc_encoded_at = NOW() WHERE id = $1`,
        [card[key].id, key === "S1" ? "04AABBCCDDEE11" : "04AABBCCDDEE55"],
      );
    }
    const secrets = async () => {
      const rows = (await pool.query("SELECT token_hash FROM student_access_cards")).rows.map((r) => r.token_hash);
      return [...rows, ...Object.values(card).flatMap((c) => [c.cardToken, c.cardToken.split(".")[1]])];
    };

    // ---------- Construction d'un lot conforme (preuves HMAC réelles) ----------
    const scanOf = (c, medium = "qr", scanId = crypto.randomUUID()) => ({ card: c, medium, scanId });
    function makeBody({ classId = classA1, date = today, sessionId = crypto.randomUUID(), operationId = crypto.randomUUID(), revision = 1,
      packId = null, scans = [], manual = [], actor = USER.TEACHER, schoolId = schoolA, proofMedium } = {}) {
      const bodyScans = scans.map((s) => ({
        scanId: s.scanId,
        publicId: s.card.publicId,
        proof: computeProof(s.card.key, {
          contractVersion: "rc-offline-1", schoolId, actorUserId: actor, classId, date, mode: "teacher", sessionId,
          packId: packId ?? "", scanId: s.scanId, publicId: s.card.publicId, medium: proofMedium?.(s) ?? s.medium,
        }),
        medium: s.medium,
        scannedAt: new Date().toISOString(),
      })).sort(byKey("scanId"));
      const body = {
        contractVersion: "rc-offline-1", operationId, sessionId, revision, schoolId, classId, date, mode: "teacher", packId,
        complete: true, scans: bodyScans, manual: [...manual].sort(byKey("studentId")),
      };
      return { ...body, payloadDigest: computePayloadDigest(body) };
    }
    const sync = (token, body, { port = PORT_A, key = body.operationId, signal } = {}) =>
      request(port, "/student-cards/roll-call/offline/v1/sync", { method: "POST", token, body, headers: key === null ? {} : { "Idempotency-Key": key }, signal });
    const attendance = async (date, classId = classA1) => Object.fromEntries((await pool.query(
      `SELECT student_id::text AS s, status FROM attendance WHERE attendance_date = $1::date AND class_id = $2::uuid`, [date, classId],
    )).rows.map((r) => [r.s, r.status]));
    const counts = async () => (await pool.query(
      `SELECT (SELECT count(*)::int FROM attendance) AS attendance, (SELECT count(*)::int FROM attendance_roll_calls) AS journal,
              (SELECT count(*)::int FROM audit_logs WHERE action = 'student_card_roll_call_offline_sync') AS audits`,
    )).rows[0];
    const notRecorded = (out, status, code, label) => {
      assert.equal(out.status, status, `${label} : ${out.text}`);
      assert.equal(out.data?.code, code, label);
      assert.equal(out.data?.sessionState, "not_recorded", `${label} : attestation not_recorded`);
      assert.equal(out.data?.rollCallId, undefined, label);
    };
    const all = (statusList) => ({ ...statusList });
    void all;
    const rosterManual = (entries) => entries.map(([studentId, status]) => ({ studentId, status }));

    // ================= A. Scénarios nominaux =================
    // Élève non scanné ni pointé : jamais d'absence créée en silence → ROSTER_CHANGED, rien d'écrit.
    const before0 = await counts();
    const missing = makeBody({ scans: [scanOf(card.S1, "nfc")], manual: rosterManual([[S.S2, "absent"], [S.S3, "absent"], [S.S4, "absent"], [S.S5, "absent"]]) });
    // Contrat des absences : tout inscrit non scanné et SANS statut antérieur ce jour-là doit être transmis
    // explicitement en `absent` ; sinon refus attesté, aucune absence créée par le serveur.
    const missingOut = await sync(tokenTeacher, missing);
    notRecorded(missingOut, 409, "ROLL_CALL_ROSTER_CHANGED", "élève S6 absent du lot");
    assert.deepEqual(missingOut.data.details, { missing: 1, unexpected: 0, enrolled: 6 });
    assert.deepEqual(await counts(), before0);

    // S6 déjà justifié ce jour-là (excused) : jamais écrasé.
    await pool.query("INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status) VALUES ($1,$2,$3,$4::date,'excused')", [schoolA, S.S6, classA1, today]);
    const s1a = scanOf(card.S1, "nfc");
    const s1b = scanOf(card.S1, "nfc"); // même carte scannée deux fois
    const s2 = scanOf(card.S2, "qr");
    const s5 = scanOf(card.S5, "nfc");
    const nominal = makeBody({
      packId: crypto.randomUUID(),
      scans: [s1a, s1b, s2, s5],
      manual: rosterManual([[S.S3, "late"], [S.S4, "absent"], [S.S5, "late"], [S.S6, "present"]]),
    });
    const before1 = await counts();
    const first = await sync(tokenTeacher, nominal);
    assert.equal(first.status, 201, first.text);
    const ack = first.data;
    const sortedManual = nominal.manual;
    assert.deepEqual(Object.keys(ack).sort(), ["corrected", "counts", "created", "invalidScanIds", "operationId", "payloadDigest", "protected",
      "protectedManualIndexes", "protectedScanIds", "revision", "rollCallId", "sessionId", "unchanged", "validatedAt"].sort());
    assert.equal(ack.sessionId, nominal.sessionId);
    assert.equal(ack.operationId, nominal.operationId);
    assert.equal(ack.revision, 1);
    assert.equal(ack.payloadDigest, nominal.payloadDigest);
    assert.deepEqual([ack.created, ack.corrected, ack.unchanged, ack.protected], [5, 0, 0, 1]);
    assert.deepEqual(ack.protectedManualIndexes, [sortedManual.findIndex((m) => m.studentId === S.S6)]);
    assert.deepEqual(ack.protectedScanIds, []);
    assert.deepEqual(ack.invalidScanIds, []);
    assert.deepEqual(ack.counts, { present: 2, late: 2, absent: 1, excused: 1, enrolled: 6 });
    assert.deepEqual(await attendance(today), { [S.S1]: "present", [S.S2]: "present", [S.S3]: "late", [S.S4]: "absent", [S.S5]: "late", [S.S6]: "excused" });
    const after1 = await counts();
    assert.deepEqual([after1.attendance - before1.attendance, after1.journal - before1.journal, after1.audits - before1.audits], [5, 1, 1]);
    const journal = (await pool.query("SELECT * FROM attendance_roll_calls WHERE session_id = $1", [nominal.sessionId])).rows[0];
    assert.equal(journal.id, ack.rollCallId);
    assert.equal(journal.source, "offline");
    assert.equal(journal.operation_id, nominal.operationId);
    assert.equal(journal.payload_digest, nominal.payloadDigest);
    assert.equal(journal.author_user_id, USER.TEACHER);
    assert.equal(journal.teacher_id, teacherA);
    assert.deepEqual(ackFields(journal.ack_body), ackFields(ack), "ACK figé dans le journal");
    // Aucune identité d'élève ni secret dans l'ACK.
    for (const value of [...Object.values(S), "Amina", "SY-S1", ...(await secrets())]) assert.equal(first.text.includes(value), false, `fuite ${value}`);

    // ================= C. Idempotence (R-1 à R-10), < 24 h (A) et > 24 h (B, sans cache) =================
    const dropIdempotency = () => pool.query("DELETE FROM idempotency_keys");
    const replayBoth = async (token, body, check, label) => {
      const fast = await sync(token, body, { port: PORT_A });
      await check(fast, `${label} < 24 h`);
      await dropIdempotency();
      const slow = await sync(token, body, { port: PORT_B });
      await check(slow, `${label} > 24 h`);
    };
    const sameAck = (expected) => (out, label) => {
      assert.equal(out.status, 200, `${label} : ${out.text}`);
      assert.equal(out.data.idempotentReplay, true, label);
      assert.deepEqual(ackFields(out.data), ackFields(expected), label);
    };
    const refused = (out, label) => {
      assert.equal(out.status, 403, `${label} : ${out.text}`);
      assert.ok(["ROLL_CALL_REPLAY_FORBIDDEN", "PERMISSION_DENIED"].includes(out.data?.code), `${label} : ${out.data?.code}`);
      assert.equal(out.data?.sessionState, undefined, `${label} : jamais not_recorded`);
      assert.equal(out.data?.rollCallId, undefined, label);
      assert.equal(out.data?.counts, undefined, label);
    };
    // Élèves ayant déjà un statut ce jour-là : non renvoyés, conservés tels quels (couverts), rien écrit.
    const alreadyRecorded = await sync(tokenTeacher, makeBody({ scans: [], manual: [] }));
    assert.equal(alreadyRecorded.status, 201, `élèves déjà pointés non renvoyés : ${alreadyRecorded.text}`);
    assert.deepEqual([alreadyRecorded.data.created, alreadyRecorded.data.corrected, alreadyRecorded.data.unchanged, alreadyRecorded.data.protected], [0, 0, 0, 0]);
    assert.deepEqual(await attendance(today), { [S.S1]: "present", [S.S2]: "present", [S.S3]: "late", [S.S4]: "absent", [S.S5]: "late", [S.S6]: "excused" });
    const frozen = await counts();
    // R-1 : rejeu normal.
    await replayBoth(tokenTeacher, nominal, sameAck(ack), "R-1");
    // R-2 : désaffectation après succès.
    await pool.query("UPDATE teacher_assignments SET status = 'inactive' WHERE id = $1", [assignmentA1]);
    await replayBoth(tokenTeacher, nominal, sameAck(ack), "R-2 désaffecté");
    await pool.query("UPDATE teacher_assignments SET status = 'active' WHERE id = $1", [assignmentA1]);
    // R-3 : flags coupés après succès.
    await pool.query("UPDATE school_settings SET student_card_attendance_enabled = FALSE, student_card_nfc_enabled = FALSE, student_card_offline_roll_call_enabled = FALSE WHERE school_id = $1", [schoolA]);
    await replayBoth(tokenTeacher, nominal, sameAck(ack), "R-3 flags coupés (dont appel hors connexion)");
    await pool.query("UPDATE school_settings SET student_card_attendance_enabled = TRUE, student_card_nfc_enabled = TRUE, student_card_offline_roll_call_enabled = TRUE WHERE school_id = $1", [schoolA]);
    // R-4 : rôle TEACHER révoqué après succès → refus, sans ACK.
    await pool.query("UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1 AND role_key = 'TEACHER'", [USER.TEACHER]);
    await replayBoth(tokenTeacher, nominal, refused, "R-4 rôle révoqué");
    // R-6 : rôle rétabli → même ACK.
    await pool.query("UPDATE user_roles SET status = 'active', revoked_at = NULL WHERE user_id = $1 AND role_key = 'TEACHER'", [USER.TEACHER]);
    await replayBoth(tokenTeacher, nominal, sameAck(ack), "R-6 rôle rétabli");
    // R-5 : enseignant transféré (users.school_id → B), rôle A encore actif : garde R (schoolId du lot ≠ établissement relu).
    await pool.query("UPDATE users SET school_id = $2 WHERE id = $1", [USER.TEACHER, schoolB]);
    // La plateforme révoque la session dès le changement de rattachement (401 SESSION_SCHOOL_ATTACHMENT_MISSING),
    // avant même la garde R : refus non confirmable, sans attestation ni ACK.
    const transferred = (out, label) => {
      assert.ok([401, 403].includes(out.status), `${label} : ${out.text}`);
      assert.equal(out.data?.sessionState, undefined, label);
      assert.equal(out.data?.rollCallId, undefined, label);
    };
    await replayBoth(tokenTeacher, nominal, transferred, "R-5 transféré");
    await pool.query("UPDATE users SET school_id = $2 WHERE id = $1", [USER.TEACHER, schoolA]);
    // Session révoquée par le transfert : nouvelle connexion de l'enseignant revenu dans A.
    tokenTeacher = await mint({ sub: USER.TEACHER, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: CODE_A, permissions: ["Présences:CREATE", "Présences:UPDATE"] });
    await replayBoth(tokenTeacher, nominal, sameAck(ack), "R-5 retour");
    // R-7 : autre enseignant du même établissement, même opération → conflit, sans ACK.
    const conflict = (out, label) => {
      assert.equal(out.status, 409, `${label} : ${out.text}`);
      assert.equal(out.data?.code, "ROLL_CALL_SESSION_CONFLICT", label);
      assert.equal(out.data?.sessionState, "conflict", label);
      assert.equal(out.data?.rollCallId, undefined, label);
    };
    await replayBoth(tokenTeacherFree, nominal, conflict, "R-7 autre enseignant");
    // R-8 / R-9 : principal d'un autre établissement : refus R, identique qu'une session existe ou non.
    const foreignExisting = await sync(tokenTeacherB, nominal);
    const neverSeen = makeBody({ scans: [], manual: [] });
    const foreignMissing = await sync(tokenTeacherB, neverSeen);
    for (const [out, label] of [[foreignExisting, "R-8 existante"], [foreignMissing, "R-9 inexistante"]]) {
      assert.equal(out.status, 403, `${label} : ${out.text}`);
      assert.equal(out.data?.code, "ROLL_CALL_REPLAY_FORBIDDEN", label);
    }
    assert.deepEqual(foreignExisting.data, foreignMissing.data, "R-9 : réponses identiques");
    assert.deepEqual(await counts(), frozen, "aucun rejeu n'a écrit");
    // Même session, autre contenu (nouvelle révision sans attestation) → conflit.
    const otherRevision = makeBody({ sessionId: nominal.sessionId, revision: 2, scans: [], manual: [] });
    conflict(await sync(tokenTeacher, otherRevision), "même session, autre opération");
    // Même operationId, corps modifié → digest recalculé différent : 409 IDEMPOTENCY_KEY_REUSED (< 24 h) ou conflit de session.
    const tampered = makeBody({ sessionId: nominal.sessionId, operationId: nominal.operationId, scans: [s2], manual: [] });
    const tamperedOut = await sync(tokenTeacher, tampered);
    assert.equal(tamperedOut.status, 409, tamperedOut.text);
    assert.equal(tamperedOut.data?.rollCallId, undefined);
    assert.deepEqual(await counts(), frozen);

    // R-10 : cinq envois concurrents identiques → une écriture, aucun 409.
    const date1 = shift(today, -1);
    const concurrent = makeBody({ date: date1, scans: [scanOf(card.S1, "qr"), scanOf(card.S2, "qr")],
      manual: rosterManual([[S.S3, "present"], [S.S4, "late"], [S.S5, "absent"], [S.S6, "absent"]]) });
    const before10 = await counts();
    const parallel = await Promise.all(Array.from({ length: 5 }, (_, i) => sync(tokenTeacher, concurrent, { port: i % 2 ? PORT_B : PORT_A })));
    assert.deepEqual(parallel.map((o) => o.status).sort(), [200, 200, 200, 200, 201], parallel.map((o) => o.text).join("\n"));
    const reference = parallel.find((o) => o.status === 201).data;
    for (const out of parallel) assert.deepEqual(ackFields(out.data), ackFields(reference));
    const after10 = await counts();
    assert.deepEqual([after10.journal - before10.journal, after10.attendance - before10.attendance, after10.audits - before10.audits], [1, 6, 1]);

    // ================= B. Sécurité (garde W) : refus attestés, rien d'écrit =================
    const date2 = shift(today, -2);
    const roster2 = (overrides = {}) => rosterManual(Object.entries({ [S.S2]: "present", [S.S3]: "present", [S.S4]: "present", [S.S5]: "present", [S.S6]: "present", ...overrides }));
    const guarded = async (label, token, body, status, code) => {
      const snapshot = await counts();
      notRecorded(await sync(token, body), status, code, label);
      assert.deepEqual(await counts(), snapshot, `${label} : aucune écriture`);
    };
    await guarded("carte d'un autre établissement", tokenTeacher, makeBody({ date: date2, scans: [scanOf(card.B)], manual: roster2() }), 400, "ROLL_CALL_PROOF_INVALID");
    await guarded("enseignant non affecté", tokenTeacherFree, makeBody({ date: date2, actor: USER.TEACHER_FREE, scans: [scanOf(card.S1)], manual: roster2() }), 403, "ROLL_CALL_CLASS_FORBIDDEN");
    const forged = makeBody({ date: date2, scans: [scanOf(card.S1, "nfc")], manual: roster2() });
    forged.scans[0].proof = `${forged.scans[0].proof.slice(0, -2)}AA`;
    const reforged = { ...forged, payloadDigest: computePayloadDigest((({ payloadDigest, ...rest }) => rest)(forged)) };
    const forgedOut = await sync(tokenTeacher, reforged);
    notRecorded(forgedOut, 400, "ROLL_CALL_PROOF_INVALID", "preuve falsifiée");
    assert.deepEqual(forgedOut.data.details, { invalidScanIds: [reforged.scans[0].scanId] });
    // Support modifié : preuve calculée pour nfc, lot déclaré qr (digest recalculé par l'attaquant).
    await guarded("support modifié", tokenTeacher, makeBody({ date: date2, scans: [scanOf(card.S1, "qr")], proofMedium: () => "nfc", manual: roster2() }), 400, "ROLL_CALL_PROOF_INVALID");
    // Preuve d'un autre acteur (enseignant B) rejouée par A.
    await guarded("preuve d'un autre acteur", tokenTeacher, makeBody({ date: date2, actor: USER.TEACHER_B, scans: [scanOf(card.S1)], manual: roster2() }), 400, "ROLL_CALL_PROOF_INVALID");
    // Carte QR seule déclarée NFC : preuve valide, support incohérent.
    await guarded("carte QR déclarée NFC", tokenTeacher, makeBody({ date: date2, scans: [scanOf(card.S2, "nfc")], manual: roster2({ [S.S2]: undefined }) .filter((m) => m.status) }), 409, "ROLL_CALL_CARD_INVALID");
    // Digest falsifié : refusé avant toute écriture, sans attestation (rien n'a été lu).
    const badDigest = { ...makeBody({ date: date2, scans: [], manual: roster2({ [S.S1]: "present" }) }), payloadDigest: "0".repeat(64) };
    const badDigestOut = await sync(tokenTeacher, badDigest);
    assert.equal(badDigestOut.status, 400, badDigestOut.text);
    assert.equal(badDigestOut.data?.code, "ROLL_CALL_DIGEST_MISMATCH");
    assert.equal(badDigestOut.data?.sessionState, undefined);
    assert.equal((await sync(tokenTeacher, { ...badDigest, payloadDigest: computePayloadDigest((({ payloadDigest, ...r }) => r)(badDigest)) }, { key: crypto.randomUUID() })).data?.code, "ROLL_CALL_OPERATION_KEY_REQUIRED");
    // Superadmin.
    const superOut = await sync(tokenSuper, makeBody({ date: date2, scans: [], manual: [] }));
    assert.equal(superOut.status, 403, superOut.text);
    assert.equal(superOut.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    // Flags.
    const setFlags = (flags) => pool.query(
      `UPDATE school_settings SET student_card_enabled = $2, student_card_attendance_enabled = $3, student_card_nfc_enabled = $4,
              student_card_qr_enabled = $5, student_card_offline_roll_call_enabled = $6 WHERE school_id = $1`,
      [schoolA, flags.master, flags.attendance, flags.nfc, flags.qr, flags.offline ?? true],
    );
    const on = { master: true, attendance: true, nfc: true, qr: true, offline: true };
    // NFC-PRES-LOCAL-PR3 : flag de l'appel hors connexion coupé → garde W, 404 + not_recorded, rien d'écrit.
    await setFlags({ ...on, offline: false });
    await guarded("flag appel hors connexion coupé", tokenTeacher, makeBody({ date: date2, scans: [], manual: roster2({ [S.S1]: "present" }) }), 404, "ROLL_CALL_OFFLINE_DISABLED");
    await setFlags({ ...on, master: false });
    await guarded("flag maître coupé", tokenTeacher, makeBody({ date: date2, scans: [], manual: roster2({ [S.S1]: "present" }) }), 404, "STUDENT_CARD_DISABLED");
    await setFlags({ ...on, attendance: false });
    await guarded("présences coupées", tokenTeacher, makeBody({ date: date2, scans: [], manual: roster2({ [S.S1]: "present" }) }), 404, "STUDENT_CARD_ATTENDANCE_DISABLED");
    await setFlags({ ...on, nfc: false });
    await guarded("NFC coupé, scan NFC", tokenTeacher, makeBody({ date: date2, scans: [scanOf(card.S1, "nfc")], manual: roster2() }), 404, "ROLL_CALL_OFFLINE_MEDIA_DISABLED");
    const qrStill = await sync(tokenTeacher, makeBody({ date: date2, scans: [scanOf(card.S1, "qr")], manual: roster2() }));
    assert.equal(qrStill.status, 201, `NFC coupé, QR actif : ${qrStill.text}`);
    await setFlags({ ...on, qr: false });
    const date3 = shift(today, -3); // fin de J+3 : encore synchronisable
    await guarded("QR coupé, scan QR", tokenTeacher, makeBody({ date: date3, scans: [scanOf(card.S2, "qr")], manual: roster2({ [S.S1]: "present", [S.S2]: undefined }).filter((m) => m.status) }), 404, "ROLL_CALL_OFFLINE_MEDIA_DISABLED");
    const nfcStill = await sync(tokenTeacher, makeBody({ date: date3, scans: [scanOf(card.S1, "nfc")], manual: roster2() }));
    assert.equal(nfcStill.status, 201, `QR coupé, NFC actif, J-3 : ${nfcStill.text}`);
    await setFlags(on);
    // Abonnement suspendu (établissement C) : gate W.
    // La plateforme refuse déjà toute session d'un établissement suspendu (avant la garde R) ; le gate
    // write_presence de la garde W reste en défense en profondeur. Refus sans ACK et sans écriture.
    const beforeSuspended = await counts();
    const suspended = await sync(tokenTeacherC, makeBody({ schoolId: schoolC, classId: classC1, date: todayC, actor: USER.TEACHER_C, scans: [], manual: rosterManual([[STUDENT_C, "present"]]) }));
    assert.equal(suspended.status, 403, `abonnement suspendu : ${suspended.text}`);
    assert.match(String(suspended.data?.message), /suspendu/);
    assert.equal(suspended.data?.rollCallId, undefined);
    assert.deepEqual(await counts(), beforeSuspended);
    // Fenêtre : J-4 et J+1 refusés.
    await guarded("J-4 expiré", tokenTeacher, makeBody({ date: shift(today, -4), scans: [], manual: roster2({ [S.S1]: "present" }) }), 409, "ROLL_CALL_OFFLINE_EXPIRED");
    await guarded("J+1 pas encore", tokenTeacher, makeBody({ date: shift(today, 1), scans: [], manual: roster2({ [S.S1]: "present" }) }), 409, "ROLL_CALL_OFFLINE_EXPIRED");
    // Cartes : révoquée après émission du pack, remplacée, titulaire désinscrit (classe A2).
    const a2Manual = (status = "present") => rosterManual([[S.S8, status]]);
    const revokeOut = await request(PORT_A, `/student-cards/${card.S8.id}/revoke`, { method: "POST", token: tokenAdminA, body: { reason: "Test PR1c" } });
    assert.equal(revokeOut.status, 200, revokeOut.text);
    await guarded("carte révoquée", tokenTeacher, makeBody({ classId: classA2, scans: [scanOf(card.S8)], manual: rosterManual([[S.S7, "present"]]) }), 409, "ROLL_CALL_CARD_INVALID");
    const replaced = await request(PORT_A, `/student-cards/${card.S7.id}/replace`, { method: "POST", token: tokenAdminA, body: {} });
    assert.equal(replaced.status, 200, replaced.text);
    await guarded("carte remplacée", tokenTeacher, makeBody({ classId: classA2, scans: [scanOf(card.S7)], manual: a2Manual() }), 409, "ROLL_CALL_CARD_INVALID");
    await pool.query("UPDATE enrollments SET status = 'CLOSED' WHERE student_id = $1", [S.S2]);
    await guarded("titulaire désinscrit", tokenTeacher, makeBody({ date: date2, scans: [scanOf(card.S2)], manual: rosterManual([[S.S3, "present"], [S.S4, "present"], [S.S5, "present"], [S.S6, "present"]]) }), 409, "ROLL_CALL_CARD_INVALID");
    await pool.query("UPDATE enrollments SET status = 'ENROLLED' WHERE student_id = $1", [S.S2]);
    // Rôle révoqué / permission retirée avant tout enregistrement : 403 sans attestation.
    await pool.query("UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1 AND role_key = 'TEACHER'", [USER.TEACHER]);
    refused(await sync(tokenTeacher, makeBody({ date: date2, scans: [], manual: [] })), "rôle révoqué (nouvelle session)");
    await pool.query("UPDATE user_roles SET status = 'active', revoked_at = NULL WHERE user_id = $1 AND role_key = 'TEACHER'", [USER.TEACHER]);
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: false, read: true, update: false });
    refused(await sync(tokenTeacher, makeBody({ date: date2, scans: [], manual: [] })), "permission retirée");
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: true, read: true, update: true });

    // ================= B'. Abonnement et synchronisation concurrentes (garde W uniquement) =================
    const setSubscription = (status) => pool.query("UPDATE subscriptions SET status = $2, updated_at = NOW() WHERE school_id = $1", [schoolA, status]);
    // Course 1 : suspension pendant l'écriture. La synchronisation tient les lignes école/abonnement en
    // partage jusqu'au COMMIT : la suspension attend, aucune écriture n'a lieu APRÈS la suspension.
    await pool.query(`
      CREATE OR REPLACE FUNCTION pr1c_hold_journal() RETURNS trigger AS $$
      BEGIN IF NEW.source = 'offline' THEN PERFORM pg_sleep(2); END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER pr1c_hold_journal AFTER INSERT ON attendance_roll_calls FOR EACH ROW EXECUTE FUNCTION pr1c_hold_journal();
    `);
    const race1 = makeBody({ classId: classA2, date: date3, scans: [], manual: rosterManual([[S.S7, "present"], [S.S8, "present"]]) });
    const race1Promise = sync(tokenTeacher, race1).then((out) => ({ out, at: Date.now() }));
    // Attendre que la synchronisation tienne le verrou partagé sur les abonnements (pris par la garde W).
    let holding = 0;
    for (let i = 0; i < 200 && holding === 0; i += 1) {
      holding = (await pool.query(
        `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
          WHERE c.relname = 'subscriptions' AND l.mode = 'RowShareLock' AND l.granted AND l.pid <> pg_backend_pid()`,
      )).rows[0].n;
      if (holding === 0) await sleep(10);
    }
    assert.ok(holding > 0, "course 1 : verrou partagé de la garde W observé");
    const suspendStarted = Date.now();
    await setSubscription("suspended");
    const suspendDone = Date.now();
    const race1Result = await race1Promise;
    await pool.query("DROP TRIGGER pr1c_hold_journal ON attendance_roll_calls");
    assert.equal(race1Result.out.status, 201, `course 1 : ${race1Result.out.text}`);
    assert.ok(suspendDone - suspendStarted >= 800, `la suspension a attendu le COMMIT (${suspendDone - suspendStarted} ms)`);
    const race1Row = (await pool.query("SELECT validated_at FROM attendance_roll_calls WHERE session_id = $1", [race1.sessionId])).rows[0];
    assert.ok(race1Row, "course 1 : appel validé avant la suspension");
    const suspendedNow = await sync(tokenTeacher, makeBody({ classId: classA2, date: date3, scans: [], manual: [] }));
    assert.equal(suspendedNow.status, 403, `après suspension : ${suspendedNow.text}`);
    await setSubscription("active");

    // Course 2 : suspension validée APRÈS le contrôle d'authentification mais AVANT la garde W.
    // La synchronisation est bloquée sur le verrou de session (tenu par le test) ; la suspension est
    // validée ; le verrou est relâché : la garde W relit l'abonnement en direct et refuse.
    const race2 = makeBody({ classId: classA2, date: date3, scans: [], manual: rosterManual([[S.S7, "late"], [S.S8, "late"]]) });
    const holder = await pool.connect();
    await holder.query("SELECT pg_advisory_lock(hashtext('rc-offline-session'), hashtext($1::text || ':' || $2::text))", [schoolA, race2.sessionId]);
    const beforeRace2 = await counts();
    const race2Promise = sync(tokenTeacher, race2);
    let waiting = 0;
    for (let i = 0; i < 200 && waiting === 0; i += 1) {
      waiting = (await pool.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted")).rows[0].n;
      if (waiting === 0) await sleep(25);
    }
    assert.ok(waiting > 0, "la synchronisation attend bien le verrou de session (authentification et garde R passées)");
    await setSubscription("suspended");
    await holder.query("SELECT pg_advisory_unlock(hashtext('rc-offline-session'), hashtext($1::text || ':' || $2::text))", [schoolA, race2.sessionId]);
    holder.release();
    const race2Out = await race2Promise;
    assert.equal(race2Out.status, 403, `course 2 : ${race2Out.text}`);
    assert.equal(race2Out.data?.sessionState, "not_recorded", "refus de la garde W, attesté");
    assert.match(String(race2Out.data?.message), /suspendu/);
    assert.deepEqual(await counts(), beforeRace2, "course 2 : aucune écriture");
    await setSubscription("active");
    // Rejeu de l'appel de la course 1 : garde R indépendante de l'abonnement… mais l'authentification
    // de la plateforme refuse toute requête d'un établissement suspendu ; abonnement rétabli : même ACK.
    sameAck(race1Result.out.data)(await sync(tokenTeacher, race1), "course 1 : rejeu après rétablissement");

    // Courses 3 et 4 : établissement B SANS abonnement (accès « Actif » par défaut) et création
    // concurrente d'un PREMIER abonnement bloquant (INSERT, non bloqué par un simple FOR SHARE).
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM subscriptions WHERE school_id = $1", [schoolB])).rows[0].n, 0);
    const insertSuspendedB = () => pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, billing_currency, status, start_date, end_date)
       VALUES ($1, 'Standard', 'BIF', 'suspended', CURRENT_DATE - 1, CURRENT_DATE + 300)`, [schoolB],
    );
    const dropSubscriptionB = () => pool.query("DELETE FROM subscriptions WHERE school_id = $1", [schoolB]);
    const bodyB = (status) => makeBody({ schoolId: schoolB, classId: classB1, actor: USER.TEACHER_B, scans: [], manual: rosterManual([[STUDENT_B, status]]) });
    // Course 3 : la synchronisation verrouille la ligne de l'établissement (FOR UPDATE) : l'INSERT attend le COMMIT.
    await pool.query(`
      CREATE OR REPLACE FUNCTION pr1c_hold_journal_b() RETURNS trigger AS $$
      BEGIN IF NEW.source = 'offline' THEN PERFORM pg_sleep(2); END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER pr1c_hold_journal_b AFTER INSERT ON attendance_roll_calls FOR EACH ROW EXECUTE FUNCTION pr1c_hold_journal_b();
    `);
    const race3 = bodyB("present");
    const race3Promise = sync(tokenTeacherB, race3);
    let lockedB = 0;
    for (let i = 0; i < 300 && lockedB === 0; i += 1) {
      lockedB = (await pool.query(
        `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
          WHERE c.relname = 'subscriptions' AND l.mode = 'RowShareLock' AND l.granted AND l.pid <> pg_backend_pid()`,
      )).rows[0].n;
      if (lockedB === 0) await sleep(10);
    }
    assert.ok(lockedB > 0, "course 3 : garde W en cours (verrous pris)");
    const insertStarted = Date.now();
    await insertSuspendedB();
    const insertWaited = Date.now() - insertStarted;
    const race3Out = await race3Promise;
    await pool.query("DROP TRIGGER pr1c_hold_journal_b ON attendance_roll_calls");
    assert.equal(race3Out.status, 201, `course 3 : ${race3Out.text}`);
    assert.ok(insertWaited >= 800, `création du premier abonnement bloquée jusqu'au COMMIT (${insertWaited} ms)`);
    const afterInsertB = await sync(tokenTeacherB, bodyB("late"));
    assert.equal(afterInsertB.status, 403, `après création de l'abonnement bloquant : ${afterInsertB.text}`);
    await dropSubscriptionB();
    // Course 4 : premier abonnement bloquant créé APRÈS l'authentification mais AVANT la garde W.
    const race4 = bodyB("late");
    const holderB = await pool.connect();
    await holderB.query("SELECT pg_advisory_lock(hashtext('rc-offline-session'), hashtext($1::text || ':' || $2::text))", [schoolB, race4.sessionId]);
    const beforeRace4 = await counts();
    const race4Promise = sync(tokenTeacherB, race4);
    let waitingB = 0;
    for (let i = 0; i < 200 && waitingB === 0; i += 1) {
      waitingB = (await pool.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted")).rows[0].n;
      if (waitingB === 0) await sleep(25);
    }
    assert.ok(waitingB > 0, "course 4 : synchronisation en attente du verrou de session");
    await insertSuspendedB();
    await holderB.query("SELECT pg_advisory_unlock(hashtext('rc-offline-session'), hashtext($1::text || ':' || $2::text))", [schoolB, race4.sessionId]);
    holderB.release();
    const race4Out = await race4Promise;
    assert.equal(race4Out.status, 403, `course 4 : ${race4Out.text}`);
    assert.equal(race4Out.data?.sessionState, "not_recorded");
    assert.deepEqual(await counts(), beforeRace4, "course 4 : aucune écriture");
    await dropSubscriptionB();

    // ================= D. Concurrence et résilience =================
    // Deux appareils, deux sessions, même classe, même jour (A2, aujourd'hui) : aucune présence écrasée.
    const deviceA = makeBody({ classId: classA2, manual: rosterManual([[S.S7, "present"], [S.S8, "absent"]]) });
    const deviceB = makeBody({ classId: classA2, manual: rosterManual([[S.S7, "absent"], [S.S8, "present"]]) });
    const [outA, outB] = await Promise.all([sync(tokenTeacher, deviceA), sync(tokenTeacher, deviceB, { port: PORT_B })]);
    assert.deepEqual([outA.status, outB.status], [201, 201], `${outA.text}\n${outB.text}`);
    const finalA2 = await attendance(today, classA2);
    assert.equal(finalA2[S.S7], "present", "présent jamais remplacé par absent");
    assert.equal(finalA2[S.S8], "present", "absent corrigé en présent");
    assert.equal(outA.data.created + outB.data.created, 2, "une création par élève");

    // Compétition avec /validate en ligne (A1, J-2) : sérialisation par le verrou du jour.
    const onlineSession = crypto.randomUUID();
    const receipt = await request(PORT_A, "/student-cards/roll-call/scan", { method: "POST", token: tokenTeacher, body: { sessionId: onlineSession, classId: classA1, date: date2, cardToken: card.S3.cardToken } });
    assert.equal(receipt.status, 200, receipt.text);
    const online = request(PORT_A, "/student-cards/roll-call/validate", {
      method: "POST", token: tokenTeacher, headers: { "Idempotency-Key": onlineSession },
      body: { sessionId: onlineSession, classId: classA1, date: date2, mode: "teacher", receipts: [receipt.data.receipt], complete: true,
        manual: rosterManual([[S.S1, "late"], [S.S2, "present"], [S.S4, "present"], [S.S5, "present"], [S.S6, "present"]]) },
    });
    const offlineRace = sync(tokenTeacher, makeBody({ date: date2, scans: [scanOf(card.S4, "qr")], manual: rosterManual([[S.S1, "present"], [S.S2, "present"], [S.S3, "absent"], [S.S5, "present"], [S.S6, "present"]]) }), { port: PORT_B });
    const [onlineOut, offlineOut] = await Promise.all([online, offlineRace]);
    assert.equal(onlineOut.status, 201, onlineOut.text);
    assert.equal(offlineOut.status, 201, offlineOut.text);
    const race = await attendance(date2);
    assert.equal(race[S.S3], "present", "S3 : présent en ligne jamais écrasé par l'absence hors ligne");
    assert.equal(Object.keys(race).length, 6);

    // Échec d'audit : rollback complet, puis renvoi identique enregistré.
    await pool.query(`
      CREATE OR REPLACE FUNCTION pr1c_fail_audit() RETURNS trigger AS $$
      BEGIN IF NEW.action = 'student_card_roll_call_offline_sync' THEN RAISE EXCEPTION 'audit indisponible (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER pr1c_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION pr1c_fail_audit();
    `);
    const date3Body = () => makeBody({ date: date3, scans: [], manual: rosterManual([[S.S2, "present"], [S.S3, "late"], [S.S4, "absent"], [S.S5, "present"], [S.S6, "present"]]) });
    const auditBody = date3Body();
    const beforeAudit = await counts();
    const auditFail = await sync(tokenTeacher, auditBody);
    assert.equal(auditFail.status, 500, auditFail.text);
    assert.equal(auditFail.data?.sessionState, undefined, "5xx : jamais not_recorded");
    assert.deepEqual(await counts(), beforeAudit, "audit en échec : aucune présence ni journal");
    await pool.query("DROP TRIGGER pr1c_fail_audit ON audit_logs");
    const auditRetry = await sync(tokenTeacher, auditBody);
    assert.equal(auditRetry.status, 201, auditRetry.text);

    // Échec de stockage de l'ACK : rollback complet.
    await pool.query(`
      CREATE OR REPLACE FUNCTION pr1c_fail_journal() RETURNS trigger AS $$
      BEGIN IF NEW.source = 'offline' THEN RAISE EXCEPTION 'journal indisponible (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER pr1c_fail_journal BEFORE INSERT ON attendance_roll_calls FOR EACH ROW EXECUTE FUNCTION pr1c_fail_journal();
    `);
    const ackBody = makeBody({ classId: classA2, date: date1, scans: [], manual: rosterManual([[S.S7, "present"], [S.S8, "late"]]) });
    const beforeAck = await counts();
    assert.equal((await sync(tokenTeacher, ackBody)).status, 500);
    assert.deepEqual(await counts(), beforeAck, "ACK non stocké : aucune présence");
    await pool.query("DROP TRIGGER pr1c_fail_journal ON attendance_roll_calls");
    assert.equal((await sync(tokenTeacher, ackBody)).status, 201);

    // Timeout après COMMIT : la réponse est perdue, le renvoi identique retrouve l'ACK.
    await pool.query(`
      CREATE OR REPLACE FUNCTION pr1c_slow_journal() RETURNS trigger AS $$
      BEGIN IF NEW.source = 'offline' THEN PERFORM pg_sleep(2); END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER pr1c_slow_journal AFTER INSERT ON attendance_roll_calls FOR EACH ROW EXECUTE FUNCTION pr1c_slow_journal();
    `);
    const slowBody = makeBody({ classId: classA2, date: date2, scans: [], manual: rosterManual([[S.S7, "late"], [S.S8, "present"]]) });
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 500);
    await assert.rejects(() => sync(tokenTeacher, slowBody, { signal: abort.signal }), "délai client dépassé");
    clearTimeout(timer);
    await sleep(3500);
    await pool.query("DROP TRIGGER pr1c_slow_journal ON attendance_roll_calls");
    const committed = (await pool.query("SELECT ack_body FROM attendance_roll_calls WHERE session_id = $1", [slowBody.sessionId])).rows[0];
    assert.ok(committed, "COMMIT effectué malgré la réponse perdue");
    const afterTimeout = await sync(tokenTeacher, slowBody);
    assert.equal(afterTimeout.status, 200, afterTimeout.text);
    assert.deepEqual(ackFields(afterTimeout.data), ackFields(committed.ack_body));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM attendance_roll_calls WHERE session_id = $1", [slowBody.sessionId])).rows[0].n, 1);

    // Redémarrage du Backend : l'ACK reste rejouable (journal), sans nouvelle écriture.
    await stopServer(serverA);
    serverA = await startServer(isolatedUrl, PORT_A);
    await dropIdempotency();
    const beforeRestart = await counts();
    sameAck(ack)(await sync(tokenTeacher, nominal), "après redémarrage");
    assert.deepEqual(await counts(), beforeRestart);

    // Rejeu après dépassement de syncDeadline : l'ACK d'un appel enregistré à J-5 reste restituable,
    // une nouvelle opération à J-5 est refusée (journal lu avant la fenêtre de date).
    const oldDate = shift(today, -5);
    const oldBody = makeBody({ date: oldDate, scans: [], manual: [] });
    const oldAck = { rollCallId: crypto.randomUUID(), sessionId: oldBody.sessionId, operationId: oldBody.operationId, revision: 1, payloadDigest: oldBody.payloadDigest,
      validatedAt: new Date(Date.now() - 5 * 86400000).toISOString(), created: 0, corrected: 0, unchanged: 0, protected: 0,
      protectedScanIds: [], protectedManualIndexes: [], invalidScanIds: [], counts: { present: 0, late: 0, absent: 0, excused: 0, enrolled: 6 } };
    await pool.query(
      `INSERT INTO attendance_roll_calls (id, school_id, class_id, roll_call_date, session_id, mode, author_user_id, author_role_keys, teacher_id,
         source, operation_id, payload_digest, ack_body)
       VALUES ($1,$2,$3,$4::date,$5,'teacher',$6,ARRAY['TEACHER'],$7,'offline',$8,$9,$10::jsonb)`,
      [oldAck.rollCallId, schoolA, classA1, oldDate, oldBody.sessionId, USER.TEACHER, teacherA, oldBody.operationId, oldBody.payloadDigest, JSON.stringify(oldAck)],
    );
    sameAck(oldAck)(await sync(tokenTeacher, oldBody), "rejeu après échéance");
    await guarded("nouvelle opération après échéance", tokenTeacher, makeBody({ date: oldDate, scans: [], manual: [] }), 409, "ROLL_CALL_OFFLINE_EXPIRED");

    // ================= E. Non-régression des routes existantes =================
    const rosterOut = await request(PORT_A, `/student-cards/roll-call/roster?${new URLSearchParams({ sessionId: crypto.randomUUID(), classId: classA1, date: today })}`, { token: tokenTeacher });
    assert.equal(rosterOut.status, 200, rosterOut.text);
    const overview = await request(PORT_A, `/student-cards/roll-call/overview?date=${today}`, { token: tokenAdminA });
    assert.ok([200, 403].includes(overview.status), overview.text); // direction seulement ; SCHOOL_ADMIN selon la matrice existante
    const validateNoKey = await request(PORT_A, "/student-cards/roll-call/validate", { method: "POST", token: tokenTeacher, body: { sessionId: crypto.randomUUID(), classId: classA1, date: today, receipts: [] } });
    assert.equal(validateNoKey.status, 400, "validate en ligne : Idempotency-Key toujours exigée");

    // Aucun secret de carte dans les réponses observées ni dans les journaux des serveurs.
    for (const value of await secrets()) {
      assert.equal(serverA.output.value.includes(value), false, "journal A");
      assert.equal(serverB.output.value.includes(value), false, "journal B");
    }
    console.log("rollCallOfflineSync.http.pg.test.js OK");
  } catch (error) {
    // Diagnostic : fin des journaux des deux instances (aucun secret n'y est écrit, contrôlé ci-dessus).
    for (const [name, server] of [["A", serverA], ["B", serverB]]) {
      if (server) console.error(`--- journal serveur ${name} (fin) ---\n${server.output.value.slice(-2500)}`);
    }
    throw error;
  } finally {
    await stopServer(serverA);
    await stopServer(serverB);
    await pool.end().catch(() => {});
    await repo.close?.().catch?.(() => {});
  }
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
