/**
 * FIN-L3-08 RED-PARITÉ — même élève, même opération, même identifiant canonique.
 *
 * Cause visée : Web cherche/sélectionne via searchStudentsForPayment (UUID + matricule).
 * Mobile mappe le catalogue sans studentCode et n'a pas de recherche équivalente,
 * donc le contrat d'identité n'est pas le même.
 */
import { describe, expect, it } from "vitest";
import * as mobileEnrollment from "../../../Mobile/src/lib/paymentEnrollment";
import { searchStudentsForPayment } from "./quickPayment";
import {
  L308_CURRENCY,
  L308_FOREIGN,
  L308_HOMONYM_A,
  L308_HOMONYM_B,
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

describe("FIN-L3-08 RED-PARITÉ — Web ↔ Mobile sélecteur élève", () => {
  it("FIN-L3-08-P-IDENTITY — même catalogue → même studentId UUID + même matricule", () => {
    const options = [L308_HOMONYM_A, L308_HOMONYM_B, L308_FOREIGN];
    const webHits = searchStudentsForPayment("Mbala", webRosterFromOptions(options), schools as never, SCHOOL_CODE);
    expect(webHits.map((row) => row.id).sort()).toEqual(
      [L308_HOMONYM_A.studentId, L308_HOMONYM_B.studentId].sort(),
    );

    const mobileRows = mobileEnrollment.paymentStudentsFromOptions(options);
    const jean = mobileRows.filter((row) => row.id === L308_HOMONYM_A.studentId);
    expect(jean).toHaveLength(1);
    expect(jean[0].id).toBe(L308_HOMONYM_A.studentId);
    expect((jean[0] as { studentCode?: string }).studentCode).toBe(L308_HOMONYM_A.studentCode);

    const search = (mobileEnrollment as { searchPaymentStudents?: Function }).searchPaymentStudents;
    expect(typeof search).toBe("function");
    const mobileHits = search!("Mbala", mobileRows, L308_SCHOOL_CODE);
    expect(mobileHits.map((row: { id: string }) => row.id).sort()).toEqual(
      webHits.map((row) => row.id).sort(),
    );
  });

  it("FIN-L3-08-P-TENANT — ni Web ni Mobile ne retiennent l'élève étranger pour le même catalogue", () => {
    const options = [L308_HOMONYM_A, L308_FOREIGN];
    const webHits = searchStudentsForPayment("Intru", webRosterFromOptions(options), schools as never, SCHOOL_CODE);
    expect(webHits).toEqual([]);

    const search = (mobileEnrollment as { searchPaymentStudents?: Function }).searchPaymentStudents;
    expect(typeof search).toBe("function");
    const mobileHits = search!(
      "Intru",
      mobileEnrollment.paymentStudentsFromOptions(options),
      L308_SCHOOL_CODE,
    );
    expect(mobileHits).toEqual([]);
  });
});
