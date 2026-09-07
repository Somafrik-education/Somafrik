import { describe, expect, it } from "vitest";
import { collectOpenObligationsFromProjection } from "./financePaymentWrite";
import {
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
});
