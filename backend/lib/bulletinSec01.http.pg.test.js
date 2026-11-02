"use strict";

/**
 * BULLETIN-SEC-01 — bulletin historique (GET /api/students/:id/report[.pdf]).
 *
 * Fixture dédiée (base jetable, sans seed démo) :
 * - École A « Lycée Alpha » (CD-2026-0001, établissement « primaire » du jeu
 *   de données) : classe « 6ème A » (A1) avec Alice et Amir, et une seconde
 *   classe homonyme « 6ème A » (A2) avec Astrid.
 * - École B « Lycée Beta » : classe « 6ème A » (B1) avec Benoît et Bella.
 * - Notes T1 : évaluations publiées, évaluation en brouillon, note héritée sans
 *   évaluation publiée, note héritée non publiée.
 *
 * Contrat attendu :
 * - P0-1 : un bulletin « Publié » ne contient que des notes publiées
 *   (règle bulletin LOT 9 : grades.publication_status = 'published' et
 *   évaluation absente ou publiée, active).
 * - P0-2 : rang et effectif limités à l'établissement, à la classe (identifiant)
 *   et à la période.
 * - P0-3 : identité (nom, code) de l'établissement propriétaire de l'élève.
 * - Parents : enfant lié seulement ; aucun accès inter-établissements.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { mintSessionAccessToken } = require("./testAccessSession");
const { hasExited, stopChildProcess } = require("./pgTestLifecycle");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_bulletin_sec01_it";
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = 19981;
const JWT_SECRET = "bulletin-sec-01-test-secret-with-enough-length-for-checks";
const skip = DATABASE_URL ? false : "DATABASE_URL absent (exécuter via npm run test:backend-baseline:pg)";

const LOGIN_A = "CD-ALP-26-001";
const LEFTOVER_A = "CD-2026-0001";
const LOGIN_B = "BI-BET-26-001";
const LEFTOVER_B = "BI-2026-0001";

const USER_ADMIN_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const USER_ADMIN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";
const USER_PARENT_ALICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03";
const USER_PARENT_BENOIT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04";
const USER_TEACHER_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05";
const USER_TEACHER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06";

const READ_PERMS = ["Élèves:READ", "Notes:READ", "Bulletins:READ", "Voir bulletins", "Voir enfant", "Voir élèves"];
const STAFF_PERMS = [...READ_PERMS, "ALL_PRIVILEGES"];

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function resetDatabase() {
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DATABASE]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = withDatabaseName(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: url });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }
  return url;
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
  const inserted = await pool.query(
    "INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ($1, $2, $3, $4) RETURNING id",
    [name, iso, phone, currency],
  );
  return inserted.rows[0];
}

async function insertOne(pool, sql, params) {
  return (await pool.query(sql, params)).rows[0].id;
}

/** Une école complète : année, trimestre, matière, enseignant. */
async function seedSchool(pool, { countryId, schoolCode, loginCode, shortCode, name, teacherUserId, teacherCode, subjectCode }) {
  await setLoginCodeTriggers(pool, false);
  const schoolId = await insertOne(
    pool,
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
    [countryId, schoolCode, loginCode, shortCode, name],
  );
  await setLoginCodeTriggers(pool, true);
  const yearId = await insertOne(
    pool,
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open') RETURNING id`,
    [schoolId],
  );
  const termId = await insertOne(
    pool,
    "INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open') RETURNING id",
    [yearId],
  );
  const subjectId = await insertOne(
    pool,
    `INSERT INTO subjects (school_id, subject_code, name, status)
     VALUES ($1, $2, 'Mathématiques', 'active') RETURNING id`,
    [schoolId, subjectCode],
  );
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES ($1, $2, $3, 'Prof', $4, $5, 'Enseignant', 'active', FALSE)`,
    [teacherUserId, schoolId, `${teacherCode}-U`, shortCode, `${teacherCode.toLowerCase()}@sec01.test`],
  );
  const teacherId = await insertOne(
    pool,
    "INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1, $2, $3, 'active') RETURNING id",
    [schoolId, teacherUserId, teacherCode],
  );
  return { schoolId, yearId, termId, subjectId, teacherId };
}

async function seedClass(pool, school, { classCode }) {
  return insertOne(
    pool,
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, '6ème A', 'active') RETURNING id`,
    [school.schoolId, school.yearId, classCode],
  );
}

async function seedStudent(pool, school, classId, { code, firstName }) {
  const studentId = await insertOne(
    pool,
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, $2, $3, 'Test', 'active') RETURNING id`,
    [school.schoolId, code, firstName],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [school.schoolId, studentId, classId, school.yearId],
  );
  return studentId;
}

async function seedEvaluation(pool, school, classId, { title, status }) {
  return insertOne(
    pool,
    `INSERT INTO evaluations (school_id, class_id, subject_id, teacher_id, term_id, title, max_score, coefficient, status, active)
     VALUES ($1, $2, $3, $4, $5, $6, 20, 1, $7, TRUE) RETURNING id`,
    [school.schoolId, classId, school.subjectId, school.teacherId, school.termId, title, status],
  );
}

async function seedGrade(pool, school, classId, studentId, { evaluationId = null, score, publicationStatus = "published" }) {
  await pool.query(
    `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id,
                         grade_type, score, max_score, coefficient, grade_status, publication_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'devoir', $8, 20, 1, 'graded', $9)`,
    [school.schoolId, studentId, classId, school.subjectId, school.teacherId, school.termId, evaluationId, score, publicationStatus],
  );
}

async function seed(pool) {
  const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
  const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
  const a = await seedSchool(pool, {
    countryId: cd.id,
    schoolCode: LEFTOVER_A,
    loginCode: LOGIN_A,
    shortCode: "ALP",
    name: "Lycée Alpha",
    teacherUserId: USER_TEACHER_A,
    teacherCode: "TCH-SEC01-A",
    subjectCode: "MATH",
  });
  const b = await seedSchool(pool, {
    countryId: bi.id,
    schoolCode: LEFTOVER_B,
    loginCode: LOGIN_B,
    shortCode: "BET",
    name: "Lycée Beta",
    teacherUserId: USER_TEACHER_B,
    teacherCode: "TCH-SEC01-B",
    subjectCode: "MATH",
  });

  const classA1 = await seedClass(pool, a, { classCode: "SEC01-A1" });
  const classA2 = await seedClass(pool, a, { classCode: "SEC01-A2" });
  const classB1 = await seedClass(pool, b, { classCode: "SEC01-B1" });

  const alice = await seedStudent(pool, a, classA1, { code: "SEC01-ALICE", firstName: "Alice" });
  const amir = await seedStudent(pool, a, classA1, { code: "SEC01-AMIR", firstName: "Amir" });
  const astrid = await seedStudent(pool, a, classA2, { code: "SEC01-ASTRID", firstName: "Astrid" });
  const benoit = await seedStudent(pool, b, classB1, { code: "SEC01-BENOIT", firstName: "Benoit" });
  const bella = await seedStudent(pool, b, classB1, { code: "SEC01-BELLA", firstName: "Bella" });

  // A1 — Alice : publiée 12, brouillon 2, héritée publiée 14, héritée non publiée 0.
  const evalA1Published = await seedEvaluation(pool, a, classA1, { title: "Devoir publié", status: "published" });
  const evalA1Draft = await seedEvaluation(pool, a, classA1, { title: "Devoir brouillon", status: "draft" });
  await seedGrade(pool, a, classA1, alice, { evaluationId: evalA1Published, score: 12 });
  await seedGrade(pool, a, classA1, alice, { evaluationId: evalA1Draft, score: 2 });
  await seedGrade(pool, a, classA1, alice, { score: 14 });
  await seedGrade(pool, a, classA1, alice, { score: 0, publicationStatus: "draft" });
  await seedGrade(pool, a, classA1, amir, { evaluationId: evalA1Published, score: 10 });
  // A2 (homonyme, même école) — Astrid 19.
  const evalA2 = await seedEvaluation(pool, a, classA2, { title: "Devoir A2", status: "published" });
  await seedGrade(pool, a, classA2, astrid, { evaluationId: evalA2, score: 19 });
  // B1 (homonyme, autre école) — Benoît 18, Bella 15.
  const evalB1 = await seedEvaluation(pool, b, classB1, { title: "Devoir B1", status: "published" });
  await seedGrade(pool, b, classB1, benoit, { evaluationId: evalB1, score: 18 });
  await seedGrade(pool, b, classB1, bella, { evaluationId: evalB1, score: 15 });

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $5, 'SEC01-ADM-A', 'Admin', 'Alpha', 'adm-a@sec01.test', 'Admin School', 'active', FALSE),
       ($2, $6, 'SEC01-ADM-B', 'Admin', 'Beta', 'adm-b@sec01.test', 'Admin School', 'active', FALSE),
       ($3, $5, 'SEC01-PAR-ALICE', 'Parent', 'Alice', 'par-alice@sec01.test', 'Parent', 'active', FALSE),
       ($4, $6, 'SEC01-PAR-BENOIT', 'Parent', 'Benoit', 'par-benoit@sec01.test', 'Parent', 'active', FALSE)`,
    [USER_ADMIN_A, USER_ADMIN_B, USER_PARENT_ALICE, USER_PARENT_BENOIT, a.schoolId, b.schoolId],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES ($1, $5, 'SCHOOL_ADMIN', 'active'), ($2, $6, 'SCHOOL_ADMIN', 'active'),
            ($3, $5, 'PARENT', 'active'), ($4, $6, 'PARENT', 'active')`,
    [USER_ADMIN_A, USER_ADMIN_B, USER_PARENT_ALICE, USER_PARENT_BENOIT, a.schoolId, b.schoolId],
  );
  const contactAlice = await insertOne(
    pool,
    `INSERT INTO contacts (school_id, country_id, first_name, last_name, contact_type, status, user_id)
     VALUES ($1, $2, 'Parent', 'Alice', 'parent', 'active', $3) RETURNING id`,
    [a.schoolId, cd.id, USER_PARENT_ALICE],
  );
  const contactBenoit = await insertOne(
    pool,
    `INSERT INTO contacts (school_id, country_id, first_name, last_name, contact_type, status, user_id)
     VALUES ($1, $2, 'Parent', 'Benoit', 'parent', 'active', $3) RETURNING id`,
    [b.schoolId, bi.id, USER_PARENT_BENOIT],
  );
  await pool.query(
    `INSERT INTO contact_relations (school_id, country_id, relation_type, contact_id, student_id, status)
     VALUES ($1, $3, 'parent_student', $5, $7, 'active'), ($2, $4, 'parent_student', $6, $8, 'active')`,
    [a.schoolId, b.schoolId, cd.id, bi.id, contactAlice, contactBenoit, alice, benoit],
  );
  return { a, b, alice, benoit };
}

/** Identifiant public attribué par la base (code V2) pour chaque prénom de la fixture. */
async function studentKeys(pool) {
  const rows = (await pool.query("SELECT first_name, student_code, id::text AS uuid FROM students")).rows;
  return Object.fromEntries(rows.map((row) => [row.first_name, { code: row.student_code, uuid: row.uuid }]));
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (hasExited(child)) throw new Error(`Serveur arrêté au démarrage.\n${stderrRef.value.slice(-4000)}`);
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      /* démarrage en cours */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Serveur non prêt.\n${stderrRef.value.slice(-4000)}`);
}

async function request(pathname, token) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = String(response.headers.get("content-type") ?? "");
  let data = null;
  if (contentType.includes("application/json")) {
    try {
      data = JSON.parse(buffer.toString("utf8"));
    } catch {
      data = null;
    }
  }
  return { status: response.status, contentType, buffer, data, text: contentType.includes("pdf") ? "<pdf>" : buffer.toString("utf8") };
}

function pdfToTextAvailable() {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pdfText(buffer) {
  return execFileSync("pdftotext", ["-layout", "-", "-"], { input: buffer }).toString("utf8");
}

const state = { child: null, repo: null, tokens: {}, ids: {}, stderr: { value: "" } };

/** Route élève : `/students/<code public>/<suffixe>`. */
function studentRoute(firstName, suffix) {
  return `/students/${encodeURIComponent(state.ids[firstName].code)}/${suffix}`;
}

before(async () => {
  if (skip) return;
  const url = await resetDatabase();
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  state.repo = createPostgresRepository(url);
  await state.repo.init();
  await state.repo.pool.query(`
    ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
    ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
  `);
  await seed(state.repo.pool);
  state.ids = await studentKeys(state.repo.pool);

  state.child = spawn(process.execPath, ["backend/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(HTTP_PORT),
      DATABASE_URL: url,
      JWT_SECRET,
      SOMAFRIK_DB_REQUIRED: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
      SOMAFRIK_API_ONLY: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  state.child.stderr.on("data", (chunk) => {
    state.stderr.value += String(chunk);
  });
  state.child.stdout.on("data", () => {});
  await waitForHealth(state.child, state.stderr);

  const tokens = new TokenService({ secret: JWT_SECRET });
  const mint = (payload) =>
    mintSessionAccessToken({ tokens, repository: state.repo, payload: { mustChangePassword: false, ...payload } });
  state.tokens.adminA = await mint({ sub: USER_ADMIN_A, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LOGIN_A, permissions: STAFF_PERMS });
  state.tokens.adminB = await mint({ sub: USER_ADMIN_B, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LOGIN_B, permissions: STAFF_PERMS });
  state.tokens.parentAlice = await mint({
    sub: USER_PARENT_ALICE,
    role: "Parent",
    roleKeys: ["PARENT"],
    schoolCode: LOGIN_A,
    permissions: READ_PERMS,
    studentIds: [state.ids.Alice.code, state.ids.Alice.uuid],
  });
  state.tokens.parentBenoit = await mint({
    sub: USER_PARENT_BENOIT,
    role: "Parent",
    roleKeys: ["PARENT"],
    schoolCode: LOGIN_B,
    permissions: READ_PERMS,
    studentIds: [state.ids.Benoit.code, state.ids.Benoit.uuid],
  });
});

after(async () => {
  if (state.child) await stopChildProcess(state.child).catch(() => {});
  if (state.repo?.pool && !state.repo.pool.ended) await state.repo.pool.end().catch(() => {});
});

test("P0-1 : le bulletin « Publié » ne contient que des notes publiées", { skip }, async () => {
  const response = await request(studentRoute("Alice", "report"), state.tokens.adminA);
  assert.equal(response.status, 200, response.text.slice(0, 300));
  assert.equal(response.data.status, "Publié");
  // Notes publiées : évaluation publiée 12 + note héritée publiée 14 → 13,00.
  // Exclues : évaluation brouillon (2), note héritée non publiée (0).
  assert.equal(response.data.averageDisplay, "13.00", `moyenne ${response.data.averageDisplay} (attendu 13.00 sur notes publiées)`);
  const maths = (response.data.subjects ?? []).find((row) => row.subject === "Mathématiques");
  assert.ok(maths, "ligne Mathématiques présente");
  assert.equal(maths.gradeCount, 2, `notes comptées : ${maths.gradeCount} (attendu 2 notes publiées)`);
});

test("P0-2 : rang et effectif limités à l'établissement et à la classe (homonymes exclus)", { skip }, async () => {
  const alice = await request(studentRoute("Alice", "report"), state.tokens.adminA);
  assert.equal(alice.status, 200, alice.text.slice(0, 300));
  // A1 : Alice 13, Amir 10. Exclus : Astrid (A2, même école, même nom de classe), Benoît et Bella (école B).
  assert.equal(alice.data.rankLabel, "1e / 2", `rang Alice : ${alice.data.rankLabel}`);
  const benoit = await request(studentRoute("Benoit", "report"), state.tokens.adminB);
  assert.equal(benoit.status, 200, benoit.text.slice(0, 300));
  assert.equal(benoit.data.rankLabel, "1e / 2", `rang Benoît : ${benoit.data.rankLabel}`);
});

test("P0-3 : le bulletin porte l'identité de l'établissement propriétaire", { skip }, async () => {
  const benoit = await request(studentRoute("Benoit", "report"), state.tokens.adminB);
  assert.equal(benoit.status, 200, benoit.text.slice(0, 300));
  assert.equal(benoit.data.school?.code, LEFTOVER_B, `école du bulletin : ${JSON.stringify(benoit.data.school)}`);
  assert.equal(benoit.data.school?.name, "Lycée Beta");
});

test(
  "P0-3 (PDF) : nom et code imprimés = établissement propriétaire",
  { skip: skip || (!pdfToTextAvailable() && "pdftotext (poppler-utils) absent : contrôle textuel du PDF non exécutable") },
  async () => {
    const pdf = await request(studentRoute("Benoit", "report.pdf"), state.tokens.adminB);
    assert.equal(pdf.status, 200, pdf.text.slice(0, 300));
    const text = pdfText(pdf.buffer);
    const excerpt = text.replace(/\s+/g, " ").slice(0, 240);
    assert.match(text, /Lycée Beta/, `nom de l'établissement propriétaire imprimé — PDF : « ${excerpt} »`);
    assert.match(text, /BI-2026-0001/, `code de l'établissement propriétaire imprimé — PDF : « ${excerpt} »`);
    assert.doesNotMatch(text, /Lycée Alpha|CD-2026-0001/, `aucune identité d'un autre établissement — PDF : « ${excerpt} »`);
  },
);

test(
  "P0-1/P0-2 (PDF) : moyenne et rang imprimés sur notes publiées de la classe",
  { skip: skip || (!pdfToTextAvailable() && "pdftotext (poppler-utils) absent : contrôle textuel du PDF non exécutable") },
  async () => {
    const pdf = await request(studentRoute("Alice", "report.pdf"), state.tokens.parentAlice);
    assert.equal(pdf.status, 200, pdf.text.slice(0, 300));
    const text = pdfText(pdf.buffer);
    const excerpt = text.replace(/\s+/g, " ").slice(0, 400);
    assert.match(text, /13\.00 \/ 20/, `moyenne sur notes publiées — PDF : « ${excerpt} »`);
    assert.match(text, /1e \/ 2/, `rang limité à la classe — PDF : « ${excerpt} »`);
    assert.match(text, /Lycée Alpha/, `établissement propriétaire — PDF : « ${excerpt} »`);
  },
);

test("Parent lié : bulletin PDF de son enfant (régression du parcours)", { skip }, async () => {
  const pdf = await request(studentRoute("Alice", "report.pdf"), state.tokens.parentAlice);
  assert.equal(pdf.status, 200, pdf.text.slice(0, 300));
  assert.match(pdf.contentType, /application\/pdf/);
  assert.equal(pdf.buffer.subarray(0, 4).toString("latin1"), "%PDF");
});

test("Parent non autorisé : aucun bulletin d'un élève non lié, même école ou autre école", { skip }, async () => {
  for (const [label, route, token] of [
    ["camarade non lié (JSON)", studentRoute("Amir", "report"), state.tokens.parentAlice],
    ["camarade non lié (PDF)", studentRoute("Amir", "report.pdf"), state.tokens.parentAlice],
    ["élève d'une autre école (PDF)", studentRoute("Alice", "report.pdf"), state.tokens.parentBenoit],
  ]) {
    const response = await request(route, token);
    assert.ok([403, 404].includes(response.status), `${label} : HTTP ${response.status}`);
    assert.doesNotMatch(String(response.contentType), /pdf/, `${label} : aucun PDF`);
  }
});

test("Isolation tenant et RBAC : administrateur d'une autre école refusé, anonyme refusé", { skip }, async () => {
  const crossJson = await request(studentRoute("Benoit", "report"), state.tokens.adminA);
  assert.ok([403, 404].includes(crossJson.status), `admin A → élève B (JSON) : ${crossJson.status}`);
  const crossPdf = await request(studentRoute("Benoit", "report.pdf"), state.tokens.adminA);
  assert.ok([403, 404].includes(crossPdf.status), `admin A → élève B (PDF) : ${crossPdf.status}`);
  const anonymous = await request(studentRoute("Alice", "report.pdf"), null);
  assert.equal(anonymous.status, 401);
});
