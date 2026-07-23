import { beforeEach, describe, expect, it } from "vitest";
import {
  applySyncAckToOutbox,
  createClientMutationId,
  enqueuePatchMutations,
  formatOutboxFailureMessage,
  listActiveOutboxEntries,
  loadSyncOutbox,
  markOutboxStatus,
  reapplyOutboxToState,
  saveSyncOutbox,
  settleOutboxAfterHttpSave,
  upsertOutboxEntry,
  type SyncOutboxEntry,
} from "./syncOutbox";

function asSyncing(entries: SyncOutboxEntry[]): SyncOutboxEntry[] {
  return entries.map((entry) =>
    entry.status === "pending"
      ? { ...entry, status: "syncing" as const, attempts: entry.attempts + 1 }
      : entry,
  );
}

describe("syncOutbox (HOTFIX-SYNC-01)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persiste une file durable pending → failed → retry", () => {
    const id = createClientMutationId();
    let entries = upsertOutboxEntry([], {
      clientMutationId: id,
      entity: "evaluations",
      op: "upsert",
      recordId: "EVAL-1",
      payload: { id: "EVAL-1", title: "Devoir" },
      schoolCode: "SCH-001",
      status: "pending",
    });
    saveSyncOutbox(entries);
    expect(loadSyncOutbox()).toHaveLength(1);

    entries = markOutboxStatus(entries, { clientMutationId: id }, "failed", "Classe introuvable");
    saveSyncOutbox(entries);
    expect(listActiveOutboxEntries()[0].status).toBe("failed");
    expect(formatOutboxFailureMessage(entries)).toMatch(/Classe introuvable/);
  });

  it("ACK accepté retire la mutation ; rejeté la conserve en failed", () => {
    let entries = upsertOutboxEntry([], {
      clientMutationId: "cm-ok",
      entity: "evaluations",
      op: "upsert",
      recordId: "EVAL-OK",
      payload: { id: "EVAL-OK" },
      status: "syncing",
    });
    entries = upsertOutboxEntry(entries, {
      clientMutationId: "cm-bad",
      entity: "evaluations",
      op: "upsert",
      recordId: "EVAL-BAD",
      payload: { id: "EVAL-BAD" },
      status: "syncing",
    });

    entries = applySyncAckToOutbox(entries, {
      accepted: [{ entity: "evaluations", id: "EVAL-OK", clientMutationId: "cm-ok" }],
      rejected: [
        {
          entity: "evaluations",
          id: "EVAL-BAD",
          clientMutationId: "cm-bad",
          error: "Classe ou matiere introuvable pour l'évaluation",
        },
      ],
    });

    expect(entries.find((e) => e.recordId === "EVAL-OK")).toBeUndefined();
    expect(entries.find((e) => e.recordId === "EVAL-BAD")?.status).toBe("failed");
  });

  it("réapplique les pending sur un snapshot serveur ancien (non-écrasement)", () => {
    const entries = upsertOutboxEntry([], {
      clientMutationId: "cm-1",
      entity: "evaluations",
      op: "upsert",
      recordId: "EVAL-LOCAL",
      payload: { id: "EVAL-LOCAL", title: "Contrôle", schoolCode: "SCH-001" },
      schoolCode: "SCH-001",
      status: "pending",
    });

    const remoteState = {
      evaluations: [{ id: "EVAL-SERVER", title: "Ancienne", schoolCode: "SCH-001" }],
    };
    const merged = reapplyOutboxToState(remoteState, entries);
    expect(merged.evaluations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "EVAL-SERVER" }),
        expect.objectContaining({
          id: "EVAL-LOCAL",
          syncStatus: "pending",
          clientMutationId: "cm-1",
        }),
      ]),
    );
  });

  it("enqueuePatchMutations annote clientMutationId et status pending", () => {
    const { entries, annotatedPatch } = enqueuePatchMutations([], {
      evaluations: [{ id: "EVAL-1", title: "Devoir", schoolCode: "SCH-001" }],
    });
    const row = (annotatedPatch.evaluations as Record<string, unknown>[])[0];
    expect(row.clientMutationId).toBeTruthy();
    expect(row.syncStatus).toBe("pending");
    expect(entries).toHaveLength(1);
    expect(entries[0].recordId).toBe("EVAL-1");
  });

  it("PUT mixte evaluation+presence : ACK Notes + presence implicite · aucune syncing restante", () => {
    const { entries, annotatedPatch } = enqueuePatchMutations([], {
      evaluations: [{ id: "EVAL-1", title: "Devoir", schoolCode: "SCH-001" }],
      presences: [{ id: "PRES-1", schoolCode: "SCH-001", studentId: "S1" }],
    });
    const syncing = asSyncing(entries);
    const settled = settleOutboxAfterHttpSave(syncing, {
      ack: {
        accepted: [{ entity: "evaluations", id: "EVAL-1" }],
        rejected: [],
      },
      annotatedPatch,
    });

    expect(settled.find((entry) => entry.status === "syncing")).toBeUndefined();
    expect(settled.find((entry) => entry.recordId === "EVAL-1")).toBeUndefined();
    expect(settled.find((entry) => entry.recordId === "PRES-1")).toBeUndefined();
  });

  it("PUT presence-only avec syncAck Notes vide → presence marquée synced", () => {
    const { entries, annotatedPatch } = enqueuePatchMutations([], {
      presences: [{ id: "PRES-ONLY", schoolCode: "SCH-001", studentId: "S1" }],
    });
    const syncing = asSyncing(entries);
    const settled = settleOutboxAfterHttpSave(syncing, {
      ack: { accepted: [], rejected: [] },
      annotatedPatch,
    });

    expect(settled).toHaveLength(0);
    expect(settled.find((entry) => entry.recordId === "PRES-ONLY")).toBeUndefined();
  });

  it("PUT mixte : évaluation rejetée reste failed, presence est ACK implicite", () => {
    const { entries, annotatedPatch } = enqueuePatchMutations([], {
      evaluations: [{ id: "EVAL-BAD", title: "Bad", schoolCode: "SCH-001", clientMutationId: "cm-bad" }],
      exams: [{ id: "EXAM-1", schoolCode: "SCH-001", title: "Exam" }],
      payments: [{ id: "PAY-1", schoolCode: "SCH-001", amount: 1000 }],
    });
    const syncing = asSyncing(entries);
    const settled = settleOutboxAfterHttpSave(syncing, {
      ack: {
        accepted: [],
        rejected: [
          {
            entity: "evaluations",
            id: "EVAL-BAD",
            clientMutationId: "cm-bad",
            error: "Classe ou matiere introuvable pour l'évaluation",
          },
        ],
      },
      annotatedPatch,
    });

    expect(settled).toHaveLength(1);
    expect(settled[0].recordId).toBe("EVAL-BAD");
    expect(settled[0].status).toBe("failed");
    expect(settled.find((entry) => entry.entity === "exams")).toBeUndefined();
    expect(settled.find((entry) => entry.entity === "payments")).toBeUndefined();
  });
});
