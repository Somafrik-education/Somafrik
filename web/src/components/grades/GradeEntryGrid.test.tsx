import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  teacherId: "ENS-0001",
};

const students = [
  {
    id: "s1",
    firstName: "Riziki",
    lastName: "Masumbuko",
    className: "6ème A",
  },
  {
    id: "s2",
    firstName: "Awa",
    lastName: "Diallo",
    className: "6ème A",
  },
  {
    id: "s3",
    firstName: "Jean",
    lastName: "Kouassi",
    className: "6ème A",
  },
];

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderGrid(overrides: {
  status?: Evaluation["status"];
  teacherId?: string;
  canEdit?: boolean;
  grades?: StudentGrade[];
  onSave?: (grades: StudentGrade[]) => Promise<void>;
  onError?: (message: string) => void;
  studentRows?: typeof students;
}) {
  const evaluation = {
    ...evaluationBase,
    status: overrides.status ?? "Brouillon",
    ...(overrides.teacherId !== undefined ? { teacherId: overrides.teacherId } : {}),
  };
  const onSave =
    overrides.onSave ??
    vi.fn<(grades: StudentGrade[]) => Promise<void>>(async () => undefined);
  const onError = overrides.onError ?? vi.fn<(message: string) => void>();
  const view = render(
    <GradeEntryGrid
      evaluation={evaluation}
      students={overrides.studentRows ?? students.slice(0, 1)}
      grades={overrides.grades ?? []}
      canEdit={overrides.canEdit ?? evaluation.status === "Validée"}
      user={seke}
      onSave={onSave}
      onError={onError}
    />,
  );
  return { ...view, onSave, onError };
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

  it("A/B — saisie 14 puis blur : aucun onSave", () => {
    const { onSave } = renderGrid({ status: "Validée", canEdit: true });
    const note = screen.getByLabelText("Note /20") as HTMLInputElement;

    fireEvent.change(note, { target: { value: "14" } });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.blur(note);

    expect(note).toHaveValue(14);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Enregistrer tout" })).not.toBeDisabled();
  });

  it("C — changement de statut d'absence : reste local, aucun onSave", () => {
    const { onSave } = renderGrid({ status: "Validée", canEdit: true });
    const note = screen.getByLabelText("Note /20") as HTMLInputElement;
    const status = screen.getByLabelText("Statut de la note") as HTMLSelectElement;

    fireEvent.change(note, { target: { value: "14" } });
    fireEvent.change(status, { target: { value: "Non justifiée" } });

    expect(status).toHaveValue("Non justifiée");
    expect(note).toHaveValue(null);
    expect(note).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("D — Enregistrer tout appelle onSave une seule fois", async () => {
    const { onSave } = renderGrid({ status: "Validée", canEdit: true });
    const note = screen.getByLabelText("Note /20") as HTMLInputElement;

    fireEvent.change(note, { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer tout" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({
        studentId: "s1",
        evaluationId: "EVAL-ADV",
        value: 14,
        gradeStatus: "Saisie",
        teacherId: "ENS-0001",
        authorId: "ens-seke",
      }),
    ]);
  });

  it("E — pendant Promise pending : Enregistrement… disabled, second clic impossible", async () => {
    const deferred = createDeferred();
    const onSave = vi.fn(() => deferred.promise);
    renderGrid({ status: "Validée", canEdit: true, onSave });
    fireEvent.change(screen.getByLabelText("Note /20"), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer tout" }));

    const pending = await screen.findByRole("button", { name: "Enregistrement…" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(onSave).toHaveBeenCalledTimes(1);
    deferred.resolve();
    await waitFor(() => expect(screen.getByRole("button", { name: "Enregistrer tout" })).toBeDisabled());
  });

  it("F — Promise resolve : drafts effacés, bouton disabled", async () => {
    const { onSave } = renderGrid({ status: "Validée", canEdit: true });
    const note = screen.getByLabelText("Note /20") as HTMLInputElement;
    fireEvent.change(note, { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer tout" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Enregistrer tout" })).toBeDisabled());
    expect(note).toHaveValue(null);
  });

  it("G — Promise reject : drafts conservés, note affichée, bouton réactivé", async () => {
    const deferred = createDeferred();
    const onSave = vi.fn(() => deferred.promise);
    const onError = vi.fn();
    renderGrid({ status: "Validée", canEdit: true, onSave, onError });
    const note = screen.getByLabelText("Note /20") as HTMLInputElement;
    fireEvent.change(note, { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer tout" }));

    await screen.findByRole("button", { name: "Enregistrement…" });
    deferred.reject(new Error("Riziki Masumbuko : échec réseau"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Enregistrer tout" })).not.toBeDisabled());
    expect(note).toHaveValue(14);
    expect(onError).toHaveBeenCalledWith("Riziki Masumbuko : échec réseau");
  });

  it("H — 3 élèves dirty : un seul onSave avec un batch de 3", async () => {
    const { onSave } = renderGrid({ status: "Validée", canEdit: true, studentRows: students });
    const notes = screen.getAllByLabelText("Note /20");
    fireEvent.change(notes[0], { target: { value: "14" } });
    fireEvent.change(notes[1], { target: { value: "12" } });
    fireEvent.change(notes[2], { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer tout" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const batch = (onSave as ReturnType<typeof vi.fn>).mock.calls[0][0] as StudentGrade[];
    expect(batch).toHaveLength(3);
    expect(batch.map((row) => row.studentId).sort()).toEqual(["s1", "s2", "s3"]);
  });

  it("I — note déjà Validée : input verrouillé", () => {
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

  it("statut absence nettoie la valeur et reste local jusqu'à Enregistrer tout", async () => {
    const { onSave } = renderGrid({ status: "Validée", canEdit: true });
    const note = screen.getByLabelText("Note /20") as HTMLInputElement;
    const status = screen.getByLabelText("Statut de la note") as HTMLSelectElement;

    fireEvent.change(note, { target: { value: "14" } });
    fireEvent.change(status, { target: { value: "Absente" } });

    expect(note).toHaveValue(null);
    expect(note).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer tout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ studentId: "s1", gradeStatus: "Absente", value: undefined }),
    ]);
  });

  it("évaluation sans enseignant canonique : bloque avant onSave", async () => {
    const { onSave, onError } = renderGrid({ status: "Validée", canEdit: true, teacherId: "" });
    fireEvent.change(screen.getByLabelText("Note /20"), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer tout" }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        "Aucun enseignant n'est affecté à cette évaluation. Vérifiez l'affectation du cours.",
      ),
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});
