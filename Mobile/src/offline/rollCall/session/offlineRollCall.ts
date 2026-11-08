/**
 * NFC-PRES-LOCAL-PR3 — appel de classe hors connexion : acquisition et clôture locales.
 *
 * Aucun appel réseau par scan. Chaque lecture (NFC ou QR) :
 *   format strict `publicId.secret` → K = SHA-256(secret) → preuve HMAC liée au support
 *   (`medium`) → rapprochement indicatif avec le pack VÉRIFIÉ → transaction SQLCipher → COMMIT →
 *   résultat. K et le secret ne sont ni conservés, ni journalisés, ni renvoyés.
 *
 * Le pack reste indicatif (PR0 §4.4) : sans pack valide, le mode dégradé enregistre les scans
 * « à vérifier » sans jamais présenter une carte comme reconnue. La clôture fige le lot (contrat
 * PR0 §6.1) ; la transmission au serveur relève de PR4 : aucun état « synchronisé » ici.
 *
 * Réutilise exclusivement les primitives PR2 (crypto/, pack/, store/). L'UID de la puce NFC n'est
 * jamais lu ni utilisé.
 */
import { CONTRACT_VERSION, ROLL_CALL_MODE, computeProof, deriveCardKeyFromSecret, type RollCallMedium } from "../crypto/primitives";
import type { PackKeyring } from "../pack/keyring";
import { acceptDownloadedPack, loadUsablePack } from "../pack/packService";
import { matchCardInPack, type PackStudent, type VerifiedPack } from "../pack/verifyPack";
import { RollCallStorageError } from "../store/database";
import {
  closeSession,
  listActiveScans,
  listMarks,
  listStoredPackIds,
  openDraftSession,
  recordScan,
  setManualMark,
  type RcContext,
  type RcCounts,
  type RcSessionRow,
} from "../store/repository";

export const OFFLINE_ROLL_CALL_COPY = {
  start: "Démarrer l'appel NFC/QR",
  resume: "Reprendre l'appel NFC/QR",
  title: "Appel hors connexion",
  preparing: "Préparation de l'appel…",
  packReady: (issuedAt: string) => `Liste préparée le ${issuedAt} : les cartes sont reconnues localement.`,
  degraded:
    "Liste hors ligne indisponible : les cartes sont enregistrées « à vérifier », sans nom. Le serveur les vérifiera à la synchronisation.",
  degradedReason: {
    RC_PACK_KEY_UNKNOWN: "clé de signature inconnue sur cette version de l'application",
    RC_PACK_EXPIRED: "liste expirée",
    RC_PACK_NOT_YET_VALID: "liste pas encore valide",
    RC_PACK_DEVICE_CLOCK_BEHIND: "heure de l'appareil incorrecte",
    RC_PACK_SIGNATURE_INVALID: "liste altérée",
    RC_PACK_KEY_REVOKED: "clé de signature révoquée",
    RC_PACK_REVOCATIONS_STATE_CORRUPT: "état local de sécurité illisible",
    RC_TRUSTED_TIME_STATE_CORRUPT: "état local de sécurité illisible",
    RC_PACK_REVOCATIONS_INVALID: "clé de signature inconnue ou liste de révocation invalide",
    RC_PACK_NONE: "aucune liste préparée pour cette classe et ce jour",
  } as Record<string, string>,
  localSaved: "Enregistré sur ce téléphone.",
  scanned: (name: string) => `${name} : présent.`,
  alreadyCounted: (name: string) => `${name} : déjà compté (autre carte).`,
  protectedStatus: (name: string, label: string) => `${name} : statut « ${label} » déjà enregistré, conservé.`,
  unknown: "Carte enregistrée, à vérifier : non reconnue dans la liste hors ligne.",
  unknownDegraded: "Carte enregistrée, à vérifier.",
  duplicate: "Carte déjà scannée.",
  invalidCard: "Cette carte n'est pas une carte élève Somafrik.",
  sessionClosed: "Appel clôturé : aucune nouvelle carte n'est acceptée.",
  storageFull: "Espace insuffisant sur le téléphone : la carte n'a PAS été enregistrée.",
  storageError: "Enregistrement local impossible : la carte n'a PAS été enregistrée. Présentez-la de nouveau.",
  scanLimit: "Nombre maximal de scans atteint pour cet appel.",
  protectedEdit: "Statut déjà enregistré et protégé : modification impossible ici.",
  closeTitle: "Clôturer l'appel",
  closeBody: (s: OfflineRollCallSummary) =>
    [
      s.total !== null ? `${s.total} élève(s) inscrit(s)` : "Liste de classe indisponible",
      `${s.present} présent(s), ${s.late} retard(s), ${s.absent} absent(s) saisi(s)${s.excused ? `, ${s.excused} justifié(s)` : ""}.`,
      s.notRecorded !== null && s.notRecorded > 0
        ? `${s.notRecorded} élève(s) affiché(s) « Absent » de façon provisoire (ni carte, ni statut saisi). Confirmez leur absence, ou clôturez sans eux : ils resteront sans statut.`
        : "",
      s.unknownScans ? `${s.unknownScans} scan(s) à vérifier.` : "",
      s.degraded ? "Mode dégradé : liste de classe inconnue ; les cartes seront vérifiées par le serveur à la synchronisation." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  emptyRollCall: "Aucune carte scannée ni aucun statut saisi : il n'y a rien à enregistrer.",
  confirmClose: "Confirmer la clôture",
  closeWithoutAbsences: "Clôturer sans les absences",
  closeConfirmAbsences: (count: number) => `Confirmer ${count} absence(s) et clôturer`,
  provisionalAbsent: "Absent (provisoire)",
  keepEditing: "Continuer l'appel",
  closed: "Appel enregistré localement — à synchroniser.",
} as const;

export const STATUS_LABEL = { present: "Présent", late: "Retard", absent: "Absent", excused: "Justifié" } as const;
export type EditableStatus = "present" | "late" | "absent";
const PROTECTED_EXISTING = new Set(["present", "late", "excused"]);

const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const CARD_PREFIX = "somafrik:card:";

/**
 * Capability lue sur la carte (NDEF ou QR) : `publicId.secret`, préfixe `somafrik:card:` admis.
 * Format strict, sans normalisation ; toute autre forme est refusée.
 */
export function parseCardCapability(raw: unknown): { publicId: string; secret: string } | null {
  if (typeof raw !== "string") return null;
  const token = raw.startsWith(CARD_PREFIX) ? raw.slice(CARD_PREFIX.length) : raw;
  const parts = token.split(".");
  if (parts.length !== 2 || !PUBLIC_ID.test(parts[0]) || !SECRET.test(parts[1])) return null;
  return { publicId: parts[0], secret: parts[1] };
}

// ---------------------------------------------------------------------------------------------
// Préparation : pack téléchargé si le réseau le permet, sinon pack préchargé, sinon mode dégradé.
// ---------------------------------------------------------------------------------------------

export type PackDownload = { text: string; dateHeader: string | null };
export type OfflinePackState =
  | { status: "verified"; verified: VerifiedPack; downloaded: boolean }
  | { status: "degraded"; reason: string; downloadFailed: boolean };

export async function prepareOfflinePack(
  ctx: RcContext,
  input: {
    keyring: PackKeyring;
    classId: string;
    date: string;
    schoolId: string;
    actorUserId: string;
    /** Absent hors connexion. Ne lève jamais d'exception vers l'interface : échec = repli local. */
    download?: () => Promise<PackDownload>;
  },
): Promise<OfflinePackState> {
  const expected = { schoolId: input.schoolId, actorUserId: input.actorUserId, classId: input.classId, date: input.date };
  let downloaded = false;
  let downloadFailed = false;
  let lastReason = "RC_PACK_NONE";
  if (input.download) {
    try {
      const response = await input.download();
      const accepted = await acceptDownloadedPack(ctx, { keyring: input.keyring, envelopeText: response.text, expected, httpDateHeader: response.dateHeader });
      if (accepted.ok) downloaded = true;
      else lastReason = accepted.code;
    } catch {
      downloadFailed = true; // réseau absent, 404 flag, 409 date, 503 signature : repli sur le pack local
    }
  }
  for (const packId of await listStoredPackIds(ctx, input.classId, input.date)) {
    const usable = await loadUsablePack(ctx, { keyring: input.keyring, packId, expected });
    if (usable.ok) return { status: "verified", verified: usable.verified, downloaded };
    lastReason = usable.code;
  }
  return { status: "degraded", reason: lastReason, downloadFailed };
}

export function degradedReasonLabel(code: string): string {
  return OFFLINE_ROLL_CALL_COPY.degradedReason[code] ?? "liste hors ligne refusée";
}

// ---------------------------------------------------------------------------------------------
// Session : reprise du brouillon de la classe et du jour, sinon création.
// ---------------------------------------------------------------------------------------------

export type OfflineRollCall = {
  session: RcSessionRow;
  /** Pack VÉRIFIÉ de la session (même packId), ou null : mode dégradé pour les rapprochements. */
  pack: VerifiedPack | null;
  resumed: boolean;
};

export async function openOfflineRollCall(
  ctx: RcContext,
  input: {
    classId: string;
    date: string;
    pack: VerifiedPack | null;
    /** Recharge et revérifie un pack stocké précis (celui d'un brouillon repris). */
    loadPack?: (packId: string) => Promise<VerifiedPack | null>;
  },
): Promise<OfflineRollCall> {
  const { session, resumed } = await openDraftSession(ctx, {
    classId: input.classId,
    date: input.date,
    packId: input.pack?.pack.packId ?? null,
    syncDeadline: input.pack?.pack.syncDeadline ?? null,
  });
  // Un brouillon repris garde son pack d'origine (packId figé dans chaque preuve) : jamais celui
  // d'une autre émission. Introuvable ou refusé → mode dégradé pour les nouveaux rapprochements.
  let pack: VerifiedPack | null = null;
  if (session.pack_id) {
    if (input.pack && input.pack.pack.packId === session.pack_id) pack = input.pack;
    else if (input.loadPack) pack = await input.loadPack(session.pack_id);
  }
  if (pack && pack.pack.packId !== session.pack_id) pack = null;
  return { session, pack, resumed };
}

/** Rechargement d'un pack précis, revérifié intégralement (`loadUsablePack`). */
export function packLoader(
  ctx: RcContext,
  input: { keyring: PackKeyring; classId: string; date: string; schoolId: string; actorUserId: string },
): (packId: string) => Promise<VerifiedPack | null> {
  const expected = { schoolId: input.schoolId, actorUserId: input.actorUserId, classId: input.classId, date: input.date };
  return async (packId) => {
    const usable = await loadUsablePack(ctx, { keyring: input.keyring, packId, expected });
    return usable.ok ? usable.verified : null;
  };
}

// ---------------------------------------------------------------------------------------------
// Lecture d'une carte.
// ---------------------------------------------------------------------------------------------

export type ScanOutcome =
  | { kind: "recorded"; student: PackStudent; counts: RcCounts; message: string }
  | { kind: "already_counted"; student: PackStudent; counts: RcCounts; message: string }
  | { kind: "protected"; student: PackStudent; counts: RcCounts; message: string }
  | { kind: "unknown"; counts: RcCounts; message: string }
  | { kind: "duplicate"; counts: RcCounts; message: string }
  | { kind: "invalid_card"; message: string }
  | { kind: "refused"; code: string; message: string };

function studentName(student: PackStudent): string {
  return `${student.firstName} ${student.lastName}`.trim() || student.studentCode || "Élève";
}

function storageMessage(code: string): string {
  if (code === "RC_STORAGE_FULL") return OFFLINE_ROLL_CALL_COPY.storageFull;
  if (code === "RC_SESSION_NOT_DRAFT") return OFFLINE_ROLL_CALL_COPY.sessionClosed;
  if (code === "RC_SCAN_LIMIT") return OFFLINE_ROLL_CALL_COPY.scanLimit;
  if (code === "RC_ROLL_CALL_EMPTY") return OFFLINE_ROLL_CALL_COPY.emptyRollCall;
  return OFFLINE_ROLL_CALL_COPY.storageError;
}

/**
 * Traite une capability lue. Le résultat n'est renvoyé qu'après le COMMIT SQLCipher ; toute
 * erreur de stockage est un refus visible (la carte n'est PAS comptée).
 */
export async function processCard(
  ctx: RcContext,
  rollCall: OfflineRollCall,
  input: { token: string; medium: RollCallMedium; actorUserId: string },
): Promise<ScanOutcome> {
  const card = parseCardCapability(input.token);
  if (!card) return { kind: "invalid_card", message: OFFLINE_ROLL_CALL_COPY.invalidCard };
  const { session, pack } = rollCall;
  const scanId = ctx.randomUUID();
  let proof: string;
  let matchKey: string | null;
  try {
    const key = deriveCardKeyFromSecret(card.secret);
    proof = computeProof(key, {
      contractVersion: CONTRACT_VERSION,
      schoolId: session.school_id,
      actorUserId: input.actorUserId,
      classId: session.class_id,
      date: session.roll_call_date,
      mode: ROLL_CALL_MODE,
      sessionId: session.session_id,
      packId: session.pack_id ?? "",
      scanId,
      publicId: card.publicId,
      medium: input.medium,
    });
    matchKey = pack ? matchCardInPack(pack, card.publicId, key) : null;
  } catch {
    return { kind: "invalid_card", message: OFFLINE_ROLL_CALL_COPY.invalidCard };
  }
  const student = matchKey && pack ? pack.pack.students.find((entry) => entry.matchKey === matchKey) ?? null : null;
  const isProtected = Boolean(student?.existingStatus && PROTECTED_EXISTING.has(student.existingStatus));
  let alreadyCounted = false;
  try {
    if (student) alreadyCounted = (await listMarks(ctx, session.session_id)).some((mark) => mark.matchKey === student.matchKey);
    const result = await recordScan(ctx, {
      sessionId: session.session_id,
      scanId,
      publicId: card.publicId,
      proof,
      medium: input.medium,
      scannedAt: new Date(ctx.nowMs()).toISOString(),
      match: student ? { matchKey: student.matchKey, studentId: student.studentId } : null,
      markPresent: !isProtected,
    });
    if (result.status === "duplicate") return { kind: "duplicate", counts: result.counts, message: OFFLINE_ROLL_CALL_COPY.duplicate };
    if (!student) {
      return { kind: "unknown", counts: result.counts, message: pack ? OFFLINE_ROLL_CALL_COPY.unknown : OFFLINE_ROLL_CALL_COPY.unknownDegraded };
    }
    const name = studentName(student);
    if (isProtected) {
      return {
        kind: "protected",
        student,
        counts: result.counts,
        message: OFFLINE_ROLL_CALL_COPY.protectedStatus(name, STATUS_LABEL[student.existingStatus as keyof typeof STATUS_LABEL]),
      };
    }
    if (alreadyCounted) return { kind: "already_counted", student, counts: result.counts, message: OFFLINE_ROLL_CALL_COPY.alreadyCounted(name) };
    return { kind: "recorded", student, counts: result.counts, message: OFFLINE_ROLL_CALL_COPY.scanned(name) };
  } catch (error) {
    const code = error instanceof RollCallStorageError ? String(error.code) : "RC_STORAGE_FAILED";
    return { kind: "refused", code, message: storageMessage(code) };
  }
}

// ---------------------------------------------------------------------------------------------
// Corrections manuelles et compteurs.
// ---------------------------------------------------------------------------------------------

export function isProtectedStudent(student: PackStudent): boolean {
  return Boolean(student.existingStatus && PROTECTED_EXISTING.has(student.existingStatus));
}

/** Présent / Retard / Absent uniquement ; un statut existant présent, retard ou justifié est intouchable. */
export async function setOfflineMark(
  ctx: RcContext,
  rollCall: OfflineRollCall,
  input: { matchKey: string; status: EditableStatus },
): Promise<{ ok: true; counts: RcCounts } | { ok: false; message: string }> {
  const student = rollCall.pack?.pack.students.find((entry) => entry.matchKey === input.matchKey);
  if (!student || !["present", "late", "absent"].includes(input.status)) return { ok: false, message: OFFLINE_ROLL_CALL_COPY.storageError };
  if (isProtectedStudent(student)) return { ok: false, message: OFFLINE_ROLL_CALL_COPY.protectedEdit };
  try {
    const counts = await setManualMark(ctx, { sessionId: rollCall.session.session_id, matchKey: student.matchKey, studentId: student.studentId, status: input.status });
    return { ok: true, counts };
  } catch (error) {
    return { ok: false, message: storageMessage(error instanceof RollCallStorageError ? String(error.code) : "") };
  }
}

export type OfflineRollCallStudentRow = {
  student: PackStudent;
  status: "present" | "late" | "absent" | "excused" | null;
  source: "card" | "manual" | "existing" | "default" | null;
  protected: boolean;
};

export type OfflineRollCallSummary = {
  /** null en mode dégradé : la liste de la classe n'est pas connue hors connexion. */
  total: number | null;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /**
   * Élèves du pack sans aucun statut : « non pointés ». Ils le restent après la clôture (jamais
   * absents par défaut). null en mode dégradé : l'effectif n'est pas connu hors connexion.
   */
  notRecorded: number | null;
  /** Lectures non reconnues (mode dégradé ou carte hors liste) : « à vérifier ». */
  unknownScans: number;
  scans: number;
  degraded: boolean;
  rows: OfflineRollCallStudentRow[];
};

/**
 * Compteurs par ÉLÈVE, pas par lecture : doublons, cartes multiples d'un même élève et cartes
 * inconnues ne faussent pas le décompte. Lu dans l'état validé (après COMMIT).
 */
export async function summarizeOfflineRollCall(ctx: RcContext, rollCall: OfflineRollCall): Promise<OfflineRollCallSummary> {
  const [marks, scans] = await Promise.all([listMarks(ctx, rollCall.session.session_id), listActiveScans(ctx, rollCall.session.session_id)]);
  const unknownScans = scans.filter((scan) => scan.localStatus === "unknown_local").length;
  const students = rollCall.pack?.pack.students ?? [];
  const byKey = new Map(marks.map((mark) => [mark.matchKey, mark]));
  const summary: OfflineRollCallSummary = {
    total: rollCall.pack ? students.length : null,
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    notRecorded: rollCall.pack ? 0 : null,
    unknownScans,
    scans: scans.length,
    degraded: !rollCall.pack,
    rows: [],
  };
  for (const student of students) {
    const mark = byKey.get(student.matchKey);
    const protectedStatus = isProtectedStudent(student);
    const status = protectedStatus ? student.existingStatus : mark?.status ?? student.existingStatus ?? null;
    const source = protectedStatus ? "existing" : mark?.source ?? (student.existingStatus ? "existing" : null);
    summary.rows.push({ student, status, source, protected: protectedStatus });
    if (status === "present") summary.present += 1;
    else if (status === "late") summary.late += 1;
    else if (status === "excused") summary.excused += 1;
    else if (status === "absent") summary.absent += 1;
    else summary.notRecorded = (summary.notRecorded ?? 0) + 1;
  }
  return summary;
}

// ---------------------------------------------------------------------------------------------
// Clôture explicite.
// ---------------------------------------------------------------------------------------------

/**
 * Clôture confirmée par l'enseignant : lot construit (contrat PR0 §6.1) avec les seules lectures et
 * corrections explicites, couverture partielle admise (NFC-APPEL-PARTIEL-01) ; aucun absent déduit.
 * `operationId` et `payloadDigest` générés, corps figé — dans UNE transaction SQLCipher
 * (draft → closed). La transmission relève du moteur de synchronisation (PR4).
 */
export async function closeOfflineRollCall(
  ctx: RcContext,
  rollCall: OfflineRollCall,
  options: { confirmAbsences?: boolean } = {},
): Promise<{ ok: true; operationId: string; payloadDigest: string; message: string } | { ok: false; message: string }> {
  // NFC-STATUT-PRESENCE-01 : absences provisoires confirmées EXPLICITEMENT par l'enseignant →
  // pointages `manual` absents, écrits dans la transaction de clôture. Jamais pour un élève déjà
  // pointé, scanné ou au statut protégé (justifié, présent, retard déjà enregistrés).
  let confirmedAbsent: Array<{ matchKey: string; studentId: string }> = [];
  if (options.confirmAbsences && rollCall.pack) {
    const summary = await summarizeOfflineRollCall(ctx, rollCall);
    confirmedAbsent = summary.rows
      .filter((row) => row.status === null && !row.protected && !row.student.existingStatus)
      .map((row) => ({ matchKey: row.student.matchKey, studentId: row.student.studentId }));
  }
  try {
    const frozen = await closeSession(ctx, rollCall.session.session_id, { confirmedAbsent });
    return { ok: true, operationId: frozen.operationId, payloadDigest: frozen.payloadDigest, message: OFFLINE_ROLL_CALL_COPY.closed };
  } catch (error) {
    return { ok: false, message: storageMessage(error instanceof RollCallStorageError ? String(error.code) : "") };
  }
}
