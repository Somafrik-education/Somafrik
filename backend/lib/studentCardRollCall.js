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
 */

const crypto = require("node:crypto");
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
});

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
  return { ...principal, roleKeys, roleKey: undefined };
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

function readReceipts(payload, keys, context, scope, userId, now, mode = "teacher") {
  const receipts = payload?.receipts;
  if (!Array.isArray(receipts) || receipts.length === 0) throw inputError("Aucun scan à valider.");
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
  const { entries, cardEntries, total } = readReceipts(payload, keys, context, scope, userId, now, mode);
  await assertRollCallEnabled(repo, scope.schoolId);
  const target = await assertRollCallClass(repo, scope, principal, context.classId, mode);
  await assertCardsStillValid(repo, scope.schoolId, cardEntries);
  if (mode === "direction") {
    return writeDirectionRollCall(repo, { scope, principal, actor, userId, context, entries, total, justification, target, auditMeta });
  }
  // Parcours enseignant : la présence est attribuée à l'enseignant authentifié lui-même ;
  // aucun identifiant d'enseignant envoyé par le client n'est jamais pris en compte.
  const ownTeacher = principal?.role === "Enseignant" ? {} : { teacherId: target.teacherId };
  const items = entries.map((entry) => ({
    studentId: entry.studentId,
    classId: context.classId,
    date: context.date,
    status: "present",
    ...ownTeacher,
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

/**
 * Appel exceptionnel de la direction, dans la transaction de withIdempotency : inscription
 * revérifiée pour chaque élève, présence écrite sans enseignant, audit avec l'auteur réel et la
 * justification. Une présence déjà enregistrée, quel que soit son statut, n'est jamais modifiée :
 * statut, motif et auteur sont conservés (correction éventuelle par le pointage individuel).
 */
async function writeDirectionRollCall(repo, { scope, principal, actor, userId, context, entries, total, justification, target, auditMeta }) {
  const attendanceIds = [];
  let alreadyRecorded = 0;
  for (const entry of entries) {
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
  await repo.recordAudit({
    schoolCode: principal?.presenceLoginCode || principal?.schoolCode,
    userId,
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
              WHERE e.school_id = c.school_id AND e.class_id = c.id AND upper(coalesce(e.status, '')) = 'ENROLLED') AS enrolled,
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
  assertCardsStillValid,
  assertOperationKey,
  authorizeRollCallActor,
  readJustification,
  scanRollCallDraft,
  validateRollCall,
  rollCallOverview,
};
