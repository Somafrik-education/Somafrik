/**
 * S2.3 — Client HTTP unique (Authorization, refresh unique, timeout, erreurs métier).
 */
import {
  assertTransportSecurity,
} from "./certificatePinning";
import { safeLogger, sanitizeUserFacingError } from "./safeLogger";
import {
  clearSecureSession,
  getAccessToken,
  getRefreshToken,
  saveTokens,
} from "./secureStorage";
import {
  isDevelopmentRuntime,
  resolveApiBaseUrl,
  resolveApiRootUrl,
  validateApiRootUrl,
} from "../config/env";

export const REQUEST_TIMEOUT_MS = 20_000;
export const CONNECT_TIMEOUT_MS = 10_000;

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export class ApiClientError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

let logoutHandler: (() => void) | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null) {
  logoutHandler = handler;
}

function notifySessionExpired() {
  logoutHandler?.();
}

function isAuthPublicPath(path: string) {
  return (
    path.startsWith("/login") ||
    path.startsWith("/identify") ||
    path.startsWith("/auth/refresh") ||
    path.startsWith("/schools/") ||
    path.startsWith("/health")
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiClientError("Délai de connexion dépassé. Vérifiez votre réseau.");
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/network request failed|failed to fetch|offline|internet/i.test(message)) {
      throw new ApiClientError(
        "Connexion Internet indisponible. Réessayez lorsque le réseau sera rétabli.",
      );
    }
    throw new ApiClientError(
      sanitizeUserFacingError(error, "Impossible de joindre le serveur Somafrik."),
    );
  } finally {
    clearTimeout(timer);
  }
}

async function refreshAccessTokenOnce(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return null;

    const root = resolveApiRootUrl();
    validateApiRootUrl(root);
    assertTransportSecurity(`${root}/api/auth/refresh`, {
      allowInsecureDev: isDevelopmentRuntime(),
    });

    const response = await fetchWithTimeout(
      `${root}/api/auth/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      },
      REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { accessToken?: string };
    if (!data.accessToken) return null;
    await saveTokens(data.accessToken, refreshToken);
    return data.accessToken;
  })()
    .catch((error) => {
      safeLogger.warn("refresh token failed", error);
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

export type HttpRequestOptions = RequestInit & {
  /** Ne pas envoyer / attendre de JSON (téléchargements bruts). */
  raw?: boolean;
  skipAuth?: boolean;
  timeoutMs?: number;
  /** Interne : requête déjà rejouée après refresh. */
  _retried?: boolean;
};

export async function httpRequest<T = Json>(
  path: string,
  options: HttpRequestOptions = {},
): Promise<T> {
  const {
    raw = false,
    skipAuth = false,
    timeoutMs = REQUEST_TIMEOUT_MS,
    _retried = false,
    headers: inputHeaders,
    ...rest
  } = options;

  const apiBase = resolveApiBaseUrl();
  validateApiRootUrl(resolveApiRootUrl());
  const url = `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
  assertTransportSecurity(url, { allowInsecureDev: isDevelopmentRuntime() });

  const headers = new Headers(inputHeaders ?? {});
  if (!headers.has("Content-Type") && rest.body && !(rest.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (!skipAuth && !isAuthPublicPath(path)) {
    const token = await getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetchWithTimeout(
    url,
    {
      ...rest,
      headers,
    },
    timeoutMs,
  );

  if (response.status === 401 && !skipAuth && !isAuthPublicPath(path) && !_retried) {
    const nextToken = await refreshAccessTokenOnce();
    if (nextToken) {
      return httpRequest<T>(path, { ...options, _retried: true });
    }
    await clearSecureSession();
    notifySessionExpired();
    throw new ApiClientError("Session expirée. Veuillez vous reconnecter.", 401);
  }

  if (raw) {
    if (!response.ok) {
      throw new ApiClientError("La requête a échoué.", response.status);
    }
    return response as unknown as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  let data: unknown = null;
  if (isJson) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === "object" && data !== null && "message" in data
        ? String((data as { message: unknown }).message)
        : "La requête a échoué.";
    throw new ApiClientError(
      sanitizeUserFacingError(message, "La requête a échoué."),
      response.status,
    );
  }

  if (!isJson) {
    throw new ApiClientError("Réponse serveur invalide.");
  }

  return data as T;
}

export async function httpUpload(
  path: string,
  formData: FormData,
  {
    maxBytes = 5 * 1024 * 1024,
    allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  }: { maxBytes?: number; allowedMimeTypes?: string[] } = {},
): Promise<unknown> {
  void maxBytes;
  void allowedMimeTypes;
  // Les contrôles MIME/taille sont appliqués par l'appelant lorsque les métadonnées
  // du fichier sont disponibles (ImagePicker). Ici on impose HTTPS + Authorization.

  const root = resolveApiRootUrl();
  validateApiRootUrl(root);
  if (!isDevelopmentRuntime() && !root.startsWith("https://")) {
    throw new ApiClientError("Les envois de fichiers exigent HTTPS.");
  }

  return httpRequest(path, {
    method: "POST",
    body: formData,
    headers: {},
  });
}
