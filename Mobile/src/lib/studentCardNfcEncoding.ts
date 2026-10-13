/** NFC enrollment only; no attendance/finance calls, no persisted capability. */
export type NtagIdentity = { uid: string; tagType: "NTAG213" | "NTAG216" };
export type EnrollmentCard = {
  id: string; publicId: string; medium: string; status: string;
  nfc: (NtagIdentity & { state: "pending" | "encoded" | "locked" }) | null;
};
export type IssuedNfcCard = EnrollmentCard & { cardToken: string; reissued?: boolean };
export const NFC_LOCK_WARNING = "Le verrouillage est définitif. Le contenu NFC ne pourra plus être modifié. Vérifiez l’élève et la carte avant de continuer.";
export const NFC_FOREIGN_CARD = "Cette carte n’est pas une carte NTAG213 ou NTAG216 prise en charge par Somafrik.";
export const NDEF_PREFIX = "somafrik:card:";

export function normalizeNtagUid(value: unknown): string {
  const uid = typeof value === "string" ? value.replace(/[: -]/g, "").toUpperCase() : "";
  if (!/^04[0-9A-F]{12}$/.test(uid)) throw new Error(NFC_FOREIGN_CARD);
  return uid;
}
export function identifyNtag(uid: unknown, version: number[]): NtagIdentity {
  const normalized = normalizeNtagUid(uid);
  const prefix = [0, 4, 4, 2, 1, 0];
  if (version.length !== 8 || prefix.some((byte, i) => version[i] !== byte) || version[7] !== 3) throw new Error(NFC_FOREIGN_CARD);
  const tagType = version[6] === 0x0f ? "NTAG213" : version[6] === 0x13 ? "NTAG216" : null;
  if (!tagType) throw new Error(NFC_FOREIGN_CARD);
  return { uid: normalized, tagType };
}
export function cardTokenFromNdef(value: string): string {
  const token = value.startsWith(NDEF_PREFIX) ? value.slice(NDEF_PREFIX.length) : "";
  // Current canonical issuance: 16 bytes publicId + 32 bytes secret, base64url.
  if (!/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Cette carte ne contient pas un identifiant Somafrik valide.");
  return token;
}
export function ndefForCard(token: string): string {
  const value = `${NDEF_PREFIX}${token}`;
  cardTokenFromNdef(value);
  return value;
}
export interface NfcEncoderHardware {
  inspect(): Promise<NtagIdentity>;
  openNdef(expectedUid: string): Promise<void>;
  readText(): Promise<string>; // empty means no NDEF record; foreign data must throw
  writeText(value: string): Promise<void>;
  isReadOnly(): Promise<boolean>;
  makeReadOnly(): Promise<void>;
  close(): Promise<void>;
}
export interface NfcEnrollmentApi {
  issue(studentId: string, identity: NtagIdentity): Promise<IssuedNfcCard>;
  retry(card: EnrollmentCard, identity: NtagIdentity): Promise<IssuedNfcCard>;
  confirm(card: EnrollmentCard, token: string, locked: boolean): Promise<EnrollmentCard>;
}
function requireIdentity(card: EnrollmentCard): NtagIdentity {
  if (card.status !== "active" || !card.nfc) throw new Error("Carte inactive ou sans affectation NFC.");
  return card.nfc;
}

export async function encodeNfcCard(hardware: NfcEncoderHardware, api: NfcEnrollmentApi, card: IssuedNfcCard) {
  const identity = requireIdentity(card);
  const expected = ndefForCard(card.cardToken);
  try {
    await hardware.openNdef(identity.uid);
    const previous = await hardware.readText();
    if (previous && previous !== expected) {
      const previousPublicId = cardTokenFromNdef(previous).split(".")[0];
      if (card.reissued !== true || previousPublicId !== card.publicId) throw new Error("La carte contient déjà un autre identifiant. Aucune écriture effectuée.");
    }
    if (previous !== expected) {
      if (await hardware.isReadOnly()) throw new Error("Cette carte est déjà verrouillée.");
      await hardware.writeText(expected);
    }
    if (await hardware.readText() !== expected) throw new Error("Vérification de l’encodage échouée. La carte n’est pas activée.");
    return await api.confirm(card, card.cardToken, await hardware.isReadOnly());
  } finally { await hardware.close(); }
}

// Recover from a failed server confirmation by reading the card, never from local storage.
export async function verifyOrLockNfcCard(hardware: NfcEncoderHardware, api: NfcEnrollmentApi, card: EnrollmentCard, lock: boolean) {
  const identity = requireIdentity(card);
  try {
    const observed = await hardware.inspect();
    if (observed.uid !== identity.uid || observed.tagType !== identity.tagType) throw new Error("Présentez la carte affectée à cet élève.");
    await hardware.openNdef(identity.uid);
    const payload = await hardware.readText();
    const token = cardTokenFromNdef(payload);
    if (token.split(".")[0] !== card.publicId) throw new Error("Le contenu NFC ne correspond pas à cette carte.");
    // Server authorization and capability validation before an irreversible write.
    const verified = await api.confirm(card, token, await hardware.isReadOnly());
    if (!lock) return verified;
    if (!(await hardware.isReadOnly())) await hardware.makeReadOnly();
    if (!(await hardware.isReadOnly()) || await hardware.readText() !== payload) throw new Error("Verrouillage non confirmé. Relisez la carte avant de réessayer.");
    return await api.confirm(card, token, true);
  } finally { await hardware.close(); }
}

// Check the physical state before rotating a pending capability. A physically
// locked card with a lost confirmation must keep its existing secret.
export async function retryAndEncodeNfcCard(hardware: NfcEncoderHardware, api: NfcEnrollmentApi, card: EnrollmentCard, onIssued?: (card: IssuedNfcCard) => void) {
  const identity = requireIdentity(card);
  if (card.nfc?.state !== "pending") throw new Error("Seul un encodage en attente peut être repris.");
  try {
    const observed = await hardware.inspect();
    if (observed.uid !== identity.uid || observed.tagType !== identity.tagType) throw new Error("Présentez la carte affectée à cet élève.");
    await hardware.openNdef(identity.uid);
    const previous = await hardware.readText();
    if (previous && cardTokenFromNdef(previous).split(".")[0] !== card.publicId) throw new Error("La carte contient un autre identifiant. Aucune écriture effectuée.");
    if (await hardware.isReadOnly()) {
      if (!previous) throw new Error("Cette carte vierge est déjà verrouillée.");
      return await api.confirm(card, cardTokenFromNdef(previous), true);
    }
  } finally { await hardware.close(); }
  const reissued = await api.retry(card, identity);
  onIssued?.(reissued);
  return encodeNfcCard(hardware, api, reissued);
}
