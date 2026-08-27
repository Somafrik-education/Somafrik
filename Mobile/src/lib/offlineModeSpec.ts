/**
 * Contrat UI/UX — mode hors connexion mobile.
 */

export const OFFLINE_COPY = {
  bannerTitle: "Hors connexion",
  bannerHint:
    "Les listes déjà chargées restent consultables. Un envoi n'est rejoué que s'il figure réellement dans la file d'attente.",
  permissionsUnrevalidated: "Mode hors ligne — droits non revalidés",
  actionBlocked: "Action impossible sans connexion internet.",
  mutationRequiresConnection: "Cette action nécessite une connexion.",
  l1ModeTitle: "Mode hors ligne",
  l1LastSyncPrefix: "Dernière synchronisation",
  l1SchoolCoursesHint: "Données hors ligne — dernière synchronisation",
  reconnected: "Connexion rétablie",
  pendingOutbox: "envoi(s) en attente — confirmation serveur requise.",
  outboxUnread: "File d'attente illisible — confirmation serveur non déterminée.",
} as const;

export const OFFLINE_TEST_IDS = {
  banner: "offline-banner",
  bannerTitle: "offline-banner-title",
  bannerHint: "offline-banner-hint",
  actionMessage: "offline-action-message",
  pendingCount: "offline-banner-pending",
  outboxUnread: "offline-banner-outbox-unread",
  reconnectedBanner: "offline-reconnected-banner",
} as const;

export const OFFLINE_RECOVERY_MAX_MS = 12000;
