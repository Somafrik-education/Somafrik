export type SchoolLogoSource = {
  code?: string;
  loginCode?: string;
  publicId?: string;
  hasLogo?: boolean;
  logoSource?: string;
  logoUrl?: string;
} | null | undefined;

const SCHOOL_UPLOAD = "school_upload";

function publicCode(school: SchoolLogoSource): string {
  if (!school) return "";
  return String(school.loginCode || school.publicId || school.code || "").trim();
}

/** Un établissement sans upload SCHOOL n'a aucun logo — jamais de fallback plateforme. */
export function schoolHasLogo(school: SchoolLogoSource): boolean {
  if (!school) return false;
  if (String(school.logoSource ?? "").trim() !== SCHOOL_UPLOAD) return false;
  if (school.hasLogo === false) return false;
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
