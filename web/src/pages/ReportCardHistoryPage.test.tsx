import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const authMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));
vi.mock("../context/AuthContext", () => authMocks);

const apiMocks = vi.hoisted(() => ({
  listHistory: vi.fn(),
  previewReissue: vi.fn(),
  reissue: vi.fn(),
  correct: vi.fn(),
  revoke: vi.fn(),
  getVersion: vi.fn(),
}));
vi.mock("../lib/reportCardHistoryApi", () => ({
  reportCardHistoryApi: apiMocks,
}));

import { ReportCardHistoryPage } from "./ReportCardHistoryPage";

describe("BULLETIN-REEMISSION-01 / PR2 — confirmation explicite Web", () => {
  beforeEach(() => {
    authMocks.useAuth.mockReturnValue({ session: { user: { role: "Directeur", permissions: ["Bulletins:UPDATE"] } }, permissionsReady: true, permissionsBootstrap: "ready" });
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.listHistory.mockResolvedValue({
      ok: true,
      versions: [{
        report_card_id: "rc-1",
        published_snapshot_version: 1,
        verification_status: "ACTIVE",
      }],
    });
    apiMocks.previewReissue.mockResolvedValue({
      ok: true,
      official: false,
      report_card_id: "rc-1",
      source_version: 1,
      proposed_version: 2,
      student_id: "STU-1",
      header: { title: "Bulletin scolaire", lines: ["République Démocratique du Congo"] },
      signatures: ["Directeur"],
      expected_draft_sha256: "draft-hash",
      changes: { template: true, identity: true, grades: false },
    });
    apiMocks.reissue.mockResolvedValue({ ok: true, status: "REISSUED", published_snapshot_version: 2, public_id: "new-public-id" });
  });

  it("charge automatiquement la V1 depuis la gestion sans action de publication", async () => {
    const previousUrl = window.location.href;
    try {
      window.history.replaceState({}, "", "/bulletins/historique?reportCardId=rc-1");
      render(<ReportCardHistoryPage />);
      expect(screen.getByLabelText("Identifiant bulletin")).toHaveValue("rc-1");
      await waitFor(() => expect(apiMocks.listHistory).toHaveBeenCalledWith("rc-1"));
      expect(await screen.findByText("v1")).toBeInTheDocument();
      expect(apiMocks.previewReissue).not.toHaveBeenCalled();
      expect(apiMocks.reissue).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState({}, "", previousUrl);
    }
  });

  it("affiche la raison métier d'un refus de prévisualisation", async () => {
    const { ApiError } = await import("../api/client");
    apiMocks.previewReissue.mockRejectedValue(new ApiError("message interne", 409, "REISSUE_GRADES_CHANGED"));
    render(<ReportCardHistoryPage />);
    fireEvent.change(screen.getByLabelText("Identifiant bulletin"), { target: { value: "rc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Charger l’historique" }));
    fireEvent.click(await screen.findByRole("button", { name: "Réémettre avec le modèle actif" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("notes ou les résultats ont changé");
    expect(screen.getByRole("alert")).not.toHaveTextContent("message interne");
    expect(apiMocks.reissue).not.toHaveBeenCalled();
  });

  it("ne publie pas en consultant un historique ou en ouvrant un aperçu ; motif et confirmation requis", async () => {
    render(<ReportCardHistoryPage />);
    fireEvent.change(screen.getByLabelText("Identifiant bulletin"), { target: { value: "rc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Charger l’historique" }));
    const prepare = await screen.findByRole("button", { name: "Réémettre avec le modèle actif" });
    fireEvent.click(prepare);
    expect(await screen.findByTestId("report-card-reissue-header")).toHaveTextContent("Bulletin scolaire");
    expect(screen.getByText(/Les notes, les maxima et les résultats doivent rester inchangés/)).toBeInTheDocument();
    expect(apiMocks.reissue).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Publier la nouvelle version" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motif de réémission"), { target: { value: "En-tête validé" } });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Je confirme la création/));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(apiMocks.reissue).toHaveBeenCalledTimes(1));
    expect(apiMocks.reissue).toHaveBeenCalledWith("rc-1", expect.objectContaining({
      sourceVersion: 1,
      expectedDraftSha256: "draft-hash",
      reason: "En-tête validé",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Version v2 créée");
  });

  it("cache la réémission si la permission effective est absente", async () => {
    authMocks.useAuth.mockReturnValue({ session: { user: { role: "Directeur", permissions: ["Bulletins:READ"] } }, permissionsReady: true, permissionsBootstrap: "ready" });
    render(<ReportCardHistoryPage />);
    fireEvent.change(screen.getByLabelText("Identifiant bulletin"), { target: { value: "rc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Charger l’historique" }));
    await screen.findByText("v1");
    expect(screen.queryByRole("button", { name: "Réémettre avec le modèle actif" })).not.toBeInTheDocument();
    expect(apiMocks.previewReissue).not.toHaveBeenCalled();
    expect(apiMocks.reissue).not.toHaveBeenCalled();
  });

  it("cache la réémission pendant le chargement des permissions", async () => {
    authMocks.useAuth.mockReturnValue({ session: { user: { role: "Directeur", permissions: ["Bulletins:UPDATE"] } }, permissionsReady: false, permissionsBootstrap: "loading" });
    render(<ReportCardHistoryPage />);
    fireEvent.change(screen.getByLabelText("Identifiant bulletin"), { target: { value: "rc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Charger l’historique" }));
    await screen.findByText("v1");
    expect(screen.queryByRole("button", { name: "Réémettre avec le modèle actif" })).not.toBeInTheDocument();
    expect(apiMocks.reissue).not.toHaveBeenCalled();
  });

  it("ne propose pas de réémission d'une version révoquée", async () => {
    apiMocks.listHistory.mockResolvedValue({ ok: true, versions: [{ report_card_id: "rc-1", published_snapshot_version: 1, verification_status: "REVOKED" }] });
    render(<ReportCardHistoryPage />);
    fireEvent.change(screen.getByLabelText("Identifiant bulletin"), { target: { value: "rc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Charger l’historique" }));
    await screen.findByText("v1");
    expect(screen.queryByRole("button", { name: "Réémettre avec le modèle actif" })).not.toBeInTheDocument();
    expect(apiMocks.previewReissue).not.toHaveBeenCalled();
  });

  it("bloque la publication si les droits sont retirés après le préflight", async () => {
    const { rerender } = render(<ReportCardHistoryPage />);
    fireEvent.change(screen.getByLabelText("Identifiant bulletin"), { target: { value: "rc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Charger l’historique" }));
    fireEvent.click(await screen.findByRole("button", { name: "Réémettre avec le modèle actif" }));
    await screen.findByTestId("report-card-reissue-header");
    authMocks.useAuth.mockReturnValue({ session: { user: { role: "Directeur", permissions: [] } }, permissionsReady: true, permissionsBootstrap: "ready" });
    rerender(<ReportCardHistoryPage />);
    expect(screen.queryByRole("button", { name: "Publier la nouvelle version" })).not.toBeInTheDocument();
    expect(apiMocks.reissue).not.toHaveBeenCalled();
  });
});
