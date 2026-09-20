import { describe, expect, it } from "vitest";

import {
  CANONICAL_PREPRODUCTION_API_URL,
  LEGACY_PREPRODUCTION_API_URL,
  resolveConfiguredApiUrl,
} from "./apiUrl";

describe("resolveConfiguredApiUrl", () => {
  it("redirige l’ancienne origine Render préprod vers le DNS canonique", () => {
    expect(resolveConfiguredApiUrl(LEGACY_PREPRODUCTION_API_URL)).toBe(
      CANONICAL_PREPRODUCTION_API_URL,
    );
    expect(resolveConfiguredApiUrl(`${LEGACY_PREPRODUCTION_API_URL}/`)).toBe(
      CANONICAL_PREPRODUCTION_API_URL,
    );
  });

  it("conserve les autres origines après normalisation", () => {
    expect(resolveConfiguredApiUrl("https://api.somafrik.app/")).toBe(
      "https://api.somafrik.app",
    );
    expect(resolveConfiguredApiUrl("http://localhost:5000/")).toBe(
      "http://localhost:5000",
    );
  });
});
