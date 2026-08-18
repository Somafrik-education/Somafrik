import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GradeEntryGrid } from "./GradeEntryGrid";
import type { Evaluation, SessionUser, StudentGrade } from "../../types";

const seke: SessionUser = {
  id: "ens-seke",
  role: "Enseignant",
  schoolCode: "CD-2026-0001",
  name: "Seke",
};

const evaluationBase: Evaluation = {
  id: "EVAL-ADV",
  schoolCode: "CD-2026-0001",
  className: "6ème A",
  subject: "Mathématiques",
  period: "Trimestre 1",
  evaluationType: "Devoir",
  title: "LES ADVERBES",
  scale: 20,
  coefficient: 1,
  status: "Brouillon",
  active: true,
};

const students = [
  {
    id: "s1",
    firstName: "Riziki",
    lastName: "Masumbuko",
    className: "6ème A",
  },
];

function renderGrid(overrides: {
  status?: Evaluation["status"];
  canEdit?: boolean;
  grades?: StudentGrade[];
}) {
  const evaluation = { ...evaluationBase, status: overrides.status ?? "Brouillon" };
  return render(
    <GradeEntryGrid
      evaluation={evaluation}
      students={students}
      grades={overrides.grades ?? []}
      canEdit={overrides.canEdit ?? evaluation.status === "Validée"}
      user={seke}
      onChange={vi.fn()}
      onError={vi.fn()}
    />,
  );
}

describe("GradeEntryGrid — saisie après validation", () => {
  it("Brouillon : note / statut désactivés, Enregistrer absent, message d'attente", () => {
    renderGrid({ status: "Brouillon", canEdit: false });

    expect(screen.getByRole("status")).toHaveTextContent("En attente de validation");
    expect(screen.getByRole("status")).toHaveTextContent(
      "La saisie des notes sera disponible après validation par le Préfet ou l'administration.",
    );
    expect(screen.getByLabelText("Note /20")).toBeDisabled();
    expect(screen.getByLabelText("Statut de la note")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer tout" })).not.toBeInTheDocument();
  });

  it("Validée : input note actif", () => {
    renderGrid({ status: "Validée", canEdit: true });

    expect(screen.queryByText("En attente de validation")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Note /20")).not.toBeDisabled();
    expect(screen.getByLabelText("Statut de la note")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeInTheDocument();
  });

  it("note déjà Validée : input verrouillé", () => {
    renderGrid({
      status: "Validée",
      canEdit: true,
      grades: [
        {
          id: "g1",
          schoolCode: "CD-2026-0001",
          studentId: "s1",
          evaluationId: "EVAL-ADV",
          subject: "Mathématiques",
          period: "Trimestre 1",
          value: 14,
          scale: 20,
          gradeStatus: "Validée",
        },
      ],
    });

    expect(screen.getByLabelText("Note /20")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
  });
});
