import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client";
import { SchoolSubjectsPanel } from "./SchoolSubjectsPanel";

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

describe("SchoolSubjectsPanel", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("affiche Mathématiques depuis GET /v2/subjects", async () => {
    vi.mocked(api.get).mockResolvedValue([{ code: "SUB-MATH", name: "Mathématiques", status: "Active" }]);
    render(<SchoolSubjectsPanel canCreate={false} />);
    expect(await screen.findByText(/Mathématiques \(SUB-MATH\)/)).toBeInTheDocument();
    expect(screen.queryByText("Français")).not.toBeInTheDocument();
  });

  it("affiche Aucune matière sur 200 [] sans injecter de liste locale", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    render(<SchoolSubjectsPanel canCreate={false} />);
    expect(await screen.findByText("Aucune matière")).toBeInTheDocument();
    expect(screen.queryByText("Mathématiques")).not.toBeInTheDocument();
    expect(screen.queryByText("Français")).not.toBeInTheDocument();
  });

  it("affiche l'erreur réelle si GET /v2/subjects = 500", async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError("Erreur interne catalogue", 500));
    render(<SchoolSubjectsPanel canCreate={false} />);
    expect(await screen.findByText(/Catalogue matières indisponible/i)).toBeInTheDocument();
    expect(screen.getByText(/Erreur interne catalogue/i)).toBeInTheDocument();
    expect(screen.queryByText("Aucune matière")).not.toBeInTheDocument();
  });
});
