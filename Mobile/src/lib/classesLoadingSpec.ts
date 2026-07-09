/**
 * Contrat UI/UX — états de chargement de l'écran Classes.
 */

export const CLASSES_LOADING_COPY = {
  loadingLabel: "Chargement des classes…",
} as const;

export const CLASSES_LOADING_TEST_IDS = {
  loadingIndicator: "classes-loading-indicator",
  loadingSkeleton: "classes-loading-skeleton",
  skeletonCardPrefix: "classes-skeleton-card-",
  classesList: "classes-list",
  addClassButton: "classes-add-button",
  summaryCard: "classes-summary-card",
} as const;

export const CLASSES_SKELETON_CARD_COUNT = 3;

export const CLASSES_LOADING_MIN_VISIBLE_MS = 150;

export function classesSkeletonCardTestId(index: number): string {
  return `${CLASSES_LOADING_TEST_IDS.skeletonCardPrefix}${index}`;
}
