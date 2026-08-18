import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClassGradesOverview } from "./ClassGradesOverview";
import { ALL_PERIODS_FILTER } from "../../lib/evaluationQueue";
import type { BackOfficeState, SessionUser } from "../../types";

const admin = {
  id: "u-admin",
  role: "Admin School",
  schoolCode: "IN",
  name: "Admin",
} as SessionUser;

function stateWithRiziki14(): BackOfficeState {
  return {
    schools: [{ code: "IN", name: "IN" }],
    classes: [{ id: "uuid-2a", name: "2ème A", schoolCode: "IN" }],
    students: [
      {
        id: "STU-RIZIKI",
        name: "Riziki Test",
        firstName: "Riziki",
        lastName: "Test",
        className: "2ème A",
        schoolCode: "IN",
      },
    ],
    teachers: [],
    assignments: [],
    courses: [],
    notes: [
      {
        id: "g1",
        studentId: "STU-RIZIKI",
        studentName: "Riziki Test",
        className: "2ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        value: 14,
        scale: 20,
        gradeStatus: "Saisie",
        evaluationCoefficient: 1,
        schoolCode: "IN",
      },
    ],
    evaluations: [],
    academicConfigs: {},
  } as unknown as BackOfficeState;
}

describe("ClassGradesOverview", () => {
  it("Par classe: note 14 / Trimestre 1 affiche Riziki sans crash", () => {
    render(
      <ClassGradesOverview
        className="2ème A"
        period="Trimestre 1"
        state={stateWithRiziki14()}
        user={admin}
      />,
    );

    expect(screen.queryByText("Aucune note pour cette période")).not.toBeInTheDocument();
    expect(screen.getByText("Classement — 2ème A")).toBeInTheDocument();
    expect(screen.getByText("Riziki Test")).toBeInTheDocument();
    expect(screen.getAllByText("14.00").length).toBeGreaterThan(0);
  });

  it("Préfet/Admin Toutes les périodes (period='') affiche les notes au lieu de l'écran vide", () => {
    expect(ALL_PERIODS_FILTER).toBe("");

    render(
      <ClassGradesOverview
        className="2ème A"
        period={ALL_PERIODS_FILTER}
        state={stateWithRiziki14()}
        user={admin}
      />,
    );

    expect(screen.queryByText("Aucune note pour cette période")).not.toBeInTheDocument();
    expect(screen.getByText("Toutes les périodes")).toBeInTheDocument();
    expect(screen.getByText("Riziki Test")).toBeInTheDocument();
    expect(screen.getAllByText("14.00").length).toBeGreaterThan(0);
  });

  it("Statistiques (difficultyThreshold explicite) rend le même classement", () => {
    render(
      <ClassGradesOverview
        className="2ème A"
        period="Trimestre 1"
        state={stateWithRiziki14()}
        user={admin}
        difficultyThreshold={10}
      />,
    );

    expect(screen.getByText("Classement — 2ème A")).toBeInTheDocument();
    expect(screen.getByText("Moyenne de classe")).toBeInTheDocument();
    expect(screen.getAllByText("14.00").length).toBeGreaterThan(0);
  });

  it("période sans notes: cartouche ambre, pas de crash", () => {
    render(
      <ClassGradesOverview
        className="2ème A"
        period="Trimestre 3"
        state={stateWithRiziki14()}
        user={admin}
      />,
    );

    expect(screen.getByText("Aucune note pour cette période")).toBeInTheDocument();
    expect(screen.getByText(/Trimestre 3/)).toBeInTheDocument();
    expect(screen.queryByText("14.00")).not.toBeInTheDocument();
  });
});
