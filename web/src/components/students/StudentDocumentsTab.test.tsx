import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StudentDocumentsTab } from "./StudentDocumentsTab";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";

const fakeWorkspace = {
  studentId: "CD-TEST-01",
  documentsModule: {
    complianceLabel: "0 %",
    badges: [{ kind: "missing", label: "MANQUANT", tone: "danger" }],
    criticalAlerts: [
      "Document obligatoire manquant",
      "Conformité documentaire insuffisante",
    ],
    summary: {
      verified: 0,
      pending: 0,
      expired: 0,
      missing: 4,
      rejected: 0,
      complianceRate: 0,
      hasCriticalMissingDocument: true,
    },
    documents: [
      {
        id: "MISSING-BIRTH_CERTIFICATE-CD-TEST-01",
        type: "BIRTH_CERTIFICATE",
        label: "Acte de naissance",
        status: "MISSING",
        statusLabel: "Manquant",
        required: true,
        critical: true,
        badges: [
          { kind: "missing", label: "MANQUANT", tone: "danger" },
          { kind: "required", label: "OBLIGATOIRE", tone: "info" },
        ],
        fileNameLabel: "Non renseigné",
        visibility: "STAFF",
      },
    ],
  },
} as unknown as StudentWorkspaceViewModel;

describe("FICHE-DOC-UI — documents sans faux boutons ni bandeaux", () => {
  it("conserve les indicateurs et pièces exigées sans dupliquer les alertes", () => {
    const html = renderToStaticMarkup(<StudentDocumentsTab workspace={fakeWorkspace} />);
    expect(html).toContain('data-testid="student-documents-summary"');
    expect(html).toContain('data-testid="student-documents-list"');
    expect(html).toContain("0 %");
    expect(html).toContain("Acte de naissance");
    expect(html).toContain("MANQUANT");
    expect(html).toContain("OBLIGATOIRE");
    expect(html).toContain("Pièces requises et documents déposés");
    expect(html).not.toContain("Document obligatoire manquant");
    expect(html).not.toContain("Conformité documentaire insuffisante");
    expect(html).not.toContain("Actions documentaires à venir");
    expect(html).not.toContain("Téléverser");
    expect(html).not.toContain("Vérifier");
    expect(html).not.toContain("Supprimer");
    expect(html).not.toContain("border-danger/30");
    expect(html).not.toContain("bg-danger/5");
  });
});