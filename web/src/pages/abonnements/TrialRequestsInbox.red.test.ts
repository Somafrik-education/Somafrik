import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(relative: string): string {
  const path = join(WEB_SRC, relative);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("Inbox Superadmin demandes d'essai (RED)", () => {
  it("déclare la route /abonnements/demandes-essai", () => {
    const app = read("App.tsx");
    expect(app).toMatch(/path=["']demandes-essai["']/);
  });

  it("ajoute un onglet Demandes d'essai au module Abonnements", () => {
    const layout = read("pages/abonnements/SubscriptionsLayout.tsx");
    expect(layout).toMatch(/demandes-essai/);
    expect(layout).toMatch(/Demandes d.essai/);
  });

  it("la page inbox consomme GET /api/backoffice/trial-requests", () => {
    const candidates = [
      "pages/abonnements/TrialRequestsPage.tsx",
      "pages/abonnements/SubscriptionTrialRequestsPage.tsx",
    ];
    const source = candidates.map((file) => read(file)).join("\n");
    expect(source).toMatch(/\/api\/backoffice\/trial-requests|\/backoffice\/trial-requests/);
    expect(source).toMatch(/nouvelle/);
    expect(source).toMatch(/contactée|contactee/);
    expect(source).toMatch(/qualifiée|qualifiee/);
    expect(source).toMatch(/essai activé|essai_activ/);
    expect(source).toMatch(/convertie/);
    expect(source).toMatch(/refusée|refusee|abandonnée/);
  });
});
