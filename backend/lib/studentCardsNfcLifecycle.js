"use strict";

const { createHttpError } = require("./classesManagement");
const { createStudentAccessCardsPgStore, isUuid } = require("../db/studentAccessCardsPgStore");
const { RbacService } = require("../services/rbacService");
const { normalizeNfcIdentity, assertNfcEnabled } = require("./studentCardsNfcEncoding");
const { assertStudentCardMasterEnabled, generateCardSecrets, mapIssuedCard, mapCardListItem } = require("./studentAccessCardsManagement");
const { parseCardToken, hashCardSecret, tokenHashesMatch } = require("./studentCardCapability");
const rbac = new RbacService();

function error(code, message, status = 409) { return createHttpError(status, message, code); }
function notFound() { return error("STUDENT_CARD_NOT_FOUND", "Carte introuvable.", 404); }
function expired() { return error("STUDENT_CARD_NFC_EXPIRED", "La réservation NFC a expiré. Elle ne peut pas être activée."); }
function operationId(value) {
  if (!isUuid(value)) throw error("STUDENT_CARD_NFC_OPERATION_REQUIRED", "Un identifiant d’opération NFC UUID est requis.", 400);
  return String(value).toLowerCase();
}
function authorize(principal, scope, route) {
  if (!scope?.schoolId || !rbac.canAccess(principal, route)) {
    throw error("STUDENT_CARD_TENANT_DENIED", "Accès à la programmation NFC refusé.", 403);
  }
  if (!principal.enrollmentSchoolId || principal.enrollmentSchoolId !== scope.schoolId) {
    throw error("STUDENT_CARD_TENANT_DENIED", "Établissement hors périmètre.", 403);
  }
}
function conflict(cause) {
  if (cause?.code !== "23505") return cause;
  if (String(cause.constraint).includes("nfc_uid")) return error("STUDENT_CARD_NFC_UID_EXISTS", "Cette carte physique est déjà affectée.");
  return error("STUDENT_CARD_NFC_CONFLICT", "Une opération concurrente existe déjà. Relisez les cartes de l’élève.");
}

async function transaction(repo, principal, meta, scope, callback, nfcGate = true) {
  // Never degrade to non-transactional writes or a best-effort audit.
  if (typeof repo.withTransaction !== "function" || typeof repo.recordAudit !== "function" || typeof repo.query !== "function") {
    throw error("STUDENT_CARD_NFC_POSTGRES_REQUIRED", "Une transaction PostgreSQL avec audit est requise.", 503);
  }
  let outcome;
  try {
    outcome = await repo.withTransaction(async (tx) => {
      const db = {
        query: (sql, params) => tx.query(sql, params),
        one: async (sql, params) => (await tx.query(sql, params)).rows[0] ?? null,
        all: async (sql, params) => (await tx.query(sql, params)).rows,
      };
      // Keep settings stable until commit, including confirmation/replay requests.
      const settings = await db.one("SELECT * FROM school_settings WHERE school_id = $1 FOR SHARE", [scope.schoolId]);
      db.getSchoolSettingsStore = () => ({ getSettings: async () => settings });
      if (nfcGate) await assertNfcEnabled(db, scope.schoolId);
      else await assertStudentCardMasterEnabled(db, scope.schoolId);
      const store = createStudentAccessCardsPgStore(db);
      const audit = (action, card, oldValue, newValue) => repo.recordAudit({
        schoolCode: scope.loginCode, userId: principal.sub || principal.id,
        action, entityType: "student_access_card", entityId: card.id,
        oldValue, newValue, ipAddress: meta?.ipAddress, userAgent: meta?.userAgent,
      }, tx);
      async function expire(studentId) {
        for (const card of await store.expirePendingNfc(scope.schoolId, studentId)) {
          await audit("student_card_nfc_reservation_expired", card, { status: "issued" }, { status: "revoked" });
        }
      }
      async function cardForUpdate(cardId) {
        const known = await store.getById(scope.schoolId, cardId);
        if (!known) throw notFound();
        if (!(await store.lockStudent(scope.schoolId, known.student_id))) throw notFound();
        const locked = await store.lockCard(scope.schoolId, cardId);
        if (!locked) throw notFound();
        return locked;
      }
      return callback({ db, store, audit, expire, cardForUpdate });
    });
  } catch (cause) { throw conflict(cause); }
  // Expiration is committed with its audit before returning the refusal.
  if (outcome?.error) throw outcome.error;
  return outcome;
}

function replay(card) { return { ...mapCardListItem(card), idempotentReplay: true, tokenAvailable: false }; }

async function reserveStudentCardNfc(repo, payload, principal, meta, scope, replacesCardId = null) {
  authorize(principal, scope, replacesCardId ? "POST /api/student-cards/:id/replace" : "POST /api/student-cards");
  const identity = normalizeNfcIdentity(payload?.nfc);
  const key = operationId(payload?.operationId);
  const medium = payload?.medium || "nfc";
  if (!["nfc", "nfc_qr"].includes(medium)) throw error("STUDENT_CARD_INVALID_MEDIUM", "Support NFC requis.", 400);
  return transaction(repo, principal, meta, scope, async ({ db, store, audit, expire, cardForUpdate }) => {
    const old = replacesCardId ? await cardForUpdate(replacesCardId) : null;
    const student = old ? await store.findStudentInSchool(scope.schoolId, old.student_id)
      : await store.findStudentInSchool(scope.schoolId, payload.studentId);
    if (!student) throw error("STUDENT_CARD_STUDENT_NOT_FOUND", "Élève introuvable.", 404);
    if (old && payload.studentId && payload.studentId !== student.id) throw error("STUDENT_CARD_NFC_MISMATCH", "Élève incorrect pour ce remplacement.");
    await store.lockStudent(scope.schoolId, student.id);
    await expire(student.id);
    const existing = await store.findNfcOperation(scope.schoolId, key);
    if (existing) {
      if (existing.student_id !== student.id || existing.nfc_uid !== identity.uid || existing.nfc_tag_type !== identity.tagType
        || existing.medium !== medium || existing.nfc_replaces_card_id !== replacesCardId
        || existing.created_by_user_id !== (principal.sub || principal.id)) {
        throw error("STUDENT_CARD_NFC_OPERATION_CONFLICT", "Cet identifiant d’opération est déjà utilisé avec un autre contexte.");
      }
      if (existing.revoke_reason === "nfc_reservation_expired") return { error: expired() };
      if (!["issued", "active"].includes(existing.status)) throw error("STUDENT_CARD_INVALID_STATE", "Réservation inactive.");
      return replay(existing);
    }
    if (old && !["active", "lost"].includes(old.status)) throw error("STUDENT_CARD_INVALID_STATE", "Remplacement impossible dans cet état.");
    const active = await store.findActive(scope.schoolId, student.id);
    if (active && (!old || active.id !== old.id)) throw error("STUDENT_CARD_ACTIVE_ALREADY_EXISTS", "Une carte active existe déjà pour cet élève.");
    if (await store.findPendingNfc(scope.schoolId, student.id)) throw error("STUDENT_CARD_NFC_RESERVATION_EXISTS", "Une réservation NFC est déjà en attente pour cet élève.");
    const timing = await db.one("SELECT clock_timestamp() AS issued_at");
    const expiresAt = new Date(new Date(timing.issued_at).getTime() + 30 * 60 * 1000);
    const generated = generateCardSecrets();
    const card = await store.insert({ school_id: scope.schoolId, student_id: student.id, medium, status: "issued",
      public_id: generated.publicId, token_hash: generated.tokenHash, created_by_user_id: principal.sub || principal.id,
      nfc_uid: identity.uid, nfc_tag_type: identity.tagType, nfc_encoding_state: "pending",
      nfc_operation_id: key, nfc_reservation_expires_at: expiresAt, nfc_replaces_card_id: replacesCardId,
      issued_at: timing.issued_at });
    await audit("student_card_nfc_reserved", card, null, { status: "issued", studentId: student.id, tagType: identity.tagType, operationId: key, replacesCardId });
    return { ...mapIssuedCard(card, generated.cardToken), tokenAvailable: true };
  });
}

async function confirmStudentCardNfc(repo, cardId, payload, principal, meta, scope) {
  authorize(principal, scope, "POST /api/student-cards/:id/nfc-confirm");
  const identity = normalizeNfcIdentity(payload);
  if (typeof payload.locked !== "boolean") throw error("STUDENT_CARD_NFC_INVALID", "Observation NFC invalide.", 400);
  const parsed = parseCardToken(payload.cardToken);
  return transaction(repo, principal, meta, scope, async ({ store, audit, expire, cardForUpdate }) => {
    const card = await cardForUpdate(cardId);
    if (card.public_id !== parsed.publicId || !tokenHashesMatch(hashCardSecret(parsed.secret), card.token_hash)) throw notFound();
    if (card.nfc_uid !== identity.uid || card.nfc_tag_type !== identity.tagType
      || (payload.studentId && payload.studentId !== card.student_id)) throw error("STUDENT_CARD_NFC_MISMATCH", "La carte ne correspond pas à cette affectation.");
    if (card.status === "revoked" && card.revoke_reason === "nfc_reservation_expired") return { error: expired() };
    if (card.status === "issued" && card.reservation_expired) { await expire(card.student_id); return { error: expired() }; }
    if (card.status === "active" && ["encoded", "locked"].includes(card.nfc_encoding_state)) {
      if (!payload.locked || card.nfc_encoding_state === "locked") return replay(card);
      // Preserve read-only observations of already encoded cards; no hardware command.
    } else if (card.status !== "issued" || card.nfc_encoding_state !== "pending") {
      throw error("STUDENT_CARD_INVALID_STATE", "Carte inactive ou réservation non disponible.");
    }
    let previous = null;
    if (card.status === "issued" && card.nfc_replaces_card_id) {
      previous = await store.lockCard(scope.schoolId, card.nfc_replaces_card_id);
      if (!previous || !["active", "lost"].includes(previous.status) || previous.student_id !== card.student_id) {
        throw error("STUDENT_CARD_INVALID_STATE", "La carte à remplacer a changé. Aucune bascule effectuée.");
      }
    }
    const active = await store.findActive(scope.schoolId, card.student_id);
    if (card.status === "issued" && active && active.id !== previous?.id) throw error("STUDENT_CARD_ACTIVE_ALREADY_EXISTS", "Une autre carte active existe déjà.");
    if (previous) {
      const replaced = await store.queryReplacementPrevious(scope.schoolId, previous.id, card.id);
      if (!replaced) throw error("STUDENT_CARD_INVALID_STATE", "La carte à remplacer a changé.");
      await audit("student_card_replaced", previous, { status: previous.status }, { status: "replaced", replacedByCardId: card.id });
    }
    const updated = await store.confirmNfc(scope.schoolId, card.id, identity.uid, identity.tagType, payload.locked, card.token_hash);
    if (!updated) throw error("STUDENT_CARD_INVALID_STATE", "Confirmation refusée. Relisez l’état de la carte.");
    await audit(payload.locked ? "student_card_nfc_locked" : "student_card_nfc_encoded", updated,
      { status: card.status, state: card.nfc_encoding_state }, { status: "active", state: updated.nfc_encoding_state, tagType: identity.tagType });
    return mapCardListItem(updated);
  });
}

async function retryStudentCardNfc(repo, cardId, payload, principal, meta, scope) {
  authorize(principal, scope, "POST /api/student-cards/:id/nfc-retry");
  const identity = normalizeNfcIdentity(payload); const key = operationId(payload.operationId);
  return transaction(repo, principal, meta, scope, async ({ store, audit, expire, cardForUpdate }) => {
    const card = await cardForUpdate(cardId);
    if (card.nfc_uid !== identity.uid || card.nfc_tag_type !== identity.tagType) throw error("STUDENT_CARD_NFC_MISMATCH", "Présentez la carte réservée.");
    if (card.status === "revoked" && card.revoke_reason === "nfc_reservation_expired") return { error: expired() };
    if (card.status === "issued" && card.reservation_expired) { await expire(card.student_id); return { error: expired() }; }
    if (!["issued", "active"].includes(card.status)) throw error("STUDENT_CARD_INVALID_STATE", "Carte inactive.");
    if (card.nfc_retry_operation_ids.includes(key)) return replay(card);
    if (card.status !== "issued" || card.nfc_encoding_state !== "pending") throw error("STUDENT_CARD_INVALID_STATE", "Seule une réservation valide peut être réencodée.");
    const generated = generateCardSecrets();
    const updated = await store.rotatePendingNfc(scope.schoolId, card.id, identity.uid, identity.tagType, card.token_hash, generated.tokenHash, key);
    if (!updated) throw error("STUDENT_CARD_INVALID_STATE", "Réencodage indisponible. Relisez l’état de la réservation.");
    await audit("student_card_nfc_encoding_retried", updated, null, { state: "pending", tagType: identity.tagType, operationId: key });
    return { ...mapIssuedCard(updated, `${card.public_id}.${generated.secret}`), reissued: true, tokenAvailable: true };
  });
}

async function transitionStudentCardNfc(repo, cardId, principal, meta, scope, target, reason) {
  reason = ["lost", "revoked", "nfc_abandoned"].includes(reason) ? reason : target;
  authorize(principal, scope, target === "lost" ? "POST /api/student-cards/:id/lost" : "POST /api/student-cards/:id/revoke");
  return transaction(repo, principal, meta, scope, async ({ store, audit, cardForUpdate }) => {
    const card = await cardForUpdate(cardId);
    if (card.status === target) return replay(card);
    if (card.status !== "active" && !(target === "revoked" && card.status === "issued")) throw error("STUDENT_CARD_INVALID_STATE", "Transition de carte impossible.");
    const updated = target === "lost" ? await store.markLost(scope.schoolId, card.id, reason)
      : await store.markRevoked(scope.schoolId, card.id, reason);
    if (!updated) throw error("STUDENT_CARD_INVALID_STATE", "La carte a changé pendant l’opération.");
    await audit(target === "lost" ? "student_card_lost" : "student_card_revoked", updated, { status: card.status }, { status: target, reason });
    return mapCardListItem(updated);
  }, false);
}

module.exports = { reserveStudentCardNfc, confirmStudentCardNfc, retryStudentCardNfc, transitionStudentCardNfc };
