/**
 * Contrat UI/UX — mode hors connexion mobile.
 */

export const OFFLINE_COPY = {
  bannerTitle: "Hors connexion",
  bannerHint:
    "Les données déjà chargées restent consultables. Les modifications reprendront dès le retour du réseau.",
  actionBlocked: "Action impossible sans connexion internet.",
  reconnected: "Connexion rétablie",
} as const;

export const OFFLINE_TEST_IDS = {
  banner: "offline-banner",
  bannerTitle: "offline-banner-title",
  bannerHint: "offline-banner-hint",
  actionMessage: "offline-action-message",
  reconnectedBanner: "offline-reconnected-banner",
} as const;

export const OFFLINE_RECOVERY_MAX_MS = 12000;
