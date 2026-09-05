// Client API minimaliste: même contrat que le BackOffice historique.
// VITE_API_URL obligatoire (ex. https://api.somafrik.app ou http://localhost:5000).

import { API_URL } from "../lib/apiUrl";

const API_BASE_URL = `${API_URL.replace(/\/$/, "")}/api`;

export class ApiError extends Error {
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
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { accessToken?: string; refreshToken?: string };
    if (!data.accessToken) return null;
    persistRotatedTokens?.({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return data.accessToken;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function isAuthRefreshPath(path: string) {
  // Logout is authenticated: a 401 on expired access must refresh once, then revoke.
  return path.startsWith("/auth/refresh") || path.startsWith("/backoffice/login");
}

export async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<T> {
  const token = accessTokenProvider();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  let data: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !retried && !isAuthRefreshPath(path)) {
      const next = await refreshAccessTokenOnce();
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

  return data as T;
}

export async function requestBlob(path: string, options: RequestInit = {}, retried = false): Promise<Blob> {
  const token = accessTokenProvider();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    if (response.status === 401 && !retried && !isAuthRefreshPath(path)) {
      const next = await refreshAccessTokenOnce();
      if (next) return requestBlob(path, options, true);
    }
    const text = await response.text();
    let message = "Erreur plateforme";
    if (text) {
      try {
        const data = JSON.parse(text) as { message?: unknown };
        if (data.message) message = String(data.message);
      } catch {
        const cannotRoute = text.match(/Cannot (GET|POST|PUT|DELETE) ([^\s<]+)/i);
        if (cannotRoute) {
          message = `Service indisponible (${cannotRoute[2]}). Redémarrez ou reconstruisez le backend.`;
        } else if (text.length <= 200) {
          message = text;
        }
      }
    }
    throw new ApiError(message, response.status);
  }

  return response.blob();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, init: RequestInit = {}) =>
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
