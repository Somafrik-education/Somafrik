import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationFormModal } from "./EvaluationFormModal";
import type { BackOfficeState } from "../../types";

vi.mock("../../lib/evaluationTypesApi", () => ({
  evaluationTypesApi: {
    list: vi.fn().mockResolvedValue({
      types: [{ id: "type-1", name: "Devoir", status: "active", code: "devoir" }],
    }),
  },
}));

const state = {
  courses: [{ schoolCode: "CD-2026-0001", className: "6ème A", name: "Mathématiques" }],
  assignments: [],
  teachers: [],
  academicConfigs: {},
} as unknown as BackOfficeState;

describe("EvaluationFormModal P0 vocabulaire Cours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("affiche COURS et non MATIÈRE", async () => {
    render(
      <EvaluationFormModal
        open
        onClose={() => undefined}
        onSave={() => undefined}
        state={state}
        schoolCode="CD-2026-0001"
        classNames={["6ème A"]}
        user={null}
      />,
    );
    expect(await screen.findByLabelText(/Cours/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Matière/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Matière\s*\*?$/)).not.toBeInTheDocument();
  });
});
