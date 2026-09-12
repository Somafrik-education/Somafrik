import { API_URL } from "./apiUrl";

const INTERNAL_LOGO_PATH = /\/api\/schools\/[^/]+\/logo\/?$/i;

export type SchoolLogoSource = {
  code?: string;
  loginCode?: string;
  publicId?: string;
  hasLogo?: boolean;
  logoUrl?: string;
} | null | undefined;

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

/** URL interne générée pour afficher le fichier. L'utilisateur ne la saisit jamais. */
export function schoolLogoSrc(school: SchoolLogoSource): string | null {
  if (!schoolHasLogo(school)) return null;
  const code = publicCode(school);
  if (!code) return null;
  return `${API_URL.replace(/\/$/, "")}/api/schools/${encodeURIComponent(code)}/logo`;
}
