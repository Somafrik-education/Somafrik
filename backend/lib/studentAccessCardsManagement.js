"use strict";

const crypto = require("node:crypto");
const { createHttpError } = require("./classesManagement");
const { isStudentCardMasterEnabled, mapSettingsRow } = require("./schoolSettingsManagement");
const { createSchoolSettingsPgStore } = require("../db/schoolSettingsPgStore");
const { createStudentAccessCardsPgStore } = require("../db/studentAccessCardsPgStore");

const STUDENT_CARD_ERROR = Object.freeze({
  DISABLED: "STUDENT_CARD_DISABLED",
  NOT_FOUND: "STUDENT_CARD_NOT_FOUND",
  STUDENT_NOT_FOUND: "STUDENT_CARD_STUDENT_NOT_FOUND",
  ACTIVE_ALREADY_EXISTS: "STUDENT_CARD_ACTIVE_ALREADY_EXISTS",
  INVALID_MEDIUM: "STUDENT_CARD_INVALID_MEDIUM",
  INVALID_STATE: "STUDENT_CARD_INVALID_STATE",
  TENANT_DENIED: "STUDENT_CARD_TENANT_DENIED",
});

const STUDENT_CARD_MEDIA = Object.freeze(["nfc", "qr", "nfc_qr"]);
const STUDENT_CARD_AUDIT = Object.freeze({
  ISSUED: "student_card_issued",
  LOST: "student_card_lost",
  REVOKED: "student_card_revoked",
  REPLACED: "student_card_replaced",
});

const SECRET_BYTES = 32;
const PUBLIC_ID_BYTES = 16;
const PUBLIC_ID_RETRY_LIMIT = 8;
const FORBIDDEN_AUDIT_KEYS = Object.freeze(["secret", "cardToken", "token_hash", "tokenHash"]);

function studentCardError(statusCode, message, code) {
  return createHttpError(statusCode, message, code);
}

function disabledError() {
  return studentCardError(404, "Fonctionnalité carte élève désactivée.", STUDENT_CARD_ERROR.DISABLED);
}

function notFoundError() {
  return studentCardError(404, "Carte introuvable.", STUDENT_CARD_ERROR.NOT_FOUND);
}

function studentNotFoundError() {
  return studentCardError(404, "Élève introuvable.", STUDENT_CARD_ERROR.STUDENT_NOT_FOUND);
}

function randomTokenPart(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function generateCardSecrets() {
  const publicId = randomTokenPart(PUBLIC_ID_BYTES);
  const secret = randomTokenPart(SECRET_BYTES);
  const tokenHash = crypto.createHash("sha256").update(secret, "utf8").digest("hex");
  return {
    publicId,
    secret,
    tokenHash,
    cardToken: `${publicId}.${secret}`,
    secretBits: SECRET_BYTES * 8,
  };
}

function assertSecretEntropy(generated) {
  if (!generated || generated.secretBits < 128) {
    throw studentCardError(500, "Entropie du secret carte insuffisante.");
  }
  if (!/^[0-9a-f]{64}$/.test(generated.tokenHash)) {
    throw studentCardError(500, "Hash de capability invalide.");
  }
}

function normalizeMedium(value) {
  const medium = String(value ?? "").trim().toLowerCase();
  if (!STUDENT_CARD_MEDIA.includes(medium)) {
    throw studentCardError(400, "Support carte invalide.", STUDENT_CARD_ERROR.INVALID_MEDIUM);
  }
  return medium;
}

function asId(value) {
  return String(value ?? "").trim();
}

function mapCardListItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.public_id,
    medium: row.medium,
    status: row.status,
    issuedAt: row.issued_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    replacedByCardId: row.replaced_by_card_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIssuedCard(row, cardToken) {
  return {
    id: row.id,
    publicId: row.public_id,
    cardToken,
    medium: row.medium,
    status: row.status,
    issuedAt: row.issued_at,
  };
}

function assertNoSecretLeak(value, label = "payload") {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  for (const key of FORBIDDEN_AUDIT_KEYS) {
    if (new RegExp(`"${key}"\\s*:`, "i").test(text) || text.includes(`"${key}"`)) {
      throw new Error(`${label}: secret/hash/token interdit (${key})`);
    }
  }
  if (/\bcardToken\b/.test(text) && /"cardToken"\s*:/.test(text) && label.includes("audit")) {
    throw new Error(`${label}: cardToken interdit`);
  }
}

function sanitizeAuditValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value ?? null;
  const next = { ...value };
  for (const key of FORBIDDEN_AUDIT_KEYS) {
    delete next[key];
  }
  delete next.cardToken;
  delete next.secret;
  delete next.tokenHash;
  delete next.token_hash;
  return next;
}

function cardsStore(repo) {
  if (typeof repo.getStudentAccessCardsStore === "function") {
    return repo.getStudentAccessCardsStore();
  }
  return createStudentAccessCardsPgStore(repo);
}

function settingsStore(repo) {
  if (typeof repo.getSchoolSettingsStore === "function") {
    return repo.getSchoolSettingsStore();
  }
  return createSchoolSettingsPgStore(repo);
}

async function assertStudentCardMasterEnabled(repo, schoolId) {
  const store = settingsStore(repo);
  const row = typeof store.getSettings === "function" ? await store.getSettings(schoolId) : null;
  const mapped = mapSettingsRow(row);
  if (!isStudentCardMasterEnabled(mapped)) {
    throw disabledError();
  }
}

async function writeCardAudit(repo, principal, auditMeta, entry) {
  if (typeof repo.recordAudit !== "function") return;
  const newValue = sanitizeAuditValue(entry.newValue);
  const oldValue = sanitizeAuditValue(entry.oldValue);
  assertNoSecretLeak(newValue, "audit.newValue");
  assertNoSecretLeak(oldValue, "audit.oldValue");
  await repo.recordAudit(
    {
      schoolCode: entry.schoolCode || principal?.enrollmentLoginCode || principal?.schoolCode,
      userId: principal?.sub || principal?.id,
      action: entry.action,
      entityType: "student_access_card",
      entityId: String(entry.entityId ?? ""),
      oldValue,
      newValue,
      ipAddress: auditMeta?.ipAddress,
      userAgent: auditMeta?.userAgent,
    },
    typeof repo.query === "function" ? repo : null,
  );
}

async function requireStudentInSchool(store, schoolId, studentRef) {
  const student = await store.findStudentInSchool(schoolId, studentRef);
  if (!student) {
    throw studentNotFoundError();
  }
  return student;
}

async function requireCardInSchool(store, schoolId, cardId) {
  const card = await store.getById(schoolId, cardId);
  if (!card) {
    throw notFoundError();
  }
  return card;
}

async function insertWithPublicIdRetry(store, row) {
  let lastError = null;
  for (let attempt = 0; attempt < PUBLIC_ID_RETRY_LIMIT; attempt += 1) {
    const generated = generateCardSecrets();
    assertSecretEntropy(generated);
    try {
      const created = await store.insert({
        ...row,
        public_id: generated.publicId,
        token_hash: generated.tokenHash,
      });
      return { created, generated };
    } catch (error) {
      lastError = error;
      if (error?.code === "23505" && /(public_id|token_hash)/i.test(String(error.constraint || error.message))) {
        continue;
      }
      throw error;
    }
  }
  throw lastError || studentCardError(500, "Impossible de générer un public_id unique.");
}

function mapUniqueActiveError(error) {
  if (error?.code === "23505" && /one_active_per_student|active/i.test(String(error.constraint || error.message))) {
    return studentCardError(
      409,
      "Une carte active existe déjà pour cet élève.",
      STUDENT_CARD_ERROR.ACTIVE_ALREADY_EXISTS,
    );
  }
  return error;
}

async function issueStudentCard(repo, payload, principal, auditMeta, schoolScope) {
  const schoolId = asId(schoolScope.schoolId);
  if (!schoolId) {
    throw studentCardError(403, "Accès refusé: établissement hors périmètre.", STUDENT_CARD_ERROR.TENANT_DENIED);
  }
  await assertStudentCardMasterEnabled(repo, schoolId);
  const medium = normalizeMedium(payload?.medium);
  const store = cardsStore(repo);
  const student = await requireStudentInSchool(store, schoolId, payload?.studentId);
  const existingActive = await store.findActive(schoolId, student.id);
  if (existingActive) {
    throw studentCardError(
      409,
      "Une carte active existe déjà pour cet élève.",
      STUDENT_CARD_ERROR.ACTIVE_ALREADY_EXISTS,
    );
  }
  let inserted;
  try {
    inserted = await insertWithPublicIdRetry(store, {
      school_id: schoolId,
      student_id: student.id,
      medium,
      status: "active",
      created_by_user_id: asId(principal?.sub) || null,
    });
  } catch (error) {
    throw mapUniqueActiveError(error);
  }
  await writeCardAudit(repo, principal, auditMeta, {
    action: STUDENT_CARD_AUDIT.ISSUED,
    entityId: inserted.created.id,
    schoolCode: schoolScope.loginCode,
    newValue: {
      cardId: inserted.created.id,
      studentId: student.id,
      schoolId,
      status: "active",
      medium,
      actorUserId: principal?.sub || null,
    },
  });
  return mapIssuedCard(inserted.created, inserted.generated.cardToken);
}

async function listStudentCards(repo, studentRef, schoolScope) {
  const schoolId = asId(schoolScope.schoolId);
  if (!schoolId) {
    throw studentCardError(403, "Accès refusé: établissement hors périmètre.", STUDENT_CARD_ERROR.TENANT_DENIED);
  }
  await assertStudentCardMasterEnabled(repo, schoolId);
  const store = cardsStore(repo);
  const student = await requireStudentInSchool(store, schoolId, studentRef);
  const rows = await store.listByStudent(schoolId, student.id);
  return rows.map(mapCardListItem);
}

async function markStudentCardLost(repo, cardId, principal, auditMeta, schoolScope, reason) {
  const schoolId = asId(schoolScope.schoolId);
  if (!schoolId) {
    throw studentCardError(403, "Accès refusé: établissement hors périmètre.", STUDENT_CARD_ERROR.TENANT_DENIED);
  }
  await assertStudentCardMasterEnabled(repo, schoolId);
  const store = cardsStore(repo);
  const card = await requireCardInSchool(store, schoolId, cardId);
  if (card.status === "lost") {
    return mapCardListItem(card);
  }
  if (card.status !== "active") {
    throw studentCardError(409, "Transition lost impossible.", STUDENT_CARD_ERROR.INVALID_STATE);
  }
  const updated = await store.markLost(schoolId, cardId, reason || "lost");
  if (!updated) {
    const latest = await store.getById(schoolId, cardId);
    if (latest?.status === "lost") {
      return mapCardListItem(latest);
    }
    throw studentCardError(409, "Transition lost impossible.", STUDENT_CARD_ERROR.INVALID_STATE);
  }
  await writeCardAudit(repo, principal, auditMeta, {
    action: STUDENT_CARD_AUDIT.LOST,
    entityId: cardId,
    schoolCode: schoolScope.loginCode,
    newValue: {
      cardId,
      studentId: card.student_id,
      schoolId,
      status: "lost",
      medium: card.medium,
      reason: reason || "lost",
      actorUserId: principal?.sub || null,
    },
  });
  return mapCardListItem(updated);
}

async function revokeStudentCard(repo, cardId, principal, auditMeta, schoolScope, reason) {
  const schoolId = asId(schoolScope.schoolId);
  if (!schoolId) {
    throw studentCardError(403, "Accès refusé: établissement hors périmètre.", STUDENT_CARD_ERROR.TENANT_DENIED);
  }
  await assertStudentCardMasterEnabled(repo, schoolId);
  const store = cardsStore(repo);
  const card = await requireCardInSchool(store, schoolId, cardId);
  if (card.status === "revoked") {
    return mapCardListItem(card);
  }
  if (card.status !== "active") {
    throw studentCardError(409, "Transition revoke impossible.", STUDENT_CARD_ERROR.INVALID_STATE);
  }
  const updated = await store.markRevoked(schoolId, cardId, reason || "revoked");
  if (!updated) {
    const latest = await store.getById(schoolId, cardId);
    if (latest?.status === "revoked") {
      return mapCardListItem(latest);
    }
    throw studentCardError(409, "Transition revoke impossible.", STUDENT_CARD_ERROR.INVALID_STATE);
  }
  await writeCardAudit(repo, principal, auditMeta, {
    action: STUDENT_CARD_AUDIT.REVOKED,
    entityId: cardId,
    schoolCode: schoolScope.loginCode,
    newValue: {
      cardId,
      studentId: card.student_id,
      schoolId,
      status: "revoked",
      medium: card.medium,
      reason: reason || "revoked",
      actorUserId: principal?.sub || null,
    },
  });
  return mapCardListItem(updated);
}

async function replaceStudentCard(repo, cardId, principal, auditMeta, schoolScope, options = {}) {
  const schoolId = asId(schoolScope.schoolId);
  if (!schoolId) {
    throw studentCardError(403, "Accès refusé: établissement hors périmètre.", STUDENT_CARD_ERROR.TENANT_DENIED);
  }
  await assertStudentCardMasterEnabled(repo, schoolId);
  const store = cardsStore(repo);
  const card = await requireCardInSchool(store, schoolId, cardId);
  if (card.status !== "active" && card.status !== "lost") {
    throw studentCardError(409, "Remplacement impossible dans cet état.", STUDENT_CARD_ERROR.INVALID_STATE);
  }
  let generated = generateCardSecrets();
  assertSecretEntropy(generated);
  let replaced;
  let lastError = null;
  for (let attempt = 0; attempt < PUBLIC_ID_RETRY_LIMIT; attempt += 1) {
    generated = generateCardSecrets();
    assertSecretEntropy(generated);
    try {
      replaced = await store.replaceAtomic({
        schoolId,
        oldCardId: cardId,
        newPublicId: generated.publicId,
        newTokenHash: generated.tokenHash,
        medium: card.medium,
        createdByUserId: asId(principal?.sub) || null,
        failAfterInsert: Boolean(options.failAfterInsert),
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (options.failAfterInsert) throw error;
      if (error?.code === "23505" && /(public_id|token_hash)/i.test(String(error.constraint || error.message))) {
        continue;
      }
      throw mapUniqueActiveError(error);
    }
  }
  if (!replaced) {
    throw lastError || studentCardError(500, "Impossible de générer un public_id unique.");
  }
  await writeCardAudit(repo, principal, auditMeta, {
    action: STUDENT_CARD_AUDIT.REPLACED,
    entityId: cardId,
    schoolCode: schoolScope.loginCode,
    newValue: {
      cardId,
      studentId: card.student_id,
      schoolId,
      status: "replaced",
      medium: card.medium,
      replacedByCardId: replaced.newCard.id,
      actorUserId: principal?.sub || null,
    },
  });
  return {
    previous: mapCardListItem(replaced.oldCard),
    card: mapIssuedCard(replaced.newCard, generated.cardToken),
  };
}

module.exports = {
  STUDENT_CARD_ERROR,
  STUDENT_CARD_MEDIA,
  STUDENT_CARD_AUDIT,
  SECRET_BYTES,
  generateCardSecrets,
  assertSecretEntropy,
  normalizeMedium,
  mapCardListItem,
  mapIssuedCard,
  sanitizeAuditValue,
  assertNoSecretLeak,
  FORBIDDEN_AUDIT_KEYS,
  issueStudentCard,
  listStudentCards,
  markStudentCardLost,
  revokeStudentCard,
  replaceStudentCard,
  assertStudentCardMasterEnabled,
};
