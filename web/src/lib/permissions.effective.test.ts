import { describe, expect, it } from "vitest";
import { resolveEffectivePermissions } from "./permissions";

describe("resolveEffectivePermissions — autorité serveur", () => {
  it("n'enrichit pas une liste serveur avec la carte locale", () => {
    const result = resolveEffectivePermissions(
      "Préfet des études",
      ["Élèves:READ", "Élèves:UPDATE"],
      { "Préfet des études": ["Élèves:DELETE", "Élèves:CREATE"] },
    );
    expect(result).toEqual(["Élèves:READ", "Élèves:UPDATE"]);
    expect(result).not.toContain("Élèves:DELETE");
  });

  it("conserve le deny serveur même si la carte locale est permissive", () => {
    const result = resolveEffectivePermissions("Préfet des études", [], {
      "Préfet des études": ["Élèves:DELETE"],
    });
    expect(result).toEqual([]);
  });

  it("retombe sur la carte rôle seulement si permissions utilisateur absentes", () => {
    const result = resolveEffectivePermissions("Préfet des études", undefined, {
      "Préfet des études": ["Élèves:READ"],
    });
    expect(result).toContain("Élèves:READ");
  });
});
