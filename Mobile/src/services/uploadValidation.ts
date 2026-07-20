/**
 * S2.3 — Validation MIME / taille des uploads (pure, testable hors React Native).
 */

export type SecureUploadFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
};

export type SecureUploadOptions = {
  maxBytes: number;
  allowedMimeTypes: string[];
};

export const DEFAULT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_ALLOWED_UPLOAD_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export class SecureUploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecureUploadValidationError";
  }
}

/**
 * Valide un fichier avant toute construction / envoi de FormData.
 * Ne doit pas être contournable par un appelant public.
 */
export function assertSecureUploadFile(
  file: SecureUploadFile,
  options: SecureUploadOptions,
): void {
  if (!file || typeof file !== "object") {
    throw new SecureUploadValidationError("Fichier vide ou taille inconnue.");
  }

  if (typeof file.uri !== "string" || !file.uri.trim()) {
    throw new SecureUploadValidationError("URI de fichier manquante.");
  }

  if (typeof file.name !== "string" || !file.name.trim()) {
    throw new SecureUploadValidationError("Nom de fichier manquant.");
  }

  if (typeof file.mimeType !== "string" || !file.mimeType.trim()) {
    throw new SecureUploadValidationError("Type de fichier non autorisé.");
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new SecureUploadValidationError("Fichier vide ou taille inconnue.");
  }

  if (file.size > options.maxBytes) {
    throw new SecureUploadValidationError("Le fichier dépasse la taille autorisée.");
  }

  const normalizedMime = file.mimeType.trim().toLowerCase();
  const allowed = options.allowedMimeTypes.map((mime) => mime.toLowerCase());
  if (!allowed.includes(normalizedMime)) {
    throw new SecureUploadValidationError("Type de fichier non autorisé.");
  }
}
