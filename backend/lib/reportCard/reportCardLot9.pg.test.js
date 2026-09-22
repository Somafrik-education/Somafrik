"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const { createReportCardCorrection } = require("./reportCardCorrection");
const { validateSpec: validateProfileSpec } = require("./academicRuleProfile");
const { specSha256 } = require("./academicRuleProfile");
const { validateSpec: validateSchemaSpec } = require("./reportCardSchema");
const { computeReportCard } = require("./reportCardEngine");
const { weightedAverage } = require("../gradesCanonical");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { createReportCardHttpBindings } = require("../reportCardHttpRuntime");
const { createInMemoryConfigurationPersistence } = require("./reportCardConfiguration");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
let Pool = null;
try {
  ({ Pool } = require("pg"));
} catch {
  Pool = null;
}
const shouldRun = Boolean(DATABASE_URL && Pool);
if (process.env.CI && !shouldRun) {
  throw new Error("DATABASE_URL + pg requis en CI pour report-card-lot9 PG");
}

const IT_DB = String(process.env.SOMAFRIK_REPORT_CARD_LOT9_IT_DATABASE ?? "somafrik_report_card_lot9_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

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

function profileSpec(componentMax = 20) {
  return validateProfileSpec({
    periods: ["T1", "T2"],
    annual: true,
    score_components: [{ id: "TJ", applicability: "always", max: componentMax, coefficient: 1 }],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up", stage: "display_only" },
    ranking: { enabled: false, ties: "competition" },
    aggregation: { mode: "weighted_sum", coefficient_default: 1, percentage: "points_over_max_100" },
    pass_rule: { metric: "PERCENTAGE", threshold: 50 },
  });
}

function schemaSpec() {
  return validateSchemaSpec({
    sections: [
      {
        id: "SUBJECTS",
        order: 1,
        kind: "subject_rows",
        columns: [
          {
            id: "COL_T1_TJ",
            order: 1,
            kind: "score_component",
            score_component_id: "TJ",
            period_id: "T1",
          },
        ],
      },
    ],
  });
}

function fact(rawScore) {
  return {
    student_id: "STU-1",
    subject_id: "MATH",
    period_id: "T1",
    score_component_id: "TJ",
    raw_score: rawScore,
    subject_applicable: true,
  };
}

function computedPayload(schoolId, rawScore, provenance, reportCardId = "rc-lot9-1", scope = null, profile = null) {
  const result = computeReportCard({
    profile: profile || profileSpec(),
    schema: schemaSpec(),
    facts: [fact(rawScore)],
    provenance:
      provenance || {
        profile: { id: "P", version: 1, spec_sha256: "aa" },
        schema: { id: "S", version: 1, spec_sha256: "bb" },
      },
    tenant: { schoolId, actorSchoolId: schoolId },
  });
  const payload = {
    report_card_id: reportCardId,
    published_snapshot_version: 1,
    school_id: schoolId,
    published_at: "2026-09-14T00:00:00.000Z",
    engine_id: result.engine_id,
    provenance: result.provenance,
    students: result.students,
  };
  payload.academic_year_id = (scope && scope.academicYearId) || "year-1";
  payload.class_id = (scope && scope.classId) || "class-1";
  return payload;
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((done, fail) => server.close((err) => (err ? fail(err) : done()))),
      });
    });
    server.on("error", reject);
  });
}

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
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL REFERENCES students(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  attendance_date DATE NOT NULL,
  status TEXT NOT NULL
);
`;

async function bootFresh(pool, { pedagogy = false } = {}) {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(`
    CREATE TABLE schools (
      id UUID PRIMARY KEY,
      school_code TEXT UNIQUE
    )
  `);
  const schoolA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  await pool.query("INSERT INTO schools (id, school_code) VALUES ($1, 'A')", [schoolA]);
  if (pedagogy) await pool.query(PEDAGOGY_SQL);
  const sql = require("../../db/reportCardPublicationSql").REPORT_CARD_PUBLICATION_SQL;
  await pool.query(sql);
  return schoolA;
}

function bootKeys() {
  const signingKey = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  return { signingKey, wrapping };
}

function bootPublication(pool, keys) {
  const { createReportCardPublicationPgStore } = require("../../db/reportCardPublicationPgStore");
  const { createReportCardPublication } = require("./reportCardPublication");
  const store = createReportCardPublicationPgStore(pool);
  const publication = createReportCardPublication({
    signingKey: keys.signingKey,
    wrapping: keys.wrapping,
    wrappingKeys: [keys.wrapping],
    signingKeys: [keys.signingKey],
    store,
  });
  return { store, publication };
}

async function seedPedagogy(pool, schoolA) {
  const year = await pool.query(
    "INSERT INTO academic_years (school_id, name) VALUES ($1, '2026') RETURNING id",
    [schoolA]
  );
  const klass = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name)
     VALUES ($1, $2, '6A', '6e A') RETURNING id`,
    [schoolA, year.rows[0].id]
  );
  const teacher = await pool.query(
    "INSERT INTO teachers (school_id, teacher_code) VALUES ($1, 'ENS-1') RETURNING id",
    [schoolA]
  );
  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name)
     VALUES ($1, 'STU-1', 'Ada', 'Lovelace') RETURNING id`,
    [schoolA]
  );
  const subject = await pool.query(
    "INSERT INTO subjects (school_id, subject_code, name) VALUES ($1, 'MATH', 'Maths') RETURNING id",
    [schoolA]
  );
  const term = await pool.query(
    "INSERT INTO terms (academic_year_id, name) VALUES ($1, 'T1') RETURNING id",
    [year.rows[0].id]
  );
  const evalType = await pool.query(
    "INSERT INTO evaluation_types (school_id, code, name) VALUES ($1, 'TJ', 'Travail journalier') RETURNING id",
    [schoolA]
  );
  return {
    yearId: year.rows[0].id,
    classId: klass.rows[0].id,
    teacherId: teacher.rows[0].id,
    studentId: student.rows[0].id,
    subjectId: subject.rows[0].id,
    termId: term.rows[0].id,
    evalTypeId: evalType.rows[0].id,
  };
}

async function insertEvaluation(pool, schoolA, ctx, { title, coefficient = 1, maxScore = 20, status = "published" }) {
  const row = await pool.query(
    `INSERT INTO evaluations (
       school_id, class_id, subject_id, teacher_id, term_id, title,
       evaluation_type, evaluation_type_id, status, max_score, coefficient
     ) VALUES ($1,$2,$3,$4,$5,$6,'TJ',$7,$8,$9,$10) RETURNING id`,
    [
      schoolA,
      ctx.classId,
      ctx.subjectId,
      ctx.teacherId,
      ctx.termId,
      title,
      ctx.evalTypeId,
      status,
      maxScore,
      coefficient,
    ]
  );
  return row.rows[0].id;
}

async function insertGrade(pool, schoolA, ctx, evaluationId, { score, maxScore = 20, coefficient = 1, publicationStatus = "published", updatedAt = "2026-09-10T00:00:00.000Z" }) {
  const row = await pool.query(
    `INSERT INTO grades (
       school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id,
       grade_type, score, max_score, coefficient, grade_status, publication_status, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'TJ',$8,$9,$10,'graded',$11,$12::timestamptz) RETURNING id`,
    [
      schoolA,
      ctx.studentId,
      ctx.classId,
      ctx.subjectId,
      ctx.teacherId,
      ctx.termId,
      evaluationId,
      score,
      maxScore,
      coefficient,
      publicationStatus,
      updatedAt,
    ]
  );
  return row.rows[0].id;
}

async function seedYearClass(pool, schoolA, base, { yearName, classCode, className }) {
  const year = await pool.query(
    "INSERT INTO academic_years (school_id, name) VALUES ($1, $2) RETURNING id",
    [schoolA, yearName]
  );
  const klass = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [schoolA, year.rows[0].id, classCode, className]
  );
  const term = await pool.query(
    "INSERT INTO terms (academic_year_id, name) VALUES ($1, 'T1') RETURNING id",
    [year.rows[0].id]
  );
  return {
    ...base,
    yearId: year.rows[0].id,
    classId: klass.rows[0].id,
    termId: term.rows[0].id,
  };
}

function bootBindings(pool, schoolA, keys, { componentMax = 20, extraProfiles = [] } = {}) {
  const profileStore = createAcademicRuleProfileStore();
  const schemaStore = createReportCardSchemaStore();
  const extraCreated = [];
  for (const extra of extraProfiles) {
    const extraProfile = profileStore.createProfile({
      schoolId: schoolA,
      actorSchoolId: schoolA,
      profileKey: extra.profileKey,
      spec: extra.profileSpec || profileSpec(extra.componentMax || 20),
      activate: true,
    });
    const extraSchema = extra.schemaKey
      ? schemaStore.createSchema({
          schoolId: schoolA,
          actorSchoolId: schoolA,
          schemaKey: extra.schemaKey,
          spec: extra.schemaSpec || schemaSpec(),
          activate: true,
        })
      : null;
    extraCreated.push({ profile: extraProfile, schema: extraSchema });
  }
  const createdP = profileStore.createProfile({
    schoolId: schoolA,
    actorSchoolId: schoolA,
    profileKey: "lot9-pg",
    spec: profileSpec(componentMax),
    activate: true,
  });
  const createdS = schemaStore.createSchema({
    schoolId: schoolA,
    actorSchoolId: schoolA,
    schemaKey: "lot9-pg",
    spec: schemaSpec(),
    activate: true,
  });
  const provenance = {
    profile: {
      id: createdP.profile.id,
      version: createdP.version.version,
      spec_sha256: createdP.version.spec_sha256 || specSha256(createdP.version.spec),
    },
    schema: {
      id: createdS.schema.id,
      version: createdS.version.version,
      spec_sha256: createdS.version.spec_sha256 || specSha256(createdS.version.spec),
    },
    template: { id: "TPL-1", version: 1, spec_sha256: "cc" },
  };
  const env = {
    SOMAFRIK_REPORT_CARD_SIGNING_PRIVATE_KEY_PEM: keys.signingKey.privateKey.export({
      type: "pkcs8",
      format: "pem",
    }),
    SOMAFRIK_REPORT_CARD_SIGNING_KEY_ID: "rc-ed25519-1",
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_B64: keys.wrapping.key.toString("base64"),
    SOMAFRIK_REPORT_CARD_WRAPPING_KEY_ID: "rc-wrap-1",
  };
  const actor = {
    actorId: "pg-prod",
    actorSchoolId: schoolA,
    permissions: ["REPORT_CARD_READ", "REPORT_CARD_REPRINT", "REPORT_CARD_CORRECT", "REPORT_CARD_REVOKE"],
  };
  const app = express();
  app.use(express.json());
  const bindings = createReportCardHttpBindings({
    env,
    resolveActor: () => actor,
    overrides: {
      db: pool,
      profileStore,
      schemaStore,
      configurationPersistence: createInMemoryConfigurationPersistence(),
      keys: {
        signingKey: keys.signingKey,
        wrapping: keys.wrapping,
        wrappingKeys: [keys.wrapping],
        signingKeys: [keys.signingKey],
      },
    },
  });
  const { registerReportCardHttp } = require("./reportCardHttp");
  registerReportCardHttp(app, bindings);
  return {
    app,
    bindings,
    publication: bindings.getPublication(),
    tenant: { schoolId: schoolA, actorSchoolId: schoolA },
    provenance,
    createdP,
    createdS,
    extraCreated,
    profileStore,
    schemaStore,
  };
}

function lot9TemplateSpec() {
  return {
    paper: "A4",
    orientation: "portrait",
    qr_required: true,
    sections: [{ id: "SUBJECTS", order: 1, label: "Disciplines", source: "cells" }],
  };
}

async function activateBoundModel(configuration, schoolId, { modelKey, profile, schema }) {
  const submitter = {
    actorId: "lot9-submit",
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_SUBMIT_MODEL"],
  };
  const approver = {
    actorId: "lot9-approve",
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_SCHOOL_APPROVE_TEMPLATE"],
  };
  const superadmin = {
    actorId: "lot9-sa",
    permissions: ["REPORT_CARD_CONFIGURE"],
    platform: { privileged: true },
  };
  const submitted = await configuration.submitModel({
    actor: submitter,
    schoolId,
    modelKey,
    description: "lot9 bundle",
  });
  await configuration.startReview({ actor: superadmin, schoolId, requestId: submitted.id });
  await configuration.startConfiguring({ actor: superadmin, schoolId, requestId: submitted.id });
  const template = await configuration.saveRenderingTemplate({
    actor: superadmin,
    schoolId,
    requestId: submitted.id,
    spec: lot9TemplateSpec(),
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

async function snapshotCount(pool, schoolA, reportCardId = "rc-lot9-1") {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n FROM report_card_published_snapshots
     WHERE school_id = $1 AND report_card_id = $2`,
    [schoolA, reportCardId]
  );
  return result.rows[0].n;
}

function rejectCode(err) {
  return err && err.code;
}

function assertExclusiveRace(results) {
  const fulfilled = results.filter((row) => row.status === "fulfilled");
  const rejected = results.filter((row) => row.status === "rejected");
  assert.equal(fulfilled.length, 1, JSON.stringify(results.map((row) => row.status + ":" + (row.reason && row.reason.code))));
  assert.equal(rejected.length, 1);
  const code = rejectCode(rejected[0].reason);
  assert.ok(["CONCURRENCY_CONFLICT", "INVALID_TRANSITION"].includes(code), String(code));
  return { fulfilled: fulfilled[0].value, rejected: rejected[0].reason };
}

describe("report-card-lot9 PG correction/revoke serialization", { skip: !shouldRun }, () => {
  test("pg: fresh schema creates correction commands and retries the same commandId", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, IT_DB);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const schoolA = await bootFresh(pool);
      const table = await pool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'report_card_correction_commands'`
      );
      assert.equal(table.rowCount, 1);
      const pk = await pool.query(
        `SELECT a.attname
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = 'report_card_correction_commands'::regclass AND i.indisprimary
         ORDER BY a.attnum`
      );
      assert.deepEqual(
        pk.rows.map((row) => row.attname),
        ["school_id", "report_card_id", "command_id"]
      );
      const keys = bootKeys();
      const { publication } = bootPublication(pool, keys);
      const tenant = { schoolId: schoolA, actorSchoolId: schoolA };
      await publication.publish({ tenant, payload: computedPayload(schoolA, 12) });
      const correction = createReportCardCorrection({
        publication,
        getFacts: async () => [fact(16)],
        getProfile: async () => profileSpec(),
        getSchema: async () => schemaSpec(),
      });
      const first = await correction.correct({
        tenant,
        actor: { actorId: "pg-fresh" },
        reportCardId: "rc-lot9-1",
        sourceVersion: 1,
        reason: "Fresh schema",
        commandId: "cmd-fresh-1",
      });
      const retry = await correction.correct({
        tenant,
        actor: { actorId: "pg-fresh" },
        reportCardId: "rc-lot9-1",
        sourceVersion: 1,
        reason: "Fresh schema",
        commandId: "cmd-fresh-1",
      });
      assert.equal(first.published_snapshot_version, 2);
      assert.equal(retry.public_id, first.public_id);
      assert.equal(retry.published_snapshot_version, 2);
      const commands = await pool.query(
        `SELECT command_id, result_version, public_id FROM report_card_correction_commands
         WHERE school_id = $1 AND report_card_id = $2 AND command_id = $3`,
        [schoolA, "rc-lot9-1", "cmd-fresh-1"]
      );
      assert.equal(commands.rowCount, 1);
      assert.equal(Number(commands.rows[0].result_version), 2);
      assert.equal(commands.rows[0].public_id, first.public_id);
      const versions = await pool.query(
        `SELECT published_snapshot_version FROM report_card_published_snapshots
         WHERE school_id = $1 AND report_card_id = $2`,
        [schoolA, "rc-lot9-1"]
      );
      assert.equal(versions.rowCount, 2);
    } finally {
      await pool.end();
    }
  });

  test("pg: production getFacts reads grades without seeding engine_facts", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, IT_DB);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const schoolA = await bootFresh(pool, { pedagogy: true });
      const engineFacts = await pool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'report_card_engine_facts'`
      );
      assert.equal(engineFacts.rowCount, 0);
      const year = await pool.query(
        "INSERT INTO academic_years (school_id, name) VALUES ($1, '2026') RETURNING id",
        [schoolA]
      );
      const klass = await pool.query(
        `INSERT INTO classes (school_id, academic_year_id, class_code, name)
         VALUES ($1, $2, '6A', '6e A') RETURNING id`,
        [schoolA, year.rows[0].id]
      );
      const teacher = await pool.query(
        "INSERT INTO teachers (school_id, teacher_code) VALUES ($1, 'ENS-1') RETURNING id",
        [schoolA]
      );
      const student = await pool.query(
        `INSERT INTO students (school_id, student_code, first_name, last_name)
         VALUES ($1, 'STU-1', 'Ada', 'Lovelace') RETURNING id`,
        [schoolA]
      );
      const subject = await pool.query(
        "INSERT INTO subjects (school_id, subject_code, name) VALUES ($1, 'MATH', 'Maths') RETURNING id",
        [schoolA]
      );
      const term = await pool.query(
        "INSERT INTO terms (academic_year_id, name) VALUES ($1, 'T1') RETURNING id",
        [year.rows[0].id]
      );
      const evalType = await pool.query(
        "INSERT INTO evaluation_types (school_id, code, name) VALUES ($1, 'TJ', 'Travail journalier') RETURNING id",
        [schoolA]
      );
      const evaluation = await pool.query(
        `INSERT INTO evaluations (
           school_id, class_id, subject_id, teacher_id, term_id, title, evaluation_type, evaluation_type_id
         ) VALUES ($1,$2,$3,$4,$5,'Interro 1','TJ',$6) RETURNING id`,
        [schoolA, klass.rows[0].id, subject.rows[0].id, teacher.rows[0].id, term.rows[0].id, evalType.rows[0].id]
      );
      const grade = await pool.query(
        `INSERT INTO grades (
           school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id,
           grade_type, score, grade_status, publication_status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'TJ',12,'graded','published') RETURNING id`,
        [
          schoolA,
          student.rows[0].id,
          klass.rows[0].id,
          subject.rows[0].id,
          teacher.rows[0].id,
          term.rows[0].id,
          evaluation.rows[0].id,
        ]
      );
      await pool.query(
        `INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status)
         VALUES ($1,$2,$3,'2026-09-01','present')`,
        [schoolA, student.rows[0].id, klass.rows[0].id]
      );
      const profileStore = createAcademicRuleProfileStore();
      const schemaStore = createReportCardSchemaStore();
      const createdP = profileStore.createProfile({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        profileKey: "lot9-pg",
        spec: profileSpec(),
        activate: true,
      });
      const createdS = schemaStore.createSchema({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        schemaKey: "lot9-pg",
        spec: schemaSpec(),
        activate: true,
      });
      const provenance = {
        profile: {
          id: createdP.profile.id,
          version: createdP.version.version,
          spec_sha256: createdP.version.spec_sha256 || specSha256(createdP.version.spec),
        },
        schema: {
          id: createdS.schema.id,
          version: createdS.version.version,
          spec_sha256: createdS.version.spec_sha256 || specSha256(createdS.version.spec),
        },
        template: { id: "TPL-1", version: 1, spec_sha256: "cc" },
      };
      const keys = bootKeys();
      const env = {
        SOMAFRIK_REPORT_CARD_SIGNING_PRIVATE_KEY_PEM: keys.signingKey.privateKey.export({
          type: "pkcs8",
          format: "pem",
        }),
        SOMAFRIK_REPORT_CARD_SIGNING_KEY_ID: "rc-ed25519-1",
        SOMAFRIK_REPORT_CARD_WRAPPING_KEY_B64: keys.wrapping.key.toString("base64"),
        SOMAFRIK_REPORT_CARD_WRAPPING_KEY_ID: "rc-wrap-1",
      };
      const actor = {
        actorId: "pg-prod",
        actorSchoolId: schoolA,
        permissions: ["REPORT_CARD_READ", "REPORT_CARD_REPRINT", "REPORT_CARD_CORRECT", "REPORT_CARD_REVOKE"],
      };
      const app = express();
      app.use(express.json());
      const bindings = createReportCardHttpBindings({
        env,
        resolveActor: () => actor,
        getTemplate: async () => ({
          spec: {
            paper: "A4",
            orientation: "portrait",
            qr_required: true,
            sections: [{ id: "SUBJECTS", order: 1, label: "Disciplines", source: "cells" }],
          },
          spec_sha256: "cc",
        }),
        overrides: {
          db: pool,
          profileStore,
          schemaStore,
          keys: {
            signingKey: keys.signingKey,
            wrapping: keys.wrapping,
            wrappingKeys: [keys.wrapping],
            signingKeys: [keys.signingKey],
          },
        },
      });
      assert.equal(typeof bindings.getFacts, "function");
      const { registerReportCardHttp } = require("./reportCardHttp");
      registerReportCardHttp(app, bindings);
      const publication = bindings.getPublication();
      const tenant = { schoolId: schoolA, actorSchoolId: schoolA };
      const payloadV1 = computedPayload(schoolA, 12, provenance, "rc-lot9-1", {
        academicYearId: year.rows[0].id,
        classId: klass.rows[0].id,
      });
      await publication.publish({ tenant, payload: payloadV1 });
      const v1Exposed = payloadV1.students[0].cells[0].exposed;
      await pool.query("UPDATE grades SET score = 16, updated_at = NOW() WHERE id = $1", [grade.rows[0].id]);
      const bound = await listen(app);
      try {
        const res = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/corrections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceVersion: 1,
            reason: "Note PG",
            commandId: "cmd-pg-facts-1",
          }),
        });
        const data = await res.json();
        assert.equal(res.status, 201, JSON.stringify(data));
        const retry = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/corrections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceVersion: 1,
            reason: "Note PG",
            commandId: "cmd-pg-facts-1",
          }),
        });
        const retryBody = await retry.json();
        assert.ok([200, 201].includes(retry.status), JSON.stringify(retryBody));
        assert.equal(retryBody.publication.public_id, data.publication.public_id);
        const snap = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/versions/2`);
        const body = await snap.json();
        assert.equal(snap.status, 200);
        assert.notEqual(body.payload.students[0].cells[0].exposed, v1Exposed);
        assert.deepEqual(body.payload.provenance.profile, provenance.profile);
      } finally {
        await bound.close();
      }
    } finally {
      await pool.end();
    }
  });

  test("pg: concurrent correct vs revoke is exactly one winner and never corrects a revoked source", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, IT_DB);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const schoolA = await bootFresh(pool);
      const keys = bootKeys();
      const tenant = { schoolId: schoolA, actorSchoolId: schoolA };
      const actor = { actorId: "pg-actor" };

      async function race(order) {
        const reportCardId = `rc-lot9-${order}`;
        const a = bootPublication(pool, keys);
        const b = bootPublication(pool, keys);
        await a.publication.publish({ tenant, payload: computedPayload(schoolA, 12, null, reportCardId) });
        const correction = createReportCardCorrection({
          publication: a.publication,
          getFacts: async () => [fact(16)],
          getProfile: async () => profileSpec(),
          getSchema: async () => schemaSpec(),
        });
        const correctOp = () =>
          correction.correct({
            tenant,
            actor,
            reportCardId,
            sourceVersion: 1,
            reason: "Concurrent correct",
            commandId: `cmd-pg-c-${order}`,
          });
        const revokeOp = () =>
          b.publication.revoke({
            tenant,
            reportCardId,
            version: 1,
            reason: "Concurrent revoke",
            actorId: "pg-actor",
          });
        const ops = order === "correct-first" ? [correctOp(), revokeOp()] : [revokeOp(), correctOp()];
        const results = await Promise.allSettled(ops);
        assertExclusiveRace(results);
        const v1 = await a.publication.lookup({ tenant, reportCardId, version: 1 });
        let v2 = null;
        try {
          v2 = await a.publication.lookup({ tenant, reportCardId, version: 2 });
        } catch {
          v2 = null;
        }
        if (v2) {
          assert.equal(v2.verification_status, "ACTIVE");
          assert.equal(v1.verification_status, "SUPERSEDED");
          assert.equal(Number(v2.corrected_from_version), 1);
          assert.notEqual(v1.verification_status, "REVOKED");
        } else {
          assert.equal(v1.verification_status, "REVOKED");
        }
        const current = await a.publication.listCurrent({ tenant });
        const live = current.filter((row) => row.report_card_id === reportCardId);
        assert.equal(live.length <= 1, true);
        if (v1.verification_status === "REVOKED") assert.equal(live.length, 0);
      }

      await race("correct-first");
      await race("revoke-first");
    } finally {
      await pool.end();
    }
  });

  test("pg: sequential correct-then-revoke and revoke-then-correct are exclusive", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, IT_DB);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const schoolA = await bootFresh(pool);
      const keys = bootKeys();
      const tenant = { schoolId: schoolA, actorSchoolId: schoolA };
      const { publication } = bootPublication(pool, keys);
      await publication.publish({ tenant, payload: computedPayload(schoolA, 12) });
      const correction = createReportCardCorrection({
        publication,
        getFacts: async () => [fact(16)],
        getProfile: async () => profileSpec(),
        getSchema: async () => schemaSpec(),
      });
      const corrected = await correction.correct({
        tenant,
        actor: { actorId: "seq" },
        reportCardId: "rc-lot9-1",
        sourceVersion: 1,
        reason: "Seq correct first",
        commandId: "cmd-seq-c",
      });
      assert.equal(corrected.published_snapshot_version, 2);
      await assert.rejects(
        () =>
          publication.revoke({
            tenant,
            reportCardId: "rc-lot9-1",
            version: 1,
            reason: "Seq revoke after correct",
            actorId: "seq",
          }),
        (err) => err && err.code === "CONCURRENCY_CONFLICT"
      );

      const schoolPayload = computedPayload(schoolA, 12);
      schoolPayload.report_card_id = "rc-lot9-2";
      await publication.publish({ tenant, payload: schoolPayload });
      await publication.revoke({
        tenant,
        reportCardId: "rc-lot9-2",
        version: 1,
        reason: "Seq revoke first",
        actorId: "seq",
      });
      await assert.rejects(
        () =>
          correction.correct({
            tenant,
            actor: { actorId: "seq" },
            reportCardId: "rc-lot9-2",
            sourceVersion: 1,
            reason: "Seq correct after revoke",
            commandId: "cmd-seq-r",
          }),
        (err) => err && err.code === "INVALID_TRANSITION"
      );
    } finally {
      await pool.end();
    }
  });

  test("pg: missing unpublished or deleted live grade refuses correction", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, `${IT_DB}_failclosed`);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const schoolA = await bootFresh(pool, { pedagogy: true });
      const ctx = await seedPedagogy(pool, schoolA);
      const evaluationId = await insertEvaluation(pool, schoolA, ctx, { title: "Interro 1" });
      const gradeId = await insertGrade(pool, schoolA, ctx, evaluationId, { score: 12 });
      const keys = bootKeys();
      const { app, publication, tenant, provenance } = bootBindings(pool, schoolA, keys);
      await publication.publish({
        tenant,
        payload: computedPayload(schoolA, 12, provenance, "rc-lot9-1", {
          academicYearId: ctx.yearId,
          classId: ctx.classId,
        }),
      });
      assert.equal(await snapshotCount(pool, schoolA), 1);

      await pool.query("UPDATE grades SET publication_status = 'draft' WHERE id = $1", [gradeId]);
      const bound = await listen(app);
      try {
        const unpublished = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/corrections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceVersion: 1,
            reason: "Note depubliée",
            commandId: "cmd-unpub-1",
          }),
        });
        assert.equal(unpublished.status, 400);
        assert.equal((await unpublished.json()).error.code, "FACTS_REQUIRED");
        assert.equal(await snapshotCount(pool, schoolA), 1);

        await pool.query("UPDATE grades SET publication_status = 'published' WHERE id = $1", [gradeId]);
        await pool.query("DELETE FROM grades WHERE id = $1", [gradeId]);
        const deleted = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/corrections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceVersion: 1,
            reason: "Note supprimée",
            commandId: "cmd-del-1",
          }),
        });
        assert.equal(deleted.status, 400);
        assert.equal((await deleted.json()).error.code, "FACTS_REQUIRED");
        assert.equal(await snapshotCount(pool, schoolA), 1);
      } finally {
        await bound.close();
      }
    } finally {
      await pool.end();
    }
  });

  test("pg: schema table or column error refuses correction", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, `${IT_DB}_schemaerr`);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const schoolA = await bootFresh(pool, { pedagogy: true });
      const ctx = await seedPedagogy(pool, schoolA);
      const evaluationId = await insertEvaluation(pool, schoolA, ctx, { title: "Interro 1" });
      await insertGrade(pool, schoolA, ctx, evaluationId, { score: 12 });
      const keys = bootKeys();
      const { app, publication, tenant, provenance } = bootBindings(pool, schoolA, keys);
      await publication.publish({
        tenant,
        payload: computedPayload(schoolA, 12, provenance, "rc-lot9-1", {
          academicYearId: ctx.yearId,
          classId: ctx.classId,
        }),
      });
      await pool.query("ALTER TABLE grades DROP COLUMN score");
      const bound = await listen(app);
      try {
        const res = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/corrections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceVersion: 1,
            reason: "Colonne absente",
            commandId: "cmd-schema-1",
          }),
        });
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error.code, "FACTS_REQUIRED");
        assert.equal(await snapshotCount(pool, schoolA), 1);
      } finally {
        await bound.close();
      }
    } finally {
      await pool.end();
    }
  });

  test("pg: two evaluations of the same component use weightedAverage not latest wins", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, `${IT_DB}_weighted`);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const schoolA = await bootFresh(pool, { pedagogy: true });
      const ctx = await seedPedagogy(pool, schoolA);
      const evalHigh = await insertEvaluation(pool, schoolA, ctx, {
        title: "Devoir recent",
        coefficient: 1,
        maxScore: 20,
      });
      const evalWeighted = await insertEvaluation(pool, schoolA, ctx, {
        title: "Devoir ancien",
        coefficient: 3,
        maxScore: 10,
      });
      await insertGrade(pool, schoolA, ctx, evalHigh, {
        score: 20,
        maxScore: 20,
        coefficient: 1,
        updatedAt: "2026-09-14T12:00:00.000Z",
      });
      await insertGrade(pool, schoolA, ctx, evalWeighted, {
        score: 8,
        maxScore: 10,
        coefficient: 3,
        updatedAt: "2026-09-01T12:00:00.000Z",
      });
      const expected = weightedAverage(
        [
          { score: 20, maxScore: 20, coefficient: 1, gradeStatus: "graded" },
          { score: 8, maxScore: 10, coefficient: 3, gradeStatus: "graded" },
        ],
        { displayScale: 20 }
      ).average;
      const keys = bootKeys();
      const { app, publication, tenant, provenance } = bootBindings(pool, schoolA, keys);
      const payloadV1 = computedPayload(schoolA, 12, provenance, "rc-lot9-1", {
        academicYearId: ctx.yearId,
        classId: ctx.classId,
      });
      await publication.publish({ tenant, payload: payloadV1 });
      const bound = await listen(app);
      try {
        const res = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/corrections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceVersion: 1,
            reason: "Deux TJ",
            commandId: "cmd-weighted-1",
          }),
        });
        const data = await res.json();
        assert.equal(res.status, 201, JSON.stringify(data));
        const snap = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/versions/2`);
        const body = await snap.json();
        assert.equal(snap.status, 200);
        assert.equal(body.payload.students[0].cells[0].internal, expected);
        assert.notEqual(body.payload.students[0].cells[0].internal, 20);
        assert.notEqual(body.payload.students[0].cells[0].exposed, payloadV1.students[0].cells[0].exposed);

        await pool.query(
          `UPDATE grades SET updated_at = CASE evaluation_id
             WHEN $1 THEN '2026-09-01T12:00:00.000Z'::timestamptz
             ELSE '2026-09-14T12:00:00.000Z'::timestamptz
           END`,
          [evalHigh]
        );
        const retry = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/corrections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceVersion: 2,
            reason: "Ordre updated_at inverse",
            commandId: "cmd-weighted-2",
          }),
        });
        const retryBody = await retry.json();
        assert.equal(retry.status, 201, JSON.stringify(retryBody));
        const v3 = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/versions/3`);
        const v3Body = await v3.json();
        assert.equal(v3.status, 200);
        assert.equal(v3Body.payload.students[0].cells[0].internal, expected);
      } finally {
        await bound.close();
      }
    } finally {
      await pool.end();
    }
  });

  test("pg: production initial publish stamps source class/year then correction isolates cohorts", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, `${IT_DB}_scope`);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const schoolA = await bootFresh(pool, { pedagogy: true });
      const yearA = await seedPedagogy(pool, schoolA);
      const yearB = await seedYearClass(pool, schoolA, yearA, {
        yearName: "2027",
        classCode: "5B",
        className: "5e B",
      });
      const evalA = await insertEvaluation(pool, schoolA, yearA, { title: "TJ 2026" });
      const evalB = await insertEvaluation(pool, schoolA, yearB, { title: "TJ 2027" });
      await insertGrade(pool, schoolA, yearA, evalA, { score: 12 });
      await insertGrade(pool, schoolA, yearB, evalB, { score: 20 });
      const keys = bootKeys();
      const { app, bindings, tenant, createdP, createdS } = bootBindings(pool, schoolA, keys);
      const boundModel = await activateBoundModel(bindings.getConfiguration(), schoolA, {
        modelKey: "trimestriel",
        profile: { id: createdP.profile.id, version: createdP.version.version },
        schema: { id: createdS.schema.id, version: createdS.version.version },
      });
      await bindings.publishInitial({
        tenant,
        reportCardId: "rc-lot9-1",
        classId: yearA.classId,
        academicYearId: yearA.yearId,
        modelKey: "trimestriel",
      });
      await pool.query("UPDATE grades SET score = 14 WHERE evaluation_id = $1", [evalA]);
      const bound = await listen(app);
      try {
        const v1 = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/versions/1`);
        const v1Body = await v1.json();
        assert.equal(v1.status, 200);
        assert.equal(v1Body.payload.academic_year_id, yearA.yearId);
        assert.equal(v1Body.payload.class_id, yearA.classId);
        assert.equal(v1Body.payload.provenance.profile.id, createdP.profile.id);
        assert.equal(v1Body.payload.provenance.schema.id, createdS.schema.id);
        assert.equal(v1Body.payload.provenance.template.id, boundModel.template.template_id);
        assert.equal(v1Body.payload.provenance.template.version, boundModel.template.version);
        assert.equal(v1Body.payload.provenance.template.spec_sha256, boundModel.template.spec_sha256);
        assert.equal(v1Body.payload.students[0].cells[0].internal, 12);
        const res = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/corrections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceVersion: 1,
            reason: "Scope annee/classe",
            commandId: "cmd-scope-1",
          }),
        });
        const data = await res.json();
        assert.equal(res.status, 201, JSON.stringify(data));
        const snap = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/versions/2`);
        const body = await snap.json();
        assert.equal(snap.status, 200);
        assert.equal(body.payload.students[0].cells[0].internal, 14);
        assert.notEqual(body.payload.students[0].cells[0].internal, 20);
        assert.notEqual(body.payload.students[0].cells[0].internal, 17);
        assert.equal(body.payload.academic_year_id, yearA.yearId);
        assert.equal(body.payload.class_id, yearA.classId);
      } finally {
        await bound.close();
      }
    } finally {
      await pool.end();
    }
  });

  test("pg: production initial publish refuses a class/year that is not the canonical class row", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, `${IT_DB}_scope_mismatch`);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const schoolA = await bootFresh(pool, { pedagogy: true });
      const yearA = await seedPedagogy(pool, schoolA);
      const yearB = await seedYearClass(pool, schoolA, yearA, {
        yearName: "2027",
        classCode: "5B",
        className: "5e B",
      });
      const evalA = await insertEvaluation(pool, schoolA, yearA, { title: "TJ 2026" });
      await insertGrade(pool, schoolA, yearA, evalA, { score: 12 });
      const keys = bootKeys();
      const { bindings, tenant, createdP, createdS } = bootBindings(pool, schoolA, keys);
      await activateBoundModel(bindings.getConfiguration(), schoolA, {
        modelKey: "trimestriel",
        profile: { id: createdP.profile.id, version: createdP.version.version },
        schema: { id: createdS.schema.id, version: createdS.version.version },
      });
      await assert.rejects(
        () =>
          bindings.publishInitial({
            tenant,
            reportCardId: "rc-lot9-1",
            classId: yearA.classId,
            academicYearId: yearB.yearId,
            modelKey: "trimestriel",
          }),
        (err) => err && err.code === "FACTS_REQUIRED"
      );
      assert.equal(await snapshotCount(pool, schoolA), 0);
    } finally {
      await pool.end();
    }
  });

  test("pg: production initial publish uses the requested LOT 6 binding not listProfiles rows 0", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, `${IT_DB}_lot6_bundle`);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const schoolA = await bootFresh(pool, { pedagogy: true });
      const ctx = await seedPedagogy(pool, schoolA);
      const evaluationId = await insertEvaluation(pool, schoolA, ctx, { title: "TJ wanted", maxScore: 10 });
      await insertGrade(pool, schoolA, ctx, evaluationId, { score: 8, maxScore: 10 });
      const keys = bootKeys();
      const { app, bindings, tenant, createdP, createdS, extraCreated, profileStore, schemaStore } =
        bootBindings(pool, schoolA, keys, {
          componentMax: 10,
          extraProfiles: [{ profileKey: "decoy-first", schemaKey: "decoy-first", componentMax: 20 }],
        });
      const decoyProfileId = extraCreated[0].profile.profile.id;
      const decoySchemaId = extraCreated[0].schema.schema.id;
      assert.equal(profileStore.listProfiles(schoolA, schoolA)[0].id, decoyProfileId);
      assert.equal(schemaStore.listSchemas(schoolA, schoolA)[0].id, decoySchemaId);
      assert.notEqual(decoyProfileId, createdP.profile.id);
      assert.notEqual(decoySchemaId, createdS.schema.id);
      const boundModel = await activateBoundModel(bindings.getConfiguration(), schoolA, {
        modelKey: "trimestriel",
        profile: { id: createdP.profile.id, version: createdP.version.version },
        schema: { id: createdS.schema.id, version: createdS.version.version },
      });
      await bindings.publishInitial({
        tenant,
        reportCardId: "rc-lot9-1",
        classId: ctx.classId,
        academicYearId: ctx.yearId,
        modelKey: "trimestriel",
      });
      const bound = await listen(app);
      try {
        const v1 = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/versions/1`);
        const body = await v1.json();
        assert.equal(v1.status, 200, JSON.stringify(body));
        assert.equal(body.payload.provenance.profile.id, createdP.profile.id);
        assert.notEqual(body.payload.provenance.profile.id, decoyProfileId);
        assert.equal(body.payload.provenance.schema.id, createdS.schema.id);
        assert.notEqual(body.payload.provenance.schema.id, decoySchemaId);
        assert.equal(body.payload.provenance.template.id, boundModel.template.template_id);
        assert.equal(body.payload.provenance.template.version, boundModel.template.version);
        assert.equal(body.payload.provenance.template.spec_sha256, boundModel.template.spec_sha256);
        assert.equal(body.payload.students[0].cells[0].internal, 8);
        assert.notEqual(body.payload.students[0].cells[0].internal, 16);
      } finally {
        await bound.close();
      }
    } finally {
      await pool.end();
    }
  });

  test("pg: production initial publish refuses a missing LOT 6 binding without a snapshot", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, `${IT_DB}_lot6_missing`);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const schoolA = await bootFresh(pool, { pedagogy: true });
      const ctx = await seedPedagogy(pool, schoolA);
      const evaluationId = await insertEvaluation(pool, schoolA, ctx, { title: "TJ unbound" });
      await insertGrade(pool, schoolA, ctx, evaluationId, { score: 12 });
      const keys = bootKeys();
      const { bindings, tenant } = bootBindings(pool, schoolA, keys, {
        extraProfiles: [{ profileKey: "decoy-first", schemaKey: "decoy-first", componentMax: 20 }],
      });
      await assert.rejects(
        () =>
          bindings.publishInitial({
            tenant,
            reportCardId: "rc-lot9-1",
            classId: ctx.classId,
            academicYearId: ctx.yearId,
            modelKey: "trimestriel",
          }),
        (err) => err && err.code === "FACTS_REQUIRED"
      );
      assert.equal(await snapshotCount(pool, schoolA), 0);
    } finally {
      await pool.end();
    }
  });

  test("pg: correction aggregates on pinned profile component max not 20", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, `${IT_DB}_scale`);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const schoolA = await bootFresh(pool, { pedagogy: true });
      const ctx = await seedPedagogy(pool, schoolA);
      const evaluationId = await insertEvaluation(pool, schoolA, ctx, {
        title: "TJ /10",
        maxScore: 10,
        coefficient: 1,
      });
      await insertGrade(pool, schoolA, ctx, evaluationId, { score: 8, maxScore: 10, coefficient: 1 });
      const keys = bootKeys();
      const { app, publication, tenant, provenance } = bootBindings(pool, schoolA, keys, { componentMax: 10 });
      const payloadV1 = computedPayload(
        schoolA,
        5,
        provenance,
        "rc-lot9-1",
        { academicYearId: ctx.yearId, classId: ctx.classId },
        profileSpec(10)
      );
      await publication.publish({ tenant, payload: payloadV1 });
      const bound = await listen(app);
      try {
        const res = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/corrections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceVersion: 1,
            reason: "Echelle profile 10",
            commandId: "cmd-scale-10",
          }),
        });
        const data = await res.json();
        assert.equal(res.status, 201, JSON.stringify(data));
        const snap = await fetch(`${bound.base}/api/report-card/publications/rc-lot9-1/versions/2`);
        const body = await snap.json();
        assert.equal(snap.status, 200);
        assert.equal(body.payload.students[0].cells[0].internal, 8);
        assert.notEqual(body.payload.students[0].cells[0].internal, 16);
      } finally {
        await bound.close();
      }
    } finally {
      await pool.end();
    }
  });
});
