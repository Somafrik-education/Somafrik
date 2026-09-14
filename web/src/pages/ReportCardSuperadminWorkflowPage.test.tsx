import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const queue = vi.hoisted(() => vi.fn());
const startReview = vi.hoisted(() => vi.fn());
const startConfiguring = vi.hoisted(() => vi.fn());
const markReady = vi.hoisted(() => vi.fn());
const rejectRequest = vi.hoisted(() => vi.fn());
const activate = vi.hoisted(() => vi.fn());

vi.mock("../lib/reportCardConfigurationApi", () => ({
  reportCardAdminApi: {
    queue: (...args: unknown[]) => queue(...args),
    startReview: (...args: unknown[]) => startReview(...args),
    startConfiguring: (...args: unknown[]) => startConfiguring(...args),
    markReadyForReview: (...args: unknown[]) => markReady(...args),
    reject: (...args: unknown[]) => rejectRequest(...args),
    activate: (...args: unknown[]) => activate(...args),
  },
}));

describe("LOT 7 superadmin workflow", () => {
  beforeEach(() => {
    queue.mockReset();
    startReview.mockReset();
    startConfiguring.mockReset();
    markReady.mockReset();
    rejectRequest.mockReset();
    activate.mockReset();
  });

  it("report-card-lot7-web-superadmin-workflow-states", async () => {
    const mod = await import("./ReportCardSuperadminWorkflowPage");
    const states = ["SUBMITTED", "UNDER_REVIEW", "CONFIGURING", "READY_FOR_REVIEW", "CHANGES_REQUESTED", "APPROVED", "ACTIVE"];
    queue.mockResolvedValue({
      requests: states.map((status, index) => ({
        id: `req-${index}`,
        status,
        model_key: "trimestriel",
        school_id: "school-a",
        actions: {
          review: status === "SUBMITTED",
          configure: status === "UNDER_REVIEW" || status === "CHANGES_REQUESTED",
          ready: status === "CONFIGURING",
          reject: ["SUBMITTED", "UNDER_REVIEW", "CONFIGURING", "READY_FOR_REVIEW", "CHANGES_REQUESTED"].includes(status),
          activate: status === "APPROVED",
        },
      })),
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <mod.ReportCardSuperadminWorkflowPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/établissement cible/i), "school-a");
    await user.click(screen.getByRole("button", { name: /charger la file/i }));
    await waitFor(() => {
      for (const status of states) {
        expect(screen.getAllByText(status).length).toBeGreaterThan(0);
      }
    });
  });
});
