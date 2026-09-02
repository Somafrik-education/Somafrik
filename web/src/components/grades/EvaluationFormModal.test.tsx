import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationFormModal } from "./EvaluationFormModal";
import type { BackOfficeState, SessionUser } from "../../types";

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

const emptyCatalogState = {
  courses: [],
  assignments: [],
  classes: [],
  teachers: [],
  academicConfigs: {},
} as unknown as BackOfficeState;

const seke: SessionUser = {
  id: "ens-seke",
  role: "Enseignant",
  schoolCode: "CD-2026-0001",
  assignments: [
    {
      classId: "uuid-a",
      classCode: "CLS-2A",
      className: "2ème A",
      course: "Mathématiques",
      status: "active",
    },
    {
      classId: "uuid-a",
      classCode: "CLS-2A",
      className: "2ème A",
      course: "Physique",
      status: "active",
    },
  ],
};

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

  it("Seke : 2 cours JWT même si state.assignments et state.courses sont vides", async () => {
    render(
      <EvaluationFormModal
        open
        onClose={() => undefined}
        onSave={() => undefined}
        state={emptyCatalogState}
        schoolCode="CD-2026-0001"
        classNames={["2ème A"]}
        user={seke}
      />,
    );
    const select = await screen.findByLabelText(/^Cours/i);
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mathématiques" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Physique" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Aucun cours affecté" })).not.toBeInTheDocument();
  });

  it("enseignant sans affectation : liste vide explicite, pas de catalogue global", async () => {
    const poisoned = {
      ...emptyCatalogState,
      courses: [{ schoolCode: "CD-2026-0001", className: "2ème A", name: "Philosophie" }],
    } as unknown as BackOfficeState;
    render(
      <EvaluationFormModal
        open
        onClose={() => undefined}
        onSave={() => undefined}
        state={poisoned}
        schoolCode="CD-2026-0001"
        classNames={["2ème A"]}
        user={{ id: "ens-seke", role: "Enseignant", schoolCode: "CD-2026-0001", assignments: [] }}
      />,
    );
    expect(await screen.findByRole("option", { name: "Aucun cours affecté" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Philosophie" })).not.toBeInTheDocument();
  });
});
