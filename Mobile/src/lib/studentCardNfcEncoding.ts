import { safeLogger } from "../services/safeLogger";
/** NFC enrollment only; no attendance/finance calls, no persisted capability. */
export type NtagIdentity = { uid: string; tagType: "NTAG213" | "NTAG216" };
export type EnrollmentCard = {
  id: string; publicId: string; medium: string; status: string; revokeReason?: string | null;
  nfc: (NtagIdentity & { state: "pending" | "encoded" | "locked"; operationId: string | null; expiresAt: string | null; replacesCardId?: string | null }) | null;
};
export type IssuedNfcCard = EnrollmentCard & { cardToken?: string; tokenAvailable?: boolean; idempotentReplay?: boolean; reissued?: boolean };
export const NFC_FOREIGN_CARD = "Cette carte n’est pas une carte NTAG213 ou NTAG216 prise en charge par Somafrik.";
export const NDEF_PREFIX = "somafrik:card:";

export function normalizeNtagUid(value: unknown): string {
  const uid = typeof value === "string" ? value.replace(/[: -]/g, "").toUpperCase() : "";
  if (!/^04[0-9A-F]{12}$/.test(uid)) throw nfcFailure("NFC_FOREIGN");
  return uid;
}
export function identifyNtag(uid: unknown, version: number[]): NtagIdentity {
  const normalized = normalizeNtagUid(uid);
  const prefix = [0, 4, 4, 2, 1, 0];
  if (version.length !== 8 || prefix.some((byte, i) => version[i] !== byte) || version[7] !== 3) throw nfcFailure("NFC_FOREIGN");
  const tagType = version[6] === 0x0f ? "NTAG213" : version[6] === 0x13 ? "NTAG216" : null;
  if (!tagType) throw nfcFailure("NFC_FOREIGN");
  return { uid: normalized, tagType };
}
export function cardTokenFromNdef(value: string): string {
  const token = value.startsWith(NDEF_PREFIX) ? value.slice(NDEF_PREFIX.length) : "";
  // Current canonical issuance: 16 bytes publicId + 32 bytes secret, base64url.
  if (!/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(token)) throw nfcFailure("NFC_FOREIGN");
  return token;
}
export function ndefForCard(token: string): string {
  const value = `${NDEF_PREFIX}${token}`;
  cardTokenFromNdef(value);
  return value;
}
export interface NfcEncoderHardware {
  availability(): Promise<void>;
  inspect(): Promise<NtagIdentity>;
  openNdef(expectedUid: string): Promise<void>;
  readText(): Promise<string>;
  writeText(value: string): Promise<void>;
  isReadOnly(): Promise<boolean>;
  close(): Promise<void>;
  /** Libération complète (Reader Mode compris) à la fermeture de l'écran d'encodage. */
  end?(): Promise<void>;
}
export interface NfcEnrollmentApi {
  list(studentId: string): Promise<{ cards: EnrollmentCard[]; nfcEnabled: boolean }>;
  issue(studentId: string, identity: NtagIdentity, operationId: string): Promise<IssuedNfcCard>;
  replace(previous: EnrollmentCard, studentId: string, identity: NtagIdentity, operationId: string): Promise<IssuedNfcCard>;
  retry(card: EnrollmentCard, identity: NtagIdentity, operationId: string): Promise<IssuedNfcCard>;
  confirm(card: EnrollmentCard, token: string, locked: boolean, studentId: string): Promise<EnrollmentCard>;
}
export type NfcPhase = "initial" | "reservation" | "waiting" | "writing" | "verification" | "confirmation" | "success" | "error" | "expired" | "resume";
export const NFC_PHASE_COPY: Record<NfcPhase, string> = {
  initial: "Programmer une carte NFC", reservation: "Préparation de la carte",
  waiting: "Approchez une carte NFC NTAG213 ou NTAG216 du téléphone.", writing: "Écriture en cours",
  verification: "Vérification de la carte", confirmation: "Activation en cours",
  success: "Carte NFC programmée et activée avec succès.", error: "Opération interrompue. Reprenez l’opération existante.",
  expired: "Réservation expirée. Cette carte ne peut plus être activée.", resume: "Reprendre l’opération",
};
export function nfcFailure(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
// Never display native/backend error text: it may contain the physical capability.
export function nfcErrorCopy(error: unknown): string {
  const diagnostic = readNfcConfirmDiagnostic(error);
  if (diagnostic) return formatNfcConfirmFailure(diagnostic);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const copies: Record<string, string> = {
    STUDENT_CARD_DISABLED: "La fonctionnalité carte élève est désactivée pour cet établissement.",
    STUDENT_CARD_NFC_DISABLED: "La programmation NFC est désactivée pour cet établissement.",
    STUDENT_CARD_TENANT_DENIED: "Les droits ou l’établissement ne permettent pas cette opération.",
    STUDENT_CARD_NFC_OPERATION_REQUIRED: "Identifiant de réservation manquant ou invalide. Relisez l’état Backend.",
    STUDENT_CARD_NFC_OPERATION_MISMATCH: "La confirmation ne correspond pas à la réservation. Relisez l’état Backend.",
    STUDENT_CARD_NFC_EXPIRED: NFC_PHASE_COPY.expired,
    STUDENT_CARD_INVALID_STATE: "Carte révoquée, remplacée ou réservation indisponible. Actualisez les cartes.",
    NFC_CANCELLED: "Opération annulée. Relisez l’état de la carte avant de reprendre.",
    NFC_UNAVAILABLE: "Ce téléphone ne dispose pas de NFC.", NFC_DISABLED: "Activez le NFC dans les réglages du téléphone.",
    NFC_SCOPE_DENIED: "Les droits, l’établissement ou la fonctionnalité NFC ne permettent pas cette opération.",
    NFC_FOREIGN: "Carte incompatible ou contenant un autre identifiant. Aucune écriture autorisée.",
    NFC_CAPACITY: "Carte non inscriptible ou capacité insuffisante. Aucune activation confirmée.",
    NFC_SAME_CARD: "Présentez la même carte NFC réservée pour cet élève.",
    NFC_NDEF: "Carte sans format NDEF compatible. Aucune écriture effectuée.",
    NFC_STATE: "État NFC indisponible. Relisez la carte avant de confirmer.",
    NFC_READBACK: "Vérification de l’encodage échouée. Aucune activation confirmée.",
    NFC_REWRITE_REQUIRED: "Relisez d’abord la carte. Une réécriture nécessite votre confirmation explicite.",
    NFC_PENDING: "Une réservation existe déjà. Reprenez cette opération.",
    NFC_TAG_LOST: "Carte retirée pendant l’opération. Reprenez l’opération et maintenez la carte contre le téléphone jusqu’à la confirmation.",
    NFC_REPLACE_REQUIRED: "Une carte active existe. Confirmez explicitement son remplacement.",
    NFC_SESSION_BUSY: "Une lecture ou une programmation NFC est déjà en cours. Terminez-la avant de réessayer.",
    NFC_SESSION_CANCELLED: "Session NFC interrompue. Reprenez l’opération existante.",
    NFC_BUSY: "Une opération NFC est déjà en cours.",
    STUDENT_CARD_NFC_UID_EXISTS: "Cette carte NFC est déjà enregistrée. Vérifiez son affectation avant de poursuivre.",
    STUDENT_CARD_NFC_INVALID: "Observation NFC refusée. Relisez la carte avant de confirmer.",
    STUDENT_CARD_NFC_MISMATCH: "La carte présentée ne correspond pas à la réservation. Aucune activation effectuée.",
    STUDENT_CARD_NOT_FOUND: "Confirmation refusée. Relisez l’état de la carte.",
    STUDENT_CARD_ACTIVE_ALREADY_EXISTS: "Une autre carte active existe déjà. Aucune activation effectuée.",
    STUDENT_CARD_NFC_POSTGRES_REQUIRED: "La confirmation ne peut pas être enregistrée pour le moment. Relisez l’état plus tard.",
    STUDENT_CARD_NFC_CONFLICT: "Une opération concurrente existe déjà. Relisez les cartes de l’élève.",
    NFC_RESPONSE_INVALID: "Réponse serveur incohérente. Relisez l’état de l’opération.",
  };
  if (error && typeof error === "object" && (("status" in error && error.status === 403) || ("statusCode" in error && error.statusCode === 403))) return copies.STUDENT_CARD_TENANT_DENIED;
  return copies[code] ?? "Résultat non confirmé. Vérifiez la connexion, relisez l’état puis reprenez l’opération existante.";
}
export const NFC_INTERRUPTED_RESERVATION_LABEL = "Reprendre la réservation interrompue";
export const NFC_REPLACE_ACTIVE_LABEL = "Remplacer la carte active";
export const NFC_SERVER_RESUME_LABEL = "Reprendre l’opération — relire et confirmer";
export const NFC_LIST_REFRESHING_COPY = "Actualisation en cours. Les cartes affichées peuvent dater de la lecture précédente.";
export const NFC_LIST_STALE_COPY = "Dernière liste conservée. Elle n’a pas pu être actualisée et peut être obsolète.";
/** A committed refusal proves no new reservation exists. Uncertain transport does not. */
export function nfcReservationFailureClearsAttempt(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "STUDENT_CARD_NFC_UID_EXISTS");
}
export type NfcDisplayedCardList = { scopeKey: string; studentId: string; cards: EnrollmentCard[] };
export function beginNfcCardListLoad(current: NfcDisplayedCardList | null, scopeKey: string, studentId: string): { retain: boolean; cards: EnrollmentCard[] | null } {
  if (current && current.scopeKey === scopeKey && current.studentId === studentId) return { retain: true, cards: current.cards };
  return { retain: false, cards: null };
}
export function applyNfcCardListResponse(retained: NfcDisplayedCardList | null, scopeKey: string, studentId: string, response: unknown): { list: NfcDisplayedCardList | null; malformed: boolean } {
  const cards = response && typeof response === "object" && "cards" in response ? response.cards : undefined;
  if (!Array.isArray(cards)) return { list: retained, malformed: true };
  return { list: { scopeKey, studentId, cards }, malformed: false };
}
export function resolveNfcCardListLoad(previous: NfcDisplayedCardList | null, scopeKey: string, studentId: string, outcome: { ok: true; body: unknown } | { ok: false }): { list: NfcDisplayedCardList | null; malformed: boolean; stale: boolean } {
  const started = beginNfcCardListLoad(previous, scopeKey, studentId);
  const retained = started.retain ? previous : null;
  if (!outcome.ok) return { list: retained, malformed: false, stale: retained !== null };
  const applied = applyNfcCardListResponse(retained, scopeKey, studentId, outcome.body);
  if (applied.malformed) return { ...applied, stale: applied.list !== null };
  return { ...applied, stale: false };
}
export function nfcListSensitiveActionsAllowed(input: { stale: boolean; hasList: boolean }): boolean {
  return input.hasList && !input.stale;
}
export function acceptNfcCardListResult(request: { scopeKey: string; studentId: string }, current: { scopeKey: string; studentId: string }): boolean {
  return request.scopeKey === current.scopeKey && request.studentId === current.studentId;
}
export function nfcServerResumeVisible(card: { status: string; nfc?: unknown }): boolean {
  return card.status === "issued" && Boolean(card.nfc);
}
export function nfcEnrollmentPrimaryAction(input: { uncertain: boolean; hasPending: boolean; hasActive: boolean }): "server-pending" | "interrupted" | "replace" | "program" {
  if (input.hasPending) return "server-pending";
  if (input.uncertain) return "interrupted";
  if (input.hasActive) return "replace";
  return "program";
}

const NFC_CONFIRM_TRANSPORT_CODES = ["TIMEOUT", "NETWORK_UNAVAILABLE", "BACKEND_UNREACHABLE"] as const;
const NFC_CONFIRM_BUSINESS_CODES = [
  "STUDENT_CARD_DISABLED", "STUDENT_CARD_NFC_DISABLED", "STUDENT_CARD_TENANT_DENIED",
  "STUDENT_CARD_NFC_OPERATION_REQUIRED", "STUDENT_CARD_NFC_OPERATION_MISMATCH", "STUDENT_CARD_NFC_EXPIRED",
  "STUDENT_CARD_INVALID_STATE", "STUDENT_CARD_NFC_UID_EXISTS", "STUDENT_CARD_NFC_INVALID", "STUDENT_CARD_NFC_MISMATCH",
  "STUDENT_CARD_NOT_FOUND", "STUDENT_CARD_ACTIVE_ALREADY_EXISTS", "STUDENT_CARD_NFC_POSTGRES_REQUIRED", "STUDENT_CARD_NFC_CONFLICT",
] as const;
/** Inbound code rejected: an HTTP status arrived with a code outside the catalog. */
export const NFC_CONFIRM_HTTP_REJECTED = "NFC_CONFIRM_HTTP_REJECTED";
/** HTTP body missing or not a trusted JSON error. */
export const NFC_CONFIRM_UNREADABLE = "NFC_CONFIRM_UNREADABLE";
/** No HTTP status and no trusted transport code. */
export const NFC_CONFIRM_UNCLASSIFIED = "NFC_CONFIRM_UNCLASSIFIED";
export const NFC_CONFIRM_LOG_PATH = "/student-cards/:id/nfc-confirm";
export const NFC_CONFIRM_FAILURE_EVENT = "nfc_confirm_failure";
const NFC_CONFIRM_TRANSPORT = new Set<string>(NFC_CONFIRM_TRANSPORT_CODES);
const NFC_CONFIRM_BUSINESS = new Set<string>(NFC_CONFIRM_BUSINESS_CODES);
const NFC_CONFIRM_DIAGNOSTIC_CODES = new Set<string>([
  ...NFC_CONFIRM_TRANSPORT_CODES, ...NFC_CONFIRM_BUSINESS_CODES,
  NFC_CONFIRM_HTTP_REJECTED, NFC_CONFIRM_UNREADABLE, NFC_CONFIRM_UNCLASSIFIED,
]);
export type NfcConfirmDiagnostic = { code: string; status: number | null };
const NFC_CONFIRM_DIAGNOSTIC = Symbol("nfcConfirmDiagnostic");

function confirmHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = "status" in error ? error.status : "statusCode" in error ? error.statusCode : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function confirmRawCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "";
  return error.code;
}
/** Accept transport codes only without an HTTP response, and business codes only from a numeric HTTP status. */
export function classifyNfcConfirmFailure(error: unknown): NfcConfirmDiagnostic {
  const status = confirmHttpStatus(error);
  const raw = confirmRawCode(error);
  const http = status !== null && status !== 0;
  if (!http && NFC_CONFIRM_TRANSPORT.has(raw)) return { code: raw, status };
  if (http && NFC_CONFIRM_BUSINESS.has(raw)) return { code: raw, status };
  if (http && raw === "") return { code: NFC_CONFIRM_UNREADABLE, status };
  if (http) return { code: NFC_CONFIRM_HTTP_REJECTED, status };
  if (raw === "") return { code: NFC_CONFIRM_UNREADABLE, status: null };
  return { code: NFC_CONFIRM_UNCLASSIFIED, status: null };
}
export function readNfcConfirmDiagnostic(error: unknown): NfcConfirmDiagnostic | null {
  if (!error || typeof error !== "object" || !(NFC_CONFIRM_DIAGNOSTIC in error)) return null;
  const value = (error as { [NFC_CONFIRM_DIAGNOSTIC]?: NfcConfirmDiagnostic })[NFC_CONFIRM_DIAGNOSTIC];
  if (!value || typeof value.code !== "string" || !NFC_CONFIRM_DIAGNOSTIC_CODES.has(value.code)) return null;
  const status = typeof value.status === "number" && Number.isFinite(value.status) ? value.status : null;
  return { code: value.code, status };
}
export function isNfcConfirmFailure(error: unknown): boolean {
  return readNfcConfirmDiagnostic(error) !== null;
}
function formatNfcConfirmFailure(diagnostic: NfcConfirmDiagnostic): string {
  const phrase = nfcErrorCopy({ code: diagnostic.code, status: diagnostic.code === "STUDENT_CARD_TENANT_DENIED" ? 403 : undefined });
  return `${phrase} (Code : ${diagnostic.code})`;
}
export function nfcConfirmFailureCopy(error: unknown): string {
  return formatNfcConfirmFailure(readNfcConfirmDiagnostic(error) ?? { code: NFC_CONFIRM_UNCLASSIFIED, status: null });
}
export type NfcNoticeBoard = { terminal: string; refresh: string };
export function nfcTerminalNotice(error: unknown): string {
  return isNfcConfirmFailure(error) ? nfcConfirmFailureCopy(error) : nfcErrorCopy(error);
}
/** NFC outcome and list refresh never share a channel. */
export function keepNfcTerminalNotice(board: NfcNoticeBoard, error: unknown): NfcNoticeBoard {
  return { terminal: nfcTerminalNotice(error), refresh: board.refresh };
}
export function noteNfcRefreshFailure(board: NfcNoticeBoard, error: unknown): NfcNoticeBoard {
  return { terminal: board.terminal, refresh: nfcErrorCopy(error) };
}
export function clearNfcRefreshNotice(board: NfcNoticeBoard): NfcNoticeBoard {
  return { terminal: board.terminal, refresh: "" };
}
export function setNfcTerminalNotice(board: NfcNoticeBoard, terminal: string): NfcNoticeBoard {
  return { terminal, refresh: board.refresh };
}
export function nfcNoticeText(board: NfcNoticeBoard): string {
  return [board.terminal, board.refresh].filter(Boolean).join("\n");
}
function asNfcConfirmFailure(error: unknown): Error & { code: string; status: number | null } {
  const diagnostic = classifyNfcConfirmFailure(error);
  safeLogger.warn(NFC_CONFIRM_FAILURE_EVENT, {
    method: "POST",
    path: NFC_CONFIRM_LOG_PATH,
    status: diagnostic.status,
    code: diagnostic.code,
  });
  const failure = nfcFailure(diagnostic.code) as Error & { code: string; status: number | null };
  Object.defineProperty(failure, NFC_CONFIRM_DIAGNOSTIC, { value: diagnostic });
  failure.status = diagnostic.status;
  failure.message = formatNfcConfirmFailure(diagnostic);
  return failure;
}
function requireIdentity(card: EnrollmentCard): NtagIdentity {
  if (card.status === "revoked" && card.revokeReason === "nfc_reservation_expired") throw nfcFailure("STUDENT_CARD_NFC_EXPIRED");
  if (!card.nfc || !["issued", "active"].includes(card.status)) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
  if (card.status === "issued" && (card.nfc.state !== "pending" || !card.nfc.operationId || !card.nfc.expiresAt || !Number.isFinite(Date.parse(card.nfc.expiresAt)))) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
  if (card.status === "active" && !["encoded", "locked"].includes(card.nfc.state)) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
  return { uid: card.nfc.uid, tagType: card.nfc.tagType };
}
function assertActive(card: EnrollmentCard, previous: EnrollmentCard) {
  if (card.id !== previous.id || card.publicId !== previous.publicId || card.status !== "active" || !card.nfc || !["encoded", "locked"].includes(card.nfc.state)
    || card.nfc.uid !== previous.nfc?.uid || card.nfc.tagType !== previous.nfc?.tagType || card.nfc.operationId !== previous.nfc?.operationId) throw nfcFailure("NFC_RESPONSE_INVALID");
  return card;
}
export type FlowControl = { check(): void; phase(phase: NfcPhase): void; studentId: string };
async function checked<T>(control: FlowControl, action: () => Promise<T>): Promise<T> {
  control.check(); const result = await action(); control.check(); return result;
}
async function confirmRead(hardware: NfcEncoderHardware, api: NfcEnrollmentApi, card: EnrollmentCard, payload: string, control: FlowControl) {
  const token = cardTokenFromNdef(payload);
  if (token.split(".")[0] !== card.publicId) throw nfcFailure("NFC_FOREIGN");
  control.phase("verification");
  if (await checked(control, () => hardware.readText()) !== payload) throw nfcFailure("NFC_READBACK");
  const locked = await checked(control, () => hardware.isReadOnly());
  control.phase("confirmation");
  return assertActive(await checked(control, () => api.confirm(card, token, locked, control.studentId)), card);
}
export async function encodeNfcCard(hardware: NfcEncoderHardware, api: NfcEnrollmentApi, card: IssuedNfcCard, control: FlowControl, allowRewrite = false) {
  try {
    const identity = requireIdentity(card);
    if (card.status !== "issued" || !card.cardToken || card.tokenAvailable === false) throw nfcFailure("NFC_REWRITE_REQUIRED");
    const expected = ndefForCard(card.cardToken);
    if (cardTokenFromNdef(expected).split(".")[0] !== card.publicId) throw nfcFailure("NFC_RESPONSE_INVALID");
    await checked(control, () => hardware.openNdef(identity.uid));
    const previous = await checked(control, () => hardware.readText());
    if (previous && previous !== expected) {
      if (!allowRewrite || card.reissued !== true || cardTokenFromNdef(previous).split(".")[0] !== card.publicId) throw nfcFailure("NFC_FOREIGN");
    }
    if (previous !== expected) {
      if (await checked(control, () => hardware.isReadOnly())) throw nfcFailure("NFC_FOREIGN");
      control.phase("writing");
      await checked(control, () => hardware.writeText(expected));
    }
    control.phase("verification");
    if (await checked(control, () => hardware.readText()) !== expected) throw nfcFailure("NFC_READBACK");
    return await confirmRead(hardware, api, card, expected, control);
  } finally { await hardware.close(); }
}
// Recovery reads the capability from the chip; it never writes or rotates it.
export async function verifyNfcCard(hardware: NfcEncoderHardware, api: NfcEnrollmentApi, card: EnrollmentCard, control: FlowControl) {
  try {
    const identity = requireIdentity(card);
    control.phase("waiting");
    const observed = await checked(control, () => hardware.inspect());
    if (observed.uid !== identity.uid || observed.tagType !== identity.tagType) throw nfcFailure("NFC_FOREIGN");
    await checked(control, () => hardware.openNdef(identity.uid));
    const payload = await checked(control, () => hardware.readText());
    if (!payload) throw nfcFailure("NFC_REWRITE_REQUIRED");
    return await confirmRead(hardware, api, card, payload, control);
  } finally { await hardware.close(); }
}

/** Metadata only survives an interrupted request in RAM. After restart the scoped
 * canonical list supplies reservation/operation IDs; no secret is persisted. */
export function createIndividualNfcFlow(input: {
  studentId: string; api: NfcEnrollmentApi; hardware: NfcEncoderHardware;
  uuid(): string; valid(): boolean; phase(phase: NfcPhase): void;
}) {
  let busy = false;
  let attempt: { operationId: string; identity: NtagIdentity; previous?: EnrollmentCard } | null = null;
  const control: FlowControl = { studentId: input.studentId, phase: input.phase, check() { if (!input.valid()) throw nfcFailure("NFC_CANCELLED"); } };
  async function run(action: () => Promise<EnrollmentCard>) {
    if (busy) throw nfcFailure("NFC_BUSY");
    busy = true;
    try { control.check(); await checked(control, () => input.hardware.availability()); const result = await action(); control.check(); input.phase("success"); attempt = null; return result; }
    finally { try { await input.hardware.close(); } finally { busy = false; } }
  }
  async function list() {
    const result = await checked(control, () => input.api.list(input.studentId));
    if (result.nfcEnabled !== true || !Array.isArray(result.cards)) throw nfcFailure("NFC_SCOPE_DENIED");
    return result.cards;
  }
  async function fresh(card: EnrollmentCard) {
    const found = (await list()).find((item) => item.id === card.id);
    if (!found || found.publicId !== card.publicId || found.nfc?.operationId !== card.nfc?.operationId) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
    requireIdentity(found); return found;
  }
  async function reserve() {
    if (!attempt) throw nfcFailure("NFC_RESPONSE_INVALID");
    const intent = attempt;
    control.phase("reservation");
    let card: IssuedNfcCard;
    try {
      card = await checked(control, () => intent.previous
        ? input.api.replace(intent.previous!, input.studentId, intent.identity, intent.operationId)
        : input.api.issue(input.studentId, intent.identity, intent.operationId));
    } catch (error) {
      if (nfcReservationFailureClearsAttempt(error)) attempt = null;
      throw error;
    }
    if (card.nfc?.operationId !== intent.operationId || card.nfc.uid !== intent.identity.uid || card.nfc.tagType !== intent.identity.tagType
      || card.nfc.replacesCardId !== (intent.previous?.id ?? null)) throw nfcFailure("NFC_RESPONSE_INVALID");
    if (!card.cardToken || card.tokenAvailable === false) return verifyNfcCard(input.hardware, input.api, card, control);
    return encodeNfcCard(input.hardware, input.api, card, control);
  }
  return {
    hasUncertainReservation() { return attempt !== null; },
    program(previous?: EnrollmentCard) { return run(async () => {
      const cards = await list();
      if (attempt || cards.some((c) => c.status === "issued" && c.nfc?.state === "pending")) throw nfcFailure("NFC_PENDING");
      const active = cards.find((c) => c.status === "active");
      if (active && active.id !== previous?.id) throw nfcFailure("NFC_REPLACE_REQUIRED");
      if (previous && (!active || active.id !== previous.id)) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      // #912 requires UID/model before reservation; preflight also refuses foreign NDEF.
      control.phase("waiting");
      const identity = await checked(control, () => input.hardware.inspect());
      // One tap: the chip stays held through the reservation and the write; run() releases it on failure.
      await checked(control, () => input.hardware.openNdef(identity.uid));
      if (await checked(control, () => input.hardware.readText()) || await checked(control, () => input.hardware.isReadOnly())) throw nfcFailure("NFC_FOREIGN");
      control.check(); attempt = { operationId: input.uuid(), identity, previous };
      return reserve();
    }); },
    resume(card?: EnrollmentCard) { return run(async () => {
      control.phase("resume");
      if (card) return verifyNfcCard(input.hardware, input.api, await fresh(card), control);
      const cards = await list();
      if (!attempt) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      const found = cards.find((c) => c.nfc?.operationId === attempt?.operationId);
      if (found) {
        if (!["issued", "active"].includes(found.status)) attempt = null;
        return verifyNfcCard(input.hardware, input.api, found, control);
      }
      // Same UUID/UID/context only; never create a second reservation automatically.
      if (!attempt) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      const observed = await checked(control, () => input.hardware.inspect());
      if (observed.uid !== attempt.identity.uid || observed.tagType !== attempt.identity.tagType) throw nfcFailure("NFC_FOREIGN");
      return reserve();
    }); },
    rewrite(card: EnrollmentCard, consent: boolean) { return run(async () => {
      if (consent !== true) throw nfcFailure("NFC_REWRITE_REQUIRED");
      const current = await fresh(card); const identity = requireIdentity(current);
      if (current.status !== "issued") throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      control.phase("waiting");
      const observed = await checked(control, () => input.hardware.inspect());
      if (observed.uid !== identity.uid || observed.tagType !== identity.tagType) throw nfcFailure("NFC_FOREIGN");
      await checked(control, () => input.hardware.openNdef(identity.uid));
      const previous = await checked(control, () => input.hardware.readText());
      if ((previous && cardTokenFromNdef(previous).split(".")[0] !== current.publicId) || await checked(control, () => input.hardware.isReadOnly())) throw nfcFailure("NFC_FOREIGN");
      control.phase("reservation");
      // Explicit user intent creates a retry UUID. A lost retry response leads back
      // to read/confirm; another rotation requires another explicit confirmation.
      const reissued = await checked(control, () => input.api.retry(current, identity, input.uuid()));
      if (reissued.id !== current.id || reissued.publicId !== current.publicId || reissued.nfc?.operationId !== current.nfc?.operationId || reissued.nfc?.uid !== identity.uid || reissued.nfc?.tagType !== identity.tagType
        || reissued.nfc?.expiresAt !== current.nfc?.expiresAt || reissued.nfc?.replacesCardId !== current.nfc?.replacesCardId) throw nfcFailure("NFC_RESPONSE_INVALID");
      if (!reissued.cardToken || reissued.tokenAvailable === false) return verifyNfcCard(input.hardware, input.api, reissued, control);
      return encodeNfcCard(input.hardware, input.api, reissued, control, true);
    }); },
  };
}

export function createNfcEnrollmentApi(request: <T>(path: string, options?: { method?: string; body?: string; cache?: "no-store" }) => Promise<T>): NfcEnrollmentApi {
  const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });
  return {
    list(studentId) { return request(`/students/${encodeURIComponent(studentId)}/cards`, { cache: "no-store" }); },
    issue(studentId, identity, operationId) { return post("/student-cards", { studentId, medium: "nfc", nfc: identity, operationId }); },
    replace(previous, studentId, identity, operationId) { return post(`/student-cards/${encodeURIComponent(previous.id)}/replace`, { studentId, medium: "nfc", nfc: identity, operationId }); },
    retry(card, identity, operationId) { return post(`/student-cards/${encodeURIComponent(card.id)}/nfc-retry`, { ...identity, operationId }); },
    async confirm(card, cardToken, locked, studentId) {
      if (!card.nfc) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      try {
        return await post(`/student-cards/${encodeURIComponent(card.id)}/nfc-confirm`, { uid: card.nfc.uid, tagType: card.nfc.tagType, cardToken, locked, studentId, operationId: card.nfc.operationId });
      } catch (error) {
        throw asNfcConfirmFailure(error);
      }
    },
  };
}
