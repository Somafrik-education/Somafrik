import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const applySpy = vi.hoisted(() =>
  vi.fn((chart: { title: string }, period: string) => ({ ...chart, title: `${chart.title} · ${period}` })),
);

vi.mock("../../lib/dashboardChartPeriod", () => ({
  applyPeriodToDashboardChart: applySpy,
}));

vi.mock("./DashboardCharts", () => ({
  ChartPanel: ({ title, actions, children }: { title: string; actions: React.ReactNode; children: React.ReactNode }) => (
    <section>
      <h3>{title}</h3>
      {actions}
      {children}
    </section>
  ),
  renderConfiguredChart: () => null,
}));

import { DashboardChartGrid } from "./DashboardChartGrid";

const chart = { id: "kpi-test-scolarite", title: "Scolarité", type: "bar", data: [] } as never;
const context = { user: null, state: {}, scope: "establishment" } as never;

function periodSelect() {
  return screen.getByLabelText(/Période pour Scolarité/) as HTMLSelectElement;
}

describe("DashboardChartGrid — période locale ou serveur", () => {
  beforeEach(() => {
    applySpy.mockClear();
    window.localStorage.clear();
  });

  it("sans KPI serveur, changer la période refiltre les données locales", () => {
    render(<DashboardChartGrid charts={[chart]} periodContext={context} orderScope="establishment" orderUserKey="u" />);
    fireEvent.change(periodSelect(), { target: { value: "weekly" } });
    expect(applySpy).toHaveBeenCalledWith(chart, "weekly", context);
    expect(screen.getByText("Scolarité · weekly")).toBeTruthy();
  });

  it("avec KPI serveur, la période part au serveur sans refiltrer localement", () => {
    const onServerPeriodChange = vi.fn();
    render(
      <DashboardChartGrid
        charts={[chart]}
        periodContext={context}
        orderScope="establishment"
        orderUserKey="u"
        serverPeriod="monthly"
        onServerPeriodChange={onServerPeriodChange}
      />,
    );
    fireEvent.change(periodSelect(), { target: { value: "annual" } });
    expect(onServerPeriodChange).toHaveBeenCalledWith("annual");
    expect(applySpy).not.toHaveBeenCalled();
    expect(screen.getByText("Scolarité")).toBeTruthy();
  });
});
