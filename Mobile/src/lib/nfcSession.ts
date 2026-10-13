/** One lease owns the native NFC manager until cancellation and in-flight calls settle. */
export type NfcSessionLease = {
  start(): Promise<void>;
  run<T>(operation: () => Promise<T>): Promise<T>;
  request<T>(operation: () => Promise<T>): Promise<T>;
  reset(): Promise<void>;
  close(): Promise<void>;
};

function sessionError(code: "NFC_SESSION_BUSY" | "NFC_SESSION_CANCELLED") {
  return Object.assign(new Error(code === "NFC_SESSION_BUSY"
    ? "Une autre opération NFC est en cours. Terminez-la avant de réessayer."
    : "Lecture NFC annulée."), { code });
}

export function createNfcSessionManager(native: {
  start(): Promise<unknown>;
  cancel(): Promise<unknown>;
}) {
  type State = {
    closing: boolean;
    requested: boolean;
    release: boolean;
    pending: Set<Promise<unknown>>;
    closingPromise: Promise<void> | null;
  };
  let active: State | null = null;
  let startup: Promise<void> | null = null;

  return {
    acquire(): NfcSessionLease {
      if (active) throw sessionError("NFC_SESSION_BUSY");
      const state: State = { closing: false, requested: false, release: false, pending: new Set(), closingPromise: null };
      active = state;

      function assertOwner() {
        if (active !== state || state.closing) throw sessionError("NFC_SESSION_CANCELLED");
      }

      function run<T>(operation: () => Promise<T>, request = false): Promise<T> {
        try { assertOwner(); } catch (error) { return Promise.reject(error); }
        const pending = (async () => {
          if (request) state.requested = true;
          const result = await operation();
          assertOwner(); // Never hand a result from a cancelled discovery to another operation.
          return result;
        })();
        state.pending.add(pending);
        void pending.then(() => state.pending.delete(pending), () => state.pending.delete(pending));
        return pending;
      }

      function stop(release: boolean): Promise<void> {
        if (active !== state) return Promise.resolve();
        state.release ||= release;
        if (state.closingPromise) return state.closingPromise;
        state.closing = true;
        const stopping = (async () => {
          if (state.requested) await native.cancel();
          await Promise.allSettled([...state.pending]);
          state.requested = false;
          if (state.release) {
            if (active === state) active = null;
          } else {
            state.closing = false;
          }
        })();
        state.closingPromise = stopping;
        const clear = () => { if (state.closingPromise === stopping) state.closingPromise = null; };
        // Cancellation failures keep ownership quarantined, but a close retry is permitted.
        void stopping.then(clear, clear);
        return stopping;
      }

      return {
        start() {
          return run(async () => {
            if (!startup) {
              startup = Promise.resolve().then(() => native.start()).then(() => undefined);
              void startup.catch(() => { startup = null; });
            }
            await startup;
          });
        },
        run,
        request: (operation) => run(operation, true),
        async reset() {
          assertOwner();
          await stop(false);
          assertOwner();
        },
        // A stale owner's finally/unmount must never cancel the new owner's hardware.
        close: () => stop(true),
      };
    },
  };
}
