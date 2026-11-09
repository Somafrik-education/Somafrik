"use strict";

/**
 * NFC-ROLES-FINAL-01 — appel NFC/QR local-first multirôle, de bout en bout (serveur réel + PostgreSQL).
 *
 * Contrat unique du pack (GET …/offline/v1/pack) et de la synchronisation (POST …/offline/v1/sync) :
 *  - enseignant affecté → autorité « teacher » (présences attribuées à l'enseignant) ;
 *  - responsable scolaire (SCHOOL_ADMIN, PROVISEUR, PRINCIPAL, PREFET_ETUDES, SECRETARY) dont le
 *    rôle PRIS ISOLÉMENT accorde l'écriture des présences → autorité « staff », toutes les classes
 *    actives de son établissement, teacher_id NULL, journal mode « staff », auteur réel ;
 *  - tout autre rôle, parent, élève, plateforme, compte inactif, droit révoqué : refus.
 * Classe de 35 élèves ; Directeur puis Secrétaire scannent 22 cartes.
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
const IT_DATABASE = "somafrik_roll_call_roles_it";
const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.SOMAFRIK_ROLL_CALL_ROLES_HTTP_PORT ?? 19916);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";
const CODE_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const CODE_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";
const U = (n) => `abababab-abab-4bab-8bab-${String(n).padStart(12, "0")}`;
const USER = {
  DIRECTOR: U(1), SECRETARY: U(2), TEACHER: U(3), TEACHER_FREE: U(4), PREFET: U(5), SUPERVISOR: U(6),
  PARENT: U(7), SUPER: U(8), DISABLED: U(9), TEACHER_DIRECTOR: U(10), TEACHER_SECRETARY: U(11), ADMIN_B: U(12),
};
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

// Signataire de pack propre au test (aucune clé réelle).
const PACK_KEY = (() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateB64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicRaw: publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64url"),
  };
})();
const PACK_ENV = {
  ROLL_CALL_PACK_SIGNING_KEY: PACK_KEY.privateB64,
  ROLL_CALL_PACK_KEYRING: JSON.stringify({ revocationSequence: 0, keys: [{ keyId: "rc-pack-roles-it", publicKey: PACK_KEY.publicRaw, status: "active" }] }),
  ROLL_CALL_PACK_MATCH_SECRET: "roles-test-only-match-".repeat(3),
};

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
      ...PACK_ENV,
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
    console.log("rollCallRoles.http.pg.test.js SKIP (DATABASE_URL absent)");
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
    // ---------- Migration additive : mode « staff » accepté, idempotente ----------
    const defs = async () => Object.fromEntries((await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'attendance_roll_calls'::regclass AND conname LIKE 'attendance_roll_calls_%_check'`,
    )).rows.map((r) => [r.conname, r.def]));
    const first = await defs();
    for (const name of ["attendance_roll_calls_mode_check", "attendance_roll_calls_mode_shape_check", "attendance_roll_calls_offline_shape_check"]) {
      assert.match(first[name], /staff/, name);
    }
    await repo.init();
    assert.deepEqual(await defs(), first, "ré-application idempotente");

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
    const people = [
      [USER.DIRECTOR, schoolA, "RO-DIR", "Admin School", ["SCHOOL_ADMIN"]],
      [USER.SECRETARY, schoolA, "RO-SEC", "Secrétaire", ["SECRETARY"]],
      [USER.TEACHER, schoolA, "RO-ENS", "Enseignant", ["TEACHER"]],
      [USER.TEACHER_FREE, schoolA, "RO-ENF", "Enseignant", ["TEACHER"]],
      [USER.PREFET, schoolA, "RO-PRE", "Préfet des études", ["PREFET_ETUDES"]],
      [USER.SUPERVISOR, schoolA, "RO-SUR", "Surveillant", ["SUPERVISOR"]],
      [USER.PARENT, schoolA, "RO-PAR", "Parent", ["PARENT"]],
      [USER.SUPER, null, "RO-SUP", "Super Administrateur Somafrik", ["SUPER_ADMIN"]],
      [USER.DISABLED, schoolA, "RO-OFF", "Secrétaire", ["SECRETARY"]],
      [USER.TEACHER_DIRECTOR, schoolA, "RO-TDI", "Directeur", ["TEACHER", "PROVISEUR"]],
      [USER.TEACHER_SECRETARY, schoolA, "RO-TSE", "Enseignant", ["TEACHER", "SECRETARY"]],
      [USER.ADMIN_B, schoolB, "RO-ADB", "Admin School", ["SCHOOL_ADMIN"]],
    ];
    await pool.query("ALTER TABLE users DISABLE TRIGGER users_permanent_identity_insert");
    for (const [id, schoolId, code, role] of people) {
      await pool.query(
        `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
         VALUES ($1,$2,$3,'Prenom',$4,$5,$6,'active',FALSE)`,
        [id, schoolId, code, code, `${code.toLowerCase()}@roles.test`, role],
      );
    }
    await pool.query("ALTER TABLE users ENABLE TRIGGER users_permanent_identity_insert");
    for (const [id, schoolId, , , keys] of people) {
      for (const key of keys) {
        await pool.query("INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1,$2,$3,'active')", [id, schoolId, key]);
      }
    }
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
       SELECT id, $2, 'RO-S' || ord, 'Prenom' || ord, 'Nom', 'active' FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ord)`,
      [STUDENTS, schoolA],
    );
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status) VALUES ($1,$3,'RO-OTH','Omar','Autre','active'), ($2,$4,'RO-SB','Ines','Buj','active')`,
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
    const class35 = await klass(schoolA, yearA, "RO-35");
    const classOther = await klass(schoolA, yearA, "RO-OT");
    const classB = await klass(schoolB, yearB, "RO-B1");
    const enroll = (schoolId, studentId, classId, yearId) => pool.query(
      "INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1,$2,$3,$4,'ENROLLED')", [schoolId, studentId, classId, yearId],
    );
    for (const id of STUDENTS) await enroll(schoolA, id, class35, yearA);
    await enroll(schoolA, OTHER_CLASS_STUDENT, classOther, yearA);
    await enroll(schoolB, STUDENT_B, classB, yearB);
    const subjectA = (await pool.query("INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,'MATH','Maths','active') RETURNING id", [schoolA])).rows[0].id;
    const teacherRow = async (userId, code) => (await pool.query(
      "INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,$3,'active') RETURNING id", [schoolA, userId, code],
    )).rows[0].id;
    const teacherA = await teacherRow(USER.TEACHER, "RO-T-A");
    await teacherRow(USER.TEACHER_FREE, "RO-T-F");
    const teacherTD = await teacherRow(USER.TEACHER_DIRECTOR, "RO-T-TD");
    const teacherTS = await teacherRow(USER.TEACHER_SECRETARY, "RO-T-TS");
    const subjectB = (await pool.query("INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,'FRA','Français','active') RETURNING id", [schoolA])).rows[0].id;
    const assign = (teacherId, classId, subjectId = subjectA) => pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status) VALUES ($1,$2,$3,$4,$5,'active')`,
      [schoolA, teacherId, classId, subjectId, yearA],
    );
    await assign(teacherA, class35);
    await assign(teacherTD, classOther); // multirôle : enseignant de l'AUTRE classe uniquement
    await assign(teacherTS, classOther, subjectB);
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
    for (const id of [schoolA, schoolB]) {
      await pool.query("UPDATE schools SET profile_payload = COALESCE(profile_payload, '{}'::jsonb) || jsonb_build_object('timezone', $2::text) WHERE id = $1", [id, zone]);
    }
    const today = wallTime(zone, Date.now()).slice(0, 10);
    const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

    server = await startServer(isolatedUrl, PORT);
    const claimsFor = (id) => {
      const [, schoolId, , role, keys] = people.find((p) => p[0] === id);
      const schoolCode = schoolId === schoolA ? CODE_A : schoolId === schoolB ? CODE_B : LOGIN_A;
      return { sub: id, role, roleKeys: keys, schoolCode, permissions: ["Présences:CREATE", "Présences:UPDATE", "Présences:READ", "Élèves:UPDATE", "Gérer élèves"] };
    };
    const token = {};
    for (const [id] of people) token[id] = await mint(claimsFor(id));

    // Cartes émises par l'API réelle (droits historiques de l'administrateur, avant tout réglage).
    const issue = async (studentId, by) => {
      const issued = await request(PORT, "/student-cards", { method: "POST", token: token[by], body: { studentId, medium: "nfc_qr" } });
      assert.equal(issued.status, 201, JSON.stringify(issued.data));
      const [publicId, secret] = issued.data.cardToken.split(".");
      await pool.query(
        "UPDATE student_access_cards SET nfc_uid = $2, nfc_tag_type = 'NTAG216', nfc_encoding_state = 'encoded', nfc_encoded_at = NOW() WHERE id = $1",
        [issued.data.id, `04${crypto.randomBytes(6).toString("hex").toUpperCase()}`],
      );
      return { id: issued.data.id, publicId, key: deriveCardKeyFromSecret(secret) };
    };
    const cards = [];
    for (const id of STUDENTS) cards.push(await issue(id, USER.DIRECTOR));
    const cardOther = await issue(OTHER_CLASS_STUDENT, USER.DIRECTOR);
    void cardOther;

    // Droits par rôle (module présences). Aucun droit n'est attribué par le code testé.
    // NFC-ROLES-ACCESS-01 : droit dédié « Appel NFC/QR » (module roll_call), seul requis pour l'appel.
    const grant = (roleKey, on) => setRoleModuleGrant(pool, roleKey, "roll_call", { create: on, read: true, update: false });
    for (const key of ["TEACHER", "SCHOOL_ADMIN", "SECRETARY", "PREFET_ETUDES", "PROVISEUR", "SUPERVISOR"]) await grant(key, true);
    // Le Directeur n'a AUCUN droit de consultation des classes ni des élèves : seul le droit d'appel.
    await setRoleModuleGrant(pool, "SCHOOL_ADMIN", "classes", { create: false, read: false, update: false });
    await setRoleModuleGrant(pool, "SCHOOL_ADMIN", "students", { create: false, read: false, update: false });

    const byKey = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
    function makeBody({ actor, date, classId = class35, scanned = [], manual = [], sessionId = crypto.randomUUID(), operationId = crypto.randomUUID() }) {
      const scans = scanned.map((c) => {
        const scanId = crypto.randomUUID();
        return {
          scanId, publicId: c.publicId, medium: "nfc", scannedAt: new Date().toISOString(),
          proof: computeProof(c.key, {
            contractVersion: "rc-offline-1", schoolId: schoolA, actorUserId: actor, classId, date, mode: "teacher", sessionId,
            packId: "", scanId, publicId: c.publicId, medium: "nfc",
          }),
        };
      }).sort(byKey("scanId"));
      const body = {
        contractVersion: "rc-offline-1", operationId, sessionId, revision: 1, schoolId: schoolA, classId, date, mode: "teacher", packId: null,
        complete: false, scans, manual: [...manual].sort(byKey("studentId")),
      };
      return { ...body, payloadDigest: computePayloadDigest(body) };
    }
    const sync = (who, body) => request(PORT, "/student-cards/roll-call/offline/v1/sync", {
      method: "POST", token: token[who], body, headers: { "Idempotency-Key": body.operationId },
    });
    const pack = (who, classId, date = today) => request(PORT, `/student-cards/roll-call/offline/v1/pack?classId=${classId}&date=${date}`, { token: token[who] });
    const statuses = async (date) => (await pool.query(
      "SELECT student_id::text AS s, status, teacher_id::text AS t FROM attendance WHERE school_id = $1 AND attendance_date = $2::date", [schoolA, date],
    )).rows;
    const duplicates = async () => (await pool.query(
      "SELECT count(*)::int AS n FROM (SELECT student_id, attendance_date FROM attendance GROUP BY 1, 2 HAVING count(*) > 1) d",
    )).rows[0].n;
    const journalOf = async (sessionId) => (await pool.query(
      "SELECT mode, teacher_id::text AS teacher_id, author_user_id::text AS author, author_role_keys, source, justification FROM attendance_roll_calls WHERE session_id = $1",
      [sessionId],
    )).rows[0];
    const auditOf = async (rollCallId) => (await pool.query(
      "SELECT user_id::text AS user_id, new_value FROM audit_logs WHERE action = 'student_card_roll_call_offline_sync' AND entity_id = $1", [rollCallId],
    )).rows[0];
    const report = [];
    const refused = (out, label) => {
      assert.ok(out.status === 401 || out.status === 403, `${label} : ${out.status} ${out.text}`);
      assert.equal(out.data?.pack, undefined, label);
      assert.equal(out.data?.rollCallId, undefined, label);
    };

    // ===== Directeur (SCHOOL_ADMIN) : classe sans affectation personnelle, 22 / 35 =====
    const staffScenario = async (who, roleKey, date, label) => {
      const p = await pack(who, class35, date === today ? today : today);
      assert.equal(p.status, 200, `${label} pack : ${p.text}`);
      assert.equal(p.data.pack.actorUserId, who);
      assert.equal(p.data.pack.students.length, 35);
      const body = makeBody({ actor: who, date, scanned: cards.slice(0, 22) });
      const out = await sync(who, body);
      assert.equal(out.status, 201, `${label} sync : ${out.text}`);
      for (const field of ["operationId", "sessionId", "revision", "payloadDigest"]) assert.equal(out.data[field], body[field], `${label} ACK ${field}`);
      assert.equal(out.data.created, 22);
      const rows = await statuses(date);
      assert.equal(rows.length, 22, `${label} : 22 présences, 13 sans ligne`);
      assert.ok(rows.every((r) => r.status === "present" && r.t === null), `${label} : aucun enseignant attribué`);
      const journal = await journalOf(body.sessionId);
      assert.deepEqual(
        { mode: journal.mode, teacher: journal.teacher_id, author: journal.author, source: journal.source, justification: journal.justification },
        { mode: "staff", teacher: null, author: who, source: "offline", justification: null },
        `${label} : journal`,
      );
      assert.ok(journal.author_role_keys.includes(roleKey), `${label} : rôles de l'auteur`);
      assert.ok(!journal.author_role_keys.includes("TEACHER"), `${label} : aucun rôle TEACHER fictif`);
      const audit = await auditOf(out.data.rollCallId);
      assert.equal(audit.user_id, who);
      assert.equal(audit.new_value.authority, "staff");
      assert.equal(audit.new_value.coverage, "partial");
      const replay = await sync(who, body);
      assert.equal(replay.status, 200, `${label} rejeu : ${replay.text}`);
      assert.equal(replay.data.rollCallId, out.data.rollCallId);
      assert.equal((await statuses(date)).length, 22, `${label} : rejeu sans double écriture`);
      assert.equal(await duplicates(), 0);
      report.push(`${label} : pack 35 élèves, 22 présences (teacher_id NULL), 13 sans ligne, journal staff, auteur réel, rejeu idempotent`);
    };
    await staffScenario(USER.DIRECTOR, "SCHOOL_ADMIN", today, "Directeur (SCHOOL_ADMIN)");
    await staffScenario(USER.SECRETARY, "SECRETARY", shift(today, -1), "Secrétaire (SECRETARY)");

    // ===== NFC-ROLES-ACCESS-01 : droit d'appel séparé de la consultation des classes =====
    const get = (who, pathname, headers = {}) => request(PORT, pathname, { token: token[who], headers });
    const classesOf = async (who) => {
      const out = await get(who, "/student-cards/roll-call/offline/v1/classes");
      return out;
    };
    // Cas A : le Directeur n'a aucun droit de consultation des classes ni des élèves…
    refused(await get(USER.DIRECTOR, "/classes"), "directeur : fiche/liste des classes refusée");
    refused(await get(USER.DIRECTOR, "/students"), "directeur : liste des élèves refusée");
    // …mais obtient la liste minimale des classes d'appel de SON établissement (déjà prouvé : pack + sync).
    const dirClasses = await classesOf(USER.DIRECTOR);
    assert.equal(dirClasses.status, 200, dirClasses.text);
    assert.deepEqual(dirClasses.data.classes.map((c) => c.classId).sort(), [class35, classOther].sort(), "toutes les classes actives de A");
    assert.equal(dirClasses.data.authority, "staff");
    assert.deepEqual(Object.keys(dirClasses.data.classes[0]).sort(), ["classCode", "classId", "className", "enrolled"], "données minimales");
    assert.equal(dirClasses.data.classes.find((c) => c.classId === class35).enrolled, 35);
    for (const id of [...STUDENTS, OTHER_CLASS_STUDENT]) assert.equal(dirClasses.text.includes(id), false, "aucun élève dans la liste des classes");
    // Enseignant : uniquement ses classes affectées ; enseignant sans affectation : liste vide.
    const tClasses = await classesOf(USER.TEACHER);
    assert.deepEqual([tClasses.status, tClasses.data.authority, tClasses.data.classes.map((c) => c.classId)], [200, "teacher", [class35]]);
    assert.deepEqual((await classesOf(USER.TEACHER_FREE)).data.classes, []);
    // Enseignant + Proviseur autorisé : tout l'établissement.
    assert.equal((await classesOf(USER.TEACHER_DIRECTOR)).data.classes.length, 2);
    // Autre établissement : jamais les classes de A.
    const bClasses = await classesOf(USER.ADMIN_B);
    assert.equal(bClasses.status, 200, bClasses.text);
    assert.deepEqual(bClasses.data.classes.map((c) => c.classId), [classB]);
    // Réglages carte : lisibles avec le seul droit d'appel (drapeaux, aucune donnée d'élève) ; refusés sinon.
    const caps = await get(USER.DIRECTOR, "/student-cards/capabilities");
    assert.equal(caps.status, 200, `réglages carte, droit d'appel seul : ${caps.text}`);
    for (const id of STUDENTS) assert.equal(caps.text.includes(id), false, "aucun élève dans les réglages carte");
    refused(await get(USER.PARENT, "/student-cards/capabilities"), "parent : réglages carte");
    refused(await get(USER.SUPER, "/student-cards/capabilities", { "X-Somafrik-School-Code": LOGIN_A }), "superadmin : réglages carte");
    refused(await classesOf(USER.PARENT), "parent : classes d'appel");
    refused(await get(USER.SUPER, "/student-cards/roll-call/offline/v1/classes", { "X-Somafrik-School-Code": LOGIN_A }), "superadmin : classes d'appel");
    // Cas D : droit Présences sans droit d'appel → aucun appel, même en appelant l'API directement.
    await setRoleModuleGrant(pool, "PREFET_ETUDES", "attendance", { create: true, read: true, update: true });
    await grant("PREFET_ETUDES", false);
    refused(await classesOf(USER.PREFET), "préfet sans droit d'appel : classes");
    refused(await pack(USER.PREFET, class35), "préfet sans droit d'appel : pack");
    refused(await sync(USER.PREFET, makeBody({ actor: USER.PREFET, date: shift(today, -3), scanned: cards.slice(0, 2) })), "préfet sans droit d'appel : sync");
    await grant("PREFET_ETUDES", true);
    report.push("Droit dédié : directeur sans accès Classes/Élèves effectue l'appel ; liste des classes minimale par périmètre (staff, enseignant, autre établissement) ; droit Présences seul → refus");

    // ===== Enseignant affecté : parcours historique, attribution à l'enseignant =====
    assert.equal((await pack(USER.TEACHER, class35)).status, 200);
    const tBody = makeBody({ actor: USER.TEACHER, date: shift(today, -2), scanned: cards.slice(0, 5) });
    const tOut = await sync(USER.TEACHER, tBody);
    assert.equal(tOut.status, 201, tOut.text);
    const tJournal = await journalOf(tBody.sessionId);
    assert.deepEqual([tJournal.mode, tJournal.teacher_id], ["teacher", teacherA]);
    assert.ok((await statuses(shift(today, -2))).every((r) => r.t === teacherA), "présences attribuées à l'enseignant affecté");
    report.push("Enseignant affecté : journal teacher, présences attribuées à l'enseignant");

    // ===== Refus =====
    const freePack = await pack(USER.TEACHER_FREE, class35);
    assert.equal(freePack.data?.code, "ROLL_CALL_CLASS_FORBIDDEN", "enseignant non affecté : pack");
    const freeSync = await sync(USER.TEACHER_FREE, makeBody({ actor: USER.TEACHER_FREE, date: shift(today, -3), scanned: cards.slice(0, 2) }));
    assert.equal(freeSync.data?.code, "ROLL_CALL_CLASS_FORBIDDEN", "enseignant non affecté : sync");
    assert.equal(freeSync.data?.sessionState, "not_recorded");
    // Autre rôle scolaire : autorisé SEULEMENT avec le droit explicite (périmètre établissement).
    assert.equal((await pack(USER.SUPERVISOR, class35)).status, 200, "surveillant explicitement autorisé");
    await grant("SUPERVISOR", false);
    refused(await pack(USER.SUPERVISOR, class35), "surveillant sans droit : pack");
    refused(await sync(USER.SUPERVISOR, makeBody({ actor: USER.SUPERVISOR, date: shift(today, -3), scanned: cards.slice(0, 2) })), "surveillant sans droit : sync");
    refused(await pack(USER.PARENT, class35), "parent : pack");
    refused(await sync(USER.PARENT, makeBody({ actor: USER.PARENT, date: shift(today, -3), scanned: cards.slice(0, 2) })), "parent : sync");
    const superPack = await request(PORT, `/student-cards/roll-call/offline/v1/pack?classId=${class35}&date=${today}`, { token: token[USER.SUPER], headers: { "X-Somafrik-School-Code": LOGIN_A } });
    refused(superPack, "superadmin : pack");
    refused(await sync(USER.SUPER, makeBody({ actor: USER.SUPER, date: shift(today, -3), scanned: cards.slice(0, 2) })), "superadmin : sync");
    const crossPack = await pack(USER.DIRECTOR, classB);
    assert.equal(crossPack.data?.code, "ROLL_CALL_CLASS_FORBIDDEN", "classe d'un autre établissement");
    const crossSync = await sync(USER.ADMIN_B, makeBody({ actor: USER.ADMIN_B, date: shift(today, -3), scanned: cards.slice(0, 2) }));
    assert.equal(crossSync.data?.code, "ROLL_CALL_REPLAY_FORBIDDEN", "lot de l'établissement A envoyé par B");
    // Préfet des études autorisé : accepté (périmètre établissement, comme l'appel de direction existant).
    assert.equal((await pack(USER.PREFET, class35)).status, 200, "préfet autorisé");
    // Compte désactivé.
    await pool.query("UPDATE users SET status = 'inactive' WHERE id = $1", [USER.DISABLED]);
    refused(await pack(USER.DISABLED, class35), "compte désactivé : pack");
    refused(await sync(USER.DISABLED, makeBody({ actor: USER.DISABLED, date: shift(today, -3), scanned: cards.slice(0, 2) })), "compte désactivé : sync");
    report.push("Refus : enseignant non affecté, surveillant, parent, superadmin, autre établissement, compte désactivé (pack et sync)");

    // ===== Multirôles =====
    // Enseignant + Proviseur : sa classe → autorité enseignant ; autre classe → autorité responsable.
    const tdOwn = makeBody({ actor: USER.TEACHER_DIRECTOR, date: shift(today, -3), classId: classOther, scanned: [] , manual: [{ studentId: OTHER_CLASS_STUDENT, status: "present" }] });
    const tdOwnOut = await sync(USER.TEACHER_DIRECTOR, tdOwn);
    assert.equal(tdOwnOut.status, 201, tdOwnOut.text);
    assert.deepEqual([(await journalOf(tdOwn.sessionId)).mode, (await journalOf(tdOwn.sessionId)).teacher_id], ["teacher", teacherTD]);
    const tdOther = makeBody({ actor: USER.TEACHER_DIRECTOR, date: shift(today, -3), scanned: cards.slice(0, 3) });
    const tdOtherOut = await sync(USER.TEACHER_DIRECTOR, tdOther);
    assert.equal(tdOtherOut.status, 201, tdOtherOut.text);
    assert.deepEqual([(await journalOf(tdOther.sessionId)).mode, (await journalOf(tdOther.sessionId)).teacher_id], ["staff", null]);
    report.push("Enseignant + Proviseur : sa classe en autorité enseignant, autre classe en autorité responsable");

    // ===== Révocation entre le pack et la synchronisation =====
    const secretaryPack = await pack(USER.SECRETARY, class35, today);
    assert.equal(secretaryPack.status, 200);
    await grant("SECRETARY", false);
    const revoked = await sync(USER.SECRETARY, makeBody({ actor: USER.SECRETARY, date: shift(today, -2), scanned: cards.slice(30, 35) }));
    refused(revoked, "secrétaire : droit retiré après le pack");
    // Enseignant + Secrétaire dont le rôle secrétaire n'accorde plus rien : aucun élargissement implicite.
    const tsOther = await sync(USER.TEACHER_SECRETARY, makeBody({ actor: USER.TEACHER_SECRETARY, date: shift(today, -2), scanned: cards.slice(30, 35) }));
    assert.equal(tsOther.data?.code, "ROLL_CALL_CLASS_FORBIDDEN", `enseignant + secrétaire sans droit : ${tsOther.text}`);
    assert.equal((await pack(USER.TEACHER_SECRETARY, classOther)).status, 200, "sa propre classe reste accessible");
    // Rôle supprimé (révoqué en base) pendant la session.
    await grant("SECRETARY", true);
    await pool.query("UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1 AND role_key = 'SECRETARY'", [USER.SECRETARY]);
    refused(await sync(USER.SECRETARY, makeBody({ actor: USER.SECRETARY, date: shift(today, -2), scanned: cards.slice(30, 35) })), "secrétaire : rôle révoqué");
    // Directeur sans permission.
    await grant("SCHOOL_ADMIN", false);
    refused(await pack(USER.DIRECTOR, class35), "directeur sans permission : pack");
    refused(await sync(USER.DIRECTOR, makeBody({ actor: USER.DIRECTOR, date: shift(today, -2), scanned: cards.slice(30, 35) })), "directeur sans permission : sync");
    assert.ok((await statuses(shift(today, -2))).every((r) => !STUDENTS.slice(30, 35).includes(r.s)), "aucune présence écrite par un refus");
    assert.equal(await duplicates(), 0);
    report.push("Révocations : droit retiré entre pack et sync, rôle révoqué, directeur sans droit → refus ; enseignant + secrétaire sans droit : pas d'élargissement");

    // ===== Droits propres à l'établissement (override school) : principal HTTP exact =====
    await pool.query("UPDATE user_roles SET status = 'active', revoked_at = NULL WHERE user_id = $1 AND role_key = 'SECRETARY'", [USER.SECRETARY]);
    const schoolGrant = async (roleKey, schoolId, on) => {
      await pool.query(
        `UPDATE role_module_permissions SET status = 'archived', updated_at = NOW()
          WHERE upper(role_key) = upper($1) AND scope_type = 'school' AND school_id = $2 AND module_key = 'roll_call' AND status = 'active'`,
        [roleKey, schoolId],
      );
      await pool.query(
        `INSERT INTO role_module_permissions (role_key, scope_type, school_id, module_key, can_create, can_read, can_update, can_delete, updated_by)
         VALUES ($1, 'school', $2, 'roll_call', $3, TRUE, FALSE, FALSE, 'nfc-roles-access-01')`,
        [roleKey, schoolId, on],
      );
    };
    // Global refusé, établissement A accordé → autorisé dans A ; l'établissement B reste refusé.
    await grant("SCHOOL_ADMIN", false);
    await schoolGrant("SCHOOL_ADMIN", schoolA, true);
    assert.equal((await pack(USER.DIRECTOR, class35)).status, 200, "override établissement accordé : directeur A");
    refused(await pack(USER.ADMIN_B, classB), "override limité à A : directeur B refusé");
    // Global accordé, établissement A refusé → refus (l'override d'établissement prime).
    await grant("SECRETARY", true);
    await schoolGrant("SECRETARY", schoolA, false);
    refused(await pack(USER.SECRETARY, class35), "override établissement refusé : secrétaire A");
    // Enseignant + Secrétaire : TEACHER accordé, SECRETARY refusé dans A → aucune union vers tout l'établissement.
    const tsUnion = await pack(USER.TEACHER_SECRETARY, class35);
    assert.equal(tsUnion.data?.code, "ROLL_CALL_CLASS_FORBIDDEN", `union TEACHER refusée : ${tsUnion.text}`);
    assert.equal((await pack(USER.TEACHER_SECRETARY, classOther)).status, 200, "sa classe d'enseignant reste accessible");
    await schoolGrant("SECRETARY", schoolA, true);
    assert.equal((await pack(USER.SECRETARY, class35)).status, 200, "override établissement réaccordé");
    report.push("Override d'établissement : accordé en A seulement (B refusé), refusé en A malgré le global, aucune union via TEACHER");

    // ===== Écriture « staff » : création, correction d'absence, statuts protégés =====
    const dayW = today;
    const preset = [[22, "absent"], [23, "excused"], [24, "late"], [25, "present"]];
    for (const [i, status] of preset) {
      await pool.query(
        "INSERT INTO attendance (school_id, student_id, class_id, teacher_id, attendance_date, status) VALUES ($1,$2,$3,$4,$5::date,$6)",
        [schoolA, STUDENTS[i], class35, teacherA, dayW, status],
      );
    }
    const wBody = makeBody({
      actor: USER.DIRECTOR, date: dayW, scanned: cards.slice(22, 27),
      manual: [{ studentId: STUDENTS[25], status: "absent" }, { studentId: STUDENTS[23], status: "late" }],
    });
    const wOut = await sync(USER.DIRECTOR, wBody);
    assert.equal(wOut.status, 201, wOut.text);
    assert.deepEqual(
      [wOut.data.created, wOut.data.corrected, wOut.data.unchanged, wOut.data.protected],
      [1, 1, 1, 2],
      "S26 créé, S22 absent→présent, S24 retard inchangé, S23 justifié et S25 présent protégés",
    );
    const after = Object.fromEntries((await statuses(dayW)).map((r) => [r.s, r]));
    assert.deepEqual(
      [22, 23, 24, 25, 26].map((i) => after[STUDENTS[i]].status),
      ["present", "excused", "late", "present", "present"],
    );
    assert.equal(after[STUDENTS[22]].t, teacherA, "correction : enseignant d'origine conservé, jamais effacé");
    assert.equal(after[STUDENTS[26]].t, null, "création staff : aucun enseignant attribué");
    const wReplay = await sync(USER.DIRECTOR, wBody);
    assert.equal(wReplay.status, 200);
    assert.equal(wReplay.data.rollCallId, wOut.data.rollCallId, "rejeu : même ACK");
    assert.deepEqual(Object.fromEntries((await statuses(dayW)).map((r) => [r.s, r.status])), Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.status])), "rejeu sans écriture");
    report.push("Écriture staff : création, correction absent→présent (enseignant conservé), Justifié/Retard/Présent préservés, rejeu sans écriture");

    // ===== Annulation de transaction : échec après les écritures → rien n'est conservé =====
    const failingSession = crypto.randomUUID();
    await pool.query(`
      CREATE OR REPLACE FUNCTION nfc_roles_test_fail() RETURNS trigger AS $f$
      BEGIN
        IF NEW.session_id = '${failingSession}'::uuid THEN RAISE EXCEPTION 'échec simulé après écriture'; END IF;
        RETURN NEW;
      END $f$ LANGUAGE plpgsql;
      CREATE TRIGGER nfc_roles_test_fail BEFORE INSERT ON attendance_roll_calls FOR EACH ROW EXECUTE FUNCTION nfc_roles_test_fail();
    `);
    const failOut = await sync(USER.DIRECTOR, makeBody({ actor: USER.DIRECTOR, date: dayW, sessionId: failingSession, scanned: cards.slice(27, 30) }));
    assert.ok(failOut.status >= 500, `échec simulé : ${failOut.status} ${failOut.text}`);
    await pool.query("DROP TRIGGER nfc_roles_test_fail ON attendance_roll_calls; DROP FUNCTION nfc_roles_test_fail()");
    const kept = (await statuses(dayW)).map((r) => r.s);
    assert.ok(STUDENTS.slice(27, 30).every((id) => !kept.includes(id)), "ROLLBACK : aucune présence conservée");
    assert.equal(await journalOf(failingSession), undefined, "ROLLBACK : aucun journal");
    report.push("Échec après écriture (journal) : transaction annulée, aucune présence ni journal");

    // ===== Écritures concurrentes : deux responsables, mêmes élèves, sessions différentes =====
    const c1 = makeBody({ actor: USER.DIRECTOR, date: dayW, scanned: cards.slice(30, 35) });
    const c2 = makeBody({ actor: USER.PREFET, date: dayW, scanned: cards.slice(30, 35) });
    const [o1, o2] = await Promise.all([sync(USER.DIRECTOR, c1), sync(USER.PREFET, c2)]);
    assert.equal(o1.status, 201, o1.text);
    assert.equal(o2.status, 201, o2.text);
    assert.equal(o1.data.created + o2.data.created, 5, "chaque élève créé une seule fois");
    assert.equal(o1.data.unchanged + o2.data.unchanged, 5, "l'autre appel constate la présence existante");
    assert.equal(await duplicates(), 0, "aucun doublon sous concurrence");
    report.push("Concurrence : deux appels staff simultanés sur les mêmes élèves → 5 créations au total, 5 inchangés, aucun doublon");

    // ===== Migration : ancien schéma, lignes historiques, puis migration rejouée =====
    const legacySession = crypto.randomUUID();
    await pool.query(
      `INSERT INTO attendance_roll_calls (school_id, class_id, roll_call_date, session_id, mode, author_user_id, author_role_keys, teacher_id, justification)
       VALUES ($1,$2,$3::date,$4,'direction',$5,ARRAY['SCHOOL_ADMIN'],NULL,'Appel exceptionnel historique de test')`,
      [schoolA, class35, shift(today, -3), legacySession, USER.DIRECTOR],
    );
    const before = (await pool.query("SELECT id, mode, source, teacher_id, ack_body FROM attendance_roll_calls ORDER BY id")).rows;
    // Rétablit les contraintes d'origine (sans « staff ») sur une table contenant déjà des lignes staff : refus attendu.
    await pool.query("DELETE FROM attendance_roll_calls WHERE mode = 'staff'");
    const legacyOnly = (await pool.query("SELECT id, mode, source, teacher_id, ack_body FROM attendance_roll_calls ORDER BY id")).rows;
    await pool.query(`
      ALTER TABLE attendance_roll_calls DROP CONSTRAINT attendance_roll_calls_mode_check;
      ALTER TABLE attendance_roll_calls ADD CONSTRAINT attendance_roll_calls_mode_check CHECK (mode IN ('teacher', 'direction'));
      ALTER TABLE attendance_roll_calls DROP CONSTRAINT attendance_roll_calls_mode_shape_check;
      ALTER TABLE attendance_roll_calls ADD CONSTRAINT attendance_roll_calls_mode_shape_check CHECK (
        (mode = 'teacher' AND teacher_id IS NOT NULL AND justification IS NULL)
        OR (mode = 'direction' AND teacher_id IS NULL AND justification IS NOT NULL));
    `);
    const staffRow = [schoolA, class35, shift(today, -3), crypto.randomUUID(), USER.DIRECTOR];
    const insertStaff = () => pool.query(
      `INSERT INTO attendance_roll_calls (school_id, class_id, roll_call_date, session_id, mode, author_user_id, author_role_keys, teacher_id,
         justification, source, operation_id, payload_digest, ack_body)
       VALUES ($1,$2,$3::date,$4,'staff',$5,ARRAY['SCHOOL_ADMIN'],NULL,NULL,'offline',gen_random_uuid(),repeat('a',64),'{}'::jsonb)`,
      staffRow,
    );
    await assert.rejects(insertStaff(), /attendance_roll_calls_mode_check|violates check constraint/, "sans migration, le mode staff est rejeté");
    const fs = require("node:fs");
    const migration = fs.readFileSync(path.join(__dirname, "../db/migrations/20261110_attendance_roll_calls_staff_mode.sql"), "utf8");
    await pool.query(migration);
    const once = await defs();
    await pool.query(migration); // rejouée
    assert.deepEqual(await defs(), once, "migration rejouée : définitions identiques");
    assert.deepEqual(
      (await pool.query("SELECT id, mode, source, teacher_id, ack_body FROM attendance_roll_calls ORDER BY id")).rows,
      legacyOnly,
      "lignes historiques (teacher en ligne et hors ligne, direction) intactes",
    );
    await insertStaff();
    assert.ok(before.length > legacyOnly.length, "des lignes staff existaient avant la remise à l'ancien schéma");
    report.push("Migration : staff rejeté sur l'ancien schéma, accepté après migration, rejouable, lignes historiques intactes");

    for (const line of report) console.log(`  ✔ ${line}`);
    console.log("rollCallRoles.http.pg.test.js OK");
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
