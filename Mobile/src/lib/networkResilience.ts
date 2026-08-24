/**
 * LOT 5 — résilience réseau Mobile : Idempotency-Key, classification, retry borné.
 * Une intention utilisateur conserve la même clé à chaque retry technique.
 *
 * UUID : `expo-crypto` Crypto.randomUUID() (Android / iOS / Web / Expo Go).
 * `globalThis.crypto.randomUUID` est absent sur certains runtimes Android Expo Go ;
 * l'échec se produisait avant POST /presences et bloquait toute mutation protégée.
 *
 * Consommateurs : createIntentionStore, resolveOutboxIntentionKey,
 * TeacherAttendanceScreen, TeacherGradesScreen, MessagesScreen,
 * PaymentMutationControls, TimetableScreen, AdminDataContext (messages).
 */

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asUuidV4(value: unknown): string | null {
  const key = String(value ?? "").trim();
  return UUID_V4.test(key) ? key : null;
}

function expoCryptoRandomUUID(): string | null {
  try {
    // Lazy require : Metro/Expo Go charge le module natif ; les tests Node
    // (tsx) n'ont pas le runtime React Native et tombent sur le repli WebCrypto.
    const Crypto = require("expo-crypto") as typeof import("expo-crypto");
    if (typeof Crypto.randomUUID !== "function") return null;
    return asUuidV4(Crypto.randomUUID());
  } catch {
    return null;
  }
}

function webCryptoRandomUUID(): string | null {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoObj?.randomUUID !== "function") return null;
  try {
    return asUuidV4(cryptoObj.randomUUID());
  } catch {
    return null;
  }
}

export const MAX_MUTATION_ATTEMPTS = 3;
export const RETRY_BACKOFF_MS = [1000, 3000, 8000] as const;

export type MutationFailureKind =
  | "retryable"
  | "non_retryable"
  | "auth_required"
  | "conflict"
  | "unknown";

export const NETWORK_COPY = {
  recording: "Enregistrement…",
  queued: "Envoi en attente",
  failed: "Échec de l'envoi",
  retry: "Réessayer",
  paymentOffline: "Paiement non envoyé. Le réseau est indisponible ; aucun reçu n'a été créé.",
} as const;

let delayImpl: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function setMutationDelayForTests(fn: ((ms: number) => Promise<void>) | null) {
  delayImpl =
    fn ??
    ((ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));
}

export function createIdempotencyKey(): string {
  const key = expoCryptoRandomUUID() ?? webCryptoRandomUUID();
  if (key) return key;
  throw new Error("Impossible de générer une Idempotency-Key UUID.");
}

function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const value = Number((error as { status?: number }).status);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: string }).code ?? "");
  }
  return "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function classifyMutationFailure(error: unknown): MutationFailureKind {
  const status = errorStatus(error);
  const code = errorCode(error);
  const message = errorMessage(error);

  if (status === 401 || code === "AUTH_REQUIRED") {
    return "auth_required";
  }
  if (code === "OUTBOX_PERSIST_FAILED" || /OUTBOX_PERSIST_FAILED/.test(message)) {
    return "non_retryable";
  }
  if (
    status === 409 ||
    code === "IDEMPOTENCY_KEY_REUSED" ||
    code === "COURSE_SCHEDULE_CONFLICT" ||
    /CLASS_CONFLICT|TEACHER_CONFLICT|ROOM_CONFLICT/i.test(code || message)
  ) {
    return "conflict";
  }
  if (status === 400 || status === 403 || status === 404 || status === 422) {
    return "non_retryable";
  }
  if (status === 429 || status === 408 || status === 502 || status === 503 || status === 504) {
    return "retryable";
  }
  if (
    (status == null || status === 0) &&
    /délai|timeout|indisponible|network request failed|failed to fetch|offline|abort|reset/i.test(message)
  ) {
    return "retryable";
  }
  if (status && status >= 400 && status < 500) {
    return "non_retryable";
  }
  if (status && status >= 500) {
    return "retryable";
  }
  return "unknown";
}

export function retryDelayMs(failedAttempt: number, jitter = true): number {
  const index = Math.min(Math.max(failedAttempt, 1), RETRY_BACKOFF_MS.length) - 1;
  const base = RETRY_BACKOFF_MS[index] ?? 8000;
  if (!jitter) return base;
  const spread = base * 0.2;
  return Math.round(base - spread + Math.random() * spread * 2);
}

export async function executeMutation<T>(input: {
  request: () => Promise<T>;
  maxAttempts?: number;
  jitter?: boolean;
}): Promise<T> {
  const maxAttempts = input.maxAttempts ?? MAX_MUTATION_ATTEMPTS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await input.request();
    } catch (error) {
      lastError = error;
      const kind = classifyMutationFailure(error);
      if (kind !== "retryable" || attempt >= maxAttempts) {
        throw error;
      }
      await delayImpl(retryDelayMs(attempt, input.jitter !== false));
    }
  }
  throw lastError;
}

export type ConnectivityKind =
  | "ok"
  | "device_offline"
  | "backend_unreachable"
  | "timeout"
  | "backend_5xx";

export function describeConnectivity(error: unknown): ConnectivityKind {
  const status = errorStatus(error);
  const message = errorMessage(error);
  if (status === 502 || status === 503 || status === 504 || (status && status >= 500)) {
    return "backend_5xx";
  }
  if (/délai|timeout|abort/i.test(message) || status === 408) {
    return "timeout";
  }
  if (/connexion internet indisponible|offline/i.test(message)) {
    return "device_offline";
  }
  if (/impossible de joindre|failed to fetch|network request failed|enotfound/i.test(message)) {
    return "backend_unreachable";
  }
  return "backend_unreachable";
}

export const CONNECTIVITY_COPY: Record<Exclude<ConnectivityKind, "ok">, { title: string; hint: string }> = {
  device_offline: {
    title: "Appareil hors ligne",
    hint: "Les listes déjà chargées restent consultables. Aucun envoi n'est confirmé tant que le réseau n'est pas rétabli.",
  },
  backend_unreachable: {
    title: "Serveur injoignable",
    hint: "Le backend n'a pas répondu. Seuls les envois réellement placés en file d'attente seront rejoués.",
  },
  timeout: {
    title: "Délai dépassé",
    hint: "La requête a expiré. Un envoi n'est rejoué que s'il figure dans la file d'attente.",
  },
  backend_5xx: {
    title: "Serveur indisponible",
    hint: "Le serveur a renvoyé une erreur temporaire. Les envois en file d'attente pourront être rejoués.",
  },
};
