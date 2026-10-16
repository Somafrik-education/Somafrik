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
 *
 * CARTE-UX-ROLE-01 — deux parcours distincts, décidés sur les clés de rôle canoniques et les
 * permissions effectives (jamais sur un libellé) :
 *  - « teacher » : enseignant (clé TEACHER) affecté à la classe ; la présence lui est attribuée ;
 *  - « direction » : appel exceptionnel (PROVISEUR, PRINCIPAL, PREFET_ETUDES, SCHOOL_ADMIN avec
 *    Présences:UPDATE), justification obligatoire, auteur réel tracé dans l'audit, aucune
 *    attribution à un enseignant, écriture atomique.
 * Le mode est scellé dans chaque reçu : un reçu d'un parcours n'est jamais accepté par l'autre.
 * Les clés de rôle sont relues en base pour l'établissement à chaque requête (le JWT n'est
 * qu'une identité) ; les permissions sont celles revalidées par requirePermission.
 *
 * CARTE-PR3-B — appel en classe :
 *  - pointage manuel (présent / en retard / absent) de l'enseignant affecté, dans le même lot
 *    que les scans ; un absent n'est jamais créé automatiquement ;
 *  - règles d'écrasement explicites : une présence existante n'est modifiée que d'`absent` vers
 *    `present` ou `late` (correction tracée dans l'audit) ; `excused` et toute autre
 *    modification sont refusés (statut conservé, signalé dans la réponse) ;
 *  - journal `attendance_roll_calls` : une ligne par session validée, double validation refusée.
 */

const crypto = require("node:crypto");
const { ROSTER_ENROLLMENT_SQL } = require("./studentEnrollmentC18");
const { createHttpError } = require("./classesManagement");
const { scanStudentCard, assertStudentCardMasterEnabled } = require("./studentAccessCardsManagement");
const { assertStudentCardAttendanceEnabled } = require("./studentCardAttendance");
const { isKnownRoleKey } = require("./userRoleLifecycle");
const { activeEnrollmentMatchesRequestedClass } = require("./presencesAttendanceAuthz");

const ROLL_CALL_ERROR = Object.freeze({
  INPUT_INVALID: "ROLL_CALL_INPUT_INVALID",
  CLASS_FORBIDDEN: "ROLL_CALL_CLASS_FORBIDDEN",
  CLASS_MISMATCH: "ROLL_CALL_CLASS_MISMATCH",
  RECEIPT_INVALID: "ROLL_CALL_RECEIPT_INVALID",
  RECEIPT_EXPIRED: "ROLL_CALL_RECEIPT_EXPIRED",
  CONTEXT_MISMATCH: "ROLL_CALL_CONTEXT_MISMATCH",
  CARD_INVALID: "ROLL_CALL_CARD_INVALID",
  OPERATION_KEY_REQUIRED: "ROLL_CALL_OPERATION_KEY_REQUIRED",
  ROLE_FORBIDDEN: "ROLL_CALL_ROLE_FORBIDDEN",
  JUSTIFICATION_REQUIRED: "ROLL_CALL_JUSTIFICATION_REQUIRED",
  MANUAL_FORBIDDEN: "ROLL_CALL_MANUAL_FORBIDDEN",
  STUDENT_NOT_ENROLLED: "ROLL_CALL_STUDENT_NOT_ENROLLED",
  ALREADY_VALIDATED: "ROLL_CALL_ALREADY_VALIDATED",
  CONCURRENT_UPDATE: "ROLL_CALL_CONCURRENT_UPDATE",
});

/** Statuts du pointage manuel : « excused » relève de la justification, jamais de l'appel. */
const MANUAL_STATUSES = Object.freeze(["present", "late", "absent"]);
const PRESENT_STATUSES = Object.freeze(new Set(["present", "late"]));

const ROLL_CALL_MODES = Object.freeze(["teacher", "direction"]);
const DIRECTION_ROLE_KEYS = Object.freeze(new Set(["PROVISEUR", "PRINCIPAL", "PREFET_ETUDES", "SCHOOL_ADMIN"]));
const PLATFORM_ROLE_KEYS = Object.freeze(new Set(["SUPER_ADMIN", "COUNTRY_ADMIN"]));
const DIRECTION_PERMISSION = "Présences:UPDATE";
const JUSTIFICATION_MIN = 10;
const JUSTIFICATION_MAX = 500;

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

function readMode(payload) {
  const mode = payload?.mode === undefined || payload?.mode === null ? "teacher" : String(payload.mode);
  if (!ROLL_CALL_MODES.includes(mode)) throw inputError("Mode d'appel invalide.");
  return mode;
}

function principalRoleKeys(principal) {
  const keys = new Set();
  for (const key of Array.isArray(principal?.roleKeys) ? principal.roleKeys : []) {
    keys.add(String(key ?? "").trim().toUpperCase());
  }
  if (principal?.roleKey) keys.add(String(principal.roleKey).trim().toUpperCase());
  keys.delete("");
  return keys;
}

function roleForbidden(message) {
  return createHttpError(403, message, ROLL_CALL_ERROR.ROLE_FORBIDDEN);
}

/** Clés canoniques uniquement : clé absente ou inconnue, ou rôle plateforme → refus. */
function authorizeRollCallActor(principal, mode) {
  const keys = principalRoleKeys(principal);
  if (keys.size === 0 || [...keys].some((key) => !isKnownRoleKey(key) || PLATFORM_ROLE_KEYS.has(key))) {
    throw roleForbidden("Appel réservé au personnel de l'établissement.");
  }
  if (mode === "teacher") {
    if (!keys.has("TEACHER")) {
      throw roleForbidden("L'appel enseignant est réservé aux enseignants affectés à la classe. La direction utilise l'appel exceptionnel.");
    }
    return;
  }
  const permissions = new Set(Array.isArray(principal?.permissions) ? principal.permissions : []);
  if (![...keys].some((key) => DIRECTION_ROLE_KEYS.has(key)) || !permissions.has(DIRECTION_PERMISSION)) {
    throw roleForbidden("Appel exceptionnel réservé à la direction autorisée.");
  }
}

/**
 * Rôles actifs relus en base pour l'établissement de la session : le JWT ne sert que d'identité.
 * Un rôle révoqué ou une clé présente dans le seul jeton ne donne donc aucun parcours.
 * Fail-closed : sans primitive de lecture des rôles, aucune clé n'est retenue.
 */
async function liveRollCallActor(repo, principal, schoolId) {
  let roleKeys = [];
  let userId = principalUserId(principal);
  if (userId && schoolId && typeof repo.listActiveUserRoleKeysForSchool === "function") {
    if (typeof repo.resolveCanonicalUserIdForSchool === "function") {
      const canonical = await repo.resolveCanonicalUserIdForSchool(userId, schoolId);
      if (canonical) userId = String(canonical).trim();
    }
    const loaded = await repo.listActiveUserRoleKeysForSchool(userId, schoolId);
    if (Array.isArray(loaded)) roleKeys = loaded;
  }
  return { ...principal, roleKeys, roleKey: undefined, canonicalUserId: userId };
}

/** Affectation exigée dès que la clé TEACHER est utilisée, quel que soit le libellé du compte. */
async function teacherAssignedToClass(repo, principal, classId, schoolId) {
  if (typeof repo.resolveTeacherPgIdForPrincipal !== "function") return null;
  const teacherId = await repo.resolveTeacherPgIdForPrincipal(principal, schoolId);
  if (!teacherId) return null;
  const assigned = await repo.one(
    `SELECT 1 AS ok FROM teacher_assignments
      WHERE teacher_id = $1 AND class_id::text = $2 AND status = 'active' LIMIT 1`,
    [teacherId, classId],
  );
  return assigned ? String(teacherId) : null;
}

async function assertRollCallClass(repo, scope, principal, classId, mode = "teacher") {
  const row = await repo.one(
    "SELECT id, class_code FROM classes WHERE id = $1::uuid AND school_id = $2::uuid AND lower(coalesce(status, 'active')) = 'active' LIMIT 1",
    [classId, scope.schoolId],
  );
  const teacherId = row?.id && mode === "teacher" ? await teacherAssignedToClass(repo, principal, classId, scope.schoolId) : null;
  if (!row?.id || (mode === "teacher" && !teacherId)) {
    throw createHttpError(403, "Accès refusé: classe hors de votre périmètre d'appel.", ROLL_CALL_ERROR.CLASS_FORBIDDEN);
  }
  return { classCode: row.class_code, teacherId };
}

function readJustification(payload) {
  const text = String(payload?.justification ?? "").replace(/\s+/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  if (text.length < JUSTIFICATION_MIN || text.length > JUSTIFICATION_MAX || /[\u0000-\u001f\u007f]/.test(text)) {
    throw createHttpError(
      400,
      `Justification obligatoire pour un appel exceptionnel (${JUSTIFICATION_MIN} à ${JUSTIFICATION_MAX} caractères).`,
      ROLL_CALL_ERROR.JUSTIFICATION_REQUIRED,
    );
  }
  return text;
}

async function assertRollCallEnabled(repo, schoolId) {
  await assertStudentCardMasterEnabled(repo, schoolId);
  await assertStudentCardAttendanceEnabled(repo, schoolId);
}

async function scanRollCallDraft(repo, payload, scope, principal, keys, now = Date.now()) {
  const context = readContext(payload);
  const mode = readMode(payload);
  const userId = principalUserId(principal);
  if (!userId) throw createHttpError(401, "Session invalide.");
  authorizeRollCallActor(await liveRollCallActor(repo, principal, scope.schoolId), mode);
  await assertRollCallEnabled(repo, scope.schoolId);
  await assertRollCallClass(repo, scope, principal, context.classId, mode);
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
    mod: mode,
    exp: expiresAt,
  });
  return {
    status: "accepted",
    receipt,
    dedupKey: dedupKeyFor(keys, context.sessionId, resolved.student.id),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function readReceipts(payload, keys, context, scope, userId, now, mode = "teacher", allowEmpty = false) {
  const receipts = payload?.receipts === undefined && allowEmpty ? [] : payload?.receipts;
  if (!Array.isArray(receipts) || (receipts.length === 0 && !allowEmpty)) throw inputError("Aucun scan à valider.");
  if (receipts.length > MAX_RECEIPTS) throw inputError("Trop de scans pour un seul appel.");
  // Chaque carte distincte est vérifiée, y compris si plusieurs cartes visent le même élève.
  // La déduplication par élève n'intervient qu'au moment d'écrire les présences.
  const byCard = new Map();
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
      || claims.usr !== userId || claims.ses !== context.sessionId || (claims.mod ?? "teacher") !== mode) {
      throw createHttpError(409, "Reçu de scan hors du contexte de cet appel.", ROLL_CALL_ERROR.CONTEXT_MISMATCH);
    }
    const cardKey = `${claims.stu}|${claims.crd}`;
    const cardEntry = byCard.get(cardKey) ?? { studentId: claims.stu, cardId: claims.crd, indexes: [] };
    cardEntry.indexes.push(index);
    byCard.set(cardKey, cardEntry);
    if (!byStudent.has(claims.stu)) {
      byStudent.set(claims.stu, { studentId: claims.stu });
    }
  }
  return { entries: [...byStudent.values()], cardEntries: [...byCard.values()], total: receipts.length };
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

/** Pointage manuel : liste explicite { studentId, status }, un élève au plus une fois. */
function readManual(payload) {
  const manual = payload?.manual;
  if (manual === undefined || manual === null) return [];
  if (!Array.isArray(manual)) throw inputError("Pointage manuel invalide.");
  if (manual.length > MAX_RECEIPTS) throw inputError("Trop d'élèves pour un seul appel.");
  const seen = new Set();
  return manual.map((item, index) => {
    const studentId = String(item?.studentId ?? "").trim().toLowerCase();
    const status = String(item?.status ?? "").trim().toLowerCase();
    if (!UUID.test(studentId)) throw inputError("Élève invalide dans le pointage manuel.");
    if (!MANUAL_STATUSES.includes(status)) throw inputError("Statut de pointage manuel invalide.");
    if (seen.has(studentId)) throw inputError("Un élève figure deux fois dans le pointage manuel.");
    seen.add(studentId);
    return { studentId, status, index };
  });
}

/**
 * Règle d'écrasement d'une présence existante (même établissement, élève, jour) :
 *  - aucune présence → création ;
 *  - même statut, ou déjà présent / en retard et pointé présent / en retard → inchangé ;
 *  - absent → présent ou en retard → correction (tracée) ;
 *  - tout le reste (dont `excused`, et présent → absent) → refusé, statut conservé.
 */
function attendanceTransition(existingStatus, wanted) {
  if (!existingStatus) return "create";
  if (existingStatus === wanted) return "unchanged";
  if (PRESENT_STATUSES.has(existingStatus) && PRESENT_STATUSES.has(wanted)) return "unchanged";
  if (existingStatus === "absent" && PRESENT_STATUSES.has(wanted)) return "correct";
  return "protected";
}

/** Élèves pointés manuellement : inscription active dans la classe de l'appel exigée. */
async function assertManualStudentsEnrolled(repo, schoolId, classId, manual) {
  if (manual.length === 0) return;
  const rows = await repo.all(
    `SELECT DISTINCT e.student_id::text AS student_id FROM enrollments e
      WHERE e.school_id = $1::uuid AND e.class_id = $2::uuid AND e.student_id = ANY($3::uuid[])
        AND ${ROSTER_ENROLLMENT_SQL}`,
    [schoolId, classId, manual.map((item) => item.studentId)],
  );
  const enrolled = new Set(rows.map((row) => String(row.student_id).toLowerCase()));
  const missing = manual.filter((item) => !enrolled.has(item.studentId));
  if (missing.length > 0) {
    const error = createHttpError(
      403,
      "Pointage manuel refusé : élève non inscrit dans cette classe.",
      ROLL_CALL_ERROR.STUDENT_NOT_ENROLLED,
    );
    error.details = { invalidManualIndexes: missing.map((item) => item.index) };
    throw error;
  }
}

/**
 * Verrou transactionnel par établissement et date : les appels Enseignant et Direction d'une même
 * journée sont sérialisés (libéré à la fin de la transaction de withIdempotency).
 */
async function lockRollCallDay(repo, schoolId, date) {
  await repo.one(
    "SELECT pg_advisory_xact_lock(hashtext('attendance-roll-call'), hashtext($1::text || ':' || $2::text)) AS locked",
    [schoolId, date],
  );
}

/** Journal : une ligne par session validée ; une seconde validation de la session est refusée. */
async function recordRollCallJournal(repo, row) {
  const inserted = await repo.one(
    `INSERT INTO attendance_roll_calls (
       school_id, class_id, roll_call_date, session_id, mode, author_user_id, author_role_keys,
       teacher_id, justification, scanned_count, manual_count, created_count, corrected_count,
       unchanged_count, protected_count
     )
     VALUES ($1::uuid, $2::uuid, $3::date, $4::uuid, $5, $6::uuid, $7::text[], $8::uuid, $9,
             $10, $11, $12, $13, $14, $15)
     ON CONFLICT (school_id, session_id) DO NOTHING
     RETURNING id, validated_at`,
    [
      row.schoolId, row.classId, row.date, row.sessionId, row.mode, row.authorUserId, row.authorRoleKeys,
      row.teacherId ?? null, row.justification ?? null, row.scanned, row.manual, row.created, row.corrected,
      row.unchanged, row.protectedCount,
    ],
  );
  if (!inserted?.id) {
    throw createHttpError(409, "Cet appel a déjà été validé.", ROLL_CALL_ERROR.ALREADY_VALIDATED);
  }
  return { id: String(inserted.id), validatedAt: new Date(inserted.validated_at).toISOString() };
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
  const mode = readMode(payload);
  const userId = principalUserId(principal);
  if (!userId) throw createHttpError(401, "Session invalide.");
  const actor = await liveRollCallActor(repo, principal, scope.schoolId);
  authorizeRollCallActor(actor, mode);
  const justification = mode === "direction" ? readJustification(payload) : null;
  const manual = readManual(payload);
  if (mode === "direction" && manual.length > 0) {
    // L'appel exceptionnel reste limité aux cartes : aucun pointage nominatif par la direction.
    throw createHttpError(403, "Pointage manuel réservé à l'enseignant affecté à la classe.", ROLL_CALL_ERROR.MANUAL_FORBIDDEN);
  }
  const { entries, cardEntries, total } = readReceipts(
    payload, keys, context, scope, userId, now, mode, manual.length > 0,
  );
  const scanned = new Set(entries.map((entry) => entry.studentId));
  if (manual.some((item) => scanned.has(item.studentId))) {
    throw inputError("Un élève ne peut pas être à la fois scanné et pointé manuellement.");
  }
  await assertRollCallEnabled(repo, scope.schoolId);
  const target = await assertRollCallClass(repo, scope, principal, context.classId, mode);
  await assertCardsStillValid(repo, scope.schoolId, cardEntries);
  if (mode === "direction") {
    return writeDirectionRollCall(repo, { scope, principal, actor, userId, context, entries, total, justification, target, auditMeta });
  }
  await assertManualStudentsEnrolled(repo, scope.schoolId, context.classId, manual);
  return writeTeacherRollCall(repo, { scope, principal, actor, userId, context, entries, cardEntries, manual, total, target, auditMeta });
}

/**
 * Parcours enseignant : la présence est attribuée à l'enseignant authentifié lui-même ; aucun
 * identifiant d'enseignant envoyé par le client n'est jamais pris en compte. Les présences
 * existantes sont lues verrouillées puis classées par attendanceTransition ; seules les
 * créations et les corrections autorisées sont écrites, via upsertAttendance (établissement,
 * inscription, affectation et auteur revérifiés).
 */
async function writeTeacherRollCall(repo, { scope, principal, actor, userId, context, entries, cardEntries, manual, total, target, auditMeta }) {
  // Ordre déterministe (par élève) : verrous de lignes toujours pris dans le même ordre.
  const wanted = [
    ...entries.map((entry) => ({ studentId: entry.studentId, status: "present", source: "card" })),
    ...manual.map((item) => ({ studentId: item.studentId, status: item.status, source: "manual", index: item.index })),
  ].sort((a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));
  await lockRollCallDay(repo, scope.schoolId, context.date);
  const readExisting = async (studentIds) => new Map((await repo.all(
    `SELECT id, student_id, status FROM attendance
      WHERE school_id = $1::uuid AND attendance_date = $2::date AND student_id = ANY($3::uuid[])
      ORDER BY student_id
      FOR UPDATE`,
    [scope.schoolId, context.date, studentIds],
  )).map((row) => [String(row.student_id).toLowerCase(), row]));
  const ownTeacher = principal?.role === "Enseignant" ? {} : { teacherId: target.teacherId };
  const written = [];
  const corrections = [];
  const protectedRows = [];
  let created = 0;
  let unchanged = 0;
  // Écriture conditionnelle atomique : création seulement si aucune présence n'existe, correction
  // seulement si la présence est encore `absent`. Un écrivain concurrent (saisie classique,
  // pointage individuel) qui a écrit entre la lecture et l'écriture fait échouer la garde : la
  // présence est relue et la règle réappliquée, sans jamais l'écraser.
  let pending = wanted;
  for (let attempt = 0; pending.length > 0; attempt += 1) {
    if (attempt > 2) {
      throw createHttpError(409, "Présences modifiées pendant l'appel : validez à nouveau.", ROLL_CALL_ERROR.CONCURRENT_UPDATE);
    }
    const existing = await readExisting(pending.map((item) => item.studentId));
    const toWrite = [];
    for (const item of pending) {
      const row = existing.get(item.studentId);
      const transition = attendanceTransition(row?.status ?? null, item.status);
      if (transition === "unchanged") unchanged += 1;
      else if (transition === "protected") protectedRows.push({ ...item, existingStatus: row.status });
      else toWrite.push({ item, row, guard: transition === "create" ? "create" : "correct_absent" });
    }
    if (toWrite.length === 0) break;
    const saved = await repo.upsertSchoolAttendanceBatch(
      {
        items: toWrite.map(({ item }) => ({
          studentId: item.studentId, classId: context.classId, date: context.date, status: item.status, ...ownTeacher,
        })),
      },
      principal,
      auditMeta,
      { writeGuards: toWrite.map(({ guard }) => ({ mode: guard })) },
    );
    pending = [];
    toWrite.forEach(({ item, row, guard }, index) => {
      if (!Array.isArray(saved) || !saved[index]) {
        pending.push(item);
        return;
      }
      written.push(item);
      if (guard === "create") created += 1;
      else corrections.push({ attendanceId: String(row.id), studentId: item.studentId, from: row.status, to: item.status });
    });
  }
  const authorRoleKeys = [...principalRoleKeys(actor)].sort();
  const journal = await recordRollCallJournal(repo, {
    schoolId: scope.schoolId,
    classId: context.classId,
    date: context.date,
    sessionId: context.sessionId,
    mode: "teacher",
    authorUserId: actor.canonicalUserId || userId,
    authorRoleKeys,
    teacherId: target.teacherId,
    scanned: entries.length,
    manual: manual.length,
    created,
    corrected: corrections.length,
    unchanged,
    protectedCount: protectedRows.length,
  });
  await repo.recordAudit({
    schoolCode: principal?.presenceLoginCode || principal?.schoolCode,
    userId: actor.canonicalUserId || userId,
    action: "student_card_roll_call_teacher",
    entityType: "attendance_roll_call",
    entityId: journal.id,
    newValue: {
      mode: "teacher",
      sessionId: context.sessionId,
      classId: context.classId,
      date: context.date,
      authorRoleKeys,
      scanned: entries.length,
      manual: manual.length,
      created,
      unchanged,
      // Corrections tracées : statut précédent et nouveau statut, jamais d'écrasement silencieux.
      corrections,
      protected: protectedRows.map((row) => ({ studentId: row.studentId, kept: row.existingStatus, requested: row.status })),
    },
    ipAddress: auditMeta?.ipAddress,
    userAgent: auditMeta?.userAgent,
  });
  // Positions des scans refusés (sans identité) ; élèves du pointage manuel (liste déjà nominative).
  const protectedCards = new Set(protectedRows.filter((row) => row.source === "card").map((row) => row.studentId));
  return {
    statusCode: 201,
    body: {
      mode: "teacher",
      rollCallId: journal.id,
      validatedAt: journal.validatedAt,
      recorded: written.length,
      created,
      corrected: corrections.length,
      unchanged,
      protected: protectedRows.length,
      absent: written.filter((item) => item.status === "absent").length,
      manual: manual.length,
      duplicatesIgnored: total - entries.length,
      protectedReceiptIndexes: cardEntries
        .filter((entry) => protectedCards.has(entry.studentId))
        .flatMap((entry) => entry.indexes)
        .sort((a, b) => a - b),
      protectedManualIndexes: protectedRows.filter((row) => row.source === "manual").map((row) => row.index),
      classId: context.classId,
      date: context.date,
    },
  };
}

/**
 * Appel exceptionnel de la direction, dans la transaction de withIdempotency : inscription
 * revérifiée pour chaque élève, présence écrite sans enseignant, audit avec l'auteur réel et la
 * justification. Une présence déjà enregistrée, quel que soit son statut, n'est jamais modifiée :
 * statut, motif et auteur sont conservés (correction éventuelle par le pointage individuel).
 */
async function writeDirectionRollCall(repo, { scope, principal, actor, userId, context, entries, total, justification, target, auditMeta }) {
  const attendanceIds = [];
  let alreadyRecorded = 0;
  await lockRollCallDay(repo, scope.schoolId, context.date);
  const ordered = [...entries].sort((a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));
  for (const entry of ordered) {
    const student = await repo.resolveStudentForAttendance(
      { studentId: entry.studentId, classId: context.classId },
      principal,
      { pedagogyStrict: true },
    );
    if (!student) throw createHttpError(404, "Élève ou classe introuvable pour l'appel.");
    await repo.assertPrincipalStudentTenant(principal, student);
    const enrolledHere = String(student.school_id) === String(scope.schoolId) && activeEnrollmentMatchesRequestedClass(
      { classId: student.class_id, classCode: student.class_code, status: "active" },
      { classId: context.classId, classCode: target.classCode },
    );
    if (!enrolledHere) throw createHttpError(403, "Accès refusé: élève non inscrit dans cette classe.");
    const row = await repo.one(
      `INSERT INTO attendance (school_id, student_id, class_id, teacher_id, attendance_date, status, reason)
       VALUES ($1, $2, $3, NULL, $4::date, 'present', NULL)
       ON CONFLICT (school_id, student_id, attendance_date) DO NOTHING
       RETURNING id`,
      [scope.schoolId, entry.studentId, context.classId, context.date],
    );
    if (row?.id) attendanceIds.push(String(row.id));
    else alreadyRecorded += 1;
  }
  const journal = await recordRollCallJournal(repo, {
    schoolId: scope.schoolId,
    classId: context.classId,
    date: context.date,
    sessionId: context.sessionId,
    mode: "direction",
    authorUserId: actor.canonicalUserId || userId,
    authorRoleKeys: [...principalRoleKeys(actor)].sort(),
    teacherId: null,
    justification,
    scanned: entries.length,
    manual: 0,
    created: attendanceIds.length,
    corrected: 0,
    unchanged: 0,
    // L'appel de direction ne modifie jamais une présence existante.
    protectedCount: alreadyRecorded,
  });
  await repo.recordAudit({
    schoolCode: principal?.presenceLoginCode || principal?.schoolCode,
    userId: actor.canonicalUserId || userId,
    action: "student_card_roll_call_direction",
    entityType: "attendance_roll_call",
    entityId: context.sessionId,
    newValue: {
      mode: "direction",
      classId: context.classId,
      date: context.date,
      justification,
      authorRoleKeys: [...principalRoleKeys(actor)].sort(),
      recorded: attendanceIds.length,
      alreadyRecorded,
      attendanceIds,
    },
    ipAddress: auditMeta?.ipAddress,
    userAgent: auditMeta?.userAgent,
  });
  return {
    statusCode: 201,
    body: {
      mode: "direction",
      rollCallId: journal.id,
      validatedAt: journal.validatedAt,
      recorded: attendanceIds.length,
      alreadyRecorded,
      duplicatesIgnored: total - entries.length,
      classId: context.classId,
      date: context.date,
    },
  };
}

function readOverviewDate(query) {
  const date = String(query?.date ?? "").trim() || new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw inputError("Date invalide.");
  }
  return date;
}

/** Supervision de direction : effectifs et état des appels par classe, sans aucune donnée d'élève. */
async function rollCallOverview(repo, query, scope, principal) {
  const keys = principalRoleKeys(await liveRollCallActor(repo, principal, scope.schoolId));
  if (keys.size === 0 || [...keys].some((key) => !isKnownRoleKey(key) || PLATFORM_ROLE_KEYS.has(key))
    || ![...keys].some((key) => DIRECTION_ROLE_KEYS.has(key))) {
    throw roleForbidden("Supervision des appels réservée à la direction.");
  }
  const date = readOverviewDate(query);
  const rows = await repo.all(
    `SELECT c.id, c.class_code, c.name,
            (SELECT count(*)::int FROM enrollments e
              WHERE e.school_id = c.school_id AND e.class_id = c.id AND ${ROSTER_ENROLLMENT_SQL}) AS enrolled,
            count(a.id) FILTER (WHERE a.status = 'present')::int AS present,
            count(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
            count(a.id) FILTER (WHERE a.status = 'late')::int AS late,
            count(a.id) FILTER (WHERE a.status = 'excused')::int AS excused,
            max(a.updated_at) AS last_update
       FROM classes c
       LEFT JOIN attendance a ON a.school_id = c.school_id AND a.class_id = c.id AND a.attendance_date = $2::date
      WHERE c.school_id = $1::uuid AND lower(coalesce(c.status, 'active')) = 'active'
      GROUP BY c.id, c.class_code, c.name
      ORDER BY c.class_code`,
    [scope.schoolId, date],
  );
  return {
    date,
    classes: rows.map((row) => {
      const recorded = row.present + row.absent + row.late + row.excused;
      return {
        classId: String(row.id),
        classCode: row.class_code,
        className: row.name,
        enrolled: row.enrolled,
        present: row.present,
        absent: row.absent,
        late: row.late,
        excused: row.excused,
        recorded,
        notRecorded: Math.max(0, row.enrolled - recorded),
        status: recorded === 0 ? "not_started" : recorded >= row.enrolled ? "complete" : "partial",
        lastUpdatedAt: row.last_update ? new Date(row.last_update).toISOString() : null,
      };
    }),
  };
}

module.exports = {
  ROLL_CALL_ERROR,
  ROLL_CALL_MODES,
  DIRECTION_ROLE_KEYS,
  JUSTIFICATION_MIN,
  JUSTIFICATION_MAX,
  RECEIPT_TTL_MS,
  MAX_RECEIPTS,
  deriveRollCallKeys,
  sealReceipt,
  openReceipt,
  dedupKeyFor,
  readContext,
  readReceipts,
  readManual,
  attendanceTransition,
  MANUAL_STATUSES,
  assertCardsStillValid,
  assertOperationKey,
  authorizeRollCallActor,
  readJustification,
  scanRollCallDraft,
  validateRollCall,
  rollCallOverview,
};
