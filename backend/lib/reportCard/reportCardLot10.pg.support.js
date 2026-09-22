"use strict";

/**
 * LOT 10 — harness PG test-only (non exporté en runtime).
 * Isolated DB + DROP SCHEMA public CASCADE. Ne pas importer hors tests.
 */

const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { createReportCardConfiguration, createInMemoryConfigurationPersistence } = require("./reportCardConfiguration");
const { createReportCardPublication } = require("./reportCardPublication");
const { createReportCardInitialPublication } = require("./reportCardInitialPublication");
const { createReportCardFactsPgStore } = require("../../db/reportCardFactsStore");
const { loadQualification, activateQualificationBinding } = require("./reportCardQualification");

const PEDAGOGY_SQL = `
CREATE TABLE academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL
);
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  class_code VARCHAR(64) NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TABLE teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  teacher_code VARCHAR(64) NOT NULL UNIQUE
);
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_code VARCHAR(64) NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL
);
CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  subject_code VARCHAR(64) NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TABLE terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  name TEXT NOT NULL
);
CREATE TABLE evaluation_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  teacher_id UUID REFERENCES teachers(id),
  term_id UUID NOT NULL REFERENCES terms(id),
  title TEXT NOT NULL,
  evaluation_type TEXT NOT NULL DEFAULT 'TJ',
  evaluation_type_id UUID REFERENCES evaluation_types(id),
  status TEXT NOT NULL DEFAULT 'published',
  max_score NUMERIC(8, 2) NOT NULL DEFAULT 20,
  coefficient NUMERIC(8, 2) NOT NULL DEFAULT 1
);
CREATE TABLE grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL REFERENCES students(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  teacher_id UUID NOT NULL REFERENCES teachers(id),
  term_id UUID NOT NULL REFERENCES terms(id),
  evaluation_id UUID REFERENCES evaluations(id),
  grade_type TEXT NOT NULL,
  score NUMERIC(8, 2),
  max_score NUMERIC(8, 2) NOT NULL DEFAULT 20,
  coefficient NUMERIC(8, 2) NOT NULL DEFAULT 1,
  grade_status TEXT NOT NULL DEFAULT 'graded',
  publication_status TEXT NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT grades_status_check CHECK (
    grade_status IN ('graded', 'absent', 'excused', 'not_submitted', 'exempt')
  ),
  CONSTRAINT grades_status_score_coherence CHECK (
    (grade_status = 'graded' AND score IS NOT NULL)
    OR (grade_status <> 'graded' AND score IS NULL)
  )
);
`;

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function isolatedDatabaseName(modelKey) {
  const suffix = String(modelKey || "x").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  return `somafrik_report_card_lot10_it_${suffix}`;
}

async function ensureIsolatedDatabase(Pool, databaseUrl, databaseName) {
  const admin = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function bootFresh(pool) {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(`
    CREATE TABLE schools (
      id UUID PRIMARY KEY,
      school_code TEXT UNIQUE
    )
  `);
  const schoolId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  await pool.query("INSERT INTO schools (id, school_code) VALUES ($1, 'Q10')", [schoolId]);
  await pool.query(PEDAGOGY_SQL);
  await pool.query(require("../../db/reportCardPublicationSql").REPORT_CARD_PUBLICATION_SQL);
  return schoolId;
}

function componentMax(profile, componentId) {
  const component = profile.score_components.find((item) => item.id === componentId);
  return Number(component && component.max) || 20;
}

async function seedQualificationFacts(pool, schoolId, bundle) {
  const year = await pool.query("INSERT INTO academic_years (school_id, name) VALUES ($1, $2) RETURNING id", [
    schoolId,
    "2026",
  ]);
  const classCode = `Q10-${bundle.modelKey}`;
  const klass = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [schoolId, year.rows[0].id, classCode, bundle.modelKey]
  );
  const teacher = await pool.query(
    "INSERT INTO teachers (school_id, teacher_code) VALUES ($1, $2) RETURNING id",
    [schoolId, `ENS-${bundle.modelKey}`]
  );
  const yearId = year.rows[0].id;
  const classId = klass.rows[0].id;
  const teacherId = teacher.rows[0].id;
  const students = new Map();
  const subjects = new Map();
  const terms = new Map();
  const evalTypes = new Map();
  const evaluations = new Map();

  async function studentId(code) {
    if (students.has(code)) return students.get(code);
    const row = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, $2, 'Ada', 'Lovelace') RETURNING id`,
      [schoolId, code]
    );
    students.set(code, row.rows[0].id);
    return row.rows[0].id;
  }

  async function subjectId(code) {
    if (subjects.has(code)) return subjects.get(code);
    const row = await pool.query(
      "INSERT INTO subjects (school_id, subject_code, name) VALUES ($1, $2, $3) RETURNING id",
      [schoolId, code, code]
    );
    subjects.set(code, row.rows[0].id);
    return row.rows[0].id;
  }

  async function termId(name) {
    if (terms.has(name)) return terms.get(name);
    const row = await pool.query("INSERT INTO terms (academic_year_id, name) VALUES ($1, $2) RETURNING id", [
      yearId,
      name,
    ]);
    terms.set(name, row.rows[0].id);
    return row.rows[0].id;
  }

  async function evalTypeId(code) {
    if (evalTypes.has(code)) return evalTypes.get(code);
    const row = await pool.query(
      "INSERT INTO evaluation_types (school_id, code, name) VALUES ($1, $2, $3) RETURNING id",
      [schoolId, code, code]
    );
    evalTypes.set(code, row.rows[0].id);
    return row.rows[0].id;
  }

  for (const fact of bundle.facts) {
    const sid = await studentId(fact.student_id);
    const subId = await subjectId(fact.subject_id);
    const tId = await termId(fact.period_id);
    const typeId = await evalTypeId(fact.score_component_id);
    const evalKey = `${fact.subject_id}\0${fact.period_id}\0${fact.score_component_id}`;
    let evaluationId = evaluations.get(evalKey);
    const maxScore = componentMax(bundle.profile, fact.score_component_id);
    if (!evaluationId) {
      const created = await pool.query(
        `INSERT INTO evaluations (
           school_id, class_id, subject_id, teacher_id, term_id, title,
           evaluation_type, evaluation_type_id, status, max_score, coefficient
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published',$9,1) RETURNING id`,
        [
          schoolId,
          classId,
          subId,
          teacherId,
          tId,
          `${fact.score_component_id} ${fact.subject_id} ${fact.period_id}`,
          fact.score_component_id,
          typeId,
          maxScore,
        ]
      );
      evaluationId = created.rows[0].id;
      evaluations.set(evalKey, evaluationId);
    }
    const applicable = fact.subject_applicable !== false && fact.raw_score != null && fact.raw_score !== "";
    await pool.query(
      `INSERT INTO grades (
         school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id,
         grade_type, score, max_score, coefficient, grade_status, publication_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'published')`,
      [
        schoolId,
        sid,
        classId,
        subId,
        teacherId,
        tId,
        evaluationId,
        fact.score_component_id,
        applicable ? fact.raw_score : null,
        maxScore,
        applicable ? 1 : 0,
        applicable ? "graded" : "exempt",
      ]
    );
  }

  return { yearId, classId };
}

async function publishQualificationPg(pool, qualificationId) {
  const bundle = loadQualification(qualificationId);
  const { Pool } = require("pg");
  const connectionString = pool.options?.connectionString || process.env.DATABASE_URL;
  const isolatedUrl = await ensureIsolatedDatabase(Pool, connectionString, isolatedDatabaseName(bundle.modelKey));
  const isolated = new Pool({ connectionString: isolatedUrl, max: 8 });
  try {
    const schoolId = await bootFresh(isolated);
    const { yearId, classId } = await seedQualificationFacts(isolated, schoolId, bundle);
    const profileStore = createAcademicRuleProfileStore();
    const schemaStore = createReportCardSchemaStore();
    const createdP = profileStore.createProfile({
      schoolId,
      actorSchoolId: schoolId,
      profileKey: bundle.modelKey,
      spec: bundle.profile,
      activate: true,
    });
    const createdS = schemaStore.createSchema({
      schoolId,
      actorSchoolId: schoolId,
      schemaKey: bundle.modelKey,
      spec: bundle.schema,
      activate: true,
    });
    const configuration = createReportCardConfiguration({
      profileStore,
      schemaStore,
      persistence: createInMemoryConfigurationPersistence(),
    });
    await activateQualificationBinding(configuration, schoolId, {
      modelKey: bundle.modelKey,
      profile: { id: createdP.profile.id, version: createdP.version.version },
      schema: { id: createdS.schema.id, version: createdS.version.version },
      templateSpec: bundle.template,
    });
    const signingKey = generateSigningKey("rc-ed25519-1");
    const wrapping = generateWrappingKey("rc-wrap-1");
    const { createReportCardPublicationPgStore } = require("../../db/reportCardPublicationPgStore");
    const publication = createReportCardPublication({
      signingKey,
      wrapping,
      wrappingKeys: [wrapping],
      signingKeys: [signingKey],
      store: createReportCardPublicationPgStore(isolated),
    });
    const factsStore = createReportCardFactsPgStore(isolated);
    const initial = createReportCardInitialPublication({ publication, factsStore, configuration });
    const tenant = { schoolId, actorSchoolId: schoolId };
    await initial.publishInitial({
      tenant,
      reportCardId: `rc-lot10-pg-${bundle.modelKey}`,
      classId,
      academicYearId: yearId,
      modelKey: bundle.modelKey,
    });
    const payload = await Promise.resolve(
      publication.payloadForRender({
        tenant,
        reportCardId: `rc-lot10-pg-${bundle.modelKey}`,
        version: 1,
      })
    );
    return { payload };
  } finally {
    await isolated.end();
  }
}

module.exports = {
  publishQualificationPg,
};