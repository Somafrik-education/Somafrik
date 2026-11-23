export type SchoolLogoSource = {
  code?: string;
  loginCode?: string;
  publicId?: string;
  hasLogo?: boolean;
  logoSource?: string;
  logoUploadedAt?: string;
  logoUrl?: string;
} | null | undefined;

const SCHOOL_UPLOAD = "school_upload";

function publicCode(school: SchoolLogoSource): string {
  if (!school) return "";
  return String(school.loginCode || school.publicId || school.code || "").trim();
}

function hasValidLogoUploadedAt(value: unknown): boolean {
  const raw = String(value ?? "").trim();
  if (!raw || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return false;
  return !Number.isNaN(Date.parse(raw));
}

/** Un établissement sans upload SCHOOL n'a aucun logo — jamais de fallback plateforme. */
export function schoolHasLogo(school: SchoolLogoSource): boolean {
  if (!school) return false;
  if (String(school.logoSource ?? "").trim() !== SCHOOL_UPLOAD) return false;
  if (!hasValidLogoUploadedAt(school.logoUploadedAt)) return false;
  if (school.hasLogo !== true) return false;
  return true;
}

/**
 * URI interne pour `<Image>`.
 * `apiBaseUrl` = `getApiBaseUrl()` (racine déjà suffixée `/api`).
 */
export function schoolLogoDisplayUri(school: SchoolLogoSource, apiBaseUrl: string): string | null {
  if (!schoolHasLogo(school)) return null;
  const code = publicCode(school);
  if (!code) return null;
  const base = String(apiBaseUrl ?? "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/schools/${encodeURIComponent(code)}/logo`;
}

/**
 * AUTH-MOBILE-01 — remplacement neutre quand l'établissement n'a pas de logo
 * (ou que son chargement échoue) : initiales du nom, jamais le logo plateforme.
 */
export function schoolLogoInitials(name?: string | null): string {
  const words = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .filter((word, index, all) => all.length <= 2 || word.length > 2 || index === 0);
  const initials = words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
  return initials || "?";
}
