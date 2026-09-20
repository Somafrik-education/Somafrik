import { describe, expect, it } from "vitest";
import { collectOpenObligationsFromProjection } from "./financePaymentWrite";
import {
  CLASS_NAME,
  ESTHER_CLASS_NAME,
  ESTHER_CODE,
  ESTHER_UUID,
  FOREIGN_TENANT_CODE,
  FOREIGN_TENANT_UUID,
  OBLIGATION_INSC_ID,
  OBLIGATION_SCO_ID,
  OPEN_BALANCE_CDF,
  OTHER_STUDENT_CODE,
  OTHER_STUDENT_UUID,
  STUDENT_CODE,
  STUDENT_UUID,
  postgresObligationRow,
} from "./financeStudentIdentity.fixtures";

describe("IMP-FAST — identité UUID PostgreSQL ↔ code élève public", () => {
  it("IMP-FAST-RED-02 — payment-student-options UUID + student-fees code public / studentDbId UUID → obligation ouverte retrouvée", () => {
    const fees = [
      postgresObligationRow({
        studentId: STUDENT_CODE,
        studentDbId: STUDENT_UUID,
        balance: OPEN_BALANCE_CDF,
      }),
    ];

    const byUuid = collectOpenObligationsFromProjection(STUDENT_UUID, fees);
    expect(byUuid.map((row) => row.obligationId)).toEqual([OBLIGATION_SCO_ID]);
    expect(byUuid[0]?.balance).toBe(OPEN_BALANCE_CDF);

    const byPublicCode = collectOpenObligationsFromProjection(STUDENT_CODE, fees);
    expect(byPublicCode.map((row) => row.obligationId)).toEqual([OBLIGATION_SCO_ID]);
  });

  it("IMP-FAST-RED-05 — plusieurs obligations ouvertes du même élève, aucune d'un autre élève ou tenant", () => {
    const fees = [
      postgresObligationRow({
        id: OBLIGATION_INSC_ID,
        obligationId: OBLIGATION_INSC_ID,
        label: "Inscription",
        feeType: "Inscription",
        balance: 50_000,
        amountDue: 50_000,
      }),
      postgresObligationRow({
        id: OBLIGATION_SCO_ID,
        obligationId: OBLIGATION_SCO_ID,
        label: "Scolarité T1",
        balance: OPEN_BALANCE_CDF,
        amountDue: OPEN_BALANCE_CDF,
      }),
      postgresObligationRow({
        id: "obl-other",
        obligationId: "obl-other",
        studentId: OTHER_STUDENT_CODE,
        studentDbId: OTHER_STUDENT_UUID,
        label: "Uniforme autre élève",
        feeType: "Uniforme",
        balance: 20_000,
        amountDue: 20_000,
      }),
      postgresObligationRow({
        id: "obl-foreign",
        obligationId: "obl-foreign",
        studentId: FOREIGN_TENANT_CODE,
        studentDbId: FOREIGN_TENANT_UUID,
        label: "Scolarité tenant B",
        feeType: "Scolarité",
        balance: 99_000,
        amountDue: 99_000,
      }),
    ];

    const open = collectOpenObligationsFromProjection(STUDENT_UUID, fees);
    expect(open.map((row) => row.obligationId).sort()).toEqual(
      [OBLIGATION_INSC_ID, OBLIGATION_SCO_ID].sort(),
    );
    expect(open.some((row) => row.label.includes("autre élève"))).toBe(false);
    expect(open.some((row) => row.label.includes("tenant B"))).toBe(false);
  });

  it("P1-ESTHER — UUID roster + matricule CG-ITC-OE-26-00001 + reste / solde / tenant", () => {
    const estherIdentity = {
      id: ESTHER_UUID,
      studentId: ESTHER_UUID,
      studentDbId: ESTHER_UUID,
      studentCode: ESTHER_CODE,
      matricule: ESTHER_CODE,
    };
    const openFee = postgresObligationRow({
      studentId: ESTHER_CODE,
      studentDbId: ESTHER_UUID,
      className: ESTHER_CLASS_NAME,
      balance: OPEN_BALANCE_CDF,
      amountDue: OPEN_BALANCE_CDF,
    });
    const partial = postgresObligationRow({
      id: "obl-esther-partial",
      obligationId: "obl-esther-partial",
      studentId: ESTHER_CODE,
      studentDbId: ESTHER_UUID,
      label: "Inscription",
      status: "Partiellement payé",
      amountDue: 50_000,
      amountPaid: 20_000,
      balance: 30_000,
    });
    const settled = postgresObligationRow({
      id: "obl-esther-paid",
      obligationId: "obl-esther-paid",
      studentId: ESTHER_CODE,
      studentDbId: ESTHER_UUID,
      label: "Uniforme",
      status: "Payé",
      amountDue: 15_000,
      amountPaid: 15_000,
      balance: 0,
    });
    const foreign = postgresObligationRow({
      id: "obl-foreign",
      obligationId: "obl-foreign",
      studentId: FOREIGN_TENANT_CODE,
      studentDbId: FOREIGN_TENANT_UUID,
      label: "Scolarité tenant B",
      balance: 99_000,
    });

    const open = collectOpenObligationsFromProjection(estherIdentity, [
      openFee,
      partial,
      settled,
      foreign,
    ]);
    expect(open.map((row) => row.obligationId).sort()).toEqual(
      [OBLIGATION_SCO_ID, "obl-esther-partial"].sort(),
    );
    expect(open.find((row) => row.obligationId === OBLIGATION_SCO_ID)?.balance).toBe(OPEN_BALANCE_CDF);
    expect(open.find((row) => row.obligationId === "obl-esther-partial")?.balance).toBe(30_000);
    expect(open.some((row) => row.obligationId === "obl-esther-paid")).toBe(false);
    expect(open.some((row) => row.label.includes("tenant B"))).toBe(false);
    expect(collectOpenObligationsFromProjection(estherIdentity, [])).toEqual([]);
  });

  it("IMP-FAST-GREEN-09 — le rapprochement ignore nom / prénom / classe", () => {
    const fees = [
      postgresObligationRow({
        studentId: "HOMONYME-CODE",
        studentDbId: "dddddddd-4444-4444-8444-dddddddddddd",
        label: "Scolarité homonyme",
        className: CLASS_NAME,
      }),
    ];
    const open = collectOpenObligationsFromProjection(
      { studentId: STUDENT_UUID, studentCode: STUDENT_CODE, matricule: STUDENT_CODE },
      fees,
    );
    expect(open).toEqual([]);
  });
});
