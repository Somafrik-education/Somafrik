import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const listRequests = vi.hoisted(() => vi.fn());
const submitModel = vi.hoisted(() => vi.fn());
const approveRequest = vi.hoisted(() => vi.fn());
const requestChanges = vi.hoisted(() => vi.fn());

vi.mock("../lib/reportCardConfigurationApi", () => ({
  reportCardConfigurationApi: {
    listRequests: (...args: unknown[]) => listRequests(...args),
    submitModel: (...args: unknown[]) => submitModel(...args),
    approve: (...args: unknown[]) => approveRequest(...args),
    requestChanges: (...args: unknown[]) => requestChanges(...args),
  },
}));

describe("LOT 7 school workflow", () => {
  beforeEach(() => {
    listRequests.mockReset();
    submitModel.mockReset();
    approveRequest.mockReset();
    requestChanges.mockReset();
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
});
