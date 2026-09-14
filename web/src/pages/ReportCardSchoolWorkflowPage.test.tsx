import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const listRequests = vi.hoisted(() => vi.fn());
const submitModel = vi.hoisted(() => vi.fn());
const approveRequest = vi.hoisted(() => vi.fn());
const requestChanges = vi.hoisted(() => vi.fn());
const listAudit = vi.hoisted(() => vi.fn());
const getBundle = vi.hoisted(() => vi.fn());
const getActiveBinding = vi.hoisted(() => vi.fn());

vi.mock("../lib/reportCardConfigurationApi", () => ({
  reportCardConfigurationApi: {
    listRequests: (...args: unknown[]) => listRequests(...args),
    submitModel: (...args: unknown[]) => submitModel(...args),
    approve: (...args: unknown[]) => approveRequest(...args),
    requestChanges: (...args: unknown[]) => requestChanges(...args),
    listAudit: (...args: unknown[]) => listAudit(...args),
    getBundle: (...args: unknown[]) => getBundle(...args),
    getActiveBinding: (...args: unknown[]) => getActiveBinding(...args),
  },
}));

const frozenTemplate = {
  paper: "A4",
  orientation: "portrait",
  qr_required: true,
  sections: [
    { id: "SUMMARY", order: 1, label: "Totaux", source: "slots" as const },
    { id: "SUBJECTS", order: 2, label: "Disciplines", source: "cells" as const },
  ],
};

describe("LOT 7 school workflow", () => {
  beforeEach(() => {
    listRequests.mockReset();
    submitModel.mockReset();
    approveRequest.mockReset();
    requestChanges.mockReset();
    listAudit.mockReset();
    getBundle.mockReset();
    getActiveBinding.mockReset();
    listAudit.mockResolvedValue({ audit: [] });
    getBundle.mockResolvedValue({ template: null, profile: null, schema: null });
    getActiveBinding.mockResolvedValue({ binding: null });
  });

  it("report-card-lot7-web-school-workflow-states", async () => {
    const mod = await import("./ReportCardSchoolWorkflowPage");
    const states = ["SUBMITTED", "UNDER_REVIEW", "CONFIGURING", "READY_FOR_REVIEW", "APPROVED", "ACTIVE"];
    listRequests.mockResolvedValue({
      requests: states.map((status, index) => ({
        id: `req-${index}`,
        status,
        model_key: "trimestriel",
        actions: { approve: status === "READY_FOR_REVIEW", request_changes: status === "READY_FOR_REVIEW" },
      })),
    });
    render(
      <MemoryRouter>
        <mod.ReportCardSchoolWorkflowPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      for (const status of states) {
        expect(screen.getAllByText(status).length).toBeGreaterThan(0);
      }
    });
  });

  it("report-card-lot7-web-actions-follow-server-rbac", async () => {
    const mod = await import("./ReportCardSchoolWorkflowPage");
    listRequests.mockResolvedValue({
      requests: [
        {
          id: "req-ready",
          status: "READY_FOR_REVIEW",
          model_key: "trimestriel",
          actions: { approve: false, request_changes: false },
        },
      ],
    });
    render(
      <MemoryRouter>
        <mod.ReportCardSchoolWorkflowPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("READY_FOR_REVIEW")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /approuver/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /modifications/i })).not.toBeInTheDocument();
  });

  it("report-card-lot7-web-school-preview-audit-active", async () => {
    const mod = await import("./ReportCardSchoolWorkflowPage");
    listRequests.mockResolvedValue({
      requests: [
        {
          id: "req-ready",
          status: "READY_FOR_REVIEW",
          model_key: "trimestriel",
          actions: { approve: true, request_changes: true },
        },
        {
          id: "req-active",
          status: "ACTIVE",
          model_key: "trimestriel",
          actions: {},
        },
      ],
    });
    listAudit.mockImplementation(async (requestId: string) => ({
      audit:
        requestId === "req-ready"
          ? [
              { id: 1, from_state: "CONFIGURING", to_state: "READY_FOR_REVIEW" },
            ]
          : [{ id: 2, from_state: "APPROVED", to_state: "ACTIVE" }],
    }));
    getBundle.mockResolvedValue({
      template: { spec: frozenTemplate, version: 1, status: "ACTIVE" },
      profile: { id: "prof-1", version: 1 },
      schema: { id: "sch-1", version: 1 },
    });
    getActiveBinding.mockResolvedValue({
      binding: { model_key: "trimestriel", request_id: "req-active" },
    });
    render(
      <MemoryRouter>
        <mod.ReportCardSchoolWorkflowPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByText(/QR requis/).length).toBeGreaterThan(0));
    expect(screen.getByText("CONFIGURING → READY_FOR_REVIEW")).toBeInTheDocument();
    expect(screen.getByText(/Configuration ACTIVE trimestriel/)).toBeInTheDocument();
    expect(getBundle).toHaveBeenCalledWith("req-ready");
    expect(getActiveBinding).toHaveBeenCalledWith("trimestriel");
  });
});
