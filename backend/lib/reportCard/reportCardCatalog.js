"use strict";

/**
 * BULLETIN-CATALOG-01 — catalogue des modèles de bulletins et disponibilité par pays.
 *
 * Chaîne : Catalogue → Pays autorisés → Établissement → Configuration scolaire → Bulletin.
 *
 * - Le catalogue ne calcule rien : il produit une configuration (profil,
 *   schéma, gabarit) passée aux validations canoniques (validateSpec,
 *   validateAgainstProfile, catalogue des matières de l'établissement) puis au
 *   service de configuration LOT 6 (versions figées, demande, audit, liaison).
 * - Aucune logique de pays dans le moteur : le pays ne sert qu'à filtrer les
 *   modèles proposés. Le pays d'un établissement vient de `schools.country_id`
 *   (serveur), jamais du navigateur. Pays inconnu ⇒ aucun modèle (fail-closed).
 * - Superadmin (plateforme + REPORT_CARD_CONFIGURE) : modèles, pays,
 *   disponibilité, historique — aucun accès aux élèves, notes ou bulletins.
 * - Établissement : lecture (REPORT_CARD_READ) ; configuration et activation
 *   (REPORT_CARD_SCHOOL_APPROVE_TEMPLATE, rôle établissement uniquement).
 * - Désactivation dans un pays : plus de NOUVELLE configuration ni de nouvelle
 *   activation ; une configuration déjà active et les bulletins publiés restent
 *   valables (aucune révocation implicite).
 */

const { validateSpec } = require("./academicRuleProfile");
const { validateAgainstProfile } = require("./reportCardSchema");
const { assertProfileSubjectsInCatalog } = require("./subjectCatalog");
const { computeReportCard } = require("./reportCardEngine");
const { buildStudentPresentation } = require("./reportCardPresentation");
const { HEADER_LAYOUTS, HEADER_ELEMENTS } = require("./renderingTemplate");

const PERM_CONFIGURE = "REPORT_CARD_CONFIGURE";
const PERM_APPROVE = "REPORT_CARD_SCHOOL_APPROVE_TEMPLATE";
const PERM_READ = "REPORT_CARD_READ";

const MODEL_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * Structures d'évaluation proposées (le profil de l'établissement fixe la sienne) :
 * - TJ_EX  : travail journalier (TJ) et examen (EX), maxima par matière ;
 * - SINGLE : une note unique par période (NP), maximum par matière.
 * Une matière peut n'avoir qu'une partie des composantes (ex. TJ sans EX).
 */
const STRUCTURES = Object.freeze({
  TJ_EX: Object.freeze([
    Object.freeze({ id: "TJ", label: "TJ" }),
    Object.freeze({ id: "EX", label: "EX" }),
  ]),
  SINGLE: Object.freeze([Object.freeze({ id: "NP", label: "Note" })]),
});
const STRUCTURE_LABELS = Object.freeze({ TJ_EX: "Travail journalier (TJ) et examen (EX)", SINGLE: "Note unique par période" });
const PERIODS = Object.freeze([
  Object.freeze({ id: "T1", label: "Trimestre 1" }),
  Object.freeze({ id: "T2", label: "Trimestre 2" }),
  Object.freeze({ id: "T3", label: "Trimestre 3" }),
]);
const AGGREGATIONS = Object.freeze(["sum", "weighted_average"]);
const MAX_SCORE = 1000;

class ReportCardCatalogError extends Error {
  constructor(code, details) {
    super(code);
    this.name = "ReportCardCatalogError";
    this.code = code;
    if (details) this.details = details;
  }
}

function fail(code, details) {
  throw new ReportCardCatalogError(code, details);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

/**
 * Définitions pédagogiques de base, versionnées par (model_id, version).
 * Règles communes et sûres : trimestres T1–T3 + bilan annuel, TJ et EX, note
 * manquante jamais zéro, arrondi d'affichage, pourcentage = points / maximum,
 * rang par pourcentage. Matières, maxima, sources des notes : établissement.
 */
const MODEL_DEFINITIONS = Object.freeze({
  // Référence pédagogique La Colombière : une ligne par matière, TJ / EX.
  "colombiere@1": Object.freeze({ style: "simple", allowComposite: false, suggestedStructure: "TJ_EX" }),
  // Référence pédagogique Le Berceau de la Sagesse : domaines et sous-matières, note de période.
  "berceau@1": Object.freeze({ style: "hierarchical", allowComposite: true, suggestedStructure: "SINGLE" }),
});

/** Données d'exemple FICTIVES des aperçus du catalogue (jamais des données d'établissement). */
const SAMPLE_SUBJECTS = Object.freeze({
  colombiere: [
    { code: "MATHEMATIQUES", name: "Mathématiques", max: { TJ: 20, EX: 20, NP: 40 } },
    { code: "FRANCAIS", name: "Français", max: { TJ: 20, EX: 20, NP: 40 } },
    { code: "SCIENCES", name: "Sciences", max: { TJ: 10, EX: 10, NP: 20 } },
    { code: "HISTOIRE", name: "Histoire et géographie", max: { TJ: 10, EX: 10, NP: 20 } },
    { code: "EDUCATION_CIVIQUE", name: "Éducation civique", max: { TJ: 10, NP: 10 } },
  ],
  berceau: [
    { code: "FRANCAIS", name: "Français" },
    { code: "FR_ECRIT", name: "Écrit", parent_code: "FRANCAIS", max: { TJ: 20, EX: 20, NP: 40 } },
    { code: "FR_LECTURE", name: "Lecture", parent_code: "FRANCAIS", max: { TJ: 10, EX: 10, NP: 20 } },
    { code: "MATHEMATIQUES", name: "Mathématiques" },
    { code: "MATH_MENTAL", name: "Calcul mental", parent_code: "MATHEMATIQUES", max: { TJ: 10, EX: 10, NP: 20 } },
    { code: "MATH_ECRIT", name: "Calcul écrit", parent_code: "MATHEMATIQUES", max: { TJ: 20, EX: 20, NP: 40 } },
    { code: "ARTS", name: "Arts" },
    { code: "ARTS_PLASTIQUES", name: "Art plastique", parent_code: "ARTS", max: { TJ: 10, NP: 10 } },
    { code: "MUSIQUE", name: "Musique", parent_code: "ARTS", max: { TJ: 10, NP: 10 } },
  ],
});
/** Proportions fictives (une note sur cinq sous la moitié : signalisation visible). */
const SAMPLE_RATIOS = Object.freeze([0.8, 0.65, 0.4, 0.75, 0.55, 0.9, 0.7]);

function definitionOf(model) {
  const definition = MODEL_DEFINITIONS[`${model.model_id}@${model.version}`];
  if (!definition) fail("CATALOG_MODEL_UNKNOWN");
  if (definition.style !== model.presentation_style) fail("CATALOG_MODEL_UNKNOWN");
  return definition;
}

function catalogModelKey(modelId) {
  return `catalog-${modelId}`;
}

function componentsOf(structure) {
  const components = STRUCTURES[structure];
  if (!components) fail("CONFIGURATION_INVALID", [{ field: "structure", code: "STRUCTURE_REQUIRED" }]);
  return components;
}

function baseProfile(structure) {
  return {
    period_mode: "term",
    periods: PERIODS.map((period) => period.id),
    annual: true,
    score_components: componentsOf(structure).map((component) => ({ id: component.id, applicability: "always" })),
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up", stage: "display_only" },
    ranking: { enabled: true, ties: "competition", metric: "PERCENTAGE" },
    aggregation: { mode: "weighted_sum", coefficient_default: 1, percentage: "points_over_max_100" },
    pass_rule: { metric: "PERCENTAGE", threshold: 50 },
  };
}

function baseSchema() {
  return {
    sections: [
      {
        id: "TOTALS",
        order: 1,
        kind: "totals",
        columns: [
          ...PERIODS.flatMap((period, index) => [
            { id: `COL_${period.id}_POINTS`, order: index * 2 + 1, kind: "computed_slot", slot: "PERIOD_POINTS", period_id: period.id },
            { id: `COL_${period.id}_MAX`, order: index * 2 + 2, kind: "computed_slot", slot: "PERIOD_MAX", period_id: period.id },
          ]),
          { id: "COL_ANNUAL_POINTS", order: 7, kind: "computed_slot", slot: "ANNUAL_POINTS" },
          { id: "COL_ANNUAL_MAX", order: 8, kind: "computed_slot", slot: "ANNUAL_MAX" },
          { id: "COL_PERCENTAGE", order: 9, kind: "computed_slot", slot: "PERCENTAGE" },
          { id: "COL_RANK", order: 10, kind: "computed_slot", slot: "RANK" },
        ],
      },
    ],
    identity_fields: [{ id: "STUDENT_NAME", order: 1 }],
  };
}

function templateFor(definition, structure, signatures, header = null) {
  return {
    paper: "A4",
    orientation: "portrait",
    qr_required: true,
    sections: [{ id: "CELLS", order: 1, source: "cells", label: "Matières" }],
    presentation: {
      style: definition.style,
      signatures,
      period_labels: Object.fromEntries(PERIODS.map((period) => [period.id, period.label])),
      component_labels: Object.fromEntries(componentsOf(structure).map((component) => [component.id, component.label])),
      ...(header ? { header } : {}),
    },
  };
}

/**
 * BULLETIN-CLASSE-01 / L3 — en-tête de l'assistant : listes fermées, texte limité.
 * Absent : aucun en-tête configurable (gabarits existants inchangés).
 */
function headerFromInput(raw, errors) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(fieldError("header", "HEADER_INVALID"));
    return null;
  }
  const layout = text(raw.layout) || "logo_left";
  if (!HEADER_LAYOUTS.includes(layout)) errors.push(fieldError("header.layout", "HEADER_LAYOUT_INVALID"));
  const show = [];
  for (const item of Array.isArray(raw.show) ? raw.show : []) {
    const id = text(item);
    if (!HEADER_ELEMENTS.includes(id)) errors.push(fieldError("header.show", "HEADER_ELEMENT_UNKNOWN"));
    else if (!show.includes(id)) show.push(id);
  }
  if (layout === "no_logo" && show.includes("logo")) errors.push(fieldError("header.show", "HEADER_LOGO_WITHOUT_PLACE"));
  const lines = (Array.isArray(raw.lines) ? raw.lines : []).map(text).filter(Boolean);
  if (lines.length > 4 || lines.some((line) => line.length > 80)) errors.push(fieldError("header.lines", "HEADER_LINES_INVALID"));
  const title = text(raw.title);
  if (title.length > 60) errors.push(fieldError("header.title", "HEADER_TITLE_INVALID"));
  const titleAlign = raw.title_align;
  if (titleAlign !== undefined && titleAlign !== "left" && titleAlign !== "center") {
    errors.push(fieldError("header.title_align", "HEADER_TITLE_ALIGN_INVALID"));
  }
  return { layout, show, lines, title, ...(titleAlign === undefined ? {} : { title_align: titleAlign }) };
}

function fieldError(field, code) {
  return { field, code };
}

/**
 * Configuration de l'établissement (entrée de l'assistant) → profil canonique.
 * input = { structure: "TJ_EX" | "SINGLE",
 *           subjects: [{ code, components: { TJ: { max }, EX: { max } } }],
 *           factSources: { TJ: { evaluationTypes: [], aggregation }, EX: {…} },
 *           periods: { T1: { termNames: [] }, … }, signatures: [] }
 * Erreurs : codes par champ (details), jamais de conversion silencieuse.
 */
function buildConfiguration(model, input, context) {
  const definition = definitionOf(model);
  const errors = [];
  const structure = text(input && input.structure);
  if (!STRUCTURES[structure]) fail("CONFIGURATION_INVALID", [fieldError("structure", "STRUCTURE_REQUIRED")]);
  const COMPONENTS = componentsOf(structure).map((component) => component.id);
  const catalog = Array.isArray(context?.subjects) ? context.subjects : [];
  const byCode = new Map(catalog.map((row) => [text(row.code), row]));
  const evaluationCodes = new Set((context?.evaluationTypes || []).filter((row) => text(row.status || "active") === "active").map((row) => text(row.code)));
  const chosen = Array.isArray(input?.subjects) ? input.subjects : [];
  if (!chosen.length) errors.push(fieldError("subjects", "SUBJECTS_REQUIRED"));

  const leaves = [];
  const parents = new Map();
  const seen = new Set();
  chosen.forEach((entry, index) => {
    const code = text(entry && entry.code);
    const row = byCode.get(code);
    if (!row || text(row.status || "active") !== "active") {
      errors.push(fieldError(`subjects.${index}`, context && context.classScoped ? "SUBJECT_NOT_IN_CLASS" : "SUBJECT_NOT_IN_SCHOOL_CATALOG"));
      return;
    }
    if (seen.has(code)) {
      errors.push(fieldError(`subjects.${index}`, "SUBJECT_DUPLICATE"));
      return;
    }
    seen.add(code);
    if (catalog.some((other) => text(other.parent_code) === code)) {
      errors.push(fieldError(`subjects.${index}`, "SUBJECT_IS_MAIN_SUBJECT"));
      return;
    }
    const parentCode = text(row.parent_code);
    if (parentCode && !definition.allowComposite) {
      errors.push(fieldError(`subjects.${index}`, "SUB_SUBJECT_NOT_ALLOWED"));
      return;
    }
    if (parentCode) {
      const parent = byCode.get(parentCode);
      if (!parent || text(parent.status || "active") !== "active") {
        errors.push(fieldError(`subjects.${index}`, "PARENT_SUBJECT_INACTIVE"));
        return;
      }
      parents.set(parentCode, parent);
    }
    const components = {};
    for (const componentId of COMPONENTS) {
      const raw = entry.components ? entry.components[componentId] : undefined;
      if (raw == null || raw === "" || raw.max === "" || raw.max == null) continue;
      const max = Number(raw.max);
      if (!Number.isFinite(max) || max <= 0 || max > MAX_SCORE) {
        errors.push(fieldError(`subjects.${index}.${componentId}`, "INVALID_MAX"));
        continue;
      }
      components[componentId] = { max };
    }
    if (!Object.keys(components).length) {
      errors.push(fieldError(`subjects.${index}`, "SUBJECT_WITHOUT_COMPONENTS"));
      return;
    }
    leaves.push({ code, parentCode: parentCode || null, components, order: index + 1 });
  });

  const factComponents = {};
  for (const componentId of COMPONENTS) {
    const raw = input?.factSources ? input.factSources[componentId] : undefined;
    const types = Array.isArray(raw?.evaluationTypes) ? raw.evaluationTypes.map(text).filter(Boolean) : [];
    if (!types.length) errors.push(fieldError(`factSources.${componentId}.evaluationTypes`, "EVALUATION_TYPES_REQUIRED"));
    for (const code of types) {
      if (!evaluationCodes.has(code)) errors.push(fieldError(`factSources.${componentId}.evaluationTypes`, "EVALUATION_TYPE_UNKNOWN"));
    }
    if (!AGGREGATIONS.includes(raw?.aggregation)) errors.push(fieldError(`factSources.${componentId}.aggregation`, "AGGREGATION_REQUIRED"));
    factComponents[componentId] = { evaluation_types: types, aggregation: raw?.aggregation };
  }
  const knownTerms = new Set((context?.terms || []).map((name) => text(name)));
  const factPeriods = {};
  for (const period of PERIODS) {
    const raw = input?.periods ? input.periods[period.id] : undefined;
    const names = Array.isArray(raw?.termNames) ? raw.termNames.map(text).filter(Boolean) : [];
    if (!names.length) errors.push(fieldError(`periods.${period.id}`, "TERM_REQUIRED"));
    for (const name of names) if (!knownTerms.has(name)) errors.push(fieldError(`periods.${period.id}`, "TERM_UNKNOWN"));
    factPeriods[period.id] = { term_names: names };
  }
  const signatures = (Array.isArray(input?.signatures) ? input.signatures : []).map(text).filter(Boolean);
  const header = headerFromInput(input?.header, errors);
  if (signatures.length > 4 || signatures.some((label) => label.length > 60)) errors.push(fieldError("signatures", "INVALID_SIGNATURES"));
  if (errors.length) fail("CONFIGURATION_INVALID", errors);

  // Matières principales (sous-matières) : ordre de la première sous-matière choisie.
  const subjects = [];
  let order = 0;
  const emittedParents = new Set();
  for (const leaf of leaves) {
    if (leaf.parentCode) {
      if (!emittedParents.has(leaf.parentCode)) {
        emittedParents.add(leaf.parentCode);
        order += 1;
        subjects.push({ id: leaf.parentCode, order });
      }
      const childOrder = leaves.filter((other) => other.parentCode === leaf.parentCode).indexOf(leaf) + 1;
      subjects.push({ id: leaf.code, parent_id: leaf.parentCode, order: childOrder, components: leaf.components });
    } else {
      order += 1;
      subjects.push({ id: leaf.code, order, components: leaf.components });
    }
  }
  const profileSpec = { ...baseProfile(structure), subjects, fact_sources: { components: factComponents, periods: factPeriods } };
  const schemaSpec = baseSchema();
  let profile;
  try {
    profile = validateSpec(JSON.parse(JSON.stringify(profileSpec)));
    validateAgainstProfile(JSON.parse(JSON.stringify(schemaSpec)), profile);
    assertProfileSubjectsInCatalog({
      schoolId: context.schoolId,
      profileSpec: profile,
      catalog: catalog.map((row) => ({ school_id: context.schoolId, subject_code: row.code, parent_subject_code: row.parent_code, status: row.status })),
    });
  } catch (err) {
    fail("CONFIGURATION_INVALID", [fieldError("profile", err.code || "INVALID_PROFILE")]);
  }
  return {
    profileSpec,
    schemaSpec,
    templateSpec: templateFor(definition, structure, signatures, header),
    profile,
    labels: { subjects: Object.fromEntries(catalog.map((row) => [text(row.code), text(row.name)])) },
  };
}

/**
 * Aperçu « bulletin d'exemple » : le MOTEUR CANONIQUE calcule un élève fictif
 * (notes d'exemple dérivées des maxima) puis l'adaptateur de présentation réel
 * produit la vue — mêmes règles, mêmes totaux, même signalisation des notes en
 * échec que les bulletins publiés. Jamais officiel, jamais enregistré.
 */
function samplePresentation(built, { school, identity = null, scope = null } = {}) {
  const profile = built.profile;
  const facts = [];
  let index = 0;
  for (const subject of profile.subjects) {
    if (!subject.components) continue;
    for (const period of PERIODS) {
      for (const [componentId, rule] of Object.entries(subject.components)) {
        const ratio = SAMPLE_RATIOS[index % SAMPLE_RATIOS.length];
        index += 1;
        facts.push({
          student_id: "EXEMPLE",
          subject_id: subject.id,
          period_id: period.id,
          score_component_id: componentId,
          raw_score: Math.round(rule.max * ratio * 2) / 2,
        });
      }
    }
  }
  const result = computeReportCard({
    profile: JSON.parse(JSON.stringify(built.profileSpec)),
    schema: JSON.parse(JSON.stringify(built.schemaSpec)),
    facts,
    cohort: facts,
    tenant: { schoolId: "catalog-preview", actorSchoolId: "catalog-preview" },
    provenance: { profile: { id: "catalog-preview", version: 1 }, schema: { id: "catalog-preview", version: 1 } },
  });
  return buildStudentPresentation({
    student: result.students[0],
    profile,
    labels: {
      ...built.labels,
      school: school || "Établissement d'exemple",
      className: (scope && scope.className) || "Classe d'exemple",
      academicYear: (scope && scope.academicYearName) || "Année d'exemple",
      students: { EXEMPLE: { name: "Élève d'exemple" } },
    },
    presentation: built.templateSpec.presentation,
    meta: { official: false, period_scope: "ANNUAL" },
    identity: identity || {
      establishment_name: school || "Établissement d'exemple",
      establishment_address: "Adresse de l'établissement",
      establishment_country: "Pays",
      logo_sha256: null,
    },
  });
}

/** Configuration d'exemple d'un modèle du catalogue (aperçus Superadmin et galerie). */
function sampleConfiguration(model, structure) {
  const definition = definitionOf(model);
  const chosen = structure || definition.suggestedStructure;
  const components = componentsOf(chosen).map((component) => component.id);
  const subjects = (SAMPLE_SUBJECTS[model.model_id] || []).map((row) => ({ ...row, status: "active" }));
  const input = {
    structure: chosen,
    subjects: subjects
      .filter((row) => row.max)
      .map((row) => ({
        code: row.code,
        components: Object.fromEntries(components.filter((id) => row.max[id]).map((id) => [id, { max: row.max[id] }])),
      })),
    factSources: Object.fromEntries(components.map((id) => [id, { evaluationTypes: [`exemple-${id.toLowerCase()}`], aggregation: "sum" }])),
    periods: Object.fromEntries(PERIODS.map((period) => [period.id, { termNames: [period.label] }])),
    signatures: definition.allowComposite ? ["Le titulaire", "Le parent"] : ["Le titulaire", "Le directeur", "Le parent"],
  };
  return buildConfiguration(model, input, {
    schoolId: "catalog-preview",
    subjects: subjects.map((row) => ({ code: row.code, name: row.name, parent_code: row.parent_code || null, status: "active" })),
    evaluationTypes: components.map((id) => ({ code: `exemple-${id.toLowerCase()}`, status: "active" })),
    terms: PERIODS.map((period) => period.label),
  });
}

function modelPreview(model, structure) {
  return samplePresentation(sampleConfiguration(model, structure));
}

function hasPermission(actor, token) {
  return Boolean(actor && Array.isArray(actor.permissions) && actor.permissions.includes(token));
}

function requirePlatformAdmin(actor) {
  if (!actor) fail("RBAC_DENIED");
  if (!(actor.platform && actor.platform.privileged === true) || !hasPermission(actor, PERM_CONFIGURE)) fail("PLATFORM_CONTEXT_REQUIRED");
}

function schoolOf(actor) {
  if (!actor) fail("RBAC_DENIED");
  if (actor.platform && actor.platform.privileged === true) fail("TENANT_MISMATCH");
  if (Array.isArray(actor.studentIds)) fail("RBAC_DENIED");
  const schoolId = text(actor.actorSchoolId);
  if (!schoolId) fail("TENANT_REQUIRED");
  return schoolId;
}

function requireModelId(modelId) {
  const id = text(modelId);
  if (!MODEL_ID_RE.test(id)) fail("CATALOG_MODEL_UNKNOWN");
  return id;
}

function createReportCardCatalog({ store, configuration, clock, identityStore = null } = {}) {
  /** Identité ACTUELLE de l'établissement (aperçu : jamais figée, jamais officielle). */
  async function currentIdentity(schoolId) {
    if (!identityStore || typeof identityStore.currentIdentity !== "function") return null;
    const { publicIdentity } = require("../../db/reportCardOfficialIdentityStore");
    return publicIdentity(await identityStore.currentIdentity(schoolId));
  }

  if (!store || !configuration) fail("CATALOG_UNAVAILABLE");

  /** Métadonnées d'affichage d'un modèle (structure suggérée, aperçu réel d'exemple). */
  function modelMeta(row) {
    const definition = MODEL_DEFINITIONS[`${row.model_id}@${row.version}`];
    if (!definition) return { preview: null };
    return {
      allow_sub_subjects: definition.allowComposite,
      suggested_structure: definition.suggestedStructure,
      preview: modelPreview(row, definition.suggestedStructure),
    };
  }

  function publicModel(row) {
    return {
      model_id: row.model_id,
      version: row.version,
      name: row.name,
      description: row.description,
      presentation_style: row.presentation_style,
      status: row.status,
    };
  }

  // ---------------- Superadmin ----------------

  async function adminOverview({ actor }) {
    requirePlatformAdmin(actor);
    const [models, countries, availability] = await Promise.all([store.listModels(), store.listCountries(), store.listAvailability()]);
    return {
      countries,
      models: models.map((row) => ({
        ...publicModel(row),
        ...modelMeta(row),
        availability: availability
          .filter((entry) => entry.model_id === row.model_id)
          .map((entry) => ({ country_id: entry.country_id, available: entry.available === true, updated_at: entry.updated_at, updated_by: entry.updated_by })),
      })),
    };
  }

  async function setAvailability({ actor, modelId, countryId, available, confirm }) {
    requirePlatformAdmin(actor);
    if (confirm !== true) fail("CONFIRMATION_REQUIRED");
    if (typeof available !== "boolean") fail("AVAILABILITY_INVALID");
    const id = requireModelId(modelId);
    const model = await store.getModel(id);
    if (!model) fail("CATALOG_MODEL_UNKNOWN");
    definitionOf(model);
    const country = text(countryId);
    if (!UUID_RE.test(country) || !(await store.getCountry(country))) fail("COUNTRY_UNKNOWN");
    if (available && model.status !== "active") fail("CATALOG_MODEL_RETIRED");
    const actorId = text(actor.actorId) || "unknown";
    return store.setAvailability({ modelId: id, countryId: country, available, actorId });
  }

  async function adminAudit({ actor, modelId }) {
    requirePlatformAdmin(actor);
    return store.listAudit({ modelId: modelId ? requireModelId(modelId) : undefined });
  }

  // ---------------- Établissement ----------------

  /**
   * BULLETIN-CLASSE-01 / L2 — portée « classe » : la classe doit appartenir à l'établissement
   * du jeton ; son année est lue en base (jamais fournie par le navigateur).
   */
  async function resolveClassScope(schoolId, classId) {
    if (classId == null || text(classId) === "") return null;
    if (typeof store.classScope !== "function") fail("CATALOG_UNAVAILABLE");
    const row = await store.classScope(schoolId, classId);
    if (!row) fail("CLASS_NOT_FOUND");
    return {
      classId: row.class_id,
      academicYearId: row.academic_year_id,
      className: row.name || null,
      academicYearName: row.academic_year_name || null,
    };
  }

  function configurationScope(scope) {
    return scope ? { classId: scope.classId, academicYearId: scope.academicYearId } : undefined;
  }

  function publicClass(scope) {
    return scope ? { id: scope.classId, name: scope.className, academic_year_id: scope.academicYearId, academic_year_name: scope.academicYearName } : null;
  }

  function configurationLabel(state) {
    if (state.active) return "ACTIVE";
    if (state.saved) return "SAVED";
    if (state.inherited) return "INHERITED";
    return "NONE";
  }

  async function stateFor(actor, schoolId, model, scope = null) {
    try {
      return await configuration.catalogConfigurationState({
        actor,
        schoolId,
        modelKey: catalogModelKey(model.model_id),
        scope: configurationScope(scope),
      });
    } catch (err) {
      if (err && err.code === "RBAC_DENIED") return { active: null, saved: null, inherited: null };
      throw err;
    }
  }

  /**
   * Modèles pour l'établissement de l'acteur. Pays inconnu : aucun modèle
   * (country null, reason COUNTRY_UNKNOWN). Un modèle retiré du pays reste
   * listé UNIQUEMENT s'il est déjà actif dans l'établissement, marqué indisponible.
   */
  async function schoolCatalog({ actor, classId }) {
    const schoolId = schoolOf(actor);
    if (!hasPermission(actor, PERM_READ) && !hasPermission(actor, PERM_APPROVE)) fail("RBAC_DENIED");
    const country = await store.schoolCountry(schoolId);
    const canConfigure = hasPermission(actor, PERM_APPROVE);
    if (!country) return { country: null, reason: "COUNTRY_UNKNOWN", canConfigure, models: [] };
    const scope = await resolveClassScope(schoolId, classId);
    const models = [];
    for (const row of await store.listModels()) {
      if (!MODEL_DEFINITIONS[`${row.model_id}@${row.version}`]) continue;
      const available = row.status === "active" && (await store.isAvailable(row.model_id, country.id));
      const state = await stateFor(actor, schoolId, row, scope);
      if (!available && !state.active && !state.inherited) continue;
      models.push({
        ...publicModel(row),
        ...modelMeta(row),
        available,
        configuration: configurationLabel(state),
        activated_at: state.active ? state.active.activated_at : state.inherited ? state.inherited.activated_at : null,
        saved_at: state.saved ? state.saved.updated_at : null,
      });
    }
    return { country: { id: country.id, name: country.name }, reason: null, canConfigure, class: publicClass(scope), models };
  }

  async function requireConfigurableModel(actor, modelId) {
    const schoolId = schoolOf(actor);
    if (!hasPermission(actor, PERM_APPROVE)) fail("RBAC_DENIED");
    const model = await store.getModel(requireModelId(modelId));
    if (!model) fail("CATALOG_MODEL_UNKNOWN");
    definitionOf(model);
    const country = await store.schoolCountry(schoolId);
    if (!country) fail("COUNTRY_UNKNOWN");
    if (model.status !== "active" || !(await store.isAvailable(model.model_id, country.id))) fail("CATALOG_MODEL_NOT_AVAILABLE");
    return { schoolId, model };
  }

  function inputFromProfile(profile, template) {
    if (!profile) return null;
    const leaves = (profile.subjects || []).filter((subject) => subject.components && Object.keys(subject.components).length);
    const componentIds = (profile.score_components || []).map((component) => component.id);
    return {
      structure: componentIds.includes("NP") ? "SINGLE" : "TJ_EX",
      subjects: leaves.map((subject) => ({
        code: subject.id,
        components: Object.fromEntries(Object.entries(subject.components).map(([id, rule]) => [id, { max: rule.max }])),
      })),
      factSources: Object.fromEntries(
        Object.entries((profile.fact_sources && profile.fact_sources.components) || {}).map(([id, entry]) => [
          id,
          { evaluationTypes: entry.evaluation_types, aggregation: entry.aggregation },
        ])
      ),
      periods: Object.fromEntries(
        Object.entries((profile.fact_sources && profile.fact_sources.periods) || {}).map(([id, entry]) => [id, { termNames: entry.term_names }])
      ),
      signatures: (template && template.presentation && template.presentation.signatures) || [],
      header: (template && template.presentation && template.presentation.header) || null,
    };
  }

  async function contextFor(schoolId, scope) {
    if (!scope) return store.schoolContext(schoolId);
    return { ...(await store.classContext(schoolId, { class_id: scope.classId, academic_year_id: scope.academicYearId })), classScoped: true };
  }

  /**
   * Une configuration héritée de l'établissement ne pré-coche pas les
   * matières sans cours actif dans la classe sélectionnée.
   * Une configuration propre à la classe ne doit pas être réécrite.
   */
  function inheritedInputForClass(input, subjects) {
    if (!input) return null;
    const allowed = new Set((subjects || [])
      .filter((row) => text(row.status || "active") === "active")
      .map((row) => text(row.code)));
    return {
      ...input,
      subjects: (input.subjects || []).filter((row) => allowed.has(text(row.code))),
    };
  }

  async function configurationContext({ actor, modelId, classId }) {
    const { schoolId, model } = await requireConfigurableModel(actor, modelId);
    const scope = await resolveClassScope(schoolId, classId);
    const [context, state] = await Promise.all([contextFor(schoolId, scope), stateFor(actor, schoolId, model, scope)]);
    // Classe sans configuration propre : pré-remplissage depuis la configuration héritée (lecture seule).
    const source = state.saved || state.active || state.inherited;
    return {
      model: publicModel(model),
      style: definitionOf(model).style,
      allowSubSubjects: definitionOf(model).allowComposite,
      suggestedStructure: definitionOf(model).suggestedStructure,
      structures: Object.keys(STRUCTURES).map((id) => ({ id, label: STRUCTURE_LABELS[id], components: STRUCTURES[id] })),
      periods: PERIODS,
      subjects: context.subjects.filter((row) => text(row.status || "active") === "active").map((row) => ({ code: row.code, name: row.name, parent_code: row.parent_code })),
      evaluationTypes: context.evaluationTypes.filter((row) => text(row.status || "active") === "active").map((row) => ({ code: row.code, name: row.name })),
      terms: context.terms,
      configuration: configurationLabel(state),
      // Configuration enregistrée en attente d'activation (éventuellement au-dessus d'une configuration active).
      pendingSaved: Boolean(state.saved),
      class: publicClass(scope),
      current: source
        ? (scope && state.inherited && !state.active && !state.saved
          ? inheritedInputForClass(inputFromProfile(source.profile, source.template), context.subjects)
          : inputFromProfile(source.profile, source.template))
        : null,
    };
  }

  async function buildFor(actor, modelId, input, classId) {
    const { schoolId, model } = await requireConfigurableModel(actor, modelId);
    const scope = await resolveClassScope(schoolId, classId);
    const context = await contextFor(schoolId, scope);
    const built = buildConfiguration(model, input, { ...context, schoolId });
    return { schoolId, model, built, scope };
  }

  async function preview({ actor, modelId, input, classId }) {
    const { built, schoolId, scope } = await buildFor(actor, modelId, input, classId);
    return samplePresentation(built, { identity: await currentIdentity(schoolId), scope });
  }

  async function save({ actor, modelId, input, classId }) {
    const { schoolId, model, built, scope } = await buildFor(actor, modelId, input, classId);
    const request = await configuration.saveCatalogConfiguration({
      actor,
      schoolId,
      modelKey: catalogModelKey(model.model_id),
      description: `Catalogue : ${model.name} (v${model.version})`,
      profileSpec: built.profileSpec,
      schemaSpec: built.schemaSpec,
      templateSpec: built.templateSpec,
      scope: configurationScope(scope),
    });
    return { status: "SAVED", request_status: request.status, class: publicClass(scope), preview: samplePresentation(built, { identity: await currentIdentity(schoolId), scope }) };
  }

  async function activate({ actor, modelId, confirm, commandId, classId }) {
    if (confirm !== true) fail("CONFIRMATION_REQUIRED");
    const { schoolId, model } = await requireConfigurableModel(actor, modelId);
    const scope = await resolveClassScope(schoolId, classId);
    const active = await configuration.activateCatalogConfiguration({
      actor,
      schoolId,
      modelKey: catalogModelKey(model.model_id),
      commandId,
      scope: configurationScope(scope),
    });
    return { status: active.status, model_key: active.model_key, class: publicClass(scope) };
  }

  void clock;
  return { adminOverview, setAvailability, adminAudit, schoolCatalog, configurationContext, preview, save, activate };
}

module.exports = {
  ReportCardCatalogError,
  MODEL_DEFINITIONS,
  PERIODS,
  STRUCTURES,
  buildConfiguration,
  catalogModelKey,
  createReportCardCatalog,
  modelPreview,
  samplePresentation,
  sampleConfiguration,
};
