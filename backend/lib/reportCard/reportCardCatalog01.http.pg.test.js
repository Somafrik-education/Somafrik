"use strict";

/**
 * BULLETIN-CATALOG-01 — catalogue par pays, de bout en bout (HTTP + PostgreSQL).
 *
 * Base jetable `somafrik_report_card_catalog01_it`. La migration du catalogue
 * est appliquée EXPLICITEMENT par ce test (jamais au démarrage du serveur).
 * Pays canoniques (`countries`), établissements A (CD), C (CD), B (BI).
 * Routes réelles, acteurs résolus par resolveReportCardActorFromPrincipal,
 * stores PostgreSQL réels (catalogue, configuration LOT 6, notes, publication).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../../db/repositoryFactory");
const { createSubjectHierarchyPgStore } = require("../../db/subjectHierarchyPgStore");
const { REPORT_CARD_CATALOG_SQL } = require("../../db/reportCardCatalogSchema");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { createInMemoryConfigurationPersistence } = require("./reportCardConfiguration");
const { registerReportCardHttp } = require("./reportCardHttp");
const { createReportCardHttpBindings } = require("../reportCardHttpRuntime");
const { resolveReportCardActorFromPrincipal } = require("../reportCardHttpActor");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_report_card_catalog01_it";
const skip = DATABASE_URL ? false : "DATABASE_URL absent (exécuter via npm run test:backend-baseline:pg)";
const TERMS = ["Trimestre 1", "Trimestre 2", "Trimestre 3"];

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

/** Établissement avec référentiels ; `grades` : notes publiées sur tout le barème (proportion fixe). */
async function seedSchool(pool, { countryId, code, login, short, name, subjects, parents = {}, students = {}, grades = null }) {
  await pool.query("ALTER TABLE schools DISABLE TRIGGER USER");
  const schoolId = (await one(pool, "INSERT INTO schools (country_id, school_code, login_code, short_code, name, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id", [countryId, code, login, short, name])).id;
  await pool.query("ALTER TABLE schools ENABLE TRIGGER USER");
  const yearId = (await one(pool, "INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027',TRUE,'open') RETURNING id", [schoolId])).id;
  const termIds = {};
  for (const termName of TERMS) termIds[termName] = (await one(pool, "INSERT INTO terms (academic_year_id, name) VALUES ($1,$2) RETURNING id", [yearId, termName])).id;
  const classId = (await one(pool, "INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1,$2,$3,'6ème A') RETURNING id", [schoolId, yearId, `${short}-6A`])).id;
  const teacherId = (await one(pool, "INSERT INTO teachers (school_id, teacher_code) VALUES ($1,$2) RETURNING id", [schoolId, `${short}-T1`])).id;
  const typeIds = {};
  for (const [typeCode, typeName] of [["interrogation", "Interrogation"], ["examen", "Examen"], ["devoir", "Devoir"]]) {
    typeIds[typeCode] = (await one(pool, "INSERT INTO evaluation_types (school_id, code, name) VALUES ($1,$2,$3) RETURNING id", [schoolId, typeCode, typeName])).id;
  }
  const subjectIds = {};
  for (const [subjectCode, subjectName] of Object.entries(subjects)) {
    subjectIds[subjectCode] = (await one(pool, "INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,$2,$3,'active') RETURNING id", [schoolId, subjectCode, subjectName])).id;
  }
  const hierarchy = createSubjectHierarchyPgStore(pool);
  for (const [child, parent] of Object.entries(parents)) await hierarchy.setSubjectParent({ schoolId, subjectCode: child, parentSubjectCode: parent });
  const studentIds = {};
  for (const [fixtureCode, [firstName, lastName]] of Object.entries(students)) {
    const row = await one(pool, "INSERT INTO students (school_id, student_code, first_name, last_name) VALUES ($1,$2,$3,$4) RETURNING id, student_code", [schoolId, `${short}-${fixtureCode}`, firstName, lastName]);
    await pool.query("INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1,$2,$3,$4,'active')", [schoolId, row.id, classId, yearId]);
    studentIds[fixtureCode] = { uuid: row.id, code: row.student_code };
  }
  if (grades) {
    for (const [subjectCode, maxima] of Object.entries(grades.maxima)) {
      await pool.query("INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code) VALUES ($1,$2,$3,$4,$5)", [schoolId, classId, subjectIds[subjectCode], teacherId, `${short}-${subjectCode}`]);
      for (const termName of TERMS) {
        for (const [component, max] of Object.entries(maxima)) {
          const typeCode = component === "TJ" ? "interrogation" : "examen";
          const evaluationId = (await one(
            pool,
            `INSERT INTO evaluations (school_id, class_id, subject_id, teacher_id, term_id, title, evaluation_type, evaluation_type_id, max_score, coefficient, status, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'published',TRUE) RETURNING id`,
            [schoolId, classId, subjectIds[subjectCode], teacherId, termIds[termName], `${subjectCode}-${component}-${termName}`, typeCode, typeIds[typeCode], max]
          )).id;
          for (const [fixtureCode, ratio] of Object.entries(grades.ratios)) {
            await pool.query(
              `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id, grade_type, score, max_score, coefficient, grade_status, publication_status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'graded','published')`,
              [schoolId, studentIds[fixtureCode].uuid, classId, subjectIds[subjectCode], teacherId, termIds[termName], evaluationId, typeCode, Math.round(max * ratio), max]
            );
          }
        }
      }
    }
  }
  return { schoolId, yearId, classId, studentIds, name };
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
          resolve({ status: res.statusCode, data, text });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const COLOMBIERE_INPUT = {
  structure: "TJ_EX",
  subjects: [
    { code: "MATHEMATIQUES", components: { TJ: { max: 20 }, EX: { max: 20 } } },
    { code: "FRANCAIS", components: { TJ: { max: 20 }, EX: { max: 20 } } },
    { code: "CIVISME", components: { TJ: { max: 10 } } },
  ],
  factSources: {
    TJ: { evaluationTypes: ["interrogation"], aggregation: "sum" },
    EX: { evaluationTypes: ["examen"], aggregation: "sum" },
  },
  periods: { T1: { termNames: ["Trimestre 1"] }, T2: { termNames: ["Trimestre 2"] }, T3: { termNames: ["Trimestre 3"] } },
  signatures: ["Le titulaire", "Le directeur", "Le parent"],
};

async function enable(modelId, countryId, available) {
  return request("PUT", `/api/report-card/catalog/admin/models/${modelId}/countries/${countryId}`, "superadmin", { available, confirm: true });
}

before(async () => {
  if (skip) return;
  const url = await resetDatabase();
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  state.repo = createPostgresRepository(url);
  await state.repo.init();
  const pool = state.repo.pool;
  state.pool = pool;
  const tables = await one(pool, "SELECT to_regclass('public.report_card_catalog_models') AS ref");
  state.tablesBeforeMigration = tables.ref;
  await pool.query(REPORT_CARD_CATALOG_SQL);
  await pool.query("ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL; ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;");
  state.cd = (await one(pool, "INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('République démocratique du Congo','CD','+243','CDF') RETURNING id")).id;
  state.bi = (await one(pool, "INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Burundi','BI','+257','BIF') RETURNING id")).id;
  state.sn = (await one(pool, "INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Sénégal','SN','+221','XOF') RETURNING id")).id;
  state.a = await seedSchool(pool, {
    countryId: state.cd, code: "CD-2026-0401", login: "CD-CAT-26-001", short: "CATA", name: "Lycée Alpha",
    subjects: { MATHEMATIQUES: "Mathématiques", FRANCAIS: "Français", CIVISME: "Éducation civique", LANGUES: "Langues", ANGLAIS: "Anglais" },
    parents: { ANGLAIS: "LANGUES" },
    students: { S1: ["Ama", "Mukendi"], S2: ["Bo", "Kabila"] },
    grades: { maxima: { MATHEMATIQUES: { TJ: 20, EX: 20 }, FRANCAIS: { TJ: 20, EX: 20 }, CIVISME: { TJ: 10 } }, ratios: { S1: 0.8, S2: 0.4 } },
  });
  state.c = await seedSchool(pool, {
    countryId: state.cd, code: "CD-2026-0402", login: "CD-CAT-26-002", short: "CATC", name: "École Gamma",
    subjects: { FRANCAIS: "Français", FR_ECRIT: "Écrit", FR_LECTURE: "Lecture", MATHEMATIQUES: "Mathématiques", MATH_MENTAL: "Calcul mental" },
    parents: { FR_ECRIT: "FRANCAIS", FR_LECTURE: "FRANCAIS", MATH_MENTAL: "MATHEMATIQUES" },
  });
  state.b = await seedSchool(pool, {
    countryId: state.bi, code: "BI-2026-0403", login: "BI-CAT-26-001", short: "CATB", name: "École Beta",
    subjects: { MATHEMATIQUES: "Mathématiques" },
  });
  const principals = {
    superadmin: { sub: "cccccccc-0000-4000-8000-000000000031", role: "Super Administrateur Somafrik" },
    adminA: { sub: "aaaaaaaa-0000-4000-8000-000000000031", role: "Admin School", schoolId: state.a.schoolId, permissions: ["Bulletins:READ", "Bulletins:UPDATE"] },
    teacherA: { sub: "aaaaaaaa-0000-4000-8000-000000000032", role: "Enseignant", schoolId: state.a.schoolId, permissions: ["Bulletins:READ", "Voir bulletins"] },
    parentA: { sub: "aaaaaaaa-0000-4000-8000-000000000033", role: "Parent", schoolId: state.a.schoolId, permissions: ["Bulletins:READ"], user: { id: "p", role: "Parent", children: [] } },
    adminC: { sub: "aaaaaaaa-0000-4000-8000-000000000034", role: "Admin School", schoolId: state.c.schoolId, permissions: ["Bulletins:READ", "Bulletins:UPDATE"] },
    adminB: { sub: "bbbbbbbb-0000-4000-8000-000000000031", role: "Admin School", schoolId: state.b.schoolId, permissions: ["Bulletins:READ", "Bulletins:UPDATE"] },
    // Établissement dont le pays ne peut pas être résolu (aucune ligne schools).
    adminGhost: { sub: "eeeeeeee-0000-4000-8000-000000000031", role: "Admin School", schoolId: "eeeeeeee-0000-4000-8000-0000000000aa", permissions: ["Bulletins:READ", "Bulletins:UPDATE"] },
  };
  const keys = { signingKey: generateSigningKey("rc-ed25519-1"), wrapping: generateWrappingKey("rc-wrap-1") };
  const bindings = createReportCardHttpBindings({
    env: {},
    createPdf: () => ({ render: async () => ({ pdf: Buffer.from("%PDF-1.4 stub") }) }),
    resolveActor: (req) => resolveReportCardActorFromPrincipal(principals[req.headers["x-test-principal"]] || null),
    overrides: {
      db: pool,
      profileStore: createAcademicRuleProfileStore(),
      schemaStore: createReportCardSchemaStore(),
      configurationPersistence: createInMemoryConfigurationPersistence(),
      keys: { ...keys, wrappingKeys: [keys.wrapping], signingKeys: [keys.signingKey] },
    },
  });
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

test("migration : aucune table du catalogue au démarrage ; migration explicite idempotente", { skip }, async () => {
  assert.equal(state.tablesBeforeMigration, null, "repository.init() ne crée pas le catalogue");
  await state.pool.query(REPORT_CARD_CATALOG_SQL);
  const models = (await state.pool.query("SELECT model_id FROM report_card_catalog_models ORDER BY model_id")).rows.map((row) => row.model_id);
  assert.deepEqual(models, ["berceau", "colombiere"]);
});

test("fail-closed : aucun modèle sans autorisation ; pays inconnu ⇒ aucun modèle", { skip }, async () => {
  const listed = await request("GET", "/api/report-card/catalog", "adminA");
  assert.equal(listed.status, 200);
  assert.equal(listed.data.country.name, "République démocratique du Congo");
  assert.deepEqual(listed.data.models, []);
  const ghost = await request("GET", "/api/report-card/catalog", "adminGhost");
  assert.equal(ghost.status, 200);
  assert.equal(ghost.data.country, null);
  assert.equal(ghost.data.reason, "COUNTRY_UNKNOWN");
  assert.deepEqual(ghost.data.models, []);
  const ctx = await request("GET", "/api/report-card/catalog/models/colombiere/configuration", "adminA");
  assert.equal(ctx.status, 403);
  assert.equal(ctx.data.code, "CATALOG_MODEL_NOT_AVAILABLE");
});

test("Superadmin : catalogue, aperçus réels, confirmation obligatoire, audit ; aucune donnée d'élève", { skip }, async () => {
  const overview = await request("GET", "/api/report-card/catalog/admin", "superadmin");
  assert.equal(overview.status, 200);
  assert.deepEqual(overview.data.countries.map((c) => c.iso_code).sort(), ["BI", "CD", "SN"]);
  const colombiere = overview.data.models.find((m) => m.model_id === "colombiere");
  assert.equal(colombiere.presentation_style, "simple");
  assert.equal(colombiere.preview.official, false);
  assert.equal(colombiere.preview.style, "simple");
  assert.deepEqual(colombiere.preview.components.map((c) => c.label), ["TJ", "EX"]);
  const berceau = overview.data.models.find((m) => m.model_id === "berceau");
  assert.ok(berceau.preview.rows.some((row) => row.kind === "composite"), "aperçu hiérarchique réel");
  for (const secret of ["Mukendi", "Kabila", "Lycée Alpha", "École Gamma", state.a.schoolId]) {
    assert.equal(overview.text.includes(secret), false, `aucune donnée d'établissement : ${secret}`);
  }
  const noConfirm = await request("PUT", `/api/report-card/catalog/admin/models/colombiere/countries/${state.cd}`, "superadmin", { available: true });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.data.code, "CONFIRMATION_REQUIRED");
  const enabled = await enable("colombiere", state.cd, true);
  assert.equal(enabled.status, 200);
  assert.equal(enabled.data.changed, true);
  assert.equal(enabled.data.previous, null);
  const again = await enable("colombiere", state.cd, true);
  assert.equal(again.data.changed, false, "valeur inchangée : aucune trace en double");
  const unknown = await enable("colombiere", "00000000-0000-4000-8000-000000000000", true);
  assert.equal(unknown.status, 409);
  assert.equal(unknown.data.code, "COUNTRY_UNKNOWN");
  const badModel = await enable("inexistant", state.cd, true);
  assert.equal(badModel.status, 404);
  const audit = await request("GET", "/api/report-card/catalog/admin/audit?modelId=colombiere", "superadmin");
  assert.equal(audit.status, 200);
  assert.equal(audit.data.audit.length, 1);
  assert.equal(audit.data.audit[0].old_available, null);
  assert.equal(audit.data.audit[0].new_available, true);
  assert.equal(audit.data.audit[0].country_name, "République démocratique du Congo");
  assert.equal(audit.data.audit[0].actor_id, "cccccccc-0000-4000-8000-000000000031");
  assert.ok(audit.data.audit[0].created_at);
});

test("rôles non habilités : ni gestion du catalogue ni configuration", { skip }, async () => {
  for (const principal of ["adminA", "teacherA", "parentA"]) {
    const put = await request("PUT", `/api/report-card/catalog/admin/models/berceau/countries/${state.cd}`, principal, { available: true, confirm: true });
    assert.equal(put.status, 403, `${principal} PUT disponibilité`);
    const admin = await request("GET", "/api/report-card/catalog/admin", principal);
    assert.equal(admin.status, 403, `${principal} GET admin`);
  }
  for (const principal of ["teacherA", "parentA"]) {
    const ctx = await request("GET", "/api/report-card/catalog/models/colombiere/configuration", principal);
    assert.equal(ctx.status, 403, `${principal} configuration`);
    const save = await request("PUT", "/api/report-card/catalog/models/colombiere/configuration", principal, { input: COLOMBIERE_INPUT });
    assert.equal(save.status, 403, `${principal} enregistrement`);
  }
  const parentList = await request("GET", "/api/report-card/catalog", "parentA");
  assert.equal(parentList.status, 403, "parent : catalogue non exposé");
  const saCtx = await request("GET", "/api/report-card/catalog/models/colombiere/configuration", "superadmin");
  assert.equal(saCtx.status, 403, "Superadmin : aucun accès au parcours école");
  const teacherList = await request("GET", "/api/report-card/catalog", "teacherA");
  assert.equal(teacherList.status, 200);
  assert.equal(teacherList.data.canConfigure, false);
});

test("établissement : seuls les modèles autorisés dans SON pays", { skip }, async () => {
  const a = await request("GET", "/api/report-card/catalog", "adminA");
  assert.deepEqual(a.data.models.map((m) => m.model_id), ["colombiere"]);
  assert.equal(a.data.models[0].available, true);
  assert.equal(a.data.models[0].configuration, "NONE");
  assert.equal(a.data.canConfigure, true);
  const b = await request("GET", "/api/report-card/catalog", "adminB");
  assert.equal(b.data.country.name, "Burundi");
  assert.deepEqual(b.data.models, [], "Burundi : modèle non autorisé, invisible");
  const bCtx = await request("GET", "/api/report-card/catalog/models/colombiere/configuration", "adminB");
  assert.equal(bCtx.status, 403);
});

test("configuration : contexte, erreurs par champ, enregistrement, aperçu, activation confirmée", { skip }, async () => {
  const ctx = await request("GET", "/api/report-card/catalog/models/colombiere/configuration", "adminA");
  assert.equal(ctx.status, 200);
  assert.equal(ctx.data.allowSubSubjects, false);
  assert.equal(ctx.data.suggestedStructure, "TJ_EX");
  assert.deepEqual(ctx.data.terms.sort(), TERMS);
  assert.ok(ctx.data.evaluationTypes.some((t) => t.code === "examen"));
  assert.ok(ctx.data.subjects.some((s) => s.code === "ANGLAIS" && s.parent_code === "LANGUES"));
  assert.equal(ctx.data.current, null);

  const invalid = await request("PUT", "/api/report-card/catalog/models/colombiere/configuration", "adminA", {
    input: { ...COLOMBIERE_INPUT, subjects: [...COLOMBIERE_INPUT.subjects, { code: "ANGLAIS", components: { TJ: { max: 10 } } }], factSources: { TJ: { evaluationTypes: ["interrogation"] }, EX: { evaluationTypes: [], aggregation: "sum" } } },
  });
  assert.equal(invalid.status, 422);
  const codes = invalid.data.details.map((d) => `${d.field}:${d.code}`);
  assert.ok(codes.includes("subjects.3:SUB_SUBJECT_NOT_ALLOWED"), codes.join(","));
  assert.ok(codes.includes("factSources.TJ.aggregation:AGGREGATION_REQUIRED"));
  assert.ok(codes.includes("factSources.EX.evaluationTypes:EVALUATION_TYPES_REQUIRED"));

  const preview = await request("POST", "/api/report-card/catalog/models/colombiere/preview", "adminA", { input: COLOMBIERE_INPUT });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.preview.official, false);
  assert.deepEqual(preview.data.preview.rows.map((r) => r.label), ["Mathématiques", "Français", "Éducation civique"]);
  assert.equal(preview.data.preview.rows[2].periods.T1.components.EX.state, "NOT_APPLICABLE", "EX non imposé");

  const noActive = await request("POST", "/api/report-card/catalog/models/colombiere/activate", "adminA", { confirm: true });
  assert.equal(noActive.status, 409, "rien d'enregistré : activation refusée");
  assert.equal(noActive.data.code, "CATALOG_CONFIGURATION_REQUIRED");

  const saved = await request("PUT", "/api/report-card/catalog/models/colombiere/configuration", "adminA", { input: COLOMBIERE_INPUT });
  assert.equal(saved.status, 200, JSON.stringify(saved.data).slice(0, 300));
  assert.equal(saved.data.status, "SAVED");
  const afterSave = await request("GET", "/api/report-card/catalog", "adminA");
  assert.equal(afterSave.data.models[0].configuration, "SAVED", "enregistré n'est pas activé");
  const binding = await request("GET", "/api/report-card/bindings/catalog-colombiere", "adminA");
  assert.notEqual(binding.status, 200, "aucune liaison active avant activation");

  const unconfirmed = await request("POST", "/api/report-card/catalog/models/colombiere/activate", "adminA", {});
  assert.equal(unconfirmed.status, 400);
  const activated = await request("POST", "/api/report-card/catalog/models/colombiere/activate", "adminA", { confirm: true });
  assert.equal(activated.status, 200, JSON.stringify(activated.data));
  assert.equal(activated.data.status, "ACTIVE");
  const listed = await request("GET", "/api/report-card/catalog", "adminA");
  assert.equal(listed.data.models[0].configuration, "ACTIVE");
  const ctx2 = await request("GET", "/api/report-card/catalog/models/colombiere/configuration", "adminA");
  assert.equal(ctx2.data.current.structure, "TJ_EX");
  assert.deepEqual(ctx2.data.current.subjects.map((s) => s.code), ["MATHEMATIQUES", "FRANCAIS", "CIVISME"]);
});

test("publication sur la configuration du catalogue : moteur canonique, notes en échec signalées", { skip }, async () => {
  const body = { classId: state.a.classId, academicYearId: state.a.yearId, modelKey: "catalog-colombiere", period: "ANNUAL" };
  const preview = await request("POST", "/api/report-card/publications/preview", "adminA", body);
  assert.equal(preview.status, 200, JSON.stringify(preview.data).slice(0, 300));
  assert.equal(preview.data.draft.publishable, true, JSON.stringify(preview.data.draft.issues));
  const published = await request("POST", "/api/report-card/publications", "adminA", { ...body, expectedDraftSha256: preview.data.draft.draft_sha256 });
  assert.equal(published.status, 201);
  const s2 = preview.data.draft.students.find((s) => s.student_id === state.a.studentIds.S2.code);
  state.s2ReportCardId = s2.report_card_id;
  const pres = await request("GET", `/api/report-card/publications/${s2.report_card_id}/presentation?version=1`, "adminA");
  assert.equal(pres.status, 200);
  const math = pres.data.presentation[0].rows.find((r) => r.subject_id === "MATHEMATIQUES");
  assert.equal(math.periods.T1.components.TJ.value, 8);
  assert.equal(math.periods.T1.components.TJ.failing, true, "8/20 en échec");
  assert.equal(pres.data.presentation[0].periods[0].label, "Trimestre 1", "intitulé de période du gabarit");
  state.snapshotBefore = (await request("GET", `/api/report-card/publications/${s2.report_card_id}/snapshot?version=1`, "adminA")).data.payload;
});

test("désactivation dans le pays : nouvelles configurations refusées ; configuration active et bulletins publiés conservés", { skip }, async () => {
  const disabled = await enable("colombiere", state.cd, false);
  assert.equal(disabled.status, 200);
  assert.equal(disabled.data.previous, true);
  const listed = await request("GET", "/api/report-card/catalog", "adminA");
  assert.equal(listed.data.models.length, 1);
  assert.equal(listed.data.models[0].available, false);
  assert.equal(listed.data.models[0].configuration, "ACTIVE", "aucune révocation implicite");
  const save = await request("PUT", "/api/report-card/catalog/models/colombiere/configuration", "adminA", { input: COLOMBIERE_INPUT });
  assert.equal(save.status, 403);
  assert.equal(save.data.code, "CATALOG_MODEL_NOT_AVAILABLE");
  const other = await request("GET", "/api/report-card/catalog", "adminC");
  assert.deepEqual(other.data.models, [], "autre établissement du pays : modèle invisible");
  const snapshot = await request("GET", `/api/report-card/publications/${state.s2ReportCardId}/snapshot?version=1`, "adminA");
  assert.equal(snapshot.status, 200);
  assert.deepEqual(snapshot.data.payload, state.snapshotBefore, "snapshot publié inchangé");
  const pres = await request("GET", `/api/report-card/publications/${state.s2ReportCardId}/presentation?version=1`, "adminA");
  assert.equal(pres.status, 200);
  const preview = await request("POST", "/api/report-card/publications/preview", "adminA", { classId: state.a.classId, academicYearId: state.a.yearId, modelKey: "catalog-colombiere", period: "T1" });
  assert.equal(preview.status, 200, "configuration active toujours utilisable (comportement contractuel)");
  const audit = await request("GET", "/api/report-card/catalog/admin/audit?modelId=colombiere", "superadmin");
  assert.deepEqual(audit.data.audit.map((row) => [row.old_available, row.new_available]), [[true, false], [null, true]]);
});

test("autre structure d'évaluation : modèle Berceau avec note unique par période (TJ/EX non imposés), isolation", { skip }, async () => {
  assert.equal((await enable("berceau", state.cd, true)).status, 200);
  const ctx = await request("GET", "/api/report-card/catalog/models/berceau/configuration", "adminC");
  assert.equal(ctx.status, 200);
  assert.equal(ctx.data.suggestedStructure, "SINGLE");
  const input = {
    structure: "SINGLE",
    subjects: [
      { code: "FR_ECRIT", components: { NP: { max: 40 } } },
      { code: "FR_LECTURE", components: { NP: { max: 20 } } },
      { code: "MATH_MENTAL", components: { NP: { max: 20 } } },
    ],
    factSources: { NP: { evaluationTypes: ["devoir", "examen"], aggregation: "weighted_average" } },
    periods: { T1: { termNames: ["Trimestre 1"] }, T2: { termNames: ["Trimestre 2"] }, T3: { termNames: ["Trimestre 3"] } },
    signatures: ["La titulaire", "Le parent"],
  };
  const preview = await request("POST", "/api/report-card/catalog/models/berceau/preview", "adminC", { input });
  assert.equal(preview.status, 200, JSON.stringify(preview.data).slice(0, 300));
  const view = preview.data.preview;
  assert.equal(view.style, "hierarchical");
  assert.deepEqual(view.components.map((c) => [c.id, c.label]), [["NP", "Note"]]);
  assert.deepEqual(view.rows.filter((r) => r.kind === "composite").map((r) => r.label), ["Français", "Mathématiques"]);
  const tjInput = { ...input, subjects: [{ code: "FR_ECRIT", components: { TJ: { max: 20 } } }] };
  const mismatch = await request("POST", "/api/report-card/catalog/models/berceau/preview", "adminC", { input: tjInput });
  assert.equal(mismatch.status, 422, "composante hors structure refusée (jamais ignorée en silence)");
  const saved = await request("PUT", "/api/report-card/catalog/models/berceau/configuration", "adminC", { input });
  assert.equal(saved.status, 200, JSON.stringify(saved.data).slice(0, 300));
  // Isolation : la configuration de C n'apparaît pas chez A (même pays, même modèle).
  const a = await request("GET", "/api/report-card/catalog", "adminA");
  assert.equal(a.data.models.find((m) => m.model_id === "berceau").configuration, "NONE");
  const c = await request("GET", "/api/report-card/catalog", "adminC");
  assert.equal(c.data.models.find((m) => m.model_id === "berceau").configuration, "SAVED");
});
