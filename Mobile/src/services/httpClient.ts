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
  assertUnrestrictedApiPath,
  clearRestrictedSession,
  getRestrictedAccessToken,
  getRestrictedRefreshToken,
} from "../lib/restrictedSession";
import {
  isDevelopmentRuntime,
  resolveApiBaseUrl,
  resolveApiRootUrl,
  validateApiRootUrl,
} from "../config/env";
import {
  assertSecureUploadFile,
  DEFAULT_ALLOWED_UPLOAD_MIME_TYPES,
  DEFAULT_UPLOAD_MAX_BYTES,
  SecureUploadFile,
  SecureUploadValidationError,
} from "./uploadValidation";

/** Timeout global de requête (connexion + réponse). React Native fetch n'expose pas de connect timeout distinct. */
export const REQUEST_TIMEOUT_MS = 20_000;

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export class ApiClientError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status?: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
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

/** Routes authentification / découverte réellement publiques (pas de préfixe large). */
const PUBLIC_PATHS = new Set([
  "/login",
  "/identify",
  "/auth/refresh",
  "/health",
]);

/**
 * Seules les routes publiques exactes (ou le lookup établissement pré-login)
 * omettent le Bearer. Toute autre route sous /schools/ exige un token.
 */
function isAuthPublicPath(path: string) {
  const pathname = (path.split("?")[0] ?? path).trim();

  return (
    PUBLIC_PATHS.has(pathname) ||
    /^\/schools\/[^/]+$/.test(pathname)
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
      throw new ApiClientError("Délai de requête dépassé. Vérifiez votre réseau.");
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
    const refreshToken = (await getRefreshToken()) || getRestrictedRefreshToken();
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
  /** UUID d'intention — rejoué tel quel après timeout / refresh. */
  idempotencyKey?: string;
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
    idempotencyKey,
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

  const method = String(rest.method ?? "GET").toUpperCase();
  if (idempotencyKey && method !== "GET" && method !== "HEAD") {
    headers.set("Idempotency-Key", idempotencyKey);
  }

  if (!skipAuth && !isAuthPublicPath(path)) {
    try {
      assertUnrestrictedApiPath(path);
    } catch (error) {
      throw new ApiClientError(
        error instanceof Error ? error.message : "Changement de mot de passe obligatoire.",
        403,
      );
    }
    const token = (await getAccessToken()) || getRestrictedAccessToken();
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
    clearRestrictedSession();
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
    const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const message =
      payload && "message" in payload ? String(payload.message) : "La requête a échoué.";
    const code = payload.code ? String(payload.code) : undefined;
    throw new ApiClientError(
      sanitizeUserFacingError(message, "La requête a échoué."),
      response.status,
      code,
      payload.details,
    );
  }

  if (!isJson) {
    throw new ApiClientError("Réponse serveur invalide.");
  }

  return data as T;
}

export type SecureUploadRequestOptions = {
  fieldName?: string;
  maxBytes?: number;
  allowedMimeTypes?: string[];
  extraFields?: Record<string, string>;
};

/**
 * Upload sécurisé : validation MIME + taille obligatoire avant FormData.
 * L'API n'accepte pas un FormData brut (impossible de contourner les contrôles).
 */
export async function httpUpload(
  path: string,
  file: SecureUploadFile,
  {
    fieldName = "file",
    maxBytes = DEFAULT_UPLOAD_MAX_BYTES,
    allowedMimeTypes = [...DEFAULT_ALLOWED_UPLOAD_MIME_TYPES],
    extraFields = {},
  }: SecureUploadRequestOptions = {},
): Promise<unknown> {
  try {
    assertSecureUploadFile(file, { maxBytes, allowedMimeTypes });
  } catch (error) {
    if (error instanceof SecureUploadValidationError) {
      throw new ApiClientError(error.message);
    }
    throw error;
  }

  const root = resolveApiRootUrl();
  validateApiRootUrl(root);
  if (!isDevelopmentRuntime() && !root.startsWith("https://")) {
    throw new ApiClientError("Les envois de fichiers exigent HTTPS.");
  }

  const formData = new FormData();
  formData.append(fieldName, {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);

  for (const [key, value] of Object.entries(extraFields)) {
    formData.append(key, value);
  }

  return httpRequest(path, {
    method: "POST",
    body: formData,
    headers: {},
  });
}

export {
  assertSecureUploadFile,
  DEFAULT_ALLOWED_UPLOAD_MIME_TYPES,
  DEFAULT_UPLOAD_MAX_BYTES,
};
export type { SecureUploadFile };
