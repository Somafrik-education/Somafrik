"use strict";

const {
  SCHOOL_SETTINGS_ERROR,
  asTrimmed,
  createSchoolSettingsError,
  assertSchoolSettingsRead,
  assertSchoolSettingsWrite,
  ignoreClientScope,
  parseSettingsPatch,
  mapSettingsRow,
} = require("./schoolSettingsManagement");
const { createSchoolSettingsPgStore } = require("../db/schoolSettingsPgStore");

function settingsStore(repo) {
  if (typeof repo.getSchoolSettingsStore === "function") {
    return repo.getSchoolSettingsStore();
  }
  return createSchoolSettingsPgStore(repo);
}

async function writeSchoolSettingsAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordAudit !== "function") {
    throw createSchoolSettingsError(500, "Audit indisponible dans la transaction.");
  }
  await tx.recordAudit(
    {
      schoolCode: entry.schoolCode || principal?.schoolCode,
      userId: principal?.sub || principal?.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: String(entry.entityId ?? ""),
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      ipAddress: auditMeta?.ipAddress,
      userAgent: auditMeta?.userAgent,
    },
    tx,
  );
}

function resolveSchoolCodeFromPrincipal(principal, explicitSchoolCode) {
  if (explicitSchoolCode) return asTrimmed(explicitSchoolCode).toUpperCase();
  const code = asTrimmed(principal?.schoolCode).toUpperCase();
  if (!code || code === "*") {
    throw createSchoolSettingsError(400, "Établissement requis.", SCHOOL_SETTINGS_ERROR.FORBIDDEN);
  }
  return code;
}

async function getSchoolSettings(repo, principal, schoolCode) {
  assertSchoolSettingsRead(principal);
  const scopedSchool = resolveSchoolCodeFromPrincipal(principal, schoolCode);
  const store = settingsStore(repo);
  const school = await store.requireSchoolByCode(scopedSchool);
  const row = await store.getSettings(school.id);
  const mapped = mapSettingsRow(
    row ?? {
      school_id: school.id,
      period_mode: "trimestre",
      default_scale: 20,
      report_card_mode: "period",
    },
    school.school_code,
  );
  const config = await store.projectAcademicConfig(scopedSchool);
  return { ...mapped, periods: config.periods, schoolYear: config.schoolYear };
}

async function patchSchoolSettings(repo, rawPayload, principal, auditMeta, schoolCode) {
  assertSchoolSettingsWrite(principal);
  const patch = parseSettingsPatch(rawPayload);
  if (!Object.keys(patch).length) {
    throw createSchoolSettingsError(400, "Aucun paramètre à modifier.");
  }
  const scopedSchool = resolveSchoolCodeFromPrincipal(principal, schoolCode);
  const store = settingsStore(repo);
  const school = await store.requireSchoolByCode(scopedSchool);
  const existing = await store.getSettings(school.id);
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = settingsStore(scope);
    const savedRow = await scopedStore.upsertSettings(school.id, patch);
    const saved = mapSettingsRow(savedRow, school.school_code);
    await writeSchoolSettingsAudit(scope, principal, auditMeta, {
      schoolCode: scopedSchool,
      action: "update_school_settings",
      entityType: "school_settings",
      entityId: school.id,
      oldValue: existing ? mapSettingsRow(existing, school.school_code) : null,
      newValue: saved,
    });
    return saved;
  });
}

async function replaceAcademicPeriods(repo, rawPayload, principal, auditMeta, schoolCode) {
  assertSchoolSettingsWrite(principal);
  const payload = ignoreClientScope(rawPayload);
  const periods = Array.isArray(payload.periods) ? payload.periods : [];
  const scopedSchool = resolveSchoolCodeFromPrincipal(principal, schoolCode);
  const store = settingsStore(repo);
  const school = await store.requireSchoolByCode(scopedSchool);
  const previous = await store.listTermRows(school.id);
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = settingsStore(scope);
    const savedRows = await scopedStore.replaceTerms(school.id, periods);
    const projected = await scopedStore.projectAcademicConfig(scopedSchool);
    await writeSchoolSettingsAudit(scope, principal, auditMeta, {
      schoolCode: scopedSchool,
      action: "replace_academic_periods",
      entityType: "academic_period",
      entityId: school.id,
      oldValue: previous.map((row) => ({ id: row.id, name: row.name })),
      newValue: projected.periods,
    });
    return { periods: projected.periods, periodMode: projected.periodMode };
  });
}

async function ensureSchoolSettingsConstraints(repo, logger = console) {
  const store = settingsStore(repo);
  const { inventory, ambiguous } = await store.inventoryLegacySchoolSettingsPayloads();
  const logInfo = typeof logger.info === "function" ? logger.info.bind(logger) : console.log;
  const logError = typeof logger.error === "function" ? logger.error.bind(logger) : console.error;
  logInfo(`[school-settings] inventaire legacy academic-config : ${inventory.length} établissement(s), ${ambiguous.length} ambigu(s)`);
  if (ambiguous.length > 0) {
    const details = ambiguous
      .slice(0, 5)
      .map((row) => `${row.schoolCode}(keys=${(row.keys ?? []).join(",")})`)
      .join("; ");
    const message =
      `Paramètres établissement : ${ambiguous.length} établissement(s) ont un JSON academic-config non exactement équivalent aux sources PostgreSQL. ` +
      `Aucune correspondance automatique. Résolution explicite requise avant bascule canonique.` +
      (details ? ` Exemples: ${details}` : "");
    logError(`[school-settings] ${message}`);
    const error = new Error(message);
    error.name = "SchoolSettingsConstraintsError";
    error.code = SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_AMBIGUOUS;
    error.inventory = { ambiguousSchools: ambiguous.length, inventoryCount: inventory.length, ambiguous };
    throw error;
  }
}

async function stripLegacySchoolSettingsPayloads(repo) {
  const { STRIP_LEGACY_SCHOOL_SETTINGS_SQL } = require("../db/schoolSettingsSchema");
  await repo.query(STRIP_LEGACY_SCHOOL_SETTINGS_SQL);
}

async function ensureSchoolSettingsBootstrap(repo) {
  const store = settingsStore(repo);
  await store.bootstrapCanonicalSettingsForAllSchools();
}

module.exports = {
  getSchoolSettings,
  patchSchoolSettings,
  replaceAcademicPeriods,
  ensureSchoolSettingsConstraints,
  stripLegacySchoolSettingsPayloads,
  ensureSchoolSettingsBootstrap,
};
