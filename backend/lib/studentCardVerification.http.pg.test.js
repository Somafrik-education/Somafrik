"use strict";

/**
 * CARTE-PR2 — vérification de carte filtrée par RBAC (HTTP + PostgreSQL isolé).
 * Permissions effectives = rôles canoniques en base (resolveEffectivePermissions).
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_CARD_VERIFY_IT_DATABASE ?? "somafrik_student_card_verify_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_CARD_VERIFY_HTTP_PORT ?? 19893);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const LEFTOVER_A = "CD-2026-0001";
const LEFTOVER_B = "BI-2026-0001";
const U = (n) => `ffffffff-ffff-4fff-8fff-${String(n).padStart(12, "0")}`;
const USERS = {
  admin: U(1), teacher: U(2), teacherFree: U(3), teacherCustom: U(4), director: U(5), accountant: U(6),
  parent: U(7), student: U(8), superAdmin: U(9), pays: U(10), adminB: U(11), teacherParent: U(12),
};
const S1 = U(101); // classe A1 (affectée à l'enseignant)
const S2 = U(102); // classe A2
const SB = U(199); // établissement B

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


async function main() {
  if (!DATABASE_URL) {
    console.log("studentCardVerification.http.pg.test.js SKIP (DATABASE_URL absent)");
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
    await setLoginCodeTriggers(pool, false);
    const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
    const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
    const schoolA = (await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1,$2,$3,'LAC','Lycée Lac','active') RETURNING id`, [cd.id, LEFTOVER_A, LOGIN_A])).rows[0];
    const schoolB = (await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1,$2,$3,'BUJ','Lycée Buj','active') RETURNING id`, [bi.id, LEFTOVER_B, LOGIN_B])).rows[0];
    await setLoginCodeTriggers(pool, true);
    await pool.query(`ALTER TABLE users DISABLE TRIGGER users_permanent_identity_insert`);
    const people = [
      ["admin", schoolA.id, "Admin School", "SCHOOL_ADMIN"],
      ["teacher", schoolA.id, "Enseignant", "TEACHER"],
      ["teacherFree", schoolA.id, "Enseignant", "TEACHER"],
      ["teacherCustom", schoolA.id, "Enseignant", "TEACHER"],
      ["director", schoolA.id, "Directeur", "PRINCIPAL"],
      ["accountant", schoolA.id, "Comptable", "ACCOUNTANT"],
      ["parent", schoolA.id, "Parent", "PARENT"],
      ["student", schoolA.id, "Élève / Étudiant", "STUDENT"],
      ["superAdmin", null, "Super Administrateur Somafrik", "SUPER_ADMIN"],
      ["pays", null, "Admin Pays", "COUNTRY_ADMIN"],
      ["adminB", schoolB.id, "Admin School", "SCHOOL_ADMIN"],
      ["teacherParent", schoolA.id, "Enseignant", "TEACHER"],
    ];
    for (const [key, schoolId, role] of people) {
      await pool.query(
        `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
         VALUES ($1,$2,$3,$4,'T',$5,$6,'active',FALSE)`,
        [USERS[key], schoolId, `U-${key}`.toUpperCase(), key, `${key}@verify.test`, role],
      );
    }
    await pool.query(`ALTER TABLE users ENABLE TRIGGER users_permanent_identity_insert`);
    for (const [key, schoolId, , roleKey] of people) {
      await pool.query(`INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1,$2,$3,'active')`,
        [USERS[key], schoolId, roleKey]);
    }
    await pool.query(
      `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
       VALUES ($1,$4,'VF-S1','Amina','Kabila','active'), ($2,$4,'VF-S2','Bao','Lutete','active'),
              ($3,$5,'VF-SB','Ines','Tshala','active')`,
      [S1, S2, SB, schoolA.id, schoolB.id],
    );
    const yearA = (await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027', TRUE, 'open') RETURNING id`, [schoolA.id])).rows[0];
    const yearB = (await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027', TRUE, 'open') RETURNING id`, [schoolB.id])).rows[0];
    const classA1 = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,'VF-A1','3e A','active') RETURNING id`, [schoolA.id, yearA.id])).rows[0];
    const classA2 = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,'VF-A2','3e B','active') RETURNING id`, [schoolA.id, yearA.id])).rows[0];
    const classB1 = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,'VF-B1','3e Buj','active') RETURNING id`, [schoolB.id, yearB.id])).rows[0];
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,'ENROLLED'), ($1,$5,$6,$4,'ENROLLED'), ($7,$8,$9,$10,'ENROLLED')`,
      [schoolA.id, S1, classA1.id, yearA.id, S2, classA2.id, schoolB.id, SB, classB1.id, yearB.id],
    );
    for (const key of ["teacher", "teacherFree", "teacherCustom", "teacherParent"]) {
      const subject = (await pool.query(
        `INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,$2,$3,'active') RETURNING id`,
        [schoolA.id, `SUB-${key}`.toUpperCase(), `Matière ${key}`])).rows[0];
      const row = (await pool.query(
        `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,$3,'active') RETURNING id`,
        [schoolA.id, USERS[key], `T-${key}`.toUpperCase()])).rows[0];
      if (key !== "teacherFree") {
        await pool.query(
          `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
           VALUES ($1,$2,$3,$4,$5,'active')`, [schoolA.id, row.id, classA1.id, subject.id, yearA.id]);
      }
    }
    await pool.query(
      `INSERT INTO school_settings (school_id, student_card_enabled, student_card_qr_enabled, student_card_finance_check_enabled)
       VALUES ($1, TRUE, TRUE, FALSE), ($2, TRUE, TRUE, FALSE)
       ON CONFLICT (school_id) DO UPDATE SET student_card_enabled = TRUE, student_card_qr_enabled = TRUE,
         student_card_finance_check_enabled = FALSE`,
      [schoolA.id, schoolB.id],
    );
    // CARTE-CYCLE-01 : titulaire explicite (élève) pour les établissements de test émetteurs de cartes.
    await pool.query("UPDATE school_settings SET student_card_holder_kind = 'eleve' WHERE school_id = ANY($1::uuid[])", [[schoolA.id, schoolB.id]]);
    await pool.query(`INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status) VALUES ($1,$2,$3,'2026-10-15','present')`,
      [schoolA.id, S1, classA1.id]);
    const contact = (await pool.query(
      `INSERT INTO contacts (school_id, country_id, contact_type, first_name, last_name, phone, status)
       VALUES ($1,$2,'parent','Mama','Kabila','+243810000001','active') RETURNING id`, [schoolA.id, cd.id])).rows[0];
    await pool.query(
      `INSERT INTO contact_relations (school_id, country_id, contact_id, student_id, relation_type, status)
       VALUES ($1,$2,$3,$4,'parent_student','active')`, [schoolA.id, cd.id, contact.id, S1]);

    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env, NODE_ENV: "test", PORT: String(HTTP_PORT), DATABASE_URL: isolatedUrl, JWT_SECRET,
        SOMAFRIK_DB_REQUIRED: "true", SOMAFRIK_SKIP_DEMO_SEED: "true", SOMAFRIK_API_ONLY: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrRef = { value: "" };
    child.stderr.on("data", (chunk) => { stderrRef.value += String(chunk); });
    await waitForHealth(child, stderrRef);

    const token = (key, extra = {}) => {
      const person = people.find(([k]) => k === key);
      const schoolCode = person[1] === schoolB.id ? LEFTOVER_B : person[1] ? LEFTOVER_A : LOGIN_A;
      return mint({ sub: USERS[key], role: person[2], roleKeys: [person[3]], schoolCode, permissions: [], ...extra });
    };
    const tAdmin = token("admin", { permissions: ["Élèves:UPDATE", "Gérer élèves"] });
    const issue = async (studentId, bearer = tAdmin) => {
      const issued = await request("/student-cards", { method: "POST", token: bearer, body: { studentId, medium: "qr" } });
      assert.equal(issued.status, 201, JSON.stringify(issued.data));
      return issued.data;
    };
    const card1 = await issue(S1);
    const card2 = await issue(S2);
    const cardB = await issue(SB, token("adminB", { permissions: ["Élèves:UPDATE", "Gérer élèves"] }));
    // Historique de S2 : une carte révoquée puis une carte active.
    assert.equal((await request(`/student-cards/${card2.id}/revoke`, { method: "POST", token: tAdmin, body: {} })).status, 200);
    const card2b = await issue(S2);
    const verify = (bearer, cardToken, extra = {}, headers = {}) =>
      request("/student-cards/verify", { method: "POST", token: bearer, body: { cardToken, date: "2026-10-15", ...extra }, headers });
    const codes = Object.fromEntries((await pool.query(`SELECT id, student_code FROM students`)).rows.map((r) => [r.id, r.student_code]));
    const leaks = (payload, values) => values.filter((value) => JSON.stringify(payload ?? {}).includes(value));
    const IDENTITY = [S1, S2, SB, codes[S1], codes[S2], codes[SB], "Amina", "Bao", "Ines", "Kabila", "Lutete", "Tshala", "VF-A1", "VF-A2"];
    const SECRETS = [card1.cardToken, card1.cardToken.split(".")[1], card2b.cardToken.split(".")[1]];

    // ---------- Accès refusés ----------
    assert.equal((await verify(undefined, card1.cardToken)).status, 401);
    for (const key of ["accountant", "parent", "student"]) {
      const denied = await verify(token(key), card1.cardToken);
      assert.equal(denied.status, 403, `${key}: ${JSON.stringify(denied.data)}`);
      assert.deepEqual(leaks(denied.data, IDENTITY), [], key);
    }
    for (const [key, headers] of [["superAdmin", { "X-Somafrik-School-Code": LOGIN_A }], ["pays", {}]]) {
      const denied = await verify(token(key, { permissions: ["ALL_PRIVILEGES", "COUNTRY_PRIVILEGES", "Élèves:READ"] }), card1.cardToken, {}, headers);
      assert.equal(denied.status, 403, key);
      assert.equal(denied.data?.code, "PLATFORM_PERSONAL_DATA_DENIED", key);
    }

    // ---------- Enseignant : classes affectées seulement ----------
    const teacherOwn = await verify(token("teacher"), card1.cardToken);
    assert.equal(teacherOwn.status, 200, JSON.stringify(teacherOwn.data));
    assert.equal(teacherOwn.cacheControl, "no-store");
    assert.equal(teacherOwn.data.scope, "class");
    assert.equal(teacherOwn.data.card.valid, true);
    assert.equal(teacherOwn.data.student.studentCode, codes[S1]);
    assert.equal(teacherOwn.data.class.classCode, "VF-A1");
    assert.deepEqual(teacherOwn.data.attendance, { date: "2026-10-15", status: "present" });
    for (const hidden of ["finance", "cardHistory", "guardians"]) assert.equal(teacherOwn.data[hidden], undefined, hidden);
    assert.deepEqual(leaks(teacherOwn.data, SECRETS), []);
    for (const key of ["teacher", "teacherFree", "teacherCustom", "teacherParent"]) {
      const extra = key === "teacherParent" ? { roleKeys: ["TEACHER", "PARENT"] }
        : key === "teacherCustom" ? { role: "Professeur principal" } : {};
      const other = await verify(token(key, extra), (key === "teacherFree" ? card1 : card2b).cardToken);
      assert.equal(other.status, 200, key);
      assert.deepEqual(other.data, { card: { valid: true, medium: "qr" }, scope: "none" }, `${key} hors périmètre : validité seule`);
    }
    // Libellé personnalisé et rôle secondaire parent : toujours restreints, jamais élevés.
    const customOwn = await verify(token("teacherCustom", { role: "Professeur principal" }), card1.cardToken);
    assert.equal(customOwn.data.scope, "class");
    assert.equal(customOwn.data.guardians, undefined);
    // Enseignant également parent (rôle secondaire PARENT) : il reste un enseignant restreint.
    const teacherParentOwn = await verify(token("teacherParent", { roleKeys: ["TEACHER", "PARENT"] }), card1.cardToken);
    assert.equal(teacherParentOwn.status, 200, "un enseignant également parent garde son accès enseignant");
    assert.equal(teacherParentOwn.data.scope, "class");
    // Les permissions du jeton ne comptent pas : seules les permissions effectives en base.
    const forged = await verify(token("teacher", { permissions: ["Relations:READ", "Impayés:READ", "Gérer utilisateurs"] }), card1.cardToken);
    for (const hidden of ["finance", "cardHistory", "guardians"]) assert.equal(forged.data[hidden], undefined, `jeton forgé : ${hidden}`);

    // ---------- « Directeur » (roleKey PRINCIPAL) : établissement entier selon ses permissions ----------
    const director = await verify(token("director"), card2b.cardToken);
    assert.equal(director.status, 200, JSON.stringify(director.data));
    assert.equal(director.data.scope, "school");
    assert.equal(director.data.student.studentCode, codes[S2]);
    assert.ok(Array.isArray(director.data.cardHistory), "historique avec la permission Élèves:READ");
    assert.ok(director.data.cardHistory.some((card) => card.status === "revoked"));
    assert.deepEqual(leaks(director.data.cardHistory, [card2.id, card2.publicId, card2b.id, card2b.publicId]), [], "historique sans identifiant de carte");
    assert.equal(director.data.finance, undefined, "contrôle impayés désactivé pour l'établissement");
    const directorS1 = await verify(token("director"), card1.cardToken);
    assert.deepEqual(directorS1.data.guardians, [{ name: "Mama Kabila", phone: "+243810000001", isPrincipal: false }]);
    // Libellé seul sans roleKey ni permission : aucun droit.
    const labelOnly = await verify(mint({ sub: U(77), role: "Directeur", roleKeys: [], schoolCode: LEFTOVER_A, permissions: [] }), card1.cardToken);
    assert.ok([401, 403].includes(labelOnly.status), `libellé seul refusé (${labelOnly.status})`);

    // ---------- Permissions retirées : sections retirées ----------
    await pool.query(
      `UPDATE role_module_permissions SET can_read = FALSE WHERE upper(role_key) = 'PRINCIPAL' AND module_key IN ('relations')`);
    const noGuardians = await verify(token("director"), card1.cardToken);
    assert.equal(noGuardians.status, 200);
    assert.equal(noGuardians.data.guardians, undefined, "sans Relations:READ, aucun contact parent");

    // ---------- Finance : permission ET réglage établissement ----------
    await pool.query(`UPDATE school_settings SET student_card_finance_check_enabled = TRUE WHERE school_id = $1`, [schoolA.id]);
    const teacherFinance = await verify(token("teacher"), card1.cardToken);
    assert.equal(teacherFinance.data.finance, undefined, "enseignant : pas de finance par défaut");
    const adminFinance = await verify(token("admin"), card1.cardToken);
    assert.equal(adminFinance.status, 200, JSON.stringify(adminFinance.data));
    assert.deepEqual(adminFinance.data.finance, { code: "UP_TO_DATE", label: "À jour" }, "permission Finance + réglage activé");
    await pool.query(`UPDATE school_settings SET student_card_finance_check_enabled = FALSE WHERE school_id = $1`, [schoolA.id]);
    assert.equal((await verify(token("admin"), card1.cardToken)).data.finance, undefined, "réglage désactivé : aucune finance");

    // ---------- Cartes invalides et autre établissement : « invalide », rien d'autre ----------
    assert.deepEqual((await verify(token("director"), card2.cardToken)).data, { card: { valid: false }, scope: "none" }, "révoquée");
    assert.deepEqual((await verify(token("director"), cardB.cardToken)).data, { card: { valid: false }, scope: "none" }, "autre établissement");
    assert.deepEqual((await verify(token("director"), `${card1.publicId}.wrongSecretValue12`)).data, { card: { valid: false }, scope: "none" });
    const adminB = await verify(token("adminB"), card1.cardToken);
    assert.deepEqual(adminB.data, { card: { valid: false }, scope: "none" }, "isolation multi-établissement");
    const spoof = await verify(token("teacher"), card1.cardToken, {}, { "X-Somafrik-School-Code": LOGIN_B });
    assert.equal(spoof.status, 403, "changement d'établissement par en-tête refusé");

    console.log("studentCardVerification.http.pg.test.js OK");
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
