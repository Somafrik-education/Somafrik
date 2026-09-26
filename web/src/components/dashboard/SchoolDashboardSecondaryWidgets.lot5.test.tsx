import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TodayPresenceKpi } from "../../lib/presenceMetrics";

vi.mock("../charts/DashboardCharts", () => ({
  DonutChart: ({ data }: { data: Array<{ name: string; value: number }> }) => (
    <div data-testid="level-donut">{data.map((row) => `${row.name}:${row.value}`).join(",")}</div>
  ),
}));

import { SchoolDashboardSecondaryWidgets } from "./SchoolDashboardSecondaryWidgets";

const attendance: TodayPresenceKpi = {
  label: "Présence du jour", value: "—", rate: null, expected: 2, recorded: 1, attended: 1,
};
const levels = [{ name: "Primaire", value: 2 }];

describe("LOT 5 — secondary dashboard widgets and RBAC", () => {
  it("does not render unauthorized level or attendance metrics", () => {
    const { container } = render(
      <SchoolDashboardSecondaryWidgets levels={levels} attendance={attendance} showLevels={false} showAttendance={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows levels without leaking attendance to an Élèves-only role", () => {
    render(<SchoolDashboardSecondaryWidgets levels={levels} attendance={attendance} showLevels showAttendance={false} />);
    expect(screen.getByTestId("level-donut")).toHaveTextContent("Primaire:2");
    expect(screen.queryByText("Présence du jour")).not.toBeInTheDocument();
  });

  it("shows incomplete roll call without inventing a rate", () => {
    render(<SchoolDashboardSecondaryWidgets levels={levels} attendance={attendance} showLevels={false} showAttendance />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/Appel incomplet/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("level-donut")).not.toBeInTheDocument();
  });

  it("shows rate and accessible progress when roll call is complete", () => {
    render(<SchoolDashboardSecondaryWidgets levels={levels} attendance={{ ...attendance, value: "50 %", rate: 50, recorded: 2 }} showLevels={false} showAttendance />);
    expect(screen.getByText("50 %")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Taux de présence du jour" })).toHaveAttribute("aria-valuenow", "50");
  });
});
