import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { School } from "../types";
import { createSubscriptionFromOffer, DEFAULT_SUBSCRIPTION_OFFERS } from "./subscriptionModule";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const school: School = {
  code: "CD-IN-26-001",
  name: "Complexe Scolaire Nuru",
  countryCode: "CD",
  country: "RDC",
};

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

describe("Raccord essai Standard 30 jours (domaine existant + contrat RED)", () => {
  it("GREEN — createSubscriptionFromOffer(Standard, startTrial) pose Essai 30 jours sans offre limitée", () => {
    const standard = DEFAULT_SUBSCRIPTION_OFFERS.find((offer) => offer.id === "OFFER-STANDARD");
    expect(standard, "offre Standard absente").toBeTruthy();
    expect(standard?.modules.payments).toBe(true);
    const created = createSubscriptionFromOffer(school, standard!, { startTrial: true });
    expect(created.plan).toBe("Standard");
    expect(created.offerId).toBe("OFFER-STANDARD");
    expect(created.lifecycleStatus).toBe("Essai");
    expect(created.trialUsed).toBe(true);
    expect(created.activatedModules).toEqual(
      expect.arrayContaining(["students", "classes", "presences", "notes", "bulletins", "payments"]),
    );
    const start = created.startDate ?? "";
    const end = created.endDate ?? "";
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();
    expect(end).not.toBe(start);
  });

  it("RED — l'activation depuis une demande publique doit brancher Standard+Essai, jamais OFFER-TRIAL", () => {
    const activation = [
      join(ROOT, "web/src/lib/trialAccessActivation.ts"),
      join(ROOT, "backend/lib/trialAccessRequests.js"),
    ]
      .map((file) => (existsSync(file) ? readFileSync(file, "utf8") : ""))
      .join("\n");
    expect(activation.length).toBeGreaterThan(0);
    expect(activation).toMatch(/OFFER-STANDARD/);
    expect(activation).toMatch(/startTrial:\s*true/);
    expect(activation).not.toMatch(/OFFER-TRIAL/);
  });

  it("GREEN — aucun worker ne convertit automatiquement un Essai en abonnement payant", () => {
    const backendJs = walkFiles(join(ROOT, "backend")).filter((file) => file.endsWith(".js"));
    const offenders = backendJs.filter((file) => {
      if (file.includes(".test.") || file.includes("/scripts/")) return false;
      const source = readFileSync(file, "utf8");
      return (
        /setInterval|node-cron|cron\./.test(source) &&
        /lifecycleStatus/.test(source) &&
        /Actif/.test(source) &&
        /Essai/.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });
});
