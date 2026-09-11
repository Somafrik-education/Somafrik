/**
 * FIN-L3-08 — fixture commune Web ↔ Mobile.
 * Même élève, même opération : studentId UUID canonique, matricule, montant, devise.
 */
import {
  CLASS_ID,
  CLASS_NAME,
  FOREIGN_TENANT_CODE,
  FOREIGN_TENANT_UUID,
  OTHER_STUDENT_CODE,
  OTHER_STUDENT_UUID,
  SCHOOL_CODE,
  STUDENT_CODE,
  STUDENT_UUID,
  paymentStudentOptionRow,
} from "./financeStudentIdentity.fixtures";

export const L308_SCHOOL_CODE = SCHOOL_CODE;
export const L308_AMOUNT = 25_000;
export const L308_CURRENCY = "CDF";
export const L308_METHOD = "Espèces";
export const L308_DATE = "2026-09-11";
export const L308_CLASS_ID = CLASS_ID;

export const L308_HOMONYM_A = paymentStudentOptionRow({
  studentId: STUDENT_UUID,
  studentCode: STUDENT_CODE,
  firstName: "Jean",
  lastName: "Mbala",
  classId: CLASS_ID,
  classCode: "6A",
  className: CLASS_NAME,
  schoolCode: SCHOOL_CODE,
  classes: [{ classId: CLASS_ID, classCode: "6A", className: CLASS_NAME }],
});

export const L308_HOMONYM_B = paymentStudentOptionRow({
  studentId: OTHER_STUDENT_UUID,
  studentCode: OTHER_STUDENT_CODE,
  firstName: "Jean",
  lastName: "Mbala",
  classId: "class-5b",
  classCode: "5B",
  className: "5ème B",
  schoolCode: SCHOOL_CODE,
  classes: [{ classId: "class-5b", classCode: "5B", className: "5ème B" }],
});

export const L308_FOREIGN = paymentStudentOptionRow({
  studentId: FOREIGN_TENANT_UUID,
  studentCode: FOREIGN_TENANT_CODE,
  firstName: "Intru",
  lastName: "Étranger",
  classId: "class-foreign",
  classCode: "TLE",
  className: "Terminale",
  schoolCode: "CD-XX-OTH-26",
  classes: [{ classId: "class-foreign", classCode: "TLE", className: "Terminale" }],
});

export function l308PickerLabel(student: {
  name?: string;
  firstName?: string;
  lastName?: string;
  className?: string;
  studentCode?: string;
  matricule?: string;
}): string {
  const name =
    String(student.name ?? "").trim() ||
    `${String(student.firstName ?? "").trim()} ${String(student.lastName ?? "").trim()}`.trim();
  const className = String(student.className ?? "").trim();
  const code = String(student.studentCode ?? student.matricule ?? "").trim();
  return [name, className, code].filter(Boolean).join(" · ");
}
