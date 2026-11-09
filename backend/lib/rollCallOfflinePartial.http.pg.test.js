"use strict";

/**
 * NFC-APPEL-PARTIEL-01 — appel NFC partiel, de bout en bout (serveur réel + PostgreSQL isolé).
 *
 * Classe de 35 élèves. Contrat : `complete: false` = couverture partielle ; seuls les élèves
 * transmis sont écrits, les autres restent sans présence (« non pointés »), jamais absents.
 *   T1 22/35 présents · T2 35/35 · T3 10 présents + 5 absences explicites · T4 retards et absences
 *   ultérieurs · T5 justifications · T6 changement réel d'inscription, carte révoquée ou d'un autre
 *   établissement · T7 rejeu idempotent · T8 ancien contrat `complete: true` et appel vide.
 * Non-régression de `/validate` et du contrat PR1c : studentCardRollCall.http.pg.test.js et
 * rollCallOfflineSync.http.pg.test.js (inchangés).
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
const IT_DATABASE = "somafrik_roll_call_offline_partial_it";
const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.SOMAFRIK_OFFLINE_PARTIAL_HTTP_PORT ?? 19906);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";
const CODE_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const CODE_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";
const U = (n) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, "0")}`;
const USER = { ADMIN_A: U(1), TEACHER: U(2), ADMIN_B: U(3) };
const STUDENTS = Array.from({ length: 35 }, (_, i) => U(100 + i));
const OTHER_CLASS_STUDENT = U(200);
const STUDENT_B = U(201);

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

async function request(port, pathname, { method = "GET", token, body, rawBody, headers = {}, signal } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    // `rawBody` : chaîne envoyée telle quelle (corps figé du Mobile, NFC-PRES-LOCAL-PR4).
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
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
    console.log("rollCallOfflinePartial.http.pg.test.js SKIP (DATABASE_URL absent)");
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
      "INSERT INTO schools (country_id, school_code, login_code, short_code, name, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id",
      [country, code, login, short, name],
    )).rows[0].id;
    const schoolA = await school(cd.id, CODE_A, LOGIN_A, "LAC", "Lycée Lac");
    const schoolB = await school(bi.id, CODE_B, LOGIN_B, "BUJ", "Lycée Buj");
    await setLoginCodeTriggers(pool, true);
    await pool.query("ALTER TABLE users DISABLE TRIGGER users_permanent_identity_insert");
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password) VALUES
         ($1,$4,'PA-ADM-A','Aline','A','aline@pa.test','Admin School','active', FALSE),
         ($2,$4,'PA-ENS-A','Chidi','T','chidi@pa.test','Enseignant','active', FALSE),
         ($3,$5,'PA-ADM-B','Binta','B','binta@pa.test','Admin School','active', FALSE)`,
      [USER.ADMIN_A, USER.TEACHER, USER.ADMIN_B, schoolA, schoolB],
    );
    await pool.query("ALTER TABLE users ENABLE TRIGGER users_permanent_identity_insert");
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES
         ($1,$4,'SCHOOL_ADMIN','active'), ($2,$4,'TEACHER','active'), ($3,$5,'SCHOOL_ADMIN','active')`,
      [USER.ADMIN_A, USER.TEACHER, USER.ADMIN_B, schoolA, schoolB],
    );
    await setRoleModuleGrant(pool, "TEACHER", "attendance", { create: true, read: true, update: true });
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
       SELECT id, $2, 'PA-S' || ord, 'Prenom' || ord, 'Nom', 'active' FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ord)`,
      [STUDENTS, schoolA],
    );
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status) VALUES
         ($1,$3,'PA-OTHER','Omar','Autre','active'), ($2,$4,'PA-SB','Ines','Buj','active')`,
      [OTHER_CLASS_STUDENT, STUDENT_B, schoolA, schoolB],
    );
    const year = async (schoolId) => (await pool.query(
      "INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027', TRUE, 'open') RETURNING id", [schoolId],
    )).rows[0].id;
    const yearA = await year(schoolA);
    const yearB = await year(schoolB);
    const klass = async (schoolId, yearId, code) => (await pool.query(
      "INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,$3,$4,'active') RETURNING id", [schoolId, yearId, code, `Classe ${code}`],
    )).rows[0].id;
    const class35 = await klass(schoolA, yearA, "PA-35");
    const classOther = await klass(schoolA, yearA, "PA-OT");
    const classB = await klass(schoolB, yearB, "PA-B1");
    const enroll = (schoolId, studentId, classId, yearId) => pool.query(
      "INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1,$2,$3,$4,'ENROLLED')", [schoolId, studentId, classId, yearId],
    );
    for (const id of STUDENTS) await enroll(schoolA, id, class35, yearA);
    await enroll(schoolA, OTHER_CLASS_STUDENT, classOther, yearA);
    await enroll(schoolB, STUDENT_B, classB, yearB);
    const subjectA = (await pool.query("INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,'MATH','Maths','active') RETURNING id", [schoolA])).rows[0].id;
    const teacherA = (await pool.query(
      "INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,'PA-TCH-A','active') RETURNING id", [schoolA, USER.TEACHER],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status) VALUES ($1,$2,$3,$4,$5,'active')`,
      [schoolA, teacherA, class35, subjectA, yearA],
    );
    await pool.query(
      `INSERT INTO school_settings (school_id, student_card_enabled, student_card_qr_enabled, student_card_nfc_enabled, student_card_attendance_enabled,
                                    student_card_offline_roll_call_enabled)
       VALUES ($1, TRUE, TRUE, TRUE, TRUE, TRUE), ($2, TRUE, TRUE, TRUE, TRUE, TRUE)
       ON CONFLICT (school_id) DO UPDATE SET student_card_enabled = TRUE, student_card_qr_enabled = TRUE,
         student_card_nfc_enabled = TRUE, student_card_attendance_enabled = TRUE, student_card_offline_roll_call_enabled = TRUE`,
      [schoolA, schoolB],
    );
    await pool.query("UPDATE school_settings SET student_card_holder_kind = 'eleve' WHERE school_id = ANY($1::uuid[])", [[schoolA, schoolB]]);
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, billing_currency, status, start_date, end_date)
       VALUES ($1, 'Standard', 'CDF', 'active', CURRENT_DATE - 30, CURRENT_DATE + 300), ($2, 'Standard', 'BIF', 'active', CURRENT_DATE - 30, CURRENT_DATE + 300)`,
      [schoolA, schoolB],
    );
    const zone = afternoonZone(Date.now());
    await pool.query("UPDATE schools SET profile_payload = COALESCE(profile_payload, '{}'::jsonb) || jsonb_build_object('timezone', $2::text) WHERE id = $1", [schoolA, zone]);
    const today = wallTime(zone, Date.now()).slice(0, 10);

    server = await startServer(isolatedUrl, PORT);
    const tokenTeacher = await mint({ sub: USER.TEACHER, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: CODE_A, permissions: ["Présences:CREATE", "Présences:UPDATE", "Présences:READ"] });
    const tokenAdminA = await mint({ sub: USER.ADMIN_A, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: CODE_A,
      permissions: ["Élèves:UPDATE", "Gérer élèves", "Présences:CREATE", "Présences:UPDATE", "Présences:READ"] });
    const tokenAdminB = await mint({ sub: USER.ADMIN_B, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: CODE_B,
      permissions: ["Élèves:UPDATE", "Gérer élèves", "Présences:CREATE", "Présences:UPDATE"] });

    // ---------- Cartes NFC émises par l'API réelle, encodées ----------
    const issue = async (studentId, token = tokenAdminA) => {
      const issued = await request(PORT, "/student-cards", { method: "POST", token, body: { studentId, medium: "nfc_qr" } });
      assert.equal(issued.status, 201, JSON.stringify(issued.data));
      const [publicId, secret] = issued.data.cardToken.split(".");
      await pool.query(
        "UPDATE student_access_cards SET nfc_uid = $2, nfc_tag_type = 'NTAG216', nfc_encoding_state = 'encoded', nfc_encoded_at = NOW() WHERE id = $1",
        [issued.data.id, `04${crypto.randomBytes(6).toString("hex").toUpperCase()}`],
      );
      return { id: issued.data.id, publicId, key: deriveCardKeyFromSecret(secret), studentId };
    };
    const cards = [];
    for (const id of STUDENTS) cards.push(await issue(id));
    const cardOther = await issue(OTHER_CLASS_STUDENT);
    const cardB = await issue(STUDENT_B, tokenAdminB);

    const byKey = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
    const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
    function makeBody({ date, sessionId = crypto.randomUUID(), operationId = crypto.randomUUID(), revision = 1, scanned = [], manual = [], complete = false, classId = class35 }) {
      const scans = scanned.map((c) => {
        const scanId = crypto.randomUUID();
        return {
          scanId,
          publicId: c.publicId,
          proof: computeProof(c.key, {
            contractVersion: "rc-offline-1", schoolId: schoolA, actorUserId: USER.TEACHER, classId, date, mode: "teacher", sessionId,
            packId: "", scanId, publicId: c.publicId, medium: "nfc",
          }),
          medium: "nfc",
          scannedAt: new Date().toISOString(),
        };
      }).sort(byKey("scanId"));
      const body = {
        contractVersion: "rc-offline-1", operationId, sessionId, revision, schoolId: schoolA, classId, date, mode: "teacher", packId: null,
        complete, scans, manual: [...manual].sort(byKey("studentId")),
      };
      return { ...body, payloadDigest: computePayloadDigest(body) };
    }
    const sync = (body, token = tokenTeacher) =>
      request(PORT, "/student-cards/roll-call/offline/v1/sync", { method: "POST", token, body, headers: { "Idempotency-Key": body.operationId } });
    const statuses = async (date) => Object.fromEntries((await pool.query(
      "SELECT student_id::text AS s, status FROM attendance WHERE school_id = $1 AND attendance_date = $2::date", [schoolA, date],
    )).rows.map((r) => [r.s, r.status]));
    const rowsOf = async (date) => (await pool.query(
      "SELECT id::text, student_id::text, status, updated_at FROM attendance WHERE school_id = $1 AND attendance_date = $2::date ORDER BY student_id", [schoolA, date],
    )).rows;
    const tally = (map) => Object.values(map).reduce((acc, status) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }), {});
    const totals = async () => (await pool.query(
      `SELECT (SELECT count(*)::int FROM attendance) AS attendance, (SELECT count(*)::int FROM attendance_roll_calls) AS journal,
              (SELECT count(*)::int FROM (SELECT student_id, attendance_date FROM attendance GROUP BY 1, 2 HAVING count(*) > 1) d) AS duplicates`,
    )).rows[0];
    const notRecorded = (out, status, code, label) => {
      assert.equal(out.status, status, `${label} : ${out.text}`);
      assert.equal(out.data?.code, code, label);
      assert.equal(out.data?.sessionState, "not_recorded", `${label} : attestation not_recorded`);
      assert.equal(out.data?.rollCallId, undefined, label);
    };
    const conformingAck = (out, body, label) => {
      assert.ok(out.status === 201 || out.status === 200, `${label} : ${out.text}`);
      assert.equal(out.data.operationId, body.operationId, `${label} operationId`);
      assert.equal(out.data.sessionId, body.sessionId, `${label} sessionId`);
      assert.equal(out.data.revision, body.revision, `${label} revision`);
      assert.equal(out.data.payloadDigest, body.payloadDigest, `${label} payloadDigest`);
    };
    const report = [];

    // ================= T1 — 35 inscrits, 22 présents =================
    const dayT1 = today;
    const t1 = makeBody({ date: dayT1, scanned: cards.slice(0, 22) });
    const before1 = await totals();
    const out1 = await sync(t1);
    assert.equal(out1.status, 201, `T1 : ${out1.text}`);
    conformingAck(out1, t1, "T1");
    assert.deepEqual([out1.data.created, out1.data.corrected, out1.data.protected], [22, 0, 0]);
    assert.deepEqual(out1.data.counts, { present: 22, late: 0, absent: 0, excused: 0, enrolled: 35 });
    const s1 = await statuses(dayT1);
    assert.deepEqual(tally(s1), { present: 22 }, "22 présents, aucun absent créé");
    for (const id of STUDENTS.slice(22)) assert.equal(s1[id], undefined, "non pointé : aucune ligne de présence");
    const after1 = await totals();
    assert.deepEqual([after1.attendance - before1.attendance, after1.journal - before1.journal, after1.duplicates], [22, 1, 0]);
    const journal1 = (await pool.query("SELECT source, scanned_count, created_count FROM attendance_roll_calls WHERE session_id = $1", [t1.sessionId])).rows[0];
    assert.deepEqual(journal1, { source: "offline", scanned_count: 22, created_count: 22 });
    const audit1 = (await pool.query(
      "SELECT new_value FROM audit_logs WHERE action = 'student_card_roll_call_offline_sync' AND entity_id = $1", [out1.data.rollCallId],
    )).rows[0];
    assert.equal(audit1?.new_value?.coverage, "partial", "couverture tracée dans l'audit");
    report.push("T1 22/35 : 22 écritures, 13 sans ligne, ACK conforme, aucun ROSTER_CHANGED");

    // ================= T7 — rejeu idempotent du lot T1 =================
    const replay = await sync(t1);
    assert.equal(replay.status, 200, `T7 : ${replay.text}`);
    assert.equal(replay.data.idempotentReplay, true);
    conformingAck(replay, t1, "T7");
    assert.equal(replay.data.rollCallId, out1.data.rollCallId, "même ACK");
    await pool.query("DELETE FROM idempotency_keys");
    const replayJournal = await sync(t1);
    assert.equal(replayJournal.status, 200, `T7 journal : ${replayJournal.text}`);
    assert.equal(replayJournal.data.rollCallId, out1.data.rollCallId, "ACK rejoué depuis le journal (> 24 h)");
    const otherContent = makeBody({ date: dayT1, sessionId: t1.sessionId, scanned: cards.slice(0, 21) });
    const conflict = await sync(otherContent);
    assert.equal(conflict.status, 409, conflict.text);
    assert.equal(conflict.data.code, "ROLL_CALL_SESSION_CONFLICT", "même session, autre contenu : jamais réécrit");
    assert.deepEqual(await totals(), after1, "T7 : aucune double écriture");
    report.push("T7 rejeu : même ACK (cache puis journal), autre contenu sur la même session → SESSION_CONFLICT, 0 écriture");

    // ================= T4 — compléments ultérieurs par les mécanismes existants =================
    const rows1 = await rowsOf(dayT1);
    // La direction désigne explicitement l'enseignant de la présence (règle existante de /api/presences).
    const presences = (items, token, extra = {}) => request(PORT, "/presences", {
      method: "POST", token, headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { classId: class35, date: dayT1, ...extra, items: items.map(([studentId, status]) => ({ studentId, classId: class35, date: dayT1, status, ...extra })) },
    });
    const late = await presences(STUDENTS.slice(22, 26).map((id) => [id, "late"]), tokenTeacher);
    assert.ok(late.status === 201 || late.status === 200, `T4 retards : ${late.status} ${late.text}`);
    const absent = await presences(STUDENTS.slice(26, 32).map((id) => [id, "absent"]), tokenTeacher);
    assert.ok(absent.status === 201 || absent.status === 200, `T4 absences : ${absent.status} ${absent.text}`);
    const s4 = await statuses(dayT1);
    assert.deepEqual(tally(s4), { present: 22, late: 4, absent: 6 });
    const rows4 = await rowsOf(dayT1);
    for (const row of rows1) {
      const now = rows4.find((r) => r.student_id === row.student_id);
      assert.equal(now.id, row.id, "présence NFC conservée (même ligne)");
      assert.equal(now.status, "present", "présence NFC jamais écrasée");
    }
    report.push("T4 compléments : 4 retards et 6 absences ajoutés via POST /api/presences ; les 22 présences NFC restent identiques");

    // ================= T5 — justifications =================
    // Le contrat hors ligne n'accepte pas « Justifié » de l'enseignant (statuts present | late | absent).
    const excusedOffline = makeBody({ date: dayT1, manual: [{ studentId: STUDENTS[32], status: "excused" }] });
    const excusedOut = await sync(excusedOffline);
    assert.equal(excusedOut.status, 400, `T5 enseignant : ${excusedOut.text}`);
    assert.equal(excusedOut.data.code, "ROLL_CALL_INPUT_INVALID");
    const justify = await presences(STUDENTS.slice(32, 35).map((id) => [id, "excused"]), tokenAdminA, { teacherId: teacherA });
    assert.ok(justify.status === 201 || justify.status === 200, `T5 direction : ${justify.status} ${justify.text}`);
    const s5 = await statuses(dayT1);
    assert.deepEqual(tally(s5), { present: 22, late: 4, absent: 6, excused: 3 });
    assert.equal(Object.keys(s5).length, 35, "total 35");
    // Second appel NFC (nouvelle session) : statuts justifiés et présences protégés, jamais écrasés.
    const second = makeBody({ date: dayT1, scanned: [cards[0], cards[33]], manual: [{ studentId: STUDENTS[34], status: "present" }] });
    const secondOut = await sync(second);
    assert.equal(secondOut.status, 201, `T5 second appel : ${secondOut.text}`);
    assert.equal(secondOut.data.protected, 2, "justifiés protégés (carte et pointage)");
    assert.equal(secondOut.data.unchanged, 1, "présence déjà enregistrée inchangée");
    assert.equal(secondOut.data.created, 0);
    assert.deepEqual(await statuses(dayT1), s5, "aucun statut modifié");
    assert.equal((await totals()).duplicates, 0);
    report.push("T5 justifications : « Justifié » refusé dans le lot enseignant (400), accepté par la direction via /api/presences ; second appel NFC : 2 protégés, 0 écrasement");

    // ================= T2 — 35 inscrits, 35 présents =================
    const dayT2 = shift(today, -1);
    const t2 = makeBody({ date: dayT2, scanned: [...cards, cards[0]] }); // une carte lue deux fois
    const out2 = await sync(t2);
    assert.equal(out2.status, 201, `T2 : ${out2.text}`);
    conformingAck(out2, t2, "T2");
    assert.equal(out2.data.created, 35);
    assert.deepEqual(tally(await statuses(dayT2)), { present: 35 });
    assert.equal((await totals()).duplicates, 0, "aucun doublon malgré deux lectures de la même carte");
    report.push("T2 35/35 : 35 présences, double lecture d'une carte sans doublon");

    // ================= T3 — 10 présents, 5 absences explicites, 20 non pointés =================
    const dayT3 = shift(today, -2);
    const t3 = makeBody({ date: dayT3, scanned: cards.slice(0, 10), manual: STUDENTS.slice(10, 15).map((studentId) => ({ studentId, status: "absent" })) });
    const out3 = await sync(t3);
    assert.equal(out3.status, 201, `T3 : ${out3.text}`);
    conformingAck(out3, t3, "T3");
    assert.deepEqual(out3.data.counts, { present: 10, late: 0, absent: 5, excused: 0, enrolled: 35 });
    const s3 = await statuses(dayT3);
    assert.deepEqual(tally(s3), { present: 10, absent: 5 });
    assert.equal(35 - Object.keys(s3).length, 20, "20 non pointés");
    report.push("T3 : 10 présents, 5 absents explicites, 20 non pointés");

    // ================= T6 — changement réel d'inscription, carte révoquée, autre établissement =================
    const dayT6 = shift(today, -3);
    const baseline6 = await totals();
    // Élève scanné puis désinscrit de la classe avant la synchronisation.
    await pool.query("UPDATE enrollments SET status = 'WITHDRAWN' WHERE student_id = $1 AND class_id = $2", [STUDENTS[5], class35]);
    const withdrawn = makeBody({ date: dayT6, scanned: cards.slice(0, 8) });
    const withdrawnOut = await sync(withdrawn);
    notRecorded(withdrawnOut, 409, "ROLL_CALL_CARD_INVALID", "T6 élève désinscrit");
    assert.equal(withdrawnOut.data.details.invalidScanIds.length, 1, "scan concerné identifié");
    assert.equal(withdrawnOut.data.details.invalidScanIds[0], withdrawn.scans.find((s) => s.publicId === cards[5].publicId).scanId);
    await pool.query("UPDATE enrollments SET status = 'ENROLLED' WHERE student_id = $1 AND class_id = $2", [STUDENTS[5], class35]);
    // Élève d'une autre classe : carte valide, mais hors classe.
    notRecorded(await sync(makeBody({ date: dayT6, scanned: [cards[0], cardOther] })), 409, "ROLL_CALL_CARD_INVALID", "T6 carte hors classe");
    // Pointage manuel d'un élève non inscrit dans la classe.
    notRecorded(await sync(makeBody({ date: dayT6, scanned: [cards[0]], manual: [{ studentId: OTHER_CLASS_STUDENT, status: "present" }] })), 409, "ROLL_CALL_ROSTER_CHANGED", "T6 pointage hors classe");
    // Carte révoquée.
    await pool.query("UPDATE student_access_cards SET status = 'revoked', revoked_at = NOW() WHERE id = $1", [cards[7].id]);
    notRecorded(await sync(makeBody({ date: dayT6, scanned: cards.slice(6, 8) })), 409, "ROLL_CALL_CARD_INVALID", "T6 carte révoquée");
    await pool.query("UPDATE student_access_cards SET status = 'active', revoked_at = NULL WHERE id = $1", [cards[7].id]);
    // Carte d'un autre établissement : aucune preuve vérifiable dans l'établissement A.
    notRecorded(await sync(makeBody({ date: dayT6, scanned: [cards[0], cardB] })), 400, "ROLL_CALL_PROOF_INVALID", "T6 autre établissement");
    assert.deepEqual(await totals(), baseline6, "T6 : rien écrit, aucun journal");
    assert.deepEqual(await statuses(dayT6), {});
    report.push("T6 : désinscrit / hors classe / révoquée → 409 CARD_INVALID ; pointage hors classe → 409 ROSTER_CHANGED ; autre établissement → 400 PROOF_INVALID ; tous not_recorded, 0 écriture");

    // ================= T8 — ancien contrat `complete: true` et cas limites =================
    const legacyMissing = makeBody({ date: dayT6, complete: true, scanned: cards.slice(0, 22) });
    const legacyMissingOut = await sync(legacyMissing);
    notRecorded(legacyMissingOut, 409, "ROLL_CALL_ROSTER_CHANGED", "T8 ancien lot incomplet");
    assert.deepEqual(legacyMissingOut.data.details, { missing: 13, unexpected: 0, enrolled: 35 }, "règle historique inchangée");
    const legacyFull = makeBody({
      date: dayT6, complete: true, scanned: cards.slice(0, 22), manual: STUDENTS.slice(22).map((studentId) => ({ studentId, status: "absent" })),
    });
    const legacyFullOut = await sync(legacyFull);
    assert.equal(legacyFullOut.status, 201, `T8 ancien lot complet : ${legacyFullOut.text}`);
    conformingAck(legacyFullOut, legacyFull, "T8");
    assert.deepEqual(tally(await statuses(dayT6)), { present: 22, absent: 13 }, "corps figé historique traité comme avant");
    const empty = makeBody({ date: shift(today, -3), sessionId: crypto.randomUUID() });
    const emptyOut = await sync(empty);
    assert.equal(emptyOut.status, 400, `appel vide : ${emptyOut.text}`);
    assert.equal(emptyOut.data.code, "ROLL_CALL_INPUT_INVALID");
    const badCoverage = { ...makeBody({ date: dayT6, scanned: [cards[0]] }) };
    badCoverage.complete = "partial";
    const { payloadDigest: _ignored, ...withoutDigest } = badCoverage;
    void _ignored;
    badCoverage.payloadDigest = computePayloadDigest(withoutDigest);
    const badOut = await sync(badCoverage);
    assert.equal(badOut.status, 400, badOut.text);
    assert.equal(badOut.data.code, "ROLL_CALL_INPUT_INVALID", "couverture autre qu'un booléen refusée");
    assert.equal((await totals()).duplicates, 0);
    report.push("T8 ancien contrat : complete:true incomplet → ROSTER_CHANGED {missing:13} ; complet → 201 ; appel partiel vide et couverture invalide → 400");

    for (const line of report) console.log(`  ✔ ${line}`);
    console.log("rollCallOfflinePartial.http.pg.test.js OK");
  } catch (error) {
    if (server) console.error(`--- journal serveur (fin) ---\n${server.output.value.slice(-3000)}`);
    throw error;
  } finally {
    await stopServer(server);
    await pool.end().catch(() => {});
    await repo.close?.().catch?.(() => {});
  }
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
