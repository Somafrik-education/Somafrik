import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParentChildGradesPanel } from "./ParentChildGradesPanel";
import type { BackOfficeState, Evaluation, SessionUser, StudentGrade } from "../../types";

vi.mock("../../lib/evaluations", () => ({
  buildGradeBook: () => ({
    getStudentAverage: () => ({
      average: 14.5,
      rank: 1,
      rankLabel: "1e / 28",
      appreciation: "Très Bien",
      subjects: [{ subject: "Mathématiques" }, { subject: "Français" }],
    }),
  }),
}));

const student = {
  id: "stu-a",
  firstName: "Maeve",
  lastName: "Okito",
  className: "1ère A",
};

const grades: StudentGrade[] = [
  {
    id: "g1",
    schoolCode: "SCH-001",
    studentId: "stu-a",
    evaluationId: "EVAL-1",
    subject: "Mathématiques",
    period: "Trimestre 1",
    value: 16,
    scale: 20,
    gradeStatus: "Validée",
    date: "2026-09-01",
  },
];

const evaluations: Evaluation[] = [
  {
    id: "EVAL-1",
    schoolCode: "SCH-001",
    className: "1ère A",
    subject: "Mathématiques",
    period: "Trimestre 1",
    title: "Interrogation 1",
    evaluationType: "Interrogation",
    scale: 20,
    coefficient: 1,
    status: "Publiée",
    active: true,
  },
];

describe("ParentChildGradesPanel", () => {
  it("affiche les cartes de l'enfant sans classement ni statistiques de classe", () => {
    render(
      <ParentChildGradesPanel
        student={student}
        grades={grades}
        evaluations={evaluations}
        state={{ students: [student] } as unknown as BackOfficeState}
        user={{ id: "p", role: "Parent" } as SessionUser}
        period="Trimestre 1"
      />,
    );

    expect(screen.getByText("Maeve Okito")).toBeInTheDocument();
    expect(screen.getByText("Moyenne générale")).toBeInTheDocument();
    expect(screen.getByText("14,5 / 20")).toBeInTheDocument();
    expect(screen.getByText("Évaluations")).toBeInTheDocument();
    expect(screen.getByText("Cours évalués")).toBeInTheDocument();
    expect(screen.getByText("Interrogation 1")).toBeInTheDocument();
    expect(screen.getByText("16")).toBeInTheDocument();
    expect(screen.queryByText("Rang")).not.toBeInTheDocument();
    expect(screen.queryByText("Meilleure moyenne")).not.toBeInTheDocument();
    expect(screen.queryByText("Plus faible")).not.toBeInTheDocument();
    expect(screen.queryByText(/Classement/)).not.toBeInTheDocument();
  });
});
