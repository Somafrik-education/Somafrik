import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(HERE, "..");
const PAGE = join(HERE, "TrialRequestPage.tsx");
const APP = join(WEB_SRC, "App.tsx");
const LAZY = join(WEB_SRC, "lazyPages.ts");

const CTA_LABEL = "Demander 1 mois d'essai gratuit";
const SUCCESS_COPY = "Un responsable Somafrik vous contactera pour activer votre essai.";

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("Route publique /demande-essai (RED)", () => {
  it("déclare une page TrialRequestPage", () => {
    expect(existsSync(PAGE), "web/src/pages/TrialRequestPage.tsx manquant").toBe(true);
  });

  it("exporte TrialRequestPage depuis lazyPages", () => {
    expect(read(LAZY)).toMatch(/TrialRequestPage/);
  });

  it("enregistre /demande-essai en route publique, hors ProtectedRoute", () => {
    const source = read(APP);
    const routes = source.slice(source.indexOf("<Routes>"));
    const trialIdx = routes.indexOf("/demande-essai");
    const protectedIdx = routes.indexOf("<ProtectedRoute>");
    expect(trialIdx, "route /demande-essai absente de App.tsx").toBeGreaterThan(-1);
    expect(protectedIdx).toBeGreaterThan(-1);
    expect(trialIdx).toBeLessThan(protectedIdx);
  });

  it("le formulaire public contient les champs canoniques et le consentement", () => {
    const source = read(PAGE);
    expect(source).toMatch(/requesterName|Nom du demandeur/i);
    expect(source).toMatch(/Chef d.établissement/);
    expect(source).toMatch(/Promoteur/);
    expect(source).toMatch(/Directeur/);
    expect(source).toMatch(/Administrateur/);
    expect(source).toMatch(/schoolName|Nom de l.établissement/i);
    expect(source).toMatch(/pays/i);
    expect(source).toMatch(/ville/i);
    expect(source).toMatch(/WhatsApp|t[ée]l[ée]phone/i);
    expect(source).toMatch(/email/i);
    expect(source).toMatch(/[ée]l[eè]ves/i);
    expect(source).toMatch(/consent/i);
    expect(source).toMatch(/\/api\/public\/trial-requests/);
  });

  it("affiche le libellé CTA et le message de contact sans promettre 48 h", () => {
    const source = read(PAGE);
    expect(source).toContain(CTA_LABEL);
    expect(source).toContain(SUCCESS_COPY);
    expect(source).not.toMatch(/48\s*h/i);
    expect(source).toMatch(/\/confidentialite/);
    expect(source).not.toMatch(/type=["']password["']/);
  });

  it("ne crée pas d'école, d'utilisateur ni d'abonnement depuis la page publique", () => {
    expect(existsSync(PAGE), "page publique absente").toBe(true);
    const source = read(PAGE);
    expect(source).not.toMatch(/persistEstablishment|createFeeGrid|upsertSubscription/);
    expect(source).not.toMatch(/\/backoffice\/establishments/);
    expect(source).not.toMatch(/\/backoffice\/users/);
    expect(source).not.toMatch(/\/backoffice\/subscriptions/);
  });
});
