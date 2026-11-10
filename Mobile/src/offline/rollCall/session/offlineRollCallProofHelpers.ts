/**
 * NFC-PRES-LOCAL-PR3 — réexport pour l'entrée de recette native (App.rcNativeProof.tsx) : le
 * parcours exécuté sous Hermes est exactement celui de l'écran, sans copie de logique.
 */
export { closeOfflineRollCall, openOfflineRollCall, prepareOfflinePack, processCard } from "./offlineRollCall";
export { findLatestSession as findLatestSessionForProof } from "../store/repository";
