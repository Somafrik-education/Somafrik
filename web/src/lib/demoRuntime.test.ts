import { describe, expect, it } from "vitest";
import {
  demoWatermarkLabel,
  isDemoRuntimeExpired,
  normalizeDemoRuntimeState,
} from "./demoRuntime";

describe("demoRuntime", () => {
  it("normalise une session Démo valide", () => {
    expect(
      normalizeDemoRuntimeState({
        id: "demo-7f32",
        expiresAt: "2026-09-15T15:00:00.000Z",
      }),
    ).toEqual({
      id: "demo-7f32",
      expiresAt: "2026-09-15T15:00:00.000Z",
    });
  });

  it("rejette des métadonnées invalides", () => {
    expect(normalizeDemoRuntimeState(null)).toBeNull();
    expect(normalizeDemoRuntimeState({ id: "", expiresAt: "2026-09-15" })).toBeNull();
    expect(normalizeDemoRuntimeState({ id: "demo", expiresAt: "invalide" })).toBeNull();
  });

  it("détecte l'expiration sans marge silencieuse", () => {
    const state = { id: "demo-7f32", expiresAt: "2026-09-15T15:00:00.000Z" };
    expect(isDemoRuntimeExpired(state, Date.parse("2026-09-15T14:59:59.999Z"))).toBe(false);
    expect(isDemoRuntimeExpired(state, Date.parse("2026-09-15T15:00:00.000Z"))).toBe(true);
  });

  it("génère un watermark sans PII", () => {
    const label = demoWatermarkLabel(
      { id: "demo-7f32", expiresAt: "2026-09-15T15:00:00.000Z" },
      Date.parse("2026-09-15T14:30:00.000Z"),
    );
    expect(label).toContain("SOMAFRIK — DÉMONSTRATION — DONNÉES FICTIVES");
    expect(label).toContain("DEMO-7F32");
    expect(label).toContain("2026-09-15 14:30Z");
  });
});
