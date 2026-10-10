import { Platform } from "react-native";
import NfcManager, { NfcAdapter, NfcTech } from "react-native-nfc-manager";
import type { NfcHardware } from "./studentCardNfc";

/** Découverte tag : NDEF métier, autres techs uniquement pour constater un tag. */
const ANDROID_DISCOVERY_TECHS = [
  NfcTech.Ndef,
  NfcTech.NfcA,
  NfcTech.NfcB,
  NfcTech.IsoDep,
  NfcTech.MifareUltralight,
  NfcTech.NdefFormatable,
];
const IOS_DISCOVERY_TECHS = [NfcTech.Ndef, NfcTech.NfcA];

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
    async requestTag() {
      if (Platform.OS === "android") {
        await NfcManager.requestTechnology(ANDROID_DISCOVERY_TECHS, {
          isReaderModeEnabled: true,
          readerModeFlags:
            NfcAdapter.FLAG_READER_NFC_A
            | NfcAdapter.FLAG_READER_NFC_B
            | NfcAdapter.FLAG_READER_NFC_F
            | NfcAdapter.FLAG_READER_NFC_V,
        });
        return;
      }
      await NfcManager.requestTechnology(IOS_DISCOVERY_TECHS);
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
