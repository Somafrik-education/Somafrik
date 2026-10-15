"use strict";

/**
 * CARTE-PR1 — appel collectif par carte (NFC / QR).
 *
 * Scan brouillon : aucune écriture ; la réponse ne contient qu'un reçu opaque
 * (AES-256-GCM, donc chiffré ET authentifié) et une clé de déduplication HMAC
 * propre à la session d'appel. Ni identité, ni jeton de carte, ni identifiant interne.
 *
 * Validation : revalide chaque reçu (intégrité, expiration, contexte), puis l'état
 * courant des cartes en base et l'inscription / l'affectation via upsertAttendance,
 * dans la transaction unique de withIdempotency (Idempotency-Key = sessionId).
 * Toute anomalie refuse le lot entier : aucune validation partielle.
 */

const crypto = require("node:crypto");
const { createHttpError } = require("./classesManagement");
const { scanStudentCard, assertStudentCardMasterEnabled } = require("./studentAccessCardsManagement");
const { assertStudentCardAttendanceEnabled } = require("./studentCardAttendance");

const ROLL_CALL_ERROR = Object.freeze({
  INPUT_INVALID: "ROLL_CALL_INPUT_INVALID",
  CLASS_FORBIDDEN: "ROLL_CALL_CLASS_FORBIDDEN",
  CLASS_MISMATCH: "ROLL_CALL_CLASS_MISMATCH",
  RECEIPT_INVALID: "ROLL_CALL_RECEIPT_INVALID",
  RECEIPT_EXPIRED: "ROLL_CALL_RECEIPT_EXPIRED",
  CONTEXT_MISMATCH: "ROLL_CALL_CONTEXT_MISMATCH",
  CARD_INVALID: "ROLL_CALL_CARD_INVALID",
  OPERATION_KEY_REQUIRED: "ROLL_CALL_OPERATION_KEY_REQUIRED",
});

const RECEIPT_VERSION = "rc1";
const RECEIPT_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_RECEIPTS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function inputError(message) {
  return createHttpError(400, message, ROLL_CALL_ERROR.INPUT_INVALID);
}

function deriveRollCallKeys(secret) {
  const master = String(secret ?? "");
  if (master.length < 16) throw new Error("Secret serveur insuffisant pour l'appel collectif.");
  const derive = (label) => Buffer.from(crypto.hkdfSync("sha256", master, "somafrik", label, 32));
  return Object.freeze({
    receipt: derive("student-card-roll-call:receipt:v1"),
    dedup: derive("student-card-roll-call:dedup:v1"),
  });
}

function sealReceipt(keys, claims) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keys.receipt, iv);
  cipher.setAAD(Buffer.from(RECEIPT_VERSION));
  const body = Buffer.concat([cipher.update(JSON.stringify(claims), "utf8"), cipher.final()]);
  return `${RECEIPT_VERSION}.${Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url")}`;
}

function openReceipt(keys, receipt) {
  const value = typeof receipt === "string" ? receipt : "";
  const [version, payload, extra] = value.split(".");
  if (version !== RECEIPT_VERSION || !payload || extra !== undefined || !BASE64URL.test(payload) || payload.length > 1024) {
    return null;
  }
  const raw = Buffer.from(payload, "base64url");
  if (raw.length < 12 + 16 + 2) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", keys.receipt, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(RECEIPT_VERSION));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
    const claims = JSON.parse(plain.toString("utf8"));
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
}

/** Même élève dans la même session → même clé ; d'une session à l'autre, clés non corrélables. */
function dedupKeyFor(keys, sessionId, studentId) {
  return crypto.createHmac("sha256", keys.dedup).update(`${sessionId}|${studentId}`).digest("base64url").slice(0, 32);
}

function readContext(payload) {
  const sessionId = String(payload?.sessionId ?? "").trim();
  const classId = String(payload?.classId ?? "").trim();
  const date = String(payload?.date ?? "").trim();
  if (!UUID.test(sessionId)) throw inputError("Session d'appel invalide.");
  if (!UUID.test(classId)) throw inputError("Classe invalide.");
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw inputError("Date d'appel invalide.");
  }
  return { sessionId: sessionId.toLowerCase(), classId: classId.toLowerCase(), date };
}

function principalUserId(principal) {
  return String(principal?.sub ?? principal?.id ?? "").trim();
}

async function assertRollCallClass(repo, scope, principal, classId) {
  const row = await repo.one(
    "SELECT id FROM classes WHERE id = $1::uuid AND school_id = $2::uuid LIMIT 1",
    [classId, scope.schoolId],
  );
  const allowed = row?.id
    && typeof repo.teacherHasActiveAssignmentForClassId === "function"
    && await repo.teacherHasActiveAssignmentForClassId(principal, classId, scope.schoolId);
  if (!allowed) {
    throw createHttpError(403, "Accès refusé: classe hors de votre périmètre d'appel.", ROLL_CALL_ERROR.CLASS_FORBIDDEN);
  }
}

async function assertRollCallEnabled(repo, schoolId) {
  await assertStudentCardMasterEnabled(repo, schoolId);
  await assertStudentCardAttendanceEnabled(repo, schoolId);
}

async function scanRollCallDraft(repo, payload, scope, principal, keys, now = Date.now()) {
  const context = readContext(payload);
  const userId = principalUserId(principal);
  if (!userId) throw createHttpError(401, "Session invalide.");
  await assertRollCallEnabled(repo, scope.schoolId);
  await assertRollCallClass(repo, scope, principal, context.classId);
  // Mêmes refus que le pointage individuel : inconnue, remplacée, perdue, révoquée, non encodée.
  const resolved = await scanStudentCard(repo, { cardToken: payload?.cardToken }, scope);
  if (String(resolved.class?.id ?? "").toLowerCase() !== context.classId) {
    throw createHttpError(409, "Cette carte n'appartient pas à la classe de l'appel.", ROLL_CALL_ERROR.CLASS_MISMATCH);
  }
  const expiresAt = now + RECEIPT_TTL_MS;
  const receipt = sealReceipt(keys, {
    sch: scope.schoolId,
    cls: context.classId,
    dt: context.date,
    usr: userId,
    ses: context.sessionId,
    crd: resolved.card.id,
    stu: resolved.student.id,
    exp: expiresAt,
  });
  return {
    status: "accepted",
    receipt,
    dedupKey: dedupKeyFor(keys, context.sessionId, resolved.student.id),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function readReceipts(payload, keys, context, scope, userId, now) {
  const receipts = payload?.receipts;
  if (!Array.isArray(receipts) || receipts.length === 0) throw inputError("Aucun scan à valider.");
  if (receipts.length > MAX_RECEIPTS) throw inputError("Trop de scans pour un seul appel.");
  const byStudent = new Map();
  for (const [index, receipt] of receipts.entries()) {
    const claims = openReceipt(keys, receipt);
    if (!claims || !UUID.test(String(claims.crd ?? "")) || !UUID.test(String(claims.stu ?? ""))
      || !Number.isFinite(claims.exp)) {
      throw createHttpError(400, "Reçu de scan invalide.", ROLL_CALL_ERROR.RECEIPT_INVALID);
    }
    if (claims.exp <= now) {
      throw createHttpError(409, "Reçu de scan expiré : recommencez l'appel.", ROLL_CALL_ERROR.RECEIPT_EXPIRED);
    }
    if (claims.sch !== scope.schoolId || claims.cls !== context.classId || claims.dt !== context.date
      || claims.usr !== userId || claims.ses !== context.sessionId) {
      throw createHttpError(409, "Reçu de scan hors du contexte de cet appel.", ROLL_CALL_ERROR.CONTEXT_MISMATCH);
    }
    const entry = byStudent.get(claims.stu) ?? { studentId: claims.stu, cardId: claims.crd, indexes: [] };
    entry.indexes.push(index);
    byStudent.set(claims.stu, entry);
  }
  return { entries: [...byStudent.values()], total: receipts.length };
}

async function assertCardsStillValid(repo, schoolId, entries) {
  // FOR SHARE : une révocation concurrente attend la fin de la validation (même transaction).
  const rows = await repo.all(
    `SELECT id, student_id, status, nfc_encoding_state
       FROM student_access_cards
      WHERE school_id = $1::uuid AND id = ANY($2::uuid[])
      FOR SHARE`,
    [schoolId, entries.map((entry) => entry.cardId)],
  );
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const invalid = entries.filter((entry) => {
    const row = byId.get(entry.cardId);
    return !row || row.status !== "active" || row.nfc_encoding_state === "pending" || String(row.student_id) !== entry.studentId;
  });
  if (invalid.length > 0) {
    const error = createHttpError(
      409,
      `${invalid.length} carte(s) ne sont plus valides : appel non enregistré. Retirez-les et validez à nouveau.`,
      ROLL_CALL_ERROR.CARD_INVALID,
    );
    // Positions dans le lot envoyé uniquement : le Mobile retire ces scans sans connaître l'élève.
    error.details = { invalidReceiptIndexes: invalid.flatMap((entry) => entry.indexes).sort((a, b) => a - b) };
    throw error;
  }
}

function assertOperationKey(idempotencyKey, sessionId) {
  if (String(idempotencyKey ?? "").trim().toLowerCase() !== sessionId) {
    throw createHttpError(
      400,
      "Identifiant d'opération requis : Idempotency-Key doit être la session d'appel.",
      ROLL_CALL_ERROR.OPERATION_KEY_REQUIRED,
    );
  }
}

async function validateRollCall(repo, payload, scope, principal, keys, auditMeta, now = Date.now()) {
  const context = readContext(payload);
  const userId = principalUserId(principal);
  if (!userId) throw createHttpError(401, "Session invalide.");
  const { entries, total } = readReceipts(payload, keys, context, scope, userId, now);
  await assertRollCallEnabled(repo, scope.schoolId);
  await assertRollCallClass(repo, scope, principal, context.classId);
  await assertCardsStillValid(repo, scope.schoolId, entries);
  const teacherId = typeof payload?.teacherId === "string" ? payload.teacherId.trim() : "";
  const items = entries.map((entry) => ({
    studentId: entry.studentId,
    classId: context.classId,
    date: context.date,
    status: "present",
    ...(teacherId ? { teacherId } : {}),
  }));
  // upsertAttendance revérifie établissement, inscription dans la classe, affectation
  // enseignant et auteur ; ON CONFLICT (school, student, date) : aucun doublon.
  const saved = await repo.upsertSchoolAttendanceBatch({ items }, principal, auditMeta);
  return {
    statusCode: 201,
    body: {
      recorded: Array.isArray(saved) ? saved.length : items.length,
      duplicatesIgnored: total - entries.length,
      classId: context.classId,
      date: context.date,
    },
  };
}

module.exports = {
  ROLL_CALL_ERROR,
  RECEIPT_TTL_MS,
  MAX_RECEIPTS,
  deriveRollCallKeys,
  sealReceipt,
  openReceipt,
  dedupKeyFor,
  readContext,
  assertOperationKey,
  scanRollCallDraft,
  validateRollCall,
};
