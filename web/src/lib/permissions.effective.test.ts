import { describe, expect, it } from "vitest";
import { canManagePresences, getFeaturePermissions, resolveEffectivePermissions } from "./permissions";

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

describe("Affectations:CREATE — bouton Affecter", () => {
  it("autorise CREATE seulement si le jeton live est présent", () => {
    const allowed = getFeaturePermissions(
      {
        user: {
          id: "u1",
          role: "Admin School",
          permissions: ["Enseignants:UPDATE", "Affectations:CREATE"],
        } as never,
        rolePermissions: {},
      },
      "Affectations",
    );
    expect(allowed.canCreate).toBe(true);
    expect(allowed.canUpdate).toBe(false);

    const denied = getFeaturePermissions(
      {
        user: {
          id: "u1",
          role: "Admin School",
          permissions: ["Enseignants:READ", "Enseignants:UPDATE", "Matières:CREATE"],
        } as never,
        rolePermissions: {},
      },
      "Affectations",
    );
    expect(denied.canCreate).toBe(false);
  });
});

describe("Présences — saisie d'appel (canManagePresences)", () => {
  const prefet = (permissions: string[]) =>
    ({
      user: {
        id: "prefet-1",
        role: "Préfet des études",
        permissions,
      },
      rolePermissions: {},
    }) as never;

  it("autorise l'enregistrement si Présences:CREATE seul (UPDATE absent)", () => {
    expect(canManagePresences(prefet(["Présences:READ", "Présences:CREATE"]))).toBe(true);
  });

  it("autorise l'enregistrement si Présences:UPDATE seul (CREATE absent)", () => {
    expect(canManagePresences(prefet(["Présences:READ", "Présences:UPDATE"]))).toBe(true);
  });

  it("refuse l'enregistrement si READ seul — toast UI avant l'API", () => {
    expect(canManagePresences(prefet(["Présences:READ"]))).toBe(false);
  });

  it("n'utilise pas Attendances comme module distinct", () => {
    expect(canManagePresences(prefet(["Attendances:CREATE"]))).toBe(false);
  });

  it("accepte encore l'alias legacy contenant « appel » (Appels:CREATE)", () => {
    expect(canManagePresences(prefet(["Appels:CREATE"]))).toBe(true);
    expect(canManagePresences(prefet(["Faire appel"]))).toBe(true);
  });
});

