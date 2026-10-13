import { Platform } from "react-native";
import NfcManager, { NfcAdapter, NfcTech } from "react-native-nfc-manager";
import type { NfcHardware } from "./studentCardNfc";
import { createNativeNfcSession } from "./nfcSessionNative";

/** Découverte tag : NDEF métier, autres techs uniquement pour constater un tag. */
const ANDROID_DISCOVERY_TECHS = [
  NfcTech.Ndef,
  NfcTech.NfcA,
  NfcTech.NfcB,
  NfcTech.IsoDep,
  NfcTech.MifareUltralight,
  NfcTech.NdefFormatable,
];
export function createReactNativeNfcAdapter(): NfcHardware {
  const session = createNativeNfcSession();
  return {
    async start() {
      if (Platform.OS !== "android") throw new Error("La lecture NFC est disponible sur Android uniquement.");
      await session.start();
    },
    isSupported() {
      return Platform.OS === "android" ? session.run(() => NfcManager.isSupported()) : Promise.resolve(false);
    },
    async isEnabled() {
      // A rejected probe must remain rejected; probeNfc then fails closed before discovery.
      return session.run(() => NfcManager.isEnabled());
    },
    async requestTag() {
      if (Platform.OS === "android") {
        await session.request(() => NfcManager.requestTechnology(ANDROID_DISCOVERY_TECHS, {
          isReaderModeEnabled: true,
          readerModeFlags:
            NfcAdapter.FLAG_READER_NFC_A
            | NfcAdapter.FLAG_READER_NFC_B
            | NfcAdapter.FLAG_READER_NFC_F
            | NfcAdapter.FLAG_READER_NFC_V,
        }));
        return;
      }
      throw new Error("La lecture NFC est disponible sur Android uniquement.");
    },
    getTag() {
      return session.run(() => NfcManager.getTag());
    },
    async cancel() {
      await session.close();
    },
  };
}
