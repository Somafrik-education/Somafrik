import { describe, expect, it } from "vitest";
import {
  isPendingSyncStatus,
  isProtectedSyncStatus,
  reapplyOutboxToState,
  upsertOutboxEntry,
  type SyncOutboxEntry,
} from "./syncOutbox";

describe("syncOutbox (P0 SYNC-CANONICAL-STATE)", () => {
  it("failed n'est plus un statut protégé", () => {
    expect(isProtectedSyncStatus("failed")).toBe(false);
    expect(isPendingSyncStatus("failed")).toBe(false);
    expect(isPendingSyncStatus("pending")).toBe(true);
    expect(isPendingSyncStatus("syncing")).toBe(true);
  });

  it("reapplyOutboxToState ignore les entrées failed", () => {
    const state = { evaluations: [{ id: "S1", title: "Serveur" }] };
    const entries: SyncOutboxEntry[] = [
      {
        clientMutationId: "cm-1",
        entity: "evaluations",
        op: "upsert",
        recordId: "GHOST",
        payload: { title: "Fantôme" },
        status: "failed",
        attempts: 2,
        lastError: "409",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const next = reapplyOutboxToState(state, entries);
    expect(next.evaluations).toEqual([{ id: "S1", title: "Serveur" }]);
  });

  it("reapplyOutboxToState conserve pending", () => {
    const state = { notes: [] as Record<string, unknown>[] };
    const entries = upsertOutboxEntry([], {
      clientMutationId: "cm-2",
      entity: "notes",
      op: "upsert",
      recordId: "NOTE-LOCAL",
      payload: { value: 15, schoolCode: "SCH-1" },
      status: "pending",
    });
    const next = reapplyOutboxToState(state, entries);
    expect(next.notes).toHaveLength(1);
    expect(next.notes[0].id).toBe("NOTE-LOCAL");
    expect(next.notes[0].syncStatus).toBe("pending");
  });
});
