import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const parentApi = vi.hoisted(() => ({
  listPublications: vi.fn(),
  getSnapshot: vi.fn(),
  listHistory: vi.fn(),
  pdf: vi.fn(),
}));
const presentation = vi.hoisted(() => vi.fn());

vi.mock("../lib/parentReportCardApi", () => ({ parentReportCardApi: parentApi }));
vi.mock("../lib/reportCardManagementApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/reportCardManagementApi")>();
  return { ...actual, reportCardManagementApi: { ...actual.reportCardManagementApi, presentation: (...a: unknown[]) => presentation(...a) } };
});
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "parent-1",
        role: "Parent",
        children: [{ id: "COL-001", matricule: "COL-001", name: "Ndayishimiye Ama", studentCode: "COL-001" }],
      },
    },
  }),
}));
vi.mock("../context/DataContext", () => ({ useData: () => ({ state: { students: [] } }) }));

describe("BULLETIN-UI-01 — parent : résultats du bulletin officiel publié", () => {
  beforeEach(() => {
    Object.values(parentApi).forEach((fn) => fn.mockReset());
    presentation.mockReset();
    parentApi.listPublications.mockResolvedValue([{ report_card_id: "rc-1", published_snapshot_version: 1, verification_status: "ACTIVE" }]);
    parentApi.getSnapshot.mockResolvedValue({
      payload: { report_card_id: "rc-1", published_snapshot_version: 1, published_at: "2026-11-03T08:00:00Z", students: [{ student_id: "COL-001", cells: [], slots: [] }] },
      template: null,
    });
    parentApi.listHistory.mockResolvedValue([{ report_card_id: "rc-1", published_snapshot_version: 1, verification_status: "ACTIVE" }]);
    presentation.mockResolvedValue({
      verificationStatus: "ACTIVE",
      presentation: [
        {
          official: true,
          report_card_id: "rc-1",
          version: 1,
          verification_status: "ACTIVE",
          published_at: "2026-11-03",
          period_scope: "ANNUAL",
          style: "simple",
          school: { name: "Lycée La Colombière" },
          class_name: "6ème A",
          academic_year: "2026-2027",
          student: { code: "COL-001", name: "Ndayishimiye Ama" },
          periods: [{ id: "T1", label: "Trimestre 1" }],
          components: [{ id: "TJ", label: "TJ" }],
          rows: [{ subject_id: "GEO", parent_id: null, kind: "simple", level: 0, label: "Géographie", periods: { T1: { status: "COMPLETE", points: 24, max: 30, percentage: 80, components: { TJ: { state: "NUMERIC", value: 24, max: 30 } } } }, annual: null }],
          totals: { periods: { T1: { status: "COMPLETE", points: 24, max: 30, percentage: 80, rank: { value: 1, ranked: 2 } } }, annual: null },
          status: "COMPLETE",
          cohort_size: 2,
          issues: [],
          decision: null,
          signatures: [],
        },
      ],
    });
  });

  it("affiche à la demande établissement, classe, année et résultats du bulletin publié — jamais un brouillon", async () => {
    const { ParentReportCardsPage } = await import("./ParentReportCardsPage");
    render(
      <MemoryRouter>
        <ParentReportCardsPage />
      </MemoryRouter>,
    );
    const button = await screen.findByText("Afficher les résultats");
    expect(presentation).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(presentation).toHaveBeenCalledWith("rc-1", 1));
    const table = await screen.findByTestId("report-card-presentation");
    expect(table).toHaveAttribute("data-official", "true");
    expect(table).toHaveTextContent("Lycée La Colombière");
    expect(table).toHaveTextContent("6ème A");
    expect(table).toHaveTextContent("2026-2027");
    expect(table).toHaveTextContent("Géographie");
    expect(screen.queryByTestId("report-card-draft-banner")).not.toBeInTheDocument();
    expect(screen.getByText("Télécharger le PDF")).toBeInTheDocument();
  });
});
