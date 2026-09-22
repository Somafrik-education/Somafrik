import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "../context/AuthContext";
import { ReportCardStaffRoute, ReportCardsEntryPage } from "./ReportCardsEntryPage";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("./EntityPage", () => ({
  EntityPage: () => <div data-testid="staff-bulletins">staff</div>,
}));

vi.mock("./ParentReportCardsPage", () => ({
  ParentReportCardsPage: () => <div data-testid="parent-bulletins">parent</div>,
}));

const mockedUseAuth = vi.mocked(useAuth);

function auth(role: string) {
  mockedUseAuth.mockReturnValue({
    session: { user: { id: "user-1", role } },
  } as ReturnType<typeof useAuth>);
}

describe("P1-09 — routage Bulletins Parent", () => {
  beforeEach(() => {
    mockedUseAuth.mockReset();
  });

  it("route /bulletins vers la page Parent dédiée", () => {
    auth("parent_student");
    render(
      <MemoryRouter>
        <ReportCardsEntryPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("parent-bulletins")).toBeInTheDocument();
    expect(screen.queryByTestId("staff-bulletins")).not.toBeInTheDocument();
  });

  it("préserve EntityPage bulletins pour le staff", () => {
    auth("Admin School");
    render(
      <MemoryRouter>
        <ReportCardsEntryPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("staff-bulletins")).toBeInTheDocument();
    expect(screen.queryByTestId("parent-bulletins")).not.toBeInTheDocument();
  });

  it("redirige un Parent hors d'une route staff même avec accès direct", () => {
    auth("Parent");
    render(
      <MemoryRouter initialEntries={["/bulletins/historique"]}>
        <Routes>
          <Route
            path="/bulletins/historique"
            element={
              <ReportCardStaffRoute>
                <div data-testid="staff-history">historique staff</div>
              </ReportCardStaffRoute>
            }
          />
          <Route path="/bulletins" element={<div data-testid="parent-target">bulletins</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("staff-history")).not.toBeInTheDocument();
    expect(screen.getByTestId("parent-target")).toBeInTheDocument();
  });

  it("laisse les routes staff intactes pour un Admin School", () => {
    auth("Admin School");
    render(
      <MemoryRouter>
        <ReportCardStaffRoute>
          <div data-testid="staff-history">historique staff</div>
        </ReportCardStaffRoute>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("staff-history")).toBeInTheDocument();
  });
});
