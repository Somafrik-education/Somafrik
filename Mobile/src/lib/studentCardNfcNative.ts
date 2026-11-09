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

/**
 * NFC-REG-01 — le mode lecteur reste actif pendant toute la session de pointage.
 * requestTechnology active le mode lecteur et cancelTechnologyRequest le coupe lorsque la
 * bibliothèque l'a enregistré elle-même : entre deux cartes, Android reprenait alors la carte
 * présente (NDEF_DISCOVERED) et pouvait ouvrir une autre application. Le mode lecteur est donc
 * enregistré explicitement une fois, conservé entre deux lectures (finishRead) et désactivé à la
 * fermeture seulement (écran quitté, arrière-plan, déconnexion), bail partagé encore détenu.
 * Les données NFC ne sont jamais interprétées comme une URL ou une commande.
 */
export function createReactNativeNfcAdapter(): NfcHardware {
  const session = createNativeNfcSession();
  let readerHeld = false;

  async function release() {
    const held = readerHeld;
    readerHeld = false;
    await session.close(held ? () => NfcManager.unregisterTagEvent() : undefined);
  }

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
        if (!readerHeld) {
          // Enregistrement explicite : cancelTechnologyRequest ne coupera plus le mode lecteur.
          await session.run(() => NfcManager.registerTagEvent(READER_MODE_OPTIONS));
          readerHeld = true;
        }
        await session.request(() => NfcManager.requestTechnology(ANDROID_DISCOVERY_TECHS, READER_MODE_OPTIONS));
        return;
      }
      throw new Error("La lecture NFC est disponible sur Android uniquement.");
    },
    getTag() {
      return session.run(() => NfcManager.getTag());
    },
    async finishRead() {
      try {
        // Fin de la requête de technologie uniquement : mode lecteur et bail conservés.
        await session.endRequest();
      } catch {
        await release(); // État natif incertain : fermeture complète.
      }
    },
    cancel: release,
  };
}
