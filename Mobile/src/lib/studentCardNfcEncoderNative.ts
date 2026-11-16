import { Platform } from "react-native";
import NfcManager, { Ndef, NdefStatus, NfcAdapter, NfcTech } from "react-native-nfc-manager";
import { identifyNtag, normalizeNtagUid, nfcFailure, type NfcEncoderHardware, type NtagIdentity } from "./studentCardNfcEncoding";
import { createNativeNfcSession } from "./nfcSessionNative";

/** Only GET_VERSION is sent raw. Programming never commands a physical lock. */
export function createNfcEncoderHardware(onPrompt?: (message: string) => void): NfcEncoderHardware {
  const session = createNativeNfcSession();
  let supportedIdentity: NtagIdentity | null = null;
  async function close() {
    await session.close();
  }
  async function ready() {
    if (Platform.OS !== "android") throw new Error("L’encodage NFC est disponible sur Android uniquement.");
    if (!(await session.run(() => NfcManager.isSupported()))) throw nfcFailure("NFC_UNAVAILABLE");
    await session.start();
    if (!(await session.run(() => NfcManager.isEnabled()))) throw nfcFailure("NFC_DISABLED");
  }
  async function openNdef(expectedUid: string, prompt?: string) {
      await ready();
      if (!supportedIdentity || supportedIdentity.uid !== normalizeNtagUid(expectedUid)) throw nfcFailure("NFC_SAME_CARD");
      onPrompt?.(prompt || "Retirez la carte puis présentez la même carte pour l’encodage ou la relecture.");
      const tech = await session.request(() => NfcManager.requestTechnology([NfcTech.Ndef, NfcTech.NfcA, NfcTech.NfcB, NfcTech.IsoDep], { isReaderModeEnabled: true, readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B }));
      if (tech !== NfcTech.Ndef) throw nfcFailure("NFC_NDEF");
      const tag = await session.run(() => NfcManager.getTag());
      if (normalizeNtagUid(tag?.id) !== expectedUid) throw nfcFailure("NFC_SAME_CARD");
  }
  return {
    async availability() { try { await ready(); } finally { await close(); } },
    async inspect() {
      try {
        supportedIdentity = null;
        await ready();
        // Include foreign technologies for an explicit refusal (Navigo), never a write.
        onPrompt?.("Présentez la carte pour lire son UID et son modèle.");
        const tech = await session.request(() => NfcManager.requestTechnology([NfcTech.NfcA, NfcTech.NfcB, NfcTech.IsoDep], {
          isReaderModeEnabled: true,
          readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B,
        }));
        if (tech !== NfcTech.NfcA) throw nfcFailure("NFC_FOREIGN");
        const tag = await session.run(() => NfcManager.getTag());
        let version: number[];
        try { version = await session.run(() => NfcManager.nfcAHandler.transceive([0x60])); }
        catch { throw nfcFailure("NFC_FOREIGN"); }
        supportedIdentity = identifyNtag(tag?.id, version);
        return supportedIdentity;
      } finally { await close(); }
    },
    openNdef,
    async readText() {
      const message = await session.run(() => NfcManager.ndefHandler.getNdefMessage());
      const records = message?.ndefMessage;
      if (!records || records.length === 0) return "";
      if (records.length !== 1) throw nfcFailure("NFC_FOREIGN");
      const record = records[0];
      // Empty record is the factory NDEF on a blank tag.
      if (record.tnf === 0 && record.payload.length === 0 && record.type.length === 0) return "";
      if (record.tnf !== 1 || record.type.length !== 1 || record.type[0] !== 0x54) throw nfcFailure("NFC_FOREIGN");
      return Ndef.text.decodePayload(new Uint8Array(record.payload));
    },
    async writeText(value) {
      const bytes = Ndef.encodeMessage([Ndef.textRecord(value, "en")]);
      const status = await session.run(() => NfcManager.ndefHandler.getNdefStatus());
      if (!bytes || status.status !== NdefStatus.ReadWrite || !Number.isFinite(status.capacity) || bytes.length > status.capacity) throw nfcFailure("NFC_CAPACITY");
      await session.run(() => NfcManager.ndefHandler.writeNdefMessage(bytes, { reconnectAfterWrite: true }));
      // beta.10 getNdefMessage serializes cached Tag data on Android. A new
      // discovery is required for a real read-back, not merely reconnect().
      const expectedUid = supportedIdentity?.uid;
      await session.reset();
      if (!expectedUid) throw nfcFailure("NFC_READBACK");
      await openNdef(expectedUid, "Écriture effectuée. Retirez puis présentez la même carte pour vérifier son contenu.");
    },
    async isReadOnly() {
      const status = await session.run(() => NfcManager.ndefHandler.getNdefStatus());
      if (![NdefStatus.ReadWrite, NdefStatus.ReadOnly].includes(status.status)) throw nfcFailure("NFC_STATE");
      return status.status === NdefStatus.ReadOnly;
    },
    close,
  };
}
