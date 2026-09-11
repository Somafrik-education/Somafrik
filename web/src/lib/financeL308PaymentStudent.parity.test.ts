/**
 * FIN-L3-08 PARITÉ — même élève, même opération, même identifiant canonique.
 */
import { describe, expect, it } from "vitest";
import {
  buildFinancePaymentWritePayload as mobileWrite,
  paymentStudentsFromOptions,
  searchPaymentStudents,
} from "../../../Mobile/src/lib/paymentEnrollment";
import { buildFinancePaymentWritePayload as webWrite } from "./financePaymentWrite";
import { searchStudentsForPayment } from "./quickPayment";
import {
  L308_AMOUNT,
  L308_CLASS_ID,
  L308_CURRENCY,
  L308_DATE,
  L308_FOREIGN,
  L308_HOMONYM_A,
  L308_HOMONYM_B,
  L308_METHOD,
  L308_SCHOOL_CODE,
} from "./financeL308PaymentStudent.fixture";
import { SCHOOL_CODE } from "./financeStudentIdentity.fixtures";

const schools = [{ code: L308_SCHOOL_CODE, name: "Lycée Test", currency: L308_CURRENCY }];

function webRosterFromOptions(rows: Array<Record<string, unknown>>) {
  return rows.flatMap((option) => {
    const classes = Array.isArray(option.classes) && option.classes.length
      ? option.classes
      : option.classId
        ? [{ classId: option.classId, classCode: option.classCode, className: option.className }]
        : [];
    return classes.map((klass: { classId?: unknown; classCode?: unknown; className?: unknown }) => ({
      id: String(option.studentId ?? ""),
      studentId: String(option.studentId ?? ""),
      firstName: String(option.firstName ?? ""),
      lastName: String(option.lastName ?? ""),
      name: `${option.firstName ?? ""} ${option.lastName ?? ""}`.trim(),
      matricule: String(option.studentCode ?? ""),
      studentCode: String(option.studentCode ?? ""),
      classId: String(klass.classId ?? ""),
      classCode: String(klass.classCode ?? ""),
      className: String(klass.className ?? ""),
      schoolCode: String(option.schoolCode ?? ""),
    }));
  });
}

describe("FIN-L3-08 PARITÉ — Web ↔ Mobile sélecteur élève", () => {
  it("FIN-L3-08-P-IDENTITY — même catalogue → même studentId UUID + même matricule", () => {
    const options = [L308_HOMONYM_A, L308_HOMONYM_B, L308_FOREIGN];
    const webHits = searchStudentsForPayment("Mbala", webRosterFromOptions(options), schools as never, SCHOOL_CODE);
    expect(webHits.map((row) => row.id).sort()).toEqual(
      [L308_HOMONYM_A.studentId, L308_HOMONYM_B.studentId].sort(),
    );

    const mobileRows = paymentStudentsFromOptions(options);
    const jean = mobileRows.filter((row) => row.id === L308_HOMONYM_A.studentId);
    expect(jean).toHaveLength(1);
    expect(jean[0].id).toBe(L308_HOMONYM_A.studentId);
    expect(jean[0].studentCode).toBe(L308_HOMONYM_A.studentCode);

    const mobileHits = searchPaymentStudents("Mbala", mobileRows, L308_SCHOOL_CODE);
    expect(mobileHits.map((row) => row.id).sort()).toEqual(webHits.map((row) => row.id).sort());
  });

  it("FIN-L3-08-P-TENANT — ni Web ni Mobile ne retiennent l'élève étranger pour le même catalogue", () => {
    const options = [L308_HOMONYM_A, L308_FOREIGN];
    const webHits = searchStudentsForPayment("Intru", webRosterFromOptions(options), schools as never, SCHOOL_CODE);
    expect(webHits).toEqual([]);
    expect(searchPaymentStudents("Intru", paymentStudentsFromOptions(options), L308_SCHOOL_CODE)).toEqual([]);
  });

  it("FIN-L3-08-P-PAYLOAD — même élève + même opération → même studentId, montant, méthode", () => {
    const webPayload = webWrite({
      studentId: L308_HOMONYM_A.studentId,
      classId: L308_CLASS_ID,
      paymentMethod: L308_METHOD,
      paidAt: L308_DATE,
      lines: [{ obligationId: "__unallocated__", amount: L308_AMOUNT, label: "Non imputé" }],
    });
    const mobilePayload = mobileWrite({
      studentId: L308_HOMONYM_A.studentId,
      classId: L308_CLASS_ID,
      method: L308_METHOD,
      date: L308_DATE,
      lines: [{ obligationId: "__unallocated__", amount: L308_AMOUNT, label: "Non imputé" }],
    });
    expect(webPayload.studentId).toBe(mobilePayload.studentId);
    expect(webPayload.studentId).toBe(L308_HOMONYM_A.studentId);
    expect((webPayload.items as Array<{ amount: number }>)[0].amount).toBe(L308_AMOUNT);
    expect((mobilePayload.items as Array<{ amount: number }>)[0].amount).toBe(L308_AMOUNT);
    expect(webPayload.method).toBe(L308_METHOD);
    expect(mobilePayload.method).toBe(L308_METHOD);
  });
});
