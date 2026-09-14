import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const listRequests = vi.hoisted(() => vi.fn());
const submitModel = vi.hoisted(() => vi.fn());
const attachSourceArtifact = vi.hoisted(() => vi.fn());
const queue = vi.hoisted(() => vi.fn());
const catalog = vi.hoisted(() => vi.fn());
const getSourceArtifact = vi.hoisted(() => vi.fn());

vi.mock("../lib/reportCardConfigurationApi", () => ({
  reportCardConfigurationApi: {
    listRequests: (...args: unknown[]) => listRequests(...args),
    submitModel: (...args: unknown[]) => submitModel(...args),
    approve: vi.fn(),
    requestChanges: vi.fn(),
    listAudit: vi.fn(async () => ({ audit: [] })),
    getBundle: vi.fn(async () => ({ template: null, profile: null, schema: null })),
    getActiveBinding: vi.fn(async () => ({ binding: null })),
    attachSourceArtifact: (...args: unknown[]) => attachSourceArtifact(...args),
  },
  reportCardAdminApi: {
    queue: (...args: unknown[]) => queue(...args),
    catalog: (...args: unknown[]) => catalog(...args),
    getSourceArtifact: (...args: unknown[]) => getSourceArtifact(...args),
    startReview: vi.fn(),
    startConfiguring: vi.fn(),
    markReadyForReview: vi.fn(),
    reject: vi.fn(),
    activate: vi.fn(),
    saveRenderingTemplate: vi.fn(),
    bindBundle: vi.fn(),
  },
}));

describe("LOT 11 web workflow", () => {
  beforeEach(() => {
    listRequests.mockReset();
    submitModel.mockReset();
    attachSourceArtifact.mockReset();
    queue.mockReset();
    catalog.mockReset();
    getSourceArtifact.mockReset();
    catalog.mockResolvedValue({ profiles: [], schemas: [] });
    listRequests.mockResolvedValue({
      requests: [
        {
          id: "req-1",
          status: "SUBMITTED",
          model_key: "trimestriel",
          actions: {},
        },
      ],
    });
  });

  it("report-card-lot11-web-upload-error-success-persisted", async () => {
    attachSourceArtifact.mockRejectedValueOnce(new Error("FILE_TOO_LARGE"));
    attachSourceArtifact.mockResolvedValueOnce({
      artifact: { artifact_id: "art-1", sha256: "abc", version: 1, original_filename: "modele.pdf" },
    });
    const mod = await import("./ReportCardSchoolWorkflowPage");
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <mod.ReportCardSchoolWorkflowPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /envoyer un modèle de bulletin/i })).toBeInTheDocument();
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    const oversized = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "too-big.pdf", {
      type: "application/pdf",
    });
    if (fileInput) {
      await user.upload(fileInput, oversized);
    }
    await user.click(screen.getByRole("button", { name: /envoyer un modèle de bulletin/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    attachSourceArtifact.mockClear();
    attachSourceArtifact.mockResolvedValue({
      artifact: { artifact_id: "art-1", sha256: "abc", version: 1, original_filename: "modele.pdf" },
    });
    await user.click(screen.getByRole("button", { name: /envoyer un modèle de bulletin/i }));
    await waitFor(() => {
      expect(screen.getByText(/art-1|modèle envoyé|artefact/i)).toBeInTheDocument();
    });
  });

  it("report-card-lot11-superadmin-preview-privileged-only", async () => {
    queue.mockResolvedValue({
      requests: [
        {
          id: "req-1",
          status: "CONFIGURING",
          model_key: "trimestriel",
          school_id: "school-a",
          actions: { save_template: true, bind_bundle: true, ready: true },
        },
      ],
    });
    getSourceArtifact.mockResolvedValue({
      artifact: {
        artifact_id: "art-1",
        sha256: "deadbeef",
        version: 2,
        original_filename: "modele.pdf",
        media_type: "application/pdf",
        school_id: "school-a",
      },
    });
    const mod = await import("./ReportCardSuperadminWorkflowPage");
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <mod.ReportCardSuperadminWorkflowPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/établissement cible/i), "school-a");
    await user.click(screen.getByRole("button", { name: /charger la file/i }));
    await waitFor(() => {
      expect(screen.getByText(/artefact source/i)).toBeInTheDocument();
    });
    expect(getSourceArtifact).toHaveBeenCalled();
    expect(screen.getByText(/deadbeef|art-1|modele\.pdf/i)).toBeInTheDocument();
  });
});
