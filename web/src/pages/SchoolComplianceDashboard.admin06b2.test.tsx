import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SchoolErasureExecutionResult, SchoolErasureRequest } from "../lib/schoolComplianceApi";

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

function request(overrides: Partial<SchoolErasureRequest> = {}): SchoolErasureRequest {
  return {
    id: "req-pending",
    requestCode: "PRV-A1",
    schoolCode: "CD-2026-0001",
    identifier: "ident-a",
    contactEmail: "a@example.test",
    roleLabel: "Parent",
    requestType: "erasure",
    status: "pending",
    reason: "reason-a",
    actorUserId: null,
    processedAt: null,
    createdAt: "2026-10-02T10:00:00.000Z",
    ...overrides,
  };
}

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

const SUCCESS_EXEC: SchoolErasureExecutionResult = {
  request: request({ status: "processed", processedAt: "2026-10-02T11:00:00.000Z" }),
  sessionsRevoked: 2,
  accountAnonymized: true,
  schoolRecordsRetained: true,
};

describe("SchoolComplianceDashboard ADMIN-06B2", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    listSchoolErasureRequestsMock.mockReset();
    executeSchoolErasureRequestMock.mockReset();
    exportSchoolDataMock.mockReset();
    listSchoolAuditSummariesMock.mockReset();
    listSchoolErasureRequestsMock.mockResolvedValue([]);
    listSchoolAuditSummariesMock.mockResolvedValue([]);
    executeSchoolErasureRequestMock.mockResolvedValue(SUCCESS_EXEC);
    exportSchoolDataMock.mockResolvedValue({
      format: "somafrik-export",
      version: 1,
      generatedAt: "2026-10-02T00:00:00.000Z",
      schoolCode: "CD-2026-0001",
      includedDomains: ["students"],
      domains: { students: [] },
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  it("WEB-RL-25 SCHOOL_ADMIN display Directeur apparaît dans le tableau conformité", async () => {
    auth(["Rapports:READ", "Utilisateurs:READ"]);
    listSchoolErasureRequestsMock.mockResolvedValue([request({ roleLabel: "Directeur" })]);
    render(<SchoolComplianceDashboard />);
    expect(await screen.findByText("Directeur")).toBeInTheDocument();
  });

  it("C06B2-03 School Admin ouvre SchoolComplianceDashboard", async () => {
    auth(["Rapports:READ", "Utilisateurs:READ", "Utilisateurs:UPDATE"]);
    render(<SchoolComplianceDashboard />);
    expect(await screen.findByText("Conformité établissement")).toBeInTheDocument();
    expect(screen.getByText("Demandes d’effacement")).toBeInTheDocument();
  });

  it("C06B2-08 rôle sans Utilisateurs:READ ne fetch pas privacy", () => {
    auth(["Rapports:READ"]);
    render(<SchoolComplianceDashboard />);
    expect(listSchoolErasureRequestsMock).not.toHaveBeenCalled();
    expect(screen.getByText(/pas le droit de consulter les demandes/i)).toBeInTheDocument();
  });

  it("C06B2-09 / C06B2-10 rôle READ voit privacy en lecture seule", async () => {
    auth(["Rapports:READ", "Utilisateurs:READ"]);
    listSchoolErasureRequestsMock.mockResolvedValue([request()]);
    render(<SchoolComplianceDashboard />);
    expect(await screen.findByText("PRV-A1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Exécuter l’effacement/i })).not.toBeInTheDocument();
  });

  it("C06B2-11 / C06B2-12 / C06B2-13 boutons selon statut", async () => {
    auth(["Rapports:READ", "Utilisateurs:READ", "Utilisateurs:UPDATE"]);
    listSchoolErasureRequestsMock.mockResolvedValue([
      request(),
      request({ id: "req-proc", requestCode: "PRV-A2", status: "processed" }),
      request({ id: "req-rej", requestCode: "PRV-A3", status: "rejected" }),
    ]);
    render(<SchoolComplianceDashboard />);
    expect(await screen.findByText("PRV-A1")).toBeInTheDocument();
    const executeButtons = screen.getAllByRole("button", { name: /Exécuter l’effacement/i });
    expect(executeButtons).toHaveLength(1);
    expect(screen.getByText("Traitée")).toBeInTheDocument();
    expect(screen.getByText("Rejetée")).toBeInTheDocument();
  });

  it("C06B2-15 / C06B2-16 / C06B2-17 confirmation puis POST unique et reload", async () => {
    const user = userEvent.setup();
    auth(["Rapports:READ", "Utilisateurs:READ", "Utilisateurs:UPDATE"]);
    listSchoolErasureRequestsMock
      .mockResolvedValueOnce([request()])
      .mockResolvedValueOnce([request({ status: "processed", processedAt: "2026-10-02T11:00:00.000Z" })]);
    let resolveExec: (value: SchoolErasureExecutionResult) => void = () => undefined;
    executeSchoolErasureRequestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExec = resolve;
        }),
    );
    render(<SchoolComplianceDashboard />);
    await screen.findByText("PRV-A1");
    expect(executeSchoolErasureRequestMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Exécuter l’effacement/i }));
    expect(executeSchoolErasureRequestMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: /Confirmer l’effacement/i });
    await user.click(confirm);
    await user.click(confirm);
    expect(executeSchoolErasureRequestMock).toHaveBeenCalledTimes(1);
    expect(executeSchoolErasureRequestMock).toHaveBeenCalledWith("req-pending");
    resolveExec(SUCCESS_EXEC);
    expect(await screen.findByText("Demande traitée.")).toBeInTheDocument();
    await waitFor(() => expect(listSchoolErasureRequestsMock).toHaveBeenCalledTimes(2));
  });

  it("C06B2-18 / C06B2-19 résultat exécution", async () => {
    const user = userEvent.setup();
    auth(["Rapports:READ", "Utilisateurs:READ", "Utilisateurs:UPDATE"]);
    listSchoolErasureRequestsMock.mockResolvedValue([request()]);
    render(<SchoolComplianceDashboard />);
    await screen.findByText("PRV-A1");
    await user.click(screen.getByRole("button", { name: /Exécuter l’effacement/i }));
    await user.click(screen.getByRole("button", { name: /Confirmer l’effacement/i }));
    expect(await screen.findByText("Le compte a été anonymisé.")).toBeInTheDocument();
    expect(screen.getByText("Les données scolaires réglementaires sont conservées.")).toBeInTheDocument();
    expect(screen.queryByText(/password|PIN|token|hash/i)).not.toBeInTheDocument();
  });

  it("C06B2-20 export absent pour rôle non autorisé", () => {
    auth(["Rapports:READ"], "Enseignant");
    render(<SchoolComplianceDashboard />);
    expect(screen.queryByRole("button", { name: /Exporter les données/i })).not.toBeInTheDocument();
    expect(exportSchoolDataMock).not.toHaveBeenCalled();
  });

  it("EX06B2-10 SCHOOL_ADMIN sans Paramètres ne voit pas l’export", () => {
    auth(["Rapports:READ", "Utilisateurs:READ"]);
    render(<SchoolComplianceDashboard />);
    expect(screen.queryByRole("button", { name: /Exporter les données/i })).not.toBeInTheDocument();
    expect(exportSchoolDataMock).not.toHaveBeenCalled();
  });

  it("C06B2-21 / C06B2-22 / C06B2-23 export sur action, sans schoolCode", async () => {
    const user = userEvent.setup();
    auth(["Rapports:READ", "Utilisateurs:READ", "Paramètres Établissement:READ"]);
    render(<SchoolComplianceDashboard />);
    expect(exportSchoolDataMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Exporter les données/i }));
    await waitFor(() => expect(exportSchoolDataMock).toHaveBeenCalledTimes(1));
    expect(exportSchoolDataMock).toHaveBeenCalledWith();
  });
});
