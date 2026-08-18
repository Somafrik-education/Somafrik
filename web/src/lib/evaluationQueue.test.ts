import { describe, expect, it } from "vitest";
import type { BackOfficeState, Evaluation, SessionUser } from "../types";
import {
  ALL_PERIODS_FILTER,
  ALL_STATUSES_FILTER,
  PENDING_VALIDATION_FILTER,
  evaluationsEmptyDescription,
  filterEvaluationsForQueue,
  isPendingValidationStatus,
  periodFilterOptions,
  resolveEvaluationsQueueDefaults,
} from "./evaluationQueue";

const interrogation1: Evaluation = {
  id: "EVAL-1",
  schoolCode: "CD-2026-0001",
  className: "2ème A",
  subject: "Mathématiques",
  period: "Trimestre 1",
  evaluationType: "Interrogation",
  title: "Interrogation 1",
  scale: 20,
  coefficient: 1,
  status: "Brouillon",
  active: true,
};

const trim3: Evaluation = {
  ...interrogation1,
  id: "EVAL-3",
  title: "Devoir Trimestre 3",
  period: "Trimestre 3",
  status: "Saisie terminée",
};

const validated: Evaluation = {
  ...interrogation1,
  id: "EVAL-V",
  title: "Interrogation validée",
  status: "Validée",
};

const otherSchool: Evaluation = {
  ...interrogation1,
  id: "EVAL-BI",
  schoolCode: "BI-2026-0002",
  title: "Éval BI",
};

const prefet: SessionUser = {
  id: "prefet-jp",
  role: "Préfet des études",
  schoolCode: "CD-2026-0001",
  firstName: "Jean",
  lastName: "Pierre",
};

const admin: SessionUser = {
  id: "admin-1",
  role: "Admin School",
  schoolCode: "CD-2026-0001",
};

const teacher: SessionUser = {
  id: "ens-seke",
  role: "Enseignant",
  schoolCode: "CD-2026-0001",
};

describe("resolveEvaluationsQueueDefaults", () => {
  it("Préfet / Admin / Proviseur / Directeur : Toutes les périodes + À valider", () => {
    for (const user of [
      prefet,
      admin,
      { ...prefet, role: "Proviseur" },
      { ...prefet, role: "Directeur" },
    ]) {
      expect(resolveEvaluationsQueueDefaults(user)).toEqual({
        periodFilter: ALL_PERIODS_FILTER,
        statusFilter: PENDING_VALIDATION_FILTER,
        showStatusFilter: true,
      });
    }
  });

  it("Enseignant : conserve la période académique (pas Toutes / À valider)", () => {
    expect(resolveEvaluationsQueueDefaults(teacher)).toEqual({
      periodFilter: null,
      statusFilter: ALL_STATUSES_FILTER,
      showStatusFilter: false,
    });
  });
});

describe("filterEvaluationsForQueue — file Préfet", () => {
  const rows = [interrogation1, trim3, validated, otherSchool];

  it("À valider + toutes périodes : Interrogation 1 visible malgré Trimestre 3 actif", () => {
    const scoped = rows.filter((row) => row.schoolCode === "CD-2026-0001");
    const visible = filterEvaluationsForQueue(scoped, ALL_PERIODS_FILTER, PENDING_VALIDATION_FILTER);
    expect(visible.map((row) => row.title)).toEqual(["Interrogation 1", "Devoir Trimestre 3"]);
    expect(visible.some((row) => row.status === "Validée")).toBe(false);
  });

  it("filtre Trimestre 1 → Trimestre 1 seulement (après scope établissement)", () => {
    const scoped = rows.filter((row) => row.schoolCode === "CD-2026-0001");
    const visible = filterEvaluationsForQueue(scoped, "Trimestre 1", ALL_STATUSES_FILTER);
    expect(visible.every((row) => row.period === "Trimestre 1")).toBe(true);
    expect(visible.map((row) => row.title)).toEqual(["Interrogation 1", "Interrogation validée"]);
    expect(scoped.some((row) => row.schoolCode === "BI-2026-0002")).toBe(false);
  });

  it("filtre Trimestre 3 → Trimestre 3 seulement", () => {
    const visible = filterEvaluationsForQueue(rows, "Trimestre 3", ALL_STATUSES_FILTER);
    expect(visible.map((row) => row.title)).toEqual(["Devoir Trimestre 3"]);
    expect(visible.some((row) => row.title === "Interrogation 1")).toBe(false);
  });

  it("Validée disparaît de À valider", () => {
    expect(isPendingValidationStatus("Validée")).toBe(false);
    const visible = filterEvaluationsForQueue([validated, interrogation1], ALL_PERIODS_FILTER, PENDING_VALIDATION_FILTER);
    expect(visible.map((row) => row.title)).toEqual(["Interrogation 1"]);
  });

  it("Publiée et Annulée hors file À valider", () => {
    expect(isPendingValidationStatus("Publiée")).toBe(false);
    expect(isPendingValidationStatus("Annulée")).toBe(false);
    expect(isPendingValidationStatus("Brouillon")).toBe(true);
    expect(isPendingValidationStatus("Ouverte")).toBe(true);
    expect(isPendingValidationStatus("Saisie terminée")).toBe(true);
  });
});

describe("periodFilterOptions", () => {
  it("Select : Toutes les périodes + référentiel académique, pas de texte libre", () => {
    const state = {
      academicConfigs: {
        "CD-2026-0001": {
          periods: [
            { name: "Trimestre 1" },
            { name: "Trimestre 2" },
            { name: "Trimestre 3" },
          ],
        },
      },
    } as unknown as BackOfficeState;
    const options = periodFilterOptions(state, "CD-2026-0001", [interrogation1]);
    expect(options[0]).toEqual({ value: "", label: "Toutes les périodes" });
    expect(options.map((row) => row.label)).toEqual([
      "Toutes les périodes",
      "Trimestre 1",
      "Trimestre 2",
      "Trimestre 3",
    ]);
  });
});

describe("evaluationsEmptyDescription", () => {
  it("file À valider vide sans période forcée", () => {
    expect(evaluationsEmptyDescription("", PENDING_VALIDATION_FILTER)).toBe("Aucune évaluation à valider.");
  });

  it("période explicite Trimestre 3", () => {
    expect(evaluationsEmptyDescription("Trimestre 3", PENDING_VALIDATION_FILTER)).toBe(
      "Aucune évaluation pour la période « Trimestre 3 ».",
    );
  });
});
