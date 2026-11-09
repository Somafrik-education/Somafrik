import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportCardPresentationTable } from "./ReportCardPresentationTable";
import type { ReportCardPresentation } from "../../lib/reportCardManagementApi";

const composite: ReportCardPresentation = {
  official: true,
  report_card_id: "rc-b",
  version: 1,
  verification_status: "ACTIVE",
  published_at: "2026-11-03",
  period_scope: "T1",
  style: "hierarchical",
  school: { name: "École Le Berceau de la Sagesse" },
  class_name: "6ème A",
  academic_year: "2026-2027",
  student: { code: "BSG-001", name: "Hakizimana Ama" },
  periods: [{ id: "T1", label: "Trimestre 1" }],
  components: [
    { id: "TJ", label: "TJ" },
    { id: "EX", label: "EX" },
  ],
  rows: [
    { subject_id: "FRANCAIS", parent_id: null, kind: "composite", level: 0, label: "Français", periods: { T1: { status: "INCOMPLETE", points: 114, max: 200, percentage: 57 } }, annual: null },
    {
      subject_id: "FR_ECRIT", parent_id: "FRANCAIS", kind: "simple", level: 1, label: "Écrit",
      periods: { T1: { status: "COMPLETE", points: 75, max: 100, percentage: 75, components: { TJ: { state: "NUMERIC", value: 30, max: 40 }, EX: { state: "NUMERIC", value: 45, max: 60 } } } }, annual: null,
    },
    {
      subject_id: "FR_DICTEE", parent_id: "FRANCAIS", kind: "simple", level: 1, label: "Dictée",
      periods: { T1: { status: "INCOMPLETE", points: 18, max: 50, percentage: 36, components: { TJ: { state: "NUMERIC", value: 18, max: 20 }, EX: { state: "MISSING", value: null, max: 30 } } } }, annual: null,
    },
  ],
  totals: { periods: { T1: { status: "INCOMPLETE", points: 114, max: 200, percentage: 57, rank: { value: null, reason: "INCOMPLETE" } } }, annual: null },
  status: "INCOMPLETE",
  cohort_size: 1,
  issues: [],
  decision: null,
  signatures: [],
};

describe("BULLETIN-UI-01 — tableau de présentation", () => {
  it("modèle B : matière principale (sous-total), sous-matières, maxima TJ/EX, note manquante signalée", () => {
    render(<ReportCardPresentationTable view={composite} />);
    const table = screen.getByTestId("report-card-presentation");
    expect(table).toHaveAttribute("data-style", "hierarchical");
    expect(table).toHaveTextContent("École Le Berceau de la Sagesse");
    expect(table).toHaveTextContent("Hakizimana Ama");
    const francais = table.querySelector('[data-subject="FRANCAIS"]');
    expect(francais).toHaveAttribute("data-kind", "composite");
    expect(francais).toHaveTextContent("114");
    expect(table.querySelector('[data-subject="FR_ECRIT"]')).toHaveTextContent("Écrit");
    expect(table.querySelector('[data-subject="FR_ECRIT"]')).toHaveTextContent("40");
    expect(table.querySelector('[data-subject="FR_DICTEE"] [data-missing]')).toHaveTextContent("Manquante");
    expect(screen.getByTestId("report-card-incomplete")).toBeInTheDocument();
    expect(screen.getByTestId("report-card-rank")).toHaveTextContent("Non classé");
    expect(screen.queryByText("Total annuel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-card-draft-banner")).not.toBeInTheDocument();
  });

  it("aperçu : bandeau BROUILLON obligatoire", () => {
    render(<ReportCardPresentationTable view={{ ...composite, official: false }} />);
    expect(screen.getByTestId("report-card-draft-banner")).toHaveTextContent("BROUILLON — document non officiel");
  });
});

describe("Notes en échec — rouge et souligné (aperçu Web et impression)", () => {
  const cell = (value: number | null, max: number, failing: boolean, state = "NUMERIC") => ({ state, value, max, failing });
  const view: ReportCardPresentation = {
    ...composite,
    rows: [
      {
        subject_id: "MATH", parent_id: null, kind: "simple", level: 0, label: "Mathématiques",
        periods: { T1: { status: "COMPLETE", points: 19, max: 40, percentage: 47.5, failing: true, components: { TJ: cell(9, 20, true), EX: cell(10, 20, false) } } },
        annual: null,
      },
      {
        subject_id: "SCI", parent_id: null, kind: "simple", level: 0, label: "Sciences",
        periods: { T1: { status: "COMPLETE", points: 9, max: 20, percentage: 45, failing: true, components: { TJ: cell(4, 10, true), EX: cell(5, 10, false) } } },
        annual: null,
      },
      {
        subject_id: "FR", parent_id: null, kind: "simple", level: 0, label: "Français",
        periods: { T1: { status: "INCOMPLETE", points: 14, max: 40, percentage: 35, failing: false, components: { TJ: cell(14, 20, false), EX: cell(null, 20, false, "MISSING") } } },
        annual: null,
      },
    ],
    totals: { periods: { T1: { status: "INCOMPLETE", points: 42, max: 100, percentage: 42, failing: false, rank: null } }, annual: null },
  };

  it("9/20 et 4/10 rouges et soulignés ; 10/20, 5/10, 14/20, maxima et note manquante non colorés", () => {
    render(<ReportCardPresentationTable view={view} />);
    const table = screen.getByTestId("report-card-presentation");
    const failing = [...table.querySelectorAll("[data-failing]")].map((node) => node.textContent);
    expect(failing).toEqual(["9", "19", "4", "9"]);
    for (const node of table.querySelectorAll("[data-failing]")) {
      expect(node.className).toMatch(/text-red-700/);
      expect(node.className).toMatch(/underline/);
    }
    const math = table.querySelector('[data-subject="MATH"]') as HTMLElement;
    const mathCells = [...math.querySelectorAll("td")];
    expect(mathCells.filter((td) => td.textContent === "20").every((td) => !td.hasAttribute("data-failing"))).toBe(true);
    expect(table.querySelector('[data-subject="FR"] [data-missing]')).not.toHaveAttribute("data-failing");
  });
});
