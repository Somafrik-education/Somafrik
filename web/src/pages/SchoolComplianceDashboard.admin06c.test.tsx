import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SchoolAuditSummary } from "../lib/schoolAuditApi";

const {
  useAuthMock,
  listSchoolErasureRequestsMock,
  executeSchoolErasureRequestMock,
  exportSchoolDataMock,
  listSchoolAuditSummariesMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  listSchoolErasureRequestsMock: vi.fn(),
  executeSchoolErasureRequestMock: vi.fn(),
  exportSchoolDataMock: vi.fn(),
  listSchoolAuditSummariesMock: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../lib/schoolComplianceApi", () => ({
  listSchoolErasureRequests: listSchoolErasureRequestsMock,
  executeSchoolErasureRequest: executeSchoolErasureRequestMock,
  exportSchoolData: exportSchoolDataMock,
}));

vi.mock("../lib/schoolAuditApi", () => ({
  listSchoolAuditSummaries: listSchoolAuditSummariesMock,
}));

import { SchoolComplianceDashboard } from "./SchoolComplianceDashboard";
import { SCHOOL_ADMIN_ROLE } from "../lib/orgHierarchy";

function auth(permissions: string[], role = SCHOOL_ADMIN_ROLE) {
  useAuthMock.mockReturnValue({
    session: {
      user: {
        id: "admin-a",
        role,
        permissions,
        schoolCode: "CD-2026-0001",
      },
    },
    permissionsReady: true,
  });
}

function auditRow(overrides: Partial<SchoolAuditSummary> = {}): SchoolAuditSummary {
  return {
    id: "AUD-1",
    action: "user_update",
    entityType: "user",
    entityId: "USER-A",
    actor: "Admin Alpha",
    createdAt: "2026-10-03T12:00:00.000Z",
    ...overrides,
  };
}

describe("SchoolComplianceDashboard ADMIN-06C", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    listSchoolErasureRequestsMock.mockReset();
    executeSchoolErasureRequestMock.mockReset();
    exportSchoolDataMock.mockReset();
    listSchoolAuditSummariesMock.mockReset();
    listSchoolErasureRequestsMock.mockResolvedValue([]);
    listSchoolAuditSummariesMock.mockResolvedValue([]);
  });

  it("C06C-20 UI sans Audit:READ ne fetch pas /audit", () => {
    auth(["Rapports:READ"]);
    render(<SchoolComplianceDashboard />);
    expect(listSchoolAuditSummariesMock).not.toHaveBeenCalled();
    expect(screen.getByText(/pas le droit de consulter le journal d’audit/i)).toBeInTheDocument();
  });

  it("C06C-23 Rapports:READ seul n’accorde pas Audit", () => {
    auth(["Rapports:READ"]);
    render(<SchoolComplianceDashboard />);
    expect(listSchoolAuditSummariesMock).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("privacy_erasure")).not.toBeInTheDocument();
  });

  it("C06C-21 UI SCHOOL_ADMIN + Audit:READ fetch /audit", async () => {
    auth(["Rapports:READ", "Audit:READ"]);
    listSchoolAuditSummariesMock.mockResolvedValue([auditRow()]);
    render(<SchoolComplianceDashboard />);
    await waitFor(() => expect(listSchoolAuditSummariesMock).toHaveBeenCalledTimes(1));
    expect(listSchoolAuditSummariesMock).toHaveBeenCalledWith({
      action: undefined,
      limit: 50,
    });
    expect(await screen.findByText("Admin Alpha")).toBeInTheDocument();
    expect(screen.getByText("user_update")).toBeInTheDocument();
    expect(screen.queryByText(/oldValue|newValue|ipAddress|userAgent/i)).not.toBeInTheDocument();
  });

  it("C06C-22 loading / error / empty / success", async () => {
    auth(["Rapports:READ", "Audit:READ"]);
    let resolveRows: (value: SchoolAuditSummary[]) => void = () => undefined;
    listSchoolAuditSummariesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRows = resolve;
        }),
    );
    const { unmount } = render(<SchoolComplianceDashboard />);
    expect(screen.getByText("Chargement du journal d’audit…")).toBeInTheDocument();
    resolveRows([auditRow()]);
    expect(await screen.findByText("Admin Alpha")).toBeInTheDocument();
    unmount();

    listSchoolAuditSummariesMock.mockResolvedValue([]);
    const empty = render(<SchoolComplianceDashboard />);
    expect(await screen.findByText("Aucune activité d’audit.")).toBeInTheDocument();
    empty.unmount();

    listSchoolAuditSummariesMock.mockRejectedValue(new Error("journal indisponible"));
    render(<SchoolComplianceDashboard />);
    expect(await screen.findByText("Impossible de charger le journal d’audit")).toBeInTheDocument();
    expect(screen.getByText("journal indisponible")).toBeInTheDocument();
  });

  it("C06C-13 filtre action ne change pas le tenant", async () => {
    const user = userEvent.setup();
    auth(["Rapports:READ", "Audit:READ"]);
    listSchoolAuditSummariesMock.mockResolvedValue([]);
    render(<SchoolComplianceDashboard />);
    await waitFor(() => expect(listSchoolAuditSummariesMock).toHaveBeenCalledTimes(1));
    await user.type(screen.getByPlaceholderText("privacy_erasure"), "user_update");
    await user.click(screen.getByRole("button", { name: /Filtrer/i }));
    await waitFor(() => expect(listSchoolAuditSummariesMock).toHaveBeenCalledTimes(2));
    expect(listSchoolAuditSummariesMock).toHaveBeenLastCalledWith({
      action: "user_update",
      limit: 50,
    });
    expect(listSchoolAuditSummariesMock.mock.calls.every((call) => !("schoolCode" in (call[0] ?? {})))).toBe(true);
  });

  it("C06C-05 rôle non-SCHOOL_ADMIN + Audit:READ ne fetch pas", () => {
    auth(["Audit:READ"], "Secrétaire");
    render(<SchoolComplianceDashboard />);
    expect(listSchoolAuditSummariesMock).not.toHaveBeenCalled();
  });
});
