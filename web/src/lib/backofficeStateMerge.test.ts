import { describe, expect, it } from "vitest";
import { mergeRemoteSnapshot, mergeScopedSchoolRows } from "./backofficeStateMerge";
import type { BackOfficeState } from "../types";

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
    dashboardChartConfig: { platform: {}, establishment: {} },
    auditLog: [],
    ...overrides,
  } as BackOfficeState;
}

describe("backofficeStateMerge (HOTFIX-SYNC-01)", () => {
  it("ne laisse pas un snapshot serveur écraser une évaluation pending locale", () => {
    const prev = baseState({
      evaluations: [
        {
          id: "EVAL-PENDING",
          title: "Devoir local",
          schoolCode: "SCH-001",
          className: "6e A",
          subject: "Mathématiques",
          period: "T1",
          evaluationType: "Devoir",
          scale: 20,
          coefficient: 1,
          status: "open",
          date: "2026-01-01",
          syncStatus: "pending",
          clientMutationId: "cm-1",
        } as never,
      ],
    });
    const remote = {
      evaluations: [
        {
          id: "EVAL-OTHER",
          title: "Serveur",
          schoolCode: "SCH-001",
          className: "6e A",
          subject: "Mathématiques",
          period: "T1",
          evaluationType: "Devoir",
          scale: 20,
          coefficient: 1,
          status: "open",
          date: "2026-01-01",
          active: true,
        },
      ],
    } as unknown as Partial<BackOfficeState>;

    const merged = mergeRemoteSnapshot(prev, remote);
    const ids = (merged.evaluations ?? []).map((row) => String(row.id));
    expect(ids).toEqual(expect.arrayContaining(["EVAL-PENDING", "EVAL-OTHER"]));
    const pending = (merged.evaluations ?? []).find((row) => String(row.id) === "EVAL-PENDING") as {
      syncStatus?: string;
    };
    expect(pending.syncStatus).toBe("pending");
  });

  it("conserve une présence failed après merge school-scoped", () => {
    const prev = [
      {
        id: "PRES-1",
        schoolCode: "SCH-001",
        studentId: "S1",
        syncStatus: "failed",
        syncError: "Erreur serveur",
      },
    ];
    const remote = [{ id: "PRES-2", schoolCode: "SCH-001", studentId: "S2" }];
    const merged = mergeScopedSchoolRows(prev, remote);
    expect(merged.map((row) => row.id)).toEqual(expect.arrayContaining(["PRES-1", "PRES-2"]));
    expect((merged.find((row) => row.id === "PRES-1") as { syncStatus?: string }).syncStatus).toBe(
      "failed",
    );
  });

  it("double upsert idempotent : même id local+remote → une seule ligne (pending gagne)", () => {
    const prev = [
      {
        id: "EVAL-1",
        schoolCode: "SCH-001",
        title: "Local pending",
        syncStatus: "pending",
        clientMutationId: "cm-1",
      },
    ];
    const remote = [{ id: "EVAL-1", schoolCode: "SCH-001", title: "Serveur ancien" }];
    const merged = mergeScopedSchoolRows(prev, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("Local pending");
    expect((merged[0] as { syncStatus?: string }).syncStatus).toBe("pending");
  });
});
