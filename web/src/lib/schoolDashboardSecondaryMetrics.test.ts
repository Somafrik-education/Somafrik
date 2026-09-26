import { describe, expect, it } from "vitest";
import type { BackOfficeState, SessionUser } from "../types";
import { buildSchoolDashboardSecondaryMetrics } from "./schoolDashboardSecondaryMetrics";

const schoolId = "11111111-1111-4111-8111-111111111111";
const otherSchoolId = "22222222-2222-4222-8222-222222222222";
const user = { role: "Admin School", schoolId, schoolCode: "CD-IN-26-001" } as SessionUser;
const today = new Date();
const date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");

function state(presences: unknown[] = []) {
  return {
    schools: [{ id: schoolId, code: user.schoolCode, name: "École test", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }],
    students: [
      { id: "a", schoolId, schoolCode: user.schoolCode, className: "Primaire A" },
      { id: "b", schoolId, schoolCode: user.schoolCode, className: "Primaire A" },
      { id: "foreign", schoolId: otherSchoolId, schoolCode: "AUTRE", className: "Secondaire B" },
    ],
    classes: [{ id: "cls-a", schoolId, schoolCode: user.schoolCode, name: "Primaire A", level: "Primaire" }],
    presences,
  } as unknown as BackOfficeState;
}

describe("LOT 4 — widgets secondaires établissement", () => {
  it("compte uniquement les élèves du schoolId autorisé et utilise le niveau des classes", () => {
    const result = buildSchoolDashboardSecondaryMetrics(user, state());
    expect(result.levels).toEqual([{ name: "Primaire", value: 2 }]);
    expect(result.attendance.rate).toBeNull();
  });

  it("ne publie aucun taux sur appel partiel, puis compte les retards comme présents", () => {
    const partial = buildSchoolDashboardSecondaryMetrics(user, state([{ studentId: "a", date, status: "Présent" }]));
    expect(partial.attendance.value).toBe("—");
    const complete = buildSchoolDashboardSecondaryMetrics(user, state([
      { studentId: "a", date, status: "Retard" },
      { studentId: "b", date, status: "Justifié" },
    ]));
    expect(complete.attendance.value).toBe("50 %");
    expect(complete.attendance.recorded).toBe(2);
  });

  it("n'invente pas de niveau quand le référentiel est vide", () => {
    const data = state();
    data.classes = [];
    const result = buildSchoolDashboardSecondaryMetrics(user, data);
    expect(result.levels).toEqual([{ name: "Non renseigné", value: 2 }]);
  });
});
