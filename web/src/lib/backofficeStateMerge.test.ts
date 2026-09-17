import { describe, expect, it } from "vitest";
import {
  mergeRemoteSnapshot,
  presentActiveSchoolState,
  purgeInactiveSchoolFromState,
  replaceGlobalRows,
  replaceScopedSchoolRows,
} from "./backofficeStateMerge";
import type { BackOfficeState, Student, StudentFee } from "../types";
import { EMPTY_DASHBOARD_CHART_CONFIG } from "./chartTypes";

function baseState(overrides: Partial<BackOfficeState> = {}): BackOfficeState {
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

describe("backofficeStateMerge (P0 SYNC-CANONICAL-STATE)", () => {
  it("cas 1 — suppression distante : GET [A,B] après [A,B,C] → [A,B]", () => {
    const prev = baseState({
      students: [
        { id: "A", schoolCode: "SCH-A" },
        { id: "B", schoolCode: "SCH-A" },
        { id: "C", schoolCode: "SCH-A" },
      ] as never,
    });
    const remote = {
      students: [
        { id: "A", schoolCode: "SCH-A" },
        { id: "B", schoolCode: "SCH-A" },
      ],
    } as Partial<BackOfficeState>;

    const merged = mergeRemoteSnapshot(prev, remote, {
      activeSchoolCode: "SCH-A",
      loadedKeys: ["students"],
    });
    expect((merged.students ?? []).map((row) => row.id)).toEqual(["A", "B"]);
  });

  it("cas 2 — liste vide : GET [] efface le scope local", () => {
    const prev = baseState({
      notifications: [{ id: "N1" }] as never,
    });
    const merged = mergeRemoteSnapshot(prev, { notifications: [] }, {
      loadedKeys: ["notifications"],
    });
    expect(merged.notifications).toEqual([]);
  });

  it("cas 2b — scope établissement vide : GET [] avec activeSchoolCode", () => {
    const prev = [
      { id: "A1", schoolCode: "SCH-A" },
      { id: "A2", schoolCode: "SCH-A" },
    ];
    const merged = replaceScopedSchoolRows(prev, [], {
      activeSchoolCode: "SCH-A",
      domainKey: "students",
    });
    expect(merged).toEqual([]);
  });

  it("cas 3 — pending offline-capable conservé, failed exclu", () => {
    const prev = [
      { id: "EVAL-PENDING", schoolCode: "SCH-001", syncStatus: "pending", title: "Local" },
      { id: "EVAL-FAILED", schoolCode: "SCH-001", syncStatus: "failed", title: "Échec" },
    ];
    const remote = [{ id: "EVAL-OTHER", schoolCode: "SCH-001", title: "Serveur" }];
    const merged = replaceScopedSchoolRows(prev, remote, {
      activeSchoolCode: "SCH-001",
      domainKey: "evaluations",
    });
    const ids = merged.map((row) => row.id);
    expect(ids).toContain("EVAL-OTHER");
    expect(ids).toContain("EVAL-PENDING");
    expect(ids).not.toContain("EVAL-FAILED");
  });

  it("cas 4 — changement établissement : purge inactive school", () => {
    const prev = baseState({
      students: [
        { id: "A1", schoolCode: "SCH-A" },
        { id: "A2", schoolCode: "SCH-A" },
        { id: "B1", schoolCode: "SCH-B" },
      ] as never,
    });
    const purged = purgeInactiveSchoolFromState(prev, "SCH-A");
    expect((purged.students ?? []).map((row) => row.id)).toEqual(["B1"]);
  });

  it("cas 4b — après purge A puis merge B : uniquement B1", () => {
    const prev = [
      { id: "A1", schoolCode: "SCH-A" },
      { id: "A2", schoolCode: "SCH-A" },
      { id: "B1", schoolCode: "SCH-B" },
    ];
    const afterPurge = replaceScopedSchoolRows(prev, [], {
      activeSchoolCode: "SCH-A",
      domainKey: "students",
    });
    const merged = replaceScopedSchoolRows(afterPurge, [{ id: "B1", schoolCode: "SCH-B" }], {
      activeSchoolCode: "SCH-B",
      domainKey: "students",
    });
    expect(merged.map((row) => row.id)).toEqual(["B1"]);
  });

  it("double upsert idempotent : pending local gagne sur remote pour même id", () => {
    const prev = [
      {
        id: "EVAL-1",
        schoolCode: "SCH-001",
        title: "Local pending",
        syncStatus: "pending",
      },
    ];
    const remote = [{ id: "EVAL-1", schoolCode: "SCH-001", title: "Serveur ancien" }];
    const merged = replaceScopedSchoolRows(prev, remote, {
      activeSchoolCode: "SCH-001",
      domainKey: "evaluations",
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("Local pending");
    expect((merged[0] as { syncStatus?: string }).syncStatus).toBe("pending");
  });

  it("replaceGlobalRows : remote vide efface tout (hors pending offline)", () => {
    const prev = [
      { id: "C1" },
      { id: "C2", syncStatus: "pending" },
    ];
    const merged = replaceGlobalRows(prev, [], { domainKey: "evaluations" });
    expect(merged.map((row) => row.id)).toEqual(["C2"]);
  });

  it("presentActiveSchoolState n'expose jamais A sous B (mémoire interne conservée)", () => {
    const prev = baseState({
      students: [
        { id: "A1", schoolCode: "CD-IN-26-001" },
        { id: "B1", schoolCode: "BI-EC-26-001" },
      ] as never,
    });
    const presented = presentActiveSchoolState(prev, "BI-EC-26-001");
    expect(presented.students.map((row) => row.id)).toEqual(["B1"]);
    expect(prev.students.map((row) => row.id)).toEqual(["A1", "B1"]);
  });

  it("presentActiveSchoolState Finance filtre par schoolId, pas par login_code", () => {
    const schoolIdA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const schoolIdB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const feeA: StudentFee = {
      id: "FEE-A",
      studentId: "STU-A",
      schoolId: schoolIdA,
      schoolCode: "CD-IN-26-001",
      className: "1ère A",
      schoolFeeItemId: "ITEM-1",
      feeGridId: "GRID-1",
      feeType: "Minerval",
      label: "Minerval",
      currency: "CDF",
      academicYear: "2025-2026",
      initialAmount: 1,
      discount: 0,
      exemption: 0,
      amountDue: 1,
      amountPaid: 0,
      balance: 1,
      status: "À payer",
    };
    const feeB: StudentFee = { ...feeA, id: "FEE-B", studentId: "STU-B", schoolId: schoolIdB };
    const studentA: Student = {
      id: "STU-A",
      matricule: "MAT-A",
      schoolCode: "SCH-BULK-CD-0001",
    };
    const payments: Array<{ id: string; schoolId: string; schoolCode: string }> = [
      { id: "PAY-A", schoolId: schoolIdA, schoolCode: "CD-IN-26-001" },
      { id: "PAY-B", schoolId: schoolIdB, schoolCode: "CD-IN-26-001" },
    ];
    const prev = baseState({
      studentFees: [feeA, feeB],
      payments,
      students: [studentA],
    });
    const presented = presentActiveSchoolState(prev, "SCH-BULK-CD-0001", schoolIdA);
    const presentedFees = presented.studentFees;
    if (!presentedFees) {
      throw new Error("studentFees manquants après présentation");
    }
    expect(presentedFees.map((row) => row.id)).toEqual(["FEE-A"]);
    expect(
      presented.payments.map((row) => {
        if (!row || typeof row !== "object" || !("id" in row) || typeof row.id !== "string") {
          throw new Error("paiement sans id après présentation");
        }
        return row.id;
      }),
    ).toEqual(["PAY-A"]);
    expect(presented.students.map((row) => row.id)).toEqual(["STU-A"]);
  });
});
