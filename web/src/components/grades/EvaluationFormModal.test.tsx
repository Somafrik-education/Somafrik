import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        classes={[{ id: "uuid-6a", name: "6ème A", classCode: "CLS-6A" }]}
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
        classes={[{ id: "uuid-a", name: "2ème A", classCode: "CLS-2A" }]}
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
        classes={[{ id: "uuid-a", name: "2ème A", classCode: "CLS-2A" }]}
        user={{ id: "ens-seke", role: "Enseignant", schoolCode: "CD-2026-0001", assignments: [] }}
      />,
    );
    expect(await screen.findByRole("option", { name: "Aucun cours affecté" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Philosophie" })).not.toBeInTheDocument();
  });
});

describe("MONO-FIX-A4 — sélection des classes homonymes par classId", () => {
  const homonyms = [
    { id: "uuid-6a-1", name: "6ème A", classCode: "CLS-6A-1", academicYear: "2025-2026" },
    { id: "uuid-6a-2", name: "6ème A", classCode: "CLS-6A-2", academicYear: "2026-2027" },
  ];
  it("affiche les deux codes et conserve un choix explicite", async () => {
    render(
      <EvaluationFormModal open onClose={() => undefined} onSave={() => undefined}
        state={state} schoolCode="CD-2026-0001" classNames={["6ème A"]}
        classes={homonyms} user={null} />,
    );
    expect(screen.getByRole("option", { name: /6ème A — CLS-6A-1/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /6ème A — CLS-6A-2/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Classe/i)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  });

  it.each(homonyms)("enregistre l'identifiant canonique $id choisi et non le premier homonyme", async (chosen) => {
    const onSave = vi.fn();
    render(
      <EvaluationFormModal open onClose={() => undefined} onSave={onSave}
        state={state} schoolCode="CD-2026-0001" classNames={["6ème A"]}
        classes={homonyms} user={null} />,
    );
    fireEvent.change(screen.getByLabelText(/^Classe/i), { target: { value: chosen.id } });
    fireEvent.change(screen.getByLabelText(/^Cours/i), { target: { value: "Mathématiques" } });
    fireEvent.change(screen.getByLabelText(/^Titre/i), { target: { value: "Devoir A4" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0]).toMatchObject({ classId: chosen.id, className: "6ème A" });
  });
});
