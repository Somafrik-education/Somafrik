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
  upsertOutboxEntry,
} from "./syncOutbox";

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
});
