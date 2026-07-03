/**
 * Alimente notes et bulletins pour la génération de PDF dans backoffice_state et PostgreSQL.
 *
 * Usage :
 *   node backend/scripts/seed-bulletin-data.js
 *   node backend/scripts/seed-bulletin-data.js --replace-grades
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const { Pool } = require("pg");
const { buildDatabaseUrl } = require("../db/connectionConfig");
const { enrichPlatformBulletinData } = require("../lib/bulletinSeedData");

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const base = buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT;
  if (hostPort && !process.env.POSTGRES_PORT) {
    return base.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return base;
}

function parseDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const match = String(value).match(/^(\d{2})-(\d{2})-(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

async function loadBackOfficeState(client) {
  const result = await client.query(
    "SELECT state_payload FROM backoffice_state WHERE state_key = 'default' LIMIT 1",
  );
  return result.rows[0]?.state_payload ?? null;
}

async function saveBackOfficeState(client, payload) {
  await client.query(
    `INSERT INTO backoffice_state (state_key, state_payload, updated_at)
     VALUES ('default', $1::jsonb, NOW())
     ON CONFLICT (state_key) DO UPDATE SET state_payload = EXCLUDED.state_payload, updated_at = NOW()`,
    [JSON.stringify(payload)],
  );
}

async function syncGradesForSchool(client, schoolCode, notes, students) {
  const school = await client.query("SELECT id FROM schools WHERE school_code = $1 LIMIT 1", [schoolCode]);
  const schoolId = school.rows[0]?.id;
  if (!schoolId) return 0;

  const term = await client.query(
    `SELECT t.id
     FROM terms t
     JOIN academic_years ay ON ay.id = t.academic_year_id
     WHERE ay.school_id = $1 AND t.name = 'Trimestre 1'
     LIMIT 1`,
    [schoolId],
  );
  const termId = term.rows[0]?.id;
  if (!termId) return 0;

  const classRows = await client.query("SELECT id, name FROM classes WHERE school_id = $1", [schoolId]);
  const classByName = new Map(classRows.rows.map((row) => [row.name, row.id]));

  const subjectRows = await client.query("SELECT id, name FROM subjects WHERE school_id = $1", [schoolId]);
  const subjectByName = new Map(subjectRows.rows.map((row) => [row.name, row.id]));

  const teacherRows = await client.query(
    `SELECT t.id, t.teacher_code
     FROM teachers t
     WHERE t.school_id = $1`,
    [schoolId],
  );
  const teacherByCode = new Map(teacherRows.rows.map((row) => [row.teacher_code, row.id]));
  const fallbackTeacherId = teacherRows.rows[0]?.id ?? null;

  const studentRows = await client.query(
    "SELECT id, student_code FROM students WHERE school_id = $1",
    [schoolId],
  );
  const studentByBackOfficeId = new Map();
  students
    .filter((student) => student.schoolCode === schoolCode)
    .forEach((student) => {
      const dbStudent = studentRows.rows.find(
        (row) => row.student_code === student.matricule || row.student_code === student.publicId || row.student_code === student.id,
      );
      if (dbStudent) {
        studentByBackOfficeId.set(student.id, dbStudent.id);
      }
    });

  await client.query("DELETE FROM grades WHERE school_id = $1", [schoolId]);

  let inserted = 0;
  for (const note of notes.filter((item) => item.schoolCode === schoolCode || !item.schoolCode)) {
    const student = students.find((item) => item.id === note.studentId);
    const studentId = studentByBackOfficeId.get(note.studentId);
    const classId = student ? classByName.get(student.className) : null;
    const subjectId = subjectByName.get(note.subject);
    const teacherId = teacherByCode.get(note.authorId) ?? fallbackTeacherId;
    if (!studentId || !classId || !subjectId || !teacherId) continue;

    await client.query(
      `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, grade_type, score, max_score, coefficient, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        schoolId,
        studentId,
        classId,
        subjectId,
        teacherId,
        termId,
        note.evaluationCoefficient && note.evaluationCoefficient > 1 ? "controle" : "devoir",
        note.value,
        note.scale ?? 20,
        note.evaluationCoefficient ?? 1,
        note.evaluationId ?? "",
      ],
    );
    inserted += 1;
  }

  return inserted;
}

async function main() {
  const replaceGrades = process.argv.includes("--replace-grades");
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const currentState = await loadBackOfficeState(client);

    if (!currentState || !Array.isArray(currentState.students) || currentState.students.length === 0) {
      throw new Error("backoffice_state introuvable ou sans élèves. Lancez d'abord db:seed-bulk.");
    }

    const nextState = enrichPlatformBulletinData(currentState, ["Trimestre 1"]);
    await saveBackOfficeState(client, nextState);

    let gradesInserted = 0;
    if (replaceGrades) {
      const schoolCodes = [...new Set(nextState.students.map((student) => student.schoolCode).filter(Boolean))];
      for (const schoolCode of schoolCodes) {
        gradesInserted += await syncGradesForSchool(client, schoolCode, nextState.notes, nextState.students);
      }
    }

    await client.query("COMMIT");

    console.log("Bulletins alimentés avec succès.");
    console.log(`  Notes : ${nextState.notes.length}`);
    console.log(`  Bulletins : ${nextState.bulletins.length}`);
    if (replaceGrades) {
      console.log(`  Notes PostgreSQL (grades) : ${gradesInserted}`);
    } else {
      console.log("  Astuce : relancez avec --replace-grades pour synchroniser la table grades.");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
