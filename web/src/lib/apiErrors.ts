import { ApiError } from "../api/client";

export function formatCaughtApiError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const code = String(error.code ?? "").trim();
    const message = error.message?.trim() || fallback;
    return code ? `${code} · ${message}` : message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
