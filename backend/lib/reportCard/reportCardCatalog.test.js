"use strict";

/**
 * BULLETIN-CATALOG-01 — règles du catalogue sans base de données.
 * (Parcours HTTP + PostgreSQL : reportCardCatalog01.http.pg.test.js.)
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildConfiguration,
  createReportCardCatalog,
  modelPreview,
  samplePresentation,
  STRUCTURES,
} = require("./reportCardCatalog");

const COLOMBIERE = { model_id: "colombiere", version: 1, name: "Modèle Colombière", presentation_style: "simple", status: "active" };
const BERCEAU = { model_id: "berceau", version: 1, name: "Modèle Berceau", presentation_style: "hierarchical", status: "active" };
const CONTEXT = {
  schoolId: "aaaaaaaa-0000-4000-8000-000000000001",
  subjects: [
    { code: "MATH", name: "Mathématiques", status: "active", parent_code: null },
    { code: "FR", name: "Français", status: "active", parent_code: null },
    { code: "FR_ECRIT", name: "Écrit", status: "active", parent_code: "FR" },
    { code: "FR_ORAL", name: "Oral", status: "active", parent_code: "FR" },
    { code: "SCI", name: "Sciences", status: "active", parent_code: null },
    { code: "OLD", name: "Ancienne", status: "inactive", parent_code: null },
  ],
  evaluationTypes: [
    { code: "interrogation", status: "active" },
    { code: "examen", status: "active" },
  ],
  terms: ["Trimestre 1", "Trimestre 2", "Trimestre 3"],
};
const PERIODS = { T1: { termNames: ["Trimestre 1"] }, T2: { termNames: ["Trimestre 2"] }, T3: { termNames: ["Trimestre 3"] } };

function tjEx(subjects) {
  return {
    structure: "TJ_EX",
    subjects,
    factSources: { TJ: { evaluationTypes: ["interrogation"], aggregation: "sum" }, EX: { evaluationTypes: ["examen"], aggregation: "sum" } },
    periods: PERIODS,
  };
}

function codes(fn) {
  try {
    fn();
  } catch (err) {
    assert.equal(err.code, "CONFIGURATION_INVALID");
    return err.details.map((d) => `${d.field}:${d.code}`);
  }
  assert.fail("CONFIGURATION_INVALID attendu");
}

test("structures : TJ/EX et note unique ; aucune composante imposée", () => {
  assert.deepEqual(STRUCTURES.TJ_EX.map((c) => c.id), ["TJ", "EX"]);
  assert.deepEqual(STRUCTURES.SINGLE.map((c) => c.id), ["NP"]);
  const built = buildConfiguration(COLOMBIERE, tjEx([{ code: "MATH", components: { TJ: { max: 10 } } }]), CONTEXT);
  assert.deepEqual(built.profileSpec.subjects, [{ id: "MATH", order: 1, components: { TJ: { max: 10 } } }], "EX absent : non imposé");
  const single = buildConfiguration(
    COLOMBIERE,
    { structure: "SINGLE", subjects: [{ code: "MATH", components: { NP: { max: 20 } } }], factSources: { NP: { evaluationTypes: ["examen"], aggregation: "weighted_average" } }, periods: PERIODS },
    CONTEXT
  );
  assert.deepEqual(Object.keys(single.profileSpec.fact_sources.components), ["NP"]);
  assert.equal(single.templateSpec.presentation.component_labels.NP, "Note");
});

test("matières simples vs sous-matières : selon le modèle", () => {
  const input = tjEx([{ code: "FR_ECRIT", components: { TJ: { max: 20 }, EX: { max: 20 } } }]);
  assert.deepEqual(codes(() => buildConfiguration(COLOMBIERE, input, CONTEXT)), ["subjects.0:SUB_SUBJECT_NOT_ALLOWED"]);
  const built = buildConfiguration(BERCEAU, input, CONTEXT);
  assert.deepEqual(built.profileSpec.subjects.map((s) => [s.id, s.parent_id || null]), [["FR", null], ["FR_ECRIT", "FR"]]);
  assert.equal(built.templateSpec.presentation.style, "hierarchical");
  assert.deepEqual(codes(() => buildConfiguration(BERCEAU, tjEx([{ code: "FR", components: { TJ: { max: 20 } } }]), CONTEXT)), ["subjects.0:SUBJECT_IS_MAIN_SUBJECT"]);
});

test("erreurs par champ : catalogue, doublon, maxima, types, agrégation, périodes", () => {
  const input = {
    structure: "TJ_EX",
    subjects: [
      { code: "INCONNUE", components: { TJ: { max: 20 } } },
      { code: "OLD", components: { TJ: { max: 20 } } },
      { code: "MATH", components: { TJ: { max: 0 }, EX: { max: 1001 } } },
      { code: "FR_ORAL", components: {} },
    ],
    factSources: { TJ: { evaluationTypes: ["devoir"], aggregation: "sum" }, EX: { evaluationTypes: [] } },
    periods: { T1: { termNames: ["Trimestre 9"] } },
    signatures: ["a", "b", "c", "d", "e"],
  };
  const found = codes(() => buildConfiguration(BERCEAU, input, CONTEXT));
  for (const expected of [
    "subjects.0:SUBJECT_NOT_IN_SCHOOL_CATALOG",
    "subjects.1:SUBJECT_NOT_IN_SCHOOL_CATALOG",
    "subjects.2.TJ:INVALID_MAX",
    "subjects.2.EX:INVALID_MAX",
    "subjects.3:SUBJECT_WITHOUT_COMPONENTS",
    "factSources.TJ.evaluationTypes:EVALUATION_TYPE_UNKNOWN",
    "factSources.EX.evaluationTypes:EVALUATION_TYPES_REQUIRED",
    "factSources.EX.aggregation:AGGREGATION_REQUIRED",
    "periods.T1:TERM_UNKNOWN",
    "periods.T2:TERM_REQUIRED",
    "signatures:INVALID_SIGNATURES",
  ]) {
    assert.ok(found.includes(expected), `${expected} ∉ ${found.join(", ")}`);
  }
  assert.deepEqual(codes(() => buildConfiguration(COLOMBIERE, tjEx([{ code: "MATH", components: { TJ: { max: 10 } } }, { code: "MATH", components: { TJ: { max: 10 } } }]), CONTEXT)), ["subjects.1:SUBJECT_DUPLICATE"]);
  assert.deepEqual(codes(() => buildConfiguration(COLOMBIERE, { structure: "AUTRE" }, CONTEXT)), ["structure:STRUCTURE_REQUIRED"]);
});

test("aperçu : moteur canonique, jamais officiel, notes en échec signalées, maxima jamais signalés", () => {
  for (const model of [COLOMBIERE, BERCEAU]) {
    for (const structure of ["TJ_EX", "SINGLE"]) {
      const view = modelPreview(model, structure);
      assert.equal(view.official, false);
      assert.equal(view.style, model.presentation_style);
      assert.deepEqual(view.components.map((c) => c.id), STRUCTURES[structure].map((c) => c.id));
      assert.ok(view.rows.length >= 3);
    }
  }
  const built = buildConfiguration(COLOMBIERE, tjEx([{ code: "MATH", components: { TJ: { max: 20 }, EX: { max: 20 } } }, { code: "SCI", components: { TJ: { max: 10 } } }]), CONTEXT);
  const view = samplePresentation(built);
  const cells = view.rows.flatMap((row) => Object.values(row.periods).flatMap((p) => Object.values(p.components || {})));
  assert.ok(cells.length > 0);
  for (const cell of cells) {
    if (cell.value == null) assert.equal(cell.failing, false);
    else assert.equal(cell.failing, cell.value < cell.max / 2, `${cell.value}/${cell.max}`);
  }
});

function fakeStore({ country = { id: "cccccccc-0000-4000-8000-000000000001", name: "Pays A" }, available = new Set() } = {}) {
  return {
    listModels: async () => [COLOMBIERE, BERCEAU],
    getModel: async (id) => [COLOMBIERE, BERCEAU].find((m) => m.model_id === id) || null,
    listCountries: async () => (country ? [country] : []),
    getCountry: async (id) => (country && id === country.id ? country : null),
    listAvailability: async () => [],
    isAvailable: async (modelId, countryId) => available.has(`${modelId}:${countryId}`),
    setAvailability: async () => ({ changed: true }),
    listAudit: async () => [],
    schoolCountry: async () => country,
    schoolContext: async () => CONTEXT,
  };
}

const NO_CONFIG = { catalogConfigurationState: async () => ({ active: null, saved: null }) };
const superadmin = { actorId: "sa", permissions: ["REPORT_CARD_CONFIGURE"], platform: { privileged: true } };
const admin = { actorId: "ad", actorSchoolId: CONTEXT.schoolId, permissions: ["REPORT_CARD_READ", "REPORT_CARD_SCHOOL_APPROVE_TEMPLATE"] };
const teacher = { actorId: "te", actorSchoolId: CONTEXT.schoolId, permissions: ["REPORT_CARD_READ"] };

async function rejects(promise, code) {
  await assert.rejects(promise, (err) => err.code === code || assert.fail(`${err.code} ≠ ${code}`));
}

test("fail-closed : pays inconnu ⇒ aucun modèle ; modèle non autorisé ⇒ refus", async () => {
  const unknown = createReportCardCatalog({ store: fakeStore({ country: null }), configuration: NO_CONFIG });
  const listed = await unknown.schoolCatalog({ actor: admin });
  assert.equal(listed.country, null);
  assert.equal(listed.reason, "COUNTRY_UNKNOWN");
  assert.deepEqual(listed.models, []);
  const catalog = createReportCardCatalog({ store: fakeStore(), configuration: NO_CONFIG });
  assert.deepEqual((await catalog.schoolCatalog({ actor: admin })).models, []);
  await rejects(catalog.configurationContext({ actor: admin, modelId: "colombiere" }), "CATALOG_MODEL_NOT_AVAILABLE");
});

test("permissions : Superadmin hors parcours école ; école hors gestion nationale ; enseignant en lecture", async () => {
  const country = { id: "cccccccc-0000-4000-8000-000000000001", name: "Pays A" };
  const catalog = createReportCardCatalog({ store: fakeStore({ country, available: new Set([`colombiere:${country.id}`]) }), configuration: NO_CONFIG });
  await assert.rejects(catalog.schoolCatalog({ actor: superadmin }));
  await assert.rejects(catalog.configurationContext({ actor: superadmin, modelId: "colombiere" }));
  await assert.rejects(catalog.adminOverview({ actor: admin }));
  await assert.rejects(catalog.setAvailability({ actor: admin, modelId: "colombiere", countryId: country.id, available: true, confirm: true }));
  await rejects(catalog.setAvailability({ actor: superadmin, modelId: "colombiere", countryId: country.id, available: true }), "CONFIRMATION_REQUIRED");
  const teacherView = await catalog.schoolCatalog({ actor: teacher });
  assert.equal(teacherView.canConfigure, false);
  await assert.rejects(catalog.save({ actor: teacher, modelId: "colombiere", input: {} }));
  await assert.rejects(catalog.activate({ actor: admin, modelId: "colombiere" }), "confirmation exigée");
});

test("classe : configuration héritée pré-remplie uniquement avec les cours actifs de la classe", async () => {
  const built = buildConfiguration(COLOMBIERE, tjEx([
    { code: "MATH", components: { TJ: { max: 20 } } },
    { code: "SCI", components: { TJ: { max: 10 } } },
  ]), CONTEXT);
  const country = { id: "cccccccc-0000-4000-8000-000000000001", name: "Pays A" };
  const store = {
    ...fakeStore({ country, available: new Set([`colombiere:${country.id}`]) }),
    classScope: async () => ({
      class_id: "class-1", academic_year_id: "year-1", name: "1ère D",
      academic_year_name: "2026-2027",
    }),
    classContext: async () => ({
      ...CONTEXT,
      subjects: [{ code: "SCI", name: "Sciences", status: "active", parent_code: null }],
    }),
  };
  const inherited = { profile: built.profileSpec, template: built.templateSpec };
  const catalog = createReportCardCatalog({
    store,
    configuration: {
      catalogConfigurationState: async () => ({
        active: null, saved: null, inherited,
      }),
    },
  });
  const context = await catalog.configurationContext({
    actor: admin, modelId: "colombiere", classId: "class-1",
  });
  assert.deepEqual(context.subjects.map((row) => row.code), ["SCI"]);
  assert.equal(context.configuration, "INHERITED");
  assert.deepEqual(context.current.subjects.map((row) => row.code), ["SCI"]);
  assert.equal(built.profileSpec.subjects.length, 2, "le gabarit établissement est inchangé");
});

test("migration : jamais exécutée au démarrage (aucune référence hors tests)", () => {
  const root = path.resolve(__dirname, "../..");
  for (const rel of ["db/postgresRepository.js", "server.js", "db/repositoryFactory.js"]) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(src, /reportCardCatalogSchema|REPORT_CARD_CATALOG_SQL|20261104_report_card_catalog/, rel);
  }
});

test("préflight de migration : strictement en lecture seule (BULLETIN-PREPROD-01)", () => {
  const file = path.resolve(__dirname, "../../db/migrations/20261104_report_card_catalog.preflight.sql");
  const raw = fs.readFileSync(file, "utf8");
  const sql = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/'(?:[^']|'')*'/g, "''");
  assert.match(sql, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(sql, /ROLLBACK;\s*$/);
  assert.doesNotMatch(sql, /\bCOMMIT\b|\bEND\s*;/i);
  for (const keyword of ["INSERT", "UPDATE", "DELETE", "MERGE", "CREATE", "ALTER", "DROP", "TRUNCATE", "GRANT", "REVOKE", "VACUUM", "REINDEX", "LOCK", "COPY", "CALL", "DO"]) {
    assert.doesNotMatch(sql, new RegExp(`(^|;|\\s)${keyword}\\s`, "i"), `mot-clé d'écriture interdit : ${keyword}`);
  }
  assert.match(sql, /expected_db/, "la base cible doit être confirmée explicitement");
});


test("migration catalogue : aucune exposition Supabase anon/authenticated (RLS + révocation)", () => {
  const sql = fs.readFileSync(path.resolve(__dirname, "../../db/migrations/20261104_report_card_catalog.sql"), "utf8");
  const tables = ["report_card_catalog_models", "report_card_catalog_availability", "report_card_catalog_availability_audit"];
  for (const table of tables) {
    assert.match(sql, new RegExp("ALTER TABLE public\\." + table + " ENABLE ROW LEVEL SECURITY;", "i"));
    assert.match(sql, new RegExp("REVOKE ALL PRIVILEGES ON TABLE public\\." + table + " FROM PUBLIC;", "i"));
  }
  assert.match(sql, /FOREACH role_name IN ARRAY ARRAY\['anon', 'authenticated'\]/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON SEQUENCE public\.report_card_catalog_availability_audit_id_seq FROM PUBLIC;/);
});
