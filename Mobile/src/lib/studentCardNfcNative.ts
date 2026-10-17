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
const READER_MODE_OPTIONS = {
  isReaderModeEnabled: true,
  readerModeFlags:
    NfcAdapter.FLAG_READER_NFC_A
    | NfcAdapter.FLAG_READER_NFC_B
    | NfcAdapter.FLAG_READER_NFC_F
    | NfcAdapter.FLAG_READER_NFC_V,
};

export function createReactNativeNfcAdapter(): NfcHardware {
  const session = createNativeNfcSession();
  // RC-5 : le Reader Mode est tenu tant que le scanner est ouvert. Laissé à la charge de
  // requestTechnology, il était coupé ~1 s après chaque lecture (cancelTechnologyRequest →
  // unregisterTagEvent) et Android redispatchait la carte encore maintenue
  // vers com.android.apps.tag. Il n'est rendu qu'à end().
  let readerModeHeld = false;
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
        if (!readerModeHeld) {
          readerModeHeld = true; // marqué avant l'appel : end() désinscrit même un enregistrement interrompu
          await session.run(() => NfcManager.registerTagEvent(READER_MODE_OPTIONS));
        }
        await session.request(() => NfcManager.requestTechnology(ANDROID_DISCOVERY_TECHS, READER_MODE_OPTIONS));
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
    async end() {
      await session.close();
      if (!readerModeHeld) return;
      readerModeHeld = false;
      await NfcManager.unregisterTagEvent();
    },
  };
}
