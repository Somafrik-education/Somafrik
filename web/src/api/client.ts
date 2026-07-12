// Client API minimaliste: même contrat que le BackOffice historique.
// VITE_API_URL obligatoire (ex. https://api.somafrik.app ou http://localhost:5000).

import { API_URL } from "../lib/apiUrl";

const API_BASE_URL = `${API_URL.replace(/\/$/, "")}/api`;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let accessTokenProvider: () => string | null = () => null;

export function setAccessTokenProvider(provider: () => string | null) {
  accessTokenProvider = provider;
}

export async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
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
    const message =
      (data && typeof data === "object" && "message" in data
        ? String((data as { message: unknown }).message)
        : null) ?? "Erreur plateforme";
    throw new ApiError(message, response.status);
  }

  return data as T;
}

export async function requestBlob(path: string, options: RequestInit = {}): Promise<Blob> {
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
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  postBlob: (path: string, body?: unknown) => requestBlob(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
