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
}
export interface NfcEnrollmentApi {
  list(studentId: string): Promise<{ cards: EnrollmentCard[]; nfcEnabled: boolean }>;
  issue(studentId: string, identity: NtagIdentity, operationId: string): Promise<IssuedNfcCard>;
  replace(previous: EnrollmentCard, studentId: string, identity: NtagIdentity, operationId: string): Promise<IssuedNfcCard>;
  retry(card: EnrollmentCard, identity: NtagIdentity, operationId: string): Promise<IssuedNfcCard>;
  confirm(card: EnrollmentCard, token: string, locked: boolean, studentId: string): Promise<EnrollmentCard>;
  recover?(card: EnrollmentCard, token: string, studentId: string, operationId: string): Promise<EnrollmentCard>;
  reencode?(card: EnrollmentCard, identity: NtagIdentity, studentId: string, operationId: string): Promise<IssuedNfcCard>;
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
    NFC_REPLACE_REQUIRED: "Une carte active existe. Confirmez explicitement son remplacement.",
    NFC_SESSION_BUSY: "Une lecture ou une programmation NFC est déjà en cours. Terminez-la avant de réessayer.",
    NFC_SESSION_CANCELLED: "Session NFC interrompue. Reprenez l’opération existante.",
    NFC_BUSY: "Une opération NFC est déjà en cours.",
    STUDENT_CARD_NFC_UID_EXISTS: "Cette carte physique est déjà affectée. Son UID reste dans l’historique.",
    NFC_RESPONSE_INVALID: "Réponse serveur incohérente. Relisez l’état de l’opération.",
    NFC_RECOVERY_UNSUPPORTED_CHIP: "Diagnostic : puce non reconnue comme NTAG213 ou NTAG216. Aucune écriture effectuée.",
    NFC_RECOVERY_UID_MISMATCH: "Diagnostic : cette puce n’est pas celle réservée pour cet élève (UID différent). Aucune écriture effectuée.",
    NFC_RECOVERY_MODEL_MISMATCH: "Diagnostic : le modèle de puce lu ne correspond pas à la réservation. Aucune écriture effectuée.",
    NFC_RECOVERY_EMPTY: "Diagnostic : la carte est vide, l’écriture n’a jamais abouti. Récupération sans écriture impossible. Aucune écriture effectuée.",
    NFC_RECOVERY_FOREIGN_CONTENT: "Diagnostic : la carte contient des données qui ne sont pas Somafrik. Aucune écriture effectuée.",
    NFC_RECOVERY_INVALID_CONTENT: "Diagnostic : contenu Somafrik incomplet ou invalide. Aucune activation, aucune écriture effectuée.",
    NFC_RECOVERY_OTHER_CARD: "Diagnostic : la carte porte l’identifiant d’une autre carte Somafrik. Aucune activation, aucune écriture effectuée.",
    NFC_RECOVERY_USE_R1: "Diagnostic : la carte contient déjà le jeton Somafrik de cette carte. Utilisez « Récupérer cette carte NFC sans la réécrire ». Aucune écriture effectuée.",
    NFC_RECOVERY_READ_ONLY: "Diagnostic : la carte est en lecture seule (verrouillée). Réencodage impossible. Aucune écriture effectuée.",
    STUDENT_CARD_NOT_FOUND: "Le contenu de la carte ne correspond pas à cette réservation. Aucune activation.",
    STUDENT_CARD_NFC_MISMATCH: "La carte ou l’élève ne correspond pas à cette affectation. Aucune activation.",
    STUDENT_CARD_ACTIVE_ALREADY_EXISTS: "Cet élève a déjà une carte active ou une réservation en cours. Aucune activation.",
  };
  if (error && typeof error === "object" && (("status" in error && error.status === 403) || ("statusCode" in error && error.statusCode === 403))) return copies.STUDENT_CARD_TENANT_DENIED;
  return copies[code] ?? "Résultat non confirmé. Vérifiez la connexion, relisez l’état puis reprenez l’opération existante.";
}
function codeOf(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}
/** NFC-P0-RECOVERY-02 — recovery without write is offered only for a reservation the
 * server expired (never lost, replaced, security-revoked or abandoned cards), never
 * for a replacement, and only when the pupil has no active card or live reservation. */
export function canRecoverExpiredNfcCard(card: EnrollmentCard, cards: EnrollmentCard[]): boolean {
  if (card.status !== "revoked" || card.revokeReason !== "nfc_reservation_expired") return false;
  if (!card.nfc || card.nfc.state !== "pending" || card.nfc.replacesCardId) return false;
  return !cards.some((other) => other.id !== card.id && (other.status === "active" || (other.status === "issued" && other.nfc?.state === "pending")));
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
    const card = await checked(control, () => intent.previous
      ? input.api.replace(intent.previous!, input.studentId, intent.identity, intent.operationId)
      : input.api.issue(input.studentId, intent.identity, intent.operationId));
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
      try {
        await checked(control, () => input.hardware.openNdef(identity.uid));
        if (await checked(control, () => input.hardware.readText()) || await checked(control, () => input.hardware.isReadOnly())) throw nfcFailure("NFC_FOREIGN");
      } finally { await input.hardware.close(); }
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
    recover(card: EnrollmentCard) { return run(async () => {
      control.phase("resume");
      const cards = await list();
      const current = cards.find((item) => item.id === card.id);
      if (!current || current.publicId !== card.publicId || !canRecoverExpiredNfcCard(current, cards)) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      const expected = { uid: current.nfc!.uid, tagType: current.nfc!.tagType };
      control.phase("waiting");
      try {
        // Read-only diagnosis: inspect, open and read. No write, format or lock command.
        const observed = await checked(control, () => input.hardware.inspect()).catch((error) => {
          throw codeOf(error) === "NFC_FOREIGN" ? nfcFailure("NFC_RECOVERY_UNSUPPORTED_CHIP") : error;
        });
        if (observed.uid !== expected.uid) throw nfcFailure("NFC_RECOVERY_UID_MISMATCH");
        if (observed.tagType !== expected.tagType) throw nfcFailure("NFC_RECOVERY_MODEL_MISMATCH");
        await checked(control, () => input.hardware.openNdef(expected.uid));
        const value = await checked(control, () => input.hardware.readText()).catch((error) => {
          throw codeOf(error) === "NFC_FOREIGN" ? nfcFailure("NFC_RECOVERY_FOREIGN_CONTENT") : error;
        });
        if (!value) throw nfcFailure("NFC_RECOVERY_EMPTY");
        let token: string;
        try { token = cardTokenFromNdef(value); } catch { throw nfcFailure("NFC_RECOVERY_INVALID_CONTENT"); }
        if (token.split(".")[0] !== current.publicId) throw nfcFailure("NFC_RECOVERY_OTHER_CARD");
        control.phase("confirmation");
        if (typeof input.api.recover !== "function") throw nfcFailure("NFC_RESPONSE_INVALID");
        const result = await checked(control, () => input.api.recover!(current, token, input.studentId, input.uuid()));
        if (result.id !== current.id || result.publicId !== current.publicId || result.status !== "active" ||
            result.nfc?.uid !== expected.uid || result.nfc?.tagType !== expected.tagType ||
            !["encoded", "locked"].includes(result.nfc.state)) throw nfcFailure("NFC_RESPONSE_INVALID");
        return result;
      } finally { await input.hardware.close(); }
    }); },
    /** NFC-P0-R2 — re-encode a physically BLANK card whose expired reservation still
     * holds its UID. Order: read-only diagnosis, explicit consent, server reopening of
     * the same row (new secret), then the canonical write → re-read → confirm. */
    reencode(card: EnrollmentCard, consent: (identity: NtagIdentity) => Promise<boolean>) { return run(async () => {
      control.phase("resume");
      const cards = await list();
      const current = cards.find((item) => item.id === card.id);
      if (!current || current.publicId !== card.publicId || !canRecoverExpiredNfcCard(current, cards)) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      const expected: NtagIdentity = { uid: current.nfc!.uid, tagType: current.nfc!.tagType };
      control.phase("waiting");
      try {
        const observed = await checked(control, () => input.hardware.inspect()).catch((error) => {
          throw codeOf(error) === "NFC_FOREIGN" ? nfcFailure("NFC_RECOVERY_UNSUPPORTED_CHIP") : error;
        });
        if (observed.uid !== expected.uid) throw nfcFailure("NFC_RECOVERY_UID_MISMATCH");
        if (observed.tagType !== expected.tagType) throw nfcFailure("NFC_RECOVERY_MODEL_MISMATCH");
        await checked(control, () => input.hardware.openNdef(expected.uid));
        const value = await checked(control, () => input.hardware.readText()).catch((error) => {
          throw codeOf(error) === "NFC_FOREIGN" ? nfcFailure("NFC_RECOVERY_FOREIGN_CONTENT") : error;
        });
        if (value) {
          // Never erase content automatically: a Somafrik token of this card goes to R1.
          let token: string;
          try { token = cardTokenFromNdef(value); } catch { throw nfcFailure("NFC_RECOVERY_INVALID_CONTENT"); }
          throw nfcFailure(token.split(".")[0] === current.publicId ? "NFC_RECOVERY_USE_R1" : "NFC_RECOVERY_OTHER_CARD");
        }
        if (await checked(control, () => input.hardware.isReadOnly())) throw nfcFailure("NFC_RECOVERY_READ_ONLY");
      } finally { await input.hardware.close(); }
      if (await consent(expected) !== true) throw nfcFailure("NFC_REWRITE_REQUIRED");
      control.check();
      if (typeof input.api.reencode !== "function") throw nfcFailure("NFC_RESPONSE_INVALID");
      control.phase("reservation");
      const reopened = await checked(control, () => input.api.reencode!(current, expected, input.studentId, input.uuid()));
      if (reopened.id !== current.id || reopened.publicId !== current.publicId || reopened.status !== "issued" ||
          reopened.nfc?.uid !== expected.uid || reopened.nfc?.tagType !== expected.tagType || reopened.nfc.state !== "pending" ||
          reopened.nfc.replacesCardId || !reopened.cardToken || reopened.tokenAvailable === false) throw nfcFailure("NFC_RESPONSE_INVALID");
      // Canonical path: same-card check, blank re-check, read-only re-check, write, re-read, confirm.
      return encodeNfcCard(input.hardware, input.api, reopened, control);
    }); },
    rewrite(card: EnrollmentCard, consent: boolean) { return run(async () => {
      if (consent !== true) throw nfcFailure("NFC_REWRITE_REQUIRED");
      const current = await fresh(card); const identity = requireIdentity(current);
      if (current.status !== "issued") throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      control.phase("waiting");
      const observed = await checked(control, () => input.hardware.inspect());
      if (observed.uid !== identity.uid || observed.tagType !== identity.tagType) throw nfcFailure("NFC_FOREIGN");
      try {
        await checked(control, () => input.hardware.openNdef(identity.uid));
        const previous = await checked(control, () => input.hardware.readText());
        if ((previous && cardTokenFromNdef(previous).split(".")[0] !== current.publicId) || await checked(control, () => input.hardware.isReadOnly())) throw nfcFailure("NFC_FOREIGN");
      } finally { await input.hardware.close(); }
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
    reencode(card, identity, studentId, operationId) {
      return post(`/student-cards/${encodeURIComponent(card.id)}/nfc-reencode`, { ...identity, studentId, operationId });
    },
    recover(card, cardToken, studentId, operationId) {
      if (!card.nfc) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      return post(`/student-cards/${encodeURIComponent(card.id)}/nfc-recover`,
        { uid: card.nfc.uid, tagType: card.nfc.tagType, cardToken, studentId, operationId });
    },
    confirm(card, cardToken, locked, studentId) {
      if (!card.nfc) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      return post(`/student-cards/${encodeURIComponent(card.id)}/nfc-confirm`, { uid: card.nfc.uid, tagType: card.nfc.tagType, cardToken, locked, studentId, operationId: card.nfc.operationId });
    },
  };
}
