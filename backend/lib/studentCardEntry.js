"use strict";

/**
 * CARTE-PR3-A1 — contrôle d'entrée au portail de l'établissement.
 *
 * Un passage au portail est un événement distinct d'une présence en classe : il est écrit dans
 * `school_entry_events`, jamais dans `attendance`. Une seule entrée par élève, par jour local et
 * par établissement ; un doublon NFC/QR renvoie l'entrée existante sans créer de second
 * événement. L'établissement et la classe sont résolus côté serveur à partir de la carte.
 *
 * Autorisation (fail-closed) :
 *  - permission dédiée `Contrôle d'entrée:CREATE` / `:READ`, revalidée par requirePermission ;
 *  - clés de rôle relues en base pour l'établissement : direction ou secrétariat pour scanner,
 *    plus SCHOOL_ADMIN en consultation ; aucune clé inconnue, plateforme ou familiale.
 * Les impayés sont une information non bloquante, renvoyée seulement avec la permission finance
 * et l'interrupteur de l'établissement.
 */

const { createHttpError } = require("./classesManagement");
const { scanStudentCard } = require("./studentAccessCardsManagement");
const { isKnownRoleKey } = require("./userRoleLifecycle");
const { resolveSchoolTimeZone } = require("./planningWeeklyOccurrences");
const { liveSchoolActor } = require("./liveSchoolRoleKeys");
const { ROSTER_ENROLLMENT_SQL } = require("./studentEnrollmentC18");

const ENTRY_ERROR = Object.freeze({
  INPUT_INVALID: "ENTRY_INPUT_INVALID",
  ROLE_FORBIDDEN: "ENTRY_ROLE_FORBIDDEN",
  OPERATION_CONFLICT: "ENTRY_OPERATION_CONFLICT",
});

/** Rôles autorisés à scanner au portail (avec la permission dédiée). */
const ENTRY_SCAN_ROLE_KEYS = Object.freeze(new Set(["PROVISEUR", "PRINCIPAL", "PREFET_ETUDES", "SECRETARY"]));
/** Rôles autorisés à consulter les entrées (avec la permission dédiée). */
const ENTRY_READ_ROLE_KEYS = Object.freeze(new Set([...ENTRY_SCAN_ROLE_KEYS, "SCHOOL_ADMIN"]));
/** Rôles du personnel d'établissement : toute autre clé (plateforme, famille, inconnue) refuse. */
const SCHOOL_STAFF_ROLE_KEYS = Object.freeze(new Set([
  "PROVISEUR", "PRINCIPAL", "PREFET_ETUDES", "SCHOOL_ADMIN", "SECRETARY", "TEACHER", "SUPERVISOR", "ACCOUNTANT",
]));
const MEDIA = Object.freeze(["nfc", "qr"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function inputError(message) {
  return createHttpError(400, message, ENTRY_ERROR.INPUT_INVALID);
}

function roleForbidden(message) {
  return createHttpError(403, message, ENTRY_ERROR.ROLE_FORBIDDEN);
}

function assertEntryActor(roleKeys, allowed) {
  const keys = roleKeys.filter(Boolean);
  if (keys.length === 0 || keys.some((key) => !isKnownRoleKey(key) || !SCHOOL_STAFF_ROLE_KEYS.has(key))) {
    throw roleForbidden("Contrôle d'entrée réservé au personnel autorisé de l'établissement.");
  }
  if (!keys.some((key) => allowed.has(key))) {
    throw roleForbidden("Votre rôle ne permet pas le contrôle d'entrée.");
  }
}

function readEntryPayload(payload) {
  const cardToken = typeof payload?.cardToken === "string" ? payload.cardToken.trim() : "";
  const medium = String(payload?.medium ?? "").trim().toLowerCase();
  const operationId = String(payload?.operationId ?? "").trim().toLowerCase();
  if (!cardToken || cardToken.length > 512) throw inputError("Carte illisible.");
  if (!MEDIA.includes(medium)) throw inputError("Mode de lecture invalide.");
  if (!UUID_RE.test(operationId)) throw inputError("Identifiant d'opération invalide.");
  return { cardToken, medium, operationId };
}

/** L'en-tête Idempotency-Key doit être l'identifiant d'opération : un rejeu reste la même opération. */
function assertEntryOperationKey(idempotencyKey, operationId) {
  if (String(idempotencyKey ?? "").trim().toLowerCase() !== operationId) {
    throw inputError("Idempotency-Key doit être l'identifiant d'opération du scan.");
  }
}

async function schoolTimeZone(repo, schoolId) {
  const row = await repo.one(
    "SELECT profile_payload->>'timezone' AS timezone FROM schools WHERE id = $1::uuid LIMIT 1",
    [schoolId],
  );
  return resolveSchoolTimeZone(row?.timezone);
}

function isoDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

async function schoolLocalDate(repo, timeZone, requested = null) {
  const row = await repo.one(
    "SELECT COALESCE($1::date, (clock_timestamp() AT TIME ZONE $2)::date)::text AS d",
    [requested, timeZone],
  );
  return isoDate(row.d);
}

function mapEntryRow(row) {
  return {
    id: String(row.id),
    enteredAt: new Date(row.occurred_at).toISOString(),
    localDate: isoDate(row.local_date),
  };
}

async function entryFinance(repo, resolved, deps) {
  if (typeof deps?.finance !== "function") return undefined;
  try {
    return await deps.finance(resolved);
  } catch {
    // Information non bloquante : une erreur finance ne refuse jamais l'entrée.
    return { status: "UNAVAILABLE" };
  }
}

/**
 * Scan au portail. À appeler dans withIdempotency (transaction) : l'insertion et l'audit sont
 * atomiques, un rejeu de la même opération renvoie la réponse enregistrée.
 */
async function recordEntryScan(repo, payload, scope, principal, auditMeta, deps = {}) {
  const input = readEntryPayload(payload);
  const actor = await liveSchoolActor(repo, principal, scope.schoolId);
  assertEntryActor(actor.roleKeys, ENTRY_SCAN_ROLE_KEYS);
  // Mêmes refus que le pointage : inconnue, étrangère, révoquée, perdue, en attente, sans inscription.
  const resolved = await scanStudentCard(repo, { cardToken: input.cardToken }, scope);
  const timeZone = await schoolTimeZone(repo, scope.schoolId);
  // Date locale calculée une seule fois (horloge du serveur PostgreSQL, fuseau de l'établissement).
  const localDate = await schoolLocalDate(repo, timeZone);
  const inserted = await repo.one(
    `INSERT INTO school_entry_events (
       school_id, student_id, card_id, class_id, academic_year_id, event_type, local_date,
       medium, recorded_by, recorded_by_role_keys, operation_id
     )
     VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       (SELECT academic_year_id FROM classes WHERE id = $4::uuid AND school_id = $1::uuid),
       'entry', $5::date,
       $6, $7::uuid, $8::text[], $9::uuid
     )
     ON CONFLICT DO NOTHING
     RETURNING id, occurred_at, local_date`,
    [
      scope.schoolId, resolved.student.id, resolved.card.id, resolved.class?.id ?? null,
      localDate, input.medium, actor.userId, actor.roleKeys, input.operationId,
    ],
  );
  let status = "entered";
  let entry;
  if (inserted?.id) {
    entry = mapEntryRow(inserted);
    await repo.recordAudit({
      schoolCode: principal?.presenceLoginCode || principal?.schoolCode,
      userId: actor.userId,
      action: "student_card_entry",
      entityType: "school_entry_event",
      entityId: entry.id,
      newValue: {
        studentId: resolved.student.id,
        classId: resolved.class?.id ?? null,
        localDate: entry.localDate,
        medium: input.medium,
        authorRoleKeys: actor.roleKeys,
      },
      ipAddress: auditMeta?.ipAddress,
      userAgent: auditMeta?.userAgent,
    });
  } else {
    const existing = await repo.one(
      `SELECT id, occurred_at, local_date FROM school_entry_events
        WHERE school_id = $1::uuid AND student_id = $2::uuid AND event_type = 'entry'
          AND local_date = $3::date
        LIMIT 1`,
      [scope.schoolId, resolved.student.id, localDate],
    );
    if (!existing?.id) {
      // Conflit sur l'identifiant d'opération avec un autre élève : jamais d'événement ambigu.
      throw createHttpError(409, "Identifiant d'opération déjà utilisé pour un autre passage.", ENTRY_ERROR.OPERATION_CONFLICT);
    }
    status = "already_entered";
    entry = mapEntryRow(existing);
  }
  const finance = await entryFinance(repo, resolved, deps);
  return {
    statusCode: status === "entered" ? 201 : 200,
    body: {
      status,
      entry,
      student: resolved.student,
      class: resolved.class,
      ...(finance ? { finance } : {}),
    },
  };
}

function readEntriesDate(query) {
  const raw = String(query?.date ?? "").trim();
  if (!raw) return null;
  if (!ISO_DATE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))
    || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) {
    throw inputError("Date invalide.");
  }
  return raw;
}

/** Consultation : entrés et inscrits par classe active, sans aucune donnée d'élève. */
async function listEntriesOverview(repo, query, scope, principal) {
  const actor = await liveSchoolActor(repo, principal, scope.schoolId);
  assertEntryActor(actor.roleKeys, ENTRY_READ_ROLE_KEYS);
  const timeZone = await schoolTimeZone(repo, scope.schoolId);
  const requested = readEntriesDate(query);
  const date = await schoolLocalDate(repo, timeZone, requested);
  const rows = await repo.all(
    `SELECT c.id, c.class_code, c.name,
            (SELECT count(*)::int FROM enrollments e
              WHERE e.school_id = c.school_id AND e.class_id = c.id AND ${ROSTER_ENROLLMENT_SQL}) AS enrolled,
            (SELECT count(*)::int FROM school_entry_events se
              WHERE se.school_id = c.school_id AND se.class_id = c.id
                AND se.event_type = 'entry' AND se.local_date = $2::date) AS entered
       FROM classes c
      WHERE c.school_id = $1::uuid AND lower(coalesce(c.status, 'active')) = 'active'
      ORDER BY c.class_code`,
    [scope.schoolId, date],
  );
  const classes = rows.map((row) => ({
    classId: String(row.id),
    classCode: row.class_code,
    className: row.name,
    enrolled: Number(row.enrolled) || 0,
    entered: Number(row.entered) || 0,
    notEntered: Math.max(0, (Number(row.enrolled) || 0) - (Number(row.entered) || 0)),
  }));
  return {
    date,
    timeZone,
    totals: classes.reduce(
      (acc, row) => ({ enrolled: acc.enrolled + row.enrolled, entered: acc.entered + row.entered }),
      { enrolled: 0, entered: 0 },
    ),
    classes,
  };
}

module.exports = {
  ENTRY_ERROR,
  ENTRY_SCAN_ROLE_KEYS,
  ENTRY_READ_ROLE_KEYS,
  readEntryPayload,
  assertEntryOperationKey,
  assertEntryActor,
  recordEntryScan,
  listEntriesOverview,
};
