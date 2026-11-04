// Client API minimaliste: même contrat que le BackOffice historique.
// VITE_API_URL obligatoire (ex. https://api.somafrik.app ou http://localhost:5000).

import { API_URL } from "../lib/apiUrl";
import { DASHBOARD_SYNC_EVENT, mutationRefreshesDashboard } from "../lib/dashboardSync";

const API_BASE_URL = `${API_URL.replace(/\/$/, "")}/api`;

/** Réponse HTTP non 2xx du serveur (400, 401, 403, 404, 409, 500…). */
export class ApiError extends Error {
  readonly kind = "http" as const;
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Le serveur n'a pas pu être joint (hors ligne, DNS, CORS, connexion coupée). */
export class ApiNetworkError extends Error {
  readonly kind = "network" as const;
  readonly cause?: unknown;
  constructor(message = "Serveur injoignable. Vérifiez la connexion puis réessayez.", options?: { cause?: unknown }) {
    super(message);
    this.name = "ApiNetworkError";
    this.cause = options?.cause;
  }
}

/**
 * Délai client dépassé. Pour une écriture, le serveur a pu l'exécuter :
 * `outcomeUnknown` est vrai et rien n'est rejoué automatiquement.
 */
export class ApiTimeoutError extends Error {
  readonly kind = "timeout" as const;
  readonly timeoutMs: number;
  readonly method: string;
  readonly outcomeUnknown: boolean;
  constructor(method: string, timeoutMs: number) {
    const seconds = Math.round(timeoutMs / 100) / 10;
    const read = isReadMethod(method);
    super(
      read
        ? `Délai de réponse dépassé (${seconds} s). Réessayez.`
        : `Délai de réponse dépassé (${seconds} s) : l'opération a peut-être été enregistrée. Vérifiez avant de recommencer.`,
    );
    this.name = "ApiTimeoutError";
    this.timeoutMs = timeoutMs;
    this.method = method;
    this.outcomeUnknown = !read;
  }
}

/** Requête annulée volontairement (déconnexion, changement d'établissement, lecture remplacée). */
export class ApiAbortError extends Error {
  readonly kind = "aborted" as const;
  constructor() {
    super("Requête annulée.");
    this.name = "ApiAbortError";
  }
}

export function isApiAbortError(error: unknown): error is ApiAbortError {
  return error instanceof ApiAbortError;
}

export function isApiTimeoutError(error: unknown): error is ApiTimeoutError {
  return error instanceof ApiTimeoutError;
}

/** 401 après échec du renouvellement : la session n'est plus valable. */
export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Options d'un appel : `RequestInit` + délai explicite (ms, `null` = aucun) et signal d'annulation. */
export type RequestOptions = RequestInit & { timeoutMs?: number | null };
/** Options facultatives transmises telles quelles (aucun argument si absentes). */
export type RequestArgs = [] | [RequestOptions];

function readTimeoutFromEnv(): number {
  const raw = Number(import.meta.env?.VITE_API_READ_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1000 ? raw : 20_000;
}

/**
 * Délais par défaut.
 * - Lecture JSON : 20 s (VITE_API_READ_TIMEOUT_MS pour l'ajuster).
 * - Lecture de fichier (PDF, pièce jointe, photo) : 120 s.
 * - Écriture : aucun délai par défaut ; un appel peut en fixer un explicitement.
 */
export const httpTimeouts = {
  readMs: readTimeoutFromEnv(),
  blobReadMs: 120_000,
  refreshMs: 20_000,
};

export function configureHttpTimeouts(next: Partial<typeof httpTimeouts>) {
  Object.assign(httpTimeouts, next);
}

function isReadMethod(method?: string) {
  const verb = String(method ?? "GET").toUpperCase();
  return verb === "GET" || verb === "HEAD";
}

/**
 * Un échange HTTP borné : délai et signal externe partagent un contrôleur unique,
 * libéré à la fin (minuteur et écouteur retirés), y compris pendant la lecture du corps.
 */
async function exchange<R>(
  url: string,
  init: RequestInit,
  limits: { timeoutMs: number | null; signal?: AbortSignal | null },
  consume: (response: Response) => Promise<R>,
): Promise<R> {
  const method = String(init.method ?? "GET").toUpperCase();
  const external = limits.signal ?? null;
  if (external?.aborted) throw new ApiAbortError();
  const controller = new AbortController();
  let reason: "timeout" | "aborted" | null = null;
  const onAbort = () => {
    reason ??= "aborted";
    controller.abort();
  };
  external?.addEventListener("abort", onAbort, { once: true });
  const timer =
    limits.timeoutMs && limits.timeoutMs > 0
      ? setTimeout(() => {
          reason ??= "timeout";
          controller.abort();
        }, limits.timeoutMs)
      : null;
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await consume(response);
  } catch (error) {
    if (reason === "timeout") throw new ApiTimeoutError(method, limits.timeoutMs ?? 0);
    if (reason === "aborted") throw new ApiAbortError();
    if (error instanceof ApiError) throw error;
    throw new ApiNetworkError(undefined, { cause: error });
  } finally {
    if (timer) clearTimeout(timer);
    external?.removeEventListener("abort", onAbort);
  }
}

function splitOptions(options: RequestOptions, fallbackTimeout: number | null) {
  const { timeoutMs, signal, ...init } = options;
  return {
    init,
    limits: { timeoutMs: timeoutMs === undefined ? fallbackTimeout : timeoutMs, signal },
  };
}

let accessTokenProvider: () => string | null = () => null;
let refreshTokenProvider: () => string | null = () => null;
let persistRotatedTokens: ((tokens: { accessToken: string; refreshToken?: string }) => void) | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function setAccessTokenProvider(provider: () => string | null) {
  accessTokenProvider = provider;
}

export function setRefreshTokenProvider(provider: () => string | null) {
  refreshTokenProvider = provider;
}

export function setRotatedTokenPersister(
  persister: ((tokens: { accessToken: string; refreshToken?: string }) => void) | null,
) {
  persistRotatedTokens = persister;
}

export function getAccessToken() {
  return accessTokenProvider();
}

async function refreshAccessTokenOnce(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = refreshTokenProvider();
    if (!refreshToken) return null;
    // Partagé par tous les appels en attente : aucun signal individuel ne l'annule.
    // Un délai ou une coupure réseau remonte tel quel (ce n'est pas une session expirée).
    const data = await exchange(
      `${API_BASE_URL}/auth/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      },
      { timeoutMs: httpTimeouts.refreshMs },
      async (response) =>
        response.ok ? ((await response.json()) as { accessToken?: string; refreshToken?: string }) : null,
    );
    if (!data) return null;
    if (!data.accessToken) return null;
    persistRotatedTokens?.({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return data.accessToken;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Refresh ahead of JWT expiry so polling does not send an already expired token. */
function expiresSoon(token: string, leewaySeconds = 60): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
    return typeof payload.exp === "number" && payload.exp <= Date.now() / 1000 + leewaySeconds;
  } catch {
    return false; // Opaque/demo tokens still use the server's 401 fallback.
  }
}

async function tokenForRequest(path: string): Promise<string | null> {
  const token = accessTokenProvider();
  if (!token || isAuthRefreshPath(path)) return token;
  if (refreshInFlight) return (await refreshInFlight) ?? accessTokenProvider();
  if (expiresSoon(token) && refreshTokenProvider()) {
    return (await refreshAccessTokenOnce()) ?? accessTokenProvider();
  }
  return token;
}

function isAuthRefreshPath(path: string) {
  // Logout is authenticated: a 401 on expired access must refresh once, then revoke.
  return path.startsWith("/auth/refresh") || path.startsWith("/backoffice/login");
}

/** Corps JSON (ou texte) d'une réponse. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Appel JSON. Un 401 déclenche un seul renouvellement de jeton puis un seul rejeu :
 * le serveur a refusé sans exécuter, le rejeu est donc sûr même pour une écriture.
 * Aucun autre rejeu automatique (délai, réseau, 5xx).
 */
export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {},
  retried = false,
): Promise<T> {
  const { init, limits } = splitOptions(options, isReadMethod(options.method) ? httpTimeouts.readMs : null);
  if (limits.signal?.aborted) throw new ApiAbortError();
  const token = await tokenForRequest(path);
  const { response, data } = await exchange(
    `${API_BASE_URL}${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    },
    limits,
    async (res) => ({ response: res, data: await readBody(res) }),
  );

  if (!response.ok) {
    if (response.status === 401 && !retried && !isAuthRefreshPath(path)) {
      // A concurrent request may have already rotated the token: retry with it.
      const rotated = accessTokenProvider();
      const next = rotated && rotated !== token ? rotated : await refreshAccessTokenOnce();
      if (next) return request<T>(path, options, true);
    }
    const payload = data && typeof data === "object" ? (data as { message?: unknown; code?: unknown; details?: unknown }) : null;
    const message =
      (payload?.message != null ? String(payload.message) : null) ?? "Erreur plateforme";
    throw new ApiError(
      message,
      response.status,
      payload?.code != null ? String(payload.code) : undefined,
      payload?.details,
    );
  }

  if (typeof window !== "undefined" && mutationRefreshesDashboard(init.method, path)) {
    window.dispatchEvent(new Event(DASHBOARD_SYNC_EVENT));
  }
  return data as T;
}

type BlobOutcome = { ok: true; blob: Blob } | { ok: false; status: number; text: string };

export async function requestBlob(path: string, options: RequestOptions = {}, retried = false): Promise<Blob> {
  const { init, limits } = splitOptions(options, isReadMethod(options.method) ? httpTimeouts.blobReadMs : null);
  if (limits.signal?.aborted) throw new ApiAbortError();
  const token = await tokenForRequest(path);
  const outcome = await exchange<BlobOutcome>(
    `${API_BASE_URL}${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    },
    limits,
    async (response) =>
      response.ok
        ? { ok: true, blob: await response.blob() }
        : { ok: false, status: response.status, text: await response.text() },
  );

  if (!outcome.ok) {
    if (outcome.status === 401 && !retried && !isAuthRefreshPath(path)) {
      // A concurrent request may have already rotated the token: retry with it.
      const rotated = accessTokenProvider();
      const next = rotated && rotated !== token ? rotated : await refreshAccessTokenOnce();
      if (next) return requestBlob(path, options, true);
    }
    const text = outcome.text;
    let message = "Erreur plateforme";
    let code: string | undefined;
    if (text) {
      try {
        const data = JSON.parse(text) as { message?: unknown; code?: unknown };
        if (data.message) message = String(data.message);
        if (typeof data.code === "string") code = data.code;
      } catch {
        const cannotRoute = text.match(/Cannot (GET|POST|PUT|DELETE) ([^\s<]+)/i);
        if (cannotRoute) {
          message = `Service indisponible (${cannotRoute[2]}). Redémarrez ou reconstruisez le backend.`;
        } else if (text.length <= 200) {
          message = text;
        }
      }
    }
    throw new ApiError(message, outcome.status, code);
  }

  return outcome.blob;
}

export const api = {
  get: <T>(path: string, init?: RequestOptions) => (init ? request<T>(path, init) : request<T>(path)),
  post: <T>(path: string, body?: unknown, init: RequestOptions = {}) =>
    request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    }),
  postBlob: (path: string, body?: unknown) => requestBlob(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
