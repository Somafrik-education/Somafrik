/**
 * Marketplace — opt-in via variable d'environnement (désactivé par défaut en préprod/prod).
 * Aucun appel API : écran placeholder uniquement.
 */
export function isMarketplaceEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_MARKETPLACE === "true";
}
