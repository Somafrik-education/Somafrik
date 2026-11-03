"use strict";

/**
 * BULLETIN-UI-01 — présentation par matières (modèles A et B), PDF officiel réel,
 * aperçu non officiel, droits et compatibilité, de bout en bout (HTTP + PostgreSQL).
 *
 * Base jetable `somafrik_report_card_ui01_it`. Données de BULLETIN-PUBLISH-01 :
 *  - A (type La Colombière) : matières simples, TJ/EX, trois trimestres ;
 *  - B (type Le Berceau de la Sagesse) : matières principales et sous-matières.
 * Moteur, publication, RBAC : inchangés (routes réelles). PDF : rendu Chromium
 * réel (createReportCardPdf), texte relu par pdftotext.
 * SOMAFRIK_UI01_PDF_OUT=<dossier> : écrit les PDF produits (exemples de revue).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const express = require("express");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../../db/repositoryFactory");
const { createSubjectHierarchyPgStore } = require("../../db/subjectHierarchyPgStore");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { createInMemoryConfigurationPersistence } = require("./reportCardConfiguration");
const { activateQualificationBinding } = require("./reportCardQualification");
const { registerReportCardHttp } = require("./reportCardHttp");
const { createReportCardPdf } = require("./reportCardPdf");
const { createReportCardHttpBindings } = require("../reportCardHttpRuntime");
const { resolveReportCardActorFromPrincipal } = require("../reportCardHttpActor");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const support = require("./reportCardPublish01.support");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_report_card_ui01_it";
const skip = DATABASE_URL ? false : "DATABASE_URL absent (exécuter via npm run test:backend-baseline:pg)";

function pdfToTextAvailable() {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
// En CI, pdftotext est installé par le workflow : son absence doit faire échouer.
const skipPdfText = skip || (!process.env.CI && !pdfToTextAvailable() && "pdftotext (poppler-utils) absent hors CI");

const SECTIONS = [{ id: "CELLS", order: 1, source: "cells", label: "Matières" }];
const TEMPLATE_A = { paper: "A4", orientation: "portrait", qr_required: true, sections: SECTIONS, presentation: { style: "simple", signatures: ["Le titulaire", "Le directeur", "Le parent"] } };
const TEMPLATE_B = { paper: "A4", orientation: "portrait", qr_required: true, sections: SECTIONS, presentation: { style: "hierarchical", signatures: ["La titulaire", "La directrice"] } };
const COMPOSITE_PARENTS = { FR_ECRIT: "FRANCAIS", FR_LECTURE: "FRANCAIS", FR_DICTEE: "FRANCAIS", MATH_MENTAL: "MATHEMATIQUES", MATH_ECRIT: "MATHEMATIQUES", ARTS_PLASTIQUES: "ARTS", MUSIQUE: "ARTS", EPS: "ARTS" };
// Intitulés de l'établissement (catalogue `subjects.name`) : jamais dans le code de rendu.
const SUBJECT_NAMES = {
  GEOGRAPHIE: "Géographie",
  MATHEMATIQUES: "Mathématiques",
  EDUCATION_PHYSIQUE: "Éducation physique",
  FRANCAIS: "Français",
  FR_ECRIT: "Écrit",
  FR_LECTURE: "Lecture",
  FR_DICTEE: "Dictée",
  MATH_MENTAL: "Calcul mental",
  MATH_ECRIT: "Calcul écrit",
  ARTS: "Arts",
  ARTS_PLASTIQUES: "Art plastique",
  MUSIQUE: "Musique",
  EPS: "EPS",
  ANGLAIS: "Anglais",
};

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
  await pool.query("ALTER TABLE schools DISABLE TRIGGER USER");
  const schoolId = (await one(pool, "INSERT INTO schools (country_id, school_code, login_code, short_code, name, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id", [countryId, code, login, short, name])).id;
  await pool.query("ALTER TABLE schools ENABLE TRIGGER USER");
  const yearId = (await one(pool, "INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027',TRUE,'open') RETURNING id", [schoolId])).id;
  const termIds = {};
  for (const termName of Object.values(termNames)) termIds[termName] = (await one(pool, "INSERT INTO terms (academic_year_id, name) VALUES ($1,$2) RETURNING id", [yearId, termName])).id;
  const classId = (await one(pool, "INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1,$2,$3,'6ème A') RETURNING id", [schoolId, yearId, classCode])).id;
  const teacherId = (await one(pool, "INSERT INTO teachers (school_id, teacher_code) VALUES ($1,$2) RETURNING id", [schoolId, `${short}-T1`])).id;
  const typeIds = {};
  for (const typeCode of types) typeIds[typeCode] = (await one(pool, "INSERT INTO evaluation_types (school_id, code, name) VALUES ($1,$2,$3) RETURNING id", [schoolId, typeCode, typeCode])).id;
  const subjectIds = {};
  for (const subjectCode of subjects) {
    subjectIds[subjectCode] = (await one(pool, "INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,$2,$3,'active') RETURNING id", [schoolId, subjectCode, SUBJECT_NAMES[subjectCode] || subjectCode])).id;
  }
  const hierarchy = createSubjectHierarchyPgStore(pool);
  for (const [child, parent] of Object.entries(parents)) await hierarchy.setSubjectParent({ schoolId, subjectCode: child, parentSubjectCode: parent });
  for (const subjectCode of courses) {
    await pool.query("INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code) VALUES ($1,$2,$3,$4,$5)", [schoolId, classId, subjectIds[subjectCode], teacherId, `${short}-${subjectCode}`]);
  }
  const studentIds = {};
  for (const [fixtureCode, [firstName, lastName]] of Object.entries(students)) {
    const row = await one(pool, "INSERT INTO students (school_id, student_code, first_name, last_name) VALUES ($1,$2,$3,$4) RETURNING id, student_code", [schoolId, `${short}-${fixtureCode}`, firstName, lastName]);
    await pool.query("INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1,$2,$3,$4,'active')", [schoolId, row.id, classId, yearId]);
    studentIds[fixtureCode] = { uuid: row.id, code: row.student_code };
  }
  const plan = support.gradePlan(profile, facts, { mode, termNames });
  const evaluationIds = {};
  for (const evaluation of plan.evaluations) {
    evaluationIds[evaluation.key] = (await one(
      pool,
      `INSERT INTO evaluations (school_id, class_id, subject_id, teacher_id, term_id, title, evaluation_type, evaluation_type_id, max_score, coefficient, status, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'published',TRUE) RETURNING id`,
      [schoolId, classId, subjectIds[evaluation.subject_code], teacherId, termIds[evaluation.term_name], evaluation.key, evaluation.type_code, typeIds[evaluation.type_code], evaluation.max_score]
    )).id;
  }
  for (const grade of plan.grades) {
    const evaluation = plan.evaluations.find((e) => e.key === grade.evaluation_key);
    await pool.query(
      `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id, grade_type, score, max_score, coefficient, grade_status, publication_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'graded','published')`,
      [schoolId, studentIds[grade.student_code].uuid, classId, subjectIds[evaluation.subject_code], teacherId, termIds[evaluation.term_name], evaluationIds[grade.evaluation_key], evaluation.type_code, grade.score, evaluation.max_score]
    );
  }
  return { schoolId, yearId, classId, studentIds, name };
}

const state = {};

function request(method, pathname, principalKey, body, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      { host: "127.0.0.1", port: state.port, method, path: pathname, headers: { "x-test-principal": principalKey || "", ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}) } },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          let data = null;
          if (!binary || !/pdf/.test(String(res.headers["content-type"] || ""))) {
            try {
              data = JSON.parse(raw.toString("utf8"));
            } catch {
              data = raw.toString("utf8");
            }
          }
          resolve({ status: res.statusCode, data, raw, contentType: String(res.headers["content-type"] || "") });
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

async function publishClass(school, period, principal) {
  const preview = await request("POST", "/api/report-card/publications/preview", principal, body(school, period));
  assert.equal(preview.status, 200, JSON.stringify(preview.data).slice(0, 300));
  const published = await request("POST", "/api/report-card/publications", principal, body(school, period, { expectedDraftSha256: preview.data.draft.draft_sha256 }));
  assert.equal(published.status, 201, JSON.stringify(published.data).slice(0, 300));
  return { preview: preview.data.draft, publications: published.data.publications };
}

function pdfText(buffer, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui01-pdf-"));
  const file = path.join(dir, `${name}.pdf`);
  fs.writeFileSync(file, buffer);
  if (process.env.SOMAFRIK_UI01_PDF_OUT) {
    fs.mkdirSync(process.env.SOMAFRIK_UI01_PDF_OUT, { recursive: true });
    fs.copyFileSync(file, path.join(process.env.SOMAFRIK_UI01_PDF_OUT, `${name}.pdf`));
  }
  try {
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function snapshotRows(pool) {
  return (await pool.query("SELECT report_card_id, published_snapshot_version, snapshot_sha256 FROM report_card_published_snapshots ORDER BY report_card_id, published_snapshot_version")).rows;
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
    countryId: country, code: "BI-2026-0301", login: "BI-COL-26-001", short: "COL", name: "Lycée La Colombière",
    termNames: support.TERM_NAMES, types: ["interrogation", "examen"], subjects: simpleSubjects, courses: simpleSubjects,
    students: { STU1: ["Ama", "Ndayishimiye"], STU2: ["Bo", "Irakoze"] }, profile: support.simpleProfile(), facts: support.simpleFixture.facts, mode: "sum", classCode: "UI01-A",
  });
  const compositeSubjects = support.compositeProfile().subjects.map((s) => s.id);
  state.b = await seedSchool(pool, {
    countryId: country, code: "BI-2026-0302", login: "BI-BSG-26-001", short: "BSG", name: "École Le Berceau de la Sagesse",
    termNames: { T1: "Trimestre 1", T2: "Trimestre 2", T3: "Trimestre 3" }, types: ["devoir", "examen"], subjects: compositeSubjects,
    courses: ["FRANCAIS", "MATHEMATIQUES", "ARTS", "ANGLAIS"], parents: COMPOSITE_PARENTS,
    students: { STU1: ["Ama", "Hakizimana"] }, profile: support.compositeProfile(), facts: support.compositeFixture.facts.map((f) => ({ ...f })), mode: "weighted_average", classCode: "UI01-B",
  });
  state.a.modelKey = "ui01-a";
  state.b.modelKey = "ui01-b";

  const profileStore = createAcademicRuleProfileStore();
  const schemaStore = createReportCardSchemaStore();
  const keys = { signingKey: generateSigningKey("rc-ed25519-1"), wrapping: generateWrappingKey("rc-wrap-1") };
  const principals = {
    adminA: { sub: "aaaaaaaa-0000-4000-8000-000000000011", role: "Admin School", schoolId: state.a.schoolId, permissions: ["Bulletins:READ", "Bulletins:UPDATE"] },
    teacherA: { sub: "aaaaaaaa-0000-4000-8000-000000000013", role: "Enseignant", schoolId: state.a.schoolId, permissions: ["Voir bulletins", "Bulletins:READ", "Notes:CREATE"] },
    adminB: { sub: "bbbbbbbb-0000-4000-8000-000000000011", role: "Admin School", schoolId: state.b.schoolId, permissions: ["Bulletins:READ", "Bulletins:UPDATE"] },
    superadmin: { sub: "cccccccc-0000-4000-8000-000000000011", role: "Super Administrateur Somafrik" },
    parentA1: {
      sub: "dddddddd-0000-4000-8000-000000000011", role: "Parent", schoolId: state.a.schoolId, permissions: ["Bulletins:READ"],
      user: { id: "dddddddd-0000-4000-8000-000000000011", role: "Parent", children: [{ studentId: state.a.studentIds.STU1.uuid, studentCode: state.a.studentIds.STU1.code }] },
    },
    parentNone: { sub: "dddddddd-0000-4000-8000-000000000012", role: "Parent", schoolId: state.a.schoolId, permissions: ["Bulletins:READ"], user: { id: "dddddddd-0000-4000-8000-000000000012", role: "Parent", children: [] } },
  };
  const bindings = createReportCardHttpBindings({
    env: {},
    createPdf: (publication) => createReportCardPdf({ publication }),
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
  for (const [school, profileRaw, schemaRaw, templateSpec] of [
    [state.a, support.simpleProfile(), support.simpleFixture.schema, TEMPLATE_A],
    [state.b, support.compositeProfile(), support.compositeFixture.schema, TEMPLATE_B],
  ]) {
    const p = profileStore.createProfile({ schoolId: school.schoolId, actorSchoolId: school.schoolId, profileKey: school.modelKey, spec: profileRaw, activate: true });
    const s = schemaStore.createSchema({ schoolId: school.schoolId, actorSchoolId: school.schoolId, schemaKey: school.modelKey, spec: schemaRaw, activate: true });
    await activateQualificationBinding(bindings.getConfiguration(), school.schoolId, {
      modelKey: school.modelKey,
      profile: { id: p.profile.id, version: p.version.version },
      schema: { id: s.schema.id, version: s.version.version },
      templateSpec,
    });
  }
  // Bulletin historique (format LOT 9, sans totaux par matière) publié avant ce chantier.
  state.legacyPayload = {
    report_card_id: "rc-legacy-ui01",
    published_snapshot_version: 1,
    school_id: state.a.schoolId,
    published_at: "2026-10-01T08:00:00.000Z",
    engine_id: "somafrik.report_card.v1",
    provenance: { profile: { id: "legacy-p", version: 1, spec_sha256: "aa" }, schema: { id: "legacy-s", version: 1, spec_sha256: "bb" } },
    students: [{ student_id: state.a.studentIds.STU1.code, cells: [{ subject_id: "GEOGRAPHIE", period_id: "T1", score_component_id: "TJ", kind: "NUMERIC", exposed: 12 }], slots: [], presence: [] }],
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

test("aperçu : présentation NON OFFICIELLE par matières, libellés de l'établissement, aucune écriture", { skip }, async () => {
  const before = await snapshotRows(state.pool);
  const res = await request("POST", "/api/report-card/publications/preview", "adminA", body(state.a, "ANNUAL"));
  assert.equal(res.status, 200);
  const stu1 = res.data.draft.students.find((s) => s.student_id === state.a.studentIds.STU1.code);
  const view = stu1.presentation;
  assert.equal(view.official, false, "un aperçu n'est jamais officiel");
  assert.equal(view.style, "simple");
  assert.equal(view.school.name, "Lycée La Colombière");
  assert.equal(view.class_name, "6ème A");
  assert.equal(view.academic_year, "2026-2027");
  assert.equal(view.student.name, "Ndayishimiye Ama");
  assert.deepEqual(view.rows.map((row) => row.label), ["Géographie", "Mathématiques", "Éducation physique"]);
  assert.deepEqual(view.periods.map((p) => p.id), ["T1", "T2", "T3"]);
  // Valeurs = celles du moteur (subject_totals du brouillon), jamais recalculées.
  assert.equal(view.totals.annual.points, stu1.subject_totals.annual.points.exposed);
  assert.equal(view.totals.annual.percentage, 80.91);
  assert.equal(view.totals.annual.rank.value, 1);
  const math = view.rows.find((row) => row.subject_id === "MATHEMATIQUES");
  assert.equal(math.periods.T3.components.EX.max, 80, "maximum surchargé pour T3 (profil, pas code)");
  assert.deepEqual(await snapshotRows(state.pool), before, "aperçu : aucun snapshot écrit");
});

test("enseignant sans permission de publication, plateforme : aperçu et publication refusés", { skip }, async () => {
  for (const principal of ["teacherA", "superadmin"]) {
    const preview = await request("POST", "/api/report-card/publications/preview", principal, body(state.a, "T1"));
    assert.ok([400, 403].includes(preview.status), `${principal} aperçu ${preview.status}`);
    const publish = await request("POST", "/api/report-card/publications", principal, body(state.a, "T1", { expectedDraftSha256: "x" }));
    assert.ok([400, 403].includes(publish.status), `${principal} publication ${publish.status}`);
    assert.equal(JSON.stringify(publish.data).includes("Ama"), false, "aucune donnée nominative dans l'erreur");
  }
});

test("modèle A publié : présentation officielle fidèle au snapshot, PDF officiel réel, snapshot immuable", { skip: skipPdfText }, async () => {
  const { preview } = await publishClass(state.a, "ANNUAL", "adminA");
  state.aIds = Object.fromEntries(preview.students.map((student) => [student.student_id, student.report_card_id]));
  const own = { report_card_id: state.aIds[state.a.studentIds.STU1.code] };
  const snapshotBefore = await request("GET", `/api/report-card/publications/${own.report_card_id}/snapshot?version=1`, "adminA");
  const rowsBefore = await snapshotRows(state.pool);
  const pres = await request("GET", `/api/report-card/publications/${own.report_card_id}/presentation?version=1`, "adminA");
  assert.equal(pres.status, 200, JSON.stringify(pres.data).slice(0, 300));
  const view = pres.data.presentation[0];
  const sealed = snapshotBefore.data.payload.students[0].subject_totals;
  assert.equal(view.official, true);
  assert.equal(view.verification_status, "ACTIVE");
  assert.equal(view.totals.annual.points, sealed.annual.points.exposed);
  for (const period of ["T1", "T2", "T3"]) {
    assert.equal(view.totals.periods[period].points, sealed.periods[period].points.exposed, period);
    assert.equal(view.totals.periods[period].max, sealed.periods[period].max_points.exposed, period);
  }
  const pdf = await request("GET", `/api/report-card/publications/${own.report_card_id}/pdf?version=1`, "adminA", undefined, { binary: true });
  assert.equal(pdf.status, 200);
  assert.match(pdf.contentType, /pdf/);
  const text = pdfText(pdf.raw, "modele-A-la-colombiere-annuel");
  for (const expected of ["Lycée La Colombière", "Ndayishimiye Ama", "6ème A", "2026-2027", "Géographie", "Mathématiques", "Éducation physique", "Total annuel", "Pourcentage", "Rang", "Appréciations", "Le titulaire", "Le directeur", "Le parent"]) {
    assert.ok(text.includes(expected), `PDF A : « ${expected} » absent`);
  }
  assert.ok(text.includes(`${view.totals.annual.percentage} %`), "pourcentage du snapshot dans le PDF");
  assert.equal(/BROUILLON/i.test(text), false, "un bulletin publié n'est jamais marqué brouillon");
  const snapshotAfter = await request("GET", `/api/report-card/publications/${own.report_card_id}/snapshot?version=1`, "adminA");
  assert.deepEqual(snapshotAfter.data.payload, snapshotBefore.data.payload, "snapshot inchangé après présentation et PDF");
  assert.deepEqual(await snapshotRows(state.pool), rowsBefore, "aucune écriture par la lecture ou le rendu");
});

test("modèle B publié : matières principales, sous-totaux du moteur sans double comptage, PDF réel", { skip: skipPdfText }, async () => {
  const { publications } = await publishClass(state.b, "ANNUAL", "adminB");
  const id = publications[0].report_card_id;
  const snapshot = await request("GET", `/api/report-card/publications/${id}/snapshot?version=1`, "adminB");
  const sealed = snapshot.data.payload.students[0].subject_totals;
  const pres = await request("GET", `/api/report-card/publications/${id}/presentation?version=1`, "adminB");
  assert.equal(pres.status, 200);
  const view = pres.data.presentation[0];
  assert.equal(view.style, "hierarchical");
  const francais = view.rows.find((row) => row.subject_id === "FRANCAIS");
  assert.equal(francais.kind, "composite");
  assert.equal(francais.label, "Français");
  const children = view.rows.filter((row) => row.parent_id === "FRANCAIS").map((row) => row.label);
  assert.deepEqual(children, ["Écrit", "Lecture", "Dictée"]);
  const sealedFrancais = sealed.rows.find((row) => row.subject_id === "FRANCAIS");
  assert.equal(francais.periods.T1.points, sealedFrancais.periods.T1.points.exposed, "sous-total = moteur");
  // Le total général du snapshot est la somme des seules lignes de premier niveau.
  const top = view.rows.filter((row) => row.level === 0).reduce((acc, row) => acc + row.periods.T1.points, 0);
  const all = view.rows.reduce((acc, row) => acc + row.periods.T1.points, 0);
  assert.equal(view.totals.periods.T1.points, sealed.periods.T1.points.exposed);
  assert.ok(Math.abs(top - view.totals.periods.T1.points) < 1e-6, "total = premier niveau");
  assert.ok(all > view.totals.periods.T1.points, "additionner sous-matières ET matières doublerait les points");
  const pdf = await request("GET", `/api/report-card/publications/${id}/pdf?version=1`, "adminB", undefined, { binary: true });
  assert.equal(pdf.status, 200);
  const text = pdfText(pdf.raw, "modele-B-berceau-de-la-sagesse-annuel");
  for (const expected of ["École Le Berceau de la Sagesse", "Hakizimana Ama", "Français", "Écrit", "Lecture", "Dictée", "Calcul mental", "Calcul écrit", "Art plastique", "Musique", "EPS", "Anglais", "Total annuel", "La titulaire", "La directrice"]) {
    assert.ok(text.includes(expected), `PDF B : « ${expected} » absent`);
  }
});

test("trimestre seul : colonnes de la période, pas de bilan annuel", { skip }, async () => {
  const res = await request("POST", "/api/report-card/publications/preview", "adminB", body(state.b, "T1"));
  assert.equal(res.status, 200);
  const view = res.data.draft.students[0].presentation;
  assert.deepEqual(view.periods.map((p) => p.id), ["T1"]);
  assert.equal(view.totals.annual, null);
  assert.ok(view.rows.every((row) => row.annual === null));
});

test("isolation : autre établissement, parent non lié et parent lié", { skip: skipPdfText }, async () => {
  assert.ok(state.aIds, "dépend de la publication du modèle A");
  const ownRow = { report_card_id: state.aIds[state.a.studentIds.STU1.code] };
  const otherRow = { report_card_id: state.aIds[state.a.studentIds.STU2.code] };
  assert.ok(ownRow.report_card_id && otherRow.report_card_id);
  const route = (row) => `/api/report-card/publications/${row.report_card_id}/presentation?version=1`;
  const fromB = await request("GET", route(ownRow), "adminB");
  assert.ok([403, 404].includes(fromB.status), `autre établissement ${fromB.status}`);
  assert.equal(JSON.stringify(fromB.data).includes("Ndayishimiye"), false);
  const own = await request("GET", route(ownRow), "parentA1");
  assert.equal(own.status, 200);
  assert.deepEqual(own.data.presentation.map((view) => view.student.code), [state.a.studentIds.STU1.code]);
  for (const principal of ["parentA1", "parentNone"]) {
    const other = await request("GET", route(principal === "parentA1" ? otherRow : ownRow), principal);
    assert.ok([403, 404].includes(other.status), `${principal} ${other.status}`);
    assert.equal(JSON.stringify(other.data).includes("Irakoze"), false);
    assert.equal(JSON.stringify(other.data).includes("Ndayishimiye"), false);
  }
  const preview = await request("POST", "/api/report-card/publications/preview", "parentA1", body(state.a, "T1"));
  assert.equal(preview.status, 403, "un parent n'accède jamais à un aperçu non publié");
});

test("compatibilité : bulletin historique sans totaux par matière (présentation nulle, PDF générique)", { skip: skipPdfText }, async () => {
  const pres = await request("GET", `/api/report-card/publications/${state.legacyPayload.report_card_id}/presentation?version=1`, "adminA");
  assert.equal(pres.status, 200);
  assert.equal(pres.data.presentation, null);
  const pdf = await request("GET", `/api/report-card/publications/${state.legacyPayload.report_card_id}/pdf?version=1`, "adminA", undefined, { binary: true });
  assert.equal(pdf.status, 200);
  const text = pdfText(pdf.raw, "historique-generique");
  assert.ok(text.includes("rc-legacy-ui01"), "rendu générique d'origine");
  assert.ok(text.includes("GEOGRAPHIE"));
});
