/**
 * HOTFIX-SYNC-01 — File d'attente locale durable des mutations.
 * Une sync ne peut jamais effacer silencieusement une entrée non ACK.
 */

export type SyncMutationStatus = "pending" | "syncing" | "synced" | "failed";

export type SyncEntityKey =
  | "evaluations"
  | "notes"
  | "presences"
  | "exams"
  | "payments"
  | string;

export interface SyncOutboxEntry {
  clientMutationId: string;
  entity: SyncEntityKey;
  op: "upsert" | "delete";
  recordId: string;
  payload: Record<string, unknown>;
  schoolCode?: string;
  status: SyncMutationStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncAckItem {
  entity?: string;
  id?: string;
  clientMutationId?: string;
  canonicalId?: string;
  error?: string;
}

export interface SyncAck {
  accepted?: SyncAckItem[];
  rejected?: SyncAckItem[];
}

export const PROTECTED_SYNC_STATUSES = new Set<SyncMutationStatus>([
  "pending",
  "syncing",
]);

/** Statuts encore en attente d'ACK serveur (peuvent être superposés à l'état canonique). */
export const PENDING_SYNC_STATUSES = new Set<SyncMutationStatus>(["pending", "syncing"]);

const STORAGE_KEY = "somafrik.syncOutbox.v1";

function nowIso() {
  return new Date().toISOString();
}

export function createClientMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isProtectedSyncStatus(value: unknown): boolean {
  return PROTECTED_SYNC_STATUSES.has(String(value ?? "") as SyncMutationStatus);
}

export function isPendingSyncStatus(value: unknown): boolean {
  return PENDING_SYNC_STATUSES.has(String(value ?? "") as SyncMutationStatus);
}

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

export function loadSyncOutbox(): SyncOutboxEntry[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SyncOutboxEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSyncOutbox(entries: SyncOutboxEntry[]): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota / private mode — la file reste en mémoire appelant.
  }
}

export function listActiveOutboxEntries(entries: SyncOutboxEntry[] = loadSyncOutbox()): SyncOutboxEntry[] {
  return entries.filter((entry) => entry.status !== "synced");
}

export function upsertOutboxEntry(
  entries: SyncOutboxEntry[],
  next: Omit<SyncOutboxEntry, "createdAt" | "updatedAt" | "attempts"> & {
    attempts?: number;
    createdAt?: string;
    updatedAt?: string;
  },
): SyncOutboxEntry[] {
  const stamp = nowIso();
  const existingIdx = entries.findIndex(
    (entry) =>
      entry.clientMutationId === next.clientMutationId ||
      (entry.entity === next.entity && entry.recordId === next.recordId && entry.status !== "synced"),
  );
  if (existingIdx >= 0) {
    const prev = entries[existingIdx];
    const updated: SyncOutboxEntry = {
      ...prev,
      ...next,
      attempts: next.attempts ?? prev.attempts,
      createdAt: prev.createdAt,
      updatedAt: stamp,
    };
    const copy = [...entries];
    copy[existingIdx] = updated;
    return copy;
  }
  return [
    ...entries,
    {
      ...next,
      attempts: next.attempts ?? 0,
      createdAt: next.createdAt ?? stamp,
      updatedAt: next.updatedAt ?? stamp,
    },
  ];
}

export function markOutboxStatus(
  entries: SyncOutboxEntry[],
  matcher: { clientMutationId?: string; recordId?: string; entity?: string },
  status: SyncMutationStatus,
  lastError?: string,
): SyncOutboxEntry[] {
  return entries.map((entry) => {
    const byMutation =
      matcher.clientMutationId && entry.clientMutationId === matcher.clientMutationId;
    const byRecord =
      matcher.recordId &&
      matcher.entity &&
      entry.recordId === matcher.recordId &&
      entry.entity === matcher.entity;
    if (!byMutation && !byRecord) return entry;
    return {
      ...entry,
      status,
      lastError: lastError ?? (status === "failed" ? entry.lastError : undefined),
      attempts: status === "syncing" ? entry.attempts + 1 : entry.attempts,
      updatedAt: nowIso(),
    };
  });
}

export function applySyncAckToOutbox(entries: SyncOutboxEntry[], ack?: SyncAck | null): SyncOutboxEntry[] {
  if (!ack) return entries;
  let next = [...entries];
  for (const item of ack.accepted ?? []) {
    next = markOutboxStatus(
      next,
      {
        clientMutationId: item.clientMutationId,
        recordId: item.id,
        entity: item.entity,
      },
      "synced",
    );
  }
  for (const item of ack.rejected ?? []) {
    next = markOutboxStatus(
      next,
      {
        clientMutationId: item.clientMutationId,
        recordId: item.id,
        entity: item.entity,
      },
      "failed",
      item.error ?? "Échec de synchronisation",
    );
  }
  // Purge synced anciens pour limiter la taille
  return next.filter((entry) => entry.status !== "synced");
}

/** Domaines pédagogiques suivis par l'outbox. */
export const PEDAGOGY_OUTBOX_KEYS = [
  "evaluations",
  "notes",
  "presences",
  "exams",
  "payments",
] as const;

/**
 * Domaines encore persistés par le snapshot BO (hors ACK Notes PG).
 * Succès HTTP ⇒ ACK implicite des mutations du patch pour ces clés.
 */
export const BO_SNAPSHOT_OUTBOX_KEYS = ["presences", "exams", "payments"] as const;

function markPatchRowsSynced(
  entries: SyncOutboxEntry[],
  annotatedPatch: Record<string, unknown>,
  keys: readonly string[],
): SyncOutboxEntry[] {
  let next = entries;
  for (const key of keys) {
    const rows =
      (annotatedPatch[key] as { id?: string; clientMutationId?: string }[] | undefined) ?? [];
    for (const row of rows) {
      next = markOutboxStatus(
        next,
        {
          clientMutationId: row.clientMutationId,
          recordId: String(row.id ?? ""),
          entity: key,
        },
        "synced",
      );
    }
  }
  return next.filter((entry) => entry.status !== "synced");
}

/**
 * HOTFIX-SYNC-01 — Règle d'ACK après PUT /backoffice/state :
 * 1) appliquer syncAck Notes (evaluations/notes) s'il est présent ;
 * 2) ACK implicite des domaines snapshot BO du patch (presences/exams/payments) ;
 * 3) si aucun syncAck : ACK implicite de tous les domaines pédagogiques du patch.
 */
export function settleOutboxAfterHttpSave(
  entries: SyncOutboxEntry[],
  options: {
    ack?: SyncAck | null;
    annotatedPatch: Record<string, unknown>;
  },
): SyncOutboxEntry[] {
  const { ack, annotatedPatch } = options;
  if (ack) {
    const afterNotesAck = applySyncAckToOutbox(entries, ack);
    return markPatchRowsSynced(afterNotesAck, annotatedPatch, BO_SNAPSHOT_OUTBOX_KEYS);
  }
  return markPatchRowsSynced(entries, annotatedPatch, PEDAGOGY_OUTBOX_KEYS);
}

export function enqueuePatchMutations(
  entries: SyncOutboxEntry[],
  patch: Record<string, unknown>,
): { entries: SyncOutboxEntry[]; annotatedPatch: Record<string, unknown> } {
  let nextEntries = [...entries];
  const annotatedPatch: Record<string, unknown> = { ...patch };

  for (const key of PEDAGOGY_OUTBOX_KEYS) {
    const rows = patch[key];
    if (!Array.isArray(rows)) continue;
    annotatedPatch[key] = rows.map((raw) => {
      const row = { ...(raw as Record<string, unknown>) };
      const recordId = String(row.id ?? "").trim();
      if (!recordId) return row;
      const clientMutationId = String(row.clientMutationId ?? "").trim() || createClientMutationId();
      const status: SyncMutationStatus =
        row.syncStatus === "failed" || row.syncStatus === "synced" || row.syncStatus === "syncing"
          ? (row.syncStatus as SyncMutationStatus)
          : "pending";
      const annotated: Record<string, unknown> = {
        ...row,
        clientMutationId,
        syncStatus: status === "synced" ? "pending" : status,
      };
      nextEntries = upsertOutboxEntry(nextEntries, {
        clientMutationId,
        entity: key,
        op: "upsert",
        recordId,
        payload: annotated,
        schoolCode: String(annotated.schoolCode ?? "").trim() || undefined,
        status: "pending",
      });
      return annotated;
    });
  }

  return { entries: nextEntries, annotatedPatch };
}

export function reapplyOutboxToState<T>(
  state: T,
  entries: SyncOutboxEntry[] = listActiveOutboxEntries(),
): T {
  const next: Record<string, unknown> = { ...(state as Record<string, unknown>) };
  for (const entry of entries) {
    if (!isPendingSyncStatus(entry.status)) continue;
    const key = entry.entity;
    const list = Array.isArray(next[key]) ? [...(next[key] as Record<string, unknown>[])] : [];
    const idx = list.findIndex((row) => String(row.id ?? "") === entry.recordId);
    const row = {
      ...entry.payload,
      id: entry.recordId,
      clientMutationId: entry.clientMutationId,
      syncStatus: entry.status,
      syncError: entry.lastError,
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...row };
    else list.push(row);
    next[key] = list;
  }
  return next as T;
}

export function formatOutboxFailureMessage(entries: SyncOutboxEntry[]): string | null {
  const failed = entries.filter((entry) => entry.status === "failed");
  if (!failed.length) return null;
  const first = failed[0];
  const detail = first.lastError ? ` : ${first.lastError}` : "";
  if (failed.length === 1) {
    return `Synchronisation échouée (${first.entity} ${first.recordId})${detail}`;
  }
  return `${failed.length} enregistrements en échec de synchronisation${detail}`;
}
