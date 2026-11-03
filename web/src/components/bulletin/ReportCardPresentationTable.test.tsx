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
