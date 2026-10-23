import { requestBlob } from "../api/client";
import { API_URL } from "./apiUrl";

/**
 * CARTE-PHOTO-01 — images d'un dossier scolaire.
 * Une URL relative est rattachée à l'API (pas à l'origine du frontend).
 * Seules les URLs sous /api/ du backend sont lues via le client JWT.
 * Aucun jeton n'est ajouté à l'URL, aux logs ou au HTML imprimé.
 */
export function resolveStudentCardPhotoUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) return value;
  if (/^blob:/i.test(value)) return value;
  if (/^(?:javascript|file|data):/i.test(value) || value.startsWith("//")) return null;
  try {
    const base = new URL(API_URL.endsWith("/") ? API_URL : `${API_URL}/`);
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) {
      // Chemin relatif sans slash : toujours relatif à la racine de l'API.
      return new URL(value, base).href;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** La lecture authentifiée est réservée à notre API, jamais aux URLs tierces. */
export function studentCardPhotoApiPath(url: string): string | null {
  try {
    const api = new URL(API_URL);
    const parsed = new URL(url);
    if (api.origin !== parsed.origin || !parsed.pathname.startsWith("/api/")) return null;
    return `${parsed.pathname.slice(4)}${parsed.search}`;
  } catch {
    return null;
  }
}

export async function loadStudentCardPhoto(
  raw: string | null | undefined,
  createObjectUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): Promise<{ src: string | null; revoke: boolean }> {
  const url = resolveStudentCardPhotoUrl(raw);
  if (!url) return { src: null, revoke: false };
  const apiPath = studentCardPhotoApiPath(url);
  if (!apiPath) return { src: url, revoke: false };
  const blob = await requestBlob(apiPath);
  if (!blob.type.startsWith("image/")) return { src: null, revoke: false };
  return { src: createObjectUrl(blob), revoke: true };
}
