import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StudentDocumentsTab } from "./StudentDocumentsTab";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

// Le rendu Documents consomme les droits réels de session : en test, fournir
// un contexte établissement explicite, sans fabriquer un AuthProvider global.
vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: { role: "Admin School" } }),
  useFeaturePermissions: () => ({
    canRead: true, canCreate: false, canUpdate: false, canDelete: false, canSuspend: false,
  }),
}));
vi.mock("../../lib/studentAdministrativeDocumentsApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/studentAdministrativeDocumentsApi")>();
  return {
    ...original,
    studentAdministrativeDocumentsApi: {
      ...original.studentAdministrativeDocumentsApi,
      list: mocks.list,
    },
  };
});

const workspace = { studentId: "CD-TEST-01" } as StudentWorkspaceViewModel;

describe("FICHE-DOC-UI — documents sans faux boutons ni bandeaux", () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.list.mockResolvedValue({ documents: [] });
  });
  afterEach(cleanup);

  it("charge les pièces PostgreSQL, puis conserve les indicateurs et exigences sans doublons", async () => {
    render(<StudentDocumentsTab workspace={workspace} />);
    expect(screen.getByText("Chargement des documents…")).toBeTruthy();

    await screen.findByTestId("student-documents-summary");
    expect(screen.getByTestId("student-documents-list")).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledWith("CD-TEST-01");
    const html = document.body.innerHTML;
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

  it("signale une panne de lecture et ne la transforme pas en dossier sans pièces", async () => {
    mocks.list.mockRejectedValueOnce(new Error("API documentaire indisponible"));
    render(<StudentDocumentsTab workspace={workspace} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("API documentaire indisponible"));
    expect(screen.queryByTestId("student-documents-list")).toBeNull();
    expect(screen.queryByTestId("student-documents-summary")).toBeNull();
    expect(screen.getByText("Réessayer")).toBeTruthy();
  });
});
