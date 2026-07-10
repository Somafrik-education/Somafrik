import { describe, it, expect } from "vitest";

import {
  validateFeeGridInput,
  findDuplicateFeeGrid,
  feeGridKey,
  studentFeeSummary,
  newFeeId,
} from "../src/lib/fees";
import type { BackOfficeState, FeeGrid, SchoolFeeItem, StudentFee } from "../src/types";

const state = {
  schools: [{ code: "SCH1", name: "École 1", currency: "CDF" }],
  feeGrids: [
    {
      id: "GRID-1",
      schoolCode: "SCH1",
      className: "6A",
      academicYear: "2025-2026",
      periodName: "T1",
      status: "Active",
      currency: "CDF",
    },
  ],
  academicConfigs: { SCH1: { classNames: ["6A", "6B"] } },
} as unknown as BackOfficeState;

const validItems: Partial<SchoolFeeItem>[] = [
  { label: "Inscription", amount: 50_000, feeType: "Inscription", status: "Actif" },
];

describe("Frais et tarifs", () => {
  it("génère un identifiant de frais avec préfixe", () => {
    expect(newFeeId("FEE")).toMatch(/^FEE-/);
  });

  it("construit une clé unique de grille tarifaire", () => {
    expect(
      feeGridKey({
        schoolCode: "SCH1",
        className: "6A",
        academicYear: "2025-2026",
        periodName: "T1",
      }),
    ).toBe("sch1|6a|2025-2026|t1");
  });

  it("accepte une grille tarifaire valide", () => {
    const result = validateFeeGridInput(
      {
        schoolCode: "SCH1",
        className: "6B",
        academicYear: "2025-2026",
        currency: "CDF",
      },
      validItems,
      state,
    );
    expect(result.ok).toBe(true);
  });

  it("rejette une grille sans classe", () => {
    const result = validateFeeGridInput(
      { schoolCode: "SCH1", academicYear: "2025-2026", currency: "CDF" },
      validItems,
      state,
    );
    expect(result.error).toMatch(/classe/i);
  });

  it("rejette un montant négatif ou nul", () => {
    const result = validateFeeGridInput(
      { schoolCode: "SCH1", className: "6B", academicYear: "2025-2026", currency: "CDF" },
      [{ label: "Inscription", amount: -100, feeType: "Inscription", status: "Actif" }],
      state,
    );
    expect(result.error).toMatch(/positif/i);
  });

  it("rejette une grille tarifaire déjà existante", () => {
    const duplicate = findDuplicateFeeGrid(state.feeGrids ?? [], {
      id: "GRID-NEW",
      schoolCode: "SCH1",
      className: "6A",
      academicYear: "2025-2026",
      periodName: "T1",
    });
    expect(duplicate?.id).toBe("GRID-1");
  });

  it("calcule le résumé financier d'un élève", () => {
    const fees: StudentFee[] = [
      { id: "F1", amountDue: 100_000, amountPaid: 40_000, balance: 60_000, status: "Partiellement payé" } as StudentFee,
      { id: "F2", amountDue: 50_000, amountPaid: 50_000, balance: 0, status: "Payé" } as StudentFee,
    ];
    const summary = studentFeeSummary(fees);
    expect(summary.totalDue).toBe(150_000);
    expect(summary.totalPaid).toBe(90_000);
    expect(summary.totalBalance).toBe(60_000);
    expect(summary.count).toBe(2);
  });

  it("exige au moins un mois pour une mensualité", () => {
    const result = validateFeeGridInput(
      { schoolCode: "SCH1", className: "6B", academicYear: "2025-2026", currency: "CDF" },
      [{ label: "Mensualité", amount: 20_000, feeType: "Mensualité", status: "Actif", monthlyMonths: [] }],
      state,
    );
    expect(result.error).toMatch(/mois/i);
  });
});
