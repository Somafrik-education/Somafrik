/**
 * Pays initial du catalogue pédagogique.
 * Superadmin : aucun défaut (ni countries[0], ni CD).
 * Admin Pays : uniquement son unique pays scopé.
 */
export function initialCatalogCountryCode(options: {
  isCountryAdmin: boolean;
  visibleCountryCodes: string[];
}): string {
  if (options.isCountryAdmin && options.visibleCountryCodes.length === 1) {
    return options.visibleCountryCodes[0] ?? "";
  }
  return "";
}
