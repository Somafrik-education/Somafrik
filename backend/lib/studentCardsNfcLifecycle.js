"use strict";

const { createHttpError } = require("./classesManagement");
const { createStudentAccessCardsPgStore, isUuid } = require("../db/studentAccessCardsPgStore");
const { RbacService } = require("../services/rbacService");
const { normalizeNfcIdentity, assertNfcEnabled } = require("./studentCardsNfcEncoding");
const { assertStudentCardMasterEnabled, generateCardSecrets, mapIssuedCard, mapCardListItem } = require("./studentAccessCardsManagement");
const { parseCardToken, hashCardSecret, tokenHashesMatch } = require("./studentCardCapability");
const { PROVISION_TTL_MS, resolveNfcProvisionKey, signProvisionChallenge, verifyProvisionChallenge } = require("./studentCardNfcProvisionKey");
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
        const expired = await store.expirePendingNfc(scope.schoolId, studentId);
        for (const card of expired) {
          await audit("student_card_nfc_reservation_expired", card, { status: "issued" }, { status: "revoked" });
        }
        return expired.length;
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

// NFC-P0-RECOVERY-02 — a card list must show the state stored in PostgreSQL, so a
// reservation past its deadline is expired by the canonical transition before the
// read. Only an NFC manager of the authorised school commits it, NFC flags must be
// on, and expiry is idempotent (conditional UPDATE under the student lock): a
// concurrent read finds no row left and writes no audit. Never extends a deadline.
async function materializeExpiredNfcReservations(repo, studentId, principal, meta, scope) {
  if (typeof repo.withTransaction !== "function" || typeof repo.recordAudit !== "function" || typeof repo.query !== "function") return 0;
  if (!principal || !scope?.schoolId || !studentId) return 0;
  if (!principal.enrollmentSchoolId || principal.enrollmentSchoolId !== scope.schoolId) return 0;
  if (!rbac.canAccess(principal, "POST /api/student-cards/:id/nfc-confirm")) return 0;
  const probe = createStudentAccessCardsPgStore(repo);
  if (!(await probe.hasExpiredPendingNfc(scope.schoolId, studentId))) return 0;
  try {
    return await transaction(repo, principal, meta, scope, async ({ store, expire }) => {
      if (!(await store.lockStudent(scope.schoolId, studentId))) return 0;
      return expire(studentId);
    });
  } catch (cause) {
    // Flags off (or turned off meanwhile): no mutation, the list shows stored rows.
    if (["STUDENT_CARD_NFC_DISABLED", "STUDENT_CARD_DISABLED"].includes(cause?.code)) return 0;
    throw cause;
  }
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

async function assertConfirmStudent(store, scope, card, studentRef) {
  if (studentRef == null) return;
  const ref = String(studentRef).trim();
  if (!ref) return;
  const student = await store.findStudentInSchool(scope.schoolId, ref);
  if (!student || student.school_id !== scope.schoolId || student.id !== card.student_id) {
    throw error("STUDENT_CARD_NFC_MISMATCH", "La carte ne correspond pas à cette affectation.");
  }
}

async function confirmStudentCardNfc(repo, cardId, payload, principal, meta, scope) {
  authorize(principal, scope, "POST /api/student-cards/:id/nfc-confirm");
  const identity = normalizeNfcIdentity(payload);
  if (typeof payload.locked !== "boolean") throw error("STUDENT_CARD_NFC_INVALID", "Observation NFC invalide.", 400);
  const key = payload.operationId == null ? null
    : operationId(typeof payload.operationId === "string" ? payload.operationId.trim() : null);
  const parsed = parseCardToken(payload.cardToken);
  return transaction(repo, principal, meta, scope, async ({ store, audit, expire, cardForUpdate }) => {
    const card = await cardForUpdate(cardId);
    if (card.public_id !== parsed.publicId || !tokenHashesMatch(hashCardSecret(parsed.secret), card.token_hash)) throw notFound();
    if (card.nfc_uid !== identity.uid || card.nfc_tag_type !== identity.tagType) throw error("STUDENT_CARD_NFC_MISMATCH", "La carte ne correspond pas à cette affectation.");
    await assertConfirmStudent(store, scope, card, payload.studentId);
    // Bind initial confirmation and every replay to the stored reservation UUID,
    // never to a retry/rotation UUID. Validate before expiry, activation or audits.
    if (card.nfc_operation_id) {
      if (!key) throw error("STUDENT_CARD_NFC_OPERATION_REQUIRED", "Un identifiant d’opération NFC UUID est requis.", 400);
      if (key !== card.nfc_operation_id) throw error("STUDENT_CARD_NFC_OPERATION_MISMATCH", "La confirmation ne correspond pas à l’opération réservée.");
    } else {
      // Pre-reservation cards can be re-observed only when already active/encoded.
      // No caller may assign an arbitrary UUID or activate a legacy pending card.
      if (key) throw error("STUDENT_CARD_NFC_OPERATION_MISMATCH", "La confirmation ne correspond pas à l’opération réservée.");
      if (card.status !== "active" || !["encoded", "locked"].includes(card.nfc_encoding_state)) throw error("STUDENT_CARD_INVALID_STATE", "Carte inactive ou réservation non disponible.");
    }
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

// Reconcile a correctly written tag after its server reservation has expired.
// Deliberately never writes to the NFC tag, rotates a secret or changes UID ownership.
async function recoverExpiredStudentCardNfc(repo, cardId, payload, principal, meta, scope) {
  authorize(principal, scope, "POST /api/student-cards/:id/nfc-confirm");
  const identity = normalizeNfcIdentity(payload);
  const parsed = parseCardToken(payload?.cardToken);
  const key = operationId(payload?.operationId);
  if (!payload?.studentId) throw error("STUDENT_CARD_NFC_MISMATCH", "Élève requis.", 400);
  return transaction(repo, principal, meta, scope, async ({ store, audit, cardForUpdate }) => {
    const card = await cardForUpdate(cardId);
    // Fail closed on retired, replaced, lost, abandoned and different students.
    if (card.public_id !== parsed.publicId ||
        !tokenHashesMatch(hashCardSecret(parsed.secret), card.token_hash)) throw notFound();
    if (card.nfc_uid !== identity.uid || card.nfc_tag_type !== identity.tagType) {
      throw error("STUDENT_CARD_NFC_MISMATCH", "UID ou modèle incorrect.");
    }
    await assertConfirmStudent(store, scope, card, payload.studentId);
    const student = await store.findStudentInSchool(scope.schoolId, card.student_id);
    if (!student || student.status !== "active") {
      throw error("STUDENT_CARD_INVALID_STATE", "Élève non actif.");
    }
    if (card.status === "active" && ["encoded", "locked"].includes(card.nfc_encoding_state)) {
      return replay(card); // harmless duplicate call, no audit/no second transition
    }
    if (card.status !== "revoked" || card.revoke_reason !== "nfc_reservation_expired" ||
        card.nfc_encoded_at != null || card.nfc_replaces_card_id != null ||
        card.nfc_encoding_state !== "pending") {
      throw error("STUDENT_CARD_INVALID_STATE", "Carte non éligible à la récupération.");
    }
    if (await store.findActive(scope.schoolId, card.student_id) ||
        await store.findPendingNfc(scope.schoolId, card.student_id)) {
      throw error("STUDENT_CARD_ACTIVE_ALREADY_EXISTS", "Une autre carte ou réservation existe.");
    }
    const updated = await store.recoverExpiredNfc(scope.schoolId, card.id, identity.uid,
      identity.tagType, card.token_hash);
    if (!updated) throw error("STUDENT_CARD_INVALID_STATE", "Récupération concurrente refusée.");
    await audit("student_card_nfc_reservation_recovered", updated,
      { status: "revoked", state: card.nfc_encoding_state },
      { status: "active", state: "encoded", mode: "recognized", tagType: identity.tagType });
    return mapCardListItem(updated);
  });
}

// NFC-P0-R2 — reopen an expired reservation of a physically blank card for the SAME
// pupil, same school, same UID and model. Never deletes, recreates or reassigns the row
// (the global UID index is untouched). A fresh secret is generated; only its hash is
// stored. The caller then writes, re-reads and confirms with the canonical nfc-confirm.
async function reopenExpiredStudentCardNfc(repo, cardId, payload, principal, meta, scope) {
  authorize(principal, scope, "POST /api/student-cards/:id/nfc-retry");
  const identity = normalizeNfcIdentity(payload);
  const key = operationId(payload?.operationId);
  if (!payload?.studentId) throw error("STUDENT_CARD_NFC_MISMATCH", "Élève requis.", 400);
  return transaction(repo, principal, meta, scope, async ({ store, audit, expire, cardForUpdate }) => {
    let card = await cardForUpdate(cardId);
    if (card.nfc_uid !== identity.uid || card.nfc_tag_type !== identity.tagType) {
      throw error("STUDENT_CARD_NFC_MISMATCH", "UID ou modèle incorrect.");
    }
    await assertConfirmStudent(store, scope, card, payload.studentId);
    // Idempotent replay of this exact reopening: same row, no new secret, no audit.
    if ((card.nfc_retry_operation_ids || []).includes(key)) {
      if (["issued", "active"].includes(card.status)) return replay(card);
      throw error("STUDENT_CARD_INVALID_STATE", "Réservation de récupération inactive.");
    }
    const elsewhere = await store.findNfcOperation(scope.schoolId, key);
    if (elsewhere && elsewhere.id !== card.id) {
      throw error("STUDENT_CARD_NFC_OPERATION_CONFLICT", "Cet identifiant d’opération est déjà utilisé avec un autre contexte.");
    }
    const student = await store.findStudentInSchool(scope.schoolId, card.student_id);
    if (!student || student.status !== "active") throw error("STUDENT_CARD_INVALID_STATE", "Élève non actif.");
    // Materialise a deadline that passed without a list refresh, then re-read the row.
    if (card.status === "issued" && card.reservation_expired) {
      await expire(card.student_id);
      card = await store.lockCard(scope.schoolId, card.id);
    }
    if (card.status !== "revoked" || card.revoke_reason !== "nfc_reservation_expired" ||
        card.nfc_encoded_at != null || card.nfc_replaces_card_id != null ||
        card.nfc_encoding_state !== "pending") {
      throw error("STUDENT_CARD_INVALID_STATE", "Carte non éligible au réencodage.");
    }
    if (await store.findActive(scope.schoolId, card.student_id) ||
        await store.findPendingNfc(scope.schoolId, card.student_id)) {
      throw error("STUDENT_CARD_ACTIVE_ALREADY_EXISTS", "Une autre carte ou réservation existe.");
    }
    const generated = generateCardSecrets();
    const updated = await store.reopenExpiredNfc(scope.schoolId, card.id, identity.uid, identity.tagType,
      card.token_hash, generated.tokenHash, key);
    if (!updated) throw error("STUDENT_CARD_INVALID_STATE", "Réencodage concurrent refusé. Relisez l’état de la carte.");
    await audit("student_card_nfc_reservation_recovered", updated,
      { status: "revoked", state: "pending" },
      { status: "issued", state: "pending", mode: "reopen", tagType: identity.tagType, recoveryCount: updated.nfc_recovery_count });
    return { ...mapIssuedCard(updated, `${updated.public_id}.${generated.secret}`), reissued: true, tokenAvailable: true };
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

// CARTE-FIX-QR-NFC — provisionnement NFC de la carte ACTIVE existante (même ligne, même
// identité, même secret). Jamais d'émission, de remplacement, de révocation ni de rotation.
// Le jeton complet (public_id + secret, comparé à son empreinte) prouve la possession de la
// carte : l'identifiant public seul n'autorise rien. Deux temps :
//  1. begin  : jeton lu sur le QR imprimé + UID/modèle inspectés → défi serveur signé (HMAC),
//              lié à la carte, à son empreinte, à la puce, à l'opération et à l'acteur, 10 min ;
//  2. confirm: jeton RELU sur la puce après écriture + même UID + défi valide → la puce est
//              enregistrée sous verrou, une seule fois (rejeu idempotent, concurrence sérialisée).
// Le défi empêche une déclaration « NFC encodé » sans session autorisée pour cette puce ; il ne
// constitue pas une preuve matérielle indépendante de l'écriture (voir la PR).
const PROVISION_ROUTE = "POST /api/student-cards/:id/nfc-provision";

function challengeFields(card, identity, key, actorId) {
  return { cardId: card.id, tokenHash: card.token_hash, uid: identity.uid, tagType: identity.tagType, operationId: key, actorId };
}

function provisionInput(payload) {
  const identity = normalizeNfcIdentity(payload?.nfc);
  const key = operationId(typeof payload?.operationId === "string" ? payload.operationId.trim() : payload?.operationId);
  const parsed = parseCardToken(payload?.cardToken);
  return { identity, key, parsed };
}

/** Contrôles communs, sous verrou : jeton complet, carte active, puce libre, élève attendu. */
async function assertProvisionable({ db, store }, scope, card, parsed, identity, studentRef) {
  if (card.public_id !== parsed.publicId || !tokenHashesMatch(hashCardSecret(parsed.secret), card.token_hash)) throw notFound();
  await assertConfirmStudent(store, scope, card, studentRef);
  // Révoquée, perdue, remplacée ou réservée : jamais de réactivation implicite.
  if (card.status !== "active") throw error("STUDENT_CARD_INVALID_STATE", "Seule une carte active peut recevoir une puce NFC.");
  if (card.nfc_uid) {
    if (card.nfc_uid === identity.uid && card.nfc_tag_type === identity.tagType
      && ["encoded", "locked"].includes(card.nfc_encoding_state)) return "provisioned";
    throw error("STUDENT_CARD_NFC_ALREADY_PROVISIONED", "Cette carte possède déjà une autre puce NFC. Utilisez le remplacement.");
  }
  // Une puce n'appartient qu'à une seule carte, tous établissements et historique confondus.
  const owner = await db.one("SELECT 1 FROM student_access_cards WHERE nfc_uid = $1 AND id <> $2 LIMIT 1", [identity.uid, card.id]);
  if (owner) throw error("STUDENT_CARD_NFC_UID_EXISTS", "Cette carte physique est déjà affectée.");
  if (await store.findPendingNfc(scope.schoolId, card.student_id)) {
    throw error("STUDENT_CARD_NFC_RESERVATION_EXISTS", "Une réservation NFC est déjà en attente pour cet élève.");
  }
  return "free";
}

async function serverNowMs(db) {
  const row = await db.one("SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms");
  return Number(row.now_ms);
}

async function beginStudentCardNfcProvision(repo, cardId, payload, principal, meta, scope) {
  authorize(principal, scope, PROVISION_ROUTE);
  const { identity, key, parsed } = provisionInput(payload);
  const actorId = String(principal.sub || principal.id || "");
  const { key: signingKey } = resolveNfcProvisionKey(); // fail-closed avant toute lecture
  return transaction(repo, principal, meta, scope, async (ctx) => {
    const card = await ctx.cardForUpdate(cardId);
    await ctx.expire(card.student_id);
    const state = await assertProvisionable(ctx, scope, card, parsed, identity, payload?.studentId);
    if (state === "provisioned") return { cardId: card.id, alreadyProvisioned: true, card: mapCardListItem(card) };
    const expiresAt = (await serverNowMs(ctx.db)) + PROVISION_TTL_MS;
    await ctx.audit("student_card_nfc_provision_started", card, null, {
      studentId: card.student_id, tagType: identity.tagType, operationId: key, expiresAt: new Date(expiresAt).toISOString(),
    });
    return {
      cardId: card.id,
      alreadyProvisioned: false,
      challenge: signProvisionChallenge(challengeFields(card, identity, key, actorId), expiresAt, signingKey),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  });
}

async function confirmStudentCardNfcProvision(repo, cardId, payload, principal, meta, scope) {
  authorize(principal, scope, PROVISION_ROUTE);
  const { identity, key, parsed } = provisionInput(payload);
  if (typeof payload?.challenge !== "string" || !payload.challenge) {
    throw error("STUDENT_CARD_NFC_PROVISION_CHALLENGE_REQUIRED", "Défi de provisionnement requis.", 400);
  }
  const actorId = String(principal.sub || principal.id || "");
  const { key: signingKey } = resolveNfcProvisionKey();
  return transaction(repo, principal, meta, scope, async (ctx) => {
    const card = await ctx.cardForUpdate(cardId);
    const state = await assertProvisionable(ctx, scope, card, parsed, identity, payload?.studentId);
    // Même puce déjà enregistrée (rejeu ou confirmation concurrente) : aucun nouvel état ni audit.
    if (state === "provisioned") return replay(card);
    const fields = challengeFields(card, identity, key, actorId);
    if (!verifyProvisionChallenge(payload.challenge, fields, signingKey, await serverNowMs(ctx.db))) {
      throw error("STUDENT_CARD_NFC_PROVISION_CHALLENGE_INVALID", "Preuve de provisionnement invalide ou expirée. Recommencez l’encodage.");
    }
    const updated = await ctx.db.one(
      `UPDATE student_access_cards
          SET medium = 'nfc_qr', nfc_uid = $3, nfc_tag_type = $4, nfc_encoding_state = 'encoded',
              nfc_encoded_at = clock_timestamp(), updated_at = NOW()
        WHERE school_id = $1 AND id = $2 AND status = 'active' AND nfc_uid IS NULL AND token_hash = $5
        RETURNING *`,
      [scope.schoolId, card.id, identity.uid, identity.tagType, card.token_hash],
    );
    if (!updated) throw error("STUDENT_CARD_INVALID_STATE", "Provisionnement refusé. Relisez l’état de la carte.");
    await ctx.audit("student_card_nfc_provisioned", updated,
      { medium: card.medium, nfc: null },
      { medium: "nfc_qr", state: "encoded", tagType: identity.tagType, operationId: key, sameCard: true });
    return mapCardListItem(updated);
  });
}

module.exports = { beginStudentCardNfcProvision, confirmStudentCardNfcProvision, reserveStudentCardNfc, confirmStudentCardNfc, retryStudentCardNfc, recoverExpiredStudentCardNfc, reopenExpiredStudentCardNfc, transitionStudentCardNfc, materializeExpiredNfcReservations };
