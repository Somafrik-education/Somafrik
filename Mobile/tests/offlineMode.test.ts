import { describe, it, expect } from "vitest";

import { OFFLINE_COPY, OFFLINE_TEST_IDS, OFFLINE_RECOVERY_MAX_MS } from "../src/lib/offlineModeSpec";

describe("offlineModeSpec", () => {
  it("expose la bannière hors connexion", () => {
    expect(OFFLINE_TEST_IDS.banner).toBe("offline-banner");
    expect(OFFLINE_COPY.bannerTitle).toBe("Hors connexion");
  });

  it("précise que le cache reste consultable", () => {
    expect(OFFLINE_COPY.bannerHint).toMatch(/consultables/i);
  });

  it("fixe un délai de reprise réseau acceptable", () => {
    expect(OFFLINE_RECOVERY_MAX_MS).toBeGreaterThanOrEqual(5000);
  });
});
