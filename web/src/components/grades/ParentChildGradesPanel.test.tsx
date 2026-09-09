import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParentChildGradesPanel } from "./ParentChildGradesPanel";
import type { Evaluation, StudentGrade } from "../../types";

const student = {
  id: "stu-a",
  firstName: "Maeve",
  lastName: "Okito",
  className: "1ère A",
};

const mathGrade: StudentGrade = {
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
};

const frenchGrade: StudentGrade = {
  id: "g2",
  schoolCode: "SCH-001",
  studentId: "stu-a",
  evaluationId: "EVAL-2",
  subject: "Français",
  period: "Trimestre 1",
  value: 10,
  scale: 20,
  gradeStatus: "Validée",
  date: "2026-09-02",
};

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
  {
    id: "EVAL-2",
    schoolCode: "SCH-001",
    className: "1ère A",
    subject: "Français",
    period: "Trimestre 1",
    title: "Dictée",
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
        grades={[mathGrade]}
        evaluations={evaluations}
        period="Trimestre 1"
      />,
    );

    expect(screen.getByText("Maeve Okito")).toBeInTheDocument();
    expect(screen.getByText("Moyenne générale")).toBeInTheDocument();
    expect(screen.getByText("16,0 / 20")).toBeInTheDocument();
    expect(screen.getByText("Évaluations")).toBeInTheDocument();
    expect(screen.getByText("Cours évalués")).toBeInTheDocument();
    expect(screen.getByText("Interrogation 1")).toBeInTheDocument();
    expect(screen.getByText("16")).toBeInTheDocument();
    expect(screen.queryByText("Rang")).not.toBeInTheDocument();
    expect(screen.queryByText("Meilleure moyenne")).not.toBeInTheDocument();
    expect(screen.queryByText("Plus faible")).not.toBeInTheDocument();
    expect(screen.queryByText(/Classement/)).not.toBeInTheDocument();
  });

  it("KPI tous cours = moyenne générale, filtre Cours = moyenne de la matière", () => {
    const { rerender } = render(
      <ParentChildGradesPanel
        student={student}
        grades={[mathGrade, frenchGrade]}
        evaluations={evaluations}
        period="Trimestre 1"
      />,
    );

    expect(screen.getByText("Moyenne générale")).toBeInTheDocument();
    expect(screen.getByText("13,0 / 20")).toBeInTheDocument();
    expect(screen.getAllByText("2")).toHaveLength(2);

    rerender(
      <ParentChildGradesPanel
        student={student}
        grades={[mathGrade]}
        evaluations={evaluations}
        period="Trimestre 1"
        courseFilter="Mathématiques"
      />,
    );

    expect(screen.getByText("Moyenne Mathématiques")).toBeInTheDocument();
    expect(screen.getByText("16,0 / 20")).toBeInTheDocument();
    expect(screen.queryByText("Moyenne générale")).not.toBeInTheDocument();
    expect(screen.queryByText("13,0 / 20")).not.toBeInTheDocument();
    expect(screen.queryByText("Dictée")).not.toBeInTheDocument();
  });
});
