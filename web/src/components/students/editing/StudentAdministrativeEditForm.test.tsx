import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EditableStudentAdministrativeDetails } from "../../../lib/studentEditing";
import { StudentAdministrativeEditForm } from "./StudentAdministrativeEditForm";

const value: EditableStudentAdministrativeDetails = {
  studentId: "ctx-student-1",
  schoolCode: "CD-LAC-26-001",
  version: 1,
  updatedAt: "2026-09-30T12:00:00.000Z",
  administrativeNotes: "ancienne",
  preferredContactChannel: null,
};

describe("StudentAdministrativeEditForm", () => {
  it("laisse saisir les notes et bloque le canal non persisté", async () => {
    function Harness() {
      const [draft, setDraft] = useState<Partial<EditableStudentAdministrativeDetails>>({});
      return (
        <StudentAdministrativeEditForm
          value={value}
          draft={draft}
          errors={[]}
          onChange={setDraft}
        />
      );
    }
    const user = userEvent.setup();
    render(<Harness />);

    const channel = screen.getByLabelText("Canal de contact préféré");
    expect(channel).toBeDisabled();
    expect(screen.getByText(/sont persistées/i)).toBeInTheDocument();

    const notes = screen.getByLabelText("Notes administratives");
    await user.clear(notes);
    await user.type(notes, "brouillon reseau");
    expect(notes).toHaveValue("brouillon reseau");
  });

  it("affiche l'erreur de champ sans remplacer le brouillon", () => {
    render(
      <StudentAdministrativeEditForm
        value={value}
        draft={{ administrativeNotes: "brouillon conservé" }}
        errors={[
          {
            field: "administrativeNotes",
            code: "ADMINISTRATIVE_HTTP",
            message: "Enregistrement impossible. Réessayez.",
          },
        ]}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText("Notes administratives")).toHaveValue("brouillon conservé");
    expect(screen.getByRole("alert")).toHaveTextContent("Enregistrement impossible");
  });
});
