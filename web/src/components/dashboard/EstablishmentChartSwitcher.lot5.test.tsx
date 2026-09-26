import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EstablishmentChart } from "../../lib/dashboardCharts";
import type { DashboardPeriodContext } from "../../lib/dashboardChartPeriod";

vi.mock("../charts/DashboardChartGrid", () => ({
  DashboardChartGrid: ({ charts }: { charts: EstablishmentChart[] }) => (
    <div data-testid="central-chart">{charts.map((chart) => chart.title).join(", ")}</div>
  ),
}));

import { EstablishmentChartSwitcher } from "./EstablishmentChartSwitcher";

const chart = (id: string, title: string): EstablishmentChart =>
  ({ id, title, type: "bar", data: [{ name: "Test", value: 1 }] }) as EstablishmentChart;
const periodContext = {} as DashboardPeriodContext;

describe("LOT 5 — central chart switcher", () => {
  it("switches a single authorized chart without navigation", async () => {
    const user = userEvent.setup();
    render(
      <EstablishmentChartSwitcher
        charts={[chart("classes", "Classes"), chart("presence-rate", "Présences")]}
        periodContext={periodContext}
        showTypeBadge={false}
      />,
    );
    expect(screen.getByTestId("central-chart")).toHaveTextContent("Classes");
    await user.selectOptions(screen.getByRole("combobox", { name: "Choisir le graphique métier" }), "presence-rate");
    expect(screen.getByTestId("central-chart")).toHaveTextContent("Présences");
    expect(screen.getByTestId("central-chart")).not.toHaveTextContent("Classes");
  });

  it("does not retain a revoked chart after role or school changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <EstablishmentChartSwitcher
        charts={[chart("classes", "Classes"), chart("presence-rate", "Présences")]}
        periodContext={periodContext}
        showTypeBadge={false}
      />,
    );
    await user.selectOptions(screen.getByRole("combobox"), "presence-rate");
    rerender(
      <EstablishmentChartSwitcher charts={[chart("classes", "Classes")]} periodContext={periodContext} showTypeBadge={false} />,
    );
    expect(screen.getByTestId("central-chart")).toHaveTextContent("Classes");
    expect(screen.queryByRole("option", { name: "Présences" })).not.toBeInTheDocument();
    rerender(<EstablishmentChartSwitcher charts={[]} periodContext={periodContext} showTypeBadge={false} />);
    expect(screen.getByText(/Aucun graphique disponible/)).toBeInTheDocument();
  });
});
