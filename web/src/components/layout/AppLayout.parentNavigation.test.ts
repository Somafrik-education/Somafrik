import { describe, expect, it } from "vitest";
import { resolveAppNavigationTitle } from "./AppLayout";

describe("AppLayout — titres Parent", () => {
  it("utilise les libellés Parent pour les routes du suivi", () => {
    expect(resolveAppNavigationTitle("/tableau-de-bord", true)).toBe("Accueil");
    expect(resolveAppNavigationTitle("/mon-profil", true)).toBe("Mon profil");
    expect(resolveAppNavigationTitle("/presences", true)).toBe("Présences");
    expect(resolveAppNavigationTitle("/notes", true)).toBe("Notes");
    expect(resolveAppNavigationTitle("/bulletins", true)).toBe("Bulletins");
    expect(resolveAppNavigationTitle("/finances/paiements", true)).toBe("Frais & paiements");
    expect(resolveAppNavigationTitle("/messages", true)).toBe("Messages");
    expect(resolveAppNavigationTitle("/annonces", true)).toBe("Annonces");
  });

  it("conserve le titre Communication pour le shell staff", () => {
    expect(resolveAppNavigationTitle("/messages", false)).toBe("Communication");
    expect(resolveAppNavigationTitle("/annonces", false)).toBe("Communication");
  });

  it("nomme explicitement les notifications", () => {
    expect(resolveAppNavigationTitle("/notifications", true)).toBe("Notifications");
    expect(resolveAppNavigationTitle("/notifications-plateforme", false)).toBe("Notifications");
  });
});
