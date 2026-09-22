import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import {
  buildParentDashboardMetrics,
  filterParentDashboardRows,
  isParentDashboardRole,
  resolveParentDashboardStudent,
} from "./parentDashboard";

const childA = {
  id: "stu-a",
  matricule: "ELE-A",
  name: "Enfant A",
  className: "6e A",
};
const childB = {
  id: "stu-b",
  matricule: "ELE-B",
  name: "Enfant B",
  className: "5e B",
};

const parent: SessionUser = {
  id: "parent-a",
  role: "Parent",
  roleKeys: ["PARENT"],
  schoolCode: "SCH-001",
  children: [childA],
};

describe("parentDashboard — scope enfant", () => {
  it("détecte uniquement le rôle Parent", () => {
    expect(isParentDashboardRole(parent)).toBe(true);
    expect(isParentDashboardRole({ id: "t", role: "Enseignant", roleKeys: ["TEACHER"] })).toBe(false);
  });

  it("refuse une sélection étrangère et retombe sur un enfant lié", () => {
    const selected = resolveParentDashboardStudent(
      parent,
      { students: [childA, childB] },
      "stu-b",
    );
    expect(selected?.id).toBe("stu-a");
  });

  it("filtre les lignes sur les alias de l'enfant sélectionné", () => {
    const rows = filterParentDashboardRows(
      [
        { id: "n1", studentId: "ELE-A", value: 16 },
        { id: "n2", studentId: "stu-b", value: 2 },
      ],
      childA,
    );
    expect(rows.map((row) => row.id)).toEqual(["n1"]);
  });

  it("calcule les KPI sans contribution d'un autre enfant", () => {
    const metrics = buildParentDashboardMetrics({
      student: childA,
      notes: [
        {
          id: "g-a",
          studentId: "stu-a",
          schoolCode: "SCH-001",
          evaluationId: "e1",
          subject: "Mathématiques",
          period: "T1",
          value: 16,
          scale: 20,
          evaluationCoefficient: 1,
          gradeStatus: "Validée",
        },
        {
          id: "g-b",
          studentId: "stu-b",
          schoolCode: "SCH-001",
          evaluationId: "e2",
          subject: "Mathématiques",
          period: "T1",
          value: 2,
          scale: 20,
          evaluationCoefficient: 1,
          gradeStatus: "Validée",
        },
      ],
      presences: [
        { id: "p-a-1", studentId: "ELE-A", status: "Présent" },
        { id: "p-a-2", studentId: "stu-a", status: "Absent" },
        { id: "p-b", studentId: "stu-b", status: "Présent" },
      ],
      studentFees: [
        {
          id: "f-a",
          studentId: "stu-a",
          amountDue: 100,
          amountPaid: 40,
          balance: 60,
          currency: "EUR",
        },
        {
          id: "f-b",
          studentId: "stu-b",
          amountDue: 999,
          amountPaid: 999,
          balance: 0,
          currency: "EUR",
        },
      ],
      payments: [
        { id: "pay-a", studentId: "stu-a", amount: 40, currency: "EUR" },
        { id: "pay-b", studentId: "stu-b", amount: 999, currency: "EUR" },
      ],
    });

    expect(metrics.average).toBe(16);
    expect(metrics.evaluationCount).toBe(1);
    expect(metrics.presenceRate).toBe(50);
    expect(metrics.presenceRecorded).toBe(2);
    expect(metrics.expectedAmount).toBe(100);
    expect(metrics.paidAmount).toBe(40);
    expect(metrics.remainingAmount).toBe(60);
    expect(metrics.paymentAmount).toBe(40);
    expect(metrics.paymentCount).toBe(1);
  });
});
