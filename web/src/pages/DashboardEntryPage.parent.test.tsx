import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardEntryPage } from "./DashboardEntryPage";
import { useAuth } from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("./OverviewPage", () => ({
  OverviewPage: () => <div data-testid="overview-dashboard">overview</div>,
}));

vi.mock("./ParentDashboardPage", () => ({
  ParentDashboardPage: () => <div data-testid="parent-dashboard-mock">parent</div>,
}));

const mockedUseAuth = vi.mocked(useAuth);

describe("DashboardEntryPage — routage Parent", () => {
  beforeEach(() => {
    mockedUseAuth.mockReset();
  });

  it("affiche le dashboard Parent pour roleKeys PARENT", () => {
    mockedUseAuth.mockReturnValue({
      session: {
        user: { id: "parent-a", role: "Parent", roleKeys: ["PARENT"] },
      },
    } as ReturnType<typeof useAuth>);

    render(<DashboardEntryPage />);

    expect(screen.getByTestId("parent-dashboard-mock")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-dashboard")).not.toBeInTheDocument();
  });

  it("conserve OverviewPage pour un rôle staff", () => {
    mockedUseAuth.mockReturnValue({
      session: {
        user: { id: "admin-a", role: "Admin établissement", roleKeys: ["SCHOOL_ADMIN"] },
      },
    } as ReturnType<typeof useAuth>);

    render(<DashboardEntryPage />);

    expect(screen.getByTestId("overview-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("parent-dashboard-mock")).not.toBeInTheDocument();
  });
});
