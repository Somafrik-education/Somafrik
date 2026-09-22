import { describe, expect, it } from "vitest";
import {
  navigationFooterLabel,
  visibleNavItemsForRole,
} from "./useVisibleNavItems";
import type { PermissionContext } from "../../lib/permissions";

function parentContext(permissions: string[]): PermissionContext {
  return {
    user: {
      id: "parent-1",
      role: "parent_student",
      schoolCode: "CD-IN-26-001",
      permissions,
    },
    rolePermissions: {},
    permissionsReady: true,
  };
}

describe("navigation Web Parent", () => {
  it("utilise une allowlist Parent même avec ALL_PRIVILEGES accidentel", () => {
    const visible = visibleNavItemsForRole(
      parentContext(["ALL_PRIVILEGES"]),
      "parent_student",
    );

    expect(visible.map((item) => [item.label, item.path])).toEqual([
      ["Accueil", "/tableau-de-bord"],
      ["Mon profil", "/mon-profil"],
      ["Présences", "/presences"],
      ["Notes", "/notes"],
      ["Bulletins", "/bulletins"],
      ["Frais & paiements", "/finances/paiements"],
      ["Messages", "/messages"],
      ["Annonces", "/annonces"],
    ]);

    expect(
      visible.some((item) =>
        [
          "/pays",
          "/etablissements",
          "/abonnements",
          "/etablissement",
          "/planning",
          "/administration",
          "/parametres",
        ].includes(item.path),
      ),
    ).toBe(false);
  });

  it("reste permissionné à l'intérieur de l'allowlist Parent", () => {
    const visible = visibleNavItemsForRole(
      parentContext(["Présences:READ", "Notes:READ", "Paiements:READ"]),
      "parent_student",
    );

    expect(visible.map((item) => item.path)).toEqual([
      "/tableau-de-bord",
      "/mon-profil",
      "/presences",
      "/notes",
      "/finances/paiements",
    ]);
    expect(visible.some((item) => item.path === "/bulletins")).toBe(false);
    expect(visible.some((item) => item.path === "/messages")).toBe(false);
    expect(visible.some((item) => item.path === "/annonces")).toBe(false);
  });

  it("affiche un pied de shell Parent et jamais le fallback plateforme", () => {
    expect(
      navigationFooterLabel({
        parentRole: true,
        internalSchool: false,
        schoolCode: "CD-IN-26-001",
      }),
    ).toBe("Espace Parent · CD-IN-26-001");

    expect(
      navigationFooterLabel({
        parentRole: true,
        internalSchool: false,
      }),
    ).toBe("Espace Parent");
  });

  it("préserve le pied établissement pour les rôles internes", () => {
    expect(
      navigationFooterLabel({
        parentRole: false,
        internalSchool: true,
        schoolCode: "CD-IN-26-001",
      }),
    ).toBe("Établissement · CD-IN-26-001");
  });
});
