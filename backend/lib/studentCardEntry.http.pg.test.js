"use strict";

/**
 * CARTE-PR3-A1 — contrôle d'entrée au portail, de bout en bout (HTTP + PostgreSQL isolé).
 * Invariants : portail ≠ présence en classe ; un doublon ne crée pas un second événement ;
 * rôles et permission dédiée relus en base (fail-closed) ; impayés informatifs et non bloquants.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { ENTRY_ERROR } = require("./studentCardEntry");
const { mintSessionAccessToken } = require("./testAccessSession");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_ENTRY_IT_DATABASE ?? "somafrik_student_card_entry_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_ENTRY_HTTP_PORT ?? 19893);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const CODE_A = "CD-2026-0001";
const CODE_B = "BI-2026-0001";
const U = (n) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, "0")}`;
const USERS = {
  ADMIN: U(1), DIRECTOR: U(2), SECRETARY: U(3), SUPERVISOR: U(4), TEACHER: U(5), PROVISEUR_NO_GRANT: U(6),
  PARENT: U(7), SUPER: U(8), PAYS: U(9), DIRECTOR_B: U(10), SECRETARY_TEACHER: U(11), STALE: U(12),
};
const S = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`S${n}`, U(100 + n)]));
const STUDENT_B = U(199);
const ENTRY_ROUTE = "/student-cards/entry-scan";

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

async function setGrant(pool, roleKey, moduleKey, flags) {
  await pool.query(
    `DELETE FROM role_module_permissions WHERE upper(role_key) = upper($1) AND module_key = $2 AND scope_type = 'global'`,
    [roleKey, moduleKey],
  );
  await pool.query(
    `INSERT INTO role_module_permissions (role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by)
     VALUES ($1, 'global', $2, $3, $4, FALSE, FALSE, 'carte-pr3-a1')`,
    [roleKey, moduleKey, Boolean(flags.create), Boolean(flags.read)],
  );
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentCardEntry.http.pg.test.js SKIP (DATABASE_URL absent)");
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
  let child = null;
  try {
    await repo.init();
    // Schéma : table dédiée, aucune modification de `attendance`.
    const columns = (await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'school_entry_events' ORDER BY column_name`,
    )).rows.map((row) => row.column_name);
    for (const forbidden of ["token", "token_hash", "nfc_uid", "card_token"]) {
      assert.equal(columns.includes(forbidden), false, `aucune colonne sensible ${forbidden}`);
    }
    const dailyIndex = (await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_school_entry_events_daily_entry'`,
    )).rows[0];
    assert.match(dailyIndex.indexdef, /UNIQUE INDEX .*\(school_id, student_id, local_date\) WHERE \(event_type = 'entry'/);

    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    await setLoginCodeTriggers(pool, false);
    const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
    const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
    const schoolA = (await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status, profile_payload)
       VALUES ($1,$2,$3,'LAC','Lycée Lac','active', '{"timezone":"Africa/Kinshasa"}'::jsonb) RETURNING id`,
      [cd.id, CODE_A, LOGIN_A],
    )).rows[0];
    const schoolB = (await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status, profile_payload)
       VALUES ($1,$2,$3,'BUJ','Lycée Buj','active', '{"timezone":"Africa/Bujumbura"}'::jsonb) RETURNING id`,
      [bi.id, CODE_B, LOGIN_B],
    )).rows[0];
    await setLoginCodeTriggers(pool, true);

    await pool.query(`ALTER TABLE users DISABLE TRIGGER users_permanent_identity_insert`);
    const userRows = [
      [USERS.ADMIN, schoolA.id, "ADM-A", "Admin School", ["SCHOOL_ADMIN"]],
      [USERS.DIRECTOR, schoolA.id, "DIR-A", "Directeur", ["PRINCIPAL"]],
      [USERS.SECRETARY, schoolA.id, "SEC-A", "Secrétaire", ["SECRETARY"]],
      [USERS.SUPERVISOR, schoolA.id, "SUR-A", "Surveillant", ["SUPERVISOR"]],
      [USERS.TEACHER, schoolA.id, "ENS-A", "Enseignant", ["TEACHER"]],
      [USERS.PROVISEUR_NO_GRANT, schoolA.id, "PRV-A", "Proviseur", ["PROVISEUR"]],
      [USERS.PARENT, schoolA.id, "PAR-A", "Parent", ["PARENT"]],
      [USERS.SUPER, null, "SUPER", "Super Administrateur Somafrik", ["SUPER_ADMIN"]],
      [USERS.PAYS, null, "PAYS", "Admin Pays", ["COUNTRY_ADMIN"]],
      [USERS.DIRECTOR_B, schoolB.id, "DIR-B", "Directeur", ["PRINCIPAL"]],
      [USERS.SECRETARY_TEACHER, schoolA.id, "SET-A", "Secrétaire", ["SECRETARY", "TEACHER"]],
      [USERS.STALE, schoolA.id, "STA-A", "Enseignant", ["TEACHER"]],
    ];
    for (const [id, schoolId, code, role, roleKeys] of userRows) {
      await pool.query(
        `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
         VALUES ($1,$2,$3,'Prénom',$6,$4,$5,'active', FALSE)`,
        [id, schoolId, code, `${code.toLowerCase()}@entry.test`, role, code],
      );
      for (const roleKey of roleKeys) {
        await pool.query(
          `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1,$2,$3,'active') ON CONFLICT DO NOTHING`,
          [id, schoolId, roleKey],
        );
      }
    }
    await pool.query(`ALTER TABLE users ENABLE TRIGGER users_permanent_identity_insert`);

    // Permission dédiée : accordée explicitement, jamais implicite. L'enseignant la reçoit pour prouver
    // qu'un rôle non admissible reste refusé ; le surveillant et Admin School la reçoivent plus loin.
    const defaults = await pool.query(`SELECT count(*)::int AS n FROM role_module_permissions WHERE module_key = 'entry_control'`);
    assert.equal(defaults.rows[0].n, 0, "aucun droit par défaut sur le module Contrôle d'entrée");
    await setGrant(pool, "PRINCIPAL", "entry_control", { create: true, read: true });
    await setGrant(pool, "SECRETARY", "entry_control", { create: true, read: true });
    await setGrant(pool, "SCHOOL_ADMIN", "entry_control", { create: false, read: true });
    await setGrant(pool, "TEACHER", "entry_control", { create: true, read: true });

    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
       VALUES ($1,$6,'EN-S1','Amina','Kabila','active'), ($2,$6,'EN-S2','Bao','Lutete','active'),
              ($3,$6,'EN-S3','Cyn','Mbuyi','active'), ($4,$6,'EN-S4','Dan','Ngoy','active'),
              ($5,$6,'EN-S5','Eli','Ombe','active'), ($7,$8,'EN-SB','Ines','Tshala','active'),
              ($9,$6,'EN-S6','Fey','Pemba','active'), ($10,$6,'EN-S7','Gad','Ruhi','active')`,
      [S.S1, S.S2, S.S3, S.S4, S.S5, schoolA.id, STUDENT_B, schoolB.id, S.S6, S.S7],
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
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,'EN-A1','2e A','active') RETURNING id`,
      [schoolA.id, yearA.id],
    )).rows[0];
    const classA2 = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,'EN-A2','2e B','active') RETURNING id`,
      [schoolA.id, yearA.id],
    )).rows[0];
    const classB1 = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,'EN-B1','2e Buj','active') RETURNING id`,
      [schoolB.id, yearB.id],
    )).rows[0];
    // Statuts d'inscription canonique et historique (« active » = inscrit).
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1,$2,$6,$7,'ENROLLED'), ($1,$3,$6,$7,'active'), ($1,$4,$6,$7,'ENROLLED'),
              ($1,$5,$8,$7,'ENROLLED'), ($9,$10,$11,$12,'ENROLLED'), ($1,$13,$6,$7,'ENROLLED'), ($1,$14,$6,$7,'ENROLLED')`,
      [schoolA.id, S.S1, S.S2, S.S3, S.S4, classA1.id, yearA.id, classA2.id, schoolB.id, STUDENT_B, classB1.id, yearB.id,
        S.S6, S.S7],
    );
    await pool.query(
      `INSERT INTO school_settings (school_id, student_card_enabled, student_card_qr_enabled, student_card_attendance_enabled,
                                    student_card_finance_check_enabled)
       VALUES ($1, TRUE, TRUE, TRUE, TRUE), ($2, TRUE, TRUE, TRUE, FALSE)
       ON CONFLICT (school_id) DO UPDATE SET student_card_enabled = TRUE, student_card_qr_enabled = TRUE,
         student_card_attendance_enabled = TRUE, student_card_finance_check_enabled = EXCLUDED.student_card_finance_check_enabled`,
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
    // Finance (après le seed des droits par défaut au démarrage) : la direction n'a ici aucun droit
    // finance (impayés absents) ; le secrétariat lit les paiements.
    await pool.query(
      `DELETE FROM role_module_permissions WHERE module_key IN ('payments', 'fees', 'unpaid')
         AND upper(role_key) IN ('PRINCIPAL', 'SECRETARY', 'TEACHER')`,
    );
    await setGrant(pool, "SECRETARY", "payments", { create: false, read: true });

    const ENTRY = ["Contrôle d'entrée:CREATE", "Contrôle d'entrée:READ"];
    const token = {
      admin: await mint({ sub: USERS.ADMIN, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: CODE_A,
        permissions: ["Élèves:UPDATE", "Gérer élèves", ...ENTRY] }),
      director: await mint({ sub: USERS.DIRECTOR, role: "Directeur", roleKeys: ["PRINCIPAL"], schoolCode: CODE_A, permissions: ENTRY }),
      secretary: await mint({ sub: USERS.SECRETARY, role: "Secrétaire", roleKeys: ["SECRETARY"], schoolCode: CODE_A, permissions: ENTRY }),
      supervisor: await mint({ sub: USERS.SUPERVISOR, role: "Surveillant", roleKeys: ["SUPERVISOR"], schoolCode: CODE_A, permissions: ENTRY }),
      teacher: await mint({ sub: USERS.TEACHER, role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: CODE_A, permissions: ENTRY }),
      proviseurNoGrant: await mint({ sub: USERS.PROVISEUR_NO_GRANT, role: "Proviseur", roleKeys: ["PROVISEUR"], schoolCode: CODE_A,
        permissions: ENTRY }),
      parent: await mint({ sub: USERS.PARENT, role: "Parent", roleKeys: ["PARENT"], schoolCode: CODE_A, permissions: ENTRY }),
      superAdmin: await mint({ sub: USERS.SUPER, role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], schoolCode: LOGIN_A,
        permissions: ["ALL_PRIVILEGES", ...ENTRY] }),
      pays: await mint({ sub: USERS.PAYS, role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"], schoolCode: LOGIN_A, countryCode: "CD",
        permissions: ["COUNTRY_PRIVILEGES", ...ENTRY] }),
      directorB: await mint({ sub: USERS.DIRECTOR_B, role: "Directeur", roleKeys: ["PRINCIPAL"], schoolCode: CODE_B, permissions: ENTRY }),
      secretaryTeacher: await mint({ sub: USERS.SECRETARY_TEACHER, role: "Secrétaire", roleKeys: ["SECRETARY", "TEACHER"],
        schoolCode: CODE_A, permissions: ENTRY }),
      // JWT signé mais périmé : PRINCIPAL dans le jeton, TEACHER seul en base.
      stale: await mint({ sub: USERS.STALE, role: "Directeur", roleKeys: ["PRINCIPAL"], schoolCode: CODE_A, permissions: ENTRY }),
    };
    const adminB = await mint({ sub: USERS.DIRECTOR_B, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: CODE_B,
      permissions: ["Élèves:UPDATE", "Gérer élèves"] });
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1,$2,'SCHOOL_ADMIN','active') ON CONFLICT DO NOTHING`,
      [USERS.DIRECTOR_B, schoolB.id],
    );

    const issue = async (studentId, issuer = token.admin) => {
      const issued = await request("/student-cards", { method: "POST", token: issuer, body: { studentId, medium: "qr" } });
      assert.equal(issued.status, 201, JSON.stringify(issued.data));
      return { id: issued.data.id, cardToken: issued.data.cardToken };
    };
    const cards = {};
    for (const key of ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]) cards[key] = await issue(S[key]);
    const cardB = await issue(STUDENT_B, adminB);
    await pool.query(`UPDATE student_access_cards SET status = 'issued' WHERE id = $1`, [cards.S4.id]);
    assert.equal((await request(`/student-cards/${cards.S5.id}/revoke`, { method: "POST", token: token.admin, body: {} })).status, 200);

    const op = () => crypto.randomUUID();
    const enter = (tok, body, key = body.operationId, headers = {}) =>
      request(ENTRY_ROUTE, { method: "POST", token: tok, body, headers: key === null ? headers : { "Idempotency-Key": key, ...headers } });
    const scanBody = (card, extra = {}) => ({ cardToken: card.cardToken, medium: "qr", operationId: op(), ...extra });
    const entryCount = async () => Number((await pool.query(`SELECT count(*)::int AS n FROM school_entry_events`)).rows[0].n);
    const attendanceCount = async () => Number((await pool.query(`SELECT count(*)::int AS n FROM attendance`)).rows[0].n);

    // ---------- Refus de rôle et de permission (aucun événement écrit) ----------
    for (const [label, tok, expected] of [
      ["surveillant sans droit accordé (aucun accès implicite)", token.supervisor, null],
      ["enseignant (permission accordée, rôle non admissible)", token.teacher, ENTRY_ERROR.ROLE_FORBIDDEN],
      ["parent", token.parent, null],
      ["libellé « Directeur » et clé PRINCIPAL dans le JWT, TEACHER seul en base", token.stale, ENTRY_ERROR.ROLE_FORBIDDEN],
    ]) {
      const denied = await enter(tok, scanBody(cards.S1));
      assert.equal(denied.status, 403, `${label}: ${JSON.stringify(denied.data)}`);
      if (expected) assert.equal(denied.data?.code, expected, label);
    }
    assert.equal((await enter(token.proviseurNoGrant, scanBody(cards.S1))).status, 403, "direction sans permission dédiée");
    assert.equal((await enter(token.admin, scanBody(cards.S1))).status, 403, "Admin School sans droit de saisie");
    for (const [tok, headers] of [[token.superAdmin, { "X-Somafrik-School-Code": LOGIN_A }], [token.pays, {}]]) {
      const denied = await enter(tok, scanBody(cards.S1), undefined, headers);
      assert.equal(denied.data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    }
    assert.equal((await enter(token.director, scanBody(cards.S1, { medium: "bluetooth" }))).data?.code, ENTRY_ERROR.INPUT_INVALID);
    assert.equal((await enter(token.director, scanBody(cards.S1), op())).data?.code, ENTRY_ERROR.INPUT_INVALID,
      "Idempotency-Key différente de l'identifiant d'opération");
    assert.equal(await entryCount(), 0, "aucun refus n'écrit d'événement");

    // ---------- Refus de carte ----------
    assert.equal((await enter(token.director, scanBody(cards.S4))).status, 409, "carte en attente d'encodage");
    assert.equal((await enter(token.director, scanBody(cards.S5))).status, 409, "carte révoquée");
    assert.equal((await enter(token.director, scanBody(cardB))).status, 404, "carte d'un autre établissement");
    assert.equal((await enter(token.director, scanBody({ cardToken: "sk1.inconnue.secret" }))).status >= 400, true);
    assert.equal(await entryCount(), 0);

    // ---------- Entrée, doublon et rejeu ----------
    const first = scanBody(cards.S1);
    const entered = await enter(token.director, first);
    assert.equal(entered.status, 201, JSON.stringify(entered.data));
    assert.equal(entered.cacheControl, "no-store");
    assert.equal(entered.data.status, "entered");
    assert.equal(entered.data.class.id, classA1.id, "classe résolue côté serveur");
    assert.equal(entered.data.student.id, S.S1);
    assert.equal("finance" in entered.data, false, "pas d'impayés sans permission finance");
    const replay = await enter(token.director, first);
    assert.equal(replay.data.idempotentReplay, true, "rejeu de la même opération");
    assert.equal((await enter(token.director, { ...first, cardToken: cards.S2.cardToken })).status, 409,
      "même opération, autre contenu");
    const duplicate = await enter(token.secretary, scanBody(cards.S1));
    assert.equal(duplicate.status, 200, JSON.stringify(duplicate.data));
    assert.equal(duplicate.data.status, "already_entered");
    assert.equal(duplicate.data.entry.id, entered.data.entry.id, "doublon : même événement");
    assert.equal(await entryCount(), 1, "un doublon NFC/QR ne crée pas de second événement");

    // ---------- Impayés : informatifs et non bloquants ----------
    const withFinance = await enter(token.secretary, scanBody(cards.S2));
    assert.equal(withFinance.status, 201, JSON.stringify(withFinance.data));
    assert.ok(withFinance.data.finance && typeof withFinance.data.finance === "object", "impayés renvoyés avec la permission");
    const multiRole = await enter(token.secretaryTeacher, scanBody(cards.S3));
    assert.equal(multiRole.status, 201, "multi-rôle Secrétaire + Enseignant autorisé par la clé SECRETARY");

    // ---------- Surveillant et Admin School : accès seulement sur droit effectif explicite ----------
    await setGrant(pool, "SUPERVISOR", "entry_control", { create: true, read: true });
    const bySupervisor = await enter(token.supervisor, scanBody(cards.S6));
    assert.equal(bySupervisor.status, 201, `surveillant avec droit de saisie : ${JSON.stringify(bySupervisor.data)}`);
    await setGrant(pool, "SCHOOL_ADMIN", "entry_control", { create: true, read: true });
    const byAdmin = await enter(token.admin, scanBody(cards.S7));
    assert.equal(byAdmin.status, 201, `Admin School avec droit de saisie : ${JSON.stringify(byAdmin.data)}`);
    await setGrant(pool, "SCHOOL_ADMIN", "entry_control", { create: false, read: true });
    // Révocation du droit : refus dès la requête suivante, sans reconnexion.
    await setGrant(pool, "SUPERVISOR", "entry_control", { create: false, read: true });
    const revokedRight = await enter(token.supervisor, scanBody(cards.S1));
    assert.equal(revokedRight.status, 403, `droit de saisie retiré : ${JSON.stringify(revokedRight.data)}`);
    assert.equal((await enter(token.admin, scanBody(cards.S1))).status, 403, "Admin School : droit de saisie retiré");

    // ---------- Portail ≠ présence en classe ----------
    assert.equal(await attendanceCount(), 0, "aucune ligne attendance créée par le portail");
    const rows = (await pool.query(
      `SELECT student_id, class_id, recorded_by, recorded_by_role_keys, medium, local_date::text AS d,
              (local_date = (clock_timestamp() AT TIME ZONE 'Africa/Kinshasa')::date) AS same_day
         FROM school_entry_events ORDER BY student_id`,
    )).rows;
    assert.deepEqual(rows.map((r) => [r.student_id, r.class_id, r.recorded_by, r.recorded_by_role_keys, r.medium]), [
      [S.S1, classA1.id, USERS.DIRECTOR, ["PRINCIPAL"], "qr"],
      [S.S2, classA1.id, USERS.SECRETARY, ["SECRETARY"], "qr"],
      [S.S3, classA1.id, USERS.SECRETARY_TEACHER, ["SECRETARY", "TEACHER"], "qr"],
      [S.S6, classA1.id, USERS.SUPERVISOR, ["SUPERVISOR"], "qr"],
      [S.S7, classA1.id, USERS.ADMIN, ["SCHOOL_ADMIN"], "qr"],
    ], "auteur réel et rôles relus en base");
    assert.ok(rows.every((r) => r.same_day), "date locale du fuseau de l'établissement");
    const audits = (await pool.query(
      `SELECT user_id, new_value FROM audit_logs WHERE action = 'student_card_entry' ORDER BY created_at`,
    )).rows;
    assert.equal(audits.length, 5, "un audit par entrée réelle, aucun pour le doublon ni le rejeu");
    const auditText = JSON.stringify(audits);
    for (const secret of Object.values(cards).map((c) => c.cardToken.split(".")[1]).filter(Boolean)) {
      assert.equal(auditText.includes(secret), false, "audit sans jeton");
    }

    // ---------- Consultation ----------
    const overview = (tok, query = "", headers = {}) => request(`/student-cards/entries${query}`, { token: tok, headers });
    const ov = await overview(token.admin);
    assert.equal(ov.status, 200, JSON.stringify(ov.data));
    assert.equal(ov.data.timeZone, "Africa/Kinshasa");
    const a1 = ov.data.classes.find((c) => c.classId === classA1.id);
    assert.deepEqual([a1.enrolled, a1.entered, a1.notEntered], [5, 5, 0], "inscrits ENROLLED + active");
    const a2 = ov.data.classes.find((c) => c.classId === classA2.id);
    assert.deepEqual([a2.enrolled, a2.entered], [1, 0]);
    assert.equal(ov.data.classes.some((c) => c.classId === classB1.id), false, "aucune classe d'un autre établissement");
    assert.equal(JSON.stringify(ov.data).includes("Amina"), false, "consultation sans donnée d'élève");
    const ovSupervisor = await overview(token.supervisor);
    assert.equal(ovSupervisor.status, 200, `surveillant avec droit de lecture : ${JSON.stringify(ovSupervisor.data)}`);
    await setGrant(pool, "SUPERVISOR", "entry_control", { create: false, read: false });
    assert.equal((await overview(token.supervisor)).status, 403, "droit de lecture retiré : refus immédiat");
    for (const tok of [token.teacher, token.parent, token.stale]) {
      assert.equal((await overview(tok)).status, 403);
    }
    assert.equal((await overview(token.superAdmin, "", { "X-Somafrik-School-Code": LOGIN_A })).data?.code, "PLATFORM_PERSONAL_DATA_DENIED");
    assert.equal((await overview(token.director, "?date=2026-13-40")).data?.code, ENTRY_ERROR.INPUT_INVALID);
    const ovPast = await overview(token.director, "?date=2026-01-05");
    assert.equal(ovPast.data.totals.entered, 0);
    const ovB = await overview(token.directorB);
    assert.equal(ovB.status, 200, JSON.stringify(ovB.data));
    assert.deepEqual(ovB.data.classes.map((c) => c.classId), [classB1.id]);
    assert.equal(ovB.data.timeZone, "Africa/Bujumbura");

    // ---------- Révocation du rôle : effet immédiat ----------
    await pool.query(`UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1`, [USERS.DIRECTOR]);
    assert.equal((await enter(token.director, scanBody(cards.S2))).status, 403, "rôle révoqué : refus sans reconnexion");
    assert.equal(await entryCount(), 5);

    console.log("studentCardEntry.http.pg.test.js OK");
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
