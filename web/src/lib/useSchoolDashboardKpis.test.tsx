import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_KPI_REFRESH_EVENT, DASHBOARD_SYNC_EVENT } from "./dashboardSync";
import { useSchoolDashboardKpis } from "./useSchoolDashboardKpis";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../api/client", () => ({ api: { get } }));

const payload = {
  schoolId: "11111111-1111-4111-8111-111111111111",
  generatedAt: "2026-11-04T10:00:00.000Z",
  period: "monthly",
  periodLabel: "Mensuel · 01/11/2026 – 04/11/2026",
  timeZone: "Africa/Kinshasa",
  cards: {
    students: 4,
    teachers: 1,
    classes: 2,
    revenue: { display: "97 CDF", currency: "CDF", amount: 97 },
    levels: [{ name: "6e", value: 2 }],
    attendance: { label: "Présence du jour", value: "100 %", rate: 100, expected: 2, attended: 2, recorded: 2 },
    paymentRate: { label: "Taux de paiement", value: "53 %", rate: 53, expectedAmount: 170, collectedAmount: 90 },
  },
  series: {
    activeStudents: 2,
    periodClasses: 2,
    teachers: 1,
    notes: 1,
    exams: 1,
    bulletins: 1,
    pendingBulletins: 1,
    documents: 1,
    presences: 4,
    activeUsers: 1,
    announcements: 1,
    presence: { present: 1, absent: 1, late: 1, justified: 1, total: 4, rate: 50 },
    paymentStatus: [{ name: "Payé", value: 2 }],
    paymentAmounts: [{ name: "Payé", value: 90 }],
    classSizes: [{ name: "6e A", value: 1 }],
    notesBySubject: [{ name: "Mathématiques", value: 1 }],
  },
};

function Probe({ period = "monthly" }: { period?: "monthly" | "weekly" }) {
  const kpi = useSchoolDashboardKpis(true, period);
  return (
    <p>
      <span>{kpi.payload?.cards.students ?? "vide"}</span>
      <span>{kpi.error ? "erreur" : "ok"}</span>
    </p>
  );
}

describe("chargement léger des KPI", () => {
  afterEach(() => {
    vi.useRealTimers();
    get.mockReset();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  it("affiche les agrégats et conserve la dernière valeur si le réseau échoue", async () => {
    get.mockResolvedValueOnce(payload);
    render(<Probe />);
    expect(await screen.findByText("4")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/dashboard/school-kpis?period=monthly");
    get.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      window.dispatchEvent(new Event(DASHBOARD_SYNC_EVENT));
    });
    expect(await screen.findByText("erreur")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("n'interroge pas l'API tant que l'onglet est masqué", async () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    get.mockResolvedValue(payload);
    render(<Probe />);
    await act(async () => {
      window.dispatchEvent(new Event(DASHBOARD_KPI_REFRESH_EVENT));
    });
    expect(get).toHaveBeenCalledTimes(1);
    get.mockClear();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("rejoue une mutation différée dès le retour au premier plan", async () => {
    get.mockResolvedValue(payload);
    render(<Probe />);
    expect(await screen.findByText("4")).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event(DASHBOARD_SYNC_EVENT));
    });
    expect(get).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("ignore une réponse périmée après un changement de période", async () => {
    let resolveMonthly: (value: unknown) => void = () => undefined;
    get.mockImplementationOnce(() => new Promise((resolve) => { resolveMonthly = resolve; }));
    get.mockResolvedValueOnce({ ...payload, period: "weekly", cards: { ...payload.cards, students: 9 } });
    const view = render(<Probe />);
    view.rerender(<Probe period="weekly" />);
    expect(await screen.findByText("9")).toBeInTheDocument();
    await act(async () => {
      resolveMonthly(payload);
    });
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.queryByText("4")).not.toBeInTheDocument();
  });
});
