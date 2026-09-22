/**
 * Contrat de bout en bout du deep-link de notification.
 *
 * Les tests R1 prouvent que « Ouvrir » navigue vers `/route?cle=id`. Ce contrat
 * ferme la seconde moitié du parcours : pour chaque destination, la page servie
 * par la route doit consommer exactement la clé produite par le résolveur. Sans
 * cette vérification, renommer `conversationId` d'un seul côté laisserait un
 * bouton « Ouvrir » qui atterrit sur la bonne page sans ouvrir la ressource.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  notificationDestinationContract,
  resolveNotificationDestination,
} from "./notificationNavigation";

const SRC = path.resolve(__dirname, "..");

/** Page de destination réellement montée par la route, par type de cible. */
const DESTINATION_PAGES: Record<string, { component: string; file: string }> = {
  conversation: { component: "MessagesConversationsPage", file: "pages/MessagesConversationsPage.tsx" },
  announcement: { component: "AnnouncementsPage", file: "pages/AnnouncementsPage.tsx" },
  payment: { component: "EntityPage", file: "pages/EntityPage.tsx" },
  attendance: { component: "PresencesPage", file: "pages/PresencesPage.tsx" },
  grade: { component: "GradesEvaluationsPage", file: "pages/GradesEvaluationsPage.tsx" },
  report_card: { component: "EntityPage", file: "pages/EntityPage.tsx" },
  finance_obligation: { component: "FinanceUnpaidPage", file: "pages/finances/FinanceUnpaidPage.tsx" },
  timetable: { component: "CoursePlanningPage", file: "pages/CoursePlanningPage.tsx" },
  teacher_replacement: {
    component: "PlanningSubstitutionsPage",
    file: "pages/planning/PlanningSubstitutionsPage.tsx",
  },
};

function readSource(relative: string): string {
  return readFileSync(path.join(SRC, relative), "utf8");
}

/** La page lit-elle ce paramètre d'URL, via le lecteur partagé ou useSearchParams ? */
function consumesParam(source: string, key: string): boolean {
  return (
    source.includes(`useDeepLinkId("${key}")`) ||
    new RegExp(`useDeepLinkIds\\(\\[[^\\]]*"${key}"`, "s").test(source) ||
    source.includes(`params.get("${key}")`) ||
    source.includes(`searchParams.get("${key}")`)
  );
}

const appSource = readSource("App.tsx");
const contract = notificationDestinationContract();

describe("DEEPLINK-CONTRACT — la page servie consomme la clé produite par le résolveur", () => {
  it("DEEPLINK-CONTRACT-01 — les neuf destinations ouvrables sont couvertes", () => {
    expect(contract.map((row) => row.type).sort()).toEqual(Object.keys(DESTINATION_PAGES).sort());
  });

  for (const destination of contract) {
    const page = DESTINATION_PAGES[destination.type];

    it(`DEEPLINK-CONTRACT — ${destination.type} : ${page.component} lit ${destination.requiredKey}`, () => {
      expect(consumesParam(readSource(page.file), destination.requiredKey)).toBe(true);
    });

    it(`DEEPLINK-CONTRACT — ${destination.type} : la route ${destination.path} monte ${page.component}`, () => {
      const lastSegment = destination.path.split("/").filter(Boolean).at(-1);
      expect(appSource).toContain(`<${page.component}`);
      expect(
        appSource.includes(`path="${destination.path}"`) || appSource.includes(`path="${lastSegment}"`),
      ).toBe(true);
    });

    it(`DEEPLINK-CONTRACT — ${destination.type} : l'URL produite porte ${destination.requiredKey}`, () => {
      const url = resolveNotificationDestination({
        type: destination.type,
        [destination.requiredKey]: "id-contrat",
      });
      expect(url).not.toBeNull();
      const query = new URLSearchParams(String(url).split("?")[1] ?? "");
      expect(query.get(destination.requiredKey)).toBe("id-contrat");
    });
  }

  it("DEEPLINK-CONTRACT-02 — teacher_replacement désigne un remplacement existant, pas une création", () => {
    const source = readSource(DESTINATION_PAGES.teacher_replacement.file);
    expect(source).toContain('params.get("replacementId")');
    // Le wizard de création ne doit plus s'ouvrir quand un remplacement est visé.
    expect(source).toContain("!deepLinkReplacementId");
  });
});
