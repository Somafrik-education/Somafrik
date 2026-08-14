"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createTxAdapter } = require("../db/txAdapter");
const { CLIENTS_SCHEMA_SQL } = require("../db/clientsSchema");
const { EDUCATION_REFERENCE_SCHEMA_SQL } = require("../db/educationReferenceSchema");
const { ESTABLISHMENT_ROLES_SCHEMA_SQL } = require("../db/establishmentRolesSchema");
const { DOCUMENTS_EXAMS_SCHEMA_SQL, assertDocumentsExamsSchemaPreflight } = require("../db/documentsExamsSchema");
const { createDocumentsExamsPgStore } = require("../db/documentsExamsPgStore");
const {
  createExam,
  validateExam,
  cancelExam,
  generateReportCard,
  publishReportCard,
  archiveReportCard,
  upsertTemplate,
  archiveTemplate,
  createSchoolDocument,
  archiveSchoolDocument,
  runDocumentsExamsCanonicalBoot,
  ensureDocumentsExamsConstraints,
} = require("./documentsExamsService");
const { DOCUMENTS_EXAMS_ERROR } = require("./documentsExamsManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_DOCUMENTS_EXAMS_IT_DATABASE ?? "somafrik_documents_exams_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureDatabase(databaseUrl, databaseName) {
  const maintenance = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenance });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function createRepo(pool) {
  const repo = {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    getSchoolByCode: async (code) =>
      repo.one(`SELECT s.id, s.school_code FROM schools s WHERE upper(s.school_code) = upper($1)`, [code]),
    getDocumentsExamsStore() {
      return createDocumentsExamsPgStore(repo);
    },
    createTxScope(tx) {
      if (!tx) return repo;
      const scoped = {
        ...repo,
        query: (sql, params) => tx.query(sql, params),
        one: async (sql, params) => (await tx.query(sql, params)).rows[0] ?? null,
        all: async (sql, params) => (await tx.query(sql, params)).rows,
        recordAudit: async (payload) => {
          if (payload.newValue?.name === "AuditRollback") throw new Error("audit failed");
          if (payload.newValue?.title === "AuditRollback") throw new Error("audit failed");
          await tx.query(
            `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [null, null, payload.action, payload.entityType, payload.entityId, null, JSON.stringify(payload.newValue ?? {})],
          );
        },
      };
      scoped.getDocumentsExamsStore = () => createDocumentsExamsPgStore(scoped);
      return scoped;
    },
    withTransaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = createTxAdapter(client);
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return repo;
}

const adminA = {
  role: "Admin School",
  sub: "admin-a",
  schoolCode: "CD-2026-0001",
  permissions: ["Organiser examens", "Valider examens", "Bulletins:UPDATE", "Documents:UPDATE", "Conception bulletins"],
};
const adminB = {
  role: "Admin School",
  sub: "admin-b",
  schoolCode: "BI-2026-0002",
  permissions: ["Organiser examens", "Valider examens", "Bulletins:UPDATE", "Documents:UPDATE"],
};

async function resetBaseSchema(pool) {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
  await pool.query(CLIENTS_SCHEMA_SQL);
  await pool.query(EDUCATION_REFERENCE_SCHEMA_SQL);
  await pool.query(ESTABLISHMENT_ROLES_SCHEMA_SQL);
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/migrations/20260814_residual_state_canonical.sql"), "utf8"));
  await pool.query(DOCUMENTS_EXAMS_SCHEMA_SQL);
}

async function seedSchools(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, 'CD-2026-0001', 'Lycée A', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, 'BI-2026-0002', 'Lycée B', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  return { schoolAId: schoolA.rows[0].id, schoolBId: schoolB.rows[0].id };
}

async function seedAcademic(pool, schoolId, { closedYear = false } = {}) {
  const year = await pool.query(
    `INSERT INTO academic_years (school_id, name, status, is_current)
     VALUES ($1, '2025-2026', $2, TRUE) RETURNING id`,
    [schoolId, closedYear ? "closed" : "open"],
  );
  const term = await pool.query(
    `INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open') RETURNING id`,
    [year.rows[0].id],
  );
  const klass = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-6A', '6ème A', 'active') RETURNING id`,
    [schoolId, year.rows[0].id],
  );
  const subject = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
     VALUES ($1, 'SUB-MATH', 'Mathématiques', 2, 'active') RETURNING id`,
    [schoolId],
  );
  return {
    yearId: year.rows[0].id,
    termId: term.rows[0].id,
    classId: klass.rows[0].id,
    subjectId: subject.rows[0].id,
  };
}

async function seedStudent(pool, schoolId, classId, yearId) {
  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'ELE-LOT5-1', 'Jean', 'Dupont', 'active') RETURNING id`,
    [schoolId],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [schoolId, student.rows[0].id, classId, yearId],
  );
  return student.rows[0].id;
}

async function insertResidual(pool, schoolId, domain, legacyId, payload) {
  await pool.query(
    `INSERT INTO establishment_residual_records (school_id, record_domain, legacy_json_id, profile_payload, status)
     VALUES ($1, $2, $3, $4::jsonb, 'active')`,
    [schoolId, domain, legacyId, JSON.stringify(payload)],
  );
}

async function testExamCanonicalFlow(pool) {
  await resetBaseSchema(pool);
  const { schoolAId, schoolBId } = await seedSchools(pool);
  const refsA = await seedAcademic(pool, schoolAId);
  const refsB = await seedAcademic(pool, schoolBId);
  const repo = createRepo(pool);
  const exam = await createExam(
    repo,
    {
      name: "Contrôle T1 Math",
      classId: refsA.classId,
      subjectId: refsA.subjectId,
      termId: refsA.termId,
      date: "2026-06-10",
      schoolCode: "BI-2026-0002",
    },
    adminA,
    {},
  );
  assert.equal(exam.schoolCode, "CD-2026-0001");
  assert.equal(exam.className, "6ème A");
  assert.equal(exam.subject, "Mathématiques");
  assert.equal(exam.statusCode, "scheduled");

  await assert.rejects(
    () => createExam(repo, { name: "X", classId: refsB.classId, subjectId: refsA.subjectId, termId: refsA.termId, date: "2026-06-11" }, adminA, {}),
    (error) => error.statusCode === 404,
  );
  await assert.rejects(
    () => createExam(repo, { name: "X", classId: refsA.classId, subjectId: refsB.subjectId, termId: refsA.termId, date: "2026-06-11" }, adminA, {}),
    (error) => error.statusCode === 404,
  );
  await assert.rejects(
    () =>
      createExam(
        repo,
        { name: "Contrôle T1 Math", classId: refsA.classId, subjectId: refsA.subjectId, termId: refsA.termId, date: "2026-06-10" },
        adminA,
        {},
      ),
    (error) => error.code === DOCUMENTS_EXAMS_ERROR.CONFLICT && error.statusCode === 409,
  );

  const validated = await validateExam(repo, exam.id, adminA, {});
  assert.equal(validated.statusCode, "validated");
  const cancelled = await cancelExam(repo, exam.id, adminA, {});
  assert.equal(cancelled.statusCode, "cancelled");

  await assert.rejects(
    () => createExam(repo, { name: "Ghost", classId: refsA.classId, subjectId: refsA.subjectId, termId: refsA.termId, date: "2026-06-12" }, adminB, {}),
    (error) => error.statusCode === 404,
  );

  await assert.rejects(
    () => createExam(repo, { name: "AuditRollback", classId: refsA.classId, subjectId: refsA.subjectId, termId: refsA.termId, date: "2026-07-01" }, adminA, {}),
    /audit failed/,
  );
  const leftover = await pool.query(`SELECT id FROM exams WHERE name = 'AuditRollback'`);
  assert.equal(leftover.rowCount, 0);
}

async function testClosedYearRejected(pool) {
  await resetBaseSchema(pool);
  const { schoolAId } = await seedSchools(pool);
  const refs = await seedAcademic(pool, schoolAId, { closedYear: true });
  const repo = createRepo(pool);
  await assert.rejects(
    () =>
      createExam(
        repo,
        {
          name: "Hors année",
          classId: refs.classId,
          subjectId: refs.subjectId,
          academicYearId: refs.yearId,
          termId: refs.termId,
          date: "2026-06-10",
        },
        adminA,
        {},
      ),
    (error) => error.statusCode === 409,
  );
}

async function testExactResidualStrip(pool) {
  await resetBaseSchema(pool);
  const { schoolAId } = await seedSchools(pool);
  const refs = await seedAcademic(pool, schoolAId);
  const repo = createRepo(pool);
  const exam = await createExam(
    repo,
    { name: "Contrôle T1 Math", classId: refs.classId, subjectId: refs.subjectId, termId: refs.termId, date: "2026-06-10" },
    adminA,
    {},
  );
  await insertResidual(pool, schoolAId, "exam", "EX-JSON-1", {
    name: "Contrôle T1 Math",
    className: "6ème A",
    subject: "Mathématiques",
    date: "2026-06-10",
    period: "Trimestre 1",
  });
  await runDocumentsExamsCanonicalBoot(repo, { info() {} });
  const residual = await pool.query(
    `SELECT archived_at FROM establishment_residual_records WHERE school_id = $1 AND record_domain = 'exam'`,
    [schoolAId],
  );
  assert.ok(residual.rows[0].archived_at);
  const still = await pool.query(`SELECT id FROM exams WHERE id = $1`, [exam.id]);
  assert.equal(still.rowCount, 1);
  const recreated = await pool.query(
    `SELECT count(*)::int AS n FROM establishment_residual_records WHERE school_id = $1 AND record_domain = 'exam' AND archived_at IS NULL`,
    [schoolAId],
  );
  assert.equal(recreated.rows[0].n, 0);
}

async function testAmbiguousResidualStops(pool) {
  await resetBaseSchema(pool);
  const { schoolAId } = await seedSchools(pool);
  await seedAcademic(pool, schoolAId);
  await insertResidual(pool, schoolAId, "exam", "EX-AMBIG", {
    name: "Contrôle fantôme",
    className: "Classe inventée",
    subject: "Matière inventée",
    date: "2026-06-10",
  });
  const repo = createRepo(pool);
  await assertDocumentsExamsSchemaPreflight(repo);
  await assert.rejects(
    () => ensureDocumentsExamsConstraints(repo, { info() {} }),
    (error) => error.code === DOCUMENTS_EXAMS_ERROR.LEGACY_EXAMS_AMBIGUOUS,
  );
  const residual = await pool.query(
    `SELECT archived_at FROM establishment_residual_records WHERE legacy_json_id = 'EX-AMBIG'`,
  );
  assert.equal(residual.rows[0].archived_at, null);
}

async function testReportCards(pool) {
  await resetBaseSchema(pool);
  const { schoolAId, schoolBId } = await seedSchools(pool);
  const refs = await seedAcademic(pool, schoolAId);
  const studentId = await seedStudent(pool, schoolAId, refs.classId, refs.yearId);
  const teacher = await pool.query(
    `INSERT INTO teachers (school_id, teacher_code, status) VALUES ($1, 'ENS-LOT5', 'active') RETURNING id`,
    [schoolAId],
  );
  const evaluation = await pool.query(
    `INSERT INTO evaluations (school_id, class_id, subject_id, teacher_id, term_id, title, evaluation_type, max_score, status)
     VALUES ($1, $2, $3, $4, $5, 'Devoir 1', 'devoir', 20, 'published') RETURNING id`,
    [schoolAId, refs.classId, refs.subjectId, teacher.rows[0].id, refs.termId],
  );
  await pool.query(
    `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id, grade_type, score, max_score, grade_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'devoir', 14, 20, 'graded')`,
    [schoolAId, studentId, refs.classId, refs.subjectId, teacher.rows[0].id, refs.termId, evaluation.rows[0].id],
  );
  const repo = createRepo(pool);
  const card = await generateReportCard(repo, { studentId, termId: refs.termId }, adminA, {});
  assert.equal(card.status, "generated");
  assert.equal(card.average, 14);
  const snapshot = await pool.query(`SELECT * FROM report_cards WHERE id = $1`, [card.id]);
  assert.equal("average" in snapshot.rows[0], false);
  const published = await publishReportCard(repo, card.id, adminA, {});
  assert.equal(published.status, "published");
  const archived = await archiveReportCard(repo, card.id, adminA, {});
  assert.equal(archived.status, "archived");

  await assert.rejects(
    () => generateReportCard(repo, { studentId, termId: refs.termId }, adminB, {}),
    (error) => error.statusCode === 404,
  );
  void schoolBId;

  await insertResidual(pool, schoolAId, "bulletin", "BUL-AMBIG", { studentId: "inconnu", period: "Trimestre 9" });
  await assert.rejects(
    () => ensureDocumentsExamsConstraints(repo, { info() {} }),
    (error) => error.code === DOCUMENTS_EXAMS_ERROR.LEGACY_REPORT_CARDS_AMBIGUOUS,
  );
}

async function testTemplatesAndDocuments(pool) {
  await resetBaseSchema(pool);
  const { schoolAId } = await seedSchools(pool);
  const refs = await seedAcademic(pool, schoolAId);
  const repo = createRepo(pool);
  const schoolTemplate = await upsertTemplate(repo, { templateType: "bulletin", layout: { reportTitle: "Bulletin école" } }, adminA, {});
  assert.equal(schoolTemplate.templateType, "bulletin");
  const classTemplate = await upsertTemplate(
    repo,
    { classId: refs.classId, templateType: "bulletin", layout: { reportTitle: "Bulletin 6A", showRank: true } },
    adminA,
    {},
  );
  assert.equal(classTemplate.classId, refs.classId);
  const updated = await upsertTemplate(
    repo,
    { classId: refs.classId, templateType: "bulletin", layout: { reportTitle: "Bulletin 6A v2" } },
    adminA,
    {},
  );
  assert.equal(updated.version, 2);
  await assert.rejects(
    () => upsertTemplate(repo, { layout: { grades: [1] } }, adminA, {}),
    (error) => error.code === DOCUMENTS_EXAMS_ERROR.INVALID_LAYOUT,
  );
  const archivedTemplate = await archiveTemplate(repo, classTemplate.id, adminA, {});
  assert.equal(archivedTemplate.status, "archived");

  const document = await createSchoolDocument(repo, { title: "Attestation", documentType: "attestation" }, adminA, {});
  assert.equal(document.title, "Attestation");
  const archivedDoc = await archiveSchoolDocument(repo, document.id, adminA, {});
  assert.equal(archivedDoc.status, "archived");

  await assert.rejects(
    () => createSchoolDocument(repo, { title: "AuditRollback", documentType: "attestation" }, adminA, {}),
    /audit failed/,
  );
  const leftover = await pool.query(`SELECT id FROM school_documents WHERE title = 'AuditRollback'`);
  assert.equal(leftover.rowCount, 0);

  await insertResidual(pool, schoolAId, "document", "DOC-AMBIG", { title: "Fantôme" });
  await assert.rejects(
    () => ensureDocumentsExamsConstraints(repo, { info() {} }),
    (error) => error.code === DOCUMENTS_EXAMS_ERROR.LEGACY_DOCUMENTS_AMBIGUOUS,
  );
}

async function main() {
  if (!DATABASE_URL) {
    console.log("documentsExams.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const isolatedUrl = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await testExamCanonicalFlow(pool);
    await testClosedYearRejected(pool);
    await testExactResidualStrip(pool);
    await testAmbiguousResidualStops(pool);
    await testReportCards(pool);
    await testTemplatesAndDocuments(pool);
    console.log("documentsExams.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
