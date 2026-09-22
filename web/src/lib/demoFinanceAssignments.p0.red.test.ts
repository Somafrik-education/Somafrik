/**
 * DEMO-FINANCE-ASSIGNMENTS-P0 — GREEN-A Finance (tenant = schoolId UUID).
 *
 * Triplet Démo :
 *   schoolId      UUID PostgreSQL (autorité tenant)
 *   schoolCode    SCH-BULK-CD-0001  (schools.school_code / JWT / footer)
 *   loginCode     CD-IN-26-001      (schools.login_code / publicId / entrée publique)
 *
 * GREEN-A : obligations + paiements visibles par schoolId.
 * GREEN-B : DEMO-PRES-RED-01 — affectation canonique 1ère A.
 * Aucun fallback `schoolId || schoolCode || publicId`.
 */
import { describe, expect, it } from "vitest";
import type { BackOfficeState, SessionUser, StudentFee } from "../types";
import { SCHOOL_ADMIN_ROLE } from "./orgHierarchy";
import { presentActiveSchoolState } from "./backofficeStateMerge";
import { EMPTY_DASHBOARD_CHART_CONFIG } from "./chartTypes";
import { scopedPayments } from "./establishment";
import { scopedStudentFees } from "./fees";
import { buildFinancePaymentsOverview } from "./paymentAmountBreakdown";
import {
  ATTENDANCE_PEDAGOGICAL_TEACHER_COPY,
  resolvePedagogicalAttendanceTeacher,
} from "./attendanceAuthor";
import { toPresenceClassCard } from "./presenceRoster";
import { isLegacySchoolCode } from "./schoolCanonicalIdentity";

const DEMO_SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEMO_SCHOOL_CODE = "SCH-BULK-CD-0001";
const DEMO_LOGIN_CODE = "CD-IN-26-001";
const FOREIGN_SCHOOL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLASS_1ERE_A_ID = "11111111-1111-4111-8111-111111111111";
const CLASS_1ERE_A_CODE = "CLS-1ERE-A";

function demoSession(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "user-demo-admin",
    firstName: "Admin",
    lastName: "Démo",
    role: SCHOOL_ADMIN_ROLE,
    schoolId: DEMO_SCHOOL_ID,
    schoolCode: DEMO_SCHOOL_CODE,
    schoolPublicCode: DEMO_LOGIN_CODE,
    identifier: "admin",
    ...overrides,
  } as SessionUser;
}

/** Projection GET /api/finance/student-fees (mapObligationRow). */
function canonicalObligation(overrides: Partial<StudentFee> = {}): StudentFee {
  return {
    id: "STUFEE-DEMO-1",
    studentId: "STU-DEMO-1",
    studentName: "Ada Nuru",
    schoolId: DEMO_SCHOOL_ID,
    schoolCode: DEMO_LOGIN_CODE,
    className: "1ère A",
    schoolFeeItemId: "ITEM-1",
    feeGridId: "GRID-1",
    feeType: "Minerval",
    label: "Minerval",
    currency: "CDF",
    academicYear: "2025-2026",
    initialAmount: 100_000,
    discount: 0,
    exemption: 0,
    amountDue: 100_000,
    amountPaid: 20_000,
    balance: 80_000,
    status: "Partiellement payé",
    ...overrides,
  };
}

/** Projection GET /api/payments (mapPaymentRow) : schoolId UUID obligatoire. */
function canonicalPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "PAY-DEMO-1",
    publicId: "PAY-DEMO-1",
    reference: "PAY-DEMO-1",
    dbId: "pay-uuid-1",
    schoolId: DEMO_SCHOOL_ID,
    schoolCode: DEMO_LOGIN_CODE,
    studentId: "STU-DEMO-1",
    studentName: "Ada Nuru",
    amount: 20_000,
    totalAmount: 20_000,
    currency: "CDF",
    method: "Cash",
    date: "2026-01-15",
    status: "Payé",
    ...overrides,
  };
}

/**
 * Forme encore émise par `buildAssignments` / `bulkPlatformSeed` :
 * className seul, aucun classId / classCode / status.
 */
function demoSeedAssignment() {
  return {
    id: `ASSIGN-${DEMO_SCHOOL_CODE}-001`,
    schoolCode: DEMO_SCHOOL_CODE,
    teacherId: `TCH-${DEMO_SCHOOL_CODE}-001`,
    teacherName: "Seke Mwamba",
    className: "1ère A",
    subject: "Mathématiques",
    course: "Mathématiques",
  };
}

/** Projection GET /api/assignments (mapAssignment) : classId/classCode/status/schoolId. */
function canonicalAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: "ta-uuid-1",
    schoolId: DEMO_SCHOOL_ID,
    schoolCode: DEMO_SCHOOL_CODE,
    teacherId: `TCH-${DEMO_SCHOOL_CODE}-001`,
    teacherName: "Seke Mwamba",
    classId: CLASS_1ERE_A_ID,
    classCode: CLASS_1ERE_A_CODE,
    className: "1ère A",
    subject: "Mathématiques",
    course: "Mathématiques",
    status: "active",
    ...overrides,
  };
}

function emptyBackOfficeState(overrides: Partial<BackOfficeState> = {}): BackOfficeState {
  return {
    schools: [],
    users: [],
    countries: [],
    contacts: [],
    relations: [],
    subscriptions: [],
    notifications: [],
    students: [],
    teachers: [],
    classes: [],
    courses: [],
    assignments: [],
    courseSchedules: [],
    payments: [],
    presences: [],
    notes: [],
    evaluations: [],
    exams: [],
    bulletins: [],
    documents: [],
    announcements: [],
    messages: [],
    paymentStatuses: [],
    feeGrids: [],
    schoolFeeItems: [],
    studentFees: [],
    feeTariffHistory: [],
    rolePermissions: {},
    academicConfigs: {},
    dashboardChartConfig: EMPTY_DASHBOARD_CHART_CONFIG,
    auditLog: [],
    ...overrides,
  };
}

function paymentsPageState(input: {
  studentFees?: StudentFee[];
  payments?: unknown[];
}): BackOfficeState {
  return emptyBackOfficeState({
    studentFees: input.studentFees ?? [],
    payments: input.payments ?? [],
  });
}

function presentedFeeIds(state: BackOfficeState): string[] {
  const fees = state.studentFees;
  if (!fees) {
    throw new Error("studentFees manquants après présentation");
  }
  return fees.map((row) => row.id);
}

describe("DEMO-FINANCE-ASSIGNMENTS-P0 GREEN-A Finance", () => {
  it("DEMO-FIN-RED-01 — session CD-IN-26-001 voit les obligations canoniques de son schoolId", () => {
    const user = demoSession();
    const fees = [
      canonicalObligation(),
      canonicalObligation({ id: "STUFEE-DEMO-2", studentId: "STU-DEMO-2" }),
    ];
    const hydrated = paymentsPageState({ studentFees: fees });

    // Chrome / activeSchoolCode / footer = schools.school_code, pas login_code.
    expect(user.schoolCode).toBe(DEMO_SCHOOL_CODE);
    expect(user.schoolPublicCode).toBe(DEMO_LOGIN_CODE);
    expect(user.schoolId).toBe(DEMO_SCHOOL_ID);
    expect(user.schoolCode).not.toBe(user.schoolPublicCode);
    expect(isLegacySchoolCode(user.schoolCode)).toBe(false);

    const presented = presentActiveSchoolState(hydrated, DEMO_SCHOOL_CODE, DEMO_SCHOOL_ID);
    const overview = buildFinancePaymentsOverview({
      user,
      state: presented,
      recentPaymentCount: 0,
    });

    expect(fees.every((row) => row.schoolId === user.schoolId)).toBe(true);
    expect(overview.obligationCount).toBe(2);
    expect(scopedStudentFees(user, presented)).toHaveLength(2);
  });

  it("DEMO-FIN-RED-02 — session Démo voit les paiements canoniques de son schoolId", () => {
    const user = demoSession();
    const payments = [
      canonicalPayment(),
      canonicalPayment({ id: "PAY-DEMO-2", studentId: "STU-DEMO-2", amount: 15_000, totalAmount: 15_000 }),
    ];
    const hydrated = paymentsPageState({ payments });

    expect(payments.every((row) => row.schoolId === DEMO_SCHOOL_ID)).toBe(true);
    expect(payments.every((row) => row.schoolCode === DEMO_LOGIN_CODE)).toBe(true);

    const presented = presentActiveSchoolState(hydrated, DEMO_SCHOOL_CODE, DEMO_SCHOOL_ID);
    const scoped = scopedPayments(user, presented);
    const overview = buildFinancePaymentsOverview({
      user,
      state: presented,
      recentPaymentCount: scoped.length,
    });

    expect(scoped).toHaveLength(2);
    expect(overview.recentPaymentCount).toBe(2);
    expect(overview.cashLabel).not.toMatch(/—/);
  });

  it("DEMO-PRES-RED-01 — classe 1ère A + affectation canonique ⇒ enseignant résolu", () => {
    const classRow = {
      id: CLASS_1ERE_A_ID,
      classId: CLASS_1ERE_A_ID,
      publicId: CLASS_1ERE_A_CODE,
      classCode: CLASS_1ERE_A_CODE,
      name: "1ère A",
      className: "1ère A",
      schoolCode: DEMO_SCHOOL_CODE,
      students: 20,
    };
    const identity = toPresenceClassCard(classRow);
    expect(identity?.className).toBe("1ère A");
    expect(identity?.classId).toBe(CLASS_1ERE_A_ID);
    expect(identity?.classCode).toBe(CLASS_1ERE_A_CODE);
    expect(identity?.studentCount).toBe(20);

    const assignment = canonicalAssignment();
    const teachers = [
      {
        id: assignment.teacherId,
        name: assignment.teacherName,
        schoolCode: DEMO_SCHOOL_CODE,
        schoolId: DEMO_SCHOOL_ID,
      },
    ];
    const decision = resolvePedagogicalAttendanceTeacher({
      role: SCHOOL_ADMIN_ROLE,
      assignments: [assignment],
      identity,
      teachers,
    });
    expect(decision.status).toBe("auto");
    if (decision.status === "auto") {
      expect(decision.teacherId).toBe(assignment.teacherId);
    }

    const seedAssignment = demoSeedAssignment();
    expect("classId" in seedAssignment).toBe(false);
    expect("status" in seedAssignment).toBe(false);
    const seedDecision = resolvePedagogicalAttendanceTeacher({
      role: SCHOOL_ADMIN_ROLE,
      assignments: [seedAssignment],
      identity,
      teachers,
    });
    expect(seedDecision).toEqual({
      status: "blocked",
      message: ATTENDANCE_PEDAGOGICAL_TEACHER_COPY.none,
    });
  });

  it("GREEN-B fail-closed — même classCode, UUID étranger ⇒ 0 fuite Présences", () => {
    const hydrated = emptyBackOfficeState({
      assignments: [
        canonicalAssignment(),
        canonicalAssignment({
          id: "ta-foreign",
          schoolId: FOREIGN_SCHOOL_ID,
          schoolCode: DEMO_SCHOOL_CODE,
          classId: CLASS_1ERE_A_ID,
          classCode: CLASS_1ERE_A_CODE,
        }),
      ],
    });
    const presented = presentActiveSchoolState(hydrated, DEMO_SCHOOL_CODE, DEMO_SCHOOL_ID);
    const assignments = presented.assignments as Array<{ id?: string }>;
    expect(assignments.map((row) => row.id)).toEqual(["ta-uuid-1"]);

    const identity = toPresenceClassCard({
      id: CLASS_1ERE_A_ID,
      classId: CLASS_1ERE_A_ID,
      classCode: CLASS_1ERE_A_CODE,
      className: "1ère A",
      students: 20,
    });
    const decision = resolvePedagogicalAttendanceTeacher({
      role: SCHOOL_ADMIN_ROLE,
      assignments,
      identity,
    });
    expect(decision.status).toBe("auto");
  });

  it("DEMO-TENANT-RED-01 — schoolId, schoolCode et loginCode ne sont jamais des identifiants équivalents", () => {
    const user = demoSession();
    expect(user.schoolId).not.toBe(user.schoolCode);
    expect(user.schoolCode).not.toBe(user.schoolPublicCode);
    expect(user.schoolId).not.toBe(user.schoolPublicCode);
    expect(isLegacySchoolCode(DEMO_SCHOOL_CODE)).toBe(false);
    expect(isLegacySchoolCode(DEMO_LOGIN_CODE)).toBe(false);

    const sameTenantFee = canonicalObligation();
    const foreignFee = canonicalObligation({
      id: "STUFEE-FOREIGN",
      schoolId: FOREIGN_SCHOOL_ID,
      schoolCode: DEMO_LOGIN_CODE,
    });
    const hydrated = paymentsPageState({ studentFees: [sameTenantFee, foreignFee] });

    const presentedByInternalCode = presentActiveSchoolState(
      hydrated,
      DEMO_SCHOOL_CODE,
      DEMO_SCHOOL_ID,
    );
    const presentedByLoginCode = presentActiveSchoolState(
      hydrated,
      DEMO_LOGIN_CODE,
      DEMO_SCHOOL_ID,
    );

    // Autorité tenant = schoolId UUID. Un filtre schoolCode ne doit ni vider
    // le tenant Démo ni laisser passer un autre UUID qui porterait le même login.
    expect(presentedByInternalCode.studentFees).toBeDefined();
    expect(presentedByLoginCode.studentFees).toBeDefined();
    expect(presentedFeeIds(presentedByInternalCode)).toEqual(["STUFEE-DEMO-1"]);
    expect(presentedFeeIds(presentedByLoginCode)).toEqual(["STUFEE-DEMO-1"]);
    expect(scopedStudentFees(user, presentedByInternalCode).map((row) => row.id)).toEqual([
      "STUFEE-DEMO-1",
    ]);
    expect(scopedStudentFees(user, presentedByLoginCode).map((row) => row.id)).toEqual(["STUFEE-DEMO-1"]);
  });

  it("GREEN-A multi-tenant — même login_code, UUID différent ⇒ 0 fuite", () => {
    const user = demoSession();
    const fees = [
      canonicalObligation(),
      canonicalObligation({
        id: "STUFEE-SAME-LOGIN-FOREIGN",
        schoolId: FOREIGN_SCHOOL_ID,
        schoolCode: DEMO_LOGIN_CODE,
      }),
    ];
    const payments = [
      canonicalPayment(),
      canonicalPayment({
        id: "PAY-SAME-LOGIN-FOREIGN",
        schoolId: FOREIGN_SCHOOL_ID,
        schoolCode: DEMO_LOGIN_CODE,
      }),
    ];
    const hydrated = paymentsPageState({ studentFees: fees, payments });
    const presented = presentActiveSchoolState(hydrated, DEMO_SCHOOL_CODE, DEMO_SCHOOL_ID);

    expect(scopedStudentFees(user, presented).map((row) => row.id)).toEqual(["STUFEE-DEMO-1"]);
    expect(scopedPayments(user, presented).map((row) => row.id)).toEqual(["PAY-DEMO-1"]);
  });
});
