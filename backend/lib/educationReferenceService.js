"use strict";

const {
  EDUCATION_REFERENCE_ERROR,
  STREAM_TYPES,
  asTrimmed,
  normalizeCode,
  createEducationReferenceError,
  assertEducationReferenceCatalogWrite,
  resolveCatalogWriteCountryCode,
  pedagogicalLabelsFromCountryRow,
  requirePedagogicalLabel,
  assertSchoolActivationWrite,
  ignoreClientScope,
} = require("./educationReferenceManagement");
const { createEducationReferencePgStore } = require("../db/educationReferencePgStore");

function eduStore(repo) {
  if (typeof repo.getEducationReferenceStore === "function") {
    return repo.getEducationReferenceStore();
  }
  return createEducationReferencePgStore(repo);
}

async function writeEducationAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordAudit !== "function") {
    throw createEducationReferenceError(500, "Audit indisponible dans la transaction.");
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

async function resolveCountry(store, countryCode) {
  const country = await store.getCountryByCode(countryCode);
  if (!country) {
    throw createEducationReferenceError(404, "Pays introuvable.", EDUCATION_REFERENCE_ERROR.COUNTRY_NOT_FOUND);
  }
  return country;
}

async function createLevel(repo, rawPayload, principal, auditMeta) {
  const countryCode = resolveCatalogWriteCountryCode(rawPayload, principal);
  assertEducationReferenceCatalogWrite(principal, countryCode, "create");
  const payload = ignoreClientScope(rawPayload);
  const name = asTrimmed(payload.name);
  const code = normalizeCode(payload.code || name);
  if (!countryCode || !name || !code) {
    throw createEducationReferenceError(400, "Pays, nom et code niveau obligatoires.");
  }
  const store = eduStore(repo);
  const country = await resolveCountry(store, countryCode);
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = eduStore(scope);
    try {
      const saved = await scopedStore.insertLevel({
        countryId: country.id,
        code,
        name,
        displayOrder: Number(payload.displayOrder ?? 0),
      });
      await writeEducationAudit(scope, principal, auditMeta, {
        action: "create_education_level",
        entityType: "education_level",
        entityId: saved.id,
        newValue: saved,
      });
      return saved;
    } catch (error) {
      if (error?.code === "23505") {
        throw createEducationReferenceError(409, "Code niveau déjà utilisé pour ce pays.", EDUCATION_REFERENCE_ERROR.DUPLICATE);
      }
      throw error;
    }
  });
}

async function updateLevel(repo, levelId, rawPatch, principal, auditMeta) {
  const patch = ignoreClientScope(rawPatch);
  const store = eduStore(repo);
  const existing = await store.getLevelById(levelId);
  if (!existing) {
    throw createEducationReferenceError(404, "Niveau introuvable.", EDUCATION_REFERENCE_ERROR.LEVEL_NOT_FOUND);
  }
  assertEducationReferenceCatalogWrite(principal, existing.countryCode, "update");
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = eduStore(scope);
    const saved = await scopedStore.updateLevel(levelId, {
      name: patch.name ? asTrimmed(patch.name) : undefined,
      displayOrder: patch.displayOrder != null ? Number(patch.displayOrder) : undefined,
    });
    if (!saved) {
      throw createEducationReferenceError(404, "Niveau introuvable ou archivé.", EDUCATION_REFERENCE_ERROR.LEVEL_NOT_FOUND);
    }
    await writeEducationAudit(scope, principal, auditMeta, {
      action: "update_education_level",
      entityType: "education_level",
      entityId: levelId,
      oldValue: existing,
      newValue: saved,
    });
    return saved;
  });
}

async function archiveLevel(repo, levelId, principal, auditMeta) {
  const store = eduStore(repo);
  const existing = await store.getLevelById(levelId);
  if (!existing) {
    throw createEducationReferenceError(404, "Niveau introuvable.", EDUCATION_REFERENCE_ERROR.LEVEL_NOT_FOUND);
  }
  assertEducationReferenceCatalogWrite(principal, existing.countryCode, "update");
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = eduStore(scope);
    const saved = await scopedStore.archiveLevel(levelId);
    if (!saved) {
      throw createEducationReferenceError(404, "Niveau introuvable ou déjà archivé.", EDUCATION_REFERENCE_ERROR.LEVEL_NOT_FOUND);
    }
    await writeEducationAudit(scope, principal, auditMeta, {
      action: "archive_education_level",
      entityType: "education_level",
      entityId: levelId,
      oldValue: existing,
      newValue: saved,
    });
    return saved;
  });
}

async function createStream(repo, rawPayload, principal, auditMeta) {
  const countryCode = resolveCatalogWriteCountryCode(rawPayload, principal);
  assertEducationReferenceCatalogWrite(principal, countryCode, "create");
  const payload = ignoreClientScope(rawPayload);
  const name = asTrimmed(payload.name);
  const streamType = asTrimmed(payload.streamType || "filiere").toLowerCase();
  const code = normalizeCode(payload.code || name);
  if (!countryCode || !name || !code) {
    throw createEducationReferenceError(400, "Pays, nom et code filière obligatoires.");
  }
  if (!STREAM_TYPES.has(streamType)) {
    throw createEducationReferenceError(400, "Type de filière invalide.");
  }
  const store = eduStore(repo);
  const country = await resolveCountry(store, countryCode);
  if (payload.levelId) {
    const level = await store.getLevelById(payload.levelId);
    if (!level || level.countryCode !== countryCode) {
      throw createEducationReferenceError(404, "Niveau parent introuvable pour ce pays.", EDUCATION_REFERENCE_ERROR.LEVEL_NOT_FOUND);
    }
    if (level.status !== "active") {
      throw createEducationReferenceError(
        404,
        "Niveau parent introuvable ou archivé.",
        EDUCATION_REFERENCE_ERROR.LEVEL_NOT_FOUND,
      );
    }
  }
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = eduStore(scope);
    try {
      const saved = await scopedStore.insertStream({
        countryId: country.id,
        levelId: payload.levelId || null,
        code,
        name,
        streamType,
        displayOrder: Number(payload.displayOrder ?? 0),
      });
      await writeEducationAudit(scope, principal, auditMeta, {
        action: "create_education_stream",
        entityType: "education_stream",
        entityId: saved.id,
        newValue: saved,
      });
      return saved;
    } catch (error) {
      if (error?.code === "23505") {
        throw createEducationReferenceError(409, "Code filière déjà utilisé pour ce pays.", EDUCATION_REFERENCE_ERROR.DUPLICATE);
      }
      throw error;
    }
  });
}

async function updateStream(repo, streamId, rawPatch, principal, auditMeta) {
  const patch = ignoreClientScope(rawPatch);
  const store = eduStore(repo);
  const existing = await store.getStreamById(streamId);
  if (!existing) {
    throw createEducationReferenceError(404, "Filière introuvable.", EDUCATION_REFERENCE_ERROR.STREAM_NOT_FOUND);
  }
  assertEducationReferenceCatalogWrite(principal, existing.countryCode, "update");
  if (patch.levelId !== undefined && patch.levelId) {
    const level = await store.getLevelById(patch.levelId);
    if (!level || level.countryCode !== existing.countryCode) {
      throw createEducationReferenceError(
        403,
        "Niveau parent invalide pour ce pays.",
        EDUCATION_REFERENCE_ERROR.COUNTRY_MISMATCH,
      );
    }
    if (level.status !== "active") {
      throw createEducationReferenceError(
        404,
        "Niveau parent introuvable ou archivé.",
        EDUCATION_REFERENCE_ERROR.LEVEL_NOT_FOUND,
      );
    }
  }
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = eduStore(scope);
    const storePatch = {
      name: patch.name ? asTrimmed(patch.name) : undefined,
      displayOrder: patch.displayOrder != null ? Number(patch.displayOrder) : undefined,
    };
    if (patch.levelId !== undefined) {
      storePatch.levelId = patch.levelId || null;
      storePatch.levelIdProvided = true;
    }
    const saved = await scopedStore.updateStream(streamId, storePatch);
    if (!saved) {
      throw createEducationReferenceError(404, "Filière introuvable ou archivée.", EDUCATION_REFERENCE_ERROR.STREAM_NOT_FOUND);
    }
    await writeEducationAudit(scope, principal, auditMeta, {
      action: "update_education_stream",
      entityType: "education_stream",
      entityId: streamId,
      oldValue: existing,
      newValue: saved,
    });
    return saved;
  });
}

async function archiveStream(repo, streamId, principal, auditMeta) {
  const store = eduStore(repo);
  const existing = await store.getStreamById(streamId);
  if (!existing) {
    throw createEducationReferenceError(404, "Filière introuvable.", EDUCATION_REFERENCE_ERROR.STREAM_NOT_FOUND);
  }
  assertEducationReferenceCatalogWrite(principal, existing.countryCode, "update");
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = eduStore(scope);
    const saved = await scopedStore.archiveStream(streamId);
    if (!saved) {
      throw createEducationReferenceError(404, "Filière introuvable ou déjà archivée.", EDUCATION_REFERENCE_ERROR.STREAM_NOT_FOUND);
    }
    await writeEducationAudit(scope, principal, auditMeta, {
      action: "archive_education_stream",
      entityType: "education_stream",
      entityId: streamId,
      oldValue: existing,
      newValue: saved,
    });
    return saved;
  });
}

async function saveSchoolActivation(repo, schoolCode, activation, principal, auditMeta) {
  assertSchoolActivationWrite(principal);
  const normalizedSchool = asTrimmed(schoolCode).toUpperCase();
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = eduStore(scope);
    const before = await scopedStore.getSchoolCatalog(normalizedSchool);
    const saved = await scopedStore.replaceSchoolActivation(normalizedSchool, activation);
    await writeEducationAudit(scope, principal, auditMeta, {
      schoolCode: normalizedSchool,
      action: "save_school_education_activation",
      entityType: "school_education_reference",
      entityId: normalizedSchool,
      oldValue: before,
      newValue: saved,
    });
    return saved;
  });
}

async function updateCountryPedagogicalLabels(repo, rawPayload, principal, auditMeta) {
  const countryCode = resolveCatalogWriteCountryCode(rawPayload, principal);
  assertEducationReferenceCatalogWrite(principal, countryCode, "update");
  const payload = ignoreClientScope(rawPayload);
  const labels = {
    levelLabel: requirePedagogicalLabel(payload.levelLabel, "levelLabel"),
    trackLabel: requirePedagogicalLabel(payload.trackLabel, "trackLabel"),
    groupLabel: requirePedagogicalLabel(payload.groupLabel, "groupLabel"),
  };
  const store = eduStore(repo);
  const country = await resolveCountry(store, countryCode);
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = eduStore(scope);
    const before = pedagogicalLabelsFromCountryRow(country);
    const savedCountry = await scopedStore.updateCountryPedagogicalLabels(countryCode, labels);
    const saved = {
      countryCode,
      ...pedagogicalLabelsFromCountryRow(savedCountry),
    };
    await writeEducationAudit(scope, principal, auditMeta, {
      action: "update_country_pedagogical_labels",
      entityType: "country_pedagogical_labels",
      entityId: countryCode,
      oldValue: before,
      newValue: saved,
    });
    return saved;
  });
}

async function ensureEducationReferenceConstraints(repo, logger = console) {
  const store = eduStore(repo);
  const ambiguous = await store.inventoryLegacyAcademicReferencePayloads();
  const logInfo = typeof logger.info === "function" ? logger.info.bind(logger) : console.log;
  const logError = typeof logger.error === "function" ? logger.error.bind(logger) : console.error;
  logInfo(`[education-reference] inventaire legacy JSON levels/tracks : ${ambiguous.length} établissement(s)`);
  if (ambiguous.length > 0) {
    const details = ambiguous
      .slice(0, 5)
      .map((row) => `${row.schoolCode}(levels=${row.levelsCount},tracks=${row.tracksCount})`)
      .join("; ");
    const message =
      `Référentiel pédagogique : ${ambiguous.length} établissement(s) ont encore levels/tracks dans school_academic_configs. ` +
      `Résolution explicite requise avant bascule canonique. Aucune migration automatique.` +
      (details ? ` Exemples: ${details}` : "");
    logError(`[education-reference] ${message}`);
    const error = new Error(message);
    error.name = "EducationReferenceConstraintsError";
    error.code = EDUCATION_REFERENCE_ERROR.LEGACY_ACADEMIC_REFERENCE_AMBIGUOUS;
    error.inventory = { ambiguousSchools: ambiguous.length };
    throw error;
  }
}

async function stripLegacyAcademicReferencePayloads(repo) {
  const { STRIP_LEGACY_ACADEMIC_REFERENCE_SQL } = require("../db/educationReferenceSchema");
  await repo.query(STRIP_LEGACY_ACADEMIC_REFERENCE_SQL);
}

module.exports = {
  createLevel,
  updateLevel,
  archiveLevel,
  createStream,
  updateStream,
  archiveStream,
  saveSchoolActivation,
  updateCountryPedagogicalLabels,
  ensureEducationReferenceConstraints,
  stripLegacyAcademicReferencePayloads,
};
