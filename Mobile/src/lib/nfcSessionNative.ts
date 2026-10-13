import NfcManager from "react-native-nfc-manager";
import { createNfcSessionManager, type NfcSessionLease } from "./nfcSession";

// Reader and encoder share this single manager; each facade owns only its own lease.
const sessions = createNfcSessionManager({
  start: () => NfcManager.start(),
  cancel: () => NfcManager.cancelTechnologyRequest(),
});

export function createNativeNfcSession() {
  let lease: NfcSessionLease | null = null;
  const current = () => (lease ??= sessions.acquire());
  return {
    start: () => current().start(),
    run: <T>(operation: () => Promise<T>) => current().run(operation),
    request: <T>(operation: () => Promise<T>) => current().request(operation),
    reset: () => current().reset(),
    async close() {
      const owned = lease;
      if (!owned) return;
      await owned.close();
      if (lease === owned) lease = null;
    },
  };
}
