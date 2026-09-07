/**
 * Contrat réel Backend (PostgreSQL) — identités élève Finance.
 *
 * payment-student-options.studentId = UUID interne (st.id)
 * payment-student-options.studentCode = matricule / code public
 * student-fees / mapObligationRow.studentId = profile.studentId || student_code || student_id
 * student-fees.studentDbId = row.student_id (UUID)
 *
 * Les tests IMP-FAST reproduisent ce couple, jamais un identifiant synthétique unique.
 */
export const STUDENT_UUID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const STUDENT_CODE = "CD-IN-TNT-26-00019";
export const STUDENT_FIRST_NAME = "Test";
export const STUDENT_LAST_NAME = "Numérique";
export const STUDENT_NAME = "Test Numérique";
export const OTHER_STUDENT_UUID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
export const OTHER_STUDENT_CODE = "CD-IN-TNT-26-00020";
export const FOREIGN_TENANT_UUID = "cccccccc-3333-4333-8333-cccccccccccc";
export const FOREIGN_TENANT_CODE = "CD-XX-OTH-26-99999";
export const CLASS_ID = "class-6a";
export const CLASS_NAME = "6ème A";
export const SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const SCHOOL_CODE = "CD-IN-26-001";
export const OBLIGATION_SCO_ID = "obl-sco-140k";
export const OBLIGATION_INSC_ID = "obl-insc-50k";
export const OPEN_BALANCE_CDF = 140_000;

export const BLOCKING_OBLIGATION_MISMATCH_MESSAGE =
  "Impossible de retrouver les frais ouverts de cet élève. Actualisez les données ou contactez l'administrateur.";

export function paymentStudentOptionRow(overrides: Record<string, unknown> = {}) {
  return {
    studentId: STUDENT_UUID,
    firstName: STUDENT_FIRST_NAME,
    lastName: STUDENT_LAST_NAME,
    studentCode: STUDENT_CODE,
    classId: CLASS_ID,
    classCode: "6A",
    className: CLASS_NAME,
    classes: [{ classId: CLASS_ID, classCode: "6A", className: CLASS_NAME }],
    ...overrides,
  };
}

export function postgresObligationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OBLIGATION_SCO_ID,
    obligationId: OBLIGATION_SCO_ID,
    studentId: STUDENT_CODE,
    studentDbId: STUDENT_UUID,
    label: "Scolarité T1",
    feeType: "Scolarité",
    status: "En retard",
    balance: OPEN_BALANCE_CDF,
    amountDue: OPEN_BALANCE_CDF,
    amountPaid: 0,
    currency: "CDF",
    periodLabel: "T1",
    className: CLASS_NAME,
    classId: CLASS_ID,
    ...overrides,
  };
}
