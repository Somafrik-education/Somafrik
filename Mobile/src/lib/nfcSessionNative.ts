import NfcManager from "react-native-nfc-manager";
import { createNfcLeaseFacade, createNfcSessionManager } from "./nfcSession";

// Reader and encoder share this single manager; each facade owns only its own lease.
const sessions = createNfcSessionManager({
  start: () => NfcManager.start(),
  cancel: () => NfcManager.cancelTechnologyRequest(),
});

export function createNativeNfcSession() {
  return createNfcLeaseFacade(sessions);
}
