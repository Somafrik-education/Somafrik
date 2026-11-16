import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { StudentOverviewTab } from "./StudentOverviewTab";

function fixture(alerts: StudentWorkspaceViewModel["alerts"]): StudentWorkspaceViewModel {
  return {
    studentId: "CD-TEST-01",
    alerts,
    genderLabel: "Féminin",
    ageLabel: "10 ans",
    birthDateLabel: "06 octobre 2016",
    phoneLabel: "Non renseigné",
    nationalityLabel: "Congolaise",
    academicYearLabel: "2026-2027",
    classLabel: "2ème A",
    enrollmentStatusLabel: "Inscrit",
    enrollmentDateLabel: "18 août 2026",
    guardiansCountLabel: "1",
    primaryGuardianNameLabel: "Parent exemple",
    primaryGuardianPhoneLabel: "Non renseigné",
    hasDocuments: false,
    hasMedicalProfile: false,
    medical: { hasCriticalRisk: false },
    historyModule: { latestImportantEventLabel: "", summary: { totalEvents: 0 } },
  } as unknown as StudentWorkspaceViewModel;
}

function renderOverview(alerts: StudentWorkspaceViewModel["alerts"]): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StudentOverviewTab workspace={fixture(alerts)} />
    </MemoryRouter>,
  );
}

describe("Fiche Élève — vue d'ensemble sans bandeaux d'alerte", () => {
  it("masque les cartes horizontales et conserve les 4 résumés et les accès métier", () => {
    const html = renderOverview([
      { id: "missing-document", severity: "warning", message: "Document obligatoire manquant", targetModuleId: "documents" },
      { id: "no-emergency", severity: "warning", message: "Aucun contact d'urgence", targetModuleId: "guardians" },
    ]);
    expect(html).not.toContain('aria-label="Alertes du dossier"');
    expect(html).not.toContain("Voir la section");
    expect(html).not.toContain("Document obligatoire manquant");
    expect(html).not.toContain("Aucun contact d&#x27;urgence");
    for (const section of ["Identité", "Scolarité actuelle", "Responsables", "État du dossier"]) {
      expect(html).toContain(section);
    }
    expect(html).toContain("2 points d");
    for (const section of ["Notes", "Présences", "Paiements"]) {
      expect(html).toContain(section);
    }
  });

  it("ne change pas le résumé d'un dossier sans point d'attention", () => {
    const html = renderOverview([]);
    expect(html).toContain("Aucun point d");
    expect(html).not.toContain("Voir la section");
  });
});
