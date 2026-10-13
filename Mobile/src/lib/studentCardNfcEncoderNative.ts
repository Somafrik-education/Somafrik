import { Platform } from "react-native";
import NfcManager, { Ndef, NdefStatus, NfcAdapter, NfcTech } from "react-native-nfc-manager";
import { identifyNtag, normalizeNtagUid, NFC_FOREIGN_CARD, type NfcEncoderHardware, type NtagIdentity } from "./studentCardNfcEncoding";
import { createNativeNfcSession } from "./nfcSessionNative";

/** Only GET_VERSION is sent raw. NDEF writes/locks use Android's native Ndef API. */
export function createNfcEncoderHardware(onPrompt?: (message: string) => void): NfcEncoderHardware {
  const session = createNativeNfcSession();
  let supportedIdentity: NtagIdentity | null = null;
  async function close() {
    await session.close();
  }
  async function ready() {
    if (Platform.OS !== "android") throw new Error("L’encodage NFC est disponible sur Android uniquement.");
    if (!(await session.run(() => NfcManager.isSupported()))) throw new Error("Ce téléphone ne dispose pas de NFC.");
    await session.start();
    if (!(await session.run(() => NfcManager.isEnabled()))) throw new Error("Activez le NFC dans les réglages du téléphone.");
  }
  async function openNdef(expectedUid: string, prompt?: string) {
      await ready();
      if (!supportedIdentity || supportedIdentity.uid !== normalizeNtagUid(expectedUid)) throw new Error("Relisez d’abord l’UID de la carte.");
      onPrompt?.(prompt || "Retirez la carte puis présentez la même carte pour l’encodage ou la relecture.");
      const tech = await session.request(() => NfcManager.requestTechnology([NfcTech.Ndef, NfcTech.NfcA, NfcTech.NfcB, NfcTech.IsoDep], { isReaderModeEnabled: true, readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B }));
      if (tech !== NfcTech.Ndef) throw new Error("Carte sans contenu NDEF compatible. Aucune écriture effectuée.");
      const tag = await session.run(() => NfcManager.getTag());
      if (normalizeNtagUid(tag?.id) !== expectedUid) throw new Error("Présentez la même carte NFC.");
  }
  return {
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
        if (tech !== NfcTech.NfcA) throw new Error(NFC_FOREIGN_CARD);
        const tag = await session.run(() => NfcManager.getTag());
        let version: number[];
        try { version = await session.run(() => NfcManager.nfcAHandler.transceive([0x60])); }
        catch { throw new Error(NFC_FOREIGN_CARD); }
        supportedIdentity = identifyNtag(tag?.id, version);
        return supportedIdentity;
      } finally { await close(); }
    },
    openNdef,
    async readText() {
      const message = await session.run(() => NfcManager.ndefHandler.getNdefMessage());
      const records = message?.ndefMessage;
      if (!records || records.length === 0) return "";
      if (records.length !== 1) throw new Error("La carte contient des données étrangères. Aucune écriture effectuée.");
      const record = records[0];
      // Empty record is the factory NDEF on a blank tag.
      if (record.tnf === 0 && record.payload.length === 0 && record.type.length === 0) return "";
      if (record.tnf !== 1 || record.type.length !== 1 || record.type[0] !== 0x54) throw new Error("La carte contient des données étrangères. Aucune écriture effectuée.");
      return Ndef.text.decodePayload(new Uint8Array(record.payload));
    },
    async writeText(value) {
      const bytes = Ndef.encodeMessage([Ndef.textRecord(value, "en")]);
      const status = await session.run(() => NfcManager.ndefHandler.getNdefStatus());
      if (!bytes || status.status !== NdefStatus.ReadWrite || bytes.length > status.capacity) throw new Error("Carte non inscriptible ou capacité insuffisante.");
      await session.run(() => NfcManager.ndefHandler.writeNdefMessage(bytes, { reconnectAfterWrite: true }));
      // beta.10 getNdefMessage serializes cached Tag data on Android. A new
      // discovery is required for a real read-back, not merely reconnect().
      const expectedUid = supportedIdentity?.uid;
      await session.reset();
      if (!expectedUid) throw new Error("UID de contrôle absent.");
      await openNdef(expectedUid, "Écriture effectuée. Retirez puis présentez la même carte pour vérifier son contenu.");
    },
    async isReadOnly() {
      const status = await session.run(() => NfcManager.ndefHandler.getNdefStatus());
      if (status.status === NdefStatus.NotSupported) throw new Error("État NFC indisponible. Relisez la carte.");
      return status.status === NdefStatus.ReadOnly;
    },
    async makeReadOnly() {
      const expectedUid = supportedIdentity?.uid;
      await session.run(() => NfcManager.ndefHandler.makeReadOnly());
      // Android's Ndef.isWritable metadata can be cached. Require a fresh discovery
      // before declaring the physical lock successful.
      await session.reset();
      if (!expectedUid) throw new Error("UID de contrôle absent.");
      await openNdef(expectedUid, "Verrouillage effectué. Retirez puis présentez la même carte pour vérifier son état définitif.");
    },
    close,
  };
}
