"use strict";

/**
 * P0 Parent Attendance Isolation — RED HTTP (PostgreSQL).
 *
 * Fixture CTO :
 * - Parent A lié uniquement à Maeva ;
 * - Maeva dans 2ème A ;
 * - ≥ 3 autres élèves dans cette classe ;
 * - présences différentes.
 *
 * Contrôle séparément :
 * GET /api/classes
 * GET /api/classes/{classCode}/students
 * GET /api/presences
 * GET /api/students/{idAutreEleve}/presences
 *
 * Contrat GREEN fail-closed. Le rattachement Parent ↔ enfants est canonique
 * (`contacts.user_id` → `contact_relations.student_id`) ; un JWT ne peut pas
 * élargir le roster au-delà des enfants liés.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_PARENT_ATT_ISO_IT_DATABASE ?? "somafrik_parent_att_iso_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_PARENT_ATT_ISO_HTTP_PORT ?? 19917);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_A = "CD-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";
const LEFTOVER_B = "BI-2026-0001";
const CLASS_2A = "CLS-2A";
const CLASS_2B = "CLS-2B";
const CLASS_B = "CLS-B1";

const USER_ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11";
const USER_TEACHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12";
const USER_PARENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13";
const USER_PARENT_TWO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14";
const USER_PARENT_EMPTY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa15";
const USER_PARENT_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa16";

const PRES_MAEVA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11";
const PRES_AISHA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee12";
const PRES_JEAN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee13";
const PRES_LUC = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee14";
const PRES_SIB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee15";
const PRES_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee16";

const PARENT_PERMS = [
  "Classes:READ",
  "Élèves:READ",
  "Présences:READ",
  "Voir classes",
  "Voir élèves",
  "Voir présences",
  "Voir enfant",
];
const STAFF_PERMS = [...PARENT_PERMS, "Présences:CREATE", "ALL_PRIVILEGES"];

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
  return { status: response.status, data };
}

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    }
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
  const inserted = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, iso, phone, currency],
  );
  return inserted.rows[0];
}

async function seed(pool) {
  await setLoginCodeTriggers(pool, false);
  const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
  const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'LAC', 'Lycée Lac', 'active') RETURNING id`,
    [cd.id, LEFTOVER_A, LOGIN_A],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'BUJ', 'Lycée Bujumbura', 'active') RETURNING id`,
    [bi.id, LEFTOVER_B, LOGIN_B],
  );
  await setLoginCodeTriggers(pool, true);

  const schoolAId = schoolA.rows[0].id;
  const schoolBId = schoolB.rows[0].id;

  const yearA = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open') RETURNING id`,
    [schoolAId],
  );
  const yearB = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open') RETURNING id`,
    [schoolBId],
  );

  const class2A = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, '2ème A', 'active') RETURNING id`,
    [schoolAId, yearA.rows[0].id, CLASS_2A],
  );
  const class2B = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, '2ème B', 'active') RETURNING id`,
    [schoolAId, yearA.rows[0].id, CLASS_2B],
  );
  const classB = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, '6ème Buj', 'active') RETURNING id`,
    [schoolBId, yearB.rows[0].id, CLASS_B],
  );

  const maeva = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'STU-MAEVA', 'Maeva', 'A', 'active') RETURNING id`,
    [schoolAId],
  );
  const aisha = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'STU-AISHA', 'Aisha', 'B', 'active') RETURNING id`,
    [schoolAId],
  );
  const jean = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'STU-JEAN', 'Jean', 'C', 'active') RETURNING id`,
    [schoolAId],
  );
  const luc = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'STU-LUC', 'Luc', 'D', 'active') RETURNING id`,
    [schoolAId],
  );
  const sibling = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'STU-SIB', 'Sibling', 'E', 'active') RETURNING id`,
    [schoolAId],
  );
  const studentB = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'STU-B1', 'Binta', 'F', 'active') RETURNING id`,
    [schoolBId],
  );

  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES
       ($1, $3, $8, $11, 'active'),
       ($1, $4, $8, $11, 'active'),
       ($1, $5, $8, $11, 'active'),
       ($1, $6, $8, $11, 'active'),
       ($1, $7, $9, $11, 'active'),
       ($2, $12, $10, $13, 'active')`,
    [
      schoolAId,
      schoolBId,
      maeva.rows[0].id,
      aisha.rows[0].id,
      jean.rows[0].id,
      luc.rows[0].id,
      sibling.rows[0].id,
      class2A.rows[0].id,
      class2B.rows[0].id,
      classB.rows[0].id,
      yearA.rows[0].id,
      studentB.rows[0].id,
      yearB.rows[0].id,
    ],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $7, 'ADM-A', 'Admin', 'A', 'adm-a@iso.test', 'Admin School', 'active', FALSE),
       ($2, $7, 'TCH-A', 'Teacher', 'A', 'tch-a@iso.test', 'Enseignant', 'active', FALSE),
       ($3, $7, 'PAR-MAEVA', 'Papa', 'Maeve', 'papa-maeve@iso.test', 'Parent', 'active', FALSE),
       ($4, $7, 'PAR-TWO', 'Parent', 'Deux', 'par-two@iso.test', 'Parent', 'active', FALSE),
       ($5, $7, 'PAR-EMPTY', 'Parent', 'Vide', 'par-empty@iso.test', 'Parent', 'active', FALSE),
       ($6, $8, 'PAR-B', 'Parent', 'Buj', 'par-b@iso.test', 'Parent', 'active', FALSE)`,
    [USER_ADMIN, USER_TEACHER, USER_PARENT_A, USER_PARENT_TWO, USER_PARENT_EMPTY, USER_PARENT_B, schoolAId, schoolBId],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $5, 'SCHOOL_ADMIN', 'active'),
       ($2, $5, 'TEACHER', 'active'),
       ($3, $5, 'PARENT', 'active'),
       ($4, $5, 'PARENT', 'active'),
       ($6, $5, 'PARENT', 'active'),
       ($7, $8, 'PARENT', 'active')`,
    [USER_ADMIN, USER_TEACHER, USER_PARENT_A, USER_PARENT_TWO, schoolAId, USER_PARENT_EMPTY, USER_PARENT_B, schoolBId],
  );

  const teacher = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'TCH-LAC-ISO', 'active') RETURNING id`,
    [schoolAId, USER_TEACHER],
  );
  const subject = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, status)
     VALUES ($1, 'SUB-ISO-MATH', 'Maths', 'active') RETURNING id`,
    [schoolAId],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [schoolAId, teacher.rows[0].id, class2A.rows[0].id, subject.rows[0].id, yearA.rows[0].id],
  );

  const contactA = await pool.query(
    `INSERT INTO contacts (school_id, country_id, first_name, last_name, contact_type, status, user_id)
     VALUES ($1, $2, 'Papa', 'Maeve', 'parent', 'active', $3) RETURNING id`,
    [schoolAId, cd.id, USER_PARENT_A],
  );
  const contactTwo = await pool.query(
    `INSERT INTO contacts (school_id, country_id, first_name, last_name, contact_type, status, user_id)
     VALUES ($1, $2, 'Parent', 'Deux', 'parent', 'active', $3) RETURNING id`,
    [schoolAId, cd.id, USER_PARENT_TWO],
  );
  const contactB = await pool.query(
    `INSERT INTO contacts (school_id, country_id, first_name, last_name, contact_type, status, user_id)
     VALUES ($1, $2, 'Parent', 'Buj', 'parent', 'active', $3) RETURNING id`,
    [schoolBId, bi.id, USER_PARENT_B],
  );
  await pool.query(
    `INSERT INTO contact_relations (school_id, country_id, relation_type, contact_id, student_id, status)
     VALUES
       ($1, $3, 'parent_student', $5, $8, 'active'),
       ($1, $3, 'parent_student', $6, $8, 'active'),
       ($1, $3, 'parent_student', $6, $9, 'active'),
       ($2, $4, 'parent_student', $7, $10, 'active')`,
    [
      schoolAId,
      schoolBId,
      cd.id,
      bi.id,
      contactA.rows[0].id,
      contactTwo.rows[0].id,
      contactB.rows[0].id,
      maeva.rows[0].id,
      sibling.rows[0].id,
      studentB.rows[0].id,
    ],
  );

  await pool.query(
    `INSERT INTO attendance (id, school_id, student_id, class_id, attendance_date, status)
     VALUES
       ($1, $7, $9, $15, '2026-09-09', 'present'),
       ($2, $7, $10, $15, '2026-09-09', 'absent'),
       ($3, $7, $11, $15, '2026-09-09', 'late'),
       ($4, $7, $12, $15, '2026-09-09', 'present'),
       ($5, $7, $13, $16, '2026-09-09', 'present'),
       ($6, $8, $14, $17, '2026-09-09', 'absent')`,
    [
      PRES_MAEVA,
      PRES_AISHA,
      PRES_JEAN,
      PRES_LUC,
      PRES_SIB,
      PRES_B,
      schoolAId,
      schoolBId,
      maeva.rows[0].id,
      aisha.rows[0].id,
      jean.rows[0].id,
      luc.rows[0].id,
      sibling.rows[0].id,
      studentB.rows[0].id,
      class2A.rows[0].id,
      class2B.rows[0].id,
      classB.rows[0].id,
    ],
  );

  return {
    schoolAId,
    schoolBId,
    class2AId: class2A.rows[0].id,
    maevaId: maeva.rows[0].id,
    aishaId: aisha.rows[0].id,
    maevaCode: "STU-MAEVA",
    siblingCode: "STU-SIB",
    aishaCode: "STU-AISHA",
    studentBCode: "STU-B1",
  };
}

function studentCodes(rows) {
  return unwrapList(rows).map((row) => String(row.studentCode ?? row.matricule ?? row.id ?? "").trim());
}

function presenceIds(rows) {
  return unwrapList(rows).map((row) => String(row.id ?? "").trim());
}

function presenceStudentIds(rows) {
  return unwrapList(rows).map((row) => String(row.studentId ?? "").trim());
}

async function main() {
  if (!DATABASE_URL) {
    console.log("parentAttendanceIsolation.http.pg.test.js: SKIP (DATABASE_URL absent)");
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
  const pool = new Pool({ connectionString: isolatedUrl });
  let child = null;
  const results = [];

  function mint(payload) {
    return tokens.createAccessToken({ mustChangePassword: false, ...payload });
  }

  function check(id, title, fn) {
    try {
      fn();
      results.push({ id, title, status: "PASS" });
    } catch (error) {
      results.push({ id, title, status: "RED", message: error.message });
    }
  }

  try {
    await repo.init();
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    const fixture = await seed(repo.pool);
    const studentCodesByName = Object.fromEntries(
      (
        await pool.query(
          `SELECT first_name, student_code, id::text AS uuid FROM students ORDER BY first_name`,
        )
      ).rows.map((row) => [row.first_name, { code: row.student_code, uuid: row.uuid }]),
    );
    const maevaKeys = [
      studentCodesByName.Maeva?.code,
      studentCodesByName.Maeva?.uuid,
      "STU-MAEVA",
    ].filter(Boolean);
    const siblingKeys = [
      studentCodesByName.Sibling?.code,
      studentCodesByName.Sibling?.uuid,
      "STU-SIB",
    ].filter(Boolean);
    const aishaKeys = [
      studentCodesByName.Aisha?.code,
      studentCodesByName.Aisha?.uuid,
      "STU-AISHA",
    ].filter(Boolean);
    const studentBKeys = [
      studentCodesByName.Binta?.code,
      studentCodesByName.Binta?.uuid,
      "STU-B1",
    ].filter(Boolean);

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

    const tokenParentA = mint({
      sub: USER_PARENT_A,
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: LOGIN_A,
      permissions: PARENT_PERMS,
      studentIds: maevaKeys,
    });
    const tokenParentTwo = mint({
      sub: USER_PARENT_TWO,
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: LOGIN_A,
      permissions: PARENT_PERMS,
      studentIds: [...maevaKeys, ...siblingKeys],
    });
    const tokenParentEmpty = mint({
      sub: USER_PARENT_EMPTY,
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: LOGIN_A,
      permissions: PARENT_PERMS,
      studentIds: [],
    });
    const tokenParentB = mint({
      sub: USER_PARENT_B,
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: LOGIN_B,
      permissions: PARENT_PERMS,
      studentIds: studentBKeys,
    });
    const tokenParentCanonical = mint({
      sub: USER_PARENT_A,
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: LOGIN_A,
      permissions: PARENT_PERMS,
      studentIds: [],
    });
    const tokenParentForgedJwt = mint({
      sub: USER_PARENT_A,
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: LOGIN_A,
      permissions: PARENT_PERMS,
      studentIds: [...maevaKeys, ...aishaKeys],
    });
    const tokenParentRoleKeysOnly = mint({
      sub: USER_PARENT_A,
      roleKeys: ["PARENT"],
      schoolCode: LOGIN_A,
      permissions: PARENT_PERMS,
      studentIds: [],
    });
    const tokenTeacher = mint({
      sub: USER_TEACHER,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LOGIN_A,
      permissions: STAFF_PERMS,
      assignments: [{ classCode: CLASS_2A, classId: fixture.class2AId, status: "active" }],
    });
    const tokenAdmin = mint({
      sub: USER_ADMIN,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LOGIN_A,
      permissions: STAFF_PERMS,
    });

    const classesA = await request("/classes", { token: tokenParentA });
    const rosterA = await request(`/classes/${CLASS_2A}/students`, { token: tokenParentA });
    const rosterForged = await request(`/classes/${CLASS_2B}/students`, { token: tokenParentA });
    const presencesA = await request("/presences", { token: tokenParentA });
    const aishaRef = aishaKeys[0] || "STU-AISHA";
    const otherPresences = await request(`/students/${encodeURIComponent(aishaRef)}/presences`, {
      token: tokenParentA,
    });

    check("P0-1-classes", "Parent 1 enfant — GET /classes sans 2ème B ni effectif 4", () => {
      assert.equal(classesA.status, 200, `GET /classes status=${classesA.status}`);
      const rows = unwrapList(classesA.data);
      assert.ok(
        rows.some((row) => String(row.classCode) === CLASS_2A),
        `2ème A absente: ${JSON.stringify(rows)}`,
      );
      assert.equal(
        rows.some((row) => String(row.classCode) === CLASS_2B),
        false,
        `fuite classe 2ème B: ${JSON.stringify(rows)}`,
      );
      assert.equal(
        rows.some((row) => Number(row.students ?? row.studentCount) >= 4),
        false,
        `fuite effectif camarades: ${JSON.stringify(rows)}`,
      );
    });

    check("P0-1-roster", "Parent 1 enfant — GET /classes/CLS-2A/students = Maeva seule", () => {
      assert.ok([200, 403].includes(rosterA.status), `roster status=${rosterA.status}`);
      const codes = studentCodes(rosterA.data);
      assert.equal(codes.length, 1, `roster=${JSON.stringify(rosterA.data)}`);
      assert.ok(
        maevaKeys.includes(codes[0]),
        `attendu Maeva ${JSON.stringify(maevaKeys)}, reçu ${JSON.stringify(codes)}`,
      );
    });

    check("P0-1-presences", "Parent 1 enfant — GET /presences = Maeva seule", () => {
      assert.equal(presencesA.status, 200, `GET /presences status=${presencesA.status}`);
      const ids = presenceStudentIds(presencesA.data);
      assert.ok(
        ids.some((id) => maevaKeys.includes(id)),
        `Maeva absente de /presences: ${JSON.stringify(presencesA.data)} keys=${JSON.stringify(maevaKeys)}`,
      );
      assert.ok(ids.every((id) => maevaKeys.includes(id)), `presences=${JSON.stringify(presencesA.data)}`);
      assert.equal(ids.includes("STU-AISHA") || ids.includes("STU-JEAN") || ids.includes("STU-LUC"), false);
      assert.equal(presenceIds(presencesA.data).includes(PRES_AISHA), false);
      assert.equal(presenceIds(presencesA.data).includes(PRES_MAEVA), true);
    });

    check("P0-3", "Parent ne lit jamais la présence d'un autre élève par studentId", () => {
      const rows = unwrapList(otherPresences.data);
      assert.ok(
        otherPresences.status === 403 || rows.length === 0,
        `GET /students/STU-AISHA/presences status=${otherPresences.status} body=${JSON.stringify(otherPresences.data)}`,
      );
      assert.equal(
        rows.some((row) => String(row.id) === PRES_AISHA || String(row.studentId) === "STU-AISHA"),
        false,
      );
    });

    check("P0-4", "classCode 2ème B forgé — pas de roster", () => {
      const codes = studentCodes(rosterForged.data);
      assert.ok(
        rosterForged.status === 403 || codes.length === 0,
        `forged class status=${rosterForged.status} body=${JSON.stringify(rosterForged.data)}`,
      );
      assert.equal(codes.includes("STU-SIB"), false);
    });

    const classesTwo = await request("/classes", { token: tokenParentTwo });
    const rosterTwo = await request(`/classes/${CLASS_2A}/students`, { token: tokenParentTwo });
    const rosterTwoB = await request(`/classes/${CLASS_2B}/students`, { token: tokenParentTwo });
    const presencesTwo = await request("/presences", { token: tokenParentTwo });

    check("P0-2-roster", "Parent 2 enfants — roster 2ème A = Maeva seule", () => {
      const codes = studentCodes(rosterTwo.data);
      assert.equal(codes.length, 1, JSON.stringify(rosterTwo.data));
      assert.ok(maevaKeys.includes(codes[0]), JSON.stringify(rosterTwo.data));
    });
    check("P0-2-roster-b", "Parent 2 enfants — roster 2ème B = Sibling seul", () => {
      const codes = studentCodes(rosterTwoB.data);
      assert.equal(codes.length, 1, JSON.stringify(rosterTwoB.data));
      assert.ok(siblingKeys.includes(codes[0]), JSON.stringify(rosterTwoB.data));
    });
    check("P0-2-presences", "Parent 2 enfants — présences Maeva + Sibling uniquement", () => {
      const ids = presenceStudentIds(presencesTwo.data);
      assert.ok(ids.some((id) => maevaKeys.includes(id)), `Maeva absente: ${JSON.stringify(presencesTwo.data)}`);
      assert.ok(ids.some((id) => siblingKeys.includes(id)), `Sibling absent: ${JSON.stringify(presencesTwo.data)}`);
      assert.equal(ids.some((id) => ["STU-AISHA", "STU-JEAN", "STU-LUC"].includes(id)), false);
      assert.equal(ids.some((id) => studentBKeys.includes(id)), false);
    });
    check("P0-2-classes", "Parent 2 enfants — GET /classes sans effectif camarades", () => {
      const rows = unwrapList(classesTwo.data);
      assert.equal(
        rows.some((row) => Number(row.students ?? row.studentCount) >= 4),
        false,
        JSON.stringify(rows),
      );
    });

    check("P0-5", "attendanceId d'un autre enfant inaccessible via GET /presences", () => {
      assert.equal(presenceIds(presencesA.data).includes(PRES_AISHA), false);
      assert.equal(presenceIds(presencesA.data).includes(PRES_JEAN), false);
      assert.equal(presenceIds(presencesA.data).includes(PRES_LUC), false);
    });

    const classesEmpty = await request("/classes", { token: tokenParentEmpty });
    const rosterEmpty = await request(`/classes/${CLASS_2A}/students`, { token: tokenParentEmpty });
    const presencesEmpty = await request("/presences", { token: tokenParentEmpty });

    check("P0-6-classes", "Parent sans enfant — GET /classes = 0 classe", () => {
      assert.equal(unwrapList(classesEmpty.data).length, 0, JSON.stringify(classesEmpty.data));
    });
    check("P0-6-roster", "Parent sans enfant — roster 403 ou []", () => {
      const codes = studentCodes(rosterEmpty.data);
      assert.ok(rosterEmpty.status === 403 || codes.length === 0, JSON.stringify(rosterEmpty.data));
    });
    check("P0-6-presences", "Parent sans enfant — GET /presences = []", () => {
      assert.deepEqual(unwrapList(presencesEmpty.data), []);
    });

    const classesTeacher = await request("/classes", { token: tokenTeacher });
    const rosterTeacher2B = await request(`/classes/${CLASS_2B}/students`, { token: tokenTeacher });
    const presencesTeacher = await request("/presences", { token: tokenTeacher });

    check("P0-7-classes", "Enseignant — GET /classes = 2ème A seulement", () => {
      const codes = unwrapList(classesTeacher.data).map((row) => String(row.classCode));
      assert.deepEqual(codes, [CLASS_2A], JSON.stringify(classesTeacher.data));
    });
    check("P0-7-roster-b", "Enseignant — 2ème B hors affectation refusée", () => {
      const codes = studentCodes(rosterTeacher2B.data);
      assert.ok(rosterTeacher2B.status === 403 || codes.length === 0, JSON.stringify(rosterTeacher2B.data));
    });
    check("P0-7-presences", "Enseignant — pas de présence 2ème B ni école B", () => {
      const ids = presenceIds(presencesTeacher.data);
      assert.equal(ids.includes(PRES_SIB), false);
      assert.equal(ids.includes(PRES_B), false);
    });

    const rosterAdmin = await request(`/classes/${CLASS_2A}/students`, { token: tokenAdmin });
    const presencesAdmin = await request("/presences", { token: tokenAdmin });

    check("P0-8-roster", "Admin établissement — roster 2ème A complet (4)", () => {
      assert.equal(rosterAdmin.status, 200);
      assert.equal(studentCodes(rosterAdmin.data).length, 4, JSON.stringify(rosterAdmin.data));
    });
    check("P0-8-presences", "Admin établissement — présences école A, jamais B", () => {
      const ids = presenceIds(presencesAdmin.data);
      assert.ok(ids.includes(PRES_MAEVA) && ids.includes(PRES_AISHA));
      assert.equal(ids.includes(PRES_B), false);
    });

    const classesB = await request("/classes", { token: tokenParentB });
    const rosterBOnA = await request(`/classes/${CLASS_2A}/students`, { token: tokenParentB });
    const presencesB = await request("/presences", { token: tokenParentB });

    check("P0-9-classes", "Parent école B — jamais les classes de A", () => {
      const codes = unwrapList(classesB.data).map((row) => String(row.classCode));
      assert.equal(codes.includes(CLASS_2A) || codes.includes(CLASS_2B), false, JSON.stringify(classesB.data));
    });
    check("P0-9-roster", "Parent école B — roster 2ème A inaccessible", () => {
      const codes = studentCodes(rosterBOnA.data);
      assert.ok(rosterBOnA.status === 403 || codes.length === 0);
      assert.equal(codes.includes("STU-MAEVA"), false);
    });
    check("P0-9-presences", "Parent école B — jamais les présences de A", () => {
      const ids = presenceIds(presencesB.data);
      assert.equal(ids.includes(PRES_MAEVA) || ids.includes(PRES_AISHA), false);
    });

    const classesCanonical = await request("/classes", { token: tokenParentCanonical });
    const rosterCanonical = await request(`/classes/${CLASS_2A}/students`, { token: tokenParentCanonical });
    const presencesCanonical = await request("/presences", { token: tokenParentCanonical });
    const rosterForgedJwt = await request(`/classes/${CLASS_2A}/students`, { token: tokenParentForgedJwt });
    const presencesForgedJwt = await request("/presences", { token: tokenParentForgedJwt });
    const rosterRoleKeys = await request(`/classes/${CLASS_2A}/students`, { token: tokenParentRoleKeysOnly });
    const presencesRoleKeys = await request("/presences", { token: tokenParentRoleKeysOnly });

    check("P0-10-classes", "contact_relations sans studentIds JWT — GET /classes = 2ème A seule", () => {
      assert.equal(classesCanonical.status, 200, `status=${classesCanonical.status}`);
      const rows = unwrapList(classesCanonical.data);
      assert.ok(rows.some((row) => String(row.classCode) === CLASS_2A), JSON.stringify(rows));
      assert.equal(rows.some((row) => String(row.classCode) === CLASS_2B), false, JSON.stringify(rows));
    });
    check("P0-10-roster", "contact_relations sans studentIds JWT — roster = Maeva seule", () => {
      assert.equal(rosterCanonical.status, 200, `status=${rosterCanonical.status}`);
      const codes = studentCodes(rosterCanonical.data);
      assert.equal(codes.length, 1, JSON.stringify(rosterCanonical.data));
      assert.ok(maevaKeys.includes(codes[0]), JSON.stringify(codes));
    });
    check("P0-10-presences", "contact_relations sans studentIds JWT — présences = Maeva seule", () => {
      assert.equal(presencesCanonical.status, 200);
      const ids = presenceStudentIds(presencesCanonical.data);
      assert.ok(ids.some((id) => maevaKeys.includes(id)), JSON.stringify(presencesCanonical.data));
      assert.ok(ids.every((id) => maevaKeys.includes(id)), JSON.stringify(presencesCanonical.data));
      assert.equal(presenceIds(presencesCanonical.data).includes(PRES_MAEVA), true);
    });
    check("P0-11-roster", "JWT camarade + contact_relations Maeva — pas d'Aisha au roster", () => {
      const codes = studentCodes(rosterForgedJwt.data);
      assert.equal(codes.length, 1, JSON.stringify(rosterForgedJwt.data));
      assert.ok(maevaKeys.includes(codes[0]), JSON.stringify(codes));
      assert.equal(codes.some((code) => aishaKeys.includes(code)), false);
    });
    check("P0-11-presences", "JWT camarade + contact_relations Maeva — pas d'Aisha en présences", () => {
      const ids = presenceStudentIds(presencesForgedJwt.data);
      assert.ok(ids.some((id) => maevaKeys.includes(id)), JSON.stringify(presencesForgedJwt.data));
      assert.equal(ids.some((id) => aishaKeys.includes(id)), false);
      assert.equal(presenceIds(presencesForgedJwt.data).includes(PRES_AISHA), false);
    });
    check("P0-12-roleKeys", "roleKeys PARENT sans libellé role — Maeva seule", () => {
      const codes = studentCodes(rosterRoleKeys.data);
      assert.equal(rosterRoleKeys.status, 200, `status=${rosterRoleKeys.status}`);
      assert.equal(codes.length, 1, JSON.stringify(rosterRoleKeys.data));
      assert.ok(maevaKeys.includes(codes[0]), JSON.stringify(codes));
      const ids = presenceStudentIds(presencesRoleKeys.data);
      assert.ok(ids.some((id) => maevaKeys.includes(id)), JSON.stringify(presencesRoleKeys.data));
      assert.ok(ids.every((id) => maevaKeys.includes(id)), JSON.stringify(presencesRoleKeys.data));
    });

    const red = results.filter((row) => row.status === "RED");
    console.log("parentAttendanceIsolation.http.pg.test.js matrix:");
    for (const row of results) {
      const extra = row.message ? ` — ${row.message}` : "";
      console.log(`  ${row.status} ${row.id} ${row.title}${extra}`);
    }
    if (red.length) {
      throw new Error(`${red.length} cas RED / ${results.length}`);
    }
    console.log("OK parentAttendanceIsolation.http.pg.test.js");
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
