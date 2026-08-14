"use strict";

const {
  EVALUATION_TYPES_ERROR,
  asTrimmed,
  normalizeCode,
  createEvaluationTypesError,
  assertEvaluationTypesWrite,
  ignoreClientScope,
} = require("./evaluationTypesManagement");
const { createEvaluationTypesPgStore } = require("../db/evaluationTypesPgStore");

function evalStore(repo) {
  if (typeof repo.getEvaluationTypesStore === "function") {
    return repo.getEvaluationTypesStore();
  }
  return createEvaluationTypesPgStore(repo);
}

async function writeEvaluationTypesAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordAudit !== "function") {
    throw createEvaluationTypesError(500, "Audit indisponible dans la transaction.");
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
    throw createEvaluationTypesError(400, "Établissement requis.", EVALUATION_TYPES_ERROR.FORBIDDEN);
  }
  return code;
}

async function createEvaluationType(repo, rawPayload, principal, auditMeta, schoolCode) {
  assertEvaluationTypesWrite(principal);
  const payload = ignoreClientScope(rawPayload);
  const name = asTrimmed(payload.name);
  const code = normalizeCode(payload.code || name);
  if (!name || !code) {
    throw createEvaluationTypesError(400, "Nom et code de type d'évaluation obligatoires.");
  }
  const scopedSchool = resolveSchoolCodeFromPrincipal(principal, schoolCode);
  const store = evalStore(repo);
  const school = await store.requireSchoolByCode(scopedSchool);
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = evalStore(scope);
    try {
      const saved = await scopedStore.insertType({
        schoolId: school.id,
        code,
        name,
        displayOrder: Number(payload.displayOrder ?? 0),
      });
      await writeEvaluationTypesAudit(scope, principal, auditMeta, {
        schoolCode: scopedSchool,
        action: "create_evaluation_type",
        entityType: "evaluation_type",
        entityId: saved.id,
        newValue: saved,
      });
      return saved;
    } catch (error) {
      if (error?.code === "23505") {
        throw createEvaluationTypesError(409, "Type d'évaluation déjà existant pour cet établissement.", EVALUATION_TYPES_ERROR.DUPLICATE);
      }
      throw error;
    }
  });
}

async function updateEvaluationType(repo, typeId, rawPatch, principal, auditMeta, schoolCode) {
  assertEvaluationTypesWrite(principal);
  const patch = ignoreClientScope(rawPatch);
  const scopedSchool = resolveSchoolCodeFromPrincipal(principal, schoolCode);
  const store = evalStore(repo);
  const existing = await store.getById(typeId);
  if (!existing || asTrimmed(existing.schoolCode).toUpperCase() !== scopedSchool) {
    throw createEvaluationTypesError(404, "Type d'évaluation introuvable.", EVALUATION_TYPES_ERROR.TYPE_NOT_FOUND);
  }
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = evalStore(scope);
    try {
      const saved = await scopedStore.updateType(typeId, {
        name: patch.name ? asTrimmed(patch.name) : undefined,
        displayOrder: patch.displayOrder != null ? Number(patch.displayOrder) : undefined,
      });
      if (!saved) {
        throw createEvaluationTypesError(404, "Type d'évaluation introuvable ou archivé.", EVALUATION_TYPES_ERROR.TYPE_NOT_FOUND);
      }
      await writeEvaluationTypesAudit(scope, principal, auditMeta, {
        schoolCode: scopedSchool,
        action: "update_evaluation_type",
        entityType: "evaluation_type",
        entityId: typeId,
        oldValue: existing,
        newValue: saved,
      });
      return saved;
    } catch (error) {
      if (error?.code === "23505") {
        throw createEvaluationTypesError(409, "Type d'évaluation déjà existant pour cet établissement.", EVALUATION_TYPES_ERROR.DUPLICATE);
      }
      throw error;
    }
  });
}

async function archiveEvaluationType(repo, typeId, principal, auditMeta, schoolCode) {
  assertEvaluationTypesWrite(principal);
  const scopedSchool = resolveSchoolCodeFromPrincipal(principal, schoolCode);
  const store = evalStore(repo);
  const existing = await store.getById(typeId);
  if (!existing || asTrimmed(existing.schoolCode).toUpperCase() !== scopedSchool) {
    throw createEvaluationTypesError(404, "Type d'évaluation introuvable.", EVALUATION_TYPES_ERROR.TYPE_NOT_FOUND);
  }
  return repo.withTransaction(async (tx) => {
    const scope = repo.createTxScope(tx);
    const scopedStore = evalStore(scope);
    const saved = await scopedStore.archiveType(typeId);
    if (!saved) {
      throw createEvaluationTypesError(404, "Type d'évaluation introuvable ou déjà archivé.", EVALUATION_TYPES_ERROR.TYPE_NOT_FOUND);
    }
    await writeEvaluationTypesAudit(scope, principal, auditMeta, {
      schoolCode: scopedSchool,
      action: "archive_evaluation_type",
      entityType: "evaluation_type",
      entityId: typeId,
      oldValue: existing,
      newValue: saved,
    });
    return saved;
  });
}

async function assertEvaluationTypeUsable(repo, schoolCodeOrId, lookup, { allowArchived = false } = {}) {
  const store = evalStore(repo);
  let schoolId = schoolCodeOrId;
  let schoolCode = "";
  const asId = asTrimmed(schoolCodeOrId);
  if (!/^[0-9a-f-]{36}$/i.test(asId)) {
    const school = await store.requireSchoolByCode(asId);
    schoolId = school.id;
    schoolCode = school.school_code;
  }
  const found = await store.findUsableType(schoolId, lookup ?? {});
  if (!found) {
    throw createEvaluationTypesError(404, "Type d'évaluation introuvable.", EVALUATION_TYPES_ERROR.TYPE_NOT_FOUND);
  }
  if (schoolCode && found.schoolCode && found.schoolCode !== schoolCode) {
    throw createEvaluationTypesError(404, "Type d'évaluation introuvable.", EVALUATION_TYPES_ERROR.TYPE_NOT_FOUND);
  }
  if (!allowArchived && found.status !== "active") {
    throw createEvaluationTypesError(409, "Type d'évaluation archivé.", EVALUATION_TYPES_ERROR.TYPE_ARCHIVED);
  }
  return found;
}

async function resolveEvaluationTypeForWrite(repo, schoolId, payload, { required = true } = {}) {
  const typeId = asTrimmed(payload?.evaluationTypeId ?? payload?.evaluation_type_id);
  const label = asTrimmed(
    payload?.evaluationType ?? payload?.type ?? payload?.evaluation_type ?? payload?.evaluationTypeCode,
  );
  if (!typeId && !label) {
    if (required) {
      throw createEvaluationTypesError(400, "Type d'évaluation canonique obligatoire (evaluationTypeId).");
    }
    return null;
  }
  return assertEvaluationTypeUsable(repo, schoolId, {
    id: typeId || undefined,
    code: label || undefined,
    name: label || undefined,
  });
}

async function ensureEvaluationTypesConstraints(repo, logger = console) {
  const store = evalStore(repo);
  const { inventory, ambiguous } = await store.inventoryLegacyEvaluationTypesPayloads();
  const logInfo = typeof logger.info === "function" ? logger.info.bind(logger) : console.log;
  const logError = typeof logger.error === "function" ? logger.error.bind(logger) : console.error;
  logInfo(`[evaluation-types] inventaire legacy JSON evaluationTypes : ${inventory.length} établissement(s), ${ambiguous.length} ambigu(s)`);
  if (ambiguous.length > 0) {
    const details = ambiguous
      .slice(0, 5)
      .map((row) => `${row.schoolCode}(types=${row.typesCount}:${(row.typesSample ?? []).join(",")})`)
      .join("; ");
    const message =
      `Types d'évaluation : ${ambiguous.length} établissement(s) ont un catalogue JSON evaluationTypes non trivialement équivalent. ` +
      `Aucune correspondance automatique. Résolution explicite requise avant bascule canonique.` +
      (details ? ` Exemples: ${details}` : "");
    logError(`[evaluation-types] ${message}`);
    const error = new Error(message);
    error.name = "EvaluationTypesConstraintsError";
    error.code = EVALUATION_TYPES_ERROR.LEGACY_EVALUATION_TYPES_AMBIGUOUS;
    error.inventory = { ambiguousSchools: ambiguous.length, inventoryCount: inventory.length };
    throw error;
  }
}

async function stripLegacyEvaluationTypesPayloads(repo) {
  const { STRIP_LEGACY_EVALUATION_TYPES_SQL } = require("../db/evaluationTypesSchema");
  await repo.query(STRIP_LEGACY_EVALUATION_TYPES_SQL);
}

async function ensureEvaluationTypesBootstrap(repo) {
  const store = evalStore(repo);
  await store.bootstrapCanonicalTypesForAllSchools();
}

module.exports = {
  createEvaluationType,
  updateEvaluationType,
  archiveEvaluationType,
  assertEvaluationTypeUsable,
  resolveEvaluationTypeForWrite,
  ensureEvaluationTypesConstraints,
  stripLegacyEvaluationTypesPayloads,
  ensureEvaluationTypesBootstrap,
};
