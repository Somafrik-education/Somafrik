/**
 * Contrat UI/UX — mode hors connexion mobile.
 */

export const OFFLINE_COPY = {
  bannerTitle: "Hors connexion",
  bannerHint:
    "Les listes déjà chargées restent consultables. Un envoi n'est rejoué que s'il figure réellement dans la file d'attente.",
  actionBlocked: "Action impossible sans connexion internet.",
  reconnected: "Connexion rétablie",
  pendingOutbox: "envoi(s) en attente — confirmation serveur requise.",
} as const;

export const OFFLINE_TEST_IDS = {
  banner: "offline-banner",
  bannerTitle: "offline-banner-title",
  bannerHint: "offline-banner-hint",
  actionMessage: "offline-action-message",
  pendingCount: "offline-banner-pending",
  reconnectedBanner: "offline-reconnected-banner",
} as const;

export const OFFLINE_RECOVERY_MAX_MS = 12000;
