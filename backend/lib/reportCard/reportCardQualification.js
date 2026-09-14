"use strict";

/**
 * LOT 10 — catalogue de qualification A/B.
 * Charge des fixtures versionnées (profile / schema / template / facts).
 * Aucune branche pays/école : le moteur reste `computeReportCard`.
 */

const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_ID } = require("../../contracts/reportCard/contract");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const { validateSpec: validateProfileSpec, specSha256: profileSpecSha256 } = require("./academicRuleProfile");
const { validateSpec: validateSchemaSpec, specSha256: schemaSpecSha256 } = require("./reportCardSchema");
const { normalizeRenderingTemplate, specSha256: templateSpecSha256 } = require("./renderingTemplate");
const { computeReportCard } = require("./reportCardEngine");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { createReportCardConfiguration, createInMemoryConfigurationPersistence } = require("./reportCardConfiguration");
const { createReportCardPublication } = require("./reportCardPublication");
const { createReportCardInitialPublication } = require("./reportCardInitialPublication");
const { createReportCardFactsPgStore } = require("../../db/reportCardFactsStore");

const QUALIFICATION_A = "fixture.qualification.burundi-model-a";
const QUALIFICATION_B = "fixture.qualification.burundi-model-b";
const CATALOG_DIR = path.join(__dirname, "qualification");
const IT_DB = "somafrik_report_card_lot10_it";

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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

function catalogFiles() {
  return fs
    .readdirSync(CATALOG_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(CATALOG_DIR, name));
}

function readCatalogEntry(id) {
  for (const file of catalogFiles()) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && raw.id === id) return raw;
  }
  const err = new Error("QUALIFICATION_NOT_FOUND");
  err.code = "QUALIFICATION_NOT_FOUND";
  throw err;
}

function layerRef(base, specSha) {
  return {
    id: String(base.id),
    version: Number(base.version) || 1,
    spec_sha256: specSha,
  };
}

function canonicalCell(cell) {
  return {
    subject_id: cell.subject_id,
    period_id: cell.period_id,
    score_component_id: cell.score_component_id,
    kind: cell.kind,
    internal: cell.internal,
    exposed: cell.exposed,
  };
}

function canonicalSlot(slot) {
  return {
    section_id: slot.section_id,
    column_id: slot.column_id,
    slot: slot.slot,
    period_id: slot.period_id == null ? null : slot.period_id,
    score_component_id: slot.score_component_id == null ? null : slot.score_component_id,
    kind: slot.kind,
    internal: slot.internal,
    exposed: slot.exposed,
    passed: slot.passed == null ? null : slot.passed,
  };
}

function canonicalResult(computedOrPayload) {
  const students = Array.isArray(computedOrPayload?.students) ? computedOrPayload.students : [];
  return students.map((student) => ({
    student_id: student.student_id,
    cells: (Array.isArray(student.cells) ? student.cells : []).map(canonicalCell),
    slots: (Array.isArray(student.slots) ? student.slots : []).map(canonicalSlot),
  }));
}

function hydrateQualification(raw) {
  const profile = validateProfileSpec(raw.profile);
  const schema = validateSchemaSpec(raw.schema);
  const template = normalizeRenderingTemplate(raw.template);
  const facts = Array.isArray(raw.facts) ? raw.facts.map((row) => ({ ...row })) : [];
  const tenant = {
    schoolId: raw.tenant.schoolId,
    actorSchoolId: raw.tenant.actorSchoolId,
  };
  const provenance = {
    profile: layerRef(raw.provenance.profile, profileSpecSha256(profile)),
    schema: layerRef(raw.provenance.schema, schemaSpecSha256(schema)),
    template: layerRef(raw.provenance.template, templateSpecSha256(template)),
  };
  const computed = computeReportCard({
    profile,
    schema,
    facts,
    provenance,
    tenant,
  });
  return {
    id: raw.id,
    title: raw.title,
    engine_id: ENGINE_ID,
    qualification_only: true,
    not_a_country_pack: true,
    modelKey: raw.modelKey,
    profile,
    schema,
    template,
    facts,
    provenance,
    tenant,
    expected: { canonical: canonicalResult(computed) },
  };
}

function loadQualification(id) {
  return hydrateQualification(readCatalogEntry(id));
}

function listQualifications() {
  return catalogFiles()
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")))
    .map((raw) => ({
      id: raw.id,
      title: raw.title,
      engine_id: ENGINE_ID,
      qualification_only: true,
      not_a_country_pack: true,
      modelKey: raw.modelKey,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

async function activateQualificationBinding(configuration, schoolId, { modelKey, profile, schema, templateSpec } = {}) {
  const submitter = {
    actorId: "lot10-submit",
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_SUBMIT_MODEL"],
  };
  const approver = {
    actorId: "lot10-approve",
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_SCHOOL_APPROVE_TEMPLATE"],
  };
  const superadmin = {
    actorId: "lot10-sa",
    permissions: ["REPORT_CARD_CONFIGURE"],
    platform: { privileged: true },
  };
  const submitted = await configuration.submitModel({
    actor: submitter,
    schoolId,
    modelKey,
    description: "lot10 qualification bundle",
  });
  await configuration.startReview({ actor: superadmin, schoolId, requestId: submitted.id });
  await configuration.startConfiguring({ actor: superadmin, schoolId, requestId: submitted.id });
  const template = await configuration.saveRenderingTemplate({
    actor: superadmin,
    schoolId,
    requestId: submitted.id,
    spec: templateSpec,
  });
  await configuration.bindBundle({
    actor: superadmin,
    schoolId,
    requestId: submitted.id,
    profile,
    schema,
    template: { id: template.template_id, version: template.version },
  });
  await configuration.markReadyForReview({ actor: superadmin, schoolId, requestId: submitted.id });
  await configuration.approve({ actor: approver, schoolId, requestId: submitted.id });
  const active = await configuration.activate({
    actor: superadmin,
    schoolId,
    requestId: submitted.id,
    commandId: `act-${modelKey}`,
  });
  return { active, template };
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
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
  const klass = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name)
     VALUES ($1, $2, 'Q10A', 'Qualification A') RETURNING id`,
    [schoolId, year.rows[0].id]
  );
  const teacher = await pool.query("INSERT INTO teachers (school_id, teacher_code) VALUES ($1, 'ENS-Q10') RETURNING id", [
    schoolId,
  ]);
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
    if (fact.raw_score == null || fact.raw_score === "") continue;
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
    await pool.query(
      `INSERT INTO grades (
         school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id,
         grade_type, score, max_score, coefficient, grade_status, publication_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'graded','published')`,
      [
        schoolId,
        sid,
        classId,
        subId,
        teacherId,
        tId,
        evaluationId,
        fact.score_component_id,
        fact.raw_score,
        maxScore,
      ]
    );
  }

  return { yearId, classId };
}

async function publishQualificationPg(pool, qualificationId) {
  const bundle = loadQualification(qualificationId);
  const { Pool } = require("pg");
  const connectionString = pool.options?.connectionString || process.env.DATABASE_URL;
  const isolatedUrl = await ensureIsolatedDatabase(Pool, connectionString, IT_DB);
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
      reportCardId: "rc-lot10-pg",
      classId,
      academicYearId: yearId,
      modelKey: bundle.modelKey,
    });
    const payload = await Promise.resolve(
      publication.payloadForRender({
        tenant,
        reportCardId: "rc-lot10-pg",
        version: 1,
      })
    );
    return { payload };
  } finally {
    await isolated.end();
  }
}

module.exports = {
  QUALIFICATION_A,
  QUALIFICATION_B,
  loadQualification,
  listQualifications,
  canonicalResult,
  activateQualificationBinding,
  publishQualificationPg,
};
