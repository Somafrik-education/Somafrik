import { describe, it, expect } from "vitest";

import { NAVIGATION_COPY, TAB_TRANSITION_MAX_MS, tabTestIdForTabName } from "../src/lib/mobileNavigationSpec";
import { TAB_TEST_IDS } from "../src/lib/loginScreenSpec";

describe("mobileNavigationSpec", () => {
  it("expose les libellés d'onglets attendus", () => {
    expect(NAVIGATION_COPY.tabAccueil).toBe("Accueil");
    expect(NAVIGATION_COPY.tabClasses).toBe("Classes");
    expect(NAVIGATION_COPY.tabTeachers).toBe("Enseignants");
    expect(NAVIGATION_COPY.tabMenu).toBe("Menu");
  });

  it("mappe les testID des onglets principaux", () => {
    expect(tabTestIdForTabName("Accueil")).toBe(TAB_TEST_IDS.accueil);
    expect(tabTestIdForTabName("Classes")).toBe(TAB_TEST_IDS.classes);
    expect(tabTestIdForTabName("Enseignants")).toBe(TAB_TEST_IDS.teachers);
    expect(tabTestIdForTabName("Menu")).toBe(TAB_TEST_IDS.menu);
  });

  it("fixe un délai de transition tab acceptable", () => {
    expect(TAB_TRANSITION_MAX_MS).toBeGreaterThanOrEqual(1000);
    expect(TAB_TRANSITION_MAX_MS).toBeLessThanOrEqual(5000);
  });
});
