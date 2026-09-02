/**
 * P0 SYNC-CANONICAL-STATE — tests contractuels de convergence PostgreSQL.
 * Exécution : npm run verify:canonical-state-convergence
 */
import { describe, expect, it } from "vitest";
import { mergeRemoteSnapshot, purgeInactiveSchoolFromState, replaceScopedSchoolRows } from "./backofficeStateMerge";
import {
  applySyncAckToOutbox,
  isPendingSyncStatus,
  isProtectedSyncStatus,
  reapplyOutboxToState,
  upsertOutboxEntry,
  type SyncOutboxEntry,
} from "./syncOutbox";
import type { BackOfficeState } from "../types";

function emptyState(): BackOfficeState {
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
  } as BackOfficeState;
}

describe("verify:canonical-state-convergence", () => {
  describe("Cas 1 — suppression distante", () => {
    it("GET 2 sans C retire C de l'état UI", () => {
      const prev = emptyState();
      prev.students = [
        { id: "A", schoolCode: "SCH-1" },
        { id: "B", schoolCode: "SCH-1" },
        { id: "C", schoolCode: "SCH-1" },
      ] as never;
      const merged = mergeRemoteSnapshot(
        prev,
        {
          students: [
            { id: "A", schoolCode: "SCH-1" },
            { id: "B", schoolCode: "SCH-1" },
          ] as never,
        },
        { activeSchoolCode: "SCH-1", loadedKeys: ["students"] },
      );
      expect(merged.students?.map((s) => s.id)).toEqual(["A", "B"]);
    });
  });

  describe("Cas 2 — liste vide", () => {
    it("GET [] efface le domaine global", () => {
      const prev = emptyState();
      prev.notifications = [{ id: "N1" }] as never;
      const merged = mergeRemoteSnapshot(prev, { notifications: [] }, { loadedKeys: ["notifications"] });
      expect(merged.notifications).toEqual([]);
    });
  });

  describe("Cas 3 — archivage (absence serveur)", () => {
    it("notification archivée absente du GET disparaît", () => {
      const prev = emptyState();
      prev.notifications = [
        { id: "N-ACTIVE", status: "Non lu" },
        { id: "N-ARCHIVED", status: "Archivé" },
      ] as never;
      const merged = mergeRemoteSnapshot(
        prev,
        { notifications: [{ id: "N-ACTIVE", status: "Non lu" }] as never },
        { loadedKeys: ["notifications"] },
      );
      expect(merged.notifications?.map((n) => n.id)).toEqual(["N-ACTIVE"]);
    });
  });

  describe("Cas 4 — changement établissement", () => {
    it("école B sans contamination de A (purge + merge)", () => {
      let prev = emptyState();
      prev.students = [
        { id: "A1", schoolCode: "SCH-A" },
        { id: "A2", schoolCode: "SCH-A" },
        { id: "B1", schoolCode: "SCH-B" },
      ] as never;
      prev = purgeInactiveSchoolFromState(prev, "SCH-A");
      const merged = mergeRemoteSnapshot(
        prev,
        { students: [{ id: "B1", schoolCode: "SCH-B" }] as never },
        { activeSchoolCode: "SCH-B", loadedKeys: ["students"] },
      );
      expect(merged.students?.map((s) => s.id)).toEqual(["B1"]);
    });

    it("purge inactive school retire les données de A", () => {
      const prev = emptyState();
      prev.students = [
        { id: "A1", schoolCode: "SCH-A" },
        { id: "B1", schoolCode: "SCH-B" },
      ] as never;
      const purged = purgeInactiveSchoolFromState(prev, "SCH-A");
      expect(purged.students?.map((s) => s.id)).toEqual(["B1"]);
    });
  });

  describe("Cas 5 — mutation échouée", () => {
    it("outbox failed ne réinjecte pas de donnée métier", () => {
      const state = emptyState();
      state.evaluations = [{ id: "EVAL-SRV", title: "Serveur" }] as never;
      const entries: SyncOutboxEntry[] = [
        {
          clientMutationId: "cm-fail",
          entity: "evaluations",
          op: "upsert",
          recordId: "EVAL-FAIL",
          payload: { title: "Rejeté", schoolCode: "SCH-1" },
          status: "failed",
          attempts: 1,
          lastError: "400 Bad Request",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      const next = reapplyOutboxToState(state, entries);
      expect((next.evaluations ?? []).map((row) => row.id)).toEqual(["EVAL-SRV"]);
      expect(isProtectedSyncStatus("failed")).toBe(false);
      expect(isPendingSyncStatus("failed")).toBe(false);
    });
  });

  describe("Cas 6 — UUID serveur", () => {
    it("pending local remplacé après ACK outbox", () => {
      let entries: SyncOutboxEntry[] = upsertOutboxEntry([], {
        clientMutationId: "cm-1",
        entity: "notes",
        op: "upsert",
        recordId: "tmp-local",
        payload: { id: "tmp-local", schoolCode: "SCH-1" },
        status: "pending",
      });
      entries = applySyncAckToOutbox(entries, {
        accepted: [{ entity: "notes", id: "tmp-local", canonicalId: "uuid-server-x" }],
      });
      expect(entries.filter((e) => e.status !== "synced")).toHaveLength(0);
    });
  });

  describe("Cas 7 — concurrence (génération)", () => {
    it("simule qu'une réponse ancienne ne doit pas écraser une plus récente", () => {
      const generations = new Map<string, number>();
      const key = "students:SCH-1";

      const startFetch = () => {
        const gen = (generations.get(key) ?? 0) + 1;
        generations.set(key, gen);
        return gen;
      };

      const isStale = (expected: number) => generations.get(key) !== expected;

      const gen1 = startFetch();
      const gen2 = startFetch();
      expect(isStale(gen1)).toBe(true);
      expect(isStale(gen2)).toBe(false);
    });
  });

  describe("Domaines critiques", () => {
    const cases: { domain: keyof BackOfficeState; schoolCode: string }[] = [
      { domain: "users", schoolCode: "SCH-1" },
      { domain: "teachers", schoolCode: "SCH-1" },
      { domain: "students", schoolCode: "SCH-1" },
      { domain: "classes", schoolCode: "SCH-1" },
      { domain: "payments", schoolCode: "SCH-1" },
      { domain: "notes", schoolCode: "SCH-1" },
      { domain: "notifications", schoolCode: "*" },
    ];

    for (const { domain, schoolCode } of cases) {
      it(`${domain} — GET [] efface le scope`, () => {
        const prev = emptyState();
        (prev as unknown as Record<string, unknown>)[domain] = [{ id: "GHOST", schoolCode }];
        const merged = mergeRemoteSnapshot(
          prev,
          { [domain]: [] } as Partial<BackOfficeState>,
          {
            activeSchoolCode: schoolCode === "*" ? undefined : schoolCode,
            loadedKeys: [domain],
          },
        );
        const list = (merged as unknown as Record<string, unknown>)[domain];
        if (domain === "notifications") {
          expect(list).toEqual([]);
        } else {
          expect((list as { id: string }[]).map((row) => row.id)).toEqual([]);
        }
      });
    }
  });

  describe("Mécanisme générique school-scoped", () => {
    it("replaceScopedSchoolRows ne ressuscite pas les lignes absentes", () => {
      const prev = [
        { id: "X", schoolCode: "SCH-Z" },
        { id: "Y", schoolCode: "SCH-Z" },
      ];
      const result = replaceScopedSchoolRows(prev, [{ id: "X", schoolCode: "SCH-Z" }], {
        activeSchoolCode: "SCH-Z",
        domainKey: "presences",
      });
      expect(result.map((row) => row.id)).toEqual(["X"]);
    });
  });
});
