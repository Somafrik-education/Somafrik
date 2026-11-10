import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ demo: false }));
const switcherProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
// Identité stable : sinon chaque render relance l’hydratation Démo et annule le précédent effet.
const ensureDomains = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const permissionCtx = vi.hoisted(() => ({ user: null as unknown, rolePermissions: {}, permissionsReady: true }));

vi.mock("../lib/featureFlags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/featureFlags")>();
  return {
    ...actual,
    get demoRuntimeEnabled() {
      return flags.demo;
    },
  };
});

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "Admin School",
  schoolCode: "SCH-A",
  schoolId: "22222222-2222-4222-8222-222222222222",
  permissions: ["ALL_PRIVILEGES"],
};

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ session: { accessToken: "token", user } }),
}));

const state = {
  schools: [], users: [], countries: [], contacts: [], relations: [], subscriptions: [], notifications: [],
  students: [], teachers: [], classes: [], courses: [], assignments: [], courseSchedules: [], payments: [],
  presences: [], notes: [], evaluations: [], exams: [], bulletins: [], documents: [], announcements: [],
  messages: [], paymentStatuses: [], feeGrids: [], schoolFeeItems: [], studentFees: [], feeTariffHistory: [],
  rolePermissions: {}, academicConfigs: {}, dashboardChartConfig: { platform: {}, establishment: {} }, auditLog: [],
};

vi.mock("../context/DataContext", () => ({
  useData: () => ({ state, ensureDomains }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ scopedUser: user, activeSchoolCode: "SCH-A" }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => permissionCtx,
}));

vi.mock("../lib/useSchoolDashboardKpis", () => ({
  useSchoolDashboardKpis: () => ({ payload: null, error: false }),
}));

vi.mock("../lib/internalNotificationsRead", () => ({
  useInternalNotificationsUnreadCount: () => 0,
}));

vi.mock("../lib/schoolSetupGuidedApi", () => ({
  schoolSetupGuidedApi: { get: () => Promise.resolve(null) },
}));

vi.mock("../components/dashboard/EstablishmentDashboardLayout", () => ({
  EstablishmentDashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../components/dashboard/EstablishmentChartSwitcher", () => ({
  EstablishmentChartSwitcher: (props: Record<string, unknown>) => {
    switcherProps.push(props);
    return <div data-testid="chart-switcher" />;
  },
}));

import { OverviewPage } from "./OverviewPage";

async function renderPage() {
  render(
    <MemoryRouter>
      <OverviewPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId("chart-switcher")).toBeTruthy());
  return switcherProps[switcherProps.length - 1];
}

describe("OverviewPage — période serveur", () => {
  beforeEach(() => {
    permissionCtx.user = user;
    ensureDomains.mockClear();
    switcherProps.length = 0;
  });

  it("en Démo, les graphiques gardent le filtrage de période local", async () => {
    flags.demo = true;
    const props = await renderPage();
    expect(props.onServerPeriodChange).toBeUndefined();
    expect(props.serverPeriod).toBeUndefined();
  });

  it("avec les KPI serveur, la période est confiée au serveur", async () => {
    flags.demo = false;
    const props = await renderPage();
    expect(typeof props.onServerPeriodChange).toBe("function");
    expect(props.serverPeriod).toBe("monthly");
  });
});
