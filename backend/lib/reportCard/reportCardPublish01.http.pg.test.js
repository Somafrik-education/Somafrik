"use strict";

/**
 * BULLETIN-PUBLISH-01 — parcours HTTP + PostgreSQL de bout en bout.
 *
 * Base jetable `somafrik_report_card_publish01_it` (schéma réel, sans seed démo).
 * Deux établissements avec classes « 6ème A » et élèves homonymes :
 *  - A (type La Colombière) : matières simples, TJ = deux interrogations, EX = examen,
 *    trois trimestres, maxima variables ;
 *  - B (type Le Berceau de la Sagesse) : matières composées de sous-matières.
 * Routes réelles (registerReportCardHttp), acteurs résolus par
 * resolveReportCardActorFromPrincipal (permissions effectives), stores PostgreSQL
 * réels (notes, catalogue, publication). PDF : stub (le moteur PDF n'est pas modifié).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../../db/repositoryFactory");
const { createSubjectHierarchyPgStore } = require("../../db/subjectHierarchyPgStore");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { createInMemoryConfigurationPersistence } = require("./reportCardConfiguration");
const { activateQualificationBinding } = require("./reportCardQualification");
const { registerReportCardHttp } = require("./reportCardHttp");
const { createReportCardHttpBindings } = require("../reportCardHttpRuntime");
const { resolveReportCardActorFromPrincipal } = require("../reportCardHttpActor");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const support = require("./reportCardPublish01.support");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_report_card_publish01_it";
const skip = DATABASE_URL ? false : "DATABASE_URL absent (exécuter via npm run test:backend-baseline:pg)";

const TEMPLATE = { paper: "A4", orientation: "portrait", qr_required: true, sections: [{ id: "CELLS", order: 1, source: "cells", label: "Matières" }] };
const COMPOSITE_PARENTS = { FR_ECRIT: "FRANCAIS", FR_LECTURE: "FRANCAIS", FR_DICTEE: "FRANCAIS", MATH_MENTAL: "MATHEMATIQUES", MATH_ECRIT: "MATHEMATIQUES", ARTS_PLASTIQUES: "ARTS", MUSIQUE: "ARTS", EPS: "ARTS" };

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

async function one(pool, sql, params) {
  return (await pool.query(sql, params)).rows[0];
}

async function seedSchool(pool, { countryId, code, login, short, name, termNames, types, subjects, courses, parents = {}, students, profile, facts, mode, classCode }) {
  const terms = Object.values(termNames);
  await pool.query("ALTER TABLE schools DISABLE TRIGGER USER");
  const schoolId = (await one(pool, "INSERT INTO schools (country_id, school_code, login_code, short_code, name, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id", [countryId, code, login, short, name])).id;
  await pool.query("ALTER TABLE schools ENABLE TRIGGER USER");
  const yearId = (await one(pool, "INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027',TRUE,'open') RETURNING id", [schoolId])).id;
  const termIds = {};
  for (const termName of terms) termIds[termName] = (await one(pool, "INSERT INTO terms (academic_year_id, name) VALUES ($1,$2) RETURNING id", [yearId, termName])).id;
  const classId = (await one(pool, "INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1,$2,$3,'6ème A') RETURNING id", [schoolId, yearId, classCode])).id;
  const teacherId = (await one(pool, "INSERT INTO teachers (school_id, teacher_code) VALUES ($1,$2) RETURNING id", [schoolId, `${short}-T1`])).id;
  const typeIds = {};
  for (const typeCode of types) typeIds[typeCode] = (await one(pool, "INSERT INTO evaluation_types (school_id, code, name) VALUES ($1,$2,$3) RETURNING id", [schoolId, typeCode, typeCode])).id;
  const subjectIds = {};
  for (const subjectCode of subjects) subjectIds[subjectCode] = (await one(pool, "INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,$2,$3,'active') RETURNING id", [schoolId, subjectCode, subjectCode])).id;
  const hierarchy = createSubjectHierarchyPgStore(pool);
  for (const [child, parent] of Object.entries(parents)) await hierarchy.setSubjectParent({ schoolId, subjectCode: child, parentSubjectCode: parent });
  for (const subjectCode of courses) {
    await pool.query("INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code) VALUES ($1,$2,$3,$4,$5)", [schoolId, classId, subjectIds[subjectCode], teacherId, `${short}-${subjectCode}`]);
  }
  const studentIds = {};
  for (const [fixtureCode, firstName] of Object.entries(students)) {
    const row = await one(pool, "INSERT INTO students (school_id, student_code, first_name, last_name) VALUES ($1,$2,$3,'Test') RETURNING id, student_code", [schoolId, `${short}-${fixtureCode}`, firstName]);
    await pool.query("INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1,$2,$3,$4,'active')", [schoolId, row.id, classId, yearId]);
    studentIds[fixtureCode] = { uuid: row.id, code: row.student_code };
  }
  const plan = support.gradePlan(profile, facts, { mode, termNames });
  const evaluationIds = {};
  for (const evaluation of plan.evaluations) {
    const termName = evaluation.term_name;
    evaluationIds[evaluation.key] = (await one(
      pool,
      `INSERT INTO evaluations (school_id, class_id, subject_id, teacher_id, term_id, title, evaluation_type, evaluation_type_id, max_score, coefficient, status, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'published',TRUE) RETURNING id`,
      [schoolId, classId, subjectIds[evaluation.subject_code], teacherId, termIds[termName], evaluation.key, evaluation.type_code, typeIds[evaluation.type_code], evaluation.max_score]
    )).id;
  }
  for (const grade of plan.grades) {
    const evaluation = plan.evaluations.find((e) => e.key === grade.evaluation_key);
    const termName = evaluation.term_name;
    await pool.query(
      `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id, grade_type, score, max_score, coefficient, grade_status, publication_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'graded','published')`,
      [schoolId, studentIds[grade.student_code].uuid, classId, subjectIds[evaluation.subject_code], teacherId, termIds[termName], evaluationIds[grade.evaluation_key], evaluation.type_code, grade.score, evaluation.max_score]
    );
  }
  return { schoolId, yearId, classId, termIds, teacherId, typeIds, subjectIds, studentIds, evaluationIds };
}

const state = {};

function request(method, pathname, principalKey, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      { host: "127.0.0.1", port: state.port, method, path: pathname, headers: { "x-test-principal": principalKey || "", ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}) } },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
          resolve({ status: res.statusCode, data, contentType: String(res.headers["content-type"] || "") });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function body(school, period, extra = {}) {
  return { classId: school.classId, academicYearId: school.yearId, modelKey: school.modelKey, period, ...extra };
}

async function preview(school, period, principal) {
  return request("POST", "/api/report-card/publications/preview", principal, body(school, period));
}

async function countSnapshots(pool) {
  return Number((await one(pool, "SELECT count(*)::int AS n FROM report_card_published_snapshots")).n);
}

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label} : ${actual} ≠ ${expected}`);
}

before(async () => {
  if (skip) return;
  const url = await resetDatabase();
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  state.repo = createPostgresRepository(url);
  await state.repo.init();
  const pool = state.repo.pool;
  state.pool = pool;
  await pool.query("ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL; ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;");
  const country = (await one(pool, "INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Burundi','BI','+257','BIF') RETURNING id")).id;
  const simpleSubjects = support.simpleProfile().subjects.map((s) => s.id);
  state.a = await seedSchool(pool, {
    countryId: country, code: "BI-2026-0201", login: "BI-ALP-26-001", short: "ALP", name: "École Alpha",
    termNames: support.TERM_NAMES,
    types: ["interrogation", "examen"], subjects: simpleSubjects, courses: simpleSubjects,
    students: { STU1: "Ama", STU2: "Bo" }, profile: support.simpleProfile(), facts: support.simpleFixture.facts, mode: "sum", classCode: "PUB01-A",
  });
  const compositeSubjects = support.compositeProfile().subjects.map((s) => s.id);
  const compositeFacts = support.compositeFixture.facts.map((f) => ({ ...f }));
  state.b = await seedSchool(pool, {
    countryId: country, code: "BI-2026-0202", login: "BI-BER-26-001", short: "BER", name: "École Beta",
    termNames: { T1: "Trimestre 1", T2: "Trimestre 2", T3: "Trimestre 3" }, types: ["devoir", "examen"], subjects: compositeSubjects,
    courses: ["FRANCAIS", "MATHEMATIQUES", "ARTS", "ANGLAIS"], parents: COMPOSITE_PARENTS,
    students: { STU1: "Ama" }, profile: support.compositeProfile(), facts: compositeFacts, mode: "weighted_average", classCode: "PUB01-B",
  });
  state.a.modelKey = "pub01-a";
  state.b.modelKey = "pub01-b";

  const profileStore = createAcademicRuleProfileStore();
  const schemaStore = createReportCardSchemaStore();
  const keys = { signingKey: generateSigningKey("rc-ed25519-1"), wrapping: generateWrappingKey("rc-wrap-1") };
  const principals = {
    adminA: { sub: "aaaaaaaa-0000-4000-8000-000000000001", role: "Admin School", schoolId: state.a.schoolId, permissions: ["Bulletins:READ", "Bulletins:UPDATE", "Bulletins:SUSPEND", "Bulletins:DELETE"] },
    proviseurA: { sub: "aaaaaaaa-0000-4000-8000-000000000002", role: "Proviseur", schoolId: state.a.schoolId, permissions: ["Valider bulletins", "Bulletins:READ"] },
    teacherA: { sub: "aaaaaaaa-0000-4000-8000-000000000003", role: "Enseignant", schoolId: state.a.schoolId, permissions: ["Voir bulletins", "Bulletins:READ", "Notes:CREATE", "Notes:UPDATE"] },
    adminB: { sub: "bbbbbbbb-0000-4000-8000-000000000001", role: "Admin School", schoolId: state.b.schoolId, permissions: ["Bulletins:READ", "Bulletins:UPDATE"] },
    superadmin: { sub: "cccccccc-0000-4000-8000-000000000001", role: "Super Administrateur Somafrik" },
    parentA1: {
      sub: "dddddddd-0000-4000-8000-000000000001", role: "Parent", schoolId: state.a.schoolId, permissions: ["Bulletins:READ"],
      user: { id: "dddddddd-0000-4000-8000-000000000001", role: "Parent", children: [{ studentId: state.a.studentIds.STU1.uuid, studentCode: state.a.studentIds.STU1.code }] },
    },
    parentNone: { sub: "dddddddd-0000-4000-8000-000000000002", role: "Parent", schoolId: state.a.schoolId, permissions: ["Bulletins:READ"], user: { id: "dddddddd-0000-4000-8000-000000000002", role: "Parent", children: [] } },
  };
  state.principals = principals;
  const bindings = createReportCardHttpBindings({
    env: {},
    createPdf: () => ({ render: async () => ({ pdf: Buffer.from("%PDF-1.4 stub") }) }),
    resolveActor: (req) => resolveReportCardActorFromPrincipal(principals[req.headers["x-test-principal"]] || null),
    overrides: {
      db: pool,
      profileStore,
      schemaStore,
      configurationPersistence: createInMemoryConfigurationPersistence(),
      keys: { ...keys, wrappingKeys: [keys.wrapping], signingKeys: [keys.signingKey] },
    },
  });
  state.bindings = bindings;
  for (const [school, profileRaw, schemaRaw] of [[state.a, support.simpleProfile(), support.simpleFixture.schema], [state.b, support.compositeProfile(), support.compositeFixture.schema]]) {
    const p = profileStore.createProfile({ schoolId: school.schoolId, actorSchoolId: school.schoolId, profileKey: school.modelKey, spec: profileRaw, activate: true });
    const s = schemaStore.createSchema({ schoolId: school.schoolId, actorSchoolId: school.schoolId, schemaKey: school.modelKey, spec: schemaRaw, activate: true });
    await activateQualificationBinding(bindings.getConfiguration(), school.schoolId, {
      modelKey: school.modelKey,
      profile: { id: p.profile.id, version: p.version.version },
      schema: { id: s.schema.id, version: s.version.version },
      templateSpec: TEMPLATE,
    });
  }
  // F — snapshot historique (format LOT 9, classe entière) publié avant ce chantier.
  state.legacyPayload = {
    report_card_id: "rc-legacy-lot9",
    published_snapshot_version: 1,
    school_id: state.a.schoolId,
    published_at: "2026-10-01T08:00:00.000Z",
    engine_id: "somafrik.report_card.v1",
    provenance: { profile: { id: "legacy-p", version: 1, spec_sha256: "aa" }, schema: { id: "legacy-s", version: 1, spec_sha256: "bb" } },
    students: [{ student_id: state.a.studentIds.STU1.code, cells: [], slots: [], presence: [] }],
    academic_year_id: state.a.yearId,
    class_id: state.a.classId,
  };
  await bindings.getPublication().publish({ tenant: { schoolId: state.a.schoolId, actorSchoolId: state.a.schoolId }, payload: state.legacyPayload });

  const app = express();
  app.use(express.json());
  registerReportCardHttp(app, bindings);
  state.server = http.createServer(app);
  await new Promise((resolve) => state.server.listen(0, "127.0.0.1", resolve));
  state.port = state.server.address().port;
});

after(async () => {
  if (state.server) await new Promise((resolve) => state.server.close(resolve));
  if (state.pool && !state.pool.ended) await state.pool.end().catch(() => {});
});

test("A — notes réelles : brouillon annuel complet, maxima variables, trimestres et bilan annuel", { skip }, async () => {
  const res = await preview(state.a, "ANNUAL", "adminA");
  assert.equal(res.status, 200, JSON.stringify(res.data).slice(0, 400));
  const draft = res.data.draft;
  assert.equal(draft.official, false);
  assert.equal(draft.publishable, true, JSON.stringify(draft.issues));
  const stu1 = draft.students.find((s) => s.student_id === state.a.studentIds.STU1.code).subject_totals;
  close(stu1.periods.T1.points.internal, 195, "T1");
  close(stu1.periods.T3.max_points.internal, 270, "T3 max (EX Mathématiques 80)");
  close(stu1.annual.points.internal, 623, "annuel points");
  close(stu1.annual.max_points.internal, 770, "annuel max");
  assert.equal(stu1.annual.percentage.exposed, 80.91);
  assert.equal(stu1.annual.rank.internal, 1);
  assert.equal(stu1.cohort_size, 2);
  const stu2 = draft.students.find((s) => s.student_id === state.a.studentIds.STU2.code).subject_totals;
  close(stu2.annual.points.internal, 385, "STU2");
  assert.equal(stu2.annual.rank.internal, 2);
  assert.equal(await countSnapshots(state.pool), 1, "brouillon : aucune écriture (seul le snapshot historique existe)");
});

test("D — note brouillon exclue : bulletin incomplet refusé, aucun snapshot ; évaluation annulée ensuite", { skip }, async () => {
  const pool = state.pool;
  const a = state.a;
  const draftEval = await one(
    pool,
    `INSERT INTO evaluations (school_id, class_id, subject_id, teacher_id, term_id, title, evaluation_type, evaluation_type_id, max_score, coefficient, status, active)
     VALUES ($1,$2,$3,$4,$5,'Interrogation brouillon','interrogation',$6,10,1,'draft',TRUE) RETURNING id`,
    [a.schoolId, a.classId, a.subjectIds.GEOGRAPHIE, a.teacherId, a.termIds[support.TERM_NAMES.T1], a.typeIds.interrogation]
  );
  await pool.query(
    `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id, grade_type, score, max_score, grade_status, publication_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'interrogation',2,10,'graded','published')`,
    [a.schoolId, a.studentIds.STU1.uuid, a.classId, a.subjectIds.GEOGRAPHIE, a.teacherId, a.termIds[support.TERM_NAMES.T1], draftEval.id]
  );
  const res = await preview(a, "ANNUAL", "adminA");
  const draft = res.data.draft;
  assert.equal(draft.publishable, false);
  const stu1 = draft.students.find((s) => s.student_id === a.studentIds.STU1.code);
  assert.equal(stu1.status, "INCOMPLETE");
  assert.ok(stu1.subject_totals.issues.some((i) => i.code === "MISSING_SCORE" && i.reason === "UNPUBLISHED" && i.subject_id === "GEOGRAPHIE" && i.period_id === "T1"));
  assert.equal(stu1.subject_totals.annual.rank.kind, "NOT_RANKED", "aucun rang provisoire déguisé en rang définitif");
  const refused = await request("POST", "/api/report-card/publications", "adminA", body(a, "ANNUAL", { expectedDraftSha256: draft.draft_sha256 }));
  assert.equal(refused.status, 422);
  assert.equal(refused.data.code, "REPORT_CARD_INCOMPLETE");
  assert.ok(refused.data.details.some((d) => d.student_id === a.studentIds.STU1.code));
  assert.equal(await countSnapshots(pool), 1);
  await pool.query("UPDATE evaluations SET status = 'archived' WHERE id = $1", [draftEval.id]);
  assert.equal((await preview(a, "ANNUAL", "adminA")).data.draft.publishable, true, "évaluation annulée : exclue");
});

test("Sécurité — RBAC effectif et établissement : enseignant, parent, plateforme et autre établissement refusés", { skip }, async () => {
  const a = state.a;
  const sha = (await preview(a, "ANNUAL", "adminA")).data.draft.draft_sha256;
  for (const [principal, allowed] of [["teacherA", [403]], ["parentA1", [403]], ["superadmin", [400, 403]]]) {
    for (const route of ["/api/report-card/publications/preview", "/api/report-card/publications"]) {
      const res = await request("POST", route, principal, body(a, "ANNUAL", { expectedDraftSha256: sha }));
      assert.ok(allowed.includes(res.status), `${principal} ${route} : ${res.status}`);
    }
  }
  const crossTenant = await request("POST", "/api/report-card/publications", "adminB", body(a, "ANNUAL", { expectedDraftSha256: sha }));
  assert.equal(crossTenant.status, 404, "classe d'un autre établissement introuvable");
  assert.equal((await request("POST", "/api/report-card/publications", "adminA", body(a, "ANNUAL"))).data.code, "DRAFT_CONFIRMATION_REQUIRED");
  const stale = await request("POST", "/api/report-card/publications", "adminA", body(a, "ANNUAL", { expectedDraftSha256: "0".repeat(64) }));
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, "DRAFT_CHANGED");
  assert.equal((await request("POST", "/api/report-card/publications/preview", "adminA", body(a, "T9"))).status, 400);
  assert.equal(await countSnapshots(state.pool), 1);
});

test("A — publication officielle par un utilisateur habilité : un snapshot signé par élève", { skip }, async () => {
  const a = state.a;
  const sha = (await preview(a, "ANNUAL", "proviseurA")).data.draft.draft_sha256;
  const res = await request("POST", "/api/report-card/publications", "proviseurA", body(a, "ANNUAL", { expectedDraftSha256: sha }));
  assert.equal(res.status, 201, JSON.stringify(res.data).slice(0, 300));
  assert.equal(res.data.status, "PUBLISHED");
  assert.equal(res.data.publications.length, 2);
  state.annualCards = Object.fromEntries(res.data.publications.map((p) => [p.student_id, p.report_card_id]));
  const rows = (await state.pool.query("SELECT report_card_id, actor_id, verification_status FROM report_card_published_snapshots WHERE report_card_id = ANY($1)", [Object.values(state.annualCards)])).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.actor_id === state.principals.proviseurA.sub && r.verification_status === "ACTIVE"), "auteur enregistré");
  const snap = await request("GET", `/api/report-card/publications/${state.annualCards[a.studentIds.STU1.code]}/snapshot?version=1`, "adminA");
  assert.equal(snap.status, 200);
  const payload = snap.data.payload;
  assert.equal(payload.students.length, 1);
  assert.equal(payload.students[0].student_id, a.studentIds.STU1.code);
  assert.equal(payload.published_by, state.principals.proviseurA.sub);
  assert.equal(payload.period_scope, "ANNUAL");
  assert.ok(payload.provenance.profile.spec_sha256 && payload.provenance.schema.spec_sha256 && payload.provenance.template.spec_sha256);
  close(payload.students[0].subject_totals.annual.points.internal, 623, "snapshot");
  state.stu1AnnualV1 = payload;
});

test("D — double publication maîtrisée et publications concurrentes : aucune ligne en double", { skip }, async () => {
  const a = state.a;
  const sha = (await preview(a, "ANNUAL", "adminA")).data.draft.draft_sha256;
  const again = await request("POST", "/api/report-card/publications", "adminA", body(a, "ANNUAL", { expectedDraftSha256: sha }));
  assert.equal(again.status, 200);
  assert.equal(again.data.status, "ALREADY_PUBLISHED");
  const before = await countSnapshots(state.pool);
  const t1 = (await preview(a, "T1", "adminA")).data.draft;
  assert.equal(t1.publishable, true);
  assert.deepEqual(t1.students[0].subject_totals.scope, { periods: ["T1"], annual: false });
  const results = await Promise.all([
    request("POST", "/api/report-card/publications", "adminA", body(a, "T1", { expectedDraftSha256: t1.draft_sha256 })),
    request("POST", "/api/report-card/publications", "proviseurA", body(a, "T1", { expectedDraftSha256: t1.draft_sha256 })),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201], JSON.stringify(results.map((r) => r.data)).slice(0, 400));
  assert.equal(await countSnapshots(state.pool), before + 2, "un seul lot écrit");
  state.t1Cards = t1.students.map((s) => s.report_card_id);
});

test("D — échec transactionnel : un conflit dans le lot n'écrit aucun bulletin", { skip }, async () => {
  const publication = state.bindings.getPublication();
  const tenant = { schoolId: state.a.schoolId, actorSchoolId: state.a.schoolId };
  const existing = await publication.payloadForRender({ tenant, reportCardId: state.t1Cards[0], version: 1 });
  const fresh = { ...existing, report_card_id: "rc-pub01-rollback", published_at: "2026-11-03T10:00:00.000Z" };
  const conflicting = { ...existing, published_at: "2026-11-03T10:00:00.000Z" };
  const before = await countSnapshots(state.pool);
  await assert.rejects(publication.publishBatch({ tenant, payloads: [fresh, conflicting] }), (error) => error.name === "IdempotencyConflict" || error.code === "IDEMPOTENCY_CONFLICT");
  assert.equal(await countSnapshots(state.pool), before, "rollback complet");
  assert.equal((await state.pool.query("SELECT 1 FROM report_card_publish_outbox WHERE report_card_id = 'rc-pub01-rollback'")).rowCount, 0);
});

test("B — matières composées : totaux par matière principale, sans double comptage, publication", { skip }, async () => {
  const b = state.b;
  const draft = (await preview(b, "ANNUAL", "adminB")).data.draft;
  assert.equal(draft.publishable, true, JSON.stringify(draft.issues));
  const totals = draft.students[0].subject_totals;
  const fr = totals.rows.find((r) => r.subject_id === "FRANCAIS");
  close(fr.periods.T1.points.internal, 153, "Français = Écrit + Lecture + Dictée");
  close(fr.periods.T1.max_points.internal, 200, "Français max");
  close(totals.periods.T1.points.internal, 358, "T1 général");
  close(totals.annual.points.internal, 1074, "annuel");
  close(totals.annual.max_points.internal, 1380, "annuel max");
  assert.equal(totals.cohort_size, 1);
  const res = await request("POST", "/api/report-card/publications", "adminB", body(b, "ANNUAL", { expectedDraftSha256: draft.draft_sha256 }));
  assert.equal(res.status, 201, JSON.stringify(res.data).slice(0, 300));
  state.bCard = res.data.publications[0].report_card_id;
});

test("B — note manquante sur une sous-matière : incomplet, jamais zéro, publication refusée", { skip }, async () => {
  const b = state.b;
  const dictee = b.evaluationIds["FR_DICTEE|T2|EX|U"];
  await state.pool.query("DELETE FROM grades WHERE evaluation_id = $1", [dictee]);
  const draft = (await preview(b, "T2", "adminB")).data.draft;
  assert.equal(draft.publishable, false);
  const cell = draft.students[0].subject_totals.rows.find((r) => r.subject_id === "FR_DICTEE").periods.T2;
  assert.equal(cell.components.EX.kind, "MISSING");
  close(cell.max_points.internal, 50, "maximum attendu conservé");
  const refused = await request("POST", "/api/report-card/publications", "adminB", body(b, "T2", { expectedDraftSha256: draft.draft_sha256 }));
  assert.equal(refused.status, 422);
});

test("C — isolation : chaque publication n'utilise que les données de son établissement", { skip }, async () => {
  const aCodes = new Set(Object.values(state.a.studentIds).map((s) => s.code));
  const bCodes = new Set(Object.values(state.b.studentIds).map((s) => s.code));
  for (const card of Object.values(state.annualCards)) {
    const snap = await request("GET", `/api/report-card/publications/${card}/snapshot?version=1`, "adminA");
    assert.ok(aCodes.has(snap.data.payload.students[0].student_id));
    assert.equal(snap.data.payload.school_id, state.a.schoolId);
    const fromB = await request("GET", `/api/report-card/publications/${card}/snapshot?version=1`, "adminB");
    assert.ok([403, 404].includes(fromB.status), `B lit un bulletin de A : ${fromB.status}`);
  }
  const bSnap = await request("GET", `/api/report-card/publications/${state.bCard}/snapshot?version=1`, "adminB");
  assert.ok(bCodes.has(bSnap.data.payload.students[0].student_id));
  assert.equal(bSnap.data.payload.school_id, state.b.schoolId);
  const aList = await request("GET", "/api/report-card/publications", "adminA");
  assert.ok(aList.data.publications.every((p) => p.school_id === undefined || p.school_id === state.a.schoolId));
  assert.ok(!aList.data.publications.some((p) => p.report_card_id === state.bCard));
});

test("E — parents : enfant lié seulement (liste, snapshot, document)", { skip }, async () => {
  const a = state.a;
  const own = state.annualCards[a.studentIds.STU1.code];
  const other = state.annualCards[a.studentIds.STU2.code];
  const list = await request("GET", "/api/report-card/publications", "parentA1");
  assert.equal(list.status, 200);
  const listed = list.data.publications.map((p) => p.report_card_id);
  assert.ok(listed.includes(own));
  assert.ok(!listed.includes(other));
  assert.equal((await request("GET", `/api/report-card/publications/${own}/snapshot?version=1`, "parentA1")).status, 200);
  const pdfOwn = await request("GET", `/api/report-card/publications/${own}/pdf?version=1`, "parentA1");
  assert.equal(pdfOwn.status, 200);
  assert.match(pdfOwn.contentType, /pdf/);
  for (const route of [`/api/report-card/publications/${other}/snapshot?version=1`, `/api/report-card/publications/${other}/pdf?version=1`]) {
    const res = await request("GET", route, "parentA1");
    assert.ok([403, 404].includes(res.status), `${route} : ${res.status}`);
    assert.doesNotMatch(res.contentType, /pdf/);
  }
  const none = await request("GET", "/api/report-card/publications", "parentNone");
  assert.deepEqual(none.data.publications, []);
  const noneSnap = await request("GET", `/api/report-card/publications/${own}/snapshot?version=1`, "parentNone");
  assert.ok([403, 404].includes(noneSnap.status));
});

test("D — correction officielle : nouvelle version, ancienne inchangée ; révocation", { skip }, async () => {
  const a = state.a;
  const card = state.annualCards[a.studentIds.STU1.code];
  const examT3 = a.evaluationIds["GEOGRAPHIE|T3|EX|U"];
  await state.pool.query("UPDATE grades SET score = 70 WHERE evaluation_id = $1 AND student_id = $2", [examT3, a.studentIds.STU1.uuid]);
  const corrected = await request("POST", `/api/report-card/publications/${card}/corrections`, "adminA", { sourceVersion: 1, reason: "Erreur de saisie Géographie T3", commandId: "pub01-corr-1" });
  assert.equal(corrected.status, 201, JSON.stringify(corrected.data).slice(0, 300));
  const v1 = await request("GET", `/api/report-card/publications/${card}/versions/1`, "adminA");
  assert.deepEqual(v1.data.payload, state.stu1AnnualV1, "version 1 inchangée");
  const v2 = await request("GET", `/api/report-card/publications/${card}/versions/2`, "adminA");
  close(v2.data.payload.students[0].subject_totals.annual.points.internal, 630, "623 + 7");
  assert.equal(v2.data.payload.period_scope, "ANNUAL");
  const history = await request("GET", `/api/report-card/publications/${card}/history`, "adminA");
  const statuses = Object.fromEntries((history.data.versions || history.data.history || []).map((row) => [row.published_snapshot_version, row.verification_status]));
  assert.deepEqual(statuses, { 1: "SUPERSEDED", 2: "ACTIVE" });
  const revoked = await request("POST", `/api/report-card/publications/${card}/versions/2/revoke`, "adminA", { reason: "Contrôle CTO" });
  assert.equal(revoked.status, 200);
  const after = await request("GET", `/api/report-card/publications/${card}/history`, "adminA");
  const finalStatuses = Object.fromEntries((after.data.versions || after.data.history || []).map((row) => [row.published_snapshot_version, row.verification_status]));
  assert.equal(finalStatuses[2], "REVOKED");
});

test("F — compatibilité : le bulletin historique publié avant ce chantier reste lisible et identique", { skip }, async () => {
  const res = await request("GET", "/api/report-card/publications/rc-legacy-lot9/snapshot?version=1", "adminA");
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.payload, state.legacyPayload);
});
