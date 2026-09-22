import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const queue = vi.hoisted(() => vi.fn());
const catalog = vi.hoisted(() => vi.fn());
const startReview = vi.hoisted(() => vi.fn());
const startConfiguring = vi.hoisted(() => vi.fn());
const markReady = vi.hoisted(() => vi.fn());
const rejectRequest = vi.hoisted(() => vi.fn());
const activate = vi.hoisted(() => vi.fn());
const saveTemplate = vi.hoisted(() => vi.fn());
const bindBundle = vi.hoisted(() => vi.fn());

vi.mock("../lib/reportCardConfigurationApi", () => ({
  reportCardAdminApi: {
    queue: (...args: unknown[]) => queue(...args),
    catalog: (...args: unknown[]) => catalog(...args),
    startReview: (...args: unknown[]) => startReview(...args),
    startConfiguring: (...args: unknown[]) => startConfiguring(...args),
    markReadyForReview: (...args: unknown[]) => markReady(...args),
    reject: (...args: unknown[]) => rejectRequest(...args),
    activate: (...args: unknown[]) => activate(...args),
    saveRenderingTemplate: (...args: unknown[]) => saveTemplate(...args),
    bindBundle: (...args: unknown[]) => bindBundle(...args),
  },
}));

describe("LOT 7 superadmin workflow", () => {
  beforeEach(() => {
    queue.mockReset();
    catalog.mockReset();
    startReview.mockReset();
    startConfiguring.mockReset();
    markReady.mockReset();
    rejectRequest.mockReset();
    activate.mockReset();
    saveTemplate.mockReset();
    bindBundle.mockReset();
    catalog.mockResolvedValue({ profiles: [], schemas: [] });
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
          save_template: status === "CONFIGURING",
          bind_bundle: status === "CONFIGURING",
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

  it("report-card-lot7-web-superadmin-save-bind-ready", async () => {
    const mod = await import("./ReportCardSuperadminWorkflowPage");
    const configuring = {
      id: "req-config",
      status: "CONFIGURING",
      model_key: "trimestriel",
      school_id: "school-a",
      actions: { save_template: true, bind_bundle: true, ready: true },
    };
    queue.mockResolvedValue({ requests: [configuring] });
    catalog.mockResolvedValue({
      profiles: [{ id: "prof-1", profile_key: "core", version: 1, status: "ACTIVE" }],
      schemas: [{ id: "sch-1", schema_key: "core", version: 1, status: "ACTIVE" }],
    });
    saveTemplate.mockResolvedValue({ template: { template_id: "tpl-1", version: 1 } });
    bindBundle.mockResolvedValue({ request: configuring });
    markReady.mockResolvedValue({ request: { ...configuring, status: "READY_FOR_REVIEW", actions: {} } });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <mod.ReportCardSuperadminWorkflowPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/établissement cible/i), "school-a");
    await user.click(screen.getByRole("button", { name: /charger la file/i }));
    await waitFor(() => expect(screen.getByText("CONFIGURING")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/profil académique/i), "prof-1");
    await user.selectOptions(screen.getByLabelText(/schéma bulletin/i), "sch-1");
    await user.click(screen.getByRole("button", { name: /enregistrer gabarit/i }));
    await waitFor(() => expect(screen.getByText(/Gabarit enregistré/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /prévisualiser/i }));
    await waitFor(() => expect(screen.getByText(/QR requis/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /lier le bundle/i }));
    await waitFor(() => expect(bindBundle).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /prêt pour revue/i }));
    await waitFor(() => expect(markReady).toHaveBeenCalled());
    expect(saveTemplate.mock.invocationCallOrder[0]).toBeLessThan(bindBundle.mock.invocationCallOrder[0]);
    expect(bindBundle.mock.invocationCallOrder[0]).toBeLessThan(markReady.mock.invocationCallOrder[0]);
    expect(bindBundle).toHaveBeenCalledWith("req-config", "school-a", {
      profile: { id: "prof-1", version: 1 },
      schema: { id: "sch-1", version: 1 },
      template: { id: "tpl-1", version: 1 },
    });
  });
});
