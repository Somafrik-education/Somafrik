import { Platform } from "react-native";
import NfcManager, { Ndef, NdefStatus, NfcAdapter, NfcTech } from "react-native-nfc-manager";
import { identifyNtag, normalizeNtagUid, nfcFailure, type NfcEncoderHardware, type NtagIdentity } from "./studentCardNfcEncoding";
import { createNativeNfcSession } from "./nfcSessionNative";
import { NTAG_READ, readNtagNdefArea, type CapabilityContainer } from "./ntagMemory";

const ENCODER_READER_MODE = {
  isReaderModeEnabled: true,
  readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B,
};
/** Durée maximale pendant laquelle une puce découverte reste retenue sans opération NFC (requête réseau lente). */
export const NFC_HOLD_IDLE_MS = 20_000;

type Tech = typeof NfcTech.NfcA | typeof NfcTech.Ndef;
type Held = { uid: string; techs: string[]; tech: Tech | null };

const sameBytes = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, i) => value === b[i]);
const asBytes = (value: unknown): number[] => typeof value === "string" ? Array.from(value, (c) => c.charCodeAt(0)) : Array.from((value ?? []) as ArrayLike<number>);

/**
 * Only GET_VERSION and READ are sent raw. Programming never commands a physical lock.
 *
 * CARTE-NFC-ONE-TAP-01 : une seule découverte par carte. Le natif conserve la dernière puce
 * découverte (NfcManager.this.tag) ; `close()` puis `connect([tech])` changent de technologie sur
 * cette même puce sans nouvel onTagDiscovered, sous le bail du gestionnaire de session partagé.
 * Chaque changement revérifie l'UID (une autre puce découverte entre-temps est refusée).
 * Android ne relit pas la puce dans getNdefMessage (message mis en cache à la découverte) : la
 * zone NDEF est relue physiquement par READ NfcA (ntagMemory) et comparée octet par octet à
 * l'écriture. Une puce retenue sans opération pendant NFC_HOLD_IDLE_MS est libérée ; l'étape
 * suivante demande alors une nouvelle présentation de la même carte.
 */
export function createNfcEncoderHardware(onPrompt?: (message: string) => void, options: { holdIdleMs?: number } = {}): NfcEncoderHardware {
  const session = createNativeNfcSession();
  const holdIdleMs = options.holdIdleMs ?? NFC_HOLD_IDLE_MS;
  let supportedIdentity: NtagIdentity | null = null;
  let held: Held | null = null;
  let written: number[] | null = null;
  let cc: CapabilityContainer | null = null;
  let busy = 0;
  let idle: ReturnType<typeof setTimeout> | null = null;
  // RC-6 : le Reader Mode est tenu de la 1re lecture jusqu'à end(). Laissé à requestTechnology,
  // chaque close()/reset() le coupait ~1 s plus tard (cancelTechnologyRequest → unregisterTagEvent) :
  // une puce maintenue ou représentée était redistribuée à com.android.apps.tag, l'application
  // passait en arrière-plan et l'opération était interrompue. Chaque étape ne rend que son bail.
  let readerModeHeld = false;
  async function holdReaderMode() {
    if (readerModeHeld) return;
    readerModeHeld = true; // marqué avant l'appel : end() désinscrit même un enregistrement interrompu
    await session.run(() => NfcManager.registerTagEvent(ENCODER_READER_MODE));
  }
  function stopIdle() {
    if (idle) clearTimeout(idle);
    idle = null;
  }
  async function close() {
    stopIdle();
    held = null;
    await session.close();
  }
  /** Every NFC step: no idle release while it runs; the hold deadline restarts once it settles. */
  async function step<T>(operation: () => Promise<T>): Promise<T> {
    stopIdle();
    busy += 1;
    try {
      return await operation();
    } finally {
      busy -= 1;
      if (held && busy === 0) idle = setTimeout(() => { if (busy === 0) void close().catch(() => {}); }, holdIdleMs);
    }
  }
  async function ready() {
    if (Platform.OS !== "android") throw new Error("L’encodage NFC est disponible sur Android uniquement.");
    if (!(await session.run(() => NfcManager.isSupported()))) throw nfcFailure("NFC_UNAVAILABLE");
    await session.start();
    if (!(await session.run(() => NfcManager.isEnabled()))) throw nfcFailure("NFC_DISABLED");
  }
  async function verifyHeldUid(current: Held) {
    const tag = await session.run(() => NfcManager.getTag());
    if (normalizeNtagUid(tag?.id) !== current.uid) {
      held = null;
      throw nfcFailure("NFC_SAME_CARD");
    }
  }
  /** Switches technology on the already discovered chip; never waits for a new discovery. */
  async function use(tech: Tech) {
    const current = held;
    if (!current) throw nfcFailure("NFC_TAG_LOST");
    if (current.tech === tech) return;
    current.tech = null;
    await session.run(() => NfcManager.close()).catch(() => {}); // aucune technologie ouverte : rien à fermer
    try {
      await session.request(() => NfcManager.connect([tech]));
    } catch {
      held = null;
      // TagTechnologyRequest.connect ne distingue pas : puce retirée ou technologie absente.
      if (!current.techs.includes(tech)) throw nfcFailure(tech === NfcTech.Ndef ? "NFC_NDEF" : "NFC_FOREIGN");
      throw nfcFailure("NFC_TAG_LOST");
    }
    await verifyHeldUid(current);
    current.tech = tech;
  }
  async function guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) throw error;
      held = null; // I/O NFC interrompue : la puce a quitté le champ ou ne répond plus
      throw nfcFailure("NFC_TAG_LOST");
    }
  }
  async function openNdef(expectedUid: string, prompt?: string) {
    await step(async () => {
      await ready();
      const uid = normalizeNtagUid(expectedUid);
      if (!supportedIdentity || supportedIdentity.uid !== uid) throw nfcFailure("NFC_SAME_CARD");
      if (held?.uid === uid) return use(NfcTech.Ndef);
      // Puce libérée (délai dépassé) : nouvelle présentation de la même carte, contrôlée par UID.
      onPrompt?.(prompt || "Présentez de nouveau la même carte et maintenez-la contre le téléphone.");
      await holdReaderMode();
      const tech = await session.request(() => NfcManager.requestTechnology([NfcTech.Ndef, NfcTech.NfcA, NfcTech.NfcB, NfcTech.IsoDep], ENCODER_READER_MODE));
      if (tech !== NfcTech.Ndef) throw nfcFailure("NFC_NDEF");
      const tag = await session.run(() => NfcManager.getTag());
      if (normalizeNtagUid(tag?.id) !== uid) throw nfcFailure("NFC_SAME_CARD");
      held = { uid, techs: (tag?.techTypes ?? []).map((t: string) => t.replace("android.nfc.tech.", "")), tech: NfcTech.Ndef };
    });
  }
  return {
    async availability() { try { await ready(); } finally { await close(); } },
    async inspect() {
      try {
        return await step(async () => {
          supportedIdentity = null;
          held = null;
          written = null;
          cc = null;
          await ready();
          // Include foreign technologies for an explicit refusal (Navigo), never a write.
          onPrompt?.("Présentez la carte et maintenez-la contre le téléphone jusqu’à la confirmation.");
          await holdReaderMode();
          const tech = await session.request(() => NfcManager.requestTechnology([NfcTech.NfcA, NfcTech.NfcB, NfcTech.IsoDep], ENCODER_READER_MODE));
          if (tech !== NfcTech.NfcA) throw nfcFailure("NFC_FOREIGN");
          const tag = await session.run(() => NfcManager.getTag());
          let version: number[];
          try { version = await session.run(() => NfcManager.nfcAHandler.transceive([0x60])); }
          catch { throw nfcFailure("NFC_FOREIGN"); }
          supportedIdentity = identifyNtag(tag?.id, version);
          held = { uid: supportedIdentity.uid, techs: (tag?.techTypes ?? []).map((t: string) => t.replace("android.nfc.tech.", "")), tech: NfcTech.NfcA };
          return supportedIdentity;
        });
      } catch (error) {
        await close();
        throw error;
      }
    },
    openNdef,
    async readText() {
      return step(async () => {
        if (!supportedIdentity) throw nfcFailure("NFC_SAME_CARD");
        await use(NfcTech.NfcA);
        const model = supportedIdentity.tagType;
        const area = await guard(() => readNtagNdefArea((page) => session.run(() => NfcManager.nfcAHandler.transceive([NTAG_READ, page])), model));
        cc = area.cc;
        if (written && !sameBytes(area.message, written)) throw nfcFailure("NFC_READBACK");
        if (area.message.length === 0) return "";
        let records: { tnf: number; type: unknown; payload: unknown }[];
        try { records = Ndef.decodeMessage(area.message); } catch { throw nfcFailure("NFC_FOREIGN"); }
        if (!records || records.length === 0) return "";
        if (records.length !== 1) throw nfcFailure("NFC_FOREIGN");
        const type = asBytes(records[0].type), payload = asBytes(records[0].payload);
        // Empty record is the factory NDEF on a blank tag.
        if (records[0].tnf === 0 && payload.length === 0 && type.length === 0) return "";
        if (records[0].tnf !== 1 || type.length !== 1 || type[0] !== 0x54) throw nfcFailure("NFC_FOREIGN");
        return Ndef.text.decodePayload(new Uint8Array(payload));
      });
    },
    async writeText(value) {
      await step(async () => {
        const bytes = Ndef.encodeMessage([Ndef.textRecord(value, "en")]);
        await use(NfcTech.Ndef);
        const status = await guard(() => session.run(() => NfcManager.ndefHandler.getNdefStatus()));
        if (!bytes || status.status !== NdefStatus.ReadWrite || !Number.isFinite(status.capacity) || bytes.length > status.capacity) throw nfcFailure("NFC_CAPACITY");
        if (cc && bytes.length + 4 > cc.dataBytes) throw nfcFailure("NFC_CAPACITY"); // TLV 03 + longueur + FE
        // Toute reprise après cette ligne relit la puce : l'écriture a pu aboutir même en cas d'erreur.
        written = bytes;
        await guard(() => session.run(() => NfcManager.ndefHandler.writeNdefMessage(bytes)));
      });
    },
    async isReadOnly() {
      return step(async () => {
        await use(NfcTech.Ndef);
        const status = await guard(() => session.run(() => NfcManager.ndefHandler.getNdefStatus()));
        if (![NdefStatus.ReadWrite, NdefStatus.ReadOnly].includes(status.status)) throw nfcFailure("NFC_STATE");
        return status.status === NdefStatus.ReadOnly || cc?.readOnly === true;
      });
    },
    close,
    /** Fermeture du panneau, du lot ou passage en arrière-plan : bail puis Reader Mode rendus à Android. */
    async end() {
      await close();
      if (!readerModeHeld) return;
      readerModeHeld = false;
      await NfcManager.unregisterTagEvent();
    },
  };
}
