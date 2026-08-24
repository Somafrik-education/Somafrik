/**
 * Connectivité Mobile : état partagé + sonde courte.
 * Pas de NetInfo natif (dépendances Expo actuelles). L'avant-plan suffit :
 * succès/échec HTTP + sonde /health + transition offline → online.
 */

export type ConnectivityState = "online" | "offline" | "unknown";

export const CONNECTIVITY_PROBE_TIMEOUT_MS = 3000;
export const CONNECTIVITY_POLL_MS = 5000;

type ConnectivityListener = (state: ConnectivityState) => void;

let state: ConnectivityState = "unknown";
const listeners = new Set<ConnectivityListener>();
let probeImpl: () => Promise<boolean> = async () => false;

export function getConnectivityState(): ConnectivityState {
  return state;
}

export function isOfflineContext(): boolean {
  return state === "offline";
}

export function setConnectivityProbe(probe: (() => Promise<boolean>) | null) {
  probeImpl = probe ?? (async () => false);
}

export function setConnectivityProbeForTests(probe: (() => Promise<boolean>) | null) {
  setConnectivityProbe(probe);
}

export function setConnectivityStateForTests(next: ConnectivityState) {
  setConnectivityState(next);
}

export function subscribeConnectivity(listener: ConnectivityListener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

function setConnectivityState(next: ConnectivityState) {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener(state);
}

export function noteConnectivitySuccess() {
  setConnectivityState("online");
}

export function noteConnectivityFailure(error?: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: number }).status)
      : undefined;
  if (status && status >= 400 && status < 500) return;
  if (
    (status == null || status === 0) &&
    /délai|timeout|indisponible|network request failed|failed to fetch|offline|abort|reset|joindre/i.test(
      message,
    )
  ) {
    setConnectivityState("offline");
  }
}

export async function probeConnectivity(): Promise<boolean> {
  try {
    const ok = await probeImpl();
    if (ok) {
      noteConnectivitySuccess();
      return true;
    }
    setConnectivityState("offline");
    return false;
  } catch (error) {
    noteConnectivityFailure(error);
    if (getConnectivityState() !== "offline") {
      setConnectivityState("offline");
    }
    return false;
  }
}

export function resetConnectivityForTests() {
  state = "unknown";
  probeImpl = async () => false;
  listeners.clear();
}
