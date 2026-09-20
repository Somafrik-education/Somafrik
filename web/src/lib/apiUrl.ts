export const LEGACY_PREPRODUCTION_API_URL = "https://somafrik-api-preprod.onrender.com";
export const CANONICAL_PREPRODUCTION_API_URL = "https://api-preprod.somafrik.app";

export function resolveConfiguredApiUrl(value: string | undefined): string {
  const normalized = String(value ?? "").trim().replace(/\/+$/, "");
  if (normalized === LEGACY_PREPRODUCTION_API_URL) {
    return CANONICAL_PREPRODUCTION_API_URL;
  }
  return normalized;
}

const API_URL = resolveConfiguredApiUrl(import.meta.env.VITE_API_URL);

if (!API_URL) {
  throw new Error("VITE_API_URL n'est pas configurée");
}

export { API_URL };
