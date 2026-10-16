/**
 * CARTE-PR3-M1 — contrôle d'entrée au portail (NFC/QR), sans choix de classe.
 *
 * Un passage au portail est un événement distinct d'une présence en classe : ce module n'écrit
 * jamais de présence. Le serveur résout l'établissement, l'élève et la classe à partir de la
 * carte et reste seul juge des droits ; le Mobile ne propose le parcours qu'avec une clé de rôle
 * canonique admissible ET la permission effective `Contrôle d'entrée:CREATE`.
 * Le cardToken ne quitte l'appareil que vers le serveur ; il n'est ni persisté ni journalisé.
 */
import { resolveCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { createIdempotencyKey } from "./networkResilience";

export const ENTRY_CONTROL_PERMISSION = "Contrôle d'entrée:CREATE";

/** Même liste que le serveur (studentCardEntry.js) : elle n'ouvre rien sans la permission. */
const ENTRY_ADMISSIBLE_ROLE_KEYS = new Set(["PROVISEUR", "PRINCIPAL", "PREFET_ETUDES", "SECRETARY", "SUPERVISOR", "SCHOOL_ADMIN"]);
const SCHOOL_STAFF_ROLE_KEYS = new Set([...ENTRY_ADMISSIBLE_ROLE_KEYS, "TEACHER", "ACCOUNTANT"]);

export const ENTRY_CONTROL_COPY = {
  button: "Contrôle d'entrée",
  title: "Contrôle d'entrée",
  subtitle: "Scan continu au portail. Aucune présence en classe n'est enregistrée.",
  instructionsNfc: "Approchez les cartes NFC l'une après l'autre.",
  instructionsQr: "Présentez les QR codes l'un après l'autre devant la caméra.",
  useNfc: "Lecteur NFC",
  useQr: "Caméra QR",
  listening: "En attente d'une carte…",
  checking: "Enregistrement de l'entrée…",
  entered: "Entrée enregistrée",
  alreadyEntered: "Déjà entré aujourd'hui",
  enteredAt: (time: string) => `Entrée à ${time}`,
  counters: (entered: number, already: number) => `${entered} entrée(s) enregistrée(s) · ${already} déjà entré(s)`,
  financeUnavailable: "Situation financière indisponible",
  unknownCard: "Carte inconnue : elle n'appartient pas à cet établissement ou n'existe pas.",
  otherSchool: "Carte d'un autre établissement : entrée refusée.",
  revokedCard: "Carte révoquée, perdue, remplacée ou non activée : entrée refusée.",
  noEnrollment: "Élève sans inscription en cours : entrée non enregistrée.",
  disabled: "La carte élève est désactivée pour cet établissement.",
  forbidden: "Accès interdit : votre compte n'a pas le droit de contrôle d'entrée.",
  unreadable: "Carte illisible ou non Somafrik. Présentez-la de nouveau.",
  conflict: "Lecture en conflit. Présentez la carte de nouveau.",
  offline: "Réseau indisponible : l'entrée n'est pas confirmée. Réessayez sans rescanner.",
  failed: "L'entrée n'a pas pu être confirmée. Réessayez.",
  retry: "Réessayer",
  close: "Fermer",
} as const;

export type EntryFinance = { code: string; label: string };
export type EntryResult = {
  status: "entered" | "already_entered";
  enteredAt: string;
  localDate: string;
  studentName: string;
  studentCode: string;
  className: string;
  finance?: EntryFinance;
};
export type EntryView = {
  tone: "entered" | "already";
  headline: string;
  rows: { label: string; value: string }[];
  financeAlert: boolean;
};
export type EntryRead = { cardToken: string; medium: "nfc" | "qr" };
export type EntryPending = EntryRead & { operationId: string };
export type EntryFailure = { message: string; retry: boolean; stop: boolean };
export type EntryScanBody = { cardToken: string; medium: "nfc" | "qr"; operationId: string };
export type EntryOutcome =
  | { kind: "recorded"; result: EntryResult }
  | { kind: "failed"; failure: EntryFailure; retry?: EntryPending };

type CardSettings = { studentCardEnabled?: boolean; studentCardNfcEnabled?: boolean; studentCardQrEnabled?: boolean };

/** Parcours proposé seulement avec une clé admissible et la permission effective de saisie. */
export function entryControlActor(session: unknown): boolean {
  if (!session || typeof session !== "object") return false;
  const identity = resolveCanonicalRoleIdentity(session);
  const keys = identity.roleKeys.map((key) => String(key).trim().toUpperCase()).filter(Boolean);
  // Clé inconnue, plateforme ou familiale à côté : aucun accès (comme le serveur).
  if (keys.length === 0 || keys.some((key) => !SCHOOL_STAFF_ROLE_KEYS.has(key))) return false;
  if (!keys.some((key) => ENTRY_ADMISSIBLE_ROLE_KEYS.has(key))) return false;
  return identity.permissions.includes(ENTRY_CONTROL_PERMISSION);
}

/**
 * Lecteurs proposés. Les réglages ne sont connus que si le compte peut lire les capacités de
 * pointage ; sinon le serveur refuse lui-même une carte désactivée.
 */
export function entryControlMedia(args: { settings: CardSettings | null | undefined; platformOs: string }) {
  const android = args.platformOs === "android";
  if (!args.settings) return { nfc: android, qr: true };
  const master = args.settings.studentCardEnabled === true;
  return {
    nfc: android && master && args.settings.studentCardNfcEnabled === true,
    qr: master && args.settings.studentCardQrEnabled === true,
  };
}

const text = (value: unknown, max = 120) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const FINANCE_CODES = new Set(["UP_TO_DATE", "PARTIAL", "OVERDUE", "REVIEW"]);

/** Liste blanche : ni identifiant, ni photo, ni jeton ne sont conservés. */
export function parseEntryScanResponse(raw: unknown): EntryResult | null {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!value || (value.status !== "entered" && value.status !== "already_entered")) return null;
  const entry = (value.entry && typeof value.entry === "object" ? value.entry : {}) as Record<string, unknown>;
  const student = (value.student && typeof value.student === "object" ? value.student : {}) as Record<string, unknown>;
  const klass = (value.class && typeof value.class === "object" ? value.class : {}) as Record<string, unknown>;
  const enteredAt = text(entry.enteredAt, 40);
  const result: EntryResult = {
    status: value.status,
    enteredAt: enteredAt && !Number.isNaN(Date.parse(enteredAt)) ? enteredAt : "",
    localDate: text(entry.localDate, 10),
    studentName: [text(student.firstName), text(student.lastName)].filter(Boolean).join(" "),
    studentCode: text(student.studentCode, 60),
    className: text(klass.className) || text(klass.classCode),
  };
  const finance = value.finance && typeof value.finance === "object" ? (value.finance as Record<string, unknown>) : null;
  if (finance) {
    const code = text(finance.code, 30);
    if (FINANCE_CODES.has(code) && text(finance.label)) {
      result.finance = { code, label: text(finance.label) };
    } else {
      result.finance = { code: "UNAVAILABLE", label: ENTRY_CONTROL_COPY.financeUnavailable };
    }
  }
  return result;
}

function timeLabel(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function describeEntryResult(result: EntryResult): EntryView {
  const rows: EntryView["rows"] = [];
  if (result.studentName) rows.push({ label: "Élève", value: result.studentName });
  if (result.studentCode) rows.push({ label: "Matricule", value: result.studentCode });
  if (result.className) rows.push({ label: "Classe", value: result.className });
  if (result.enteredAt && result.status === "already_entered") {
    rows.push({ label: "Première entrée", value: timeLabel(result.enteredAt) });
  }
  if (result.finance) rows.push({ label: "Situation financière", value: result.finance.label });
  return {
    tone: result.status === "entered" ? "entered" : "already",
    headline: result.status === "entered" ? ENTRY_CONTROL_COPY.entered : ENTRY_CONTROL_COPY.alreadyEntered,
    rows,
    // Information non bloquante : l'entrée reste enregistrée.
    financeAlert: result.finance?.code === "OVERDUE" || result.finance?.code === "PARTIAL",
  };
}

export function entryScanFailure(error: unknown): EntryFailure {
  const { status, code } = (error && typeof error === "object" ? error : {}) as { status?: number; code?: string };
  const refuse = (message: string): EntryFailure => ({ message, retry: false, stop: false });
  if (status === 401 || code === "ENTRY_ROLE_FORBIDDEN" || code === "PLATFORM_PERSONAL_DATA_DENIED") {
    return { message: ENTRY_CONTROL_COPY.forbidden, retry: false, stop: true };
  }
  if (code === "STUDENT_CARD_TENANT_DENIED") return refuse(ENTRY_CONTROL_COPY.otherSchool);
  if (status === 403) return { message: ENTRY_CONTROL_COPY.forbidden, retry: false, stop: true };
  if (code === "STUDENT_CARD_DISABLED") return { message: ENTRY_CONTROL_COPY.disabled, retry: false, stop: true };
  if (code === "STUDENT_CARD_NOT_FOUND" || code === "STUDENT_CARD_STUDENT_NOT_FOUND" || status === 404) {
    return refuse(ENTRY_CONTROL_COPY.unknownCard);
  }
  if (code === "STUDENT_CARD_INVALID_STATE") return refuse(ENTRY_CONTROL_COPY.revokedCard);
  if (code === "STUDENT_CARD_ENROLLMENT_UNRESOLVED") return refuse(ENTRY_CONTROL_COPY.noEnrollment);
  if (code === "ENTRY_OPERATION_CONFLICT" || code === "IDEMPOTENCY_KEY_REUSED" || status === 409) {
    return refuse(ENTRY_CONTROL_COPY.conflict);
  }
  if (status === 400) return refuse(ENTRY_CONTROL_COPY.unreadable);
  if (status === 0 || status === 408 || code === "NETWORK_UNAVAILABLE" || code === "TIMEOUT") {
    return { message: ENTRY_CONTROL_COPY.offline, retry: true, stop: false };
  }
  return { message: ENTRY_CONTROL_COPY.failed, retry: true, stop: false };
}

/**
 * Une lecture physique = un identifiant d'opération (aussi Idempotency-Key). Une reprise après
 * perte réseau rejoue la même opération : le serveur renvoie l'entrée déjà enregistrée.
 */
export async function submitEntryScan(
  read: EntryRead | EntryPending,
  deps: { scan: (body: EntryScanBody, options: { idempotencyKey: string }) => Promise<unknown> },
): Promise<EntryOutcome> {
  const pending: EntryPending = {
    cardToken: read.cardToken,
    medium: read.medium,
    operationId: "operationId" in read && read.operationId ? read.operationId : createIdempotencyKey(),
  };
  try {
    const raw = await deps.scan(
      { cardToken: pending.cardToken, medium: pending.medium, operationId: pending.operationId },
      { idempotencyKey: pending.operationId },
    );
    const result = parseEntryScanResponse(raw);
    if (!result) return { kind: "failed", failure: { message: ENTRY_CONTROL_COPY.failed, retry: false, stop: false } };
    return { kind: "recorded", result };
  } catch (error) {
    const failure = entryScanFailure(error);
    return failure.retry ? { kind: "failed", failure, retry: pending } : { kind: "failed", failure };
  }
}

/** Protection double lecture : la même carte relue pendant le délai n'est pas renvoyée. */
export function createEntryReadGate(cooldownMs: number) {
  let last: { token: string; at: number } | null = null;
  return {
    accept(token: string, now: number) {
      if (last && last.token === token && now - last.at < cooldownMs) return false;
      last = { token, at: now };
      return true;
    },
    reset() {
      last = null;
    },
  };
}
