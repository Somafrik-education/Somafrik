"use strict";

/**
 * NFC-PRES-LOCAL-PR1c — synchronisation transactionnelle d'un appel réalisé hors ligne.
 *
 * POST /api/student-cards/roll-call/offline/v1/sync   (Idempotency-Key = operationId)
 *
 * Contrat : docs/audits/NFC-PRES-LOCAL-PR0-architecture-offline-20261107.md (§6).
 * PostgreSQL est la seule source de vérité : le téléphone n'impose jamais un statut final. Le pack
 * (PR1b) n'est jamais lu : chaque scan est revalidé par sa preuve HMAC et l'état courant de la carte.
 *
 * Deux autorisations distinctes (§6.2) :
 *  - garde R (relire son propre ACK), AVANT toute lecture d'idempotence ou du journal : JWT,
 *    utilisateur canonique actif, établissement relu en base et égal au `schoolId` du lot, rôle
 *    TEACHER actif relu en base ; échec → 403 ROLL_CALL_REPLAY_FORBIDDEN, indépendant de la session ;
 *  - garde W (nouvel enregistrement), seulement si aucun appel n'est enregistré pour la session :
 *    affectation, flags (maître, présences, support réellement utilisé), abonnement, fenêtre de date,
 *    cartes et inscriptions. Toute erreur W porte `sessionState: "not_recorded"`.
 *
 * Une réponse perdue ne provoque jamais une seconde écriture : la session est unique en base, l'ACK
 * est figé dans le journal (`ack_body`) et rejoué à l'identique, y compris au-delà des 24 h du cache.
 */

const crypto = require("node:crypto");
const { createHttpError } = require("./classesManagement");
const { isStudentCardCapabilityEnabled, mapSettingsRow } = require("./schoolSettingsManagement");
const { createSchoolSettingsPgStore } = require("../db/schoolSettingsPgStore");
const {
  CONTRACT_VERSION,
  ROLL_CALL_MODE,
  MEDIA,
  cardKeyFromTokenHash,
  verifyProof,
  computePayloadDigest,
} = require("./rollCallOfflineProof");
const { canonicalTimeZone, computePackWindow } = require("./rollCallOfflinePack");
const { getIdempotencyTx } = require("./idempotencyTxContext");
const {
  ROLL_CALL_ERROR,
  ROSTER_ENROLLMENT_SQL,
  liveRollCallActor,
  authorizeRollCallActor,
  assertRollCallEnabled,
  assertRollCallClass,
  applyTeacherMarks,
  lockRollCallDay,
  rollCallCounts,
  principalRoleKeys,
} = require("./studentCardRollCall");

const OFFLINE_SYNC_ERROR = Object.freeze({
  INPUT_INVALID: ROLL_CALL_ERROR.INPUT_INVALID,
  OPERATION_KEY_REQUIRED: ROLL_CALL_ERROR.OPERATION_KEY_REQUIRED,
  DIGEST_MISMATCH: "ROLL_CALL_DIGEST_MISMATCH",
  REPLAY_FORBIDDEN: "ROLL_CALL_REPLAY_FORBIDDEN",
  SESSION_CONFLICT: "ROLL_CALL_SESSION_CONFLICT",
  OFFLINE_EXPIRED: "ROLL_CALL_OFFLINE_EXPIRED",
  PROOF_INVALID: "ROLL_CALL_PROOF_INVALID",
  CARD_INVALID: ROLL_CALL_ERROR.CARD_INVALID,
  MEDIA_DISABLED: "ROLL_CALL_OFFLINE_MEDIA_DISABLED",
  TRANSACTION_UNAVAILABLE: "ROLL_CALL_OFFLINE_TRANSACTION_UNAVAILABLE",
});

const SESSION_STATE = Object.freeze({ NOT_RECORDED: "not_recorded", CONFLICT: "conflict" });

const MAX_SCANS = 300;
const MAX_MANUAL = 300;
const MANUAL_STATUSES = Object.freeze(["present", "late", "absent"]);
const BODY_KEYS = Object.freeze([
  "contractVersion", "operationId", "sessionId", "revision", "schoolId", "classId", "date", "mode",
  "packId", "complete", "scans", "manual", "payloadDigest",
]);
const SCAN_KEYS = Object.freeze(["scanId", "publicId", "proof", "medium", "scannedAt"]);
const MANUAL_KEYS = Object.freeze(["studentId", "status"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;
const PROOF = /^[A-Za-z0-9_-]{43}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const PLATFORM_ROLE_KEYS = new Set(["SUPER_ADMIN", "COUNTRY_ADMIN"]);

function inputError(message, details) {
  const error = createHttpError(400, message, OFFLINE_SYNC_ERROR.INPUT_INVALID);
  if (details) error.details = details;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value)) throw inputError(`${label} invalide.`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw inputError(`${label} : champs inattendus ou manquants.`);
  }
}

function isRealDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function strictlySorted(items, key) {
  for (let i = 1; i < items.length; i += 1) {
    if (!(items[i - 1][key] < items[i][key])) return false;
  }
  return true;
}

/**
 * Validation stricte du lot (§6.1), puis recalcul du digest. Aucune normalisation silencieuse :
 * UUID en minuscules, ordre canonique imposé, champs exacts. Ne lit ni n'écrit rien en base.
 */
function readSyncBody(body, idempotencyKey) {
  assertExactKeys(body, BODY_KEYS, "Lot de synchronisation");
  if (body.contractVersion !== CONTRACT_VERSION) throw inputError("Version de contrat non prise en charge.");
  if (body.mode !== ROLL_CALL_MODE) throw inputError("Mode d'appel invalide.");
  if (body.complete !== true) throw inputError("Seul un appel complet confirmé peut être synchronisé.");
  if (!Number.isSafeInteger(body.revision) || body.revision < 1) throw inputError("Révision invalide.");
  for (const key of ["operationId", "sessionId", "schoolId", "classId"]) {
    if (typeof body[key] !== "string" || !UUID.test(body[key])) throw inputError(`Identifiant invalide : ${key}.`);
  }
  if (body.packId !== null && (typeof body.packId !== "string" || !UUID.test(body.packId))) throw inputError("Pack invalide.");
  if (!isRealDate(body.date)) throw inputError("Date d'appel invalide.");
  if (typeof body.payloadDigest !== "string" || !DIGEST.test(body.payloadDigest)) throw inputError("Empreinte du lot invalide.");
  if (!Array.isArray(body.scans) || body.scans.length > MAX_SCANS) throw inputError("Scans invalides.");
  if (!Array.isArray(body.manual) || body.manual.length > MAX_MANUAL) throw inputError("Pointage manuel invalide.");
  for (const scan of body.scans) {
    assertExactKeys(scan, SCAN_KEYS, "Scan");
    if (typeof scan.scanId !== "string" || !UUID.test(scan.scanId)) throw inputError("Scan invalide.");
    if (typeof scan.publicId !== "string" || !PUBLIC_ID.test(scan.publicId)) throw inputError("Scan invalide.");
    if (typeof scan.proof !== "string" || !PROOF.test(scan.proof)) throw inputError("Scan invalide.");
    if (!MEDIA.includes(scan.medium)) throw inputError("Support de scan invalide.");
    // scannedAt est informatif (horloge non fiable) : format contrôlé, jamais utilisé pour autoriser.
    if (typeof scan.scannedAt !== "string" || !ISO_INSTANT.test(scan.scannedAt) || Number.isNaN(Date.parse(scan.scannedAt))) {
      throw inputError("Horodatage de scan invalide.");
    }
  }
  for (const mark of body.manual) {
    assertExactKeys(mark, MANUAL_KEYS, "Pointage manuel");
    if (typeof mark.studentId !== "string" || !UUID.test(mark.studentId)) throw inputError("Élève invalide dans le pointage manuel.");
    if (!MANUAL_STATUSES.includes(mark.status)) throw inputError("Statut de pointage manuel invalide.");
  }
  if (!strictlySorted(body.scans, "scanId")) throw inputError("Scans non triés ou en double (scanId).");
  if (!strictlySorted(body.manual, "studentId")) throw inputError("Pointage manuel non trié ou en double (studentId).");
  if (String(idempotencyKey ?? "") !== body.operationId) {
    throw createHttpError(400, "Idempotency-Key doit être l'identifiant d'opération du lot.", OFFLINE_SYNC_ERROR.OPERATION_KEY_REQUIRED);
  }
  let digest;
  try {
    digest = computePayloadDigest(body); // validateur de types + JCS + plafond de 256 Kio
  } catch {
    throw inputError("Lot hors du domaine JSON admis ou trop volumineux.");
  }
  if (digest !== body.payloadDigest) {
    throw createHttpError(400, "Empreinte du lot incohérente.", OFFLINE_SYNC_ERROR.DIGEST_MISMATCH);
  }
  return Object.freeze({ ...body, payloadDigest: digest });
}

// ---------------------------------------------------------------------------------------------
// Garde R : relire le résultat de son propre appel.
// ---------------------------------------------------------------------------------------------

function replayForbidden() {
  // Corps identique quelle que soit la cause et que la session existe ou non.
  return createHttpError(403, "Résultat de l'appel non consultable avec ce compte.", OFFLINE_SYNC_ERROR.REPLAY_FORBIDDEN);
}

/**
 * Garde R. Ne dépend que du principal et du `schoolId` du lot, jamais de la session.
 * Renvoie l'acteur canonique (rôles relus en base) pour la suite du traitement.
 */
async function guardReplayAccess(repo, principal, scope, batch) {
  const sub = String(principal?.sub ?? principal?.id ?? "").trim();
  const schoolId = String(scope?.schoolId ?? "").toLowerCase();
  if (!sub || !schoolId || batch.schoolId !== schoolId) throw replayForbidden();
  const actor = await liveRollCallActor(repo, principal, scope.schoolId);
  const canonicalUserId = String(actor.canonicalUserId || "").toLowerCase();
  const user = UUID.test(canonicalUserId)
    ? await repo.one("SELECT school_id::text AS school_id, status FROM users WHERE id = $1::uuid LIMIT 1", [canonicalUserId])
    : null;
  // Établissement relu en base (jamais une valeur déjà attachée au principal ni un champ client).
  if (!user || String(user.school_id ?? "").toLowerCase() !== schoolId || String(user.status ?? "") !== "active") {
    throw replayForbidden();
  }
  const keys = principalRoleKeys(actor);
  if (!keys.has("TEACHER") || [...keys].some((key) => PLATFORM_ROLE_KEYS.has(key))) throw replayForbidden();
  return { ...actor, canonicalUserId };
}

// ---------------------------------------------------------------------------------------------
// Journal de session (lecture sous verrou) et ACK.
// ---------------------------------------------------------------------------------------------

async function lockSession(repo, schoolId, sessionId) {
  await repo.one(
    "SELECT pg_advisory_xact_lock(hashtext('rc-offline-session'), hashtext($1::text || ':' || $2::text)) AS locked",
    [schoolId, sessionId],
  );
}

function sessionConflict() {
  const error = createHttpError(409, "Cet appel a déjà été enregistré avec un autre contenu.", OFFLINE_SYNC_ERROR.SESSION_CONFLICT);
  error.sessionState = SESSION_STATE.CONFLICT;
  return error;
}

/** Décision §6.4 : null si aucun appel ; ACK figé si même opération du même auteur ; sinon conflit. */
async function readJournalDecision(repo, schoolId, batch, actorUserId) {
  const row = await repo.one(
    `SELECT source, operation_id::text AS operation_id, payload_digest, author_user_id::text AS author_user_id, ack_body
       FROM attendance_roll_calls WHERE school_id = $1::uuid AND session_id = $2::uuid LIMIT 1`,
    [schoolId, batch.sessionId],
  );
  if (!row) return null;
  const sameOperation = row.source === "offline"
    && String(row.operation_id ?? "").toLowerCase() === batch.operationId
    && row.payload_digest === batch.payloadDigest
    && String(row.author_user_id ?? "").toLowerCase() === actorUserId
    && row.ack_body && typeof row.ack_body === "object";
  if (!sameOperation) throw sessionConflict();
  // Même forme qu'un rejeu servi par withIdempotency : ACK figé + idempotentReplay (contrat §6.6).
  return { statusCode: 200, body: { ...row.ack_body, idempotentReplay: true } };
}

// ---------------------------------------------------------------------------------------------
// Garde W et écriture.
// ---------------------------------------------------------------------------------------------

function settingsStore(repo) {
  return typeof repo.getSchoolSettingsStore === "function" ? repo.getSchoolSettingsStore() : createSchoolSettingsPgStore(repo);
}

/** Flag de chaque support réellement utilisé dans le lot (fail-closed). */
async function assertUsedMediaEnabled(repo, schoolId, scans) {
  const used = new Set(scans.map((scan) => scan.medium));
  if (used.size === 0) return;
  const store = settingsStore(repo);
  const settings = mapSettingsRow(typeof store.getSettings === "function" ? await store.getSettings(schoolId) : null);
  const enabled = { nfc: isStudentCardCapabilityEnabled(settings, "studentCardNfcEnabled"), qr: isStudentCardCapabilityEnabled(settings, "studentCardQrEnabled") };
  if ([...used].some((medium) => !enabled[medium])) {
    throw createHttpError(404, "Support de carte désactivé pour cet établissement.", OFFLINE_SYNC_ERROR.MEDIA_DISABLED);
  }
}

async function schoolTimeZone(repo, schoolId) {
  const row = await repo.one("SELECT profile_payload->>'timezone' AS timezone FROM schools WHERE id = $1::uuid LIMIT 1", [schoolId]);
  return canonicalTimeZone(row?.timezone);
}

/** Fenêtre de synchronisation recalculée par le serveur : notBefore(D) ≤ now < syncDeadline(D). */
function assertSyncWindow(timeZone, date, nowMs) {
  const window = computePackWindow(timeZone, date);
  if (!(nowMs >= window.notBefore && nowMs < window.syncDeadline)) {
    throw createHttpError(409, "Délai de synchronisation dépassé pour cet appel.", OFFLINE_SYNC_ERROR.OFFLINE_EXPIRED);
  }
  return window;
}

/** Support déclaré cohérent avec la carte (contrat §3.3). */
function cardSupportsMedium(card, medium) {
  if (medium === "nfc") {
    return (card.medium === "nfc" || card.medium === "nfc_qr")
      && (card.nfc_encoding_state === "encoded" || card.nfc_encoding_state === "locked");
  }
  return card.medium === "qr" || card.medium === "nfc_qr";
}

/**
 * Cartes verrouillées en partage (ordre déterministe par id), preuves HMAC puis état courant.
 * Carte inconnue ou preuve fausse → PROOF_INVALID (aucun indice d'existence) ; preuve valide mais
 * carte inutilisable, support incohérent ou titulaire non inscrit → CARD_INVALID.
 */
async function verifyScans(repo, { schoolId, batch, actorUserId, enrolled }) {
  if (batch.scans.length === 0) return new Map();
  const publicIds = [...new Set(batch.scans.map((scan) => scan.publicId))];
  const rows = await repo.all(
    `SELECT id, public_id, token_hash, student_id::text AS student_id, medium, status, nfc_encoding_state
       FROM student_access_cards
      WHERE school_id = $1::uuid AND public_id = ANY($2::text[])
      ORDER BY id
      FOR SHARE`,
    [schoolId, publicIds],
  );
  const byPublicId = new Map(rows.map((row) => [row.public_id, row]));
  const proofInvalid = [];
  const cardInvalid = [];
  const scansByStudent = new Map();
  for (const scan of batch.scans) {
    const card = byPublicId.get(scan.publicId);
    const fields = {
      contractVersion: batch.contractVersion,
      schoolId,
      actorUserId,
      classId: batch.classId,
      date: batch.date,
      mode: batch.mode,
      sessionId: batch.sessionId,
      packId: batch.packId ?? "",
      scanId: scan.scanId,
      publicId: scan.publicId,
      medium: scan.medium,
    };
    if (!card || !verifyProof(cardKeyFromTokenHash(card.token_hash), fields, scan.proof)) {
      proofInvalid.push(scan.scanId);
      continue;
    }
    const studentId = String(card.student_id).toLowerCase();
    if (card.status !== "active" || card.nfc_encoding_state === "pending" || !cardSupportsMedium(card, scan.medium) || !enrolled.has(studentId)) {
      cardInvalid.push(scan.scanId);
      continue;
    }
    if (!scansByStudent.has(studentId)) scansByStudent.set(studentId, []);
    scansByStudent.get(studentId).push(scan.scanId);
  }
  if (proofInvalid.length > 0) {
    const error = createHttpError(400, "Preuve de scan invalide : appel non enregistré.", OFFLINE_SYNC_ERROR.PROOF_INVALID);
    error.details = { invalidScanIds: proofInvalid };
    throw error;
  }
  if (cardInvalid.length > 0) {
    const error = createHttpError(409, `${cardInvalid.length} carte(s) ne sont plus valides : appel non enregistré.`, OFFLINE_SYNC_ERROR.CARD_INVALID);
    error.details = { invalidScanIds: cardInvalid };
    throw error;
  }
  return scansByStudent;
}

async function enrolledStudents(repo, schoolId, classId) {
  const rows = await repo.all(
    `SELECT DISTINCT e.student_id::text AS student_id FROM enrollments e
      WHERE e.school_id = $1::uuid AND e.class_id = $2::uuid AND ${ROSTER_ENROLLMENT_SQL}`,
    [schoolId, classId],
  );
  return new Set(rows.map((row) => String(row.student_id).toLowerCase()));
}

const byStudentId = (a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0);

/**
 * Marques voulues : une par élève. Le pointage manuel prime (correction explicite de l'enseignant) ;
 * sinon une carte valide vaut `present`. Plusieurs scans d'un élève → une seule marque.
 */
function buildWanted(scansByStudent, manual) {
  const wanted = new Map();
  for (const [studentId, scanIds] of scansByStudent) {
    wanted.set(studentId, { studentId, status: "present", source: "card", scanIds });
  }
  manual.forEach((mark, index) => {
    wanted.set(mark.studentId, { studentId: mark.studentId, status: mark.status, source: "manual", index, scanIds: scansByStudent.get(mark.studentId) ?? [] });
  });
  return [...wanted.values()].sort(byStudentId);
}

async function insertJournal(repo, row) {
  const inserted = await repo.one(
    `INSERT INTO attendance_roll_calls (
       id, school_id, class_id, roll_call_date, session_id, mode, author_user_id, author_role_keys,
       teacher_id, justification, scanned_count, manual_count, created_count, corrected_count,
       unchanged_count, protected_count, validated_at, source, operation_id, payload_digest, ack_body
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::uuid, 'teacher', $6::uuid, $7::text[], $8::uuid, NULL,
             $9, $10, $11, $12, $13, $14, $15::timestamptz, 'offline', $16::uuid, $17, $18::jsonb)
     ON CONFLICT (school_id, session_id) DO NOTHING
     RETURNING id`,
    [
      row.id, row.schoolId, row.classId, row.date, row.sessionId, row.authorUserId, row.authorRoleKeys, row.teacherId,
      row.scanned, row.manual, row.created, row.corrected, row.unchanged, row.protectedCount, row.validatedAt,
      row.operationId, row.payloadDigest, JSON.stringify(row.ack),
    ],
  );
  // Impossible sous le verrou de session : toute absence de ligne annule la transaction.
  if (!inserted?.id) throw createHttpError(500, "Enregistrement de l'appel impossible.");
}

/**
 * Garde W puis écriture (§6.3, étapes 6 à 13). Toute erreur 4xx porte `sessionState: "not_recorded"` :
 * elle est levée après avoir constaté sous le verrou de session qu'aucun appel n'est enregistré, et
 * la transaction est annulée.
 */
async function writeOfflineRollCall(repo, { batch, scope, principal, actor, auditMeta, deps }) {
  try {
    authorizeRollCallActor(actor, "teacher");
    await assertRollCallEnabled(repo, scope.schoolId);
    await assertUsedMediaEnabled(repo, scope.schoolId, batch.scans);
    const target = await assertRollCallClass(repo, scope, principal, batch.classId, "teacher");
    const nowMs = typeof deps.nowMs === "function" ? deps.nowMs() : (deps.nowMs ?? Date.now());
    assertSyncWindow(await schoolTimeZone(repo, scope.schoolId), batch.date, nowMs);
    const context = { classId: batch.classId, date: batch.date, sessionId: batch.sessionId };
    // Verrou du jour AVANT l'abonnement : même ordre que /validate (cartes partagées → jour), ce qui
    // évite tout interblocage avec un appel en ligne qui écrit des présences sous ce verrou.
    await lockRollCallDay(repo, scope.schoolId, batch.date);
    // Abonnement (garde W uniquement) : obligatoire, fail-closed si le contrôle n'est pas fourni.
    if (typeof deps.assertWritePresence !== "function") throw transactionUnavailable();
    await deps.assertWritePresence();
    const enrolled = await enrolledStudents(repo, scope.schoolId, batch.classId);
    const scansByStudent = await verifyScans(repo, { schoolId: scope.schoolId, batch, actorUserId: actor.canonicalUserId, enrolled });
    const wanted = buildWanted(scansByStudent, batch.manual);
    const { corrections, protectedRows, created, unchanged } = await applyTeacherMarks(repo, {
      scope, principal, context, wanted, target, auditMeta, complete: true,
    });
    const counts = await rollCallCounts(repo, scope.schoolId, batch.classId, batch.date);
    const clock = await repo.one("SELECT clock_timestamp() AS now");
    const validatedAt = new Date(clock.now).toISOString();
    const rollCallId = (deps.randomUUID ?? crypto.randomUUID)();
    const ack = {
      rollCallId,
      sessionId: batch.sessionId,
      operationId: batch.operationId,
      revision: batch.revision,
      payloadDigest: batch.payloadDigest,
      validatedAt,
      created,
      corrected: corrections.length,
      unchanged,
      protected: protectedRows.length,
      protectedScanIds: protectedRows.flatMap((row) => row.scanIds ?? []).sort(),
      protectedManualIndexes: protectedRows.filter((row) => row.source === "manual").map((row) => row.index).sort((a, b) => a - b),
      invalidScanIds: [],
      counts: { present: counts.present, late: counts.late, absent: counts.absent, excused: counts.excused, enrolled: counts.enrolled },
    };
    const authorRoleKeys = [...principalRoleKeys(actor)].sort();
    await insertJournal(repo, {
      id: rollCallId,
      schoolId: scope.schoolId,
      classId: batch.classId,
      date: batch.date,
      sessionId: batch.sessionId,
      authorUserId: actor.canonicalUserId,
      authorRoleKeys,
      teacherId: target.teacherId,
      scanned: scansByStudent.size,
      manual: batch.manual.length,
      created,
      corrected: corrections.length,
      unchanged,
      protectedCount: protectedRows.length,
      validatedAt,
      operationId: batch.operationId,
      payloadDigest: batch.payloadDigest,
      ack,
    });
    await repo.recordAudit({
      schoolCode: principal?.presenceLoginCode || principal?.schoolCode,
      userId: actor.canonicalUserId,
      action: "student_card_roll_call_offline_sync",
      entityType: "attendance_roll_call",
      entityId: rollCallId,
      newValue: {
        mode: "teacher",
        source: "offline",
        sessionId: batch.sessionId,
        operationId: batch.operationId,
        revision: batch.revision,
        classId: batch.classId,
        date: batch.date,
        packId: batch.packId,
        authorRoleKeys,
        scanned: scansByStudent.size,
        scans: batch.scans.length,
        manual: batch.manual.length,
        created,
        unchanged,
        corrections,
        protected: protectedRows.map((row) => ({ studentId: row.studentId, kept: row.existingStatus, requested: row.status })),
      },
      ipAddress: auditMeta?.ipAddress,
      userAgent: auditMeta?.userAgent,
    });
    return { statusCode: 201, body: ack };
  } catch (error) {
    if (error && Number(error.statusCode) >= 400 && Number(error.statusCode) < 500 && !error.sessionState) {
      error.sessionState = SESSION_STATE.NOT_RECORDED;
    }
    throw error;
  }
}

/**
 * Corps du traitement, appelé par withIdempotency APRÈS la garde R (option `guard`) et après la
 * recherche de rejeu : verrou de session → journal → garde W et écriture.
 */
function transactionUnavailable() {
  return createHttpError(503, "Synchronisation hors ligne indisponible : transaction PostgreSQL requise.", OFFLINE_SYNC_ERROR.TRANSACTION_UNAVAILABLE);
}

/** Fail-closed : la synchronisation ne s'exécute QUE dans la transaction de withIdempotencyTransaction. */
function assertInsideTransaction() {
  if (!getIdempotencyTx()?.tx) throw transactionUnavailable();
}

async function syncOfflineRollCall(repo, { batch, scope, principal, actor, auditMeta, deps }) {
  assertInsideTransaction(); // avant toute lecture ou écriture
  if (!actor?.canonicalUserId) throw transactionUnavailable(); // garde R non exécutée : jamais de traitement
  await lockSession(repo, scope.schoolId, batch.sessionId);
  const replay = await readJournalDecision(repo, scope.schoolId, batch, actor.canonicalUserId);
  if (replay) return replay;
  return writeOfflineRollCall(repo, { batch, scope, principal, actor, auditMeta, deps });
}

module.exports = {
  OFFLINE_SYNC_ERROR,
  SESSION_STATE,
  MAX_SCANS,
  MAX_MANUAL,
  readSyncBody,
  guardReplayAccess,
  readJournalDecision,
  assertSyncWindow,
  cardSupportsMedium,
  buildWanted,
  assertInsideTransaction,
  syncOfflineRollCall,
};
