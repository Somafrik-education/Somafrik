import NfcManager, { NfcTech } from "react-native-nfc-manager";
import type { NfcHardware } from "./studentCardNfc";

export function createReactNativeNfcAdapter(): NfcHardware {
  let started = false;
  return {
    async start() {
      if (started) return;
      await NfcManager.start();
      started = true;
    },
    isSupported() {
      return NfcManager.isSupported();
    },
    async isEnabled() {
      try {
        return await NfcManager.isEnabled();
      } catch {
        return true;
      }
    },
    async requestNdef() {
      await NfcManager.requestTechnology(NfcTech.Ndef);
    },
    getTag() {
      return NfcManager.getTag();
    },
    async cancel() {
      try {
        await NfcManager.cancelTechnologyRequest();
      } catch {
        // already closed
      }
    },
  };
}
