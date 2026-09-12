export type SchoolLogoSource = {
  code?: string;
  loginCode?: string;
  publicId?: string;
  hasLogo?: boolean;
  logoUrl?: string;
} | null | undefined;

const INTERNAL_LOGO_PATH = /\/api\/schools\/[^/]+\/logo\/?$/i;

function publicCode(school: SchoolLogoSource): string {
  if (!school) return "";
  return String(school.loginCode || school.publicId || school.code || "").trim();
}

/** Un établissement sans fichier uploadé n'a aucun logo — jamais de fallback plateforme. */
export function schoolHasLogo(school: SchoolLogoSource): boolean {
  if (!school) return false;
  if (school.hasLogo === true) return true;
  if (school.hasLogo === false) return false;
  const url = String(school.logoUrl ?? "").trim();
  if (!url) return false;
  if (/^https?:\/\//i.test(url) && !INTERNAL_LOGO_PATH.test(url)) return false;
  return INTERNAL_LOGO_PATH.test(url) || url.startsWith("school-logos/");
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
