"use strict";

/**
 * BULLETIN-CLASSE-01 / L2 — configuration du bulletin par classe et année (HTTP + PostgreSQL réels).
 *
 * Base jetable, démarrage réel (repository.init), migrations catalogue et L1 appliquées
 * explicitement, store de configuration PostgreSQL réel. Établissement A (CD) : classes C1
 * (Mathématiques, Français, Éducation civique) et C2 (Mathématiques, Sciences) en 2026-2027,
 * C3 en 2027-2028 ; établissement B (CD).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const express = require("express");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../../db/repositoryFactory");
const { REPORT_CARD_CATALOG_SQL } = require("../../db/reportCardCatalogSchema");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { createReportCardConfigurationPgStore } = require("../../db/reportCardConfigurationPgStore");
const { registerReportCardHttp } = require("./reportCardHttp");
const { createReportCardHttpBindings } = require("../reportCardHttpRuntime");
const { resolveReportCardActorFromPrincipal } = require("../reportCardHttpActor");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_report_card_class_scope_l2_it";
const skip = DATABASE_URL ? false : "DATABASE_URL absent (exécuter via npm run test:backend-baseline:pg)";
const L1_SQL = fs.readFileSync(path.resolve(__dirname, "../../db/migrations/20261105_report_card_class_scope.sql"), "utf8");
const TERMS = ["Trimestre 1", "Trimestre 2", "Trimestre 3"];
const MODEL = "colombiere";

function withDatabase(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const state = {};

async function one(sql, params) {
  return (await state.pool.query(sql, params)).rows[0];
}

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
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function seedSchool({ code, login, short, name }) {
  await state.pool.query("ALTER TABLE schools DISABLE TRIGGER USER");
  const schoolId = (await one(
    "INSERT INTO schools (country_id, school_code, login_code, short_code, name, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id",
    [state.cd, code, login, short, name]
  )).id;
  await state.pool.query("ALTER TABLE schools ENABLE TRIGGER USER");
  const teacherId = (await one("INSERT INTO teachers (school_id, teacher_code) VALUES ($1,$2) RETURNING id", [schoolId, `${short}-T1`])).id;
  const types = {};
  for (const [typeCode, typeName] of [["interrogation", "Interrogation"], ["examen", "Examen"]]) {
    types[typeCode] = (await one("INSERT INTO evaluation_types (school_id, code, name) VALUES ($1,$2,$3) RETURNING id", [schoolId, typeCode, typeName])).id;
  }
  const subjects = {};
  for (const [subjectCode, subjectName] of [["MATHEMATIQUES", "Mathématiques"], ["FRANCAIS", "Français"], ["CIVISME", "Éducation civique"], ["SCIENCES", "Sciences"]]) {
    subjects[subjectCode] = (await one("INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,$2,$3,'active') RETURNING id", [schoolId, subjectCode, subjectName])).id;
  }
  return { schoolId, teacherId, types, subjects, short, years: {}, classes: {} };
}

async function addYear(school, key, yearName, current) {
  const yearId = (await one("INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,$2,$3,'open') RETURNING id", [school.schoolId, yearName, current])).id;
  const terms = {};
  for (const termName of TERMS) terms[termName] = (await one("INSERT INTO terms (academic_year_id, name) VALUES ($1,$2) RETURNING id", [yearId, termName])).id;
  school.years[key] = { id: yearId, terms };
}

/** Classe avec cours et notes publiées : `maxima` par matière, `ratio` par élève. */
async function addClass(school, key, yearKey, maxima, students) {
  const year = school.years[yearKey];
  const classId = (await one("INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1,$2,$3,$4) RETURNING id", [school.schoolId, year.id, `${school.short}-${key}`, key])).id;
  const enrolled = {};
  for (const [fixture, [firstName, lastName]] of Object.entries(students)) {
    const row = await one("INSERT INTO students (school_id, student_code, first_name, last_name) VALUES ($1,$2,$3,$4) RETURNING id, student_code", [school.schoolId, `${school.short}-${key}-${fixture}`, firstName, lastName]);
    await state.pool.query("INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1,$2,$3,$4,'active')", [school.schoolId, row.id, classId, year.id]);
    enrolled[fixture] = { uuid: row.id, code: row.student_code };
  }
  for (const [subjectCode, components] of Object.entries(maxima)) {
    const subjectId = school.subjects[subjectCode];
    await state.pool.query("INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code) VALUES ($1,$2,$3,$4,$5)", [school.schoolId, classId, subjectId, school.teacherId, `${school.short}-${key}-${subjectCode}`]);
    for (const termName of TERMS) {
      for (const [component, max] of Object.entries(components)) {
        const typeCode = component === "TJ" ? "interrogation" : "examen";
        const evaluationId = (await one(
          `INSERT INTO evaluations (school_id, class_id, subject_id, teacher_id, term_id, title, evaluation_type, evaluation_type_id, max_score, coefficient, status, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'published',TRUE) RETURNING id`,
          [school.schoolId, classId, subjectId, school.teacherId, year.terms[termName], `${key}-${subjectCode}-${component}-${termName}`, typeCode, school.types[typeCode], max]
        )).id;
        for (const [fixture, ratio] of Object.entries({ S1: 0.8, S2: 0.4 })) {
          if (!enrolled[fixture]) continue;
          await state.pool.query(
            `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id, grade_type, score, max_score, coefficient, grade_status, publication_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'graded','published')`,
            [school.schoolId, enrolled[fixture].uuid, classId, subjectId, school.teacherId, year.terms[termName], evaluationId, typeCode, Math.round(max * ratio), max]
          );
        }
      }
    }
  }
  school.classes[key] = { id: classId, yearId: year.id, students: enrolled };
}

const SOURCES = { TJ: { evaluationTypes: ["interrogation"], aggregation: "sum" }, EX: { evaluationTypes: ["examen"], aggregation: "sum" } };
const PERIODS = { T1: { termNames: ["Trimestre 1"] }, T2: { termNames: ["Trimestre 2"] }, T3: { termNames: ["Trimestre 3"] } };
const SCHOOL_INPUT = {
  structure: "TJ_EX",
  subjects: [
    { code: "MATHEMATIQUES", components: { TJ: { max: 20 }, EX: { max: 20 } } },
    { code: "FRANCAIS", components: { TJ: { max: 20 }, EX: { max: 20 } } },
    { code: "CIVISME", components: { TJ: { max: 10 } } },
  ],
  factSources: SOURCES,
  periods: PERIODS,
  signatures: ["Le directeur"],
};
const C1_INPUT = {
  structure: "TJ_EX",
  subjects: [
    { code: "MATHEMATIQUES", components: { TJ: { max: 20 }, EX: { max: 20 } } },
    { code: "FRANCAIS", components: { TJ: { max: 20 }, EX: { max: 20 } } },
    { code: "CIVISME", components: { TJ: { max: 10 } } },
  ],
  factSources: SOURCES,
  periods: PERIODS,
  signatures: ["Le titulaire de C1", "Le directeur"],
};
const C2_INPUT = {
  structure: "TJ_EX",
  subjects: [
    { code: "MATHEMATIQUES", components: { TJ: { max: 10 }, EX: { max: 10 } } },
    { code: "SCIENCES", components: { TJ: { max: 20 }, EX: { max: 20 } } },
  ],
  factSources: SOURCES,
  periods: PERIODS,
  signatures: ["Le titulaire de C2"],
};

const base = `/api/report-card/catalog/models/${MODEL}`;
const configure = (principal, classId, input) => request("PUT", `${base}/configuration`, principal, { input, ...(classId ? { classId } : {}) });
const activateFor = (principal, classId) => request("POST", `${base}/activate`, principal, { confirm: true, ...(classId ? { classId } : {}) });
const contextFor = (principal, classId) => request("GET", `${base}/configuration${classId ? `?classId=${classId}` : ""}`, principal);
const catalogFor = (principal, classId) => request("GET", `/api/report-card/catalog${classId ? `?classId=${classId}` : ""}`, principal);

async function bindingRows() {
  return (await state.pool.query(
    `SELECT class_id, academic_year_id, profile_id, profile_version, profile_spec_sha256, rendering_template_spec_sha256
       FROM report_card_active_bindings WHERE school_id = $1 ORDER BY class_id NULLS FIRST`,
    [state.a.schoolId]
  )).rows;
}

async function previewClass(classKey, period = "T1") {
  const cls = state.a.classes[classKey];
  return request("POST", "/api/report-card/publications/preview", "adminA", { classId: cls.id, academicYearId: cls.yearId, modelKey: `catalog-${MODEL}`, period });
}

before(async () => {
  if (skip) return;
  const admin = new Pool({ connectionString: withDatabase(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DATABASE]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: url });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  state.repo = createPostgresRepository(url);
  await state.repo.init();
  state.pool = state.repo.pool;
  await state.pool.query(REPORT_CARD_CATALOG_SQL);
  await state.pool.query(`BEGIN;\n${L1_SQL}\nCOMMIT;`);
  await state.pool.query("ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL; ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;");
  state.cd = (await one("INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('République démocratique du Congo','CD','+243','CDF') RETURNING id")).id;
  state.a = await seedSchool({ code: "CD-2026-0501", login: "CD-L2A-26-001", short: "L2A", name: "Lycée Alpha" });
  state.b = await seedSchool({ code: "CD-2026-0502", login: "CD-L2B-26-001", short: "L2B", name: "Lycée Beta" });
  await addYear(state.a, "Y1", "2026-2027", true);
  await addYear(state.a, "Y2", "2027-2028", false);
  await addYear(state.b, "Y1", "2026-2027", true);
  await addClass(state.a, "C1", "Y1", { MATHEMATIQUES: { TJ: 20, EX: 20 }, FRANCAIS: { TJ: 20, EX: 20 }, CIVISME: { TJ: 10 } }, { S1: ["Ama", "Mukendi"], S2: ["Bo", "Kabila"] });
  await addClass(state.a, "C2", "Y1", { MATHEMATIQUES: { TJ: 10, EX: 10 }, SCIENCES: { TJ: 20, EX: 20 } }, { S1: ["Céline", "Ilunga"] });
  await addClass(state.a, "C3", "Y2", { MATHEMATIQUES: { TJ: 20, EX: 20 } }, { S1: ["Dan", "Tshala"] });
  await addClass(state.b, "C1", "Y1", { MATHEMATIQUES: { TJ: 20, EX: 20 } }, { S1: ["Eve", "Mbuyi"] });
  const principals = {
    superadmin: { sub: "cccccccc-0000-4000-8000-000000000051", role: "Super Administrateur Somafrik" },
    adminA: { sub: "aaaaaaaa-0000-4000-8000-000000000051", role: "Admin School", schoolId: state.a.schoolId, permissions: ["Bulletins:READ", "Bulletins:UPDATE"] },
    teacherA: { sub: "aaaaaaaa-0000-4000-8000-000000000052", role: "Enseignant", schoolId: state.a.schoolId, permissions: ["Bulletins:READ", "Voir bulletins"] },
    adminB: { sub: "bbbbbbbb-0000-4000-8000-000000000051", role: "Admin School", schoolId: state.b.schoolId, permissions: ["Bulletins:READ", "Bulletins:UPDATE"] },
  };
  const keys = { signingKey: generateSigningKey("rc-ed25519-1"), wrapping: generateWrappingKey("rc-wrap-1") };
  const bindings = createReportCardHttpBindings({
    env: {},
    createPdf: () => ({ render: async () => ({ pdf: Buffer.from("%PDF-1.4 stub") }) }),
    resolveActor: (req) => resolveReportCardActorFromPrincipal(principals[req.headers["x-test-principal"]] || null),
    overrides: {
      db: state.pool,
      profileStore: createAcademicRuleProfileStore(),
      schemaStore: createReportCardSchemaStore(),
      configurationPersistence: createReportCardConfigurationPgStore(state.pool),
      keys: { ...keys, wrappingKeys: [keys.wrapping], signingKeys: [keys.signingKey] },
    },
  });
  const app = express();
  app.use(express.json());
  registerReportCardHttp(app, bindings);
  state.server = http.createServer(app);
  await new Promise((resolve) => state.server.listen(0, "127.0.0.1", resolve));
  state.port = state.server.address().port;
  const enabled = await request("PUT", `/api/report-card/catalog/admin/models/${MODEL}/countries/${state.cd}`, "superadmin", { available: true, confirm: true });
  assert.equal(enabled.status, 200);
});

after(async () => {
  if (state.server) await new Promise((resolve) => state.server.close(resolve));
  if (state.pool && !state.pool.ended) await state.pool.end().catch(() => {});
});

test("1. configuration établissement existante : héritée par toutes les classes (lecture seule)", { skip }, async () => {
  assert.equal((await configure("adminA", null, SCHOOL_INPUT)).status, 200);
  assert.equal((await activateFor("adminA", null)).status, 200);
  for (const key of ["C1", "C2", "C3"]) {
    const listed = await catalogFor("adminA", state.a.classes[key].id);
    assert.equal(listed.status, 200);
    assert.equal(listed.data.class.id, state.a.classes[key].id);
    assert.equal(listed.data.models[0].configuration, "INHERITED", `${key} hérite`);
  }
  const c1 = await previewClass("C1");
  assert.equal(c1.status, 200, JSON.stringify(c1.data).slice(0, 300));
  assert.deepEqual(c1.data.draft.students[0].presentation.rows.map((r) => r.subject_id), ["MATHEMATIQUES", "FRANCAIS", "CIVISME"]);
  assert.deepEqual(c1.data.draft.students[0].presentation.signatures, ["Le directeur"], "signatures de l'établissement");
  // Publication T1 de C1 avec la configuration héritée : identité de référence.
  const published = await request("POST", "/api/report-card/publications", "adminA", {
    classId: state.a.classes.C1.id, academicYearId: state.a.classes.C1.yearId, modelKey: `catalog-${MODEL}`, period: "T1", expectedDraftSha256: c1.data.draft.draft_sha256,
  });
  assert.equal(published.status, 201, JSON.stringify(published.data).slice(0, 600));
  state.c1InheritedIds = c1.data.draft.students.map((s) => s.report_card_id).sort();
});

test("2. contexte de classe : seules les matières enseignées dans la classe, année de la classe", { skip }, async () => {
  const c1 = await contextFor("adminA", state.a.classes.C1.id);
  assert.equal(c1.status, 200, JSON.stringify(c1.data).slice(0, 300));
  assert.deepEqual(c1.data.subjects.map((s) => s.code).sort(), ["CIVISME", "FRANCAIS", "MATHEMATIQUES"]);
  assert.equal(c1.data.class.academic_year_name, "2026-2027");
  assert.equal(c1.data.configuration, "INHERITED");
  assert.deepEqual(c1.data.current.subjects.map((s) => s.code), ["MATHEMATIQUES", "FRANCAIS", "CIVISME"], "pré-rempli depuis la configuration héritée");
  const c2 = await contextFor("adminA", state.a.classes.C2.id);
  assert.deepEqual(c2.data.subjects.map((s) => s.code).sort(), ["MATHEMATIQUES", "SCIENCES"]);
  const refused = await configure("adminA", state.a.classes.C1.id, { ...C1_INPUT, subjects: [...C1_INPUT.subjects, { code: "SCIENCES", components: { TJ: { max: 20 } } }] });
  assert.equal(refused.status, 422);
  assert.ok(refused.data.details.some((d) => d.field === "subjects.3" && d.code === "SUBJECT_NOT_IN_CLASS"), JSON.stringify(refused.data.details));
});

test("3. activation indépendante : C1 et C2 ont chacune leur configuration, aucune propagation", { skip }, async () => {
  assert.equal((await configure("adminA", state.a.classes.C1.id, C1_INPUT)).status, 200);
  const savedState = await catalogFor("adminA", state.a.classes.C1.id);
  assert.equal(savedState.data.models[0].configuration, "SAVED", "enregistrée, pas encore active");
  assert.equal((await activateFor("adminA", state.a.classes.C1.id)).status, 200);
  const afterC1 = await bindingRows();
  assert.equal(afterC1.length, 2, "établissement + C1");
  assert.equal((await catalogFor("adminA", state.a.classes.C1.id)).data.models[0].configuration, "ACTIVE");
  assert.equal((await catalogFor("adminA", state.a.classes.C2.id)).data.models[0].configuration, "INHERITED", "C2 inchangée");

  assert.equal((await configure("adminA", state.a.classes.C2.id, C2_INPUT)).status, 200);
  assert.equal((await activateFor("adminA", state.a.classes.C2.id)).status, 200);
  const afterC2 = await bindingRows();
  assert.equal(afterC2.length, 3);
  assert.deepEqual(afterC2.find((r) => r.class_id === state.a.classes.C1.id), afterC1.find((r) => r.class_id === state.a.classes.C1.id), "C1 inchangée par C2");
  assert.deepEqual(afterC2.find((r) => r.class_id === null), afterC1.find((r) => r.class_id === null), "établissement inchangé");
  assert.notEqual(
    afterC2.find((r) => r.class_id === state.a.classes.C1.id).profile_id,
    afterC2.find((r) => r.class_id === state.a.classes.C2.id).profile_id,
    "profils distincts (clés de versions par classe)"
  );
  // Nouvelle version de C1 : C2 et l'établissement inchangés.
  assert.equal((await configure("adminA", state.a.classes.C1.id, { ...C1_INPUT, signatures: ["Nouveau titulaire C1"] })).status, 200);
  assert.equal((await activateFor("adminA", state.a.classes.C1.id)).status, 200);
  const afterUpdate = await bindingRows();
  assert.deepEqual(afterUpdate.find((r) => r.class_id === state.a.classes.C2.id), afterC2.find((r) => r.class_id === state.a.classes.C2.id));
  assert.deepEqual(afterUpdate.find((r) => r.class_id === null), afterC2.find((r) => r.class_id === null));
  assert.notEqual(afterUpdate.find((r) => r.class_id === state.a.classes.C1.id).rendering_template_spec_sha256, afterC2.find((r) => r.class_id === state.a.classes.C1.id).rendering_template_spec_sha256);
  // C3 (autre année) : toujours héritée.
  assert.equal((await catalogFor("adminA", state.a.classes.C3.id)).data.models[0].configuration, "INHERITED");
});

test("4. publication : chaque classe utilise SA configuration (matières, maxima, signatures)", { skip }, async () => {
  const c1 = await previewClass("C1", "T2");
  assert.equal(c1.status, 200, JSON.stringify(c1.data).slice(0, 300));
  const c1View = c1.data.draft.students[0].presentation;
  assert.deepEqual(c1View.rows.map((r) => r.subject_id), ["MATHEMATIQUES", "FRANCAIS", "CIVISME"]);
  assert.deepEqual(c1View.signatures, ["Nouveau titulaire C1"]);
  const c2 = await previewClass("C2", "T2");
  assert.equal(c2.status, 200, JSON.stringify(c2.data).slice(0, 300));
  const c2View = c2.data.draft.students[0].presentation;
  assert.deepEqual(c2View.rows.map((r) => r.subject_id), ["MATHEMATIQUES", "SCIENCES"]);
  assert.equal(c2View.rows[0].periods.T1.components.TJ.max, 10, "maxima propres à C2");
  assert.deepEqual(c2View.signatures, ["Le titulaire de C2"]);
  const c3 = await request("POST", "/api/report-card/publications/preview", "adminA", { classId: state.a.classes.C3.id, academicYearId: state.a.classes.C3.yearId, modelKey: `catalog-${MODEL}`, period: "T1" });
  assert.equal(c3.status, 200);
  assert.deepEqual(c3.data.draft.students[0].presentation.rows.map((r) => r.subject_id), ["MATHEMATIQUES", "FRANCAIS", "CIVISME"], "C3 : configuration héritée");
  assert.deepEqual(c3.data.draft.students[0].presentation.signatures, ["Le directeur"]);
});

test("5. identité des bulletins : report_card_id inchangé, aucun second bulletin officiel", { skip }, async () => {
  const c1 = await previewClass("C1", "T1");
  assert.deepEqual(c1.data.draft.students.map((s) => s.report_card_id).sort(), state.c1InheritedIds, "mêmes report_card_id après passage à la configuration de classe");
  const republish = await request("POST", "/api/report-card/publications", "adminA", {
    classId: state.a.classes.C1.id, academicYearId: state.a.classes.C1.yearId, modelKey: `catalog-${MODEL}`, period: "T1", expectedDraftSha256: c1.data.draft.draft_sha256,
  });
  assert.equal(republish.status, 409, "contenu différent : correction officielle requise, pas de doublon");
  const count = await one("SELECT count(*)::int AS n FROM report_card_published_snapshots WHERE report_card_id = ANY($1)", [state.c1InheritedIds]);
  assert.equal(count.n, state.c1InheritedIds.length, "une seule version par bulletin");
});

test("6. isolation et droits : autre établissement, classe inconnue, enseignant, Superadmin", { skip }, async () => {
  const foreign = await contextFor("adminA", state.b.classes.C1.id);
  assert.equal(foreign.status, 404);
  assert.equal(foreign.data.code, "CLASS_NOT_FOUND");
  assert.equal((await configure("adminA", state.b.classes.C1.id, C1_INPUT)).status, 404);
  assert.equal((await activateFor("adminA", state.b.classes.C1.id)).status, 404);
  assert.equal((await contextFor("adminA", "pas-un-uuid")).status, 404);
  assert.equal((await configure("teacherA", state.a.classes.C1.id, C1_INPUT)).status, 403);
  assert.equal((await contextFor("superadmin", state.a.classes.C1.id)).status, 403);
  // Établissement B : aucune configuration visible, ni héritée ni de classe.
  const b = await catalogFor("adminB", state.b.classes.C1.id);
  assert.equal(b.data.models[0].configuration, "NONE");
  const bBindings = await one("SELECT count(*)::int AS n FROM report_card_active_bindings WHERE school_id = $1", [state.b.schoolId]);
  assert.equal(bBindings.n, 0);
});
