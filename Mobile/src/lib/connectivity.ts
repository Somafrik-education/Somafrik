/**
 * Connectivité Mobile : état partagé + sonde courte.
 * Pas de NetInfo natif (dépendances Expo actuelles). L'avant-plan suffit :
 * succès/échec HTTP + sonde /health + transition offline → online.
 *
 * Contrat : `offline` = vraie erreur de transport (pas de réponse HTTP).
 * Timeout, 4xx, 5xx, parsing/runtime ne marquent JAMAIS l'appareil hors ligne.
 */

export type ConnectivityState = "online" | "offline" | "unknown";

export const CONNECTIVITY_PROBE_TIMEOUT_MS = 3000;
export const CONNECTIVITY_POLL_MS = 5000;

type ConnectivityListener = (state: ConnectivityState) => void;

let state: ConnectivityState = "unknown";
const listeners = new Set<ConnectivityListener>();
let probeImpl: () => Promise<boolean> = async () => false;

const TRANSPORT_MESSAGE_RE =
  /failed to fetch|network request failed|networkerror|err_network|econnrefused|enotfound|enetunreach|ehostunreach|connexion internet indisponible|\boffline\b/i;

function readStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const value = Number((error as { status?: number }).status);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

function readCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: string }).code ?? "");
  }
  return "";
}

function readName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  if (error && typeof error === "object" && "name" in error) {
    return String((error as { name?: string }).name ?? "");
  }
  return "";
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error ?? "");
}

/**
 * Vraie coupure transport : aucune réponse HTTP n'a été obtenue.
 * Un statut HTTP connu (4xx/5xx/408) n'est jamais du hors-connexion.
 * Abort/timeout n'est pas une preuve d'absence de réseau.
 */
export function isRecognizedTransportFailure(error?: unknown): boolean {
  if (error == null) return false;
  const status = readStatus(error);
  if (typeof status === "number" && status > 0) return false;

  const code = readCode(error).toUpperCase();
  if (code === "TIMEOUT" || code === "BACKEND_UNREACHABLE" || code === "ECONNABORTED") {
    return false;
  }
  if (
    code === "NETWORK_UNAVAILABLE" ||
    code === "ERR_NETWORK" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH"
  ) {
    return true;
  }

  const name = readName(error);
  if (name === "AbortError") return false;

  const message = readMessage(error);
  if (/délai de requête|timeout/i.test(message) && !TRANSPORT_MESSAGE_RE.test(message)) {
    return false;
  }
  if (/impossible de joindre/i.test(message) && !TRANSPORT_MESSAGE_RE.test(message)) {
    return false;
  }
  return TRANSPORT_MESSAGE_RE.test(message);
}

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
  if (!isRecognizedTransportFailure(error)) return;
  setConnectivityState("offline");
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
    return getConnectivityState() === "offline";
  }
}

export function resetConnectivityForTests() {
  state = "unknown";
  probeImpl = async () => false;
  listeners.clear();
}
