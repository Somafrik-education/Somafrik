"use strict";

/**
 * NFC-PRES-LOCAL-PR1b — émission du pack signé d'appel hors ligne.
 *
 * GET /api/student-cards/roll-call/offline/v1/pack?classId=<uuid>&date=<YYYY-MM-DD>
 *
 * Contrat : docs/audits/NFC-PRES-LOCAL-PR0-architecture-offline-20261107.md (§4).
 * Le pack est INDICATIF : il permet une reconnaissance locale provisoire des cartes et n'accorde
 * aucun droit. Aucune écriture : ni présence, ni journal, ni audit de mutation.
 *
 * Autorisations relues à chaque appel (fail-closed) : établissement résolu en base, rôle TEACHER
 * actif relu en base, affectation active à la classe, flags maître + présences, au moins un support
 * (NFC ou QR) activé, gate d'abonnement `write_presence` et permission effective (route).
 *
 * Le pack ne contient jamais `token_hash`, secret de carte, `publicId`, UID NFC ni identifiant de
 * carte : uniquement `cardRef` et `verifier` (primitives de rollCallOfflineProof.js).
 */

const crypto = require("node:crypto");
const { createHttpError } = require("./classesManagement");
const { ROSTER_ENROLLMENT_SQL } = require("./studentEnrollmentC18");
const { resolveSchoolTimeZone } = require("./planningWeeklyOccurrences");
const { isStudentCardCapabilityEnabled, mapSettingsRow } = require("./schoolSettingsManagement");
const { createSchoolSettingsPgStore } = require("../db/schoolSettingsPgStore");
const {
  CONTRACT_VERSION,
  ROLL_CALL_MODE,
  lp,
  cardKeyFromTokenHash,
  computeCardRef,
  computeVerifier,
  canonicalJson,
} = require("./rollCallOfflineProof");
const {
  liveRollCallActor,
  authorizeRollCallActor,
  assertRollCallEnabled,
  assertRollCallClass,
} = require("./studentCardRollCall");

const PACK_VERSION = 1;
const MATCH_KEY_LABEL = "student-card-roll-call:offline-match:v1";

const OFFLINE_PACK_ERROR = Object.freeze({
  INPUT_INVALID: "ROLL_CALL_INPUT_INVALID",
  DATE_OUT_OF_RANGE: "ROLL_CALL_PACK_DATE_OUT_OF_RANGE",
  MEDIA_DISABLED: "ROLL_CALL_OFFLINE_MEDIA_DISABLED",
  TIMEZONE_INVALID: "ROLL_CALL_OFFLINE_TIMEZONE_INVALID",
  PACK_TOO_LARGE: "ROLL_CALL_PACK_TOO_LARGE",
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ATTENDANCE_STATUSES = new Set(["present", "late", "absent", "excused"]);
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SEARCH_SPAN_MS = 18 * HOUR_MS; // couvre tous les décalages IANA (−12 h … +14 h)

function inputError(message) {
  return createHttpError(400, message, OFFLINE_PACK_ERROR.INPUT_INVALID);
}

/** Lecture stricte : UUID en minuscules et date calendaire réelle, sans normalisation. */
function readPackQuery(query) {
  const classId = typeof query?.classId === "string" ? query.classId : "";
  const date = typeof query?.date === "string" ? query.date : "";
  if (!UUID.test(classId)) throw inputError("Classe invalide.");
  const parsed = ISO_DATE.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw inputError("Date d'appel invalide.");
  }
  return { classId, date };
}

// ---------------------------------------------------------------------------------------------
// Fenêtre temporelle dans le fuseau IANA de l'établissement (jamais « + 24 h » en UTC).
// ---------------------------------------------------------------------------------------------

const formatters = new Map();

function wallFormatter(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Heure murale locale de l'instant `ms`, sous la forme comparable « YYYY-MM-DDTHH:MM:SS ». */
function wallTime(timeZone, ms) {
  const parts = Object.fromEntries(wallFormatter(timeZone).formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function wallAsUtcMs(wall) {
  const [date, time] = wall.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, ss);
}

/**
 * Premier instant dont l'heure murale locale est ≥ `targetWall`.
 *  - heure existante une fois : l'instant exact ;
 *  - heure répétée (passage à l'heure d'hiver) : la première occurrence ;
 *  - heure inexistante (passage à l'heure d'été, y compris à minuit) : l'instant du saut.
 */
function firstInstantAtOrAfterWall(timeZone, targetWall) {
  const nominal = wallAsUtcMs(targetWall);
  const offsets = new Set(
    [nominal - SEARCH_SPAN_MS, nominal, nominal + SEARCH_SPAN_MS].map((ms) => wallAsUtcMs(wallTime(timeZone, ms)) - ms),
  );
  const exact = [...offsets]
    .map((offset) => nominal - offset)
    .filter((candidate) => wallTime(timeZone, candidate) === targetWall)
    .sort((a, b) => a - b);
  if (exact.length > 0) return exact[0];
  // Heure inexistante : recherche dichotomique à la seconde du premier instant au-delà de la cible.
  let low = nominal - SEARCH_SPAN_MS;
  let high = nominal + SEARCH_SPAN_MS;
  while (high - low > 1000) {
    const middle = low + Math.floor((high - low) / 2000) * 1000;
    if (wallTime(timeZone, middle) >= targetWall) high = middle;
    else low = middle;
  }
  return high;
}

function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Bornes du pack pour la date D (contrat §4.5), en millisecondes UTC :
 *  issueFrom = D−1 12:00 ; notBefore = D 00:00 ; expiresAt = D+1 00:00 (exclusif) ;
 *  syncDeadline = D+4 00:00.
 */
function computePackWindow(timeZone, date) {
  return Object.freeze({
    issueFrom: firstInstantAtOrAfterWall(timeZone, `${shiftDate(date, -1)}T12:00:00`),
    notBefore: firstInstantAtOrAfterWall(timeZone, `${date}T00:00:00`),
    expiresAt: firstInstantAtOrAfterWall(timeZone, `${shiftDate(date, 1)}T00:00:00`),
    syncDeadline: firstInstantAtOrAfterWall(timeZone, `${shiftDate(date, 4)}T00:00:00`),
  });
}

/** Émission autorisée si issueFrom ≤ now < expiresAt. */
function assertIssuanceWindow(window, nowMs) {
  if (!(nowMs >= window.issueFrom && nowMs < window.expiresAt)) {
    throw createHttpError(
      409,
      "Pack hors ligne disponible de la veille 12:00 jusqu'à la fin du jour de l'appel, heure de l'établissement.",
      OFFLINE_PACK_ERROR.DATE_OUT_OF_RANGE,
    );
  }
}

/** Instant ISO-8601 UTC à la seconde (format du contrat : « 2026-11-08T16:02:00Z »). */
function isoSeconds(ms) {
  return `${new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}

// ---------------------------------------------------------------------------------------------
// Éligibilité des cartes et construction du pack (fonctions pures).
// ---------------------------------------------------------------------------------------------

/**
 * Carte éligible : active, encodage NFC non en attente, et au moins un support activé qu'elle porte :
 *  - NFC : flag NFC, support nfc / nfc_qr, encodage `encoded` ou `locked` ;
 *  - QR : flag QR, support qr / nfc_qr.
 */
function isCardEligible(card, media) {
  if (!card || card.status !== "active" || card.nfc_encoding_state === "pending") return false;
  const nfc = media.nfc && (card.medium === "nfc" || card.medium === "nfc_qr")
    && (card.nfc_encoding_state === "encoded" || card.nfc_encoding_state === "locked");
  const qr = media.qr && (card.medium === "qr" || card.medium === "nfc_qr");
  return Boolean(nfc || qr);
}

function deriveMatchKeySecret(masterSecret) {
  const master = String(masterSecret ?? "");
  if (master.length < 16) throw new Error("Secret serveur insuffisant pour l'appel hors ligne.");
  return Buffer.from(crypto.hkdfSync("sha256", master, "somafrik", MATCH_KEY_LABEL, 32));
}

/** matchKey = base64url(HMAC(clé dérivée, LP(packId, studentId))) : non corrélable d'un pack à l'autre. */
function computeMatchKey(matchSecret, packId, studentId) {
  return crypto.createHmac("sha256", matchSecret).update(lp([packId, studentId])).digest("base64url");
}

const byKey = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);

/**
 * Pack non signé, déterministe pour des entrées données (packId et horloge injectés).
 * `students` : { studentId, studentCode, firstName, lastName, existingStatus } ;
 * `cards` : { studentId, publicId, tokenHash } déjà filtrées par isCardEligible.
 */
function buildPack({ packId, keyId, schoolId, actorUserId, classId, date, timeZone, window, nowMs, students, cards, matchSecret }) {
  const matchKeys = new Map();
  const studentEntries = [];
  for (const student of students) {
    if (matchKeys.has(student.studentId)) continue; // un élève une seule fois
    const matchKey = computeMatchKey(matchSecret, packId, student.studentId);
    matchKeys.set(student.studentId, matchKey);
    studentEntries.push({
      matchKey,
      studentId: student.studentId,
      studentCode: String(student.studentCode ?? ""),
      firstName: String(student.firstName ?? ""),
      lastName: String(student.lastName ?? ""),
      existingStatus: ATTENDANCE_STATUSES.has(student.existingStatus) ? student.existingStatus : null,
    });
  }
  const cardEntries = [];
  for (const card of cards) {
    const matchKey = matchKeys.get(card.studentId);
    if (!matchKey) continue; // carte d'un élève hors liste : jamais incluse
    const scope = { schoolId, classId, packId, publicId: card.publicId };
    cardEntries.push({
      cardRef: computeCardRef(scope),
      matchKey,
      verifier: computeVerifier(cardKeyFromTokenHash(card.tokenHash), scope),
    });
  }
  return {
    contractVersion: CONTRACT_VERSION,
    packVersion: PACK_VERSION,
    keyId,
    packId,
    schoolId,
    actorUserId,
    mode: ROLL_CALL_MODE,
    classId,
    date,
    timeZone,
    issuedAt: isoSeconds(nowMs),
    notBefore: isoSeconds(window.notBefore),
    expiresAt: isoSeconds(window.expiresAt),
    syncDeadline: isoSeconds(window.syncDeadline),
    students: studentEntries.sort(byKey("matchKey")),
    cards: cardEntries.sort(byKey("cardRef")),
  };
}

// ---------------------------------------------------------------------------------------------
// Émission (lectures PostgreSQL uniquement).
// ---------------------------------------------------------------------------------------------

function settingsStore(repo) {
  return typeof repo.getSchoolSettingsStore === "function" ? repo.getSchoolSettingsStore() : createSchoolSettingsPgStore(repo);
}

async function enabledMedia(repo, schoolId) {
  const store = settingsStore(repo);
  const settings = mapSettingsRow(typeof store.getSettings === "function" ? await store.getSettings(schoolId) : null);
  const media = {
    nfc: isStudentCardCapabilityEnabled(settings, "studentCardNfcEnabled"),
    qr: isStudentCardCapabilityEnabled(settings, "studentCardQrEnabled"),
  };
  if (!media.nfc && !media.qr) {
    throw createHttpError(404, "Appel hors ligne indisponible : aucun support de carte activé.", OFFLINE_PACK_ERROR.MEDIA_DISABLED);
  }
  return media;
}

/**
 * Fuseau IANA canonique de l'établissement : vide → fuseau par défaut existant
 * (resolveSchoolTimeZone) ; renseigné mais invalide → refus, jamais de repli silencieux.
 */
function canonicalTimeZone(raw) {
  const value = String(raw ?? "").trim();
  const resolved = resolveSchoolTimeZone(value);
  if (value && resolved !== value) {
    throw createHttpError(503, "Appel hors ligne indisponible : fuseau horaire de l'établissement invalide.", OFFLINE_PACK_ERROR.TIMEZONE_INVALID);
  }
  return new Intl.DateTimeFormat("en-US", { timeZone: resolved }).resolvedOptions().timeZone;
}

async function schoolTimeZone(repo, schoolId) {
  const row = await repo.one("SELECT profile_payload->>'timezone' AS timezone FROM schools WHERE id = $1::uuid LIMIT 1", [schoolId]);
  return canonicalTimeZone(row?.timezone);
}

async function loadRoster(repo, schoolId, classId, date) {
  const rows = await repo.all(
    `SELECT DISTINCT ON (s.id) s.id::text AS student_id, s.student_code, s.first_name, s.last_name, a.status
       FROM enrollments e
       JOIN students s ON s.id = e.student_id AND s.school_id = e.school_id
       LEFT JOIN attendance a
         ON a.school_id = e.school_id AND a.student_id = s.id AND a.attendance_date = $3::date
      WHERE e.school_id = $1::uuid AND e.class_id = $2::uuid AND ${ROSTER_ENROLLMENT_SQL}
      ORDER BY s.id`,
    [schoolId, classId, date],
  );
  return rows.map((row) => ({
    studentId: String(row.student_id).toLowerCase(),
    studentCode: row.student_code,
    firstName: row.first_name,
    lastName: row.last_name,
    existingStatus: row.status ? String(row.status) : null,
  }));
}

async function loadEligibleCards(repo, schoolId, studentIds, media) {
  if (studentIds.length === 0) return [];
  const rows = await repo.all(
    `SELECT student_id::text AS student_id, public_id, token_hash, medium, status, nfc_encoding_state
       FROM student_access_cards
      WHERE school_id = $1::uuid AND student_id = ANY($2::uuid[]) AND status = 'active'
      ORDER BY id`,
    [schoolId, studentIds],
  );
  return rows
    .filter((row) => isCardEligible(row, media))
    .map((row) => ({ studentId: String(row.student_id).toLowerCase(), publicId: row.public_id, tokenHash: row.token_hash }));
}

/**
 * Émet un pack signé. `deps` : { signer (createPackSigner), masterSecret, nowMs, randomUUID? }.
 * Ordre : entrée → acteur et rôle live → flags → classe et affectation → signataire → fuseau et
 * fenêtre → lectures → construction → contrôle de taille → signature.
 */
async function issueOfflinePack(repo, query, scope, principal, deps) {
  const { classId, date } = readPackQuery(query);
  const userId = String(principal?.sub ?? principal?.id ?? "").trim();
  if (!userId) throw createHttpError(401, "Session invalide.");
  const actor = await liveRollCallActor(repo, principal, scope.schoolId);
  authorizeRollCallActor(actor, "teacher");
  await assertRollCallEnabled(repo, scope.schoolId);
  const media = await enabledMedia(repo, scope.schoolId);
  await assertRollCallClass(repo, scope, principal, classId, "teacher");
  const signer = typeof deps.signer === "function" ? deps.signer() : deps.signer;
  const timeZone = await schoolTimeZone(repo, scope.schoolId);
  const window = computePackWindow(timeZone, date);
  const nowMs = deps.nowMs ?? Date.now();
  assertIssuanceWindow(window, nowMs);
  const students = await loadRoster(repo, scope.schoolId, classId, date);
  const cards = await loadEligibleCards(repo, scope.schoolId, students.map((s) => s.studentId), media);
  const pack = buildPack({
    packId: (deps.randomUUID ?? crypto.randomUUID)(),
    keyId: signer.keyId,
    schoolId: String(scope.schoolId).toLowerCase(),
    actorUserId: String(actor.canonicalUserId || userId).toLowerCase(),
    classId,
    date,
    timeZone,
    window,
    nowMs,
    students,
    cards,
    matchSecret: deriveMatchKeySecret(deps.masterSecret),
  });
  try {
    canonicalJson(pack); // types du contrat et plafond de 256 Kio
  } catch {
    throw createHttpError(413, "Classe trop volumineuse pour un pack hors ligne.", OFFLINE_PACK_ERROR.PACK_TOO_LARGE);
  }
  return { pack, signature: signer.signPack(pack), revocations: signer.signedRevocations(pack.issuedAt) };
}

module.exports = {
  PACK_VERSION,
  MATCH_KEY_LABEL,
  OFFLINE_PACK_ERROR,
  readPackQuery,
  canonicalTimeZone,
  wallTime,
  firstInstantAtOrAfterWall,
  computePackWindow,
  assertIssuanceWindow,
  isoSeconds,
  isCardEligible,
  deriveMatchKeySecret,
  computeMatchKey,
  buildPack,
  issueOfflinePack,
};
