/**
 * NFC-PRES-LOCAL-PR2 — vérification locale fail-closed du pack signé (PR0 §4.1, §4.3, §4.5 ; PR1b).
 *
 * Contrat consommé : réponse de `GET /api/student-cards/roll-call/offline/v1/pack`
 *   `{ pack, signature: { alg, keyId, value }, revocations: { list, signature } }`.
 * Message vérifié : utf8("somafrik.rc-offline.pack.v1\n") ‖ utf8(JCS(pack)).
 *
 * Ordre : forme → versions → clé (connue, non révoquée) → signature → portée (établissement,
 * enseignant, classe, date, mode) → horloge. La portée et les dates ne sont lues qu'après la
 * signature : elles sont authentifiées. Le pack est vérifié au téléchargement ET à chaque chargement
 * depuis la base. Un échec, quel qu'il soit, rend le pack inutilisable : aucune carte ne peut alors
 * être présentée comme reconnue (mode dégradé, scans `unknown_local`).
 *
 * Le pack reste INDICATIF (PR0 §4.4) : il n'accorde aucun droit, le serveur revalide tout au sync.
 */
import { CONTRACT_VERSION, ROLL_CALL_MODE, UUID, digestsEqual, isRealDate, packSigningMessage, verifyEd25519 } from "../crypto/primitives";
import { computeCardRef, computeVerifier } from "../crypto/primitives";
import { isDeviceClockBehind, parseIsoInstant } from "./clock";
import type { PackKeyring } from "./keyring";
import { applyRevocations, isKeyRevoked, type RevocationState } from "./revocations";

export const PACK_VERSION = 1;

export const PACK_ERROR = Object.freeze({
  JSON_INVALID: "RC_PACK_JSON_INVALID",
  SHAPE_INVALID: "RC_PACK_SHAPE_INVALID",
  VERSION_UNSUPPORTED: "RC_PACK_VERSION_UNSUPPORTED",
  SIGNATURE_ALG: "RC_PACK_SIGNATURE_ALG_INVALID",
  KEY_UNKNOWN: "RC_PACK_KEY_UNKNOWN",
  KEY_REVOKED: "RC_PACK_KEY_REVOKED",
  SIGNATURE_INVALID: "RC_PACK_SIGNATURE_INVALID",
  REVOCATIONS_INVALID: "RC_PACK_REVOCATIONS_INVALID",
  OTHER_SCHOOL: "RC_PACK_OTHER_SCHOOL",
  OTHER_TEACHER: "RC_PACK_OTHER_TEACHER",
  OTHER_CLASS: "RC_PACK_OTHER_CLASS",
  OTHER_DATE: "RC_PACK_OTHER_DATE",
  CLOCK_BEHIND: "RC_PACK_DEVICE_CLOCK_BEHIND",
  NOT_YET_VALID: "RC_PACK_NOT_YET_VALID",
  EXPIRED: "RC_PACK_EXPIRED",
});
export type PackErrorCode = (typeof PACK_ERROR)[keyof typeof PACK_ERROR];

export type PackStudent = {
  matchKey: string;
  studentId: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  existingStatus: "present" | "late" | "absent" | "excused" | null;
};
export type PackCard = { cardRef: string; matchKey: string; verifier: string };
export type RollCallPack = {
  contractVersion: string;
  packVersion: number;
  keyId: string;
  packId: string;
  schoolId: string;
  actorUserId: string;
  mode: string;
  classId: string;
  date: string;
  timeZone: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  syncDeadline: string;
  students: PackStudent[];
  cards: PackCard[];
};
export type PackSignature = { alg: string; keyId: string; value: string };
export type PackEnvelope = { pack: RollCallPack; signature: PackSignature };

export type PackExpectation = { schoolId: string; actorUserId: string; classId: string; date: string };
export type PackCheckContext = {
  keyring: PackKeyring;
  revocations: RevocationState;
  expected: PackExpectation;
  nowMs: number;
  lastTrustedTimeMs: number | null;
  /**
   * `use` (défaut) : fenêtre complète [notBefore ; expiresAt[ exigée (ouverture d'un appel).
   * `store` : préchargement de la veille (PR0 §4.5) — un pack pas encore valide peut être STOCKÉ,
   * jamais utilisé avant notBefore ; expiré ou horloge en retard → refusé dans les deux cas.
   */
  purpose?: "use" | "store";
};
export type VerifiedPack = {
  pack: RollCallPack;
  issuedAtMs: number;
  notBeforeMs: number;
  expiresAtMs: number;
  syncDeadlineMs: number;
};
export type PackCheckResult = { ok: true; verified: VerifiedPack } | { ok: false; code: PackErrorCode };

const PACK_KEYS = [
  "contractVersion",
  "packVersion",
  "keyId",
  "packId",
  "schoolId",
  "actorUserId",
  "mode",
  "classId",
  "date",
  "timeZone",
  "issuedAt",
  "notBefore",
  "expiresAt",
  "syncDeadline",
  "students",
  "cards",
] as const;
const STUDENT_KEYS = ["matchKey", "studentId", "studentCode", "firstName", "lastName", "existingStatus"] as const;
const CARD_KEYS = ["cardRef", "matchKey", "verifier"] as const;
const EXISTING_STATUSES = new Set(["present", "late", "absent", "excused"]);
const PACK_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DIGEST_B64URL = /^[A-Za-z0-9_-]{43}$/;
const MAX_ENTRIES = 1000;
const MAX_TEXT = 256;

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isText(value: unknown, max = MAX_TEXT): value is string {
  return typeof value === "string" && value.length <= max;
}

function strictlySorted<T>(items: T[], pick: (item: T) => string): boolean {
  for (let i = 1; i < items.length; i += 1) if (!(pick(items[i - 1]) < pick(items[i]))) return false;
  return true;
}

/** Forme exacte du pack : champs, types et formats. Ne lit rien qui ne soit dans le contrat. */
function isPackShape(pack: unknown): pack is RollCallPack {
  if (!hasExactKeys(pack, PACK_KEYS)) return false;
  for (const field of ["packId", "schoolId", "actorUserId", "classId"] as const) {
    if (typeof pack[field] !== "string" || !UUID.test(pack[field] as string)) return false;
  }
  if (typeof pack.contractVersion !== "string" || typeof pack.mode !== "string" || typeof pack.keyId !== "string") return false;
  if (!Number.isSafeInteger(pack.packVersion)) return false;
  if (!isRealDate(pack.date) || !isText(pack.timeZone, 64) || pack.timeZone === "") return false;
  for (const field of ["issuedAt", "notBefore", "expiresAt", "syncDeadline"] as const) {
    if (typeof pack[field] !== "string" || !PACK_INSTANT.test(pack[field] as string) || parseIsoInstant(pack[field]) == null) return false;
  }
  const students = pack.students;
  const cards = pack.cards;
  if (!Array.isArray(students) || !Array.isArray(cards) || students.length > MAX_ENTRIES || cards.length > MAX_ENTRIES) return false;
  const matchKeys = new Set<string>();
  const studentIds = new Set<string>();
  for (const student of students) {
    if (!hasExactKeys(student, STUDENT_KEYS)) return false;
    if (!isText(student.matchKey, 64) || student.matchKey === "" || matchKeys.has(student.matchKey)) return false;
    if (typeof student.studentId !== "string" || !UUID.test(student.studentId) || studentIds.has(student.studentId)) return false;
    if (!isText(student.studentCode) || !isText(student.firstName) || !isText(student.lastName)) return false;
    if (student.existingStatus !== null && !EXISTING_STATUSES.has(student.existingStatus as string)) return false;
    matchKeys.add(student.matchKey);
    studentIds.add(student.studentId);
  }
  const cardRefs = new Set<string>();
  for (const card of cards) {
    if (!hasExactKeys(card, CARD_KEYS)) return false;
    if (typeof card.cardRef !== "string" || !DIGEST_B64URL.test(card.cardRef) || cardRefs.has(card.cardRef)) return false;
    if (typeof card.verifier !== "string" || !DIGEST_B64URL.test(card.verifier)) return false;
    if (typeof card.matchKey !== "string" || !matchKeys.has(card.matchKey)) return false;
    cardRefs.add(card.cardRef);
  }
  if (!strictlySorted(students as PackStudent[], (s) => s.matchKey)) return false;
  if (!strictlySorted(cards as PackCard[], (c) => c.cardRef)) return false;
  return true;
}

/** Analyse le texte stocké ou reçu. JSON invalide → refus, jamais de réparation. */
export function parsePackEnvelopeText(text: unknown): { ok: true; envelope: unknown } | { ok: false; code: PackErrorCode } {
  if (typeof text !== "string" || text.length === 0 || text.length > 512 * 1024) return { ok: false, code: PACK_ERROR.JSON_INVALID };
  try {
    return { ok: true, envelope: JSON.parse(text) };
  } catch {
    return { ok: false, code: PACK_ERROR.JSON_INVALID };
  }
}

/**
 * Vérification complète d'une enveloppe `{ pack, signature }` (champs supplémentaires refusés,
 * hormis `revocations`, traité à part par `verifyDownloadedPack`).
 */
export function verifyPackEnvelope(envelope: unknown, context: PackCheckContext): PackCheckResult {
  const refuse = (code: PackErrorCode): PackCheckResult => ({ ok: false, code });
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return refuse(PACK_ERROR.SHAPE_INVALID);
  const keys = Object.keys(envelope).filter((key) => key !== "revocations");
  if (keys.length !== 2 || !keys.includes("pack") || !keys.includes("signature")) return refuse(PACK_ERROR.SHAPE_INVALID);
  const { pack, signature } = envelope as { pack: unknown; signature: unknown };
  if (!isPackShape(pack)) return refuse(PACK_ERROR.SHAPE_INVALID);
  if (!hasExactKeys(signature, ["alg", "keyId", "value"])) return refuse(PACK_ERROR.SHAPE_INVALID);

  if (pack.contractVersion !== CONTRACT_VERSION || pack.packVersion !== PACK_VERSION) return refuse(PACK_ERROR.VERSION_UNSUPPORTED);
  if (signature.alg !== "Ed25519" || signature.keyId !== pack.keyId) return refuse(PACK_ERROR.SIGNATURE_ALG);

  const entry = context.keyring.keys.find((key) => key.keyId === pack.keyId);
  if (!entry) return refuse(PACK_ERROR.KEY_UNKNOWN);
  if (isKeyRevoked(context.keyring, context.revocations, entry.keyId)) return refuse(PACK_ERROR.KEY_REVOKED);

  let message: Uint8Array;
  try {
    message = packSigningMessage(pack);
  } catch {
    return refuse(PACK_ERROR.SHAPE_INVALID);
  }
  if (!verifyEd25519(signature.value, message, entry.publicKey)) return refuse(PACK_ERROR.SIGNATURE_INVALID);

  // Contenu authentifié à partir d'ici.
  if (pack.mode !== ROLL_CALL_MODE) return refuse(PACK_ERROR.VERSION_UNSUPPORTED);
  if (pack.schoolId !== context.expected.schoolId) return refuse(PACK_ERROR.OTHER_SCHOOL);
  if (pack.actorUserId !== context.expected.actorUserId) return refuse(PACK_ERROR.OTHER_TEACHER);
  if (pack.classId !== context.expected.classId) return refuse(PACK_ERROR.OTHER_CLASS);
  if (pack.date !== context.expected.date) return refuse(PACK_ERROR.OTHER_DATE);

  const issuedAtMs = parseIsoInstant(pack.issuedAt) as number;
  const notBeforeMs = parseIsoInstant(pack.notBefore) as number;
  const expiresAtMs = parseIsoInstant(pack.expiresAt) as number;
  const syncDeadlineMs = parseIsoInstant(pack.syncDeadline) as number;
  if (!(notBeforeMs < expiresAtMs && expiresAtMs <= syncDeadlineMs && issuedAtMs < expiresAtMs)) return refuse(PACK_ERROR.SHAPE_INVALID);

  if (isDeviceClockBehind(context.nowMs, context.lastTrustedTimeMs)) return refuse(PACK_ERROR.CLOCK_BEHIND);
  if (context.nowMs < notBeforeMs && context.purpose !== "store") return refuse(PACK_ERROR.NOT_YET_VALID);
  if (context.nowMs >= expiresAtMs) return refuse(PACK_ERROR.EXPIRED);
  return { ok: true, verified: { pack, issuedAtMs, notBeforeMs, expiresAtMs, syncDeadlineMs } };
}

/**
 * Pack fraîchement téléchargé : la liste de révocation livrée avec lui est appliquée D'ABORD
 * (monotone), puis le pack est vérifié avec l'état mis à jour. Liste absente, invalide ou plus
 * ancienne → pack refusé (fail-closed) et état de révocation inchangé.
 */
export function verifyDownloadedPack(
  envelope: unknown,
  context: PackCheckContext,
): { result: PackCheckResult; revocations: RevocationState } {
  const revocations = (envelope as { revocations?: unknown } | null)?.revocations;
  const applied = applyRevocations(revocations, context.keyring, context.revocations);
  if (!applied.ok) return { result: { ok: false, code: PACK_ERROR.REVOCATIONS_INVALID }, revocations: context.revocations };
  return { result: verifyPackEnvelope(envelope, { ...context, revocations: applied.state }), revocations: applied.state };
}

/**
 * Rapprochement local d'une carte lue avec un pack VÉRIFIÉ : `cardRef` retrouve l'entrée, puis
 * `verifier` (HMAC de K) est comparé à durée constante. Renvoie le `matchKey` ou null (carte
 * inconnue du pack → `unknown_local`). K n'est ni conservé ni journalisé par cette fonction.
 */
export function matchCardInPack(verified: VerifiedPack, publicId: string, cardKey: Uint8Array): string | null {
  const pack = verified.pack;
  const scope = { schoolId: pack.schoolId, classId: pack.classId, packId: pack.packId, publicId };
  let cardRef: string;
  let verifier: string;
  try {
    cardRef = computeCardRef(scope);
    verifier = computeVerifier(cardKey, scope);
  } catch {
    return null;
  }
  const card = pack.cards.find((entry) => entry.cardRef === cardRef);
  if (!card || !digestsEqual(card.verifier, verifier)) return null;
  return card.matchKey;
}
