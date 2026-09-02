export const SOMAFRIK_LEGAL_ORIGIN = "https://somafrik.app" as const;

export const PRIVACY_POLICY_URL = `${SOMAFRIK_LEGAL_ORIGIN}/confidentialite` as const;
export const ACCOUNT_DELETION_URL = `${SOMAFRIK_LEGAL_ORIGIN}/suppression-compte` as const;

export const LEGAL_COPY = {
  privacy: "Politique de confidentialité",
  deletion: "Demander la suppression de mon compte",
} as const;

const ALLOWED_PRODUCTION_LEGAL_URLS = new Set<string>([
  PRIVACY_POLICY_URL,
  ACCOUNT_DELETION_URL,
]);

export function isAllowedProductionLegalUrl(url: string) {
  return url.startsWith(`${SOMAFRIK_LEGAL_ORIGIN}/`) && ALLOWED_PRODUCTION_LEGAL_URLS.has(url);
}
