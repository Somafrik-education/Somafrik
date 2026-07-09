import { describe, it, expect } from "vitest";

import {
  CLASSES_LOADING_COPY,
  CLASSES_LOADING_TEST_IDS,
  CLASSES_SKELETON_CARD_COUNT,
  classesSkeletonCardTestId,
} from "../src/lib/classesLoadingSpec";

describe("classesLoadingSpec", () => {
  it("expose les testID de chargement classes", () => {
    expect(CLASSES_LOADING_TEST_IDS.loadingIndicator).toBe("classes-loading-indicator");
    expect(CLASSES_LOADING_TEST_IDS.loadingSkeleton).toBe("classes-loading-skeleton");
    expect(CLASSES_LOADING_TEST_IDS.classesList).toBe("classes-list");
    expect(CLASSES_LOADING_TEST_IDS.addClassButton).toBe("classes-add-button");
  });

  it("définit un libellé de chargement explicite", () => {
    expect(CLASSES_LOADING_COPY.loadingLabel).toMatch(/Chargement des classes/i);
  });

  it("génère des testID skeleton stables", () => {
    expect(classesSkeletonCardTestId(0)).toBe("classes-skeleton-card-0");
    expect(CLASSES_SKELETON_CARD_COUNT).toBeGreaterThanOrEqual(2);
  });
});
