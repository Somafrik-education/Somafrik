/** R3-2 Android-only physical NFC inspection. No writes, format or lock operations. */
import { Platform } from "react-native";
import NfcManager, { Ndef, NdefStatus, NfcAdapter, NfcTech } from "react-native-nfc-manager";
import { createNativeNfcSession } from "./nfcSessionNative";
import { identifyNtag, normalizeNtagUid } from "./studentCardNfcEncoding";
import { classifyDiagnosisNdef, type PhysicalDiagnosis } from "./studentCardNfcDiagnosis";

const READER_OPTIONS = {
  isReaderModeEnabled: true,
  readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B,
};
/** Both inspections are read-only. A second presentation is required for NDEF observation. */
export function createNfcDiagnosisReader() {
  const session = createNativeNfcSession();
  return {
    async inspect(): Promise<PhysicalDiagnosis> {
      if (Platform.OS !== "android") throw new Error("Diagnostic NFC disponible uniquement sur Android.");
      let identity: ReturnType<typeof identifyNtag> | null = null;
      await session.start();
      try {
        if (!(await session.run(() => NfcManager.isSupported())) || !(await session.run(() => NfcManager.isEnabled()))) {
          throw new Error("Activez le NFC sur un appareil Android compatible.");
        }
        const tech = await session.request(() => NfcManager.requestTechnology([NfcTech.NfcA], READER_OPTIONS));
        if (tech !== NfcTech.NfcA) throw new Error("Carte NFC non compatible NTAG213/216.");
        const tag = await session.run(() => NfcManager.getTag());
        const version = await session.run(() => NfcManager.nfcAHandler.transceive([0x60])); // GET_VERSION (read only)
        identity = identifyNtag(tag?.id, version);
        await session.endRequest();
        const ndefTech = await session.request(() => NfcManager.requestTechnology([NfcTech.Ndef], READER_OPTIONS));
        if (ndefTech !== NfcTech.Ndef) {
          return { ...identity, ndef: { state: "unreadable" }, readOnly: false };
        }
        const ndefTag = await session.run(() => NfcManager.getTag());
        if (normalizeNtagUid(ndefTag?.id) !== identity.uid) {
          throw new Error("La deuxième présentation ne correspond pas à la même carte.");
        }
        const status = await session.run(() => NfcManager.ndefHandler.getNdefStatus());
        if (status.status !== NdefStatus.ReadWrite && status.status !== NdefStatus.ReadOnly) {
          return { ...identity, ndef: { state: "unreadable" }, readOnly: true };
        }
        let ndef: PhysicalDiagnosis["ndef"];
        try {
          const message = await session.run(() => NfcManager.ndefHandler.getNdefMessage());
          const records = message?.ndefMessage;
          if (!records || records.length === 0) ndef = { state: "empty" };
          else if (records.length !== 1) ndef = { state: "foreign" };
          else {
            const item = records[0];
            if (item.tnf === 0 && item.payload.length === 0 && item.type.length === 0) ndef = { state: "empty" };
            else if (item.tnf === 1 && item.type.length === 1 && item.type[0] === 0x54) {
              ndef = classifyDiagnosisNdef(Ndef.text.decodePayload(new Uint8Array(item.payload)));
            } else ndef = { state: "foreign" };
          }
        } catch {
          ndef = { state: "unreadable" };
        }
        return { ...identity, ndef, readOnly: status.status === NdefStatus.ReadOnly };
      } finally {
        await session.close();
      }
    },
    close() { return session.close(); },
  };
}
