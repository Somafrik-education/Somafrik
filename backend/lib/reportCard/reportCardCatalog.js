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
const { computeSubjectTotals, expectedMissingCells } = require("./reportCardSubjectTotals");
const { buildStudentPresentation } = require("./reportCardPresentation");

const PERM_CONFIGURE = "REPORT_CARD_CONFIGURE";
const PERM_APPROVE = "REPORT_CARD_SCHOOL_APPROVE_TEMPLATE";
const PERM_READ = "REPORT_CARD_READ";

const MODEL_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPONENTS = Object.freeze(["TJ", "EX"]);
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
  "classique@1": Object.freeze({ style: "simple", allowComposite: false }),
  "sous-matieres@1": Object.freeze({ style: "hierarchical", allowComposite: true }),
});

function definitionOf(model) {
  const definition = MODEL_DEFINITIONS[`${model.model_id}@${model.version}`];
  if (!definition) fail("CATALOG_MODEL_UNKNOWN");
  if (definition.style !== model.presentation_style) fail("CATALOG_MODEL_UNKNOWN");
  return definition;
}

function catalogModelKey(modelId) {
  return `catalog-${modelId}`;
}

function baseProfile() {
  return {
    period_mode: "term",
    periods: PERIODS.map((period) => period.id),
    annual: true,
    score_components: COMPONENTS.map((id) => ({ id, applicability: "always" })),
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

function templateFor(definition, signatures) {
  return {
    paper: "A4",
    orientation: "portrait",
    qr_required: true,
    sections: [{ id: "CELLS", order: 1, source: "cells", label: "Matières" }],
    presentation: {
      style: definition.style,
      signatures,
      period_labels: Object.fromEntries(PERIODS.map((period) => [period.id, period.label])),
    },
  };
}

function fieldError(field, code) {
  return { field, code };
}

/**
 * Configuration de l'établissement (entrée de l'assistant) → profil canonique.
 * input = { subjects: [{ code, components: { TJ: { max }, EX: { max } } }],
 *           factSources: { TJ: { evaluationTypes: [], aggregation }, EX: {…} },
 *           periods: { T1: { termNames: [] }, … }, signatures: [] }
 * Erreurs : codes par champ (details), jamais de conversion silencieuse.
 */
function buildConfiguration(model, input, context) {
  const definition = definitionOf(model);
  const errors = [];
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
      errors.push(fieldError(`subjects.${index}`, "SUBJECT_NOT_IN_SCHOOL_CATALOG"));
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
  const profileSpec = { ...baseProfile(), subjects, fact_sources: { components: factComponents, periods: factPeriods } };
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
    templateSpec: templateFor(definition, signatures),
    profile,
    labels: { subjects: Object.fromEntries(catalog.map((row) => [text(row.code), text(row.name)])) },
  };
}

/**
 * Aperçu de STRUCTURE (aucune note, aucun élève) : moteur canonique
 * (computeSubjectTotals) sur des cellules attendues vides ⇒ maxima et
 * sous-totaux de maxima exacts ; les valeurs obtenues restent vides.
 */
function structurePreview(built, { school } = {}) {
  const profile = built.profile;
  const cells = expectedMissingCells(profile, "APERCU", []);
  const subjectTotals = computeSubjectTotals(profile, cells, (value) => Math.round(value * 100) / 100);
  return buildStudentPresentation({
    student: { student_id: "", subject_totals: subjectTotals, slots: [] },
    profile,
    labels: { ...built.labels, school: school || null },
    presentation: built.templateSpec.presentation,
    meta: { official: false },
  });
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

function createReportCardCatalog({ store, configuration, clock } = {}) {
  if (!store || !configuration) fail("CATALOG_UNAVAILABLE");

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

  async function stateFor(actor, schoolId, model) {
    try {
      return await configuration.catalogConfigurationState({ actor, schoolId, modelKey: catalogModelKey(model.model_id) });
    } catch (err) {
      if (err && err.code === "RBAC_DENIED") return { active: null, saved: null };
      throw err;
    }
  }

  /**
   * Modèles pour l'établissement de l'acteur. Pays inconnu : aucun modèle
   * (country null, reason COUNTRY_UNKNOWN). Un modèle retiré du pays reste
   * listé UNIQUEMENT s'il est déjà actif dans l'établissement, marqué indisponible.
   */
  async function schoolCatalog({ actor }) {
    const schoolId = schoolOf(actor);
    if (!hasPermission(actor, PERM_READ) && !hasPermission(actor, PERM_APPROVE)) fail("RBAC_DENIED");
    const country = await store.schoolCountry(schoolId);
    const canConfigure = hasPermission(actor, PERM_APPROVE);
    if (!country) return { country: null, reason: "COUNTRY_UNKNOWN", canConfigure, models: [] };
    const models = [];
    for (const row of await store.listModels()) {
      if (!MODEL_DEFINITIONS[`${row.model_id}@${row.version}`]) continue;
      const available = row.status === "active" && (await store.isAvailable(row.model_id, country.id));
      const state = await stateFor(actor, schoolId, row);
      if (!available && !state.active) continue;
      models.push({
        ...publicModel(row),
        available,
        configuration: state.active ? "ACTIVE" : state.saved ? "SAVED" : "NONE",
        activated_at: state.active ? state.active.activated_at : null,
        saved_at: state.saved ? state.saved.updated_at : null,
      });
    }
    return { country: { id: country.id, name: country.name }, reason: null, canConfigure, models };
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
    return {
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
    };
  }

  async function configurationContext({ actor, modelId }) {
    const { schoolId, model } = await requireConfigurableModel(actor, modelId);
    const [context, state] = await Promise.all([store.schoolContext(schoolId), stateFor(actor, schoolId, model)]);
    const source = state.saved || state.active;
    return {
      model: publicModel(model),
      style: definitionOf(model).style,
      allowSubSubjects: definitionOf(model).allowComposite,
      periods: PERIODS,
      components: COMPONENTS.map((id) => ({ id, label: id })),
      subjects: context.subjects.filter((row) => text(row.status || "active") === "active").map((row) => ({ code: row.code, name: row.name, parent_code: row.parent_code })),
      evaluationTypes: context.evaluationTypes.filter((row) => text(row.status || "active") === "active").map((row) => ({ code: row.code, name: row.name })),
      terms: context.terms,
      configuration: state.active ? "ACTIVE" : state.saved ? "SAVED" : "NONE",
      current: source ? inputFromProfile(source.profile, source.template) : null,
    };
  }

  async function buildFor(actor, modelId, input) {
    const { schoolId, model } = await requireConfigurableModel(actor, modelId);
    const context = await store.schoolContext(schoolId);
    const built = buildConfiguration(model, input, { ...context, schoolId });
    return { schoolId, model, built };
  }

  async function preview({ actor, modelId, input }) {
    const { built } = await buildFor(actor, modelId, input);
    return structurePreview(built);
  }

  async function save({ actor, modelId, input }) {
    const { schoolId, model, built } = await buildFor(actor, modelId, input);
    const request = await configuration.saveCatalogConfiguration({
      actor,
      schoolId,
      modelKey: catalogModelKey(model.model_id),
      description: `Catalogue : ${model.name} (v${model.version})`,
      profileSpec: built.profileSpec,
      schemaSpec: built.schemaSpec,
      templateSpec: built.templateSpec,
    });
    return { status: "SAVED", request_status: request.status, preview: structurePreview(built) };
  }

  async function activate({ actor, modelId, confirm, commandId }) {
    if (confirm !== true) fail("CONFIRMATION_REQUIRED");
    const { schoolId, model } = await requireConfigurableModel(actor, modelId);
    const active = await configuration.activateCatalogConfiguration({
      actor,
      schoolId,
      modelKey: catalogModelKey(model.model_id),
      commandId,
    });
    return { status: active.status, model_key: active.model_key };
  }

  void clock;
  return { adminOverview, setAvailability, adminAudit, schoolCatalog, configurationContext, preview, save, activate };
}

module.exports = {
  ReportCardCatalogError,
  MODEL_DEFINITIONS,
  PERIODS,
  buildConfiguration,
  catalogModelKey,
  createReportCardCatalog,
  structurePreview,
};
