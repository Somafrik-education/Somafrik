"use strict";

/**
 * BULLETIN-CLASSE-01 / L3 — en-têtes, signatures et identité officielle figée (HTTP + PostgreSQL réels).
 *
 * Migrations catalogue, L1 et L3 appliquées explicitement sur une base jetable. Store d'identité
 * réel avec un lecteur de logo contrôlé par le test (remplacement du logo de l'établissement).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
const { createReportCardOfficialIdentityStore } = require("../../db/reportCardOfficialIdentityStore");
const { registerReportCardHttp } = require("./reportCardHttp");
const { createReportCardHttpBindings } = require("../reportCardHttpRuntime");
const { resolveReportCardActorFromPrincipal } = require("../reportCardHttpActor");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_report_card_class_scope_l3_it";
const skip = DATABASE_URL ? false : "DATABASE_URL absent (exécuter via npm run test:backend-baseline:pg)";
const MIGRATIONS = path.resolve(__dirname, "../../db/migrations");
const L1_SQL = fs.readFileSync(path.join(MIGRATIONS, "20261105_report_card_class_scope.sql"), "utf8");
const L3_SQL = fs.readFileSync(path.join(MIGRATIONS, "20261106_report_card_official_assets.sql"), "utf8");
const TERMS = ["Trimestre 1", "Trimestre 2", "Trimestre 3"];
const LOGO_1 = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const LOGO_2 = Buffer.from("89504e470d0a1a0a0000000d4948445200000002000000020806000000", "hex");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function withDatabase(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const state = { logo: { bytes: LOGO_1, mimeType: "image/png" }, pdfCalls: [] };

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
          const buffer = Buffer.concat(chunks);
          let data = null;
          try {
            data = JSON.parse(buffer.toString("utf8"));
          } catch {
            data = buffer;
          }
          resolve({ status: res.statusCode, data, headers: res.headers });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const HEADER = {
  layout: "logo_left",
  show: ["logo", "establishment_name", "establishment_address", "country", "class", "academic_year", "period", "student_name"],
  lines: ["République démocratique du Congo", "Ministère de l'Enseignement primaire, secondaire et technique"],
  title: "Bulletin scolaire",
};
const INPUT = {
  structure: "TJ_EX",
  subjects: [{ code: "MATHEMATIQUES", components: { TJ: { max: 20 }, EX: { max: 20 } } }],
  factSources: { TJ: { evaluationTypes: ["interrogation"], aggregation: "sum" }, EX: { evaluationTypes: ["examen"], aggregation: "sum" } },
  periods: { T1: { termNames: ["Trimestre 1"] }, T2: { termNames: ["Trimestre 2"] }, T3: { termNames: ["Trimestre 3"] } },
  signatures: ["Le titulaire", "Le préfet des études", "Le parent"],
  header: HEADER,
};

before(async () => {
  if (skip) return;
  const admin = new Pool({ connectionString: withDatabase(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DATABASE]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DATABASE}`);
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$;`);
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
  await state.pool.query(`BEGIN;\n${L3_SQL}\nCOMMIT;`);
  await state.pool.query("ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL; ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;");
  state.cd = (await one("INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('République démocratique du Congo','CD','+243','CDF') RETURNING id")).id;
  await state.pool.query("ALTER TABLE schools DISABLE TRIGGER USER");
  state.schoolId = (await one(
    "INSERT INTO schools (country_id, school_code, login_code, short_code, name, address, status) VALUES ($1,'CD-2026-0601','CD-L3A-26-001','L3A','Lycée Lumière','12 avenue du Fleuve, Kinshasa','active') RETURNING id",
    [state.cd]
  )).id;
  await state.pool.query("ALTER TABLE schools ENABLE TRIGGER USER");
  const yearId = (await one("INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1,'2026-2027',TRUE,'open') RETURNING id", [state.schoolId])).id;
  const terms = {};
  for (const name of TERMS) terms[name] = (await one("INSERT INTO terms (academic_year_id, name) VALUES ($1,$2) RETURNING id", [yearId, name])).id;
  const classId = (await one("INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1,$2,'L3A-6A','6ème A') RETURNING id", [state.schoolId, yearId])).id;
  const teacherId = (await one("INSERT INTO teachers (school_id, teacher_code) VALUES ($1,'L3A-T1') RETURNING id", [state.schoolId])).id;
  const types = {};
  for (const code of ["interrogation", "examen"]) types[code] = (await one("INSERT INTO evaluation_types (school_id, code, name) VALUES ($1,$2,$2) RETURNING id", [state.schoolId, code])).id;
  const subjectId = (await one("INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,'MATHEMATIQUES','Mathématiques','active') RETURNING id", [state.schoolId])).id;
  await state.pool.query("INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code) VALUES ($1,$2,$3,$4,'L3A-MATH')", [state.schoolId, classId, subjectId, teacherId]);
  const student = await one("INSERT INTO students (school_id, student_code, first_name, last_name) VALUES ($1,'L3A-S1','Ama','Mukendi') RETURNING id", [state.schoolId]);
  await state.pool.query("INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1,$2,$3,$4,'active')", [state.schoolId, student.id, classId, yearId]);
  for (const name of TERMS) {
    for (const [component, typeCode] of [["TJ", "interrogation"], ["EX", "examen"]]) {
      const evaluationId = (await one(
        `INSERT INTO evaluations (school_id, class_id, subject_id, teacher_id, term_id, title, evaluation_type, evaluation_type_id, max_score, coefficient, status, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,20,1,'published',TRUE) RETURNING id`,
        [state.schoolId, classId, subjectId, teacherId, terms[name], `${component}-${name}`, typeCode, types[typeCode]]
      )).id;
      await state.pool.query(
        `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id, grade_type, score, max_score, coefficient, grade_status, publication_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,14,20,1,'graded','published')`,
        [state.schoolId, student.id, classId, subjectId, teacherId, terms[name], evaluationId, typeCode]
      );
    }
  }
  state.classId = classId;
  state.yearId = yearId;
  const principals = {
    superadmin: { sub: "cccccccc-0000-4000-8000-000000000061", role: "Super Administrateur Somafrik" },
    adminA: { sub: "aaaaaaaa-0000-4000-8000-000000000061", role: "Admin School", schoolId: state.schoolId, permissions: ["Bulletins:READ", "Bulletins:UPDATE"] },
  };
  const keys = { signingKey: generateSigningKey("rc-ed25519-1"), wrapping: generateWrappingKey("rc-wrap-1") };
  const identityStore = createReportCardOfficialIdentityStore(state.pool, { readLogo: async () => state.logo });
  const bindings = createReportCardHttpBindings({
    env: {},
    createPdf: () => ({
      render: async (args) => {
        state.pdfCalls.push(args);
        return { pdf: Buffer.from("%PDF-1.4 stub") };
      },
    }),
    resolveActor: (req) => resolveReportCardActorFromPrincipal(principals[req.headers["x-test-principal"]] || null),
    overrides: {
      db: state.pool,
      identityStore,
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
  assert.equal((await request("PUT", `/api/report-card/catalog/admin/models/colombiere/countries/${state.cd}`, "superadmin", { available: true, confirm: true })).status, 200);
});

after(async () => {
  if (state.server) await new Promise((resolve) => state.server.close(resolve));
  if (state.pool && !state.pool.ended) await state.pool.end().catch(() => {});
});

const base = "/api/report-card/catalog/models/colombiere";

test("1. assistant : en-tête validé par champ, aperçu avec l'identité actuelle et les signatures", { skip }, async () => {
  const invalid = await request("POST", `${base}/preview`, "adminA", {
    classId: state.classId,
    input: { ...INPUT, header: { layout: "no_logo", show: ["logo", "inconnu"], lines: ["a", "b", "c", "d", "e"], title: "x".repeat(61) } },
  });
  assert.equal(invalid.status, 422);
  const codes = invalid.data.details.map((d) => `${d.field}:${d.code}`);
  for (const code of ["header.show:HEADER_ELEMENT_UNKNOWN", "header.show:HEADER_LOGO_WITHOUT_PLACE", "header.lines:HEADER_LINES_INVALID", "header.title:HEADER_TITLE_INVALID"]) {
    assert.ok(codes.includes(code), `${code} ∉ ${codes.join(", ")}`);
  }
  const preview = await request("POST", `${base}/preview`, "adminA", { classId: state.classId, input: INPUT });
  assert.equal(preview.status, 200, JSON.stringify(preview.data).slice(0, 300));
  const header = preview.data.preview.header;
  assert.equal(header.title, "Bulletin scolaire");
  assert.deepEqual(header.lines, HEADER.lines);
  assert.deepEqual(header.items.map((item) => item.id), ["establishment_name", "establishment_address", "country", "class", "academic_year", "period", "student_name"]);
  assert.equal(header.items[2].value, "République démocratique du Congo");
  assert.equal(header.items[0].value, "Lycée Lumière");
  assert.equal(header.items[1].value, "12 avenue du Fleuve, Kinshasa");
  assert.equal(header.logo.sha256, sha(LOGO_1), "logo actuel");
  assert.deepEqual(preview.data.preview.signatures, INPUT.signatures);
  assert.equal(preview.data.preview.official, false);
});

test("2. publication : identité figée dans le contenu signé, logo copié de façon immuable", { skip }, async () => {
  assert.equal((await request("PUT", `${base}/configuration`, "adminA", { classId: state.classId, input: INPUT })).status, 200);
  assert.equal((await request("POST", `${base}/activate`, "adminA", { classId: state.classId, confirm: true })).status, 200);
  const body = { classId: state.classId, academicYearId: state.yearId, modelKey: "catalog-colombiere", period: "T1" };
  const draft = await request("POST", "/api/report-card/publications/preview", "adminA", body);
  assert.equal(draft.status, 200, JSON.stringify(draft.data).slice(0, 300));
  assert.equal(draft.data.draft.official_identity.establishment_name, "Lycée Lumière");
  assert.equal(draft.data.draft.students[0].presentation.header.items.find((i) => i.id === "period").value, "Trimestre 1");
  const published = await request("POST", "/api/report-card/publications", "adminA", { ...body, expectedDraftSha256: draft.data.draft.draft_sha256 });
  assert.equal(published.status, 201, JSON.stringify(published.data).slice(0, 300));
  state.reportCardId = draft.data.draft.students[0].report_card_id;
  const asset = await one("SELECT media_type, byte_size, sha256 FROM report_card_official_assets WHERE school_id = $1", [state.schoolId]);
  assert.deepEqual(asset, { media_type: "image/png", byte_size: LOGO_1.length, sha256: sha(LOGO_1) });
  const snapshot = await request("GET", `/api/report-card/publications/${state.reportCardId}/snapshot?version=1`, "adminA");
  assert.equal(snapshot.data.payload.official_identity.logo_sha256, sha(LOGO_1));
  assert.equal(snapshot.data.payload.official_identity.establishment_address, "12 avenue du Fleuve, Kinshasa");
  assert.equal(snapshot.data.payload.official_identity.establishment_country, "République démocratique du Congo");
});

test("3. l'établissement change de nom, d'adresse et de logo : le bulletin publié reste fidèle", { skip }, async () => {
  await state.pool.query("UPDATE schools SET name = 'Lycée Lumière Nouvelle', address = '1 rue Neuve' WHERE id = $1", [state.schoolId]);
  state.logo = { bytes: LOGO_2, mimeType: "image/png" };
  const pres = await request("GET", `/api/report-card/publications/${state.reportCardId}/presentation?version=1`, "adminA");
  assert.equal(pres.status, 200);
  const header = pres.data.presentation[0].header;
  assert.equal(header.items[0].value, "Lycée Lumière", "nom d'origine");
  assert.equal(header.items[1].value, "12 avenue du Fleuve, Kinshasa", "adresse d'origine");
  assert.equal(header.logo.sha256, sha(LOGO_1), "logo d'origine");
  assert.equal(pres.data.presentation[0].school.name, "Lycée Lumière");
  const logo = await request("GET", `/api/report-card/publications/${state.reportCardId}/logo?version=1`, "adminA");
  assert.equal(logo.status, 200);
  assert.equal(logo.headers["content-type"], "image/png");
  assert.deepEqual(Buffer.from(logo.data), LOGO_1);
  const pdf = await request("GET", `/api/report-card/publications/${state.reportCardId}/pdf?version=1`, "adminA");
  assert.equal(pdf.status, 200);
  const call = state.pdfCalls.at(-1);
  assert.equal(call.logoDataUri, `data:image/png;base64,${LOGO_1.toString("base64")}`, "PDF : logo d'origine embarqué");
  assert.equal(call.presentation[0].header.items[0].value, "Lycée Lumière");
  // Un nouveau brouillon utilise l'identité ACTUELLE.
  const draft = await request("POST", "/api/report-card/publications/preview", "adminA", { classId: state.classId, academicYearId: state.yearId, modelKey: "catalog-colombiere", period: "T2" });
  assert.equal(draft.data.draft.official_identity.establishment_name, "Lycée Lumière Nouvelle");
  assert.equal(draft.data.draft.students[0].presentation.header.logo.sha256, sha(LOGO_2));
});

test("4. copies officielles : immuables, sans accès anon / authenticated", { skip }, async () => {
  await assert.rejects(state.pool.query("UPDATE report_card_official_assets SET media_type = 'image/jpeg'"), /OFFICIAL_ASSET_IMMUTABLE/);
  await assert.rejects(state.pool.query("DELETE FROM report_card_official_assets"), /OFFICIAL_ASSET_IMMUTABLE/);
  for (const role of ["anon", "authenticated"]) {
    const row = await one("SELECT has_table_privilege($1, 'report_card_official_assets', 'SELECT') AS ok", [role]);
    assert.equal(row.ok, false, role);
  }
  const rls = await one("SELECT relrowsecurity FROM pg_class WHERE relname = 'report_card_official_assets'");
  assert.equal(rls.relrowsecurity, true);
});

test("5. compatibilité : configuration sans en-tête ⇒ contenu sans identité figée, rendu actuel", { skip }, async () => {
  const legacy = { ...INPUT };
  delete legacy.header;
  assert.equal((await request("PUT", `${base}/configuration`, "adminA", { input: legacy })).status, 200);
  assert.equal((await request("POST", `${base}/activate`, "adminA", { confirm: true })).status, 200);
  const otherClass = (await one(
    "INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1,$2,'L3A-6B','6ème B') RETURNING id",
    [state.schoolId, state.yearId]
  )).id;
  const student = await one("INSERT INTO students (school_id, student_code, first_name, last_name) VALUES ($1,'L3A-S2','Bo','Kabila') RETURNING id", [state.schoolId]);
  await state.pool.query("INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1,$2,$3,$4,'active')", [state.schoolId, student.id, otherClass, state.yearId]);
  const draft = await request("POST", "/api/report-card/publications/preview", "adminA", { classId: otherClass, academicYearId: state.yearId, modelKey: "catalog-colombiere", period: "T1" });
  assert.equal(draft.status, 200, JSON.stringify(draft.data).slice(0, 300));
  assert.equal(draft.data.draft.students[0].presentation.header, undefined, "aucun en-tête configurable");
  assert.equal(draft.data.draft.students[0].presentation.school.name, "Lycée Lumière Nouvelle", "libellé vivant (comportement actuel)");
  assert.equal(draft.data.draft.official_identity, undefined, "aucune identité figée sans en-tête");
});
