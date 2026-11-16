import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const logo = vi.hoisted(() => vi.fn());
vi.mock("../../lib/reportCardManagementApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/reportCardManagementApi")>();
  return { ...actual, reportCardManagementApi: { ...actual.reportCardManagementApi, logo } };
});

import { ReportCardPresentationTable } from "./ReportCardPresentationTable";
import type { ReportCardPresentation } from "../../lib/reportCardManagementApi";

const base: ReportCardPresentation = {
  official: true,
  report_card_id: "rc-1",
  version: 1,
  verification_status: "ACTIVE",
  published_at: "2026-11-04",
  period_scope: "T1",
  style: "simple",
  school: { name: "Lycée Lumière" },
  class_name: "6ème A",
  academic_year: "2026-2027",
  student: { code: "S-1", name: "Ama Mukendi" },
  periods: [{ id: "T1", label: "Trimestre 1" }],
  components: [{ id: "TJ", label: "TJ" }],
  rows: [],
  totals: { periods: { T1: null }, annual: null },
  status: "COMPLETE",
  cohort_size: 1,
  issues: [],
  decision: null,
  signatures: ["Le titulaire", "Le parent"],
  header: {
    layout: "logo_left",
    title: "Bulletin scolaire",
    lines: ["République démocratique du Congo"],
    items: [
      { id: "establishment_name", label: "Établissement", value: "Lycée Lumière" },
      { id: "period", label: "Période", value: "Trimestre 1" },
    ],
    logo: { sha256: "a".repeat(64), media_type: "image/png" },
  },
};

afterEach(() => logo.mockReset());

describe("BULLETIN-CLASSE-01 / L3 — en-tête du bulletin", () => {
  it("bulletin publié : logo FIGÉ chargé par requête authentifiée, éléments choisis, titre, lignes, signatures", async () => {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:figé");
    globalThis.URL.revokeObjectURL = vi.fn();
    logo.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    render(<ReportCardPresentationTable view={base} currentLogoSrc="https://api/schools/X/logo" />);
    expect(screen.getByTestId("report-card-header-title")).toHaveTextContent("Bulletin scolaire");
    expect(screen.getByTestId("report-card-header-title")).toHaveClass("text-left");
    expect(screen.getByTestId("report-card-header")).toHaveTextContent("République démocratique du Congo");
    const identity = screen.getByTestId("report-card-identity");
    expect(identity).toHaveTextContent("Période");
    expect(identity).not.toHaveTextContent("Matricule");
    await waitFor(() => expect(screen.getByTestId("report-card-header-logo")).toHaveAttribute("src", "blob:figé"));
    expect(logo).toHaveBeenCalledWith("rc-1", 1);
    expect(screen.getByTestId("report-card-signatures")).toHaveTextContent("Le titulaire");
  });

  it("vérification QR publique : logo figé vérifié, sans appel d'API authentifiée", async () => {
    const png = "data:image/png;base64,aGVsbG8=";
    render(<ReportCardPresentationTable view={base} verifiedLogoDataUri={png} />);
    await waitFor(() => expect(screen.getByTestId("report-card-header-logo")).toHaveAttribute("src", png));
    expect(logo).not.toHaveBeenCalled();
    expect(screen.getByTestId("report-card-header-title")).toHaveTextContent("Bulletin scolaire");
  });

  it("titre centré indépendamment du logo à gauche", () => {
    logo.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    render(<ReportCardPresentationTable view={{ ...base, header: { ...base.header!, title_align: "center" } }} />);
    expect(screen.getByTestId("report-card-header-title")).toHaveClass("text-center");
  });

  it("titre à gauche malgré logo centré", () => {
    logo.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    render(<ReportCardPresentationTable view={{ ...base, header: { ...base.header!, layout: "logo_center", title_align: "left" } }} />);
    expect(screen.getByTestId("report-card-header-title")).toHaveClass("text-left");
  });

  it("brouillon : logo ACTUEL de l'établissement, aucune requête de logo figé", async () => {
    render(<ReportCardPresentationTable view={{ ...base, official: false, report_card_id: null, version: null }} currentLogoSrc="https://api/schools/X/logo" />);
    await waitFor(() => expect(screen.getByTestId("report-card-header-logo")).toHaveAttribute("src", "https://api/schools/X/logo"));
    expect(logo).not.toHaveBeenCalled();
    expect(screen.getByTestId("report-card-draft-banner")).toBeInTheDocument();
  });

  it("sans en-tête configuré : identité habituelle (rendu inchangé)", () => {
    const legacy = { ...base };
    delete legacy.header;
    render(<ReportCardPresentationTable view={legacy} />);
    expect(screen.queryByTestId("report-card-header")).not.toBeInTheDocument();
    expect(screen.getByTestId("report-card-identity")).toHaveTextContent("Matricule");
  });
});
