import { API_URL } from "./apiUrl";

const SCHOOL_UPLOAD = "school_upload";

export type SchoolLogoSource = {
  code?: string;
  loginCode?: string;
  publicId?: string;
  hasLogo?: boolean;
  logoSource?: string;
  logoUploadedAt?: string;
  logoUrl?: string;
} | null | undefined;

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

/** URL interne générée pour afficher le fichier. L'utilisateur ne la saisit jamais. */
export function schoolLogoSrc(school: SchoolLogoSource): string | null {
  if (!schoolHasLogo(school)) return null;
  const code = publicCode(school);
  if (!code) return null;
  return `${API_URL.replace(/\/$/, "")}/api/schools/${encodeURIComponent(code)}/logo`;
}
