import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GradeEntryGrid } from "./GradeEntryGrid";
import type { Evaluation, SessionUser, StudentGrade } from "../../types";

const seke: SessionUser = {
  id: "ens-seke",
  role: "Enseignant",
  schoolCode: "CD-2026-0001",
  firstName: "Seke",
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
  onChange?: ReturnType<typeof vi.fn>;
}) {
  const evaluation = { ...evaluationBase, status: overrides.status ?? "Brouillon" };
  const onChange = overrides.onChange ?? vi.fn();
  const view = render(
    <GradeEntryGrid
      evaluation={evaluation}
      students={students}
      grades={overrides.grades ?? []}
      canEdit={overrides.canEdit ?? evaluation.status === "Validée"}
      user={seke}
      onChange={onChange}
      onError={vi.fn()}
    />,
  );
  return { ...view, onChange };
}

describe("GradeEntryGrid — saisie après validation", () => {
  it("Brouillon : note / statut désactivés, aucun bouton d'enregistrement, message d'attente", () => {
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

  it("Validée : input actif et seul Enregistrer tout est présent", () => {
    renderGrid({ status: "Validée", canEdit: true });

    expect(screen.queryByText("En attente de validation")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Note /20")).not.toBeDisabled();
    expect(screen.getByLabelText("Statut de la note")).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer tout" })).toBeDisabled();
  });

  it("saisie note puis blur : reste locale, aucun onChange parent avant Enregistrer tout", () => {
    const { onChange } = renderGrid({ status: "Validée", canEdit: true });
    const note = screen.getByLabelText("Note /20") as HTMLInputElement;

    fireEvent.change(note, { target: { value: "14" } });
    fireEvent.blur(note);

    expect(note).toHaveValue(14);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Enregistrer tout" })).not.toBeDisabled();
  });

  it("changement statut : reste local et conserve la note sans persistance immédiate", () => {
    const { onChange } = renderGrid({ status: "Validée", canEdit: true });
    const note = screen.getByLabelText("Note /20") as HTMLInputElement;
    const status = screen.getByLabelText("Statut de la note") as HTMLSelectElement;

    fireEvent.change(note, { target: { value: "14" } });
    fireEvent.change(status, { target: { value: "Non justifiée" } });

    expect(note).toHaveValue(14);
    expect(status).toHaveValue("Non justifiée");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Enregistrer tout émet une seule fois uniquement les lignes modifiées", () => {
    const { onChange } = renderGrid({ status: "Validée", canEdit: true });
    const note = screen.getByLabelText("Note /20") as HTMLInputElement;
    const status = screen.getByLabelText("Statut de la note") as HTMLSelectElement;

    fireEvent.change(note, { target: { value: "14" } });
    fireEvent.change(status, { target: { value: "Non justifiée" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer tout" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        studentId: "s1",
        evaluationId: "EVAL-ADV",
        value: 14,
        gradeStatus: "Non justifiée",
      }),
    ]);
  });

  it("statut absence nettoie la valeur et reste local jusqu'à Enregistrer tout", () => {
    const { onChange } = renderGrid({ status: "Validée", canEdit: true });
    const note = screen.getByLabelText("Note /20") as HTMLInputElement;
    const status = screen.getByLabelText("Statut de la note") as HTMLSelectElement;

    fireEvent.change(note, { target: { value: "14" } });
    fireEvent.change(status, { target: { value: "Absente" } });

    expect(note).toHaveValue(null);
    expect(note).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer tout" }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ studentId: "s1", gradeStatus: "Absente", value: undefined }),
    ]);
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
    expect(screen.getByLabelText("Statut de la note")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
  });
});
