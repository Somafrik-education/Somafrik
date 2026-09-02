import { describe, expect, it } from "vitest";
import {
  mergeRemoteSnapshot,
  purgeInactiveSchoolFromState,
  replaceGlobalRows,
  replaceScopedSchoolRows,
} from "./backofficeStateMerge";
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
});
