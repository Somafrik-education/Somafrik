import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { PlatformCompliancePayload } from "../lib/platformComplianceApi";

const { useAuthMock, getPlatformComplianceMock, listSchoolErasureRequestsMock, exportSchoolDataMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getPlatformComplianceMock: vi.fn(),
  listSchoolErasureRequestsMock: vi.fn(),
  exportSchoolDataMock: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../lib/platformComplianceApi", () => ({
  getPlatformCompliance: getPlatformComplianceMock,
}));

vi.mock("../lib/schoolComplianceApi", () => ({
  listSchoolErasureRequests: listSchoolErasureRequestsMock,
  executeSchoolErasureRequest: vi.fn(),
  exportSchoolData: exportSchoolDataMock,
}));

import { ReportsPage } from "./ReportsPage";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "../lib/orgHierarchy";

const SUCCESS: PlatformCompliancePayload = {
  schemaVersion: 1,
  scope: "platform",
  generatedAt: "2026-10-02T00:00:00.000Z",
  privacyRequests: { total: 0, pending: 0, processed: 0, rejected: 0 },
  capabilities: {
    privacyPolicy: { configured: true },
    accountDeletionPage: { configured: true },
    erasureRequestIntake: { configured: true },
    selfErasure: { configured: true },
    schoolDataExport: { configured: true },
  },
  protections: {
    auditLogsPlatformDenied: true,
    schoolPrivacyRequestsPlatformDenied: true,
    schoolPrivacyExecutionPlatformDenied: true,
    schoolDataExportPlatformDenied: true,
    advancedReportsPlatformDenied: true,
  },
};

describe("ReportsPage ADMIN-06B1", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    getPlatformComplianceMock.mockReset();
  });

  it("C06B1-19 Superadmin fetch A1 et affiche les comptages à 0", async () => {
    useAuthMock.mockReturnValue({
      session: { user: { role: SUPER_ADMIN_ROLE, permissions: ["ALL_PRIVILEGES"] } },
    });
    getPlatformComplianceMock.mockResolvedValue(SUCCESS);
    render(<ReportsPage />);
    expect(getPlatformComplianceMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Conformité plateforme")).toBeInTheDocument();
    expect(screen.getByText("Demandes d’effacement")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.queryByText("Conformité MVP")).not.toBeInTheDocument();
  });

  it("C06B1-20 School Admin ouvre A2 et ne fetch pas A1", () => {
    useAuthMock.mockReturnValue({
      session: { user: { role: SCHOOL_ADMIN_ROLE, permissions: ["Rapports:READ"], schoolCode: "CD-2026-0001" } },
    });
    render(<ReportsPage />);
    expect(getPlatformComplianceMock).not.toHaveBeenCalled();
    expect(screen.getByText("Conformité établissement")).toBeInTheDocument();
    expect(screen.queryByText("Conformité plateforme")).not.toBeInTheDocument();
    expect(screen.queryByText("Conformité MVP")).not.toBeInTheDocument();
  });

  it("C06B1-21 Country Admin ne fetch pas A1", () => {
    useAuthMock.mockReturnValue({
      session: { user: { role: COUNTRY_ADMIN_ROLE, permissions: ["COUNTRY_PRIVILEGES"] } },
    });
    render(<ReportsPage />);
    expect(getPlatformComplianceMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Conformité plateforme")).not.toBeInTheDocument();
  });

  it("C06B1-22 erreur A1 n'affiche pas un faux état conforme", async () => {
    useAuthMock.mockReturnValue({
      session: { user: { role: SUPER_ADMIN_ROLE, permissions: ["ALL_PRIVILEGES"] } },
    });
    getPlatformComplianceMock.mockRejectedValue(new Error("service indisponible"));
    render(<ReportsPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Impossible de charger la conformité plateforme")).toBeInTheDocument();
    expect(screen.getByText("service indisponible")).toBeInTheDocument();
    expect(screen.queryByText("configurée")).not.toBeInTheDocument();
    expect(screen.queryByText("configuré")).not.toBeInTheDocument();
    expect(screen.queryByText("Journal établissement inaccessible plateforme")).not.toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
    await waitFor(() => expect(getPlatformComplianceMock).toHaveBeenCalled());
  });
});
